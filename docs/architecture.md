# Architecture

The server separates complete read snapshots from narrow tracked writes.

## Complete project snapshots

`download_project_snapshot` downloads Overleaf's Source ZIP through the authenticated browser context. The archive is size-limited, checked for unsafe paths, and extracted through a ZIP library into a new directory. Existing destinations are rejected and partial extraction directories are removed on failure.

Snapshots are immutable baselines. They are not live synchronization and are never uploaded as complete files.

## Broad local read

`read_project_tree`, `read_local_file`, and `search_project` operate on a local snapshot or working copy. They provide manuscript context without writing to Overleaf.

## Narrow remote write

`replace_text_tracked` and `replace_texts_tracked` operate on the current Overleaf CodeMirror editor through a logged-in browser session. They do not call `olcli push`, `olcli sync`, Git push, Dropbox sync, or the Overleaf upload endpoint.

The write path is:

1. Launch a persistent managed Chrome profile or connect to external Chrome over CDP.
2. Reuse the requested file when it is already open; otherwise select it without waiting on unrelated navigation tabs.
3. Verify Reviewing and read the current remote CodeMirror document from the same prepared page.
4. Require each `expected_text` to be exact and unique.
5. Default to dry-run and reject overlapping actual write ranges. Unique anchor contexts may overlap.
6. Remove common prefix and suffix text to minimize the dispatched range.
7. Dispatch up to 40 independent changes in one transaction.
8. Compare tracked-change DOM snapshots from immediately before and after dispatch, then read the document back and verify every replacement.

## Browser surfaces

The MCP browser and the Codex in-app browser are separate sessions. The recommended desktop path is one visible Chrome process with a stable user-data directory and fixed local CDP endpoint. `browser` starts or reuses that Chrome; MCP commands connect without owning or closing it. Login persistence belongs to the profile directory, not the port. The managed-profile launcher remains a fallback when `OVERLEAF_BROWSER_CDP` is not configured.

## Local drafting

Safe local-to-Overleaf revision uses a live three-way rebase:

1. Download an immutable remote snapshot.
2. Edit a separate local working copy.
3. Derive word-level atomic changes from baseline to working copy and from baseline to the live remote editor.
4. Preserve remote-only changes, recognize identical changes as already applied, and map non-overlapping local changes onto current remote offsets.
5. Build unique remote anchors around each mapped local change and dry-run the actual write ranges.
6. Report overlapping token changes as conflicts and never choose a winner automatically.
7. Replay safe changes only after confirmation. Partial application while conflicts remain requires explicit `allow_partial: true`.

The immutable baseline records local intent; it is not replaced before sync. The live remote editor supplies current collaboration state. Automatic baseline refresh is intentionally avoided while tracked suggestions are pending because later acceptance or rejection can change the authoritative text.

`list_local_changes` inventories the baseline and working trees without touching Overleaf. Generated LaTeX build outputs are ignored; a `.bbl` that already belongs to the baseline remains trackable. `plan_local_file_changes` creates local-only hunks for one existing text file. `sync_local_file_tracked` composes one prepared-editor pass, the live three-way plan, remote file selection, Reviewing verification, conflict policy, and tracked batch dispatcher. File creation, file deletion, and binary synchronization are deliberately excluded.

## Current limitations

- Nested files must be visible in the expanded file tree before automatic selection.
- Reviewing detection and CodeMirror access depend on Overleaf's current UI.
- Comment insertion and suggestion acceptance/rejection are not implemented.
- Direct ShareJS/OT access remains intentionally out of scope until disposable-project testing supports it.
