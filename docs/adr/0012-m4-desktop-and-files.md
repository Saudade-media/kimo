# 0012. M4 desktop and files: stored merge conflicts, `@kimo/platform`, the document session and the Tauri command surface

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** maintainers (M4 contract phase, before the parallel build)
- **Teardown refs:** 9.1 (layout and dependency rules), 9.2 (Desktop, MCP sidecar, Fonts rows), 9.3 (persistence pipeline), 9.4 (document authority, single writer, failed loads terminal, URI resolver, watching + three-way merge, git-operation detection), 10.2 rules 6–8, 12 (M4 row)
- **Amends:** [0002](0002-document-authority-in-tauri.md) (staging of the document host, §2 below)

## Context

M4 turns the browser editor into a desktop app that edits real `.kimo` files next to code: open
and save through native dialogs and file association, atomic save with read-back, crash
recovery, migration consent, a per-file lease, file watching with hot reload, git-operation
detection, `kimo merge`, custom fonts with a cache, asset import and `kimo gc`, and an updater.
The designs exist: boards 02d (components), 16 (desktop Home and editor), 17 (files and
recovery), 18 (merge conflicts) and 19 (fonts, assets and settings) in `desing.pen`.

Four builders work in parallel, so the seams must be fixed first: how merge conflicts live on
disk (the format), what the editor may ask of its host (`@kimo/platform`), how one open file
behaves over its lifetime (the document session), and what the Rust shell exposes (Tauri
commands). Decisions already taken by the maintainers and recorded here:

- Windows and Linux use **native window decorations** (`decorations: true`) with no
  traffic-light inset; only macOS chrome is designed (02d "Window chrome").
- **Settings** is a separate window on desktop (⌘,) and an in-app dialog on the web.
- **Git-operation detection** applies only to the repository that contains the open file.
- The **update channel feed and repository link are placeholders**
  (`UPDATE_FEED_PLACEHOLDER`, `REPO_URL_PLACEHOLDER` in `@kimo/platform`).

## Decision

### 1. Format: merge conflicts are stored in the document (spec §21)

`kimo merge` never drops a side silently. Every disagreement it cannot settle becomes an entry
of a new root **table `conflicts`** (id → Conflict), with display labels in a root **`merge`**
struct (`base`, `ours`, `theirs`, `changes`), both behind the feature flag
**`merge/conflicts`**. The body of the document (nodes, variables, header) holds the side named
by each entry's `applied`, so the file is valid JSON, validates, renders and round-trips
byte-stably; the editor loads it like any document.

- Five kinds cover board 18: `prop` (node + JSON Pointer: "fill · both changed"), `node`
  (delete vs edit or type change, with `restored` snapshots so picks are reversible), `move`
  (Placement on all three sides: "parent · moved twice"), `variable` (whole variable, or one
  themed entry by exact `when`: "$brand · light"), and `header` (pointer into
  meta/themes/imports/assets/components).
- A missing `base`/`ours`/`theirs` key means "absent on that side". `applied` ∈
  ours/theirs/base/edited; `resolved` (default false) drives "3 of 5 resolved" and the
  ConflictRow/Resolved state, and survives saving.
- Saving with open conflicts writes them as they are. "Mark resolved & save" is
  `finishMerge`: it removes `conflicts`, `merge` and the feature, and is refused while any
  entry is open.
- Validation: `MERGE_WITHOUT_CONFLICTS`, `CONFLICT_PATH_INVALID`, `CONFLICT_DUPLICATE`
  (errors), `CONFLICT_OPEN`, `CONFLICT_STALE` (warnings, so a hand edit never makes a file
  read-only); whole-document runs only.
- Serialization: `merge` and `conflicts` are **root-only** members ranked after `components`;
  Appendix A stays frozen (no new ranked keys), and `conflicts` uses the table layout. Older
  readers do not know the feature, so they open such files read-only and never re-serialize
  them.
- Reference semantics live in `@kimo/core-schema` (`listConflicts`, `applyConflictSide`,
  `applyAllConflicts`, `markConflictEdited`, `finishMerge`, `attachConflicts`,
  `conflictMatchesBody`) with fixtures (`lint/CONFLICT_OPEN--board-18.kimo` reproduces board
  18) and tests. The three-way merge itself has a fixed signature, `ThreeWayMerge`
  (`src/merge/types.ts`), and exit codes `MERGE_EXIT` (0 clean, 1 conflicts stored, 2 not
  mergeable: the driver leaves git's text result).

### 2. Document authority: Option A stands, staged (amends 0002)

ADR 0002's **Option A** (one document host, windows are clients; Rust routes and never owns
content) remains the decision; Option B stays rejected. For M4 the host module runs
**co-located in the editor window** that shows the document, which is the arrangement 0002 §4
already specifies for the web build. The hidden-webview host arrives with M5, when the MCP
relay creates the first client that is not a window. M4 only needs one document per window, so
the order is safe:

