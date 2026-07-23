# Overleaf Tracked Changes MCP

Edit LaTeX locally with an AI agent, then replay selected changes into Overleaf as reviewable tracked changes. The server writes through the live Overleaf editor; it never uploads an entire `.tex` file.

> Read broadly from the local project. Write narrowly through Overleaf tracked changes.

## What you get

- persistent Overleaf login in a separate Chrome profile;
- automatic Chrome startup and restart after the window is closed;
- local project tree, file reading, and search tools;
- exact single or batch tracked replacements;
- dry-run by default, unique-anchor checks, and drift protection;
- an Agent Skill that teaches Codex and other AgentSkills-compatible agents the safe workflow.

## AI agent install (recommended)

Install the Agent Skill from this GitHub repository:

```bash
npx skills add yonglleee/overleaf-tracked-changes-mcp
```

GitHub CLI users can install the same skill with:

```bash
gh skill install yonglleee/overleaf-tracked-changes-mcp overleaf-tracked-changes --scope user
```

Then install the MCP executable directly from GitHub until an npm package is published:

```bash
npm install -g github:yonglleee/overleaf-tracked-changes-mcp
```

Configure your MCP client to run:

```json
{
  "mcpServers": {
    "overleaf-tracked-changes": {
      "command": "overleaf-tracked-changes-mcp",
      "env": {
        "OVERLEAF_PROJECT_URL": "https://www.overleaf.com/project/YOUR_PROJECT_ID",
        "OVERLEAF_MCP_LOCAL_ROOT": "C:/path/to/local/manuscript"
      }
    }
  }
}
```

The repository contains the skill at `skills/overleaf-tracked-changes/SKILL.md`. Agents without AgentSkills support can still use the MCP tools directly.

## First login

Run this once:

```bash
overleaf-tracked-changes-mcp login
```

A separate Chrome window opens. Sign in to Overleaf normally; the command exits after login. Passwords and copied cookies are never stored by this project.

The login is kept in a dedicated browser profile. You may close Chrome afterward. The next MCP operation automatically starts Chrome again and reuses the saved login.

Check setup at any time:

```bash
overleaf-tracked-changes-mcp doctor
```

## Use with an agent

Open the target project and `.tex` file in the managed Chrome window, enable **Reviewing**, then ask the agent to revise the manuscript with tracked changes.

The safe editing flow is:

1. Read local project context.
2. Read the current remote editor before writing.
3. Prepare small exact changes or a local baseline-to-working-copy diff.
4. Run `replace_text_tracked` or `replace_texts_tracked` with `dry_run: true`.
5. Apply only after the planned anchors and ranges are confirmed.
6. Verify Overleaf shows suggestions attributed to the logged-in account.

If a collaborator changed the same anchored region, the operation is blocked. Unrelated remote edits are not replaced.

## MCP tools

- `read_project_tree`: inspect the local manuscript tree.
- `read_local_file`: read one local project file.
- `search_project`: search local LaTeX project files.
- `read_open_overleaf_editor`: read the live Overleaf editor.
- `replace_text_tracked`: apply one exact tracked replacement; dry-run by default.
- `replace_texts_tracked`: apply up to 40 non-overlapping replacements in one transaction.

## Advanced browser connection

The default managed profile is the simplest setup. To reuse a Chrome or Edge instance that you start yourself, set:

```powershell
$env:OVERLEAF_BROWSER_CDP = "http://127.0.0.1:9222"
```

Optional browser settings:

- `OVERLEAF_BROWSER_PROFILE`: custom managed profile directory.
- `OVERLEAF_BROWSER_CHANNEL`: Playwright channel, default `chrome`.
- `OVERLEAF_BROWSER_CDP`: external Chrome/Edge debugging endpoint; disables managed startup.

## Development

Requirements: Node.js 20+ and Google Chrome.

```bash
git clone https://github.com/yonglleee/overleaf-tracked-changes-mcp.git
cd overleaf-tracked-changes-mcp
npm install
npm run check
node dist/src/index.js login
```

## Safety and limitations

- Test on a disposable project before using a production manuscript.
- The target file currently needs to be open in Overleaf.
- Reviewing detection and CodeMirror access depend on Overleaf's current web UI.
- The server does not accept or reject suggestions and does not yet add comments.
- Do not use `olcli push`, Git upload, or Dropbox sync for concurrent tracked edits; those paths replace whole files.

## License

MIT

## Acknowledgements

Thanks to [cellis212/overleaf-tracked-changes-mcp-guide](https://github.com/cellis212/overleaf-tracked-changes-mcp-guide) for documenting and sharing an Overleaf tracked-changes workflow that helped inform this project.
