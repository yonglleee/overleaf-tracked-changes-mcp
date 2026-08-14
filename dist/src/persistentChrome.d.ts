export interface PersistentChromeInput {
    cdpUrl?: string;
    executable?: string;
    profileDirectory: string;
    startUrl?: string;
    timeoutMs?: number;
}
export interface PersistentChromeOutput {
    cdpUrl: string;
    executable: string;
    profileDirectory: string;
    reused: boolean;
}
export declare function defaultCdpUrl(): string;
export declare function cdpPort(cdpUrl: string): number;
export declare function findChromeExecutable(explicit?: string): string;
export declare function findReachableOverleafCdp(cdpUrl?: string): Promise<string | null>;
export declare function ensurePersistentChrome(input: PersistentChromeInput): Promise<PersistentChromeOutput>;
export declare function defaultPersistentProfileDirectory(): string;
