export interface ExtractProjectSnapshotInput {
    archive: Buffer;
    destinationRoot: string;
    snapshotName?: string;
    maxExtractedBytes?: number;
    maxEntries?: number;
}
export interface ProjectSnapshotOutput {
    destination: string;
    archiveBytes: number;
    extractedBytes: number;
    files: number;
    directories: number;
}
export declare function projectIdFromUrl(projectUrl: string): string;
export declare function defaultSnapshotName(now?: Date): string;
export declare function extractProjectSnapshot(input: ExtractProjectSnapshotInput): Promise<ProjectSnapshotOutput>;
