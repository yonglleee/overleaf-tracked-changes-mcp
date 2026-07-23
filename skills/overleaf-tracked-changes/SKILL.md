---
name: overleaf-tracked-changes
description: Download complete Overleaf project snapshots for local drafting, then replay selected exact diff hunks as reviewable tracked changes through overleaf-tracked-changes-mcp. Use for collaborator-aware manuscript revisions that must not overwrite whole remote files.
license: MIT
---

# Overleaf Tracked Changes

Use immutable local snapshots for broad reading and the live Overleaf editor for narrow tracked writes. Never use `olcli push`, `olcli sync`, Git upload, or Dropbox sync for concurrent manuscript edits.

## Select the browser path

- Prefer the companion MCP when its tools are available. For reliable visible login, start one persistent Chrome with `overleaf-tracked-changes-mcp browser`, keep a fixed `OVERLEAF_BROWSER_PROFILE`, and connect the MCP through a fixed `OVERLEAF_BROWSER_CDP` such as `http://127.0.0.1:9222`.
- Use the Codex in-app browser only as a visible fallback or for manual inspection. It is a separate session and is not automatically the MCP browser.
- If the MCP tools are missing, explain that installing the Skill alone does not register the MCP. Run `overleaf-tracked-changes-mcp setup codex`, install the printed configuration, and restart Codex.

## First-time setup

1. Run `overleaf-tracked-changes-mcp browser` once from the user's normal terminal. Sign in normally in that visible Chrome, then run `overleaf-tracked-changes-mcp login` to verify the account before checking the project.
2. Set `OVERLEAF_PROJECT_URL` and `OVERLEAF_MCP_LOCAL_ROOT`.
3. Register the MCP client configuration.
4. Use `get_overleaf_status` to verify login and the project.
5. Use `open_overleaf_file` and `ensure_reviewing` before tracked writes.

Never request passwords, copied cookies, session tokens, or browser-profile files.

## Snapshot-first workflow

1. Call `download_project_snapshot` with an explicit parent directory. It must create a new destination and must not overwrite an existing folder.
2. Treat that snapshot as the immutable baseline for the drafting round.
3. Copy or otherwise prepare a separate working tree for local edits. When the user asks to open or edit the local snapshot, preserve the snapshot and open the working copy instead; report both paths clearly.
4. Read the local tree and relevant files broadly.
5. When the user says "sync" or "同步", interpret it as tracked hunk replay, never whole-file upload.
6. If the changed files are not known, call `list_local_changes` first. Report added, deleted, and skipped files but do not propagate them.
7. Call `plan_local_file_changes`, or call `sync_local_file_tracked` directly with `dry_run: true`, for each modified existing text file. The sync tool must compare baseline, working copy, and current remote text.
8. Review safe changes, already-applied changes, and conflicts, and confirm the correct local path.
9. Let `sync_local_file_tracked` open the matching file, verify Reviewing, and read the live editor in one prepared pass. Do not prepend separate status, open-file, Reviewing, and read calls unless diagnosing a failure.
10. Repeat `sync_local_file_tracked` with `dry_run: false` only after the plan is confirmed. Keep `allow_partial: false` unless the user explicitly approves applying only the conflict-free changes.
11. Re-read the remote editor and verify tracked insertions/deletions.

Automatically rebase non-overlapping word-level changes, including different words in the same paragraph. Treat an identical remote change as already applied. Different changes to the same token or insertion point are true conflicts and must never be resolved by guessing or last-writer-wins behavior.

For true conflicts, present the local and remote variants, obtain or draft an explicit merged wording, update the working copy, and apply the resolved paragraph through a dry-run tracked replacement. Do not automatically refresh the baseline while suggestions are pending. Download a fresh immutable snapshot after suggestions are accepted or rejected and before the next editing round.

Local tracked sync supports modified existing text files only. Do not propagate new files, deleted files, binary files, or whole-directory deletions. Handle each changed file separately so one drifting file does not affect another.

Ignore generated LaTeX build artifacts reported by `list_local_changes`. A `.bbl` already present in the immutable baseline may be revised and synced as text, but a newly generated `.bbl` is ignored.

## Browser lifecycle

- `browser` starts or reuses a visible Chrome on a fixed local CDP endpoint and returns without closing Chrome.
- `doctor` reports status and exits without closing an externally connected Chrome.
- `open` reuses the persistent browser, completes login if needed, and opens the configured project.
- `OVERLEAF_BROWSER_PROFILE` contains login state. Keep it private and outside Git repositories.

## Safety rules

- Default every write operation to dry-run.
- Keep edits paragraph-scale or smaller and batch only independent hunks.
- Stop when Reviewing is unclear, the file is wrong, or a true overlapping conflict remains unresolved.
- A complete project snapshot is read-only input, never a payload for whole-file synchronization.
- Refresh the baseline after suggestions are accepted or rejected before starting another drafting round.