- In M4 every client of a document is the window showing it. The failure modes 0002 guards
  against (a window reload under a running agent, two windows on one document) cannot occur.
  `SessionManager.open` focuses the existing window instead of opening a second one, and the
  per-file lease blocks other processes.
- A window reload or crash in M4 loses at most the autosave window: recovery snapshots run
  every 30 s even with autosave off, autosave runs after 2 s idle, and the launch recovery
  dialog offers what is left. This matches the M4 exit criterion ("lose ≤ the autosave window").
- The host boundary is already shaped for the move: the session talks to `editor-state` and to
  a `FileSessionProvider`, never to the window. M5 moves that module unchanged into the hidden
  webview and adds the Yjs sync provider between window and host.

### 3. `@kimo/platform`: the host abstraction

A new package, `packages/platform` (`@kimo/platform`), holds the one interface the web app
calls for anything outside the document: `KimoPlatform` with `files`, `dialogs`, `recents`,
`leases`, `recovery`, `git`, `fonts`, `updater`, `window`, `settings` and `launch`, plus
`capabilities`. Implementations: `@kimo/platform/browser` (File System Access, downloads,
IndexedDB, Web Locks, explicit `UNSUPPORTED` otherwise), `@kimo/platform/memory` (complete
in-memory host with a `control` handle that scripts external edits, git operations, foreign
leases, disk-full and read-back failures, dead owners, deep links, updates and focus), and the
desktop one in `apps/desktop/src` over `@kimo/platform/tauri`.

- **Dependency rule:** `@kimo/platform` depends on nothing. Only `apps/*` import it.
  `@kimo/sync` does not import it: `platform.files` is structurally an `AtomicFileStore` (the
  sync-side interface), and `apps/web/src/platform/contract.ts` checks that at compile time,
  along with the shared `RecoveryReason` set.
- **Errors:** every rejection is a `PlatformError` with a code (`UNSUPPORTED`, `CANCELLED`,
  `NOT_FOUND`, `PERMISSION`, `DISK_FULL`, `READ_BACK_MISMATCH`, `LOCKED`, `BLOCKED`, `INVALID`,
  `IO`) and the OS `errno` when there is one; `@kimo/sync`'s `classifySaveError` maps them to
  board 17's save failures.
- **File refs:** absolute native paths on desktop; `fsa:<handleId>/<rel>` (picked handles) or
  `upload:<id>/<name>` (read-only uploads) in the browser. Document-relative URIs resolve
  through one resolver, `resolveAgainstFile` (teardown 9.4).
- **Atomic write contract:** temp file in the same directory → fsync → rename → fsync dir →
  read back → SHA-256 compare (`READ_BACK_MISMATCH`). The original file is untouched on
  failure.
- **Leases:** `~/.kimo/locks/<sha256(path)[:16]>.lock`, created with O_EXCL, JSON body
  `{version, path, pid, app, appLabel, host, sinceIso, socket?, token}` shared with the CLI and
  headless MCP; a holder whose pid is dead on the same host is reclaimed on acquire ("Retry").
  The board's `9f2c41ab.lock` is illustrative; the 16-hex form matches recovery file names.
  Browser: Web Locks, one writer per file across tabs of a profile.
- **Recovery store:** `~/.kimo/recovery/<id>.kimo` + `<id>.meta.json`, id =
  `sha256(path)[:16]` (same as `FileProvider.recoveryPath`) or `untitled-<docId>`; entries carry
  owner pid/alive/exit time, edits, last autosave and reason; retention 30 days.
- **Git:** `state(ref)` and `watch(ref)` for the repository that contains `ref` only:
  `REBASE_HEAD`/`rebase-merge`/`rebase-apply` = rebase, `MERGE_HEAD` = merge,
  `CHERRY_PICK_HEAD` = cherry-pick, a HEAD change while `index.lock` exists = checkout;
  `indexLocked` alone pauses with operation `null`. Also `mergeDriverStatus` and
  `installMergeDriver` (Settings "Git merge driver").
