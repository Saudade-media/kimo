# Images, icons and SVG

## Images

Press `⇧⌘K` (or click **Image** in the toolbar) and pick a PNG, JPEG, GIF, WebP or AVIF file, up to 50 MB. Then click to place it at its natural size, centered on the pointer, or drag to draw it at the size you want (the aspect ratio is kept). `Esc` cancels.

The image becomes a frame with an image fill (Cover), so you can resize it, round its corners and give it strokes and effects. Change the fit (Cover, Contain, Stretch) or replace the picture in the [Fill section](properties.md#fill); **Image…** there also adds an image fill to any layer.

> [!NOTE]
> Raster images come in through the Image tool or an image fill. Dropping or pasting a PNG or JPEG on the canvas doesn't import it yet; SVG files can be dropped and pasted (below).

Images are stored once in the file's `assets/` folder, named by their content hash. **File › Clean up assets…** removes the ones no layer uses any more.

## SVG

Drop an `.svg` file on the canvas, or paste an SVG file or SVG markup (a paste lands in the middle of the view). Kimo asks how to import it:

- **Vector paths**: editable paths. **Keep groups as frames** preserves the SVG's grouping, and **Match fills to variables** binds colors that match a color variable.
- **Image**: the SVG as a picture.

Hold `⇧` while dropping to skip the question and reuse your last choice. SVGs with unsafe content (a script, an external file, embedded HTML) are refused, with an option to import them without those parts. An import is one undo step.

## Icons

Press `I` with the canvas focused to open the icon picker at the pointer; the icon is placed there at 24 px, inside the frame under the pointer. The picker searches the **Lucide**, **Phosphor**, **Material** and **Feather** sets and remembers your recent icons.

Icons are layers you can recolor and resize. In the [Icon section](properties.md#icon) you change the icon, its size, and its stroke (Lucide, Feather) or weight (Material, Phosphor).

## Components

Drag components from the **Assets** tab onto the canvas, into a frame, into a slot, or onto a layer inside an instance to replace it. See [Components](../components/components.md#insert-instances).
