export declare function isSupportedTextFile(relativePath: string): boolean;
export declare function isLatexBuildArtifact(relativePath: string, existsInBaseline?: boolean): boolean;
export interface TreeEntry {
    path: string;
    type: 'file' | 'dir';
    bytes?: number;
}
export interface SearchMatch {
    path: string;
    line: number;
    column: number;
    text: string;
}
export declare function resolveLocalRoot(rootArg?: string): string;
export declare function resolveInsideRoot(root: string, relativePath: string): string;
export interface LocalFileFingerprint {
    size: number;
    mtimeMs: number;
    ino: number | null;
}
export declare function fingerprintLocalFile(root: string, relativePath: string): Promise<LocalFileFingerprint>;
export declare function readLocalFile(root: string, relativePath: string, maxBytes?: number): Promise<string>;
export declare function readProjectTree(root: string, maxEntries?: number): Promise<TreeEntry[]>;
export declare function searchProject(root: string, query: string, maxMatches?: number): Promise<SearchMatch[]>;
