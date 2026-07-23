export interface LocalTreeChanges {
    modified: string[];
    added: string[];
    deleted: string[];
    skipped: Array<{
        path: string;
        reason: 'unsupported_type' | 'too_large';
    }>;
    ignored: Array<{
        path: string;
        reason: 'latex_build_artifact';
    }>;
}
export interface LocalFilePlannedEdit {
    expectedText: string;
    replacementText: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
}
export interface LocalFileChangePlan {
    ok: boolean;
    changed: boolean;
    blocked?: boolean;
    reason?: 'empty_baseline_cannot_anchor' | 'too_many_hunks' | 'non_unique_local_anchor';
    baselineBytes: number;
    workingBytes: number;
    contextLines: number;
    edits: LocalFilePlannedEdit[];
}
export interface PlanLocalFileChangesOptions {
    contextLines?: number;
    maxContextLines?: number;
    maxEdits?: number;
}
export interface AtomicTextEdit {
    baseStart: number;
    baseEnd: number;
    originalText: string;
    replacementText: string;
}
export interface CollaborativeConflict {
    reason: 'overlapping_change' | 'remote_mapping_mismatch';
    local: AtomicTextEdit;
    remote: AtomicTextEdit;
}
export interface CollaborativeFileChangePlan {
    ok: boolean;
    changed: boolean;
    remoteChanged: boolean;
    blocked?: boolean;
    reason?: 'conflicts_require_resolution' | 'too_many_safe_edits' | 'remote_anchor_not_unique';
    localChangeCount: number;
    remoteChangeCount: number;
    safeChangeCount: number;
    alreadyAppliedCount: number;
    conflicts: CollaborativeConflict[];
    edits: LocalFilePlannedEdit[];
}
export declare function normalizeLineEndings(text: string): string;
export declare function listLocalChanges(baselineRoot: string, workingRoot: string, maxEntries?: number, maxBytes?: number): Promise<LocalTreeChanges>;
export declare function planCollaborativeFileChanges(baselineText: string, workingText: string, remoteText: string, options?: PlanLocalFileChangesOptions): CollaborativeFileChangePlan;
export declare function planLocalFileChanges(baselineText: string, workingText: string, options?: PlanLocalFileChangesOptions): LocalFileChangePlan;
