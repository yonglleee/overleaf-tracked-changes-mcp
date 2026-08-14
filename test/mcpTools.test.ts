import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP server publishes the complete safe workflow tool set', async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.resolve(testDirectory, '../src/index.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });
  const client = new Client({ name: 'overleaf-mcp-test', version: '1.0.0' });
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-mcp-tools-test-'));
  const baselineRoot = path.join(localRoot, 'baseline');
  const workingRoot = path.join(localRoot, 'working');
  await fs.mkdir(baselineRoot);
  await fs.mkdir(workingRoot);
  await fs.writeFile(path.join(baselineRoot, 'manuscript.tex'), 'Original sentence.\n');
  await fs.writeFile(path.join(workingRoot, 'manuscript.tex'), 'Improved sentence.\n');
  await fs.writeFile(path.join(workingRoot, 'figure.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  try {
    await client.connect(transport);
    const response = await client.listTools();
    const names = response.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'download_project_snapshot',
      'ensure_reviewing',
      'get_overleaf_status',
      'list_local_changes',
      'open_overleaf_file',
      'plan_local_file_changes',
      'preflight_local_document',
      'read_local_file',
      'read_open_overleaf_editor',
      'read_project_tree',
      'replace_text_tracked',
      'replace_texts_tracked',
      'search_project',
      'sync_local_file_tracked',
      'upload_overleaf_file',
    ]);
    const syncTool = response.tools.find((tool) => tool.name === 'sync_local_file_tracked');
    assert.ok(syncTool);
    const syncProperties = syncTool.inputSchema.properties as Record<string, unknown>;
    assert.ok('allow_partial' in syncProperties);
    const uploadTool = response.tools.find((tool) => tool.name === 'upload_overleaf_file');
    assert.ok(uploadTool);
    const uploadProperties = uploadTool.inputSchema.properties as Record<string, unknown>;
    assert.ok('overwrite' in uploadProperties);

    const uploadResponse = await client.callTool({
      name: 'upload_overleaf_file',
      arguments: {
        local_root: workingRoot,
        local_path: 'figure.png',
        remote_path: 'Figures/figure.png',
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const uploadContent = uploadResponse.content[0];
    if (uploadContent.type !== 'text' || typeof uploadContent.text !== 'string') {
      throw new Error('Expected upload dry-run text MCP result');
    }
    const upload = JSON.parse(uploadContent.text);
    assert.equal(upload.dryRun, true);
    assert.equal(upload.remoteCheck, 'pending');
    assert.equal(upload.cacheStatus, 'miss');
    assert.equal(upload.plan.remotePath, 'Figures/figure.png');
    assert.equal(upload.plan.mimeType, 'image/png');

    const cachedUploadResponse = await client.callTool({
      name: 'upload_overleaf_file',
      arguments: {
        local_root: workingRoot,
        local_path: 'figure.png',
        remote_path: 'Figures/figure.png',
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const cachedUploadContent = cachedUploadResponse.content[0];
    if (cachedUploadContent.type !== 'text' || typeof cachedUploadContent.text !== 'string') {
      throw new Error('Expected cached upload dry-run text MCP result');
    }
    assert.equal(JSON.parse(cachedUploadContent.text).cacheStatus, 'hit');

    const planResponse = await client.callTool({
      name: 'plan_local_file_changes',
      arguments: {
        baseline_root: baselineRoot,
        working_root: workingRoot,
        path: 'manuscript.tex',
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const content = planResponse.content[0];
    assert.equal(content.type, 'text');
    if (content.type !== 'text' || typeof content.text !== 'string') {
      throw new Error('Expected text MCP result');
    }
    const payload = JSON.parse(content.text);
    assert.equal(payload.plan.ok, true);
    assert.equal(payload.plan.changed, true);
    assert.equal(payload.plan.edits.length, 1);
    assert.equal(payload.cacheStatus, 'miss');

    const cachedResponse = await client.callTool({
      name: 'plan_local_file_changes',
      arguments: {
        baseline_root: baselineRoot,
        working_root: workingRoot,
        path: 'manuscript.tex',
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const cachedContent = cachedResponse.content[0];
    if (cachedContent.type !== 'text' || typeof cachedContent.text !== 'string') {
      throw new Error('Expected cached text MCP result');
    }
    assert.equal(JSON.parse(cachedContent.text).cacheStatus, 'hit');

    await fs.writeFile(path.join(workingRoot, 'manuscript.tex'), 'Improved sentence again.\n');
    const refreshedResponse = await client.callTool({
      name: 'plan_local_file_changes',
      arguments: {
        baseline_root: baselineRoot,
        working_root: workingRoot,
        path: 'manuscript.tex',
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const refreshedContent = refreshedResponse.content[0];
    if (refreshedContent.type !== 'text' || typeof refreshedContent.text !== 'string') {
      throw new Error('Expected refreshed text MCP result');
    }
    assert.equal(JSON.parse(refreshedContent.text).cacheStatus, 'working_refresh');

    const preflightResponse = await client.callTool({
      name: 'preflight_local_document',
      arguments: {
        baseline_root: baselineRoot,
        working_root: workingRoot,
        path: 'manuscript.tex',
        compile: false,
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const preflightContent = preflightResponse.content[0];
    if (preflightContent.type !== 'text' || typeof preflightContent.text !== 'string') {
      throw new Error('Expected preflight text MCP result');
    }
    const preflight = JSON.parse(preflightContent.text);
    assert.equal(preflight.compilation.attempted, false);
    assert.equal(preflight.syntax.ok, true);

    await fs.writeFile(
      path.join(workingRoot, 'manuscript.tex'),
      '\\documentclass{article}\n\\begin{document}\nBroken {\n',
    );
    const blockedSyncResponse = await client.callTool({
      name: 'sync_local_file_tracked',
      arguments: {
        baseline_root: baselineRoot,
        working_root: workingRoot,
        path: 'manuscript.tex',
        dry_run: true,
      },
    }) as { content: Array<{ type: string; text?: string }> };
    const blockedSyncContent = blockedSyncResponse.content[0];
    if (blockedSyncContent.type !== 'text' || typeof blockedSyncContent.text !== 'string') {
      throw new Error('Expected blocked sync text MCP result');
    }
    const blockedSync = JSON.parse(blockedSyncContent.text);
    assert.equal(blockedSync.reason, 'local_document_preflight_failed');
  } finally {
    await client.close();
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});
