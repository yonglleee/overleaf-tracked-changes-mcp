import { diffWordsWithSpace, structuredPatch } from 'diff';
import {
  isSupportedTextFile,
  readLocalFile,
  readProjectTree,
} from './localProject.js';
import { countOccurrences } from './textPatch.js';

export interface LocalTreeChanges {
  modified: string[];
  added: string[];
  deleted: string[];
  skipped: Array<{ path: string; reason: 'unsupported_type' | 'too_large' }>;
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

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function listLocalChanges(
  baselineRoot: string,
  workingRoot: string,
  maxEntries = 5000,
  maxBytes = 2_000_000,
): Promise<LocalTreeChanges> {
  const [baselineTree, workingTree] = await Promise.all([
    readProjectTree(baselineRoot, maxEntries),
    readProjectTree(workingRoot, maxEntries),
  ]);
  const baselineFiles = new Map(
    baselineTree.filter((entry) => entry.type === 'file').map((entry) => [entry.path, entry]),
  );
  const workingFiles = new Map(
    workingTree.filter((entry) => entry.type === 'file').map((entry) => [entry.path, entry]),
  );
  const paths = Array.from(new Set([...baselineFiles.keys(), ...workingFiles.keys()])).sort();
  const result: LocalTreeChanges = { modified: [], added: [], deleted: [], skipped: [] };

  for (const filePath of paths) {
    const baseline = baselineFiles.get(filePath);
    const working = workingFiles.get(filePath);
    if (!baseline) {
      result.added.push(filePath);
      continue;
    }
    if (!working) {
      result.deleted.push(filePath);
      continue;
    }
    if (!isSupportedTextFile(filePath)) {
      if (baseline.bytes !== working.bytes) {
        result.skipped.push({ path: filePath, reason: 'unsupported_type' });
      }
      continue;
    }
    if ((baseline.bytes || 0) > maxBytes || (working.bytes || 0) > maxBytes) {
      result.skipped.push({ path: filePath, reason: 'too_large' });
      continue;
    }
    const [baselineText, workingText] = await Promise.all([
      readLocalFile(baselineRoot, filePath, maxBytes),
      readLocalFile(workingRoot, filePath, maxBytes),
    ]);
    if (normalizeLineEndings(baselineText) !== normalizeLineEndings(workingText)) {
      result.modified.push(filePath);
    }
  }

  return result;
}

function splitLinesWithEndings(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function createAtomicTextEdits(base: string, target: string): AtomicTextEdit[] {
  const edits: AtomicTextEdit[] = [];
  let baseOffset = 0;
  let pendingStart: number | null = null;
  let originalText = '';
  let replacementText = '';

  const flush = () => {
    if (pendingStart === null) return;
    edits.push({
      baseStart: pendingStart,
      baseEnd: pendingStart + originalText.length,
      originalText,
      replacementText,
    });
    pendingStart = null;
    originalText = '';
    replacementText = '';
  };

  for (const part of diffWordsWithSpace(base, target)) {
    if (!part.added && !part.removed) {
      flush();
      baseOffset += part.value.length;
      continue;
    }
    if (pendingStart === null) pendingStart = baseOffset;
    if (part.removed) {
      originalText += part.value;
      baseOffset += part.value.length;
    } else {
      replacementText += part.value;
    }
  }
  flush();
  return edits.reduce<AtomicTextEdit[]>((merged, edit) => {
    const previous = merged.at(-1);
    if (previous) {
      const gap = base.slice(previous.baseEnd, edit.baseStart);
      if (gap.length > 0 && !gap.includes('\n') && /^\s+$/.test(gap)) {
        previous.baseEnd = edit.baseEnd;
        previous.originalText += gap + edit.originalText;
        previous.replacementText += gap + edit.replacementText;
        return merged;
      }
    }
    merged.push({ ...edit });
    return merged;
  }, []);
}

function sameAtomicEdit(left: AtomicTextEdit, right: AtomicTextEdit): boolean {
  return left.baseStart === right.baseStart
    && left.baseEnd === right.baseEnd
    && left.replacementText === right.replacementText;
}

function atomicEditsOverlap(left: AtomicTextEdit, right: AtomicTextEdit): boolean {
  const leftInsertion = left.baseStart === left.baseEnd;
  const rightInsertion = right.baseStart === right.baseEnd;
  if (leftInsertion && rightInsertion) return left.baseStart === right.baseStart;
  if (leftInsertion) return right.baseStart < left.baseStart && left.baseStart < right.baseEnd;
  if (rightInsertion) return left.baseStart < right.baseStart && right.baseStart < left.baseEnd;
  return Math.max(left.baseStart, right.baseStart) < Math.min(left.baseEnd, right.baseEnd);
}

function mapBaseOffsetToRemote(
  baseOffset: number,
  remoteEdits: AtomicTextEdit[],
  includeInsertionAtOffset: boolean,
): number {
  let mapped = baseOffset;
  for (const edit of remoteEdits) {
    const insertion = edit.baseStart === edit.baseEnd;
    if (insertion) {
      if (edit.baseStart < baseOffset || (includeInsertionAtOffset && edit.baseStart === baseOffset)) {
        mapped += edit.replacementText.length;
      }
    } else if (edit.baseEnd <= baseOffset) {
      mapped += edit.replacementText.length - edit.originalText.length;
    }
  }
  return mapped;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function lineEnd(text: string, offset: number): number {
  const newline = text.indexOf('\n', offset);
  return newline < 0 ? text.length : newline + 1;
}

function previousLineStart(text: string, offset: number): number {
  if (offset <= 0) return 0;
  return text.lastIndexOf('\n', Math.max(0, offset - 2)) + 1;
}

function nextLineEnd(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  const newline = text.indexOf('\n', offset);
  return newline < 0 ? text.length : newline + 1;
}

function anchorRemoteEdit(
  remote: string,
  remoteStart: number,
  remoteEnd: number,
  replacementText: string,
  maxContextLines: number,
): LocalFilePlannedEdit | null {
  const direct = remote.slice(remoteStart, remoteEnd);
  if (direct && countOccurrences(remote, direct) === 1) {
    return {
      expectedText: direct,
      replacementText,
      oldStart: remoteStart,
      oldLines: 0,
      newStart: remoteStart,
      newLines: 0,
    };
  }

  let left = lineStart(remote, remoteStart);
  let right = lineEnd(remote, remoteEnd);
  for (let context = 0; context <= maxContextLines; context += 1) {
    const expectedText = remote.slice(left, right);
    if (expectedText && countOccurrences(remote, expectedText) === 1) {
      return {
        expectedText,
        replacementText: remote.slice(left, remoteStart)
          + replacementText
          + remote.slice(remoteEnd, right),
        oldStart: remoteStart,
        oldLines: 0,
        newStart: remoteStart,
        newLines: 0,
      };
    }
    const nextLeft = previousLineStart(remote, left);
    const nextRight = nextLineEnd(remote, right);
    if (nextLeft === left && nextRight === right) break;
    left = nextLeft;
    right = nextRight;
  }
  return null;
}

export function planCollaborativeFileChanges(
  baselineText: string,
  workingText: string,
  remoteText: string,
  options: PlanLocalFileChangesOptions = {},
): CollaborativeFileChangePlan {
  const baseline = normalizeLineEndings(baselineText);
  const working = normalizeLineEndings(workingText);
  const remote = normalizeLineEndings(remoteText);
  const localEdits = createAtomicTextEdits(baseline, working);
  const remoteEdits = createAtomicTextEdits(baseline, remote);
  const maxEdits = options.maxEdits ?? 40;
  const maxContextLines = Math.max(1, Math.min(100, options.maxContextLines ?? 20));
  const conflicts: CollaborativeConflict[] = [];
  const safeEdits: LocalFilePlannedEdit[] = [];
  let alreadyAppliedCount = 0;
  let anchorFailed = false;

  for (const local of localEdits) {
    const overlapping = remoteEdits.filter((remoteEdit) => atomicEditsOverlap(local, remoteEdit));
    const alreadyApplied = overlapping.find((remoteEdit) => sameAtomicEdit(local, remoteEdit));
    if (alreadyApplied && overlapping.length === 1) {
      alreadyAppliedCount += 1;
      continue;
    }
    if (overlapping.length > 0) {
      for (const remoteEdit of overlapping) {
        conflicts.push({ reason: 'overlapping_change', local, remote: remoteEdit });
      }
      continue;
    }

    const remoteStart = mapBaseOffsetToRemote(local.baseStart, remoteEdits, true);
    const remoteEnd = mapBaseOffsetToRemote(local.baseEnd, remoteEdits, false);
    if (remote.slice(remoteStart, remoteEnd) !== local.originalText) {
      conflicts.push({
        reason: 'remote_mapping_mismatch',
        local,
        remote: {
          baseStart: local.baseStart,
          baseEnd: local.baseEnd,
          originalText: local.originalText,
          replacementText: remote.slice(remoteStart, remoteEnd),
        },
      });
      continue;
    }

    const anchored = anchorRemoteEdit(
      remote,
      remoteStart,
      remoteEnd,
      local.replacementText,
      maxContextLines,
    );
    if (!anchored) {
      anchorFailed = true;
      continue;
    }
    safeEdits.push(anchored);
  }

  let reason: CollaborativeFileChangePlan['reason'];
  if (anchorFailed) reason = 'remote_anchor_not_unique';
  else if (safeEdits.length > maxEdits) reason = 'too_many_safe_edits';
  else if (conflicts.length > 0) reason = 'conflicts_require_resolution';
  const blocked = reason !== undefined;

  return {
    ok: !blocked,
    changed: localEdits.length > 0,
    remoteChanged: remoteEdits.length > 0,
    blocked: blocked || undefined,
    reason,
    localChangeCount: localEdits.length,
    remoteChangeCount: remoteEdits.length,
    safeChangeCount: safeEdits.length,
    alreadyAppliedCount,
    conflicts,
    edits: safeEdits.slice(0, maxEdits),
  };
}

function createEdits(baseline: string, working: string, contextLines: number): LocalFilePlannedEdit[] {
  const patch = structuredPatch(
    'baseline',
    'working',
    baseline,
    working,
    undefined,
    undefined,
    { context: contextLines },
  );
  const baselineLines = splitLinesWithEndings(baseline);
  const workingLines = splitLinesWithEndings(working);

  return patch.hunks.map((hunk) => {
    const oldIndex = Math.max(0, hunk.oldStart - 1);
    const newIndex = Math.max(0, hunk.newStart - 1);
    return {
      expectedText: baselineLines.slice(oldIndex, oldIndex + hunk.oldLines).join(''),
      replacementText: workingLines.slice(newIndex, newIndex + hunk.newLines).join(''),
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
    };
  });
}

export function planLocalFileChanges(
  baselineText: string,
  workingText: string,
  options: PlanLocalFileChangesOptions = {},
): LocalFileChangePlan {
  const baseline = normalizeLineEndings(baselineText);
  const working = normalizeLineEndings(workingText);
  const baselineBytes = Buffer.byteLength(baseline);
  const workingBytes = Buffer.byteLength(working);
  const initialContext = Math.max(1, Math.min(20, options.contextLines ?? 3));
  const maxContext = Math.max(initialContext, Math.min(100, options.maxContextLines ?? 20));
  const maxEdits = options.maxEdits ?? 40;

  if (baseline === working) {
    return {
      ok: true,
      changed: false,
      baselineBytes,
      workingBytes,
      contextLines: initialContext,
      edits: [],
    };
  }
  if (!baseline) {
    return {
      ok: false,
      changed: true,
      blocked: true,
      reason: 'empty_baseline_cannot_anchor',
      baselineBytes,
      workingBytes,
      contextLines: initialContext,
      edits: [],
    };
  }

  let edits: LocalFilePlannedEdit[] = [];
  for (let contextLines = initialContext; contextLines <= maxContext; contextLines += 1) {
    edits = createEdits(baseline, working, contextLines);
    if (edits.length > maxEdits) continue;
    const validAnchors = edits.every((edit) => (
      edit.expectedText.length > 0 && countOccurrences(baseline, edit.expectedText) === 1
    ));
    if (validAnchors) {
      return {
        ok: true,
        changed: true,
        baselineBytes,
        workingBytes,
        contextLines,
        edits,
      };
    }
  }

  return {
    ok: false,
    changed: true,
    blocked: true,
    reason: edits.length > maxEdits ? 'too_many_hunks' : 'non_unique_local_anchor',
    baselineBytes,
    workingBytes,
    contextLines: maxContext,
    edits,
  };
}
