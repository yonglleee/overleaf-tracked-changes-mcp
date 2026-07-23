import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { defaultPersistentProfileDirectory } from './persistentChrome.js';
import { extractProjectSnapshot, projectIdFromUrl, type ProjectSnapshotOutput } from './projectSnapshot.js';
import { planExactReplacement } from './textPatch.js';

export interface OverleafStatus {
  ok: boolean;
  browserMode: 'managed-profile' | 'external-cdp';
  profile: string | null;
  loggedIn: boolean;
  onProject: boolean;
  accessDenied: boolean;
  reviewing: boolean;
  openFile: string | null;
  url: string;
  title: string;
}

export interface OpenProjectFileInput {
  filePath: string;
  projectUrl?: string;
  ensureReviewing?: boolean;
}

export interface PreparedProjectFile {
  status: OverleafStatus;
  text: string;
}

export interface DownloadProjectSnapshotInput {
  destinationRoot: string;
  snapshotName?: string;
  projectUrl?: string;
  maxArchiveBytes?: number;
  maxExtractedBytes?: number;
}

export interface DownloadProjectSnapshotOutput extends ProjectSnapshotOutput {
  projectId: string;
}

export interface ReplaceTrackedInput {
  expectedText: string;
  replacementText: string;
  dryRun?: boolean;
  requireReviewing?: boolean;
  maxReplacementChars?: number;
  projectUrl?: string;
}

export interface TrackedReplacement {
  expectedText: string;
  replacementText: string;
}

export interface ReplaceTrackedBatchInput {
  edits: TrackedReplacement[];
  dryRun?: boolean;
  requireReviewing?: boolean;
  maxReplacementChars?: number;
  maxEdits?: number;
  projectUrl?: string;
  reviewingVerified?: boolean;
}

export interface ReplaceTrackedOutput {
  ok: boolean;
  dryRun: boolean;
  blocked?: boolean;
  reason?: string;
  plan?: unknown;
  verification?: {
    replacementPresent: boolean;
    expectedStillPresent: boolean;
  };
  trackedSignal?: boolean;
  trackedCountBefore?: number;
  trackedCountAfter?: number;
}

export interface ReplaceTrackedBatchOutput {
  ok: boolean;
  dryRun: boolean;
  blocked?: boolean;
  reason?: string;
  plans?: unknown[];
  verification?: Array<{
    replacementPresent: boolean;
    expectedStillPresent: boolean;
  }>;
  finalTextMatches?: boolean;
  trackedSignal?: boolean;
  trackedCountBefore?: number;
  trackedCountAfter?: number;
}

interface PageInspection {
  accessDenied: boolean;
  loginLink: boolean;
  editorVisible: boolean;
  reviewing: boolean;
  openFileLabels: string[];
}

interface TrackedSnapshot {
  count: number;
  signature: string;
}

const EDITOR_FILE_PATTERN = /\.(?:tex|bib|bbl|sty|cls|bst|md|txt|csv|json|ya?ml)$/i;

export function selectOpenFileName(labels: string[]): string | null {
  for (const label of labels) {
    const parts = label.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const cleaned = part.replace(/\s+Close$/i, '').trim();
      if (!EDITOR_FILE_PATTERN.test(cleaned)) continue;
      return cleaned.replace(/\\/g, '/').split('/').at(-1) || null;
    }
  }
  return null;
}

export function trackedSnapshotChanged(before: TrackedSnapshot, after: TrackedSnapshot): boolean {
  return after.count > before.count || after.signature !== before.signature;
}

export function isAuthenticatedOverleafPage(urlValue: string, hasLoginLink: boolean): boolean {
  try {
    const url = new URL(urlValue);
    const overleafHost = url.hostname === 'overleaf.com' || url.hostname.endsWith('.overleaf.com');
    const authenticationPath = url.pathname.startsWith('/login')
      || url.pathname.startsWith('/users/auth/');
    return overleafHost && !authenticationPath && !hasLoginLink;
  } catch {
    return false;
  }
}

