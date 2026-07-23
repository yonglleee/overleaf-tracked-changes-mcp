import assert from 'node:assert/strict';
import test from 'node:test';
import { countOccurrences, planExactReplacement } from '../src/textPatch.js';

test('countOccurrences returns non-overlapping exact counts', () => {
  assert.equal(countOccurrences('abc abc abc', 'abc'), 3);
  assert.equal(countOccurrences('aaaa', 'aa'), 2);
  assert.equal(countOccurrences('abc', 'z'), 0);
});

test('planExactReplacement blocks when text is missing', () => {
  const result = planExactReplacement('hello world', {
    expectedText: 'goodbye',
    replacementText: 'hi',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'expected_text_not_found');
});

test('planExactReplacement blocks when text is not unique', () => {
  const result = planExactReplacement('x target y target z', {
    expectedText: 'target',
    replacementText: 'replacement',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'expected_text_not_unique');
});

test('planExactReplacement returns exact UTF-16 offsets for one match', () => {
  const result = planExactReplacement('before target after', {
    expectedText: 'target',
    replacementText: 'replacement',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.from, 7);
    assert.equal(result.to, 13);
    assert.equal(result.removedLength, 6);
    assert.equal(result.insertedLength, 11);
  }
});