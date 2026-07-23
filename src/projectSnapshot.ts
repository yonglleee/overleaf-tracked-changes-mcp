import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

export interface ExtractProjectSnapshotInput {
  archive: Buffer;
  destinationRoot: string;
  snapshotName?: string;
  maxExtractedBytes?: number;
  maxEntries?: number;
}

export interface ProjectSnapshotOutput {
  destination: string;
  archiveBytes: number;
  extractedBytes: number;
  files: number;
  directories: number;
}

export function projectIdFromUrl(projectUrl: string): string {
  const url = new URL(projectUrl);
  if (url.hostname !== 'www.overleaf.com' && url.hostname !== 'overleaf.com') {
    throw new Error(`Not an Overleaf project URL: ${projectUrl}`);
  }
  const match = url.pathname.match(/^\/project\/([^/]+)/);
  if (!match) throw new Error(`Overleaf project ID not found in URL: ${projectUrl}`);
  return match[1];
}

export function defaultSnapshotName(now = new Date()): string {
  return `overleaf-snapshot-${now.toISOString().replace(/[:.]/g, '-')}`;
}

function resolveSnapshotDestination(destinationRoot: string, snapshotName: string): string {
  if (!snapshotName || snapshotName === '.' || snapshotName === '..') {
    throw new Error('snapshot_name must be a non-empty directory name');
  }
  if (path.isAbsolute(snapshotName) || snapshotName.includes('/') || snapshotName.includes('\\')) {
    throw new Error('snapshot_name must not contain a path');
  }
  const root = path.resolve(destinationRoot);
  const destination = path.resolve(root, snapshotName);
  if (!destination.startsWith(root + path.sep)) {
    throw new Error('Snapshot destination escapes destination_root');
  }
  return destination;
}

function inspectZipEntries(
  zip: AdmZip,
  maxExtractedBytes: number,
  maxEntries: number,
): { files: number; directories: number; extractedBytes: number } {
  let files = 0;
  let directories = 0;
  let extractedBytes = 0;
  const entries = zip.getEntries();
  if (entries.length > maxEntries) {
    throw new Error(`Overleaf archive has too many entries (${entries.length} > ${maxEntries}).`);
  }
  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (
      normalized.startsWith('/')
      || /^[A-Za-z]:/.test(normalized)
      || segments.includes('..')
    ) {
      throw new Error(`Unsafe path in Overleaf archive: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      directories += 1;
    } else {
      files += 1;
      extractedBytes += entry.header.size;
      if (extractedBytes > maxExtractedBytes) {
        throw new Error(
          `Overleaf archive expands beyond the limit (${extractedBytes} bytes > ${maxExtractedBytes}).`,
        );
      }
    }
  }
  return { files, directories, extractedBytes };
}

export async function extractProjectSnapshot(
  input: ExtractProjectSnapshotInput,
): Promise<ProjectSnapshotOutput> {
  const root = path.resolve(input.destinationRoot);
  const snapshotName = input.snapshotName || defaultSnapshotName();
  const destination = resolveSnapshotDestination(root, snapshotName);
  const maxExtractedBytes = input.maxExtractedBytes ?? 1024 * 1024 * 1024;
  const maxEntries = input.maxEntries ?? 20_000;

  await fs.mkdir(root, { recursive: true });
  try {
    await fs.access(destination);
    throw new Error(`Snapshot destination already exists: ${destination}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }

  const zip = new AdmZip(input.archive);
  const counts = inspectZipEntries(zip, maxExtractedBytes, maxEntries);
  const temporary = path.join(root, `.${snapshotName}.partial-${randomUUID()}`);
  await fs.mkdir(temporary);

  try {
    zip.extractAllTo(temporary, true);
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }

  return {
    destination,
    archiveBytes: input.archive.length,
    extractedBytes: counts.extractedBytes,
    files: counts.files,
    directories: counts.directories,
  };
}
