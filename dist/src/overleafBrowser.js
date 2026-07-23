import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { planExactReplacement } from './textPatch.js';
export class OverleafBrowserClient {
    browser;
    context;
    page;
    managedBrowser = false;
    async close() {
        if (this.managedBrowser) {
            await this.context?.close().catch(() => undefined);
        }
        else {
            await this.browser?.close().catch(() => undefined);
        }
        this.browser = undefined;
        this.context = undefined;
        this.page = undefined;
        this.managedBrowser = false;
    }
    async connect(projectUrl) {
        if (this.page && !this.page.isClosed()) {
            if (projectUrl && !this.page.url().includes(projectUrl)) {
                await this.page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
            }
            return this.page;
        }
        const wantedUrl = projectUrl || process.env.OVERLEAF_PROJECT_URL;
        if (this.context) {
            try {
                const pages = this.context.pages();
                this.page = pages.find((page) => wantedUrl && page.url().includes(wantedUrl))
                    || pages.find((page) => page.url().includes('overleaf.com'))
                    || pages[0]
                    || await this.context.newPage();
                if (wantedUrl && !this.page.url().includes(wantedUrl)) {
                    await this.page.goto(wantedUrl, { waitUntil: 'domcontentloaded' });
                }
                return this.page;
            }
            catch {
                this.browser = undefined;
                this.context = undefined;
                this.page = undefined;
                this.managedBrowser = false;
            }
        }
        const cdpUrl = process.env.OVERLEAF_BROWSER_CDP;
        if (cdpUrl) {
            this.browser = await chromium.connectOverCDP(cdpUrl);
            const contexts = this.browser.contexts();
            if (contexts.length === 0)
                throw new Error('No browser contexts found in CDP session.');
            this.context = contexts[0];
            this.managedBrowser = false;
        }
        else {
            this.context = await this.launchManagedContext();
            this.browser = this.context.browser() || undefined;
            this.managedBrowser = true;
        }
        const pages = this.context.pages();
        const overleafPage = pages.find((page) => wantedUrl && page.url().includes(wantedUrl))
            || pages.find((page) => page.url().includes('overleaf.com'));
        this.page = overleafPage || pages[0] || await this.context.newPage();
        if (wantedUrl && !this.page.url().includes(wantedUrl)) {
            await this.page.goto(wantedUrl, { waitUntil: 'domcontentloaded' });
        }
        return this.page;
    }
    async openLogin() {
        return this.connect('https://www.overleaf.com/login');
    }
    async waitForLogin(timeoutMs = 10 * 60 * 1000) {
        const page = await this.openLogin();
        if (!page.url().includes('/login'))
            return page;
        await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: timeoutMs });
        return page;
    }
    async launchManagedContext() {
        const profileDir = browserProfileDirectory();
        const channel = process.env.OVERLEAF_BROWSER_CHANNEL || 'chrome';
        try {
            return await chromium.launchPersistentContext(profileDir, {
                channel,
                headless: false,
                args: ['--no-first-run', '--no-default-browser-check'],
            });
        }
        catch (error) {
            throw new Error(`Could not launch the managed ${channel} browser. Install Chrome or set OVERLEAF_BROWSER_CDP for an existing browser. ${String(error)}`);
        }
    }
    async readOpenEditorText(projectUrl) {
        const page = await this.connect(projectUrl);
        return page.evaluate(() => {
            function findCodeMirrorViewInPage() {
                const candidates = [];
                for (const selector of ['.cm-editor', '.cm-content', '[class*="cm-editor"]']) {
                    for (const element of document.querySelectorAll(selector))
                        candidates.push(element);
                }
                function maybeView(value) {
                    if (!value || typeof value !== 'object')
                        return null;
                    if (value.state?.doc && typeof value.dispatch === 'function')
                        return value;
                    if (value.view?.state?.doc && typeof value.view.dispatch === 'function')
                        return value.view;
                    return null;
                }
                for (const element of candidates) {
                    let current = element;
                    while (current) {
                        for (const key of Object.keys(current)) {
                            const view = maybeView(current[key]);
                            if (view)
                                return view;
                        }
                        current = current.parentElement;
                    }
                }
                throw new Error('CodeMirror editor view not found. Open the target .tex file in Overleaf first.');
            }
            const view = findCodeMirrorViewInPage();
            return view.state.doc.toString();
        });
    }
    async isReviewingLikelyEnabled(projectUrl) {
        const page = await this.connect(projectUrl);
        return page.evaluate(() => {
            const reviewToggle = document.querySelector('button[aria-label="Reviewing"].reviewing, .review-mode-switcher-toggle-button.reviewing');
            if (reviewToggle)
                return true;
            const activeReviewItem = Array.from(document.querySelectorAll('.dropdown-item.active')).some((element) => /reviewing|edits become suggestions/i.test(element.innerText));
            if (activeReviewItem)
                return true;
            const text = document.body?.innerText?.toLowerCase() || '';
            return text.includes('reviewing') || text.includes('track changes') || text.includes('tracked changes');
        });
    }
    async replaceTextTracked(input) {
        const result = await this.replaceTextsTracked({
            edits: [{
                    expectedText: input.expectedText,
                    replacementText: input.replacementText,
                }],
            dryRun: input.dryRun,
            requireReviewing: input.requireReviewing,
            maxReplacementChars: input.maxReplacementChars,
            maxEdits: 1,
            projectUrl: input.projectUrl,
        });
        return {
            ok: result.ok,
            dryRun: result.dryRun,
            blocked: result.blocked,
            reason: result.reason,
            plan: result.plans?.[0],
            verification: result.verification?.[0],
            trackedSignal: result.trackedSignal,
        };
    }
    async replaceTextsTracked(input) {
        const dryRun = input.dryRun !== false;
        const maxEdits = input.maxEdits ?? 40;
        if (input.edits.length === 0) {
            return { ok: false, dryRun, blocked: true, reason: 'no_edits' };
        }
        if (input.edits.length > maxEdits) {
            return { ok: false, dryRun, blocked: true, reason: 'too_many_edits' };
        }
        if (input.requireReviewing !== false) {
            const reviewing = await this.isReviewingLikelyEnabled(input.projectUrl);
            if (!reviewing) {
                return {
                    ok: false,
                    dryRun,
                    blocked: true,
                    reason: 'reviewing_mode_not_detected',
                };
            }
        }
        const before = await this.readOpenEditorText(input.projectUrl);
        const plans = input.edits.map((edit) => planExactReplacement(before, {
            expectedText: edit.expectedText,
            replacementText: edit.replacementText,
            maxReplacementChars: input.maxReplacementChars,
        }));
        const blockedPlan = plans.find((plan) => !plan.ok);
        if (blockedPlan && !blockedPlan.ok) {
            return { ok: false, dryRun, blocked: true, reason: blockedPlan.reason, plans };
        }
        const orderedPlans = plans
            .filter((plan) => plan.ok)
            .slice()
            .sort((a, b) => a.matchFrom - b.matchFrom);
        for (let index = 1; index < orderedPlans.length; index += 1) {
            if (orderedPlans[index - 1].matchTo > orderedPlans[index].matchFrom) {
                return { ok: false, dryRun, blocked: true, reason: 'overlapping_edits', plans };
            }
        }
        if (dryRun)
            return { ok: true, dryRun: true, plans };
        const page = await this.connect(input.projectUrl);
        await page.evaluate((edits) => {
            function findCodeMirrorViewInPage() {
                const candidates = [];
                for (const selector of ['.cm-editor', '.cm-content', '[class*="cm-editor"]']) {
                    for (const element of document.querySelectorAll(selector))
                        candidates.push(element);
                }
                function maybeView(value) {
                    if (!value || typeof value !== 'object')
                        return null;
                    if (value.state?.doc && typeof value.dispatch === 'function')
                        return value;
                    if (value.view?.state?.doc && typeof value.view.dispatch === 'function')
                        return value.view;
                    return null;
                }
                for (const element of candidates) {
                    let current = element;
                    while (current) {
                        for (const key of Object.keys(current)) {
                            const view = maybeView(current[key]);
                            if (view)
                                return view;
                        }
                        current = current.parentElement;
                    }
                }
                throw new Error('CodeMirror editor view not found. Open the target .tex file in Overleaf first.');
            }
            const view = findCodeMirrorViewInPage();
            const text = view.state.doc.toString();
            const changes = edits.map((edit) => {
                const first = text.indexOf(edit.expectedText);
                if (first < 0)
                    throw new Error('expected_text_not_found');
                const second = text.indexOf(edit.expectedText, first + edit.expectedText.length);
                if (second >= 0)
                    throw new Error('expected_text_not_unique');
                let prefixLength = 0;
                const prefixLimit = Math.min(edit.expectedText.length, edit.replacementText.length);
                while (prefixLength < prefixLimit
                    && edit.expectedText.charCodeAt(prefixLength) === edit.replacementText.charCodeAt(prefixLength)) {
                    prefixLength += 1;
                }
                let suffixLength = 0;
                const suffixLimit = Math.min(edit.expectedText.length - prefixLength, edit.replacementText.length - prefixLength);
                while (suffixLength < suffixLimit
                    && edit.expectedText.charCodeAt(edit.expectedText.length - suffixLength - 1)
                        === edit.replacementText.charCodeAt(edit.replacementText.length - suffixLength - 1)) {
                    suffixLength += 1;
                }
                return {
                    matchFrom: first,
                    matchTo: first + edit.expectedText.length,
                    from: first + prefixLength,
                    to: first + edit.expectedText.length - suffixLength,
                    insert: edit.replacementText.slice(prefixLength, edit.replacementText.length - suffixLength),
                };
            }).sort((a, b) => a.matchFrom - b.matchFrom);
            for (let index = 1; index < changes.length; index += 1) {
                if (changes[index - 1].matchTo > changes[index].matchFrom) {
                    throw new Error('overlapping_edits');
                }
            }
            view.dispatch({
                changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
            });
        }, input.edits);
        const after = await this.readOpenEditorText(input.projectUrl);
        return {
            ok: true,
            dryRun: false,
            plans,
            verification: input.edits.map((edit) => ({
                replacementPresent: edit.replacementText.length > 0
                    ? after.includes(edit.replacementText)
                    : !after.includes(edit.expectedText),
                expectedStillPresent: after.includes(edit.expectedText),
            })),
            trackedSignal: await page.locator('.ol-cm-change, .review-panel-entry-change').count() > 0,
        };
    }
}
export function browserProfileDirectory() {
    if (process.env.OVERLEAF_BROWSER_PROFILE) {
        return path.resolve(process.env.OVERLEAF_BROWSER_PROFILE);
    }
    if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OverleafTrackedChangesMCP', 'browser-profile');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'OverleafTrackedChangesMCP', 'browser-profile');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'overleaf-tracked-changes-mcp', 'browser-profile');
}
//# sourceMappingURL=overleafBrowser.js.map