import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_EXCLUDES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  '__pycache__',
  '.DS_Store',
]);

const DEFAULT_TEXT_EXTENSIONS = new Set([
  '.tex',
  '.bib',
  '.sty',
  '.cls',
  '.bst',
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
]);

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
  bytes?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export function resolveLocalRoot(rootArg?: string): string {
  return path.resolve(rootArg || process.env.OVERLEAF_MCP_LOCAL_ROOT || process.cwd());
}

export function resolveInsideRoot(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes local root: ${relativePath}`);
  }
  return resolved;
}

export async function readLocalFile(root: string, relativePath: string, maxBytes = 200_000): Promise<string> {
  const filePath = resolveInsideRoot(root, relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${relativePath}`);
  if (stat.size > maxBytes) {
    throw new Error(`File too large (${stat.size} bytes > ${maxBytes}): ${relativePath}`);
  }
  return fs.readFile(filePath, 'utf8');
}

export async function readProjectTree(root: string, maxEntries = 800): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (entries.length >= maxEntries) return;
    const dirents = await fs.readdir(absDir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (entries.length >= maxEntries) return;
      if (DEFAULT_EXCLUDES.has(dirent.name)) continue;

      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const abs = path.join(absDir, dirent.name);
      if (dirent.isDirectory()) {
        entries.push({ path: rel, type: 'dir' });
        await walk(abs, rel);
      } else if (dirent.isFile()) {
        const stat = await fs.stat(abs);
        entries.push({ path: rel, type: 'file', bytes: stat.size });
      }
    }
  }

  await walk(path.resolve(root), '');
  return entries;
}

export async function searchProject(root: string, query: string, maxMatches = 80): Promise<SearchMatch[]> {
  if (!query) throw new Error('query is required');
  const matches: SearchMatch[] = [];
  const tree = await readProjectTree(root, 5000);

  for (const entry of tree) {
    if (matches.length >= maxMatches) break;
    if (entry.type !== 'file') continue;
    const ext = path.extname(entry.path).toLowerCase();
    if (!DEFAULT_TEXT_EXTENSIONS.has(ext)) continue;
    if ((entry.bytes || 0) > 500_000) continue;

    let content: string;
    try {
      content = await readLocalFile(root, entry.path, 500_000);
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const column = lines[i].indexOf(query);
      if (column >= 0) {
        matches.push({
          path: entry.path,
          line: i + 1,
          column: column + 1,
          text: lines[i].trim(),
        });
        if (matches.length >= maxMatches) break;
      }
    }
  }

  return matches;
}