export class OverleafBrowserClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private managedBrowser = false;

  async close(): Promise<void> {
    if (this.managedBrowser) {
      await this.context?.close().catch(() => undefined);
    }
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.managedBrowser = false;
  }

  async connect(projectUrl?: string): Promise<Page> {
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
      } catch {
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
      if (contexts.length === 0) throw new Error('No browser contexts found in CDP session.');
      this.context = contexts[0];
      this.managedBrowser = false;
    } else {
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

  async openLogin(): Promise<Page> {
    return this.connect('https://www.overleaf.com/login');
  }

  async waitForLogin(timeoutMs = 10 * 60 * 1000): Promise<Page> {
    const page = await this.openLogin();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hasLoginLink = await page.evaluate(() => Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/login"]'),
      ).some((link) => /^log in$/i.test((link.innerText || '').trim()))).catch(() => true);
      if (isAuthenticatedOverleafPage(page.url(), hasLoginLink)) return page;
      await page.waitForTimeout(500);
    }
    throw new Error('Timed out waiting for a completed Overleaf login. Finish OAuth and return to Overleaf.');
  }

  private async launchManagedContext(): Promise<BrowserContext> {
    const profileDir = browserProfileDirectory();
    const channel = process.env.OVERLEAF_BROWSER_CHANNEL || 'chrome';
    try {
      return await chromium.launchPersistentContext(profileDir, {
        channel,
        headless: false,
        args: ['--no-first-run', '--no-default-browser-check'],
      });
    } catch (error) {
      throw new Error(
        `Could not launch the managed ${channel} browser. Install Chrome or set OVERLEAF_BROWSER_CDP for an existing browser. ${String(error)}`,
      );
    }
  }

  private async inspectPage(page: Page): Promise<PageInspection> {
    return page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const accessDenied = /restricted|don.t have permission|do not have permission/i.test(bodyText);
      const loginLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/login"]')).some((link) => (
        /^log in$/i.test((link.innerText || '').trim())
      ));
      const editorVisible = Boolean(
        document.querySelector('.cm-editor, [role="tabpanel"][aria-label="File tree"], [role="treeitem"]'),
      );
      const modeButton = Array.from(document.querySelectorAll<HTMLElement>('button')).find((element) => {
        const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
        return text === 'Reviewing';
      });
      const reviewToggle = document.querySelector<HTMLElement>(
        'button[aria-label="Reviewing"].reviewing, .review-mode-switcher-toggle-button.reviewing',
      );
      const activeReviewItem = Array.from(
        document.querySelectorAll<HTMLElement>('.dropdown-item.active'),
      ).some((element) => /reviewing|edits become suggestions/i.test(element.innerText));
      const activeFileElements = document.querySelectorAll<HTMLElement>([
        '[role="tab"][aria-selected="true"]',
        '.ide-react-editor-tabs .nav-link.active',
        '.file-tab.active',
        '.file-tab[aria-selected="true"]',
        '[data-testid="file-tab"][aria-selected="true"]',
      ].join(','));
      const openFileLabels = Array.from(activeFileElements).flatMap((element) => [
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.innerText || '',
      ]).filter(Boolean);
      return {
        accessDenied,
        loginLink,
        editorVisible,
        reviewing: Boolean(modeButton || reviewToggle || activeReviewItem),
        openFileLabels,
      };
    });
  }

  private async readEditorText(page: Page): Promise<string> {
    return page.evaluate(() => {
      function findCodeMirrorViewInPage(): any {
        const candidates: Element[] = [];
        for (const selector of ['.cm-editor', '.cm-content', '[class*="cm-editor"]']) {
          for (const element of document.querySelectorAll(selector)) candidates.push(element);
        }
        function maybeView(value: any): any {
          if (!value || typeof value !== 'object') return null;
          if (value.state?.doc && typeof value.dispatch === 'function') return value;
          if (value.view?.state?.doc && typeof value.view.dispatch === 'function') return value.view;
          return null;
        }
        for (const element of candidates) {
          let current: Element | null = element;
          while (current) {
            for (const key of Object.keys(current as any)) {
              const view = maybeView((current as any)[key]);
              if (view) return view;
            }
            current = current.parentElement;
          }
        }
        throw new Error('CodeMirror editor view not found. Open the target .tex file in Overleaf first.');
      }
      return findCodeMirrorViewInPage().state.doc.toString();
    });
  }

  private async trackedSnapshot(page: Page): Promise<TrackedSnapshot> {
    return page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(
        '.ol-cm-change, .review-panel-entry-change',
      ));
      return {
        count: elements.length,
        signature: elements.map((element) => [
          element.className,
          element.getAttribute('data-id') || '',
          element.getAttribute('data-change-id') || '',
          element.textContent || '',
        ].join('|')).join('\n'),
      };
    });
  }

  async readOpenEditorText(projectUrl?: string): Promise<string> {
    const page = await this.connect(projectUrl);
    return this.readEditorText(page);
  }

  async isReviewingLikelyEnabled(projectUrl?: string): Promise<boolean> {
    const page = await this.connect(projectUrl);
    return (await this.inspectPage(page)).reviewing;
  }

  private async statusFromPage(page: Page, waitForReady = false): Promise<OverleafStatus> {
    if (waitForReady && page.url().includes('/project/')) {
      await page.waitForFunction(() => {
        const text = document.body?.innerText || '';
        return Boolean(
          document.querySelector('.cm-editor, [role="treeitem"]')
          || /restricted|don.t have permission|do not have permission/i.test(text)
          || Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/login"]')).some((link) => (
            /^log in$/i.test((link.innerText || '').trim())
          )),
        );
      }, undefined, { timeout: 15_000 }).catch(() => undefined);
    }
    const inspection = await this.inspectPage(page);
    const loggedIn = !page.url().includes('/login') && !inspection.loginLink;
    const onProject = page.url().includes('/project/') && inspection.editorVisible && !inspection.accessDenied;
    return {
      ok: loggedIn && onProject && !inspection.accessDenied,
      browserMode: process.env.OVERLEAF_BROWSER_CDP ? 'external-cdp' : 'managed-profile',
      profile: process.env.OVERLEAF_BROWSER_CDP ? null : browserProfileDirectory(),
      loggedIn,
      onProject,
      accessDenied: inspection.accessDenied,
      reviewing: onProject && inspection.reviewing,
      openFile: onProject ? selectOpenFileName(inspection.openFileLabels) : null,
      url: page.url(),
      title: await page.title(),
    };
  }

  async status(projectUrl?: string): Promise<OverleafStatus> {
    return this.statusFromPage(await this.connect(projectUrl), true);
  }

  private async ensureReviewingOnPage(page: Page): Promise<{ changed: boolean; status: OverleafStatus }> {
    if ((await this.inspectPage(page)).reviewing) {
      return { changed: false, status: await this.statusFromPage(page) };
    }
    const editingButton = page.getByRole('button', { name: 'Editing', exact: true });
    if (await editingButton.count() !== 1) {
      throw new Error('Editing mode button not found. Open a .tex file in the Overleaf editor first.');
    }
    await editingButton.click();

    const exactReviewItem = page.getByRole('menuitem', {
      name: 'Reviewing Edits become suggestions',
      exact: true,
    });
    const fallbackReviewItem = page.locator('[role="menuitem"], .dropdown-item').filter({
      hasText: 'Reviewing',
    });
    const reviewItem = await exactReviewItem.count() === 1 ? exactReviewItem : fallbackReviewItem;
    if (await reviewItem.count() !== 1) {
      throw new Error('Reviewing menu item not found after opening the editor mode menu.');
    }
    await reviewItem.click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLElement>('button')).some((element) => (
      (element.innerText || element.getAttribute('aria-label') || '').trim() === 'Reviewing'
    )), undefined, { timeout: 10_000 });

    return { changed: true, status: await this.statusFromPage(page) };
  }

  async ensureReviewing(projectUrl?: string): Promise<{ ok: boolean; changed: boolean; status: OverleafStatus }> {
    const result = await this.ensureReviewingOnPage(await this.connect(projectUrl));
    return { ok: result.status.reviewing, ...result };
  }

  async prepareProjectFile(input: OpenProjectFileInput): Promise<PreparedProjectFile> {
    const page = await this.connect(input.projectUrl);
    const initialStatus = await this.statusFromPage(page, true);
    if (!initialStatus.loggedIn) throw new Error('Overleaf login is required before opening a project file.');
    if (initialStatus.accessDenied) throw new Error('The logged-in Overleaf account cannot access this project.');
    if (!initialStatus.onProject) throw new Error('The Overleaf project editor is not loaded.');
    const fileName = path.basename(input.filePath);
    if (initialStatus.openFile !== fileName) {
      const fileTreePanel = page.getByRole('tabpanel', { name: 'File tree', exact: true });
      const target = fileTreePanel.getByText(fileName, { exact: true });
      const count = await target.count();
      if (count !== 1) {
        throw new Error(
          count === 0
            ? `File is not visible in the expanded Overleaf file tree: ${input.filePath}`
            : `File name is ambiguous in the Overleaf file tree: ${input.filePath}`,
        );
      }
      await target.click();
    }
    await page.locator('.cm-editor').first().waitFor({ state: 'attached', timeout: 5_000 });
    if (input.ensureReviewing) await this.ensureReviewingOnPage(page);
    const [status, text] = await Promise.all([
      this.statusFromPage(page),
      this.readEditorText(page),
    ]);
    return {
      status: status.openFile ? status : { ...status, openFile: fileName },
      text,
    };
  }

  async openProjectFile(input: OpenProjectFileInput): Promise<OverleafStatus> {
    return (await this.prepareProjectFile(input)).status;
  }

  async downloadProjectSnapshot(
    input: DownloadProjectSnapshotInput,
  ): Promise<DownloadProjectSnapshotOutput> {
    const page = await this.connect(input.projectUrl);
    const status = await this.status();
    if (!status.loggedIn) throw new Error('Overleaf login is required before downloading a snapshot.');
    if (status.accessDenied) throw new Error('The logged-in Overleaf account cannot access this project.');
    if (!status.onProject) throw new Error('Open an Overleaf project before downloading a snapshot.');

    const projectId = projectIdFromUrl(input.projectUrl || page.url());
    const downloadUrl = new URL(`/project/${projectId}/download/zip`, page.url()).toString();
    const response = await page.context().request.get(downloadUrl, { timeout: 120_000 });
    if (!response.ok()) {
      throw new Error(`Overleaf snapshot download failed: HTTP ${response.status()}`);
    }
    const archive = Buffer.from(await response.body());
    const maxArchiveBytes = input.maxArchiveBytes ?? 250 * 1024 * 1024;
    if (archive.length > maxArchiveBytes) {
      throw new Error(`Overleaf archive is too large (${archive.length} bytes > ${maxArchiveBytes}).`);
    }
    if (archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
      throw new Error('Overleaf did not return a ZIP archive. The login may have expired.');
    }

    return {
      projectId,
      ...await extractProjectSnapshot({
        archive,
        destinationRoot: input.destinationRoot,
        snapshotName: input.snapshotName,
        maxExtractedBytes: input.maxExtractedBytes,
      }),
    };
  }

  async replaceTextTracked(input: ReplaceTrackedInput): Promise<ReplaceTrackedOutput> {
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
      trackedCountBefore: result.trackedCountBefore,
      trackedCountAfter: result.trackedCountAfter,
    };
  }

  async replaceTextsTracked(input: ReplaceTrackedBatchInput): Promise<ReplaceTrackedBatchOutput> {
    const dryRun = input.dryRun !== false;
    const maxEdits = input.maxEdits ?? 40;
    if (input.edits.length === 0) {
      return { ok: false, dryRun, blocked: true, reason: 'no_edits' };
    }
    if (input.edits.length > maxEdits) {
      return { ok: false, dryRun, blocked: true, reason: 'too_many_edits' };
    }
    if (input.requireReviewing !== false && !input.reviewingVerified) {
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
      .filter((plan): plan is Extract<typeof plan, { ok: true }> => plan.ok)
      .slice()
      .sort((a, b) => a.from - b.from);
    for (let index = 1; index < orderedPlans.length; index += 1) {
      const previous = orderedPlans[index - 1];
      const current = orderedPlans[index];
      const ambiguousSharedStart = previous.from === current.from
        && (previous.from === previous.to || current.from === current.to);
      if (previous.to > current.from || ambiguousSharedStart) {
        return { ok: false, dryRun, blocked: true, reason: 'overlapping_edits', plans };
      }
    }

    if (dryRun) return { ok: true, dryRun: true, plans };

    const page = await this.connect(input.projectUrl);
    const trackedBefore = await this.trackedSnapshot(page);
    await page.evaluate((edits) => {
      function findCodeMirrorViewInPage(): any {
        const candidates: Element[] = [];
        for (const selector of ['.cm-editor', '.cm-content', '[class*="cm-editor"]']) {
          for (const element of document.querySelectorAll(selector)) candidates.push(element);
        }
        function maybeView(value: any): any {
          if (!value || typeof value !== 'object') return null;
          if (value.state?.doc && typeof value.dispatch === 'function') return value;
          if (value.view?.state?.doc && typeof value.view.dispatch === 'function') return value.view;
          return null;
        }
        for (const element of candidates) {
          let current: Element | null = element;
          while (current) {
            for (const key of Object.keys(current as any)) {
              const view = maybeView((current as any)[key]);
              if (view) return view;
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
        if (first < 0) throw new Error('expected_text_not_found');
        const second = text.indexOf(edit.expectedText, first + edit.expectedText.length);
        if (second >= 0) throw new Error('expected_text_not_unique');

        let prefixLength = 0;
        const prefixLimit = Math.min(edit.expectedText.length, edit.replacementText.length);
        while (
          prefixLength < prefixLimit
          && edit.expectedText.charCodeAt(prefixLength) === edit.replacementText.charCodeAt(prefixLength)
        ) {
          prefixLength += 1;
        }
        let suffixLength = 0;
        const suffixLimit = Math.min(
          edit.expectedText.length - prefixLength,
          edit.replacementText.length - prefixLength,
        );
        while (
          suffixLength < suffixLimit
          && edit.expectedText.charCodeAt(edit.expectedText.length - suffixLength - 1)
            === edit.replacementText.charCodeAt(edit.replacementText.length - suffixLength - 1)
        ) {
          suffixLength += 1;
        }

        return {
          matchFrom: first,
          matchTo: first + edit.expectedText.length,
          from: first + prefixLength,
          to: first + edit.expectedText.length - suffixLength,
          insert: edit.replacementText.slice(
            prefixLength,
            edit.replacementText.length - suffixLength,
          ),
        };
      }).sort((a, b) => a.from - b.from);

      for (let index = 1; index < changes.length; index += 1) {
        const previous = changes[index - 1];
        const current = changes[index];
        const ambiguousSharedStart = previous.from === current.from
          && (previous.from === previous.to || current.from === current.to);
        if (previous.to > current.from || ambiguousSharedStart) {
          throw new Error('overlapping_edits');
        }
      }
      view.dispatch({
        changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
      });
    }, input.edits);

    await page.waitForFunction((beforeSnapshot) => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(
        '.ol-cm-change, .review-panel-entry-change',
      ));
      const signature = elements.map((element) => [
        element.className,
        element.getAttribute('data-id') || '',
        element.getAttribute('data-change-id') || '',
        element.textContent || '',
      ].join('|')).join('\n');
      return elements.length > beforeSnapshot.count || signature !== beforeSnapshot.signature;
    }, trackedBefore, { timeout: 2_000 }).catch(() => undefined);

    const after = await this.readOpenEditorText(input.projectUrl);
    const trackedAfter = await this.trackedSnapshot(page);
    const trackedSignal = trackedSnapshotChanged(trackedBefore, trackedAfter);
    const expectedAfter = orderedPlans
      .slice()
      .sort((a, b) => b.from - a.from)
      .reduce((text, plan) => (
        text.slice(0, plan.from) + plan.insert + text.slice(plan.to)
      ), before);
    let accumulatedDelta = 0;
    const verification = orderedPlans.map((plan) => {
      const finalFrom = plan.from + accumulatedDelta;
      const removedText = before.slice(plan.from, plan.to);
      const result = {
        replacementPresent: after.slice(finalFrom, finalFrom + plan.insert.length) === plan.insert,
        expectedStillPresent: removedText.length > 0
          && after.slice(finalFrom, finalFrom + removedText.length) === removedText,
      };
      accumulatedDelta += plan.insert.length - (plan.to - plan.from);
      return result;
    });
    const finalTextMatches = after === expectedAfter;
    const trackedRequired = input.requireReviewing !== false;
    return {
      ok: finalTextMatches && (!trackedRequired || trackedSignal),
      dryRun: false,
      reason: finalTextMatches && trackedRequired && !trackedSignal
        ? 'tracked_change_not_detected'
        : undefined,
      plans,
      verification,
      finalTextMatches,
      trackedSignal,
      trackedCountBefore: trackedBefore.count,
      trackedCountAfter: trackedAfter.count,
    };
  }
}

export function browserProfileDirectory(): string {
  return defaultPersistentProfileDirectory();
}
