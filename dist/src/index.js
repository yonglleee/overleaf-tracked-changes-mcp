#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { listLocalChanges, planCollaborativeFileChanges, planLocalFileChanges, } from './localDiff.js';
import { readLocalFile, readProjectTree, resolveLocalRoot, searchProject } from './localProject.js';
import { OverleafBrowserClient } from './overleafBrowser.js';
import { defaultCdpUrl, defaultPersistentProfileDirectory, ensurePersistentChrome, } from './persistentChrome.js';
const browserClient = new OverleafBrowserClient();
const VERSION = '0.4.0';
const tools = [
    {
        name: 'get_overleaf_status',
        description: 'Check the browser connection, login, project, open file, and Reviewing state.',
        inputSchema: {
            type: 'object',
            properties: {
                project_url: { type: 'string' },
            },
        },
    },
    {
        name: 'download_project_snapshot',
        description: 'Download the complete Overleaf project source into a new immutable local snapshot directory. Existing destinations are never overwritten.',
        inputSchema: {
            type: 'object',
            required: ['destination_root'],
            properties: {
                project_url: { type: 'string' },
                destination_root: { type: 'string', description: 'Parent directory for the new snapshot folder.' },
                snapshot_name: { type: 'string', description: 'Optional new folder name. Defaults to a timestamped name.' },
                max_archive_bytes: { type: 'number', default: 262144000 },
                max_extracted_bytes: { type: 'number', default: 1073741824 },
            },
        },
    },
    {
        name: 'open_overleaf_file',
        description: 'Open one file that is currently visible in the expanded Overleaf file tree.',
        inputSchema: {
            type: 'object',
            required: ['path'],
            properties: {
                project_url: { type: 'string' },
                path: { type: 'string' },
                ensure_reviewing: { type: 'boolean', default: false },
            },
        },
    },
    {
        name: 'ensure_reviewing',
        description: 'Switch the open Overleaf editor from Editing to Reviewing and verify the resulting state.',
        inputSchema: {
            type: 'object',
            properties: {
                project_url: { type: 'string' },
            },
        },
    },
    {
        name: 'list_local_changes',
        description: 'Compare an immutable baseline tree with a local working tree and list modified, added, deleted, or skipped files. This does not access Overleaf.',
        inputSchema: {
            type: 'object',
            required: ['baseline_root', 'working_root'],
            properties: {
                baseline_root: { type: 'string' },
                working_root: { type: 'string' },
                max_entries: { type: 'number', default: 5000 },
                max_bytes: { type: 'number', default: 2000000 },
            },
        },
    },
    {
        name: 'plan_local_file_changes',
        description: 'Compare one immutable baseline file with its local working copy and create small unique anchored hunks. This does not access Overleaf.',
        inputSchema: {
            type: 'object',
            required: ['baseline_root', 'working_root', 'path'],
            properties: {
                baseline_root: { type: 'string' },
                working_root: { type: 'string' },
                path: { type: 'string' },
                context_lines: { type: 'number', default: 3 },
                max_context_lines: { type: 'number', default: 20 },
                max_edits: { type: 'number', default: 40 },
                max_bytes: { type: 'number', default: 2000000 },
            },
        },
    },
    {
        name: 'sync_local_file_tracked',
        description: 'Three-way merge baseline, local working copy, and current Overleaf text, then replay safe local changes as tracked suggestions. Defaults to dry-run and never uploads the whole file.',
        inputSchema: {
            type: 'object',
            required: ['baseline_root', 'working_root', 'path'],
            properties: {
                baseline_root: { type: 'string' },
                working_root: { type: 'string' },
                path: { type: 'string' },
                project_url: { type: 'string' },
                context_lines: { type: 'number', default: 3 },
                max_context_lines: { type: 'number', default: 20 },
                max_edits: { type: 'number', default: 40 },
                max_bytes: { type: 'number', default: 2000000 },
                max_replacement_chars: { type: 'number', default: 12000 },
                dry_run: { type: 'boolean', default: true },
                require_reviewing: { type: 'boolean', default: true },
                allow_partial: { type: 'boolean', default: false, description: 'Apply non-conflicting hunks even when other hunks conflict. Conflicts are always reported.' },
            },
        },
    },
    {
        name: 'read_project_tree',
        description: 'Read the local Overleaf project tree for broad manuscript context.',
        inputSchema: {
            type: 'object',
            properties: {
                root: { type: 'string', description: 'Optional local project root. Defaults to OVERLEAF_MCP_LOCAL_ROOT or cwd.' },
                max_entries: { type: 'number', description: 'Maximum entries to return.', default: 800 },
            },
        },
    },
    {
        name: 'read_local_file',
        description: 'Read one local project file for drafting context. This does not write to Overleaf.',
        inputSchema: {
            type: 'object',
            required: ['path'],
            properties: {
                root: { type: 'string' },
                path: { type: 'string' },
                max_bytes: { type: 'number', default: 200000 },
            },
        },
    },
    {
        name: 'search_project',
        description: 'Search text across local LaTeX project files.',
        inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
                root: { type: 'string' },
                query: { type: 'string' },
                max_matches: { type: 'number', default: 80 },
            },
        },
    },
    {
        name: 'read_open_overleaf_editor',
        description: 'Read the currently open Overleaf editor text through the managed or externally connected browser session.',
        inputSchema: {
            type: 'object',
            properties: {
                project_url: { type: 'string' },
            },
        },
    },
    {
        name: 'replace_text_tracked',
        description: 'Replace exact text once in the currently open Overleaf editor. Defaults to dry-run and requires Reviewing/Track Changes detection.',
        inputSchema: {
            type: 'object',
            required: ['expected_text', 'replacement_text'],
            properties: {
                project_url: { type: 'string' },
                expected_text: { type: 'string' },
                replacement_text: { type: 'string' },
                dry_run: { type: 'boolean', default: true },
                require_reviewing: { type: 'boolean', default: true },
                max_replacement_chars: { type: 'number', default: 12000 },
            },
        },
    },
    {
        name: 'replace_texts_tracked',
        description: 'Apply several non-overlapping exact replacements in one tracked Overleaf transaction. Defaults to dry-run and minimizes each edit to its changed span.',
        inputSchema: {
            type: 'object',
            required: ['edits'],
            properties: {
                project_url: { type: 'string' },
                edits: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 40,
                    items: {
                        type: 'object',
                        required: ['expected_text', 'replacement_text'],
                        properties: {
                            expected_text: { type: 'string' },
                            replacement_text: { type: 'string' },
                        },
                    },
                },
                dry_run: { type: 'boolean', default: true },
                require_reviewing: { type: 'boolean', default: true },
                max_replacement_chars: { type: 'number', default: 12000 },
                max_edits: { type: 'number', default: 40 },
            },
        },
    },
];
function textResult(value) {
    return {
        content: [
            {
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            },
        ],
    };
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
async function planLocalFileFromArgs(args) {
    const baselineRoot = resolveLocalRoot(String(args.baseline_root));
    const workingRoot = resolveLocalRoot(String(args.working_root));
    const filePath = String(args.path);
    const maxBytes = Number(args.max_bytes || 2_000_000);
    const [baseline, working] = await Promise.all([
        readLocalFile(baselineRoot, filePath, maxBytes),
        readLocalFile(workingRoot, filePath, maxBytes),
    ]);
    return {
        filePath,
        baselineRoot,
        workingRoot,
        plan: planLocalFileChanges(baseline, working, {
            contextLines: Number(args.context_lines || 3),
            maxContextLines: Number(args.max_context_lines || 20),
            maxEdits: Number(args.max_edits || 40),
        }),
    };
}
const server = new Server({
    name: 'overleaf-tracked-changes-mcp',
    version: VERSION,
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = asRecord(request.params.arguments);
    switch (request.params.name) {
        case 'list_local_changes': {
            const baselineRoot = resolveLocalRoot(String(args.baseline_root));
            const workingRoot = resolveLocalRoot(String(args.working_root));
            return textResult({
                baselineRoot,
                workingRoot,
                ...await listLocalChanges(baselineRoot, workingRoot, Number(args.max_entries || 5000), Number(args.max_bytes || 2_000_000)),
            });
        }
        case 'plan_local_file_changes': {
            return textResult(await planLocalFileFromArgs(args));
        }
        case 'sync_local_file_tracked': {
            const local = await planLocalFileFromArgs(args);
            if (!local.plan.changed) {
                return textResult({
                    ok: true,
                    complete: true,
                    dryRun: args.dry_run !== false,
                    filePath: local.filePath,
                    localPlan: local.plan,
                    collaborativePlan: null,
                    remote: null,
                });
            }
            const requireReviewing = args.require_reviewing !== false;
            const allowPartial = args.allow_partial === true;
            const remoteStatus = await browserClient.openProjectFile({
                filePath: local.filePath,
                projectUrl: args.project_url,
                ensureReviewing: requireReviewing,
            });
            const remoteText = await browserClient.readOpenEditorText(args.project_url);
            const [baselineText, workingText] = await Promise.all([
                readLocalFile(local.baselineRoot, local.filePath, Number(args.max_bytes || 2_000_000)),
                readLocalFile(local.workingRoot, local.filePath, Number(args.max_bytes || 2_000_000)),
            ]);
            const collaborativePlan = planCollaborativeFileChanges(baselineText, workingText, remoteText, {
                maxContextLines: Number(args.max_context_lines || 20),
                maxEdits: Number(args.max_edits || 40),
            });
            const hardBlocked = collaborativePlan.reason === 'remote_anchor_not_unique'
                || collaborativePlan.reason === 'too_many_safe_edits';
            const conflictBlocked = collaborativePlan.conflicts.length > 0 && !allowPartial;
            if (hardBlocked || conflictBlocked || collaborativePlan.edits.length === 0) {
                const complete = !hardBlocked
                    && collaborativePlan.conflicts.length === 0
                    && collaborativePlan.alreadyAppliedCount === collaborativePlan.localChangeCount;
                return textResult({
                    ok: complete,
                    complete,
                    partial: false,
                    blocked: !complete,
                    reason: hardBlocked ? collaborativePlan.reason : (conflictBlocked ? 'conflicts_require_resolution' : 'no_safe_edits'),
                    dryRun: args.dry_run !== false,
                    allowPartial,
                    filePath: local.filePath,
                    localPlan: local.plan,
                    collaborativePlan,
                    remoteStatus,
                    remote: null,
                });
            }
            const remote = await browserClient.replaceTextsTracked({
                projectUrl: args.project_url,
                edits: collaborativePlan.edits,
                dryRun: args.dry_run !== false,
                requireReviewing,
                maxReplacementChars: Number(args.max_replacement_chars || 12_000),
                maxEdits: Number(args.max_edits || 40),
            });
            return textResult({
                ok: remote.ok,
                complete: remote.ok && collaborativePlan.conflicts.length === 0,
                partial: remote.ok && collaborativePlan.conflicts.length > 0,
                dryRun: remote.dryRun,
                allowPartial,
                filePath: local.filePath,
                localPlan: local.plan,
                collaborativePlan,
                remoteStatus,
                remote,
            });
        }
        case 'get_overleaf_status': {
            return textResult(await browserClient.status(args.project_url));
        }
        case 'download_project_snapshot': {
            return textResult(await browserClient.downloadProjectSnapshot({
                projectUrl: args.project_url,
                destinationRoot: String(args.destination_root),
                snapshotName: args.snapshot_name ? String(args.snapshot_name) : undefined,
                maxArchiveBytes: Number(args.max_archive_bytes || 262_144_000),
                maxExtractedBytes: Number(args.max_extracted_bytes || 1_073_741_824),
            }));
        }
        case 'open_overleaf_file': {
            return textResult(await browserClient.openProjectFile({
                projectUrl: args.project_url,
                filePath: String(args.path),
                ensureReviewing: args.ensure_reviewing === true,
            }));
        }
        case 'ensure_reviewing': {
            return textResult(await browserClient.ensureReviewing(args.project_url));
        }
        case 'read_project_tree': {
            const root = resolveLocalRoot(args.root);
            return textResult(await readProjectTree(root, Number(args.max_entries || 800)));
        }
        case 'read_local_file': {
            const root = resolveLocalRoot(args.root);
            return textResult(await readLocalFile(root, String(args.path), Number(args.max_bytes || 200_000)));
        }
        case 'search_project': {
            const root = resolveLocalRoot(args.root);
            return textResult(await searchProject(root, String(args.query), Number(args.max_matches || 80)));
        }
        case 'read_open_overleaf_editor': {
            return textResult(await browserClient.readOpenEditorText(args.project_url));
        }
        case 'replace_text_tracked': {
            return textResult(await browserClient.replaceTextTracked({
                projectUrl: args.project_url,
                expectedText: String(args.expected_text),
                replacementText: String(args.replacement_text),
                dryRun: args.dry_run !== false,
                requireReviewing: args.require_reviewing !== false,
                maxReplacementChars: Number(args.max_replacement_chars || 12000),
            }));
        }
        case 'replace_texts_tracked': {
            const edits = Array.isArray(args.edits) ? args.edits.map((value) => {
                const edit = asRecord(value);
                return {
                    expectedText: String(edit.expected_text),
                    replacementText: String(edit.replacement_text),
                };
            }) : [];
            return textResult(await browserClient.replaceTextsTracked({
                projectUrl: args.project_url,
                edits,
                dryRun: args.dry_run !== false,
                requireReviewing: args.require_reviewing !== false,
                maxReplacementChars: Number(args.max_replacement_chars || 12000),
                maxEdits: Number(args.max_edits || 40),
            }));
        }
        default:
            throw new Error(`Unknown tool: ${request.params.name}`);
    }
});
async function runLoginCommand() {
    const launched = await ensurePersistentChrome({
        cdpUrl: defaultCdpUrl(),
        profileDirectory: defaultPersistentProfileDirectory(),
        startUrl: 'https://www.overleaf.com/login',
    });
    process.env.OVERLEAF_BROWSER_CDP = launched.cdpUrl;
    const client = new OverleafBrowserClient();
    console.log(`Using persistent Chrome profile:\n${launched.profileDirectory}`);
    console.log('Complete login in the browser window. The project is checked only after login succeeds.');
    try {
        await client.waitForLogin();
        const target = process.env.OVERLEAF_PROJECT_URL;
        if (target) {
            console.log(JSON.stringify(await client.status(target), null, 2));
        }
        else {
            console.log('Overleaf login is ready. Set OVERLEAF_PROJECT_URL to check project access.');
        }
    }
    finally {
        await client.close();
    }
}
async function runDoctorCommand() {
    const client = new OverleafBrowserClient();
    try {
        const target = process.env.OVERLEAF_PROJECT_URL || 'https://www.overleaf.com/project';
        console.log(JSON.stringify(await client.status(target), null, 2));
    }
    finally {
        await client.close();
    }
}
async function runOpenCommand() {
    const target = process.env.OVERLEAF_PROJECT_URL || 'https://www.overleaf.com/project';
    const launched = await ensurePersistentChrome({
        cdpUrl: defaultCdpUrl(),
        profileDirectory: defaultPersistentProfileDirectory(),
        startUrl: target,
    });
    process.env.OVERLEAF_BROWSER_CDP = launched.cdpUrl;
    const client = new OverleafBrowserClient();
    await client.waitForLogin();
    const page = await client.connect(target);
    console.log(JSON.stringify(await client.status(target), null, 2));
    console.log('Browser is open and will remain connected. Press Ctrl+C to stop.');
    await new Promise((resolve) => {
        let finished = false;
        const input = process.stdin;
        const wasRaw = input.isTTY && input.isRaw;
        const onInput = (data) => {
            if (data.includes(3))
                finish();
        };
        const finish = () => {
            if (finished)
                return;
            finished = true;
            process.off('SIGINT', finish);
            process.off('SIGTERM', finish);
            page.context().off('close', finish);
            input.off('data', onInput);
            if (input.isTTY && typeof input.setRawMode === 'function')
                input.setRawMode(Boolean(wasRaw));
            input.pause();
            resolve();
        };
        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
        page.context().once('close', finish);
        if (input.isTTY && typeof input.setRawMode === 'function') {
            input.setRawMode(true);
            input.resume();
            input.on('data', onInput);
        }
    });
    await client.close();
}
async function runBrowserCommand(startUrl) {
    const result = await ensurePersistentChrome({
        cdpUrl: defaultCdpUrl(),
        profileDirectory: defaultPersistentProfileDirectory(),
        startUrl: startUrl || 'https://www.overleaf.com/login',
    });
    console.log(JSON.stringify(result, null, 2));
    console.log('Chrome remains open. Complete login there, then run the login or doctor command.');
}
async function runSnapshotCommand(destinationRoot, snapshotName) {
    if (!destinationRoot)
        throw new Error('snapshot requires a destination root');
    const client = new OverleafBrowserClient();
    try {
        console.log(JSON.stringify(await client.downloadProjectSnapshot({
            destinationRoot,
            snapshotName,
            projectUrl: process.env.OVERLEAF_PROJECT_URL,
        }), null, 2));
    }
    finally {
        await client.close();
    }
}
async function runOpenFileCommand(filePath) {
    if (!filePath)
        throw new Error('open-file requires a file path');
    const client = new OverleafBrowserClient();
    try {
        console.log(JSON.stringify(await client.openProjectFile({
            filePath,
            projectUrl: process.env.OVERLEAF_PROJECT_URL,
            ensureReviewing: true,
        }), null, 2));
    }
    finally {
        await client.close();
    }
}
async function runReviewingCommand() {
    const client = new OverleafBrowserClient();
    try {
        console.log(JSON.stringify(await client.ensureReviewing(process.env.OVERLEAF_PROJECT_URL), null, 2));
    }
    finally {
        await client.close();
    }
}
function tomlString(value) {
    return JSON.stringify(value.replace(/\\/g, '/'));
}
function printCodexSetup() {
    const projectUrl = process.env.OVERLEAF_PROJECT_URL
        || 'https://www.overleaf.com/project/YOUR_PROJECT_ID';
    const localRoot = process.env.OVERLEAF_MCP_LOCAL_ROOT || 'C:/path/to/local/manuscript';
    const profile = process.env.OVERLEAF_BROWSER_PROFILE;
    console.log(`Add this to %USERPROFILE%\\.codex\\config.toml (Windows) or ~/.codex/config.toml:

[mcp_servers.overleaf-tracked-changes]
command = "overleaf-tracked-changes-mcp"

[mcp_servers.overleaf-tracked-changes.env]
OVERLEAF_PROJECT_URL = ${tomlString(projectUrl)}
OVERLEAF_MCP_LOCAL_ROOT = ${tomlString(localRoot)}
OVERLEAF_BROWSER_CDP = ${tomlString(defaultCdpUrl())}
OVERLEAF_BROWSER_PROFILE = ${tomlString(profile || defaultPersistentProfileDirectory())}

Restart Codex after saving the configuration.`);
}
function printHelp() {
    console.log(`overleaf-tracked-changes-mcp

Usage:
  overleaf-tracked-changes-mcp          Start the MCP stdio server
  overleaf-tracked-changes-mcp login    Open Chrome and persist an Overleaf login
  overleaf-tracked-changes-mcp browser [url]  Start or reuse persistent Chrome on fixed CDP
  overleaf-tracked-changes-mcp doctor   Check browser, login, project, and Reviewing status
  overleaf-tracked-changes-mcp open     Keep the managed project browser visibly open
  overleaf-tracked-changes-mcp open-file <path>  Open a file and enable Reviewing
  overleaf-tracked-changes-mcp reviewing         Enable Reviewing on the open file
  overleaf-tracked-changes-mcp snapshot <parent> [name]  Download a complete source snapshot
  overleaf-tracked-changes-mcp setup codex       Print Codex MCP configuration
  overleaf-tracked-changes-mcp --help   Show this help

Environment:
  OVERLEAF_PROJECT_URL       Default Overleaf project URL
  OVERLEAF_MCP_LOCAL_ROOT    Local manuscript folder
  OVERLEAF_BROWSER_PROFILE   Managed Chrome profile directory
  OVERLEAF_BROWSER_CHANNEL   Playwright browser channel, default: chrome
  OVERLEAF_BROWSER_CDP       Optional existing Chrome/Edge CDP URL`);
}
const command = process.argv[2];
if (command === 'login') {
    await runLoginCommand();
}
else if (command === 'doctor') {
    await runDoctorCommand();
}
else if (command === 'browser') {
    await runBrowserCommand(process.argv[3]);
}
else if (command === 'open') {
    await runOpenCommand();
}
else if (command === 'open-file') {
    await runOpenFileCommand(process.argv[3]);
}
else if (command === 'reviewing') {
    await runReviewingCommand();
}
else if (command === 'snapshot') {
    await runSnapshotCommand(process.argv[3], process.argv[4]);
}
else if (command === 'setup' && process.argv[3] === 'codex') {
    printCodexSetup();
}
else if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
}
else if (command) {
    printHelp();
    process.exitCode = 1;
}
else {
    await server.connect(new StdioServerTransport());
}
//# sourceMappingURL=index.js.map