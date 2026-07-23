import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PersistentChromeInput {
  cdpUrl?: string;
  executable?: string;
  profileDirectory: string;
  startUrl?: string;
  timeoutMs?: number;
}

export interface PersistentChromeOutput {
  cdpUrl: string;
  executable: string;
  profileDirectory: string;
  reused: boolean;
}

export function defaultCdpUrl(): string {
  return process.env.OVERLEAF_BROWSER_CDP || 'http://127.0.0.1:9222';
}

export function cdpPort(cdpUrl: string): number {
  const url = new URL(cdpUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('OVERLEAF_BROWSER_CDP must use http://127.0.0.1 or http://localhost.');
  }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('OVERLEAF_BROWSER_CDP contains an invalid port.');
  }
  return port;
}

export function findChromeExecutable(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.OVERLEAF_BROWSER_EXECUTABLE,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : undefined,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Google Chrome was not found. Set OVERLEAF_BROWSER_EXECUTABLE explicitly.');
  }
  return path.resolve(found);
}

async function cdpReady(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/json/version', cdpUrl), {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function openCdpTab(cdpUrl: string, startUrl: string): Promise<void> {
  const endpoint = new URL('/json/new', cdpUrl);
  endpoint.search = startUrl;
  await fetch(endpoint, { method: 'PUT', signal: AbortSignal.timeout(3000) }).catch(() => undefined);
}

async function activateExistingOverleafTab(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/json/list', cdpUrl), {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const targets = await response.json() as Array<{ id?: string; type?: string; url?: string }>;
    const target = targets.find((candidate) => (
      candidate.type === 'page'
      && typeof candidate.id === 'string'
      && typeof candidate.url === 'string'
      && candidate.url.includes('overleaf.com')
    ));
    if (!target?.id) return false;
    await fetch(new URL(`/json/activate/${target.id}`, cdpUrl), {
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

export async function ensurePersistentChrome(
  input: PersistentChromeInput,
): Promise<PersistentChromeOutput> {
  const cdpUrl = input.cdpUrl || defaultCdpUrl();
  const port = cdpPort(cdpUrl);
  const executable = findChromeExecutable(input.executable);
  const profileDirectory = path.resolve(input.profileDirectory);
  const startUrl = input.startUrl || 'https://www.overleaf.com/login';

  if (await cdpReady(cdpUrl)) {
    if (!await activateExistingOverleafTab(cdpUrl)) {
      await openCdpTab(cdpUrl, startUrl);
    }
    return { cdpUrl, executable, profileDirectory, reused: true };
  }

  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    startUrl,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  const deadline = Date.now() + (input.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (await cdpReady(cdpUrl)) {
      return { cdpUrl, executable, profileDirectory, reused: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Chrome started but ${cdpUrl} did not become available. Close Chrome using this profile and retry.`,
  );
}

export function defaultPersistentProfileDirectory(): string {
  return process.env.OVERLEAF_BROWSER_PROFILE || path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'overleaf-tracked-changes-mcp',
    'browser-profile',
  );
}
