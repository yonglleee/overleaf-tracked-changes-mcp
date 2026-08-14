# Overleaf Tracked Changes MCP

An MCP server and Agent Skill for drafting locally and replaying selected text changes into Overleaf as tracked suggestions. It never uploads a whole `.tex` file.

## What it does

- downloads immutable Overleaf snapshots for local drafting;
- plans and syncs paragraph-scale changes with three-way conflict checks;
- runs local document preflight before browser access;
- uploads one non-text asset at a time, with dry-run and explicit overwrite protection.

## Install

Install the Agent Skill for Codex:

```bash
npx skills add yonglleee/overleaf-tracked-changes-mcp --agent codex --skill overleaf-tracked-changes --global --yes
```

Install the MCP server from GitHub:

```bash
npm install -g github:yonglleee/overleaf-tracked-changes-mcp
```

Installing the Skill does not register the MCP server. Configure the project and print the Codex configuration:

```powershell
$env:OVERLEAF_PROJECT_URL = "https://www.overleaf.com/project/YOUR_PROJECT_ID"
$env:OVERLEAF_MCP_LOCAL_ROOT = "C:\path\to\local\manuscript"
overleaf-tracked-changes-mcp setup codex
```

Add the printed TOML to `%USERPROFILE%\.codex\config.toml` and restart Codex.

## Quick start

```bash
overleaf-tracked-changes-mcp browser
overleaf-tracked-changes-mcp login
overleaf-tracked-changes-mcp doctor
overleaf-tracked-changes-mcp snapshot "D:\Paper\overleaf-snapshots"
```

Keep the downloaded snapshot unchanged and edit a separate working copy. Ask the agent to run a local preflight, then `sync manuscript.tex`. Sync replays only reviewed tracked hunks; it does not perform whole-file or whole-project upload.

For images and PDFs, use `upload_overleaf_file`. It defaults to a local dry-run, caches unchanged preflight metadata, reads the confirmed asset once, and requires `overwrite: true` to replace an existing remote file.

## Safety model

- tracked text sync supports modified existing text files only;
- new files, deletions, directories, and generated LaTeX artifacts are not propagated by tracked sync;
- true conflicts block writes by default;
- binary asset uploads are separate, single-file operations;
- login state stays in a dedicated browser profile and must not be committed or shared.

## Documentation

- [Usage guide](docs/usage.md): setup, snapshots, syncing, uploads, browser connection, and troubleshooting.
- [Architecture](docs/architecture.md): implementation boundaries and safety invariants.

## Development

Requirements: Node.js 20+ and Google Chrome.

```bash
git clone https://github.com/yonglleee/overleaf-tracked-changes-mcp.git
cd overleaf-tracked-changes-mcp
npm install
npm run check
node dist/src/index.js --help
```

## License

MIT

## Acknowledgements

Thanks to [cellis212/overleaf-tracked-changes-mcp-guide](https://github.com/cellis212/overleaf-tracked-changes-mcp-guide) for documenting and sharing an Overleaf tracked-changes workflow that helped inform this project.
