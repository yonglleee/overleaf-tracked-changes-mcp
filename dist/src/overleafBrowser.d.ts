import { type Page } from 'playwright';
import { type ProjectSnapshotOutput } from './projectSnapshot.js';
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
export interface UploadProjectFileInput {
    buffer: Buffer;
    remotePath: string;
    remoteFolder: string;
    fileName: string;
    mimeType: string;
    overwrite?: boolean;
    projectUrl?: string;
    timeoutMs?: number;
}
export interface UploadProjectFileOutput {
    ok: boolean;
    dryRun: false;
    blocked?: boolean;
    reason?: string;
    action?: 'created' | 'overwritten';
    remotePath: string;
    folderId: string | null;
    responseStatus?: number;
    responseBody?: unknown;
    treeUpdated?: boolean;
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
interface TrackedSnapshot {
    count: number;
    signature: string;
}
export declare function selectOpenFileName(labels: string[]): string | null;
export declare function trackedSnapshotChanged(before: TrackedSnapshot, after: TrackedSnapshot): boolean;
export declare function isAuthenticatedOverleafPage(urlValue: string, hasLoginLink: boolean): boolean;
export declare class OverleafBrowserClient {
    private browser?;
    private context?;
    private page?;
    private managedBrowser;
    private connectionMode;
    close(): Promise<void>;
    connect(projectUrl?: string): Promise<Page>;
    openLogin(): Promise<Page>;
    waitForLogin(timeoutMs?: number): Promise<Page>;
    private launchManagedContext;
    private inspectPage;
    private readEditorText;
    private trackedSnapshot;
    readOpenEditorText(projectUrl?: string): Promise<string>;
    isReviewingLikelyEnabled(projectUrl?: string): Promise<boolean>;
    private statusFromPage;
    status(projectUrl?: string): Promise<OverleafStatus>;
    private ensureReviewingOnPage;
    ensureReviewing(projectUrl?: string): Promise<{
        ok: boolean;
        changed: boolean;
        status: OverleafStatus;
    }>;
    prepareProjectFile(input: OpenProjectFileInput): Promise<PreparedProjectFile>;
    openProjectFile(input: OpenProjectFileInput): Promise<OverleafStatus>;
    downloadProjectSnapshot(input: DownloadProjectSnapshotInput): Promise<DownloadProjectSnapshotOutput>;
    private directFileTreeEntries;
    private resolveUploadFolder;
    uploadProjectFile(input: UploadProjectFileInput): Promise<UploadProjectFileOutput>;
    replaceTextTracked(input: ReplaceTrackedInput): Promise<ReplaceTrackedOutput>;
    replaceTextsTracked(input: ReplaceTrackedBatchInput): Promise<ReplaceTrackedBatchOutput>;
}
export declare function browserProfileDirectory(): string;
export {};
