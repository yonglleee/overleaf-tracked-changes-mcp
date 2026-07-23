import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { defaultSnapshotName, extractProjectSnapshot, projectIdFromUrl, } from '../src/projectSnapshot.js';
test('projectIdFromUrl extracts an Overleaf project ID', () => {
    assert.equal(projectIdFromUrl('https://www.overleaf.com/project/6a5df5255f92e372a5b007dd'), '6a5df5255f92e372a5b007dd');
    assert.throws(() => projectIdFromUrl('https://example.com/project/abc'));
});
test('defaultSnapshotName is filesystem-safe', () => {
    assert.equal(defaultSnapshotName(new Date('2026-07-23T01:02:03.456Z')), 'overleaf-snapshot-2026-07-23T01-02-03-456Z');
});
test('extractProjectSnapshot creates a new immutable snapshot directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-snapshot-test-'));
    try {
        const zip = new AdmZip();
        zip.addFile('manuscript.tex', Buffer.from('\\documentclass{article}\n'));
        zip.addFile('sections/method.tex', Buffer.from('Method\n'));
        const result = await extractProjectSnapshot({
            archive: zip.toBuffer(),
            destinationRoot: root,
            snapshotName: 'baseline',
        });
        assert.equal(result.files, 2);
        assert.equal(result.extractedBytes, Buffer.byteLength('\\documentclass{article}\n') + Buffer.byteLength('Method\n'));
        assert.equal(await fs.readFile(path.join(result.destination, 'manuscript.tex'), 'utf8'), '\\documentclass{article}\n');
        await assert.rejects(() => extractProjectSnapshot({
            archive: zip.toBuffer(),
            destinationRoot: root,
            snapshotName: 'baseline',
        }), /already exists/);
        await assert.rejects(() => extractProjectSnapshot({
            archive: zip.toBuffer(),
            destinationRoot: root,
            snapshotName: 'too-large',
            maxExtractedBytes: 10,
        }), /expands beyond the limit/);
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=projectSnapshot.test.js.map