- **Fonts:** `listLocal`/`loadLocal`, a content-addressed cache (`~/.kimo/fonts`, IndexedDB on
  the web) and `fetchRemote` limited to `fonts.googleapis.com` / `fonts.gstatic.com`; it
  rejects with `BLOCKED` when "No third-party fetch" is on or Google Fonts is off. On desktop
  the fetch runs in Rust, because the webview CSP allows no remote connects.
- **Settings:** fifteen typed keys, one per SettingRow on board 19 (`files.autosaveIntervalMs`
  2000, `files.recoverySnapshotMs` 30000, `files.onExternalChange` "merge-and-tell",
  `privacy.noThirdPartyFetch` false, `updates.channel` "stable", …), validated on write,
  normalized on read, and broadcast to every window. The mockup shows "No third-party fetch"
  turned on only to illustrate Google Fonts being off; the default is off (teardown 9.2).
- **Window:** `trafficLightPosition` {16, 18} and a 68 px inset on macOS (4 in fullscreen, 0
  elsewhere), focus and fullscreen events (the unfocused topbar drops the file-name weight to
  500), `setDocumentEdited`, `openSettings` (returns `"window"` on desktop and `"dialog"` on the
  web), and `onCloseRequested` for flush-before-close.
- **Launch:** `kimo://open?path=<abs>&node=<id>` (strictly parsed by `parseDeepLink`), file
  association, argv and second-instance requests all arrive as `OpenRequest`s; cold-start
  requests are queued for `takeInitialRequests()`.

### 4. The document session (`apps/web/src/platform/contract.ts`)

The UI renders a `SessionState`; builders implement `SessionManager`/`DocumentSession` on top
of `@kimo/platform` and `FileSessionProvider` (`@kimo/sync`, the M4 contract of
`FileProvider`):

- **SaveStatus**, seven designed states with exact labels: "Saved to disk", "Saving…" (only
  after 400 ms: `displayedSaveStatus`), "Unsaved changes", "Autosave paused · rebase" / "2
  conflicts · autosave paused", "Read-only" / "Read-only · couldn't load", "Locked by another
  app", "Save failed", each mapped to its 02d component and node id.
- **Banners**, one at a time, highest first (`BANNER_PRIORITY` in `apps/web/src/platform/contract.ts`,
  amended by board 20 "Banner priority" vgNUe and board 24 "Banner priority vs 'Ready to commit'"
  a9ykr0): failed-load (terminal for the window) > locked (read-only: another app holds the file)
  > newer-format (read-only: written by a newer Kimo) > save-failed (disk full / permission /
  read-back mismatch) > merge-conflicts (stored by `kimo merge`; they replace the generic git
  merge banner, and the SaveStatus pill reads "N conflicts · autosave paused") > git-operation
  (Discard / Stash as recovery file / Keep my edits) > merge-ready ("Ready to commit"; it replaces
  the git banner in the same slot, never stacks under it). With stored conflicts ⌘S saves them
  as-is even while git reports MERGE_HEAD. `bannerCopy` returns the design's titles, bodies and
  actions.
- **Toasts:** external reloaded / merged (Undo) / conflicts (Review), merge saved, update ready,
  restart after saving.
- **Dialogs:** launch recovery (Restore / Save as… / Discard per entry; Discard all / Decide
  later / Restore all; Esc = Decide later; kept 30 days) and migration consent (Upgrade and save
  / Open read-only; Esc = read-only; ⌘S also counts as consent).
- **Lifecycle:** lease → read + `openDocument` (failed load → terminal, newer → read-only, older
  → consent) → stored conflicts → git state → watchers. Autosave runs after
  `files.autosaveIntervalMs` of idle (this replaces `FileProvider`'s 3 s default with the
  designed 2 s); recovery snapshots run every `files.recoverySnapshotMs` while dirty; a failed
  save retries every 30 s (`SAVE_RETRY_MS`); external changes reload (no local edits) or
  three-way merge (local edits) through the same `ThreeWayMerge`; Undo restores memory only and
  never rewrites the file.
