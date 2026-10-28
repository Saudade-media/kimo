# Export (M7, board 07 `AsO2h`, ADR 0015): integration

`apps/web/src/export` exports `ExportDialog` (it loads `export.css`), the generation seam
(`generateExport`, `previewRaster`), the Issues model (`issues.ts`), Copy selection as PNG
(`copy-png.ts`) and the pure dialog model (`model.ts`). `@kimo/exporters` is imported lazily
inside `generateExport` / `previewRaster`, so pdf-lib and the emitters stay out of the editor's
main chunk.

## Mount (Editor.tsx — as built)

```tsx
import { copySelectionAsPng, ExportDialog, type ExportPreset, type ExportSource,
  exportToastOf, pdfFontsFrom } from "../export"

const [exportOpen, setExportOpen] = useState(false)
const [exportPreset, setExportPreset] = useState<ExportPreset | null>(null)
// Memoized: the dialog regenerates its preview when `source` changes identity.
const exportSource = useMemo<ExportSource>(() => ({
  fileName: doc ? doc.fileName.replace(/\.kimoz?$/, "") : name,
  document: () => session.store.toDocument(),
  libraries: () => m3.libraries(),
  selection: () => session.ui.getState().selection,   // empty → every top-level frame
  renderer: () => canvas.current?.renderer ?? null,   // SVG text measurer + PNG exportRaster
  layout: () => canvas.current?.layout() ?? null,     // same expanded ids as the IR
  icons,                                              // browserIconProvider()
  fonts: pdfFontsFrom(() => …renderer.fonts.faceBytes), // PDF "Embed fonts"
}), [doc, name, session, m3, icons])

// Opened by: the Page card's Export + (board 44, `RightPanel onExport`), File › Export… and
// ⇧⌘E (`openExport`), the native File menu on desktop, and the Code tab's "Open export…"
// (`onOpenExport(preset)` → format + node ids).
{exportOpen && (
  <ExportDialog
    platform={platform}
    source={exportSource}
    fileRef={doc && !doc.untitled ? doc.ref : null}   // default output folder = its directory
    preset={exportPreset}
    onClose={() => setExportOpen(false)}
    onExported={(o) => m3.toast(…exportToastOf(o), + "Reveal" on desktop)}
    onSelectNode={(id) => { select([id]); canvas.zoomToFit([id], 96) }}  // Issues node chip
  />
)}
```

## Dialog behaviour

- Desktop (`platform.kind === "desktop"`): Export writes into the output folder (default: the
  `.kimo`'s directory, remembered per file in `localStorage` `kimo.export.folder.<ref>`; the
  folder field opens `dialogs.pickFolder`). `planWrite` diffs every file against disk: **new** →
  written (`writeTextAtomic` / `writeBytesAtomic`, `mkdirs`), **same** → skipped, **changed** →
  review step (only when a target exists and differs; hand-edited files — disk no longer hashes
  to what Kimo wrote last time, `kimo.export.written.<folder>` — default Keep) → per-file
  progress (Cancel stops after the current file) → error card + Retry (failed + skipped).
  Untitled desktop files start without a folder (Export disabled until Choose…).
- Web / memory: "Download as" (editable zip name, default `kimo-export-<frame>.zip`; store-only
  zip, deterministic bytes); a single-file export downloads the file itself.
- Formats → targets: React + Tailwind `react-tailwind`; HTML + CSS `html-css`; Design tokens
  `tokens-css` + `tokens-dtcg`; SVG / PNG `svg` or `png` (preview bar SVG | PNG, PNG at 1× 2× 3×,
  default 2×, raster preview); PDF `pdf` (Embed fonts / Include bleed). Options map 1:1 to
  `variables`, `components`, `layerNames` (defaults on, on, off).
- Remembered in `localStorage`: `kimo.export.prefs` (format, image kind, scale),
  `kimo.export.toggles`, `kimo.export.pdf`, `kimo.export.tailwind`.
- Esc / scrim press / Close dismiss; focus is trapped in the dialog.

`ExportOutcome` = `{ kind: "folder", folder, written, unchanged, kept, cancelled? }` |
`{ kind: "zip", name, files }` | `{ kind: "file", name }`.

## Board 27 §10 (c) f6LWt / (d) W3CpXw additions (built)

- **Preview | Issues** tabs head the preview pane (`.export-pane-tabs`). `generateExport`
  returns `issues: IssueGroup[]`: the exporter's `ExportIssue`s from the dry run, each attributed
  to its output file by `@kimo/exporters` (`exportDocument` sets `issue.file`; see
  `attributeIssues`), grouped per file in output order (`groupIssues`), duplicates collapsed,
  targets that could not run as a trailing "Export" group of errors. Level: unresolved
  variable / instance / node / icon = error, everything else (approximations, unsupported
  paints, missing fonts) = warning. Node chip = parent › layer name ("—" without a node);
  clicking it closes the dialog and calls `onSelectNode`. The tab's count chip is
  `warning-soft`, `danger-soft` with any error; a new error set switches to the Issues tab by
  itself. "Copy report" copies `issuesReport()` plain text. Issues never block Export. PNG /
  PDF (no text target in the dry run) still list the IR's own issues.
- **Tailwind theme** (React + Tailwind only): `@theme in tokens.css (v4)` (default) ·
  `tailwind.config.ts (v3)` · `Don't emit`, and "Map variables to theme tokens" (on). Passed as
  `exportDocument(…, "react-tailwind", { tailwindTheme, themeTokens })`: v4 keeps the `@theme
  inline` block in `tokens.css`; v3 writes `tailwind.config.ts` (`theme.extend`, values read the
  CSS variables) and plain variables in `tokens.css`; none writes variables only. Mapping off (or
  none) → utilities use arbitrary values (`[background-color:var(--surface-card)]`). Disabled
  when "Variables as CSS custom properties" is off. The board labels v4 "@theme in globals.css";
  the exporter writes the block into `tokens.css`, so the option names that file.
- **File › Export… ⇧⌘E** (`FileMenuActions.onExportDialog`) opens the dialog (selection, else
  every top-level frame) and **Copy selection as PNG ⇧⌘C** (`onCopyPng` →
  `copySelectionAsPng`): the first selected layer through `renderer.exportRaster(id, { scale: 2
  })` onto the clipboard (`navigator.clipboard.write` + `ClipboardItem`); toasts "Copied as PNG
  (2×)", or what is missing (no selection / renderer) / why it failed. Both are rows of the
  shortcuts table (`exportDialog`, `copyAsPng`, group File) and of the in-app File menu, after
  Save as… in their own group.
- **Desktop menu bar**: File › Export… / Copy selection as PNG (and View › Preview) are sent to
  the focused editor as `kimo://editor-menu { action: "export" | "copy-png" | "preview" }` →
  `platform.menu.onAction`; Editor.tsx handles `export` / `copy-png`. No native accelerators, so
  the editor's key handler keeps ⇧⌘E / ⇧⌘C (and text fields keep their keys).

Not wired: the Code tab (`../code-tab`) still generates with the default Tailwind theme (v4,
mapped); it reads `kimo.export.toggles` but not `kimo.export.tailwind`.
