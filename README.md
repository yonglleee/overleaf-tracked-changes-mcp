# Overleaf Tracked Changes MCP

MCP server for safe, paragraph-scale Overleaf manuscript edits through the web editor, designed for AI-assisted paper writing where collaborators may edit the same `.tex` files.

The guiding rule is simple:

> Read broadly from the local project, write narrowly through Overleaf tracked changes.

This is not an `olcli push` wrapper. `olcli push`, Git bridge, and Dropbox sync operate at file granularity and can overwrite another collaborator's edits in the same `.tex` file. This server is designed to patch a single exact text range through the Overleaf browser editor.

## Status

This repository is an early MVP. The local project read/search tools are straightforward. The Overleaf write path is intentionally conservative:

- the target `.tex` file should already be open in Overleaf,
- Reviewing/Track Changes should be enabled,
- writes default to `dry_run: true`,
- replacement requires one exact `expected_text` match,
- the implementation uses CodeMirror `view.dispatch`, not file upload.

Test on a disposable Overleaf project before using it on a real manuscript.

## Tools

- `read_project_tree`: read local project tree for broad context.
- `read_local_file`: read one local file.
- `search_project`: search local LaTeX project files.
- `read_open_overleaf_editor`: read the currently open Overleaf editor text through a browser CDP session.
- `replace_text_tracked`: exact-match replacement in the currently open Overleaf editor, default dry-run.

## Install

```bash
npm install
npm run build
```

## Browser setup

Launch Chrome or Edge with remote debugging and a separate user profile:

```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\temp\overleaf-mcp-profile
```

Log into Overleaf in that browser, open the project, open the target `.tex` file, and enable Reviewing/Track Changes.

Set environment variables:

```powershell
$env:OVERLEAF_BROWSER_CDP = "http://127.0.0.1:9222"
$env:OVERLEAF_PROJECT_URL = "https://www.overleaf.com/project/<project-id>"
$env:OVERLEAF_MCP_LOCAL_ROOT = "C:\path\to\local\overleaf\project"
```

## Codex MCP config example

```json
{
  "mcpServers": {
    "overleaf-tracked-changes": {
      "command": "node",
      "args": ["C:/path/to/overleaf-tracked-changes-mcp/dist/index.js"],
      "env": {
        "OVERLEAF_BROWSER_CDP": "http://127.0.0.1:9222",
        "OVERLEAF_PROJECT_URL": "https://www.overleaf.com/project/<project-id>",
        "OVERLEAF_MCP_LOCAL_ROOT": "C:/path/to/local/overleaf/project"
      }
    }
  }
}
```

## Safe edit flow

1. Use `read_project_tree`, `search_project`, and `read_local_file` to understand the manuscript.
2. Draft the replacement text in Codex.
3. Use `read_open_overleaf_editor` to read the current remote text.
4. Call `replace_text_tracked` with `dry_run: true`.
5. Confirm the exact matched range.
6. Call `replace_text_tracked` with `dry_run: false` only after confirmation.
7. Verify the Overleaf UI shows a tracked change.

## Why not upload files?

Because multiple collaborators can edit `manuscript.tex` at once. A file-level upload can replace the remote file with a stale local copy. This server avoids that class of problem by requiring the exact current text to still exist in Overleaf before making a narrow replacement.

## Limitations

- v0.1 expects the target Overleaf file to already be open.
- Reviewing mode detection is heuristic.
- CodeMirror internals and Overleaf DOM can change.
- This does not accept or reject tracked changes.
- This does not yet add comments or compile.

## Security notes

`npm audit --omit=dev` currently reports a moderate advisory through `@modelcontextprotocol/sdk` -> `@hono/node-server` with no available fix. This server uses stdio transport, not Hono static file serving, but review the advisory before publishing a production package.

## License

MIT