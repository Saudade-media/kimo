/**
 * Golden PNG comparison. `UPDATE_GOLDENS=1 bun test` rewrites the goldens. A pixel differs
 * when any channel differs by more than `channelTolerance`; the test fails when more than
 * `maxDiffRatio` of the pixels differ (anti-aliasing / FreeType noise across machines).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { CanvasKit } from "canvaskit-wasm"

export const GOLDEN_DIR = join(import.meta.dir, "..", "golden")

function decode(ck: CanvasKit, bytes: Uint8Array): { w: number; h: number; px: Uint8Array } {
  const img = ck.MakeImageFromEncoded(bytes)
  if (!img) throw new Error("not a PNG")
  const w = img.width()
  const h = img.height()
  const px = img.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array
  img.delete()
  return { w, h, px }
}

export interface GoldenResult {
  ok: boolean
  message: string
  diffRatio: number
}

export function compareGolden(
  ck: CanvasKit,
  name: string,
  actual: Uint8Array,
  { channelTolerance = 16, maxDiffRatio = 0.005 } = {},
): GoldenResult {
  const path = join(GOLDEN_DIR, `${name}.png`)
  if (process.env.UPDATE_GOLDENS || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, actual)
    return { ok: true, message: `wrote ${path}`, diffRatio: 0 }
  }
  const a = decode(ck, actual)
  const g = decode(ck, new Uint8Array(readFileSync(path)))
  if (a.w !== g.w || a.h !== g.h) {
    writeFileSync(join(GOLDEN_DIR, `${name}.actual.png`), actual)
    return { ok: false, message: `size ${a.w}×${a.h} ≠ golden ${g.w}×${g.h}`, diffRatio: 1 }
  }
  let diff = 0
  for (let i = 0; i < a.px.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a.px[i + c] ?? 0) - (g.px[i + c] ?? 0)) > channelTolerance) {
        diff++
        break
      }
    }
  }
  const ratio = diff / (a.w * a.h)
  const ok = ratio <= maxDiffRatio
  if (!ok) writeFileSync(join(GOLDEN_DIR, `${name}.actual.png`), actual)
  return { ok, message: `${diff} px differ (${(ratio * 100).toFixed(3)}%)`, diffRatio: ratio }
}

/** RGBA of one pixel of a PNG. */
export function pixelAt(
  ck: CanvasKit,
  png: Uint8Array,
  x: number,
  y: number,
): [number, number, number, number] {
  const { w, px } = decode(ck, png)
  const i = (y * w + x) * 4
  return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0]
}
