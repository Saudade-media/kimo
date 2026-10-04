# @kimo/cli — `kimo`

The Kimo command line. It works offline, needs no account, and runs with Bun:

```sh
bunx kimo --help                    # from the repository (workspace bin)
bun packages/cli/src/main.ts --help # the same, without the bin link
```

| Command | What it does | Exit codes |
|---|---|---|
| `kimo merge <base> <ours> <theirs> [path]` | Semantic three-way merge of `.kimo` files; the git merge driver | 0 clean · 1 conflicts stored · 2 not mergeable |
| `kimo gc <file> [--yes]` | Removes asset files nothing references | 0 ok · 2 unreadable · 3 locked |
| `kimo validate <file…>` | Schema, references, cycles and lints | 0 valid · 1 errors · 2 unreadable |
| `kimo mcp [--attach\|--headless]` | MCP server for coding agents on stdio | 0 when the agent host disconnects |
| `kimo mcp install\|remove\|status` | The `kimo` entry in agent host configs | 0 ok · 1 a config was refused (unparsable) or kept changing |

Malformed command lines exit with 64.

## `kimo merge`: the git merge driver

`.kimo` files are laid out so that plain `git merge` is clean in the common case (spec §18). For
the rest, `kimo merge` merges **semantically**: per node and per property, per variable (and
per themed entry), per header member. It never drops a side silently. Disagreements it cannot
settle are stored **in the file** as merge conflicts (spec §21), so the result is still valid
JSON that validates, renders, and opens in Kimo with the Conflicts tab (board 18).

