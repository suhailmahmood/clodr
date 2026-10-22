# Clodr

[![npm](https://img.shields.io/npm/v/clodr-cli)](https://www.npmjs.com/package/clodr-cli)

Clodr - manage all your Claude Code sessions from a single menu.

Starts or resumes Claude Code sessions in per-project folders under a workspace folder, lists your sessions in every other project, and cleans up leftovers. Cross-platform (Windows, macOS, Linux), Node ≥ 18, zero dependencies.

## Install

Needs Node ≥ 18 and git.

```sh
npm install -g clodr-cli
clodr setup
```

Or straight from GitHub: `npm install -g github:suhailmahmood/clodr`.

From a clone: `npm install -g .` (or `npm link` while developing), then `clodr setup`.

Update: rerun the install command, then `clodr setup` again if the shell wrapper changed (it rewrites its own block, nothing is duplicated). Uninstall: see below.

`clodr setup` adds **shell integration**: a marked `# >>> clodr >>>` block in your bash / zsh / PowerShell profiles. The block defines a `clodr` function that runs the program and then `cd`s your shell into the folder you picked, so you stay there after Claude exits. While Clodr runs, the shell waits in the temp folder (Windows cannot delete a folder that is some process's working directory); if you quit without picking anything you land back where you started. Workspaces are managed inside Clodr (Settings › Manage workspaces); until a config file exists it uses `~/Workspace`.

cmd and fish get no wrapper: Claude still launches in the folder, your shell just does not `cd` afterwards.

Remove the shell integration: `clodr setup --remove`, then `npm uninstall -g clodr-cli`.

Config lives in `%APPDATA%\clodr\config.json` (Windows) or `~/.config/clodr/config.json` (`CLODR_HOME` overrides): `workspaces` (`[{path, name?}]`, in order), `view` (a workspace path or `else`).

Requirements: `claude` on `PATH`. Cleanup of orphaned projects needs Claude Code v2.1.288+ (`claude purge`).

## Usage

| Command | Behavior |
|---|---|
| `clodr` | Arrow-key menu (most recent session activity first, cyan `●` = has session). `↑`/`↓` (also `Home`/`End`/`PgUp`/`PgDn`) move, `Enter` resumes the highlighted folder. Digits jump to that number. `o` opens the highlighted folder in the file manager (with nothing listed it opens the workspace). `Del` or `d` deletes the highlighted folder and its Claude sessions after a red `[y/N]` confirm (only `y` confirms). `n` = new project: asks for a name and creates that folder in the current workspace (`Esc` there goes back). `s` = settings. `q` quits (`Esc` does nothing on the main screen; on every other page it goes back). |
| `clodr setup` | Add shell integration (see Install). `--remove` removes it. |
| `clodr --help` | Usage, and what setup does. |

### Tabs

`←`/`→` switch tabs: one per workspace (in the order set in Settings), then **Everything else** at the right end. When there are too many tabs for the screen width, the bar scrolls around the active one (`‹` / `›` mark hidden tabs). The last used tab is remembered (`view` in `config.json`).

| Tab | Shows |
|---|---|
| **Workspace** | Every folder directly inside the workspace, plus deeper folders under it that have a Claude session (shown relative to the workspace). Delete removes the folder and its sessions. `n` creates a new project here. |
| **Everything else** | Every existing folder with a Claude session outside all workspaces, as folder name plus dimmed parent path. Delete removes only that folder's Claude sessions, never the folder. |

Workspaces can be nested: if `D:\Workspace` and `D:\Workspace\Clones` are both workspaces, everything rooted in `Clones` (the folder itself and any folder below it) is shown only under `Clones`, not under `D:\Workspace`. A workspace root itself is never listed as a folder.

### Settings

- **Manage workspaces** (own page): one row per workspace. `a` adds one (full path, `~` and `%VAR%` expand; then an optional name: empty = folder name). `Enter` renames, `Ctrl+↑`/`Ctrl+↓` move up/down, `Del`/`d` removes it from the list (folder kept).
- **Cleanup**: checkbox list of
  - **Orphaned projects**: session folders whose project folder is gone (or never recorded), plus `~/.claude.json` project entries for deleted folders. Removed with `claude purge` (transcripts, file history, config entry, history lines). Folders on an unplugged drive are never treated as orphans. For sessions with no recorded folder, the folder is derived from the session dir name, so a config entry / prompt history may remain.
  - **Legacy `~/.claude.json.backup*` files**.

  `Space` toggles, `Enter` opens a review screen listing exactly what will be removed, then one `[y/N]`. Refused while Claude is running. A `.bak` copy of `~/.claude.json` and `history.jsonl` is kept first (one each, overwritten next time). Orphan cleanup is disabled with a message if the installed `claude` has no `purge`.

### Session detection

Claude stores sessions at `~/.claude/projects/<folder path, every non-alphanumeric char → "-">/*.jsonl` (`CLAUDE_CONFIG_DIR` honored). That encoding is lossy, so the real folder is read from the `cwd` recorded inside the transcripts.

## Tests

```sh
npm test
```

Headless: a scripted terminal feeds keys to the real screens and frames are asserted on; a stub `claude` on `PATH` stands in for purge. Everything runs in a temp dir (own `CLAUDE_CONFIG_DIR` and `CLODR_HOME`).

## Code

`bin/clodr.js` (CLI), `src/` (core: config, sessions, cleanup categories, setup shells), `src/ui/` (screens and shared drawing helpers), `test/`.
