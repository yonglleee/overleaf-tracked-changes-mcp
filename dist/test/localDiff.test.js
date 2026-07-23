import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listLocalChanges, planCollaborativeFileChanges, planLocalFileChanges, } from '../src/localDiff.js';
function applyPlannedEdits(baseline, edits) {
    return edits.reduceRight((text, edit) => {
        const index = text.indexOf(edit.expectedText);
        assert.notEqual(index, -1);
        return text.slice(0, index) + edit.replacementText + text.slice(index + edit.expectedText.length);
    }, baseline);
}
test('planLocalFileChanges creates anchored hunks that reconstruct the working file', () => {
    const baseline = 'Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
    const working = 'Title\n\nImproved first paragraph.\n\nSecond paragraph.\nNew conclusion.\n';
    const plan = planLocalFileChanges(baseline, working, { contextLines: 1 });
    assert.equal(plan.ok, true);
    assert.equal(plan.changed, true);
    assert.equal(applyPlannedEdits(baseline, plan.edits), working);
});
test('planLocalFileChanges widens context until repeated anchors are unique', () => {
    const baseline = 'Section A\nRepeated line.\nEnd A\n\nSection B\nRepeated line.\nEnd B\n';
    const working = 'Section A\nRepeated line.\nEnd A\n\nSection B\nImproved line.\nEnd B\n';
    const plan = planLocalFileChanges(baseline, working, { contextLines: 1, maxContextLines: 5 });
    assert.equal(plan.ok, true);
    assert.equal(plan.edits.length, 1);
    assert.equal(applyPlannedEdits(baseline, plan.edits), working);
});
test('planLocalFileChanges ignores CRLF-only changes', () => {
    const plan = planLocalFileChanges('one\r\ntwo\r\n', 'one\ntwo\n');
    assert.equal(plan.ok, true);
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.edits, []);
});
test('planLocalFileChanges blocks a new file with no baseline anchor', () => {
    const plan = planLocalFileChanges('', 'new content\n');
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'empty_baseline_cannot_anchor');
});
test('planCollaborativeFileChanges rebases a local paragraph around an unrelated remote paragraph', () => {
    const baseline = 'Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
    const working = 'Title\n\nImproved first paragraph.\n\nSecond paragraph.\n';
    const remote = 'Title\n\nFirst paragraph.\n\nExpanded second paragraph.\n';
    const plan = planCollaborativeFileChanges(baseline, working, remote);
    assert.equal(plan.ok, true);
    assert.equal(plan.remoteChanged, true);
    assert.equal(plan.safeChangeCount, 1);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(applyPlannedEdits(remote, plan.edits), 'Title\n\nImproved first paragraph.\n\nExpanded second paragraph.\n');
});
test('planCollaborativeFileChanges merges different words in the same paragraph', () => {
    const baseline = 'The model is fast and accurate.\n';
    const working = 'The model is very fast and accurate.\n';
    const remote = 'The model is fast and highly accurate.\n';
    const plan = planCollaborativeFileChanges(baseline, working, remote);
    assert.equal(plan.ok, true);
    assert.equal(plan.safeChangeCount, 1);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(applyPlannedEdits(remote, plan.edits), 'The model is very fast and highly accurate.\n');
});
test('planCollaborativeFileChanges blocks different edits to the same token', () => {
    const baseline = 'Accuracy is 80 percent.\n';
    const working = 'Accuracy is 90 percent.\n';
    const remote = 'Accuracy is 85 percent.\n';
    const plan = planCollaborativeFileChanges(baseline, working, remote);
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'conflicts_require_resolution');
    assert.equal(plan.safeChangeCount, 0);
    assert.equal(plan.conflicts.length, 1);
});
test('planCollaborativeFileChanges recognizes a local edit already present remotely', () => {
    const baseline = 'Original sentence.\n';
    const working = 'Improved sentence.\n';
    const remote = 'Improved sentence.\n';
    const plan = planCollaborativeFileChanges(baseline, working, remote);
    assert.equal(plan.ok, true);
    assert.equal(plan.safeChangeCount, 0);
    assert.equal(plan.alreadyAppliedCount, 1);
    assert.equal(plan.conflicts.length, 0);
});
test('planCollaborativeFileChanges separates safe edits from a true conflict', () => {
    const baseline = 'Accuracy is 80 percent. Runtime is fast.\n';
    const working = 'Accuracy is 90 percent. Runtime is very fast.\n';
    const remote = 'Accuracy is 85 percent. Runtime is fast.\n';
    const plan = planCollaborativeFileChanges(baseline, working, remote);
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'conflicts_require_resolution');
    assert.equal(plan.safeChangeCount, 1);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(applyPlannedEdits(remote, plan.edits), 'Accuracy is 85 percent. Runtime is very fast.\n');
});
test('listLocalChanges separates modified files from additions and deletions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-local-diff-test-'));
    const baseline = path.join(root, 'baseline');
    const working = path.join(root, 'working');
    await fs.mkdir(baseline);
    await fs.mkdir(working);
    try {
        await Promise.all([
            fs.writeFile(path.join(baseline, 'manuscript.tex'), 'old\n'),
            fs.writeFile(path.join(working, 'manuscript.tex'), 'new\n'),
            fs.writeFile(path.join(baseline, 'deleted.tex'), 'deleted\n'),
            fs.writeFile(path.join(working, 'added.tex'), 'added\n'),
            fs.writeFile(path.join(baseline, 'same.bib'), 'same\r\n'),
            fs.writeFile(path.join(working, 'same.bib'), 'same\n'),
        ]);
        assert.deepEqual(await listLocalChanges(baseline, working), {
            modified: ['manuscript.tex'],
            added: ['added.tex'],
            deleted: ['deleted.tex'],
            skipped: [],
            ignored: [],
        });
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('listLocalChanges ignores generated LaTeX artifacts but preserves tracked bbl files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-local-artifacts-test-'));
    const baseline = path.join(root, 'baseline');
    const working = path.join(root, 'working');
    await fs.mkdir(baseline);
    await fs.mkdir(working);
    try {
        await Promise.all([
            fs.writeFile(path.join(working, 'manuscript.aux'), 'generated\n'),
            fs.writeFile(path.join(working, 'manuscript.log'), 'generated\n'),
            fs.writeFile(path.join(working, 'manuscript.synctex.gz'), 'generated\n'),
            fs.writeFile(path.join(working, 'manuscript.bbl'), 'new generated bbl\n'),
            fs.writeFile(path.join(baseline, 'submission.bbl'), 'old bbl\n'),
            fs.writeFile(path.join(working, 'submission.bbl'), 'updated bbl\n'),
        ]);
        assert.deepEqual(await listLocalChanges(baseline, working), {
            modified: ['submission.bbl'],
            added: [],
            deleted: [],
            skipped: [],
            ignored: [
                { path: 'manuscript.aux', reason: 'latex_build_artifact' },
                { path: 'manuscript.bbl', reason: 'latex_build_artifact' },
                { path: 'manuscript.log', reason: 'latex_build_artifact' },
                { path: 'manuscript.synctex.gz', reason: 'latex_build_artifact' },
            ],
        });
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=localDiff.test.js.map