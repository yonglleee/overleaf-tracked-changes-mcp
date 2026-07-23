#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { readLocalFile, readProjectTree, resolveLocalRoot, searchProject } from './localProject.js';
import { OverleafBrowserClient } from './overleafBrowser.js';

const browserClient = new OverleafBrowserClient();

const tools: Tool[] = [
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
    description: 'Read the currently open Overleaf editor text through a logged-in browser CDP session.',
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
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

const server = new Server(
  {
    name: 'overleaf-tracked-changes-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = asRecord(request.params.arguments);
  switch (request.params.name) {
    case 'read_project_tree': {
      const root = resolveLocalRoot(args.root as string | undefined);
      return textResult(await readProjectTree(root, Number(args.max_entries || 800)));
    }
    case 'read_local_file': {
      const root = resolveLocalRoot(args.root as string | undefined);
      return textResult(await readLocalFile(root, String(args.path), Number(args.max_bytes || 200_000)));
    }
    case 'search_project': {
      const root = resolveLocalRoot(args.root as string | undefined);
      return textResult(await searchProject(root, String(args.query), Number(args.max_matches || 80)));
    }
    case 'read_open_overleaf_editor': {
      return textResult(await browserClient.readOpenEditorText(args.project_url as string | undefined));
    }
    case 'replace_text_tracked': {
      return textResult(await browserClient.replaceTextTracked({
        projectUrl: args.project_url as string | undefined,
        expectedText: String(args.expected_text),
        replacementText: String(args.replacement_text),
        dryRun: args.dry_run !== false,
        requireReviewing: args.require_reviewing !== false,
        maxReplacementChars: Number(args.max_replacement_chars || 12000),
      }));
    }
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

await server.connect(new StdioServerTransport());