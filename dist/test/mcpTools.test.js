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
            'read_local_file',
            'read_open_overleaf_editor',
            'read_project_tree',
            'replace_text_tracked',
            'replace_texts_tracked',
            'search_project',
            'sync_local_file_tracked',
        ]);
        const syncTool = response.tools.find((tool) => tool.name === 'sync_local_file_tracked');
        assert.ok(syncTool);
        const syncProperties = syncTool.inputSchema.properties;
        assert.ok('allow_partial' in syncProperties);
        const planResponse = await client.callTool({
            name: 'plan_local_file_changes',
            arguments: {
                baseline_root: baselineRoot,
                working_root: workingRoot,
                path: 'manuscript.tex',
            },
        });
        const content = planResponse.content[0];
        assert.equal(content.type, 'text');
        if (content.type !== 'text' || typeof content.text !== 'string') {
            throw new Error('Expected text MCP result');
        }
        const payload = JSON.parse(content.text);
        assert.equal(payload.plan.ok, true);
        assert.equal(payload.plan.changed, true);
        assert.equal(payload.plan.edits.length, 1);
    }
    finally {
        await client.close();
        await fs.rm(localRoot, { recursive: true, force: true });
    }
});
//# sourceMappingURL=mcpTools.test.js.map