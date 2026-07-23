import assert from 'node:assert/strict';
import test from 'node:test';
import { countOccurrences, minimizeReplacement, planExactReplacement } from '../src/textPatch.js';

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

test('minimizeReplacement keeps common prefix and suffix out of the write', () => {
  assert.deepEqual(
    minimizeReplacement('The old sentence.', 'The improved sentence.'),
    {
      prefixLength: 4,
      suffixLength: 11,
      removedLength: 2,
      insert: 'improve',
    },
  );
});

test('planExactReplacement returns minimal UTF-16 offsets for one match', () => {
  const result = planExactReplacement('before target after', {
    expectedText: 'target',
    replacementText: 'replacement',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.matchFrom, 7);
    assert.equal(result.matchTo, 13);
    assert.equal(result.from, 7);
    assert.equal(result.to, 12);
    assert.equal(result.insert, 'replacemen');
    assert.equal(result.removedLength, 5);
    assert.equal(result.insertedLength, 10);
  }
});

test('planExactReplacement turns an anchored append into insertion only', () => {
  const result = planExactReplacement('header\nnext', {
    expectedText: 'header',
    replacementText: 'header\n% tracked note',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.matchFrom, 0);
    assert.equal(result.matchTo, 6);
    assert.equal(result.from, 6);
    assert.equal(result.to, 6);
    assert.equal(result.insert, '\n% tracked note');
    assert.equal(result.removedLength, 0);
  }
});
