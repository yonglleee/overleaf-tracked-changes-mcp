import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { isLatexBuildArtifact, isSupportedTextFile, resolveInsideRoot, } from './localProject.js';
const uploadPlanCache = new Map();
const MAX_UPLOAD_PLAN_CACHE_ENTRIES = 256;
const MIME_TYPES = {
    '.eps': 'application/postscript',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
};
function normalizeRemotePath(remotePath) {
    const normalized = remotePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = normalized.split('/');
    if (normalized.length === 0
        || normalized.startsWith('/')
        || /^[A-Za-z]:/.test(normalized)
        || parts.some((part) => part === '' || part === '.' || part === '..')) {
        throw new Error(`Invalid remote_path: ${remotePath}`);
    }
    return normalized;
}
async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
function fingerprint(stat) {
    return {
        size: Number(stat.size),
        mtimeMs: Number(stat.mtimeMs),
        ino: Number(stat.ino),
    };
}
function sameFingerprint(left, right) {
    return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino;
}
function cacheUploadPlan(key, value) {
    uploadPlanCache.delete(key);
    uploadPlanCache.set(key, value);
    if (uploadPlanCache.size > MAX_UPLOAD_PLAN_CACHE_ENTRIES) {
        const oldestKey = uploadPlanCache.keys().next().value;
        if (oldestKey)
            uploadPlanCache.delete(oldestKey);
    }
}
export function clearUploadPlanCache() {
    uploadPlanCache.clear();
}
async function readStableBuffer(absolutePath, expected) {
    const buffer = await fs.readFile(absolutePath);
    const afterRead = fingerprint(await fs.stat(absolutePath));
    if (!sameFingerprint(expected, afterRead) || buffer.byteLength !== afterRead.size) {
        throw new Error(`Upload file changed while it was being read: ${absolutePath}`);
    }
    return buffer;
}
export async function prepareUploadFile(input) {
    const absolutePath = resolveInsideRoot(input.localRoot, input.localPath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile())
        throw new Error(`Not a file: ${input.localPath}`);
    const maxBytes = input.maxBytes ?? 100 * 1024 * 1024;
    if (stat.size > maxBytes) {
        throw new Error(`Upload file is too large (${stat.size} bytes > ${maxBytes}).`);
    }
    const remotePath = normalizeRemotePath(input.remotePath || path.basename(input.localPath));
    if (isSupportedTextFile(input.localPath) || isSupportedTextFile(remotePath)) {
        throw new Error(`Tracked text files cannot be uploaded directly: ${remotePath}`);
    }
    if (isLatexBuildArtifact(input.localPath) || isLatexBuildArtifact(remotePath)) {
        throw new Error(`Generated LaTeX artifacts cannot be uploaded: ${remotePath}`);
    }
    const currentFingerprint = fingerprint(stat);
    const cacheKey = JSON.stringify([absolutePath, remotePath, maxBytes]);
    const cached = uploadPlanCache.get(cacheKey);
    const cacheStatus = cached
        ? (sameFingerprint(cached.fingerprint, currentFingerprint) ? 'hit' : 'refresh')
        : 'miss';
    let buffer;
    if (input.includeBuffer) {
        buffer = await readStableBuffer(absolutePath, currentFingerprint);
    }
    if (cacheStatus === 'hit') {
        return { plan: cached.plan, cacheStatus, buffer };
    }
    const sha256 = buffer
        ? createHash('sha256').update(buffer).digest('hex')
        : await sha256File(absolutePath);
    if (!buffer) {
        const afterRead = fingerprint(await fs.stat(absolutePath));
        if (!sameFingerprint(currentFingerprint, afterRead)) {
            throw new Error(`Upload file changed while it was being read: ${absolutePath}`);
        }
    }
    const plan = {
        ok: true,
        localPath: absolutePath,
        remotePath,
        remoteFolder: path.posix.dirname(remotePath) === '.' ? '' : path.posix.dirname(remotePath),
        fileName: path.posix.basename(remotePath),
        bytes: stat.size,
        sha256,
        mimeType: MIME_TYPES[path.extname(remotePath).toLowerCase()] || 'application/octet-stream',
    };
    cacheUploadPlan(cacheKey, { fingerprint: currentFingerprint, plan });
    return { plan, cacheStatus, buffer };
}
export async function planUploadFile(input) {
    return (await prepareUploadFile(input)).plan;
}
//# sourceMappingURL=fileUpload.js.map