Set it up per repository (the desktop app's Settings › Git merge driver does exactly this):

```sh
git config merge.kimo.name "Kimo semantic merge"
git config merge.kimo.driver "kimo merge %O %A %B %P"
echo '*.kimo merge=kimo diff=kimo' >> .gitattributes
```

Git runs it as `kimo merge <base=%O> <ours=%A> <theirs=%B> <path=%P>`, and the result is
written into `%A`.

- **0, clean.** `%A` holds the canonical merged document.
- **1, conflicts stored.** `%A` holds a valid document with a `conflicts` table and `merge`
  labels. Git marks the path as conflicted. Open it in Kimo, pick a side per row (or "Take all
  ours / theirs"), then **Mark resolved & save**, and commit.
- **2, not mergeable.** An input is unparsable, invalid or uses a newer format. `%A` gets git's
  textual merge with ordinary conflict markers. The editor's failed-load banner explains them.

Options:

- `-o <file>` writes the result somewhere else and leaves `<ours>` untouched.
- `-L <ours>,<base>,<theirs>` gives display labels stored in `merge` (for example
  `-L %X,%S,%Y` on git versions that support those placeholders). The order is the same as
  `git merge-file -L`.
- `--marker-size <n>` sets the marker size of the textual fallback (`%L`).

Custom merge drivers only run where they are configured locally. GitHub and GitLab merges and
CI checkouts ignore `merge=kimo`. You can also run `kimo merge` as a pre-merge step in CI.

The merge itself is `mergeDocuments` in `@kimo/core-schema` (`src/merge/three-way.ts`). The
editor uses the same function when the file changes on disk while you have unsaved edits.

## `kimo gc`

Assets are content-addressed and merge add-only (spec §12), so files that nothing references
build up in `assets/`. `kimo gc home.kimo` lists them (a dry run). `kimo gc home.kimo --yes`
deletes them and removes their asset-manifest entries from the document with an atomic write.

`--yes` refuses to change anything while another process holds the file's lease (exit 3). The
editor may have unsaved edits that use an asset. A lease whose process is gone is ignored.
Leases live in `~/.kimo/locks`, or under `$KIMO_HOME/locks` when `KIMO_HOME` is set.

## `kimo validate`

```sh
kimo validate design/*.kimo            # human-readable
kimo validate --json home.kimo         # machine-readable
kimo validate --strict home.kimo       # warnings fail too (e.g. CONFLICT_OPEN in CI)
```

Imported libraries are read relative to each file. The `assets/` folder listing is passed in,
so references to missing asset files are errors. Stored merge conflicts are warnings
(`CONFLICT_OPEN`), so a half-resolved merge still opens. Use `--strict` in CI to flag
unfinished merges.

## `kimo mcp`: Kimo for coding agents

`kimo mcp` speaks MCP on stdin/stdout (ADR 0013 §8). Agents get the same tool set as the
desktop app (`kimo_get_state`, `kimo_open`, `kimo_query`, `kimo_apply_ops`, `kimo_render`, …)
and read the guides with `kimo_read_docs` (also in [docs/agents](../../docs/agents/index.md)).

- **Auto (default).** When the Kimo app is running (`~/.kimo/mcp/endpoint.json` names a live pid
  and the socket accepts the `kimo/hello` with the token from `~/.kimo/mcp/token`), it relays
  to the app. Agent edits then appear live in the editor, with the app's permissions and approval
  prompts. Otherwise it runs **headless**.
- **`--attach`.** Relay only. Without the app, `initialize` and `tools/list` are answered locally
  and every tool call returns `APP_NOT_RUNNING`. It attaches when the app starts and replays the
  session's `initialize`. If the app restarts, calls in flight fail with `TIMEOUT` (retryable)
  and the relay reconnects for 30 s.
- **`--headless`.** Files are opened in memory by this process. It takes the file's lease
  (`kimo mcp (headless)`), so the app and other processes see the file as locked. It saves
  atomically with read-back, autosaves after 2 s idle (`--no-autosave` leaves saving to
  `kimo_save`), and saves on exit, or writes `~/.kimo/recovery/<id>.kimo` if that fails. There is
  no UI, so anything that would need an approval is denied.
  - `--allow read|edit|edit+delete` sets the permission level (default `edit+delete`).
  - `--files <glob>` sets the file allow-list, repeatable (default `<cwd>/**`). A glob passed
    to `--allow` is also accepted (ADR spelling).

The process exits when stdin closes or when its parent process disappears.

### Installing into agent hosts

```sh
kimo mcp install                       # every agent host found on this machine
kimo mcp install --host claude-code    # or codex, gemini, cursor, vscode, all
kimo mcp install --project --dir .     # project files (.mcp.json, .codex/config.toml, …)
kimo mcp install --dry-run             # show the change, write nothing
kimo mcp status                        # installed / outdated / not installed, per host
kimo mcp remove --host all
```

| Host | User scope (default) | Project scope |
|---|---|---|
| Claude Code | `~/.claude.json` → `mcpServers.kimo` | `.mcp.json` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.kimo]` | `.codex/config.toml` |
| Gemini CLI | `~/.gemini/settings.json` → `mcpServers.kimo` | `.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` → `mcpServers.kimo` | `.cursor/mcp.json` |
| VS Code | user `mcp.json` (macOS `~/Library/Application Support/Code/User/`) → `servers.kimo` | `.vscode/mcp.json` |

Rules: the installer changes only the `kimo` entry and keeps every other key, entry and the
file's indentation and permissions. It backs up to `~/.kimo/mcp/backups/<host>-<ts>.bak` before
each write and writes atomically. Running it twice changes nothing. A file it cannot parse
(JSON with comments, broken TOML) is never rewritten: it prints the snippet to paste instead
and exits 1.

**Claude Code and `~/.claude.json`.** Claude Code rewrites this file often. Kimo keeps the
user scope as the default, because that is where Claude Code users expect servers. Every write
is **compare-and-swap**: the file is re-read just before the atomic rename, and if Claude Code
changed it in the meantime, the edit is recomputed from the new content (up to 5 times). A
concurrent write is merged, never lost. Use `--project` for a checked-in `.mcp.json` instead.

**Which command is written.** If the Kimo app is installed, the installer writes its bundled
`kimo-mcp` shim (`/Applications/Kimo.app/Contents/MacOS/kimo-mcp`, also looked up in
`Contents/Resources/`, `~/Applications`, `/usr/bin`, `/opt/Kimo` and `%LOCALAPPDATA%\Programs\Kimo`)
with `--client <host>`. Otherwise it writes `bunx @kimo/cli mcp --client <host>`. Override the
command with `--command <path>` or `$KIMO_MCP_SHIM`, or force the CLI with `--cli`. Re-running
`install` after installing the app switches existing entries over (`status` shows them as
outdated until then). `--transport http` writes the Streamable HTTP entry with the per-host
token from `~/.kimo/mcp/http-tokens.json` (turn on HTTP in Settings › Agents first).
