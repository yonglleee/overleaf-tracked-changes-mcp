# Architecture

The server deliberately separates reading from writing.

## Broad local read

The tools `read_project_tree`, `read_local_file`, and `search_project` operate on a local Overleaf project folder. They are intended for manuscript understanding: section structure, citations, table files, figure names, and terminology. They never write to Overleaf.

## Narrow remote write

The tool `replace_text_tracked` operates on the currently open Overleaf editor through a logged-in browser session. It does not call `olcli push`, `olcli sync`, Git push, Dropbox sync, or the Overleaf upload endpoint.

The write path is:

1. Connect to a browser over Chrome DevTools Protocol.
2. Read the current CodeMirror document text from the Overleaf web editor.
3. Require an exact unique `expected_text` match.
4. Default to dry-run.
5. When `dry_run=false`, call `view.dispatch({ changes })` on CodeMirror.
6. Read the document back and verify the replacement.

## Safety assumptions

- The target file is already open in Overleaf for v0.1.
- Reviewing/Track Changes mode should be enabled in the Overleaf UI.
- The MCP refuses to write when reviewing mode is required but not detected.
- The MCP refuses missing or duplicate anchors.

## Future work

- Add robust file-tree opening by path.
- Add visible tracked-change signal checks.
- Add comment insertion.
- Add compile support through Overleaf UI or `olcli compile`.
- Add an optional ShareJS/OT implementation after disposable-project testing.