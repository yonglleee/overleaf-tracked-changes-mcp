---
name: overleaf-tracked-changes
description: Download complete Overleaf project snapshots for local drafting, replay selected exact diff hunks as reviewable tracked changes, and explicitly upload single non-text assets through overleaf-tracked-changes-mcp. Use for collaborator-aware manuscript revisions or image/PDF uploads that must not silently overwrite remote files.
license: MIT
---

# Overleaf Tracked Changes

Use immutable local snapshots for broad reading and the live Overleaf editor for narrow tracked writes. Never use `olcli push`, `olcli sync`, Git upload, or Dropbox sync for concurrent manuscript edits.

Keep four pieces of round state:

- `baseline_snapshot`: the immutable remote snapshot downloaded at the start of the drafting round.
- `working_tree`: the separate local copy that the author edits.
- `pending_plan`: the cached local change plan produced when sync is requested.
- `remote_revision`: the last remote file identity or content fingerprint observed during a prepared read or sync.

Do not rescan or recompare `baseline_snapshot` and `working_tree` after every local edit. Accumulate local edits in `working_tree` and refresh `pending_plan` only when the user asks to sync, the changed file set changes, or a previous plan is invalidated. The final tracked sync must still perform a three-way safety check against the current remote text; caching avoids repeated local scans, not the final conflict check.

## Select the browser path

- Prefer the companion MCP when its tools are available. For reliable visible login, start one persistent Chrome with `overleaf-tracked-changes-mcp browser`, keep a fixed `OVERLEAF_BROWSER_PROFILE`, and connect the MCP through a fixed `OVERLEAF_BROWSER_CDP` such as `http://127.0.0.1:9222`.
- Use the Codex in-app browser only as a visible fallback or for manual inspection. It is a separate session and is not automatically the MCP browser.
- If the MCP tools are missing, explain that installing the Skill alone does not register the MCP. Run `overleaf-tracked-changes-mcp setup codex`, install the printed configuration, and restart Codex.

## First-time setup

1. Run `overleaf-tracked-changes-mcp browser` once from the user's normal terminal. Sign in normally in that visible Chrome, then run `overleaf-tracked-changes-mcp login` to verify the account before checking the project.
2. Set `OVERLEAF_PROJECT_URL` and `OVERLEAF_MCP_LOCAL_ROOT`.
3. Register the MCP client configuration.
4. Use `get_overleaf_status` once to verify login and the project.
5. Use `open_overleaf_file` and `ensure_reviewing` before tracked writes.

Never request passwords, copied cookies, session tokens, or browser-profile files.

## Snapshot-first workflow

1. Call `download_project_snapshot` with an explicit parent directory. It must create a new destination and must not overwrite an existing folder.
2. Treat that snapshot as the immutable baseline for the drafting round.
3. Copy or otherwise prepare a separate working tree for local edits. When the user asks to open or edit the local snapshot, preserve the snapshot and open the working copy instead; report both paths clearly.
4. Read the local tree and relevant files broadly.
5. Keep local editing and document-level validation independent of browser or MCP availability. Do not contact Overleaf for every local edit.
6. Call `preflight_local_document` for the local document check before any browser status or editor operation. It validates the local plan and LaTeX structure, and compiles to a temporary directory when a TeX engine is available.
7. When the user says "sync", interpret it as tracked hunk replay, never whole-file upload.
8. At sync time, call `list_local_changes` once if the changed file set is unknown. Report added, deleted, binary, generated, and skipped files, but do not propagate them through tracked sync.
9. Build or reuse `pending_plan`. Call `plan_local_file_changes` or `preflight_local_document` once for each modified existing text file; repeated calls with unchanged file metadata reuse the cached baseline and plan, while a changed working file refreshes only the working read. The final sync must still compare baseline, working copy, and current remote text at this point.
10. Review safe changes, already-applied changes, and conflicts, and confirm the correct local path. Do not rebuild the plan merely because another local paragraph was edited if the file set and planned hunks are unchanged; rebuild when the edited file or affected hunk changes.
11. Let `sync_local_file_tracked` open the matching file, verify Reviewing, identify the active visible editor, and read the live editor in one prepared pass. Do not prepend separate status, open-file, Reviewing, tab-switch, and read calls unless diagnosing a failure.
12. Repeat `sync_local_file_tracked` with `dry_run: false` only after the plan is confirmed. Keep `allow_partial: false` unless the user explicitly approves applying only the conflict-free changes.
13. Re-read the remote editor and verify tracked insertions/deletions. Record the remote file identity or content fingerprint as `remote_revision`.

Automatically rebase non-overlapping word-level changes, including different words in the same paragraph. Treat an identical remote change as already applied. Different changes to the same token or insertion point are true conflicts and must never be resolved by guessing or last-writer-wins behavior.

For true conflicts, present the local and remote variants, obtain or draft an explicit merged wording, update the working copy, and apply the resolved paragraph through a dry-run tracked replacement. Do not automatically refresh the baseline while suggestions are pending. Download a fresh immutable snapshot after suggestions are accepted or rejected and before the next editing round.

