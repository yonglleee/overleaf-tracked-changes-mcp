export interface ReplacementPlan {
    ok: true;
    matchFrom: number;
    matchTo: number;
    from: number;
    to: number;
    insert: string;
    removedLength: number;
    insertedLength: number;
    beforePreview: string;
    afterPreview: string;
}
export interface BlockedPlan {
    ok: false;
    reason: 'expected_text_not_found' | 'expected_text_not_unique' | 'replacement_too_large';
    count: number;
    preview?: string;
}
export type PlanExactReplacementResult = ReplacementPlan | BlockedPlan;
export interface PlanExactReplacementOptions {
    expectedText: string;
    replacementText: string;
    maxReplacementChars?: number;
    previewChars?: number;
}
export declare function countOccurrences(haystack: string, needle: string): number;
export declare function minimizeReplacement(expectedText: string, replacementText: string): {
    prefixLength: number;
    suffixLength: number;
    removedLength: number;
    insert: string;
};
export declare function planExactReplacement(documentText: string, options: PlanExactReplacementOptions): PlanExactReplacementResult;
