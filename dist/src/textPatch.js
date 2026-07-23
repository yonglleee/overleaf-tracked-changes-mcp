export function countOccurrences(haystack, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let index = 0;
    while (true) {
        const found = haystack.indexOf(needle, index);
        if (found < 0)
            return count;
        count += 1;
        index = found + needle.length;
    }
}
export function minimizeReplacement(expectedText, replacementText) {
    let prefixLength = 0;
    const prefixLimit = Math.min(expectedText.length, replacementText.length);
    while (prefixLength < prefixLimit
        && expectedText.charCodeAt(prefixLength) === replacementText.charCodeAt(prefixLength)) {
        prefixLength += 1;
    }
    let suffixLength = 0;
    const suffixLimit = Math.min(expectedText.length - prefixLength, replacementText.length - prefixLength);
    while (suffixLength < suffixLimit
        && expectedText.charCodeAt(expectedText.length - suffixLength - 1)
            === replacementText.charCodeAt(replacementText.length - suffixLength - 1)) {
        suffixLength += 1;
    }
    return {
        prefixLength,
        suffixLength,
        removedLength: expectedText.length - prefixLength - suffixLength,
        insert: replacementText.slice(prefixLength, replacementText.length - suffixLength),
    };
}
export function planExactReplacement(documentText, options) {
    const { expectedText, replacementText, maxReplacementChars = 12000, previewChars = 160, } = options;
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
    const minimized = minimizeReplacement(expectedText, replacementText);
    const matchFrom = first;
    const matchTo = first + expectedText.length;
    const from = matchFrom + minimized.prefixLength;
    const to = matchTo - minimized.suffixLength;
    return {
        ok: true,
        matchFrom,
        matchTo,
        from,
        to,
        insert: minimized.insert,
        removedLength: minimized.removedLength,
        insertedLength: minimized.insert.length,
        beforePreview: documentText.slice(Math.max(0, from - previewChars), from),
        afterPreview: documentText.slice(to, Math.min(documentText.length, to + previewChars)),
    };
}
//# sourceMappingURL=textPatch.js.map