Local tracked sync supports modified existing text files only. Do not propagate new files, deleted files, binary files, or whole-directory deletions. Handle each changed file separately so one drifting file does not affect another.

Ignore generated LaTeX build artifacts reported by `list_local_changes`. A `.bbl` already present in the immutable baseline may be revised and synced as text, but a newly generated `.bbl` is ignored.

## Binary asset upload

- Use `upload_overleaf_file` only when the user explicitly asks to upload a non-text asset such as an image or PDF.
- Run the default dry-run first and report the local SHA-256, size, and exact remote path.
- Reuse the dry-run plan for an unchanged asset. The MCP revalidates the file fingerprint and reads the file once for the confirmed upload.
- Keep `overwrite: false` for new files. If the remote file exists, obtain explicit approval for that exact path before retrying with `overwrite: true`.
- Never use asset upload for `.tex`, `.bib`, `.bbl`, `.sty`, or other tracked text files, and never upload a directory or delete a remote file.

## Preflight and connectivity

Run preflight in two independent phases, local first.

### Local document preflight

Complete these checks before requiring any browser or MCP connection:

- confirm the working file exists and is an existing text file;
- verify the immutable baseline and working copy are separate paths;
- inspect the local diff and line anchors;
- parse or compile the relevant document when the toolchain is available;
- render or inspect the affected document layer when layout or editor anchors matter;
- reject new files, deleted files, binary files, whole-directory deletions, and generated build artifacts according to the sync rules above.

Document-level preflight must produce a useful result even when Overleaf is unreachable. Mark remote checks as `pending` or `blocked` rather than stopping local validation.

### Remote browser preflight

- Prefer an already reachable `OVERLEAF_BROWSER_CDP`. Probe the configured endpoint before starting any browser or persistent profile.
- If the endpoint is reachable, reuse it. Do not launch a second persistent Chrome, create a second profile, or request a new login.
- If a persistent profile reports that it is locked by another Chrome instance, do not close the user's browser and do not retry the same browser startup loop. Connect to the existing reachable CDP endpoint instead.
- Treat `get_overleaf_status` and similar status calls as advisory, not as prerequisites for local document preflight. Give a status probe a short bounded timeout and at most one retry; if it hangs, bypass it and use the prepared open/read or sync call.
- If no remote connection can be established, finish local preflight and report that tracked sync is pending. Do not spend the remainder of the run retrying browser startup or MCP status.

## Browser lifecycle

- `browser` starts or reuses a visible Chrome on a fixed local CDP endpoint and returns without closing Chrome.
- `doctor` reports status and exits without closing an externally connected Chrome.
- `open` reuses the persistent browser, completes login if needed, and opens the configured project.
- `OVERLEAF_BROWSER_PROFILE` contains login state. Keep it private and outside Git repositories.

Use `doctor` only for explicit diagnostics or when the endpoint probe fails. Do not run `browser`, `doctor`, `get_overleaf_status`, and `open` as a mandatory chain before every local edit or every dry-run.

## Active editor selection

After switching tabs, never read the first CodeMirror instance returned by the page. Overleaf pages may contain multiple mounted editors, hidden editors, stale tab editors, or preview-related CodeMirror nodes.

Use this order:

1. identify the requested file by the visible tab label, file path, or accessible editor/file attribute;
2. restrict candidates to attached, visible editors with a non-zero bounding box;
3. prefer the editor associated with the active tab and the requested file identity;
4. after tab activation, wait for the file identity to settle, then read the editor again;
5. verify the returned text with a filename/path sentinel, line count, or a nearby unique hunk anchor before diffing or writing.

If more than one visible editor still matches, stop the remote read rather than guessing. Use the prepared direct file-open/current-visible-tab fallback if available, or report an editor-identity failure. Do not cycle tabs repeatedly and do not resolve ambiguity by selecting the first CodeMirror node.

When `sync_local_file_tracked` is available, prefer its single prepared pass for opening, Reviewing verification, active-editor selection, and remote read. Do not call status, open-file, tab-switch, and editor-read separately unless the prepared pass reports a specific diagnostic failure.

## Hung connection and wrong-editor fallback

- A hung status call is not evidence that the document is unavailable. Bypass the status call and continue with the prepared read/sync path.
- A wrong editor read is an editor identity failure, not evidence of content loss. Re-identify the active visible editor using the requested file identity and a unique local hunk anchor.
- If the remote page is usable through the existing CDP but the MCP browser process has not inherited the CDP setting, use the existing CDP endpoint rather than starting another persistent Chrome.
- If the prepared remote read cannot be made unambiguous within one fallback attempt, stop before any write and show the local hunk plus the remote-read limitation.

## Safety rules

- Default every write operation to dry-run.
- Keep edits paragraph-scale or smaller and batch only independent hunks.
- Stop when Reviewing is unclear, the file is wrong, or a true overlapping conflict remains unresolved.
- A complete project snapshot is read-only input, never a payload for whole-file synchronization.
- Refresh the baseline after suggestions are accepted or rejected before starting another drafting round.
