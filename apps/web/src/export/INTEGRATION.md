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

## Board 25 additions (O3Abm, built)

- Editor passes `preset` (Code tab "Open export…": format + node ids) and maps `onExported`
  through `exportToastOf(outcome)` to `m3.toast` (+ "Reveal" → `platform.files.reveal` on
  desktop). The Code tab (`../code-tab`, mounted by `RightPanel`) calls `onOpenExport`.
- PDF row (Embed fonts / Include bleed → `exportDocument(…, "pdf", { fonts, bleed })`; pass
  `ExportSource.fonts` to embed real faces). SVG / PNG: the preview bar's SVG | PNG toggle picks
  the output, PNG at the chosen scale (1× 2× 3×, default 2×) with a raster preview.
- Desktop: export → review (only when a target exists and differs; hand-edited files — disk no
  longer hashes to what Kimo wrote last time, `kimo.export.written.<folder>` — default Keep) →
  per-file progress (Cancel stops after the current file) → error card + Retry (failed +
  skipped). Untitled desktop files start without a folder (Export disabled until Choose…).
- Web: "Download as" (editable zip name, default `kimo-export-<frame>.zip`); a single-file
  export downloads the file itself.
