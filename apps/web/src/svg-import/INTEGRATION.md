# SVG import (board 19 mevh8) — integration

On drop / paste of an `.svg` (today `AssetStore.put` rejects SVG):

```tsx
const prepared = await prepareSvg(bytes, file.name)        // throws SvgImportError (DOCTYPE, not SVG, …)
if (event.shiftKey) return run(lastSvgChoice())            // ⇧: skip the popover, last choice
<SvgImportPopover fileName={file.name}
  vectorDescription={prepared.vectorDescription} imageDescription={prepared.imageDescription}
  strokedPaths={prepared.stats.stroked ?? 0} anchor={dropPoint}
  onCancel={close}
  onImport={(choice) => { rememberSvgChoice(choice); run(choice) }} />

async function run(choice) {
  const { ops } = await svgImportOps(prepared, choice, {
    newId: generateId, at: dropWorldPoint, parent: dropParent,
    colorVariables,              // name → hex of the document's color variables (default entry)
    outline: await loadStrokeOutliner(),  // only when Outline strokes is on (CanvasKit Path.stroke)
    manifest: doc.assets ?? null,
    putAsset: (key, bytes, entry) => assets.putKey(key, bytes, entry),  // "./assets/<hash>.svg"
  })
  store.apply(ops, { origin: "user", label: `Import ${file.name}` })    // one undo step
}
```

## Safety

`sanitizeSvg` is its own tokenizer (no DOMParser, no browser rendering of the input):
DOCTYPE/ENTITY rejected; `script`, `foreignObject`, animation, unknown elements dropped; `on*`,
non-local `href`, non-local `url()`, `javascript:` / `data:` dropped; size/depth/count limits.
The Image option stores the sanitized SVG re-serialized, never the original bytes.

## Not designed / limits

- Image-option description: "Copies the file to assets/<hash>.svg and places an image fill."
- The renderer does not decode SVG image fills yet (CanvasKit images are raster); the Image
  option needs a renderer SVG decoder to display.
- Outline strokes (board 27 r6nLx) is enabled when the parse found ≥ 1 stroked path (sub line
  states the count), else disabled with "No strokes in this file". `createStrokeOutliner(ck)`
  dashes first (ContourMeasure), then strokes with the SVG cap / join / miter limit; each
  outline is its own filled path sized to the outline's bounds. If CanvasKit cannot load,
  strokes stay strokes (`stats.strokesKept`).
- Gradient geometry maps to Kimo `center` / `size` / `rotation` approximately (objectBoundingBox).
