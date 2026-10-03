# M4 files — integration (builder 2)

Everything here is mountable as-is; nothing in `App.tsx`, `router.ts`, `editor/**` or `home/**`
was changed. Import UI from `apps/web/src/files` (its `index.ts` also loads `files.css`) and the
session layer from `apps/web/src/platform/session.ts`.

## 1. One session manager per window

```ts
import { createSessionManager } from "./platform/session"
const manager = createSessionManager({ platform }) // platform: createBrowserPlatform() / Tauri / memory
manager.install((session, request) => navigateToFile(session.ref, request.node))
await manager.handleOpenRequest(...(await platform.launch.takeInitialRequests()))
```

- `merge` defaults to core-schema's `mergeDocuments` when exported (looked up at runtime);
  pass `merge` explicitly to override.
- `install()` registers `window.onCloseRequested` (→ `flushAll`, keeps the window open when a
  save failed) and `launch.onOpenRequest` (file association, deep links, second instance).
- Where: `App.tsx`, next to the existing platform creation (one module-level instance).

## 2. Editor route for an on-disk file (`#/file/...` or a new desktop route)

`const session = await manager.open(ref, { source, node })` gives a `FileDocumentSession`:
`session.store` is the `DocStore` the canvas/panels already use (wrap it with the existing
`makeSession`-style `FileSession` helpers: ui store, `apply`, gesture). The provider replaces
`IndexedDbProvider` for files on disk; the IndexedDB path stays for the browser's library.

Mount in `editor/Editor.tsx`, top to bottom:

| Piece | Mount | Notes |
|---|---|---|
| `<FileTopbar session page={pageName} trailing={…} />` | replaces the topbar row on desktop (`platform.kind === "desktop"`), or compose the pieces below into `editor/Topbar.tsx` | trailing = existing Zoom, Theme, Preview, Export |
| `<TrafficLightInset session />` | first child of `editor/Topbar.tsx` if the existing topbar is kept | width from `platform.window.trafficLightInset()` (68 / 4 / 0); lights drawn only off-desktop |
| `<FileBreadcrumb session page onFileClick />` | `editor/Topbar.tsx`, replacing the logo + file name on desktop | file weight 500 while unfocused |
| `<FileBranchChip session />` | right after the breadcrumb | renders nothing outside a repo |
| `<SaveStatusPill session />` | `editor/Topbar.tsx`, where the IndexedDB `CloudCheck` status sits today | tooltip "Saved 10:42:18 · ~/…" + ⌘S; Locked opens `LockDetailsPopover` |
| `<BannerHost session />` | directly under the topbar, full width, above the 3-column body | one banner, `pickBanner` priority |
| `<FailedLoadView session />` | in place of the canvas when `state.phase === "failed-load"` (it renders null otherwise); hide panels' editing affordances | terminal: no save / autosave / recovery |
| `<ToastHost session onReview={openConflictsTab} />` | inside the canvas container (`position: relative`) | bottom-center, 84 px above the canvas bottom |
| `<MigrationDialog session />` | anywhere in the editor tree (modal, renders null unless consent is pending) | Esc = Open read-only |

Keyboard: ⌘S → `session.save()` (counts as consent; during a git operation it re-shows the git
banner instead of writing). "Save as…" menu → `session.saveAs()`. Window close / update restart →
`manager.flushAll()` (already wired by `install()` for close).

Board 18 (builder 3): pass `createConflictSession: (s) => new ConflictSession(s)` to
`createSessionManager`; `session.conflicts` is then set while the file has stored conflicts, the
banner's Previous / Next conflict call `conflicts.previous()/next()/focus()`, and after "Mark
resolved & save" call `session.showMergeReady()` when git still merges and
`session.addToast({ kind: "merge-saved", … })`.

## 3. Launch recovery

`<RecoveryDialog manager onOpened={(s) => navigateToFile(s.ref)} onClose={…} />` once at app
start (Home or the first editor window). It renders nothing when no crashed entries exist.

## 4. Desktop Home (`home/Home.tsx`)

| Piece | Mount |
|---|---|
| `<TrafficLightInset platform={platform} leading={4} />` | first child of `.home-sidebar` (board 16 G17HiQ); the sidebar padding becomes `[0, 12, 16, 12]` on desktop |
| `<LocalFolders folders onAdd={() => addWatchedFolder(platform)} onOpenFolder />` | replaces `.home-folders-header` + the "Desktop app only" row when `platform.capabilities.watchedFolders` |
| `<RecentFilesHeader folderCount view onViewChange />` | replaces `.home-files-header` for on-disk files |
| `<RecentFilesList files now onOpen onMenu />` / `<RecentFilesGrid files folders now onOpen />` | the list / grid body |

Data: `const { files, folders } = useRecents(platform)`; `const now = useNow()`. Opening a row:
`manager.open(file.ref, { source: "home" })`.

## 5. Styles

`packages/ui/src/styles.css` imports the six new component stylesheets (SaveStatus, Banner,
Dialog, FileRow, RecoveryItem, WindowChrome). `apps/web/src/files/files.css` is imported by
`files/index.ts`.

## 6. Gallery

`GalleryM4Files` (02d sections Save status, Banners & dialogs, Files & recovery, Window chrome)
is mounted in `packages/ui/src/gallery/Gallery.tsx` after `GalleryM3`.

## 7. Tests

- `apps/web/test/m4-session.test.ts` (memory platform: every board 17 path).
- `packages/ui/test/m4-files.test.ts`, `packages/sync/test/sha256.test.ts`.
- `apps/web/e2e/m4-files.e2e.ts`: builds `src/files/harness` (its own Vite input, output in the
  OS temp dir) and runs 12 scenarios + the measured pass. `bun run --filter @kimo/web e2e m4-files`.
