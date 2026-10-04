/**
 * File › "Copy selection as PNG" ⇧⌘C (board 27 §10 (d) W3CpXw, rule VVlIk): the quick path that
 * skips the Export dialog and puts a 2× PNG of the selection on the clipboard. The renderer
 * (`exportRaster`) does the pixels, as for the dialog's PNG export. The clipboard holds one
 * image, so a multi-selection copies its first layer.
 */

/** Structurally `@kimo/exporters` `RasterSource` (the renderer). */
export interface PngRaster {
  exportRaster(nodeId: string, options?: { scale?: number }): Promise<Uint8Array>
}

export const COPY_PNG_SCALE = 2

export type CopyPngResult =
  | { ok: true; nodeId: string }
  | { ok: false; reason: "empty" | "renderer" | "failed"; message: string }

/** Writes a PNG blob to the system clipboard (`navigator.clipboard.write` + `ClipboardItem`). */
export async function writePngToClipboard(blob: Blob): Promise<void> {
  const clip = globalThis.navigator?.clipboard
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (!clip?.write || !Item) throw new Error("This browser can't put images on the clipboard")
  await clip.write([new Item({ "image/png": blob })])
}

export async function copySelectionAsPng(options: {
  selection: readonly string[]
  renderer: PngRaster | null
  write?: (blob: Blob) => Promise<void>
}): Promise<CopyPngResult> {
  const nodeId = options.selection[0]
  if (!nodeId) return { ok: false, reason: "empty", message: "Select a layer to copy as PNG" }
  if (!options.renderer)
    return { ok: false, reason: "renderer", message: "The canvas isn't ready yet" }
  try {
    const bytes = await options.renderer.exportRaster(nodeId, { scale: COPY_PNG_SCALE })
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" })
    await (options.write ?? writePngToClipboard)(blob)
    return { ok: true, nodeId }
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: `Couldn't copy as PNG: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