- **Conflicts:** `ConflictSession` lists rows in layer order with ours/theirs/base views,
  `choose`, `chooseAll` (open rows only), `next`/`previous`/`focus` (⌘'), and
  `markResolvedAndSave`. Picks are undoable `editor-state` edits with the semantics of
  `applyConflictSide`. Autosave stays paused while any conflict is open.

### 5. Tauri command surface (`packages/platform/src/tauri.ts`)

The desktop shell implements exactly `TauriCommandMap` (62 commands) and `TauriEventMap` (9
events). Rust functions are `kimo_<area>_<verb>`; payload structs use
`#[serde(rename_all = "camelCase")]` with the TS shapes as the source of truth; errors are
`PlatformErrorPayload { code, message, errno }`; unit results resolve to `null`; binary
results are `tauri::ipc::Response`, and binary arguments travel as base64.

| Area | Commands | Rust payload structs |
|---|---|---|
| app | `kimo_app_info` | `AppInfo` |
| fs | `kimo_fs_read_text`, `_read_bytes`, `_write_text_atomic`, `_write_bytes_atomic`, `_remove`, `_stat`, `_list`, `_watch`, `_unwatch`, `_reveal`, `_open_default`, `kimo_open_url` | `ReadTextResult`, `AtomicWriteResult`, `FileStat`, `WatchEvent` |
| dialogs | `kimo_dialog_open_file`, `_save_file`, `_pick_folder` (each widens the fs scope) | `FileFilter` |
| recents | `kimo_recents_list_files`, `_note_opened`, `_remove_file`, `_clear`, `_list_folders`, `_add_folder`, `_remove_folder`, `_scan_folder` | `RecentFile`, `GitSummary`, `WatchedFolder` |
| leases | `kimo_lease_acquire`, `_release`, `_inspect`, `_watch`, `_unwatch` | `AcquireResult` (`#[serde(untagged)]` on `ok`), `Lease`, `LeaseHolder` |
| recovery | `kimo_recovery_dir`, `_list`, `_write`, `_read`, `_discard`, `_prune` | `RecoveryEntry`, `RecoveryWriteInput` |
| git | `kimo_git_state`, `_watch`, `_unwatch`, `_merge_driver_status`, `_install_merge_driver` | `GitState`, `GitChange` (`#[serde(tag = "kind")]`) |
| fonts | `kimo_fonts_list_local`, `_load_local`, `_cache_get`, `_cache_put`, `_cache_list`, `_cache_stats`, `_cache_clear`, `_fetch_remote`, `_open_cache_folder` | `LocalFontFamily`, `LocalFontStyle`, `FontCacheEntry` |
| updater | `kimo_updater_status`, `_check`, `_download`, `_restart` | `UpdaterStatus` (`tag = "state"`), `UpdateInfo` |
| window | `kimo_window_state`, `_set_title`, `_set_document_edited`, `_open_settings`, `_confirm_close`, `_close` | `WindowState` |
| settings | `kimo_settings_get_all`, `kimo_settings_set` | `serde_json::Map` validated against the key list |
| launch | `kimo_launch_take_initial` | `OpenRequest` |

Events: `kimo://fs-watch`, `kimo://lease-changed`, `kimo://git-changed`,
`kimo://recents-changed`, `kimo://updater-status`, `kimo://window-state`,
`kimo://close-requested` (answered by `kimo_window_confirm_close`), `kimo://settings-changed`
(broadcast), `kimo://open-request`.

Shell configuration: macOS editor windows use `titleBarStyle: "Overlay"`, `hiddenTitle: true`
and `trafficLightPosition {16, 18}`. Windows and Linux use `decorations: true` with no inset.
Windows are labelled `main`, `editor-<n>` and `settings`. Plugins: dialog, deep-link (`kimo`),
single-instance, updater (signed; endpoint placeholder) and opener (reveal / open default);
file watching uses `notify` with debounce. The capability file allows only the `kimo_*`
commands (`TAURI_COMMANDS`) and no whole default permission sets. The fs scope is deny by
default and is widened at runtime for picked or opened files, watched folders, `~/.kimo` and
the app config dir. The file association adds `.kimoz` next to `.kimo`.

### 6. Ownership for the parallel build

The contract files are frozen for the build: the core-schema `schema/merge.ts`,
`merge/conflicts.ts`, `merge/types.ts` and `validate/merge.ts`; `packages/sync/src/types.ts`;
`packages/platform/src/{types,capabilities,errors,settings,links,tauri}.ts`; and
`apps/web/src/platform/contract.ts`. A change goes through the contract owner and this ADR.
Suggested split:

1. **Desktop shell:** `apps/desktop/**` (Rust commands, plugins, windows, `createTauriPlatform`).
2. **Files and session:** `packages/sync` (`FileProvider` implements `FileSessionProvider` over
   an `AtomicFileStore`), `apps/web/src/platform/session.ts`, and the board 16/17 UI (Home list,
   SaveStatus, banners, toasts, recovery and consent dialogs).
3. **Merge and CLI:** `packages/core-schema/src/merge/three-way.ts` (`ThreeWayMerge`),
   `packages/cli` (`kimo merge`, `kimo gc`, `kimo validate`), and the board 18 Conflicts tab and
   canvas markers.
4. **Fonts, assets and settings:** font resolution (Document → Local → Google cache), the Missing
   fonts dialog, the font picker sources, asset import (SVG options) and clean-up, the Settings
   window and dialog, and the updater toasts (board 19).

### 7. Board 20 "M4 Gaps" (amendment)

Board 20 (`TsJoM`) closes the gaps the M4 build left; the contract changes are additive:

- **Untitled documents** (V7ey1Q): desktop "New file" opens `untitled:<docId>` at once, with no
  lease, file or watcher. Edits snapshot to the recovery entry `untitled-<docId>` (reason
  `untitled`) after `files.autosaveIntervalMs`; the pill is SaveStatus/Unsaved "Not saved"
  (`SaveStatus.unsaved.untitled`); the first ⌘S opens the native save panel pre-filled with
  `Untitled.kimo` in the last-used folder, then the session moves to the file
  (`SessionManager.newUntitled`, `FileDocumentSession.untitled`).
- **Window title** (G1gEPp, `windowTitle`): `<file> — <folder>` (the repository's folder, else
  the containing one), `Untitled • not saved`, ` (read-only)`, Home `Kimo`; macOS marks edits
  with `setDocumentEdited`, Windows / Linux prefix `● ` and append ` - Kimo`.
- **Windows / Linux chrome** (KcXQz): native decorations stay; the topbar drops the traffic-light
  inset, takes padding [0, 12] and leads with the 28px k logo.
- **Settings entries** (uXuLM): ⌘, / Ctrl+,, File menu Settings…, the macOS app menu (About
  Kimo, Check for updates…, Settings… — `apps/desktop/src-tauri/src/menu.rs`) and the Home
  sidebar; no topbar gear.
- **Conflicts** (rTpad): `ConflictSession.reopen(id)`; groups ordered Document, Variables, then
  nodes; `ConflictRow/Resolved` is node hZKbc (rebuilt; formerly d9zpM).
- **Text case**: the Text section's Case control writes the existing `style.case`
  (`upper` / `lower` / `title`, spec §8.2), which renderers already apply at draw time and the
  layout measures; the board's "new `textCase` property" is the design tool's name for it, so
  the format needs no new field.

## Consequences

- A conflicted `.kimo` is still a document: it renders, can be committed mid-resolution, is
  checked by `kimo validate` (`CONFLICT_OPEN`), and needs no text-marker parser. Merges that
  `kimo merge` cannot run (unparsable inputs) still produce git markers, and the failed-load
  banner explains them.
- Header-level conflicts reuse JSON Pointers, so any future root member can be merged without
  a new conflict kind.
- The editor never imports Tauri. Every host feature can be tested in Bun with
  `createMemoryPlatform()`, including the board 17 failure paths.
- Not designed, so marked in code: a generic I/O save failure (it reuses the disk-full layout
  with the OS message), "Autosave paused · git" when only `index.lock` is seen, and the
  Windows/Linux labels for "Reveal in Finder" (`revealLabel`).
- Cost: 62 commands to implement and keep in sync with the TS map; a test asserts that the TS
  list is complete, and the Rust side should add a matching test when it lands. Staging Option A
  means M5 must move the host into the hidden webview before MCP ships.
- The browser build keeps working without File System Access: uploads are read-only and saving
  is a download (`capabilities.saveInPlace` false).

## Alternatives considered

- **Git-style text markers inside `.kimo`.** Breaks JSON, so the file cannot load, and that is
  exactly the "failed load" case. Rejected.
- **A sidecar `<file>.kimo.conflicts` file.** Keeps the document clean, but the two files can
  drift, git tracks two paths, and the editor has to load both atomically. Rejected.
- **One conflict node type inside `nodes`.** Cannot express variable, header or move conflicts,
  and it pollutes the node tree that renderers and exporters walk. Rejected.
- **Per-node nested conflict records** (one entry per node with a record of properties). Board
  18 resolves per row, and per-row entries make each pick a one-line diff. Rejected.
- **Hidden-webview host in M4 (0002 as written).** Adds the window–host sync before any
  non-window client exists, on the critical path of four parallel builders. Deferred to M5 (§2).
- **`@tauri-apps/plugin-fs` directly from the web app.** Spreads Tauri across the UI, leaves the
  atomic-write and read-back contract to JS, and cannot be faked in tests. Rejected in favour of
  `@kimo/platform`.

## Revisit when

M5 starts (move the host into the hidden webview), a design adds conflict kinds the five kinds
cannot express, or Windows/Linux get designed custom chrome.
