export interface UploadFilePlan {
    ok: true;
    localPath: string;
    remotePath: string;
    remoteFolder: string;
    fileName: string;
    bytes: number;
    sha256: string;
    mimeType: string;
}
export type UploadPlanCacheStatus = 'miss' | 'hit' | 'refresh';
export interface PreparedUploadFile {
    plan: UploadFilePlan;
    cacheStatus: UploadPlanCacheStatus;
    buffer?: Buffer;
}
export declare function clearUploadPlanCache(): void;
export declare function prepareUploadFile(input: {
    localRoot: string;
    localPath: string;
    remotePath?: string;
    maxBytes?: number;
    includeBuffer?: boolean;
}): Promise<PreparedUploadFile>;
export declare function planUploadFile(input: {
    localRoot: string;
    localPath: string;
    remotePath?: string;
    maxBytes?: number;
}): Promise<UploadFilePlan>;
