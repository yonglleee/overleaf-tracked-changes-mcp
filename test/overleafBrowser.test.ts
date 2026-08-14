import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectOpenFileName,
  trackedSnapshotChanged,
} from '../src/overleafBrowser.js';

test('selectOpenFileName ignores selected navigation tabs', () => {
  assert.equal(selectOpenFileName(['description\nFile tree']), null);
});

test('selectOpenFileName extracts supported editor file labels', () => {
  assert.equal(selectOpenFileName(['description\nFile tree', 'manuscript.tex\nClose']), 'manuscript.tex');
  assert.equal(selectOpenFileName(['\u200emanuscript.tex']), 'manuscript.tex');
  assert.equal(selectOpenFileName(['sections/related-work.tex Close']), 'related-work.tex');
  assert.equal(selectOpenFileName(['sections\\appendix.bbl Close']), 'appendix.bbl');
  assert.equal(selectOpenFileName(['references.bib']), 'references.bib');
});

test('trackedSnapshotChanged detects only a new or changed tracked signal', () => {
  assert.equal(trackedSnapshotChanged(
    { count: 2, signature: 'same' },
    { count: 2, signature: 'same' },
  ), false);
  assert.equal(trackedSnapshotChanged(
    { count: 2, signature: 'same' },
    { count: 3, signature: 'same' },
  ), true);
  assert.equal(trackedSnapshotChanged(
    { count: 2, signature: 'before' },
    { count: 2, signature: 'after' },
  ), true);
});
