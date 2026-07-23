#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { readLocalFile, readProjectTree, resolveLocalRoot, searchProject } from './localProject.js';
import { browserProfileDirectory, OverleafBrowserClient } from './overleafBrowser.js';
const browserClient = new OverleafBrowserClient();
const tools = [
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
const server = new Server({
    name: 'overleaf-tracked-changes-mcp',
    version: '0.3.0',
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = asRecord(request.params.arguments);
    switch (request.params.name) {
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
    const client = new OverleafBrowserClient();
    console.log(`Opening Overleaf login in the managed browser profile:\n${browserProfileDirectory()}`);
    console.log('Complete login in the browser window. This command will finish automatically.');
    try {
        const page = await client.waitForLogin();
        console.log(`Overleaf login is ready: ${page.url()}`);
    }
    finally {
        await client.close();
    }
}
async function runDoctorCommand() {
    const client = new OverleafBrowserClient();
    try {
        const target = process.env.OVERLEAF_PROJECT_URL || 'https://www.overleaf.com/project';
        const page = await client.connect(target);
        const loggedIn = !page.url().includes('/login');
        const onProject = page.url().includes('/project/');
        const reviewing = onProject ? await client.isReviewingLikelyEnabled() : false;
        console.log(JSON.stringify({
            ok: loggedIn,
            browserMode: process.env.OVERLEAF_BROWSER_CDP ? 'external-cdp' : 'managed-profile',
            profile: process.env.OVERLEAF_BROWSER_CDP ? null : browserProfileDirectory(),
            loggedIn,
            onProject,
            reviewing,
            url: page.url(),
            title: await page.title(),
        }, null, 2));
    }
    finally {
        await client.close();
    }
}
function printHelp() {
    console.log(`overleaf-tracked-changes-mcp

Usage:
  overleaf-tracked-changes-mcp          Start the MCP stdio server
  overleaf-tracked-changes-mcp login    Open Chrome and persist an Overleaf login
  overleaf-tracked-changes-mcp doctor   Check browser, login, project, and Reviewing status
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