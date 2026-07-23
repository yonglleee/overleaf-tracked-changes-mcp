# Architecture

The server deliberately separates reading from writing.

## Broad local read

The tools `read_project_tree`, `read_local_file`, and `search_project` operate on a local Overleaf project folder. They are intended for manuscript understanding: section structure, citations, table files, figure names, and terminology. They never write to Overleaf.

## Narrow remote write

The tools `replace_text_tracked` and `replace_texts_tracked` operate on the currently open Overleaf editor through a logged-in browser session. They do not call `olcli push`, `olcli sync`, Git push, Dropbox sync, or the Overleaf upload endpoint.

The write path is:

1. Launch a persistent managed Chrome profile, or connect to an optional external browser over Chrome DevTools Protocol.
2. Read the current CodeMirror document text from the Overleaf web editor.
3. Require an exact unique `expected_text` match.
4. Default to dry-run.
5. Remove common prefix and suffix text so each replacement becomes the smallest possible insertion, deletion, or replacement.
6. When `dry_run=false`, call `view.dispatch({ changes })` on CodeMirror. Batch mode sends up to 40 non-overlapping changes in one transaction.
7. Read the document back once and verify every replacement.

## Local drafting

Safe local-to-Overleaf synchronization is a three-way workflow:

1. Preserve the remote file at the start of a drafting round as the baseline.
2. Edit a separate local working copy.
3. Replay only baseline-to-working-copy hunks whose exact anchors still match the live remote file.

The baseline prevents unrelated collaborator changes from being interpreted as local deletions. A changed or ambiguous anchor blocks the batch.

## Safety assumptions

- The target file is already open in Overleaf for v0.3.
- Managed Chrome is relaunched after closure and reuses its saved Overleaf session.
- Reviewing/Track Changes mode should be enabled in the Overleaf UI.
- The MCP refuses to write when reviewing mode is required but not detected.
- The MCP refuses missing or duplicate anchors.

## Future work

- Add robust file-tree opening by path.
- Add comment insertion.
- Add compile support through Overleaf UI or `olcli compile`.
- Add an optional ShareJS/OT implementation after disposable-project testing.
