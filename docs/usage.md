# Usage Guide

This guide contains the detailed operational notes that are intentionally kept out of the main README.

## Browser and login

Start or reuse one visible Chrome window with a fixed profile and fixed CDP endpoint:

```bash
overleaf-tracked-changes-mcp browser
```

The command returns after Chrome is ready, but Chrome stays open. Sign in normally, then verify login and project access:

```bash
overleaf-tracked-changes-mcp login
overleaf-tracked-changes-mcp doctor
```

Passwords and copied cookies are never requested. Login state stays in the same dedicated browser profile across commands. The default endpoint is `http://127.0.0.1:9222`; keeping `OVERLEAF_BROWSER_PROFILE` stable preserves the login state.

Chrome cannot enable CDP after it is already running. The `browser` command therefore creates one dedicated Chrome the first time, then reuses its existing Overleaf tab instead of opening another profile or tab.

The Codex in-app browser and the MCP-managed Chrome profile are separate browser sessions. The Skill may use the in-app browser for visible manual work, but MCP tools use the managed profile or an explicitly configured CDP browser.

Use `open` to reuse the browser, finish login if needed, and open the configured project:

```bash
overleaf-tracked-changes-mcp open
```

## Snapshot and local drafting

Create an immutable timestamped snapshot under a parent directory:

```powershell
overleaf-tracked-changes-mcp snapshot "D:\Paper\overleaf-snapshots"
overleaf-tracked-changes-mcp snapshot "D:\Paper\overleaf-snapshots" baseline-2026-07-23
```

Keep the snapshot unchanged and make a separate working copy. Read and edit the working copy locally. Do not send the complete snapshot back with `olcli push`, `olcli sync`, Git upload, or Dropbox sync when collaborators may be editing.

## Tracked sync

The recommended workflow is:

1. Download a fresh remote snapshot.
2. Preserve it as the immutable baseline and edit a separate working copy.
3. Run `preflight_local_document` before any browser status or editor operation.
4. Ask the agent to `sync manuscript.tex`.
5. Review the dry-run and apply only confirmed safe hunks.
6. Re-read the remote editor and verify the tracked suggestions.

The MCP caches local plans while baseline and working-file metadata are unchanged. At sync time it still compares the immutable baseline, local working copy, and current Overleaf text. It rebases non-conflicting edits, reports already-applied edits, and blocks true conflicts by default. Set `allow_partial: true` only after reviewing the dry-run.

`sync_local_file_tracked` prepares the target editor, verifies Reviewing, selects the active visible CodeMirror editor, and reads the live file in one browser pass. It never replaces the original baseline and never uploads the working file.

Newly generated LaTeX artifacts such as `.aux`, `.log`, `.fls`, and `.synctex.gz` are ignored. A `.bbl` already present in the baseline remains trackable for submission workflows.

## Binary assets

Use `upload_overleaf_file` only for an explicitly requested non-text asset such as an image or PDF.

The default dry-run reports the local SHA-256, size, MIME type, and exact remote path without contacting Overleaf. Unchanged preflight metadata is cached in the MCP process. A confirmed upload revalidates the file fingerprint, reads the asset once, and sends that same buffer to Overleaf.

Keep `overwrite: false` for new files. If the remote file exists, obtain approval for that exact path before retrying with `overwrite: true`. Text files, directories, generated artifacts, and path escapes are rejected.

## Browser connection details

The managed persistent profile is the default. To reuse Chrome or Edge started separately:

```powershell
$env:OVERLEAF_BROWSER_CDP = "http://127.0.0.1:9222"
```

Available settings:

- `OVERLEAF_BROWSER_PROFILE`: custom managed profile directory; keep it outside Git.
- `OVERLEAF_BROWSER_CHANNEL`: Playwright browser channel, default `chrome`.
- `OVERLEAF_BROWSER_CDP`: external Chrome/Edge debugging endpoint; disables managed startup.
- `OVERLEAF_PROJECT_URL`: default Overleaf project URL.
- `OVERLEAF_MCP_LOCAL_ROOT`: default snapshot or working-copy root.

When a reachable CDP endpoint already exposes an Overleaf tab, the MCP reuses it. A locked persistent profile or a hung status call must not prevent local document preflight. If remote editor identity remains ambiguous, the MCP stops before writing rather than selecting the first CodeMirror instance.

## Troubleshooting

- If the MCP tools are missing, install the MCP executable separately from the Agent Skill and restart Codex after adding its TOML configuration.
- If Chrome reports a profile lock, reuse the existing reachable CDP endpoint and do not close the user's browser.
- If a status call hangs, bypass it and use the prepared read or sync path after completing local preflight.
- If a nested file cannot be selected, expand its folder in the Overleaf file tree first.
- If Reviewing or CodeMirror detection fails, stop before writing and inspect the live editor manually.

## CLI reference

```text
overleaf-tracked-changes-mcp          Start the MCP stdio server
overleaf-tracked-changes-mcp login    Open Chrome and persist an Overleaf login
overleaf-tracked-changes-mcp browser [url]
                                      Start or reuse persistent Chrome
overleaf-tracked-changes-mcp doctor   Check browser, login, project, and Reviewing
overleaf-tracked-changes-mcp open     Keep the managed project browser open
overleaf-tracked-changes-mcp open-file <path>
                                      Open a file and enable Reviewing
overleaf-tracked-changes-mcp reviewing
                                      Enable Reviewing on the open file
overleaf-tracked-changes-mcp snapshot <parent> [name]
                                      Download a complete source snapshot
overleaf-tracked-changes-mcp setup codex
                                      Print Codex MCP configuration
```
