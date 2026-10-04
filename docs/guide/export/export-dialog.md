# Export

The Export dialog turns the selected frames into code, design tokens or images. Click **Export** at the right of the top bar. The dialog title is **Export to code**, and its header names what you are exporting: `Hero · 1 frame · 12 layers · 4 variables`.

## What gets exported

The export covers the canvas selection. With nothing selected it covers every top-level frame on the page. The dialog has no frame picker of its own, so select what you want before you open it.

You can also open the dialog from the [Code tab](code-tab.md): **Open export…** keeps the tab's framework and selection, and **Export page…** (shown when nothing is selected) exports every top-level frame.

## Formats

| Format | Files |
|---|---|
| **React + Tailwind** (TSX · Tailwind v4) | One `.tsx` per exported frame, one `.tsx` per component, and `tokens.css` (CSS variables plus an `@theme inline` block) |
| **HTML + CSS** (static markup, CSS variables) | `index.html`, `styles.css`, and `tokens.css` when variables are on |
| **Design tokens** (W3C DTCG JSON + CSS) | `tokens.json` (DTCG) and `tokens.css` |
| **SVG / PNG** (vector or raster per frame) | One `<frame-name>.svg` per frame, or one `<frame-name>@2x.png` per frame. The **SVG \| PNG** switch above the preview picks which |
| **PDF** (vector, one page per frame) | One `export.pdf` |

PNG has a **Scale** switch: 1×, 2× (the default) or 3×.

## Options

Code and image formats show three switches:

| Option | Default | Effect |
|---|---|---|
| Variables as CSS custom properties | On | Bound values are emitted as `var(--…)` with a `tokens.css`; off, they are inlined |
| Split instances into components | On | Each component becomes its own file, and instances become component usages |
| Keep layer names as data attributes | Off | Adds each layer's name to the markup as a `data-layer` attribute |

PDF replaces them with **Embed fonts** (on: the PDF carries the fonts the canvas renders with; WOFF-only faces fall back to Helvetica) and **Include bleed** (off: adds 3 mm on every side).

The dialog remembers your format, image kind, scale and switches in this browser or app, and the output folder per file.

## Preview

Code formats show one tab per file with highlighted code; the arrow keys, Home and End move between tabs, and the copy icon copies the open file. PNG shows the first frame at its export size (**Fit** or **Actual size**) with a line such as `720 × 366 → 1440 × 732 · ≈ 212 KB`. PDF shows page 1 and the page count. The preview regenerates whenever you change the format or an option.

## Where the files go

**Desktop app.** **Output folder** defaults to the folder that holds the `.kimo` file; click it to pick another. For an untitled file there is no default: choose a folder (**Choose…**) before **Export N files** is enabled. Folders that don't exist are created, and every file is written atomically. A progress bar reads `Writing k of n`; **Cancel** stops after the file being written. When it finishes, a toast says `Exported N files to …` with a **Reveal** action. If writing fails (permission denied, disk full, a file that changed during the export), the dialog offers **Choose folder…**, **Copy error** and **Retry**.

**Browser.** Browsers can't write into a folder, so several files download as one zip. **Download as** sets its name (default `kimo-export-<frame>.zip`). A single file downloads on its own (**Download .svg**, **Download .pdf** …).

**Copy code** copies the generated code instead of writing files.

## Review changes

In the desktop app, existing files are never overwritten silently. When a file you are about to write already exists in the folder with different contents, the dialog shows **Review changes** before writing anything:

- Changed files list their added and removed lines and a **Keep | Overwrite** choice. A file defaults to **Overwrite** only when it still matches what Kimo wrote there last time; a file you edited by hand, or one Kimo never wrote, defaults to **Keep**.
- New files are listed separately. Identical files are skipped.
- Select a file to see a unified diff (`on disk → export`).
- **Keep all**, **Overwrite all**, then **Write N files**. **Back** returns to the options.

> [!NOTE]
> The exporters approximate a few things the web platform can't express exactly. The dialog doesn't list those approximations yet; agents get them as `issues` from [`kimo_export`](agents.md).
