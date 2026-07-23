# Overleaf Tracked Changes MCP

Download a complete Overleaf project for local AI-assisted drafting, then replay only selected exact changes into the live editor as reviewable suggestions. The MCP never uploads a whole `.tex` file.

> Read broadly from an immutable local snapshot. Write narrowly through Overleaf Reviewing.

## What you get

- persistent Overleaf login in a dedicated Chrome profile;
- visible project browser with automatic relaunch after Chrome is closed;
- complete read-only project snapshots downloaded to new local directories;
- automatic baseline-to-working-copy diff planning for local edits;
- local project tree, file reading, and search tools;
- remote file opening and Reviewing-mode setup;
- exact single or batch tracked replacements;
- dry-run by default, unique-anchor checks, and collaborator drift protection;
- fast prepared-editor sync that reuses the open file, browser connection, and Reviewing check;
- per-write tracked-suggestion verification that does not mistake older suggestions for the new edit;
- an Agent Skill for Codex and other AgentSkills-compatible agents.

## Install for Codex

Install the Agent Skill at user scope:

```bash
npx skills add yonglleee/overleaf-tracked-changes-mcp --agent codex --skill overleaf-tracked-changes --global --yes
```

Or use GitHub CLI:

```bash
gh skill install yonglleee/overleaf-tracked-changes-mcp overleaf-tracked-changes --agent codex --scope user
```

Install the MCP executable directly from GitHub until an npm package is published:

```bash
npm install -g github:yonglleee/overleaf-tracked-changes-mcp
```

Installing the Skill does not register the MCP server. Set the project first, then print the Codex configuration:

```powershell
$env:OVERLEAF_PROJECT_URL = "https://www.overleaf.com/project/YOUR_PROJECT_ID"
$env:OVERLEAF_MCP_LOCAL_ROOT = "C:\path\to\local\manuscript"
overleaf-tracked-changes-mcp setup codex
```

Add the printed TOML to `%USERPROFILE%\.codex\config.toml` on Windows or `~/.codex/config.toml`, then restart Codex.

For another AgentSkills-compatible agent, select the agent interactively:

```bash
npx skills add yonglleee/overleaf-tracked-changes-mcp
```

## Login and persistent browser

Start or reuse one visible Chrome window with a fixed profile and fixed CDP endpoint:

```bash
overleaf-tracked-changes-mcp browser
```

The command returns after Chrome is ready, but Chrome stays open. Sign in normally, then verify login and project access:

```bash
overleaf-tracked-changes-mcp login
```

Passwords and copied cookies are never requested by this project. Login state stays in the same dedicated browser profile across commands. The default endpoint is `http://127.0.0.1:9222`; changing the port does not preserve login, while keeping `OVERLEAF_BROWSER_PROFILE` stable does.

Chrome cannot enable CDP after it is already running. Therefore the MCP cannot attach to an ordinary Chrome window that was originally started without `--remote-debugging-port`. The `browser` command intentionally creates one dedicated Chrome the first time, then activates and reuses its existing Overleaf tab on later commands instead of opening another profile or tab.

The first connection is intentionally two-stage: finish Overleaf login (including any Google OAuth redirect) first, then the CLI opens `OVERLEAF_PROJECT_URL` and reports whether that account can access the project. An external identity-provider page is never treated as a completed Overleaf login.

Use `doctor` for a quick check that exits immediately:

```bash
overleaf-tracked-changes-mcp doctor
```

Use `open` to reuse that browser, finish login if needed, and open the configured project:

```bash
overleaf-tracked-changes-mcp open
```

The Codex in-app browser and the MCP-managed Chrome profile are separate browser sessions. The Skill may use the in-app browser for visible manual work, but MCP tools use the managed profile or an explicitly configured CDP browser.

## Download the complete project

Create an immutable timestamped snapshot under a parent directory:

```powershell
overleaf-tracked-changes-mcp snapshot "D:\Paper\overleaf-snapshots"
```

Or choose a new folder name:

```powershell
overleaf-tracked-changes-mcp snapshot "D:\Paper\overleaf-snapshots" baseline-2026-07-23
```

The command downloads Overleaf's complete Source ZIP through the authenticated browser session, validates the archive, and extracts it into a new directory. It refuses an existing destination and never propagates deletions or overwrites local files.

Snapshots are for reading, baselines, and local drafting. Do not send the complete snapshot back with `olcli push`, `olcli sync`, Git upload, or Dropbox sync when collaborators may be editing.

## Safe editing workflow

1. Download a complete remote snapshot.
2. Keep the snapshot unchanged as the baseline and make a separate working copy.
3. Open the working copy as the Codex workspace and edit `.tex`, `.bib`, and related text files locally. This is faster than browser keystroke automation.
4. Ask the agent to `sync manuscript.tex`. The Skill interprets sync as:
   - call `list_local_changes` when the changed files are not already known;
   - compare the baseline file with both the local working file and the current Overleaf file;
   - rebase non-conflicting local changes onto the current remote text;
   - open the matching Overleaf file and verify Reviewing;
   - run `sync_local_file_tracked` with `dry_run: true`;
   - apply only after the plan is confirmed.
5. The agent may explicitly open the target remote file first:

   ```bash
   overleaf-tracked-changes-mcp open-file manuscript.tex
   ```

6. Re-read the editor and confirm Overleaf shows suggestions attributed to the intended account.

Before every sync, the MCP reads the live Overleaf file. It does not replace the original baseline. The baseline preserves local intent while the live file supplies the current collaboration state.

