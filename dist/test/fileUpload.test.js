import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearUploadPlanCache, planUploadFile, prepareUploadFile, } from '../src/fileUpload.js';
test.beforeEach(() => clearUploadPlanCache());
test('planUploadFile prepares a binary asset without browser access', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-upload-plan-'));
    try {
        await fs.writeFile(path.join(root, 'figure.pdf'), Buffer.from('%PDF'));
        const plan = await planUploadFile({
            localRoot: root,
            localPath: 'figure.pdf',
            remotePath: 'Figures/figure.pdf',
        });
        assert.equal(plan.remoteFolder, 'Figures');
        assert.equal(plan.fileName, 'figure.pdf');
        assert.equal(plan.bytes, 4);
        assert.equal(plan.mimeType, 'application/pdf');
        assert.equal(plan.sha256.length, 64);
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('prepareUploadFile caches dry-run metadata and reuses it for formal upload', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-upload-cache-'));
    try {
        const contents = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        await fs.writeFile(path.join(root, 'figure.png'), contents);
        const dryRun = await prepareUploadFile({
            localRoot: root,
            localPath: 'figure.png',
            remotePath: 'Figures/figure.png',
        });
        assert.equal(dryRun.cacheStatus, 'miss');
        assert.equal(dryRun.buffer, undefined);
        const formal = await prepareUploadFile({
            localRoot: root,
            localPath: 'figure.png',
            remotePath: 'Figures/figure.png',
            includeBuffer: true,
        });
        assert.equal(formal.cacheStatus, 'hit');
        assert.deepEqual(formal.buffer, contents);
        assert.equal(formal.plan.sha256, dryRun.plan.sha256);
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('prepareUploadFile invalidates a cached plan after the file changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-upload-refresh-'));
    try {
        const filePath = path.join(root, 'figure.png');
        await fs.writeFile(filePath, Buffer.from('first'));
        const first = await prepareUploadFile({ localRoot: root, localPath: 'figure.png' });
        await fs.writeFile(filePath, Buffer.from('second-version'));
        const refreshed = await prepareUploadFile({ localRoot: root, localPath: 'figure.png' });
        assert.equal(refreshed.cacheStatus, 'refresh');
        assert.notEqual(refreshed.plan.sha256, first.plan.sha256);
        assert.equal(refreshed.plan.bytes, 14);
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('planUploadFile rejects tracked text files and escaping paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-upload-block-'));
    try {
        await fs.writeFile(path.join(root, 'manuscript.tex'), 'Text\n');
        await assert.rejects(() => planUploadFile({
            localRoot: root,
            localPath: 'manuscript.tex',
        }), /Tracked text files cannot be uploaded directly/);
        await assert.rejects(() => planUploadFile({
            localRoot: root,
            localPath: 'manuscript.tex',
            remotePath: 'renamed.png',
        }), /Tracked text files cannot be uploaded directly/);
        await assert.rejects(() => planUploadFile({
            localRoot: root,
            localPath: '../outside.png',
        }), /Path escapes local root/);
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=fileUpload.test.js.map