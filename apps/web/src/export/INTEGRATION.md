# Export dialog (M7, board 07 `AsO2h`, ADR 0015): integration

`apps/web/src/export` exports `ExportDialog` (it loads `export.css`). `@kimo/exporters` is
imported lazily inside `generateExport`, so pdf-lib and the emitters stay out of the editor's
main chunk. `@kimo/exporters` is now an `@kimo/web` dependency.

## Mount (Editor.tsx — replaces `onExport={download}` on `Topbar` / `DiskTopbar`)

```tsx
import { ExportDialog, type ExportSource } from "../export"

const [exportOpen, setExportOpen] = useState(false)
// Memoize: the dialog regenerates its preview when `source` changes identity.
const exportSource = useMemo<ExportSource>(() => ({
  fileName: doc ? doc.fileName.replace(/\.kimoz?$/, "") : name,
  document: () => session.store.toDocument(),
  libraries: () => m3.libraries(),
  selection: () => session.ui.getState().selection,   // empty → every top-level frame
  renderer: () => canvas.current?.renderer ?? null,   // SVG text measurer + PNG exportRaster
  layout: () => canvas.current?.layout() ?? null,     // same expanded ids as the IR
  icons,                                              // browserIconProvider()
}), [doc, name, session, m3, icons])

<Topbar … onExport={() => setExportOpen(true)} />      // and DiskTopbar
{exportOpen && (
  <ExportDialog
    platform={platform}
    source={exportSource}
    fileRef={doc && !doc.untitled ? doc.ref : null}   // default output folder = its directory
    onClose={() => setExportOpen(false)}
    onExported={(o) => m3.toast({ tone: "neutral", text: exportToast(o) })}  // optional
  />
)}
```

- Desktop (`platform.kind === "desktop"`): Export writes into the output folder (default: the
  `.kimo`'s directory, remembered per file in `localStorage` `kimo.export.folder.<ref>`; the
  folder field opens `dialogs.pickFolder`; an untitled file asks for a folder on Export).
  `planWrite` diffs every file against disk: **new** → written (`writeTextAtomic` /
  `writeBytesAtomic`, `mkdirs`), **same** → skipped, **changed** → left untouched and reported
  in `outcome.kept` (never overwritten silently). `writePlan(plan, folder, platform, overwrite)`
  overwrites only the paths passed explicitly (for a future review UI).
- Web / memory: Export downloads `<file name>.zip` (store-only zip, deterministic bytes); the
  output folder group is not rendered.
- Formats → targets: React + Tailwind `react-tailwind`; HTML + CSS `html-css`; Design tokens
  `tokens-css` + `tokens-dtcg`; SVG / PNG `svg` + `png` at 1×, 2×, 3× (PNGs are rendered only on
  Export, the preview lists text files; the count includes them). Options map 1:1 to
  `variables`, `components`, `layerNames` (board defaults on, on, off; remembered in
  `kimo.export.toggles`, format in `kimo.export.prefs`).
- Esc / scrim press / Close dismiss; focus is trapped in the dialog.

`ExportOutcome` = `{ kind: "folder", folder, written, unchanged, kept }` |
`{ kind: "zip", name, files }`.

## Needs design (not built)

- RightPanel **Code tab** (live code for the selection): no board draws it (no `Tab/Active`
  "Code" anywhere, no Code panel frame) — keep the current placeholder.
- Review of **changed files** before overwriting ("existing files are diffed"): no diff/confirm
  frame; changed files are kept and reported through `onExported` (host toast copy is the
  host's).
- **PDF** export: board 07 lists only SVG / PNG ("Assets at 1×, 2×, 3×"); `exportDocument(…,
  "pdf")` exists but has no row.
- Web variant: no output folder; the footer note reads "N files · downloaded as <name>.zip".
- Preview of binary files (PNG) and an export error state: errors are shown as plain lines in
  the code area; generation progress has no state.
