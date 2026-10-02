/** A tiny RGBA PNG (solid quadrants) for image-fill tests, built with CanvasKit. */
import type { CanvasKit } from "canvaskit-wasm"

export function quadrantPng(ck: CanvasKit, w = 40, h = 20): Uint8Array {
  const s = ck.MakeSurface(w, h)
  if (!s) throw new Error("surface")
  const c = s.getCanvas()
  const p = new ck.Paint()
  const colors = [
    ck.Color4f(1, 0.2, 0.2, 1),
    ck.Color4f(0.2, 0.7, 0.3, 1),
    ck.Color4f(0.2, 0.4, 1, 1),
    ck.Color4f(1, 0.8, 0.1, 1),
  ]
  colors.forEach((col, i) => {
    p.setColor(col)
    c.drawRect(ck.XYWHRect((i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2), p)
  })
  const img = s.makeImageSnapshot()
  const bytes = img.encodeToBytes(ck.ImageFormat.PNG, 100)
  img.delete()
  p.delete()
  s.delete()
  if (!bytes) throw new Error("encode")
  return bytes
}
