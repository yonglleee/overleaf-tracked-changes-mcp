export interface ReplacementPlan {
  ok: true;
  from: number;
  to: number;
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

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) return count;
    count += 1;
    index = found + needle.length;
  }
}

export function planExactReplacement(
  documentText: string,
  options: PlanExactReplacementOptions,
): PlanExactReplacementResult {
  const {
    expectedText,
    replacementText,
    maxReplacementChars = 12000,
    previewChars = 160,
  } = options;

  if (!expectedText) {
    return { ok: false, reason: 'expected_text_not_found', count: 0 };
  }

  if (replacementText.length > maxReplacementChars) {
    return {
      ok: false,
      reason: 'replacement_too_large',
      count: countOccurrences(documentText, expectedText),
    };
  }

  const first = documentText.indexOf(expectedText);
  if (first < 0) {
    return {
      ok: false,
      reason: 'expected_text_not_found',
      count: 0,
      preview: documentText.slice(0, previewChars),
    };
  }

  const second = documentText.indexOf(expectedText, first + expectedText.length);
  if (second >= 0) {
    return {
      ok: false,
      reason: 'expected_text_not_unique',
      count: 2,
      preview: documentText.slice(Math.max(0, first - previewChars), first + expectedText.length + previewChars),
    };
  }

  const from = first;
  const to = first + expectedText.length;
  return {
    ok: true,
    from,
    to,
    removedLength: expectedText.length,
    insertedLength: replacementText.length,
    beforePreview: documentText.slice(Math.max(0, from - previewChars), from),
    afterPreview: documentText.slice(to, Math.min(documentText.length, to + previewChars)),
  };
}