`sync_local_file_tracked` prepares the target editor, checks Reviewing, and reads the live file in one browser pass. Agents should call this combined tool directly instead of separately calling status, open-file, Reviewing, and read tools before every sync. Newly generated LaTeX build artifacts such as `.aux`, `.log`, `.fls`, and `.synctex.gz` are reported as ignored rather than manuscript changes. A `.bbl` already present in the baseline remains trackable for submission workflows.

Here, **sync** means replaying verified text hunks through Overleaf Reviewing. It never means uploading the working file. New files, deleted files, and binary files are not propagated by local tracked sync.

### Multi-author behavior

`sync_local_file_tracked` performs a three-way comparison of the immutable baseline, local working copy, and current Overleaf text:

- Remote edits in other paragraphs are preserved automatically.
- Different word-level edits in the same paragraph are rebased and can be synced together.
- A remote edit identical to the local edit is reported as already applied and is not written again.
- Different edits to the same word or insertion point are reported as conflicts; the MCP never guesses which wording should win.
- By default, any true conflict blocks writes for that file. Set `allow_partial: true` only after reviewing the dry-run to apply the non-conflicting changes while leaving conflicts untouched.

Resolve a true conflict by choosing the combined wording against the current remote text, updating the local working copy to that wording, and applying the resolved paragraph as a reviewed tracked replacement. After suggestions are accepted or rejected and the remote project is stable, download a new snapshot for the next editing round. The MCP deliberately does not auto-refresh the baseline while suggestions are still pending.

### Everyday agent workflow

You do not need to keep Overleaf open while drafting. A typical conversation with Codex is:

1. **"Download the latest Overleaf snapshot and prepare a local working copy."**
   The downloaded snapshot remains unchanged as the baseline; Codex opens and edits a separate copy.
2. **"Revise the introduction in the local copy."**
   Reading, searching, and rewriting happen entirely on local files, so this step is fast.
3. **"Sync."**
   The agent lists changed files, performs a live three-way dry-run, reports any conflicts, and then replays only confirmed safe hunks through Reviewing.

The local working copy may contain the complete project, but it is never uploaded as a complete project or file. Overleaf is only contacted when taking a fresh snapshot, checking remote drift, or applying tracked suggestions.

## MCP tools

- `get_overleaf_status`: report browser, login, project, open file, and Reviewing state.
- `download_project_snapshot`: download and extract the complete project into a new local snapshot.
- `open_overleaf_file`: open a file visible in the expanded Overleaf file tree.
- `ensure_reviewing`: switch the open editor from Editing to Reviewing and verify it.
- `list_local_changes`: identify modified, added, deleted, unsupported, and ignored LaTeX build artifacts across baseline and working trees.
- `plan_local_file_changes`: compare one baseline file with its local working copy without accessing Overleaf.
- `sync_local_file_tracked`: three-way rebase one local file against current Overleaf, then dry-run or replay safe hunks as suggestions; partial conflict-free application is explicit opt-in.
- `read_project_tree`: inspect a local snapshot or working tree.
- `read_local_file`: read one local project file.
- `search_project`: search local LaTeX project files.
- `read_open_overleaf_editor`: read the current live remote editor.
- `replace_text_tracked`: apply one exact tracked replacement; dry-run by default.
- `replace_texts_tracked`: apply up to 40 non-overlapping tracked replacements in one transaction.

## Advanced browser connection

The managed persistent profile is the default. To reuse Chrome or Edge that you start yourself:

```powershell
$env:OVERLEAF_BROWSER_CDP = "http://127.0.0.1:9222"
```

Optional settings:

- `OVERLEAF_BROWSER_PROFILE`: custom managed profile directory. Keep it private and outside any Git repository because it contains login state.
- `OVERLEAF_BROWSER_CHANNEL`: Playwright browser channel, default `chrome`.
- `OVERLEAF_BROWSER_CDP`: external Chrome/Edge debugging endpoint; disables managed startup.
- `OVERLEAF_PROJECT_URL`: default Overleaf project URL.
- `OVERLEAF_MCP_LOCAL_ROOT`: default local snapshot or working-copy root.

## Development

Requirements: Node.js 20+ and Google Chrome.

```bash
git clone https://github.com/yonglleee/overleaf-tracked-changes-mcp.git
cd overleaf-tracked-changes-mcp
npm install
npm run check
node dist/src/index.js --help
```

## Safety and limitations

- Test tracked writes on a disposable project first.
- A snapshot is a point-in-time download, not live bidirectional synchronization.
- Local tracked sync supports existing text files; it does not create or delete remote files.
- Nested files must currently be visible in the expanded Overleaf tree before `open_overleaf_file` can select them.
- Reviewing detection and CodeMirror access depend on Overleaf's current web UI.
- The server does not accept or reject suggestions and does not yet add comments.
- Never commit or share the managed browser profile.

## Version 0.4.1

- Removes the 15-second false wait caused by treating the selected File tree tab as the open manuscript file.
- Reuses one prepared browser/editor state during local tracked sync.
- Verifies that the tracked-change DOM changed during this write, rather than accepting any older suggestion as proof.
- Uses one persistent-profile path across CLI and MCP launch modes.
- Filters generated LaTeX build artifacts from local change plans.

## License

MIT

## Acknowledgements

Thanks to [cellis212/overleaf-tracked-changes-mcp-guide](https://github.com/cellis212/overleaf-tracked-changes-mcp-guide) for documenting and sharing an Overleaf tracked-changes workflow that helped inform this project.
