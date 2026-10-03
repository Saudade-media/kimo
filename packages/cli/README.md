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
