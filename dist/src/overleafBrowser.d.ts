import { type Page } from 'playwright';
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
    trackedSignal?: boolean;
}
export declare class OverleafBrowserClient {
    private browser?;
    private context?;
    private page?;
    private managedBrowser;
    close(): Promise<void>;
    connect(projectUrl?: string): Promise<Page>;
    openLogin(): Promise<Page>;
    waitForLogin(timeoutMs?: number): Promise<Page>;
    private launchManagedContext;
    readOpenEditorText(projectUrl?: string): Promise<string>;
    isReviewingLikelyEnabled(projectUrl?: string): Promise<boolean>;
    replaceTextTracked(input: ReplaceTrackedInput): Promise<ReplaceTrackedOutput>;
    replaceTextsTracked(input: ReplaceTrackedBatchInput): Promise<ReplaceTrackedBatchOutput>;
}
export declare function browserProfileDirectory(): string;
