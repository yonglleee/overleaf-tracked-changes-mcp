import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  isLatexBuildArtifact,
  isSupportedTextFile,
  resolveInsideRoot,
} from './localProject.js';

export interface UploadFilePlan {
  ok: true;
  localPath: string;
  remotePath: string;
  remoteFolder: string;
  fileName: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export type UploadPlanCacheStatus = 'miss' | 'hit' | 'refresh';

export interface PreparedUploadFile {
  plan: UploadFilePlan;
  cacheStatus: UploadPlanCacheStatus;
  buffer?: Buffer;
}

interface UploadFileFingerprint {
  size: number;
  mtimeMs: number;
  ino: number;
}

interface CachedUploadPlan {
  fingerprint: UploadFileFingerprint;
  plan: UploadFilePlan;
}

const uploadPlanCache = new Map<string, CachedUploadPlan>();
const MAX_UPLOAD_PLAN_CACHE_ENTRIES = 256;

const MIME_TYPES: Record<string, string> = {
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

function normalizeRemotePath(remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid remote_path: ${remotePath}`);
  }
  return normalized;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function fingerprint(stat: Awaited<ReturnType<typeof fs.stat>>): UploadFileFingerprint {
  return {
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ino: Number(stat.ino),
  };
}

function sameFingerprint(left: UploadFileFingerprint, right: UploadFileFingerprint): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino;
}

function cacheUploadPlan(key: string, value: CachedUploadPlan): void {
  uploadPlanCache.delete(key);
  uploadPlanCache.set(key, value);
  if (uploadPlanCache.size > MAX_UPLOAD_PLAN_CACHE_ENTRIES) {
    const oldestKey = uploadPlanCache.keys().next().value as string | undefined;
    if (oldestKey) uploadPlanCache.delete(oldestKey);
  }
}

export function clearUploadPlanCache(): void {
  uploadPlanCache.clear();
}

async function readStableBuffer(
  absolutePath: string,
  expected: UploadFileFingerprint,
): Promise<Buffer> {
  const buffer = await fs.readFile(absolutePath);
  const afterRead = fingerprint(await fs.stat(absolutePath));
  if (!sameFingerprint(expected, afterRead) || buffer.byteLength !== afterRead.size) {
    throw new Error(`Upload file changed while it was being read: ${absolutePath}`);
  }
  return buffer;
}

export async function prepareUploadFile(input: {
  localRoot: string;
  localPath: string;
  remotePath?: string;
  maxBytes?: number;
  includeBuffer?: boolean;
}): Promise<PreparedUploadFile> {
  const absolutePath = resolveInsideRoot(input.localRoot, input.localPath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${input.localPath}`);
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
  const cacheStatus: UploadPlanCacheStatus = cached
    ? (sameFingerprint(cached.fingerprint, currentFingerprint) ? 'hit' : 'refresh')
    : 'miss';

  let buffer: Buffer | undefined;
  if (input.includeBuffer) {
    buffer = await readStableBuffer(absolutePath, currentFingerprint);
  }

  if (cacheStatus === 'hit') {
    return { plan: cached!.plan, cacheStatus, buffer };
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
  const plan: UploadFilePlan = {
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

export async function planUploadFile(input: {
  localRoot: string;
  localPath: string;
  remotePath?: string;
  maxBytes?: number;
}): Promise<UploadFilePlan> {
  return (await prepareUploadFile(input)).plan;
}
