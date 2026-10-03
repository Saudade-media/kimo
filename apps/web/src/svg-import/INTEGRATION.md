# SVG import (board 19 mevh8) — integration

On drop / paste of an `.svg` (today `AssetStore.put` rejects SVG):

```tsx
const prepared = await prepareSvg(bytes, file.name)        // throws SvgImportError (DOCTYPE, not SVG, …)
if (event.shiftKey) return run(lastSvgChoice())            // ⇧: skip the popover, last choice
<SvgImportPopover fileName={file.name}
  vectorDescription={prepared.vectorDescription} imageDescription={prepared.imageDescription}
  canOutline={!!outliner} anchor={dropPoint}
  onCancel={close}
  onImport={(choice) => { rememberSvgChoice(choice); run(choice) }} />

async function run(choice) {
  const { ops } = await svgImportOps(prepared, choice, {
    newId: generateId, at: dropWorldPoint, parent: dropParent,
    colorVariables,              // name → hex of the document's color variables (default entry)
    outline: outliner,           // optional: CanvasKit Path.stroke() based StrokeOutliner
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
- Outline strokes needs an outliner from the canvas; without one the toggle is disabled.
- Gradient geometry maps to Kimo `center` / `size` / `rotation` approximately (objectBoundingBox).
