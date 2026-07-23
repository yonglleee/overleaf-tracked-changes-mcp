import { chromium, type Browser, type Page } from 'playwright';
import { planExactReplacement } from './textPatch.js';

export interface ReplaceTrackedInput {
  expectedText: string;
  replacementText: string;
  dryRun?: boolean;
  requireReviewing?: boolean;
  maxReplacementChars?: number;
  projectUrl?: string;
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
}

export class OverleafBrowserClient {
  private browser?: Browser;
  private page?: Page;

  async connect(projectUrl?: string): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    const cdpUrl = process.env.OVERLEAF_BROWSER_CDP;
    if (!cdpUrl) {
      throw new Error('Set OVERLEAF_BROWSER_CDP to a Chrome/Edge remote debugging URL.');
    }

    this.browser = await chromium.connectOverCDP(cdpUrl);
    const contexts = this.browser.contexts();
    if (contexts.length === 0) throw new Error('No browser contexts found in CDP session.');
    const pages = contexts.flatMap((context) => context.pages());
    const wantedUrl = projectUrl || process.env.OVERLEAF_PROJECT_URL;
    const overleafPage = pages.find((page) => page.url().includes('overleaf.com/project'));

    this.page = overleafPage || pages[0] || await contexts[0].newPage();

    if (wantedUrl && !this.page.url().includes(wantedUrl)) {
      await this.page.goto(wantedUrl, { waitUntil: 'domcontentloaded' });
    }

    return this.page;
  }

  async readOpenEditorText(projectUrl?: string): Promise<string> {
    const page = await this.connect(projectUrl);
    return page.evaluate(readEditorTextInPage);
  }

  async isReviewingLikelyEnabled(projectUrl?: string): Promise<boolean> {
    const page = await this.connect(projectUrl);
    return page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || '';
      return text.includes('reviewing') || text.includes('track changes') || text.includes('tracked changes');
    });
  }

  async replaceTextTracked(input: ReplaceTrackedInput): Promise<ReplaceTrackedOutput> {
    const dryRun = input.dryRun !== false;
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
    const plan = planExactReplacement(before, {
      expectedText: input.expectedText,
      replacementText: input.replacementText,
      maxReplacementChars: input.maxReplacementChars,
    });

    if (!plan.ok) {
      return { ok: false, dryRun, blocked: true, reason: plan.reason, plan };
    }

    if (dryRun) {
      return { ok: true, dryRun: true, plan };
    }

    const page = await this.connect(input.projectUrl);
    await page.evaluate(replaceExactOnceInPage, {
      expectedText: input.expectedText,
      replacementText: input.replacementText,
    });

    const after = await this.readOpenEditorText(input.projectUrl);
    return {
      ok: true,
      dryRun: false,
      plan,
      verification: {
        replacementPresent: after.includes(input.replacementText),
        expectedStillPresent: after.includes(input.expectedText),
      },
    };
  }
}

function findCodeMirrorView(): any {
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

function readEditorTextInPage(): string {
  const view = findCodeMirrorView();
  return view.state.doc.toString();
}

function replaceExactOnceInPage(args: { expectedText: string; replacementText: string }): void {
  const view = findCodeMirrorView();
  const text = view.state.doc.toString();
  const first = text.indexOf(args.expectedText);
  if (first < 0) throw new Error('expected_text_not_found');
  const second = text.indexOf(args.expectedText, first + args.expectedText.length);
  if (second >= 0) throw new Error('expected_text_not_unique');
  view.dispatch({
    changes: {
      from: first,
      to: first + args.expectedText.length,
      insert: args.replacementText,
    },
  });
}