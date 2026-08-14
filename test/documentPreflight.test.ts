import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectLatexStructure } from '../src/documentPreflight.js';

test('inspectLatexStructure accepts balanced LaTeX', () => {
  const result = inspectLatexStructure('\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n');
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('inspectLatexStructure reports unmatched braces and environments', () => {
  const result = inspectLatexStructure('\\documentclass{article}\n\\begin{document}\nText {\n\\end{figure}\n');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Unmatched opening brace')));
  assert.ok(result.errors.some((error) => error.includes('Environment mismatch')));
});
