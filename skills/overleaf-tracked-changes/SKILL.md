---
name: overleaf-tracked-changes
description: Draft Overleaf LaTeX changes locally and replay selected exact diff hunks as reviewable tracked changes through the overleaf-tracked-changes-mcp server. Use for safe paragraph edits, batch manuscript revisions, and collaborator-aware Overleaf workflows.
---

# Overleaf Tracked Changes

Use the companion MCP to read local project files broadly and write to the live Overleaf editor narrowly. Never use `olcli push`, `olcli sync`, Git upload, or Dropbox sync for tracked manuscript edits.

## First-time setup

1. Run `overleaf-tracked-changes-mcp login` once.
2. Sign in to Overleaf in the opened browser window.
3. Set `OVERLEAF_PROJECT_URL` and `OVERLEAF_MCP_LOCAL_ROOT` for the project.
4. Open the target `.tex` file in Overleaf and enable Reviewing.

The MCP owns a separate persistent browser profile by default. It does not receive or store passwords or copied cookies. `OVERLEAF_BROWSER_CDP` is an optional advanced mode for an already-running browser.

## Safe editing workflow

1. Read the local project tree and relevant files.
2. Preserve a remote baseline before starting a local editing round.
3. Edit a separate local working copy.
4. Turn baseline-to-working changes into small exact `{expected_text, replacement_text}` hunks.
5. Call `replace_texts_tracked` with `dry_run: true`.
6. Review all anchors and ranges, then repeat with `dry_run: false`.
7. Re-read the editor and confirm Overleaf shows tracked insertions/deletions.

Every expected anchor must occur exactly once in the current remote editor. Missing, duplicate, overlapping, or drifted anchors block the operation. The MCP minimizes each operation to its changed characters and batches independent hunks, so the local file is never uploaded as a whole.

Treat Overleaf as the collaboration source of truth. If a collaborator changed the same region, refresh the baseline and resolve it locally before replaying that hunk.
