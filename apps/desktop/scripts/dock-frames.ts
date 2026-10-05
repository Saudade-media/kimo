/**
 * Dock activity frames (desing.pen board 32 "Dock activity", JzzEa): renders the macOS Dock tile
 * flipbook that `src-tauri/src/dock_activity.rs` plays while an agent works, from the exact mark
 * (`KIMO_LOGO_PATH`) and the app icon plate of `src-tauri/icons/source.svg`.
 *
 * - Motion (board 32 §2): a 2000 ms loop at 30 fps (60 frames). The spiked outer shape turns
 *   clockwise and the pucker opening counter-clockwise, one 60° symmetry step per loop: 0–700 ms
 *   ease-in cubic-bezier(0.32, 0, 0.67, 0) to ±30°, 700–1400 ms ease-out
 *   cubic-bezier(0.33, 1, 0.68, 1) to ±60°, 1400–2000 ms rest. A white radial bloom (Ø 600 on the
 *   1024 grid) sits between the plate and the mark at opacity 0.45 · sin(π · t / 1400).
 * - Reduced motion (board 32 §3): no rotation, the bloom alone at 0.15 · (1 − cos 2π t / 3000),
 *   3000 ms at 10 fps (30 frames).
 *
 * Frame 0 of both loops is the static icon (angle 0, no bloom). Identical frames are stored once.
 * Writes `src-tauri/icons/dock/*.png` and `src-tauri/src/dock_frames.rs` (include_bytes! table).
 *
 *   bun scripts/dock-frames.ts           regenerate
 *   bun scripts/dock-frames.ts --check   fail if the committed frames / table are stale
 */
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync, inflateSync } from "node:zlib"
import { KIMO_LOGO_PATH } from "../../../packages/ui/src/kimo-logo/paths"

export type Pt = [number, number]

/** Output size in px (a 128 pt Dock tile on a 2x display). */
export const SIZE = 256

/** Board 32 §2 motion loop. */
export const MOTION = {
  fps: 30,
  frames: 60,
  loopMs: 2000,
  turnInMs: 700,
  turnOutEndMs: 1400,
  stepDeg: 60,
  bloomPeak: 0.45,
} as const

/** Board 32 §3 reduced-motion loop (bloom only). */
export const REDUCED = { fps: 10, frames: 30, loopMs: 3000, bloomPeak: 0.3 } as const

/** The 1024 icon grid of source.svg (board 26 gTG4w › ww5et) and the bloom of board 32. */
export const GRID = {
  size: 1024,
  plate: { x: 100, size: 824, radius: 185.4, color: 10 / 255 },
  shadow: { dy: 10, std: 14, opacity: 0.25 },
  mark: { x: 264, size: 496 },
  bloom: { diameter: 600 },
} as const

export const EASE_IN = [0.32, 0, 0.67, 0] as const
export const EASE_OUT = [0.33, 1, 0.68, 1] as const

// --- Geometry -----------------------------------------------------------------------------------

/** The mark's subpaths in absolute 0–100 coordinates: [outer contour, opening (hole)]. */
export function markSubpaths(d: string = KIMO_LOGO_PATH): Pt[][] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const subs: Pt[][] = []
  let cmd = ""
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cur: Pt[] = []
  for (let i = 0; i < toks.length; ) {
    const t = toks[i] as string
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      i++
      if (cmd === "z" || cmd === "Z") {
        if (cur.length) subs.push(cur)
        cur = []
        x = sx
        y = sy
      }
      continue
    }
    const a = Number(toks[i])
    const b = Number(toks[i + 1])
    i += 2
    if (cmd === "M" || cmd === "m") {
      x = cmd === "M" ? a : x + a
      y = cmd === "M" ? b : y + b
      sx = x
      sy = y
      cur = [[x, y]]
      cmd = cmd === "M" ? "L" : "l"
    } else if (cmd === "l") {
      x += a
      y += b
      cur.push([x, y])
    } else if (cmd === "L") {
      x = a
      y = b
      cur.push([x, y])
    } else throw new Error(`unsupported path command ${cmd}`)
  }
  return subs
}

/** Rotates about (cx, cy); positive degrees turn clockwise on screen (y down). */
export function rotate(p: Pt[], deg: number, cx = 50, cy = 50): Pt[] {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return p.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    return [cx + dx * c - dy * s, cy + dx * s + dy * c]
  })
}

/** Distance from a point to a closed polygon's outline. */
export function distanceToOutline([px, py]: Pt, poly: Pt[]): number {
  let m = Number.POSITIVE_INFINITY
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k] as Pt
    const [bx, by] = poly[(k + 1) % poly.length] as Pt
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
    m = Math.min(m, Math.hypot(ax + t * dx - px, ay + t * dy - py))
  }
  return m
}

/** Max distance from `a`'s vertices to `b`'s outline (one-sided Hausdorff). */
export function deviation(a: Pt[], b: Pt[]): number {
  return Math.max(...a.map((p) => distanceToOutline(p, b)))
}

// --- Timing -------------------------------------------------------------------------------------

/** CSS cubic-bezier(x1, y1, x2, y2) at progress u (x solved by bisection). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  const f = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t
  let lo = 0
  let hi = 1
  for (let k = 0; k < 64; k++) {
    const m = (lo + hi) / 2
    if (f(m, x1, x2) < u) lo = m
    else hi = m
  }
  return f((lo + hi) / 2, y1, y2)
}

export interface FrameParams {
  /** Outer contour, degrees clockwise. */
  outer: number
  /** Opening, degrees counter-clockwise. */
  inner: number
  /** Bloom opacity 0–1. */
  bloom: number
}

/** The beat angle (0 → 60°) at t ms of the motion loop. */
export function beatAngle(t: number): number {
  const { turnInMs, turnOutEndMs, stepDeg } = MOTION
  const half = stepDeg / 2
  if (t <= turnInMs) return half * cubicBezier(...EASE_IN, t / turnInMs)
  if (t <= turnOutEndMs)
    return half + half * cubicBezier(...EASE_OUT, (t - turnInMs) / (turnOutEndMs - turnInMs))
  return stepDeg
}

/** Motion frame `i` (0 ≤ i ≤ 60; 60 is the next loop's frame 0). */
export function motionParams(i: number): FrameParams {
  const t = (i * 1000) / MOTION.fps
  const a = beatAngle(Math.min(t, MOTION.loopMs))
  const bloom =
    t < MOTION.turnOutEndMs ? MOTION.bloomPeak * Math.sin((Math.PI * t) / MOTION.turnOutEndMs) : 0
  return { outer: a, inner: a, bloom }
}

/** Reduced-motion frame `i` (no rotation). */
export function reducedParams(i: number): FrameParams {
  const t = (i * 1000) / REDUCED.fps
  const bloom = (REDUCED.bloomPeak / 2) * (1 - Math.cos((2 * Math.PI * t) / REDUCED.loopMs))
  return { outer: 0, inner: 0, bloom }
}

// --- Raster -------------------------------------------------------------------------------------

/** Even-odd coverage of `polys` (pixel coordinates): 8 sample rows per pixel, exact spans. */
export function coverage(polys: Pt[][], size: number, rows = 8): Float32Array {
  const out = new Float32Array(size * size)
  const edges: [number, number, number, number][] = []
  for (const p of polys)
    for (let k = 0; k < p.length; k++) {
      const [x0, y0] = p[k] as Pt
      const [x1, y1] = p[(k + 1) % p.length] as Pt
      if (y0 !== y1) edges.push([x0, y0, x1, y1])
    }
  const xs: number[] = []
  const w = 1 / rows
  for (let py = 0; py < size; py++)
    for (let r = 0; r < rows; r++) {
      const y = py + (r + 0.5) * w
      xs.length = 0
      for (const [x0, y0, x1, y1] of edges)
        if ((y0 <= y && y < y1) || (y1 <= y && y < y0))
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, xs[k] as number)
        const b = Math.min(size, xs[k + 1] as number)
        for (let px = Math.floor(a); px < b; px++) {
          const ov = Math.min(b, px + 1) - Math.max(a, px)
          if (ov > 0) out[py * size + px] = (out[py * size + px] as number) + ov * w
        }
      }
    }
  for (let k = 0; k < out.length; k++) out[k] = Math.min(1, out[k] as number)
  return out
}

/** Separable gaussian blur of a single channel. */
export function blur(src: Float32Array, size: number, std: number): Float32Array {
  const rad = Math.ceil(std * 3)
  const kernel: number[] = []
  let sum = 0
  for (let k = -rad; k <= rad; k++) {
    const v = Math.exp(-(k * k) / (2 * std * std))
    kernel.push(v)
    sum += v
  }
  const kn = kernel.map((v) => v / sum)
  const pass = (a: Float32Array, horizontal: boolean) => {
    const b = new Float32Array(size * size)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let acc = 0
        for (let k = -rad; k <= rad; k++) {
          const sx = horizontal ? x + k : x
          const sy = horizontal ? y : y + k
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue
          acc += (a[sy * size + sx] as number) * (kn[k + rad] as number)
        }
        b[y * size + x] = acc
      }
    return b
  }
  return pass(pass(src, true), false)
}

function roundedRect(x: number, y: number, s: number, r: number, seg = 24): Pt[] {
  const out: Pt[] = []
  const corners: [number, number, number][] = [
    [x + s - r, y + r, -90],
    [x + s - r, y + s - r, 0],
    [x + r, y + s - r, 90],
    [x + r, y + r, 180],
  ]
  for (const [cx, cy, start] of corners)
    for (let k = 0; k <= seg; k++) {
      const a = ((start + (90 * k) / seg) * Math.PI) / 180
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  return out
}

let marks: Pt[][] | null = null

/** Renders one frame as straight-alpha RGBA (sRGB, `size` × `size`). */
export function renderFrame(p: FrameParams, size = SIZE): Uint8Array {
  const k = size / GRID.size
  const n = size * size
  // Premultiplied channels; the icon is grey-scale, so one colour channel + alpha suffice.
  const C = new Float32Array(n)
  const A = new Float32Array(n)
  const over = (cov: Float32Array | ((i: number) => number), color: number, alpha: number) => {
    for (let i = 0; i < n; i++) {
      const a = (typeof cov === "function" ? cov(i) : (cov[i] as number)) * alpha
      if (a <= 0) continue
      C[i] = color * a + (C[i] as number) * (1 - a)
      A[i] = a + (A[i] as number) * (1 - a)
    }
  }
  const { plate, shadow, mark, bloom } = GRID
  const plateAt = (dy: number) =>
    roundedRect(plate.x * k, (plate.x + dy) * k, plate.size * k, plate.radius * k)
  over(
    blur(coverage([plateAt(shadow.dy)], size), size, shadow.std * k),
    plate.color,
    shadow.opacity,
  )
  over(coverage([plateAt(0)], size), plate.color, 1)
  if (p.bloom > 0) {
    const c = (GRID.size / 2) * k
    const r = (bloom.diameter / 2) * k
    over(
      (i) => {
        const d = Math.hypot((i % size) + 0.5 - c, Math.floor(i / size) + 0.5 - c)
        return Math.max(0, 1 - d / r)
      },
      1,
      p.bloom,
    )
  }
  marks ??= markSubpaths()
  const [outer, inner] = marks as [Pt[], Pt[]]
  // ±60° is the same shape (6-fold symmetry): render the reduced angle so rest frames are exact.
  const step = MOTION.stepDeg
  const toPx = (pts: Pt[]): Pt[] =>
    pts.map(([x, y]) => [
      (mark.x + (x * mark.size) / 100) * k,
      (mark.x + (y * mark.size) / 100) * k,
    ])
  const shapes = [toPx(rotate(outer, p.outer % step)), toPx(rotate(inner, -(p.inner % step)))]
  over(coverage(shapes, size), 1, 1)

  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = A[i] as number
    const v = a > 0 ? Math.round(Math.min(1, (C[i] as number) / a) * 255) : 0
    out.set([v, v, v, Math.round(a * 255)], i * 4)
  }
  return out
}

// --- PNG ----------------------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** The filtered scanlines (adaptive filter per row, minimum sum of absolute differences). */
export function filterScanlines(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4
  const out = new Uint8Array(h * (stride + 1))
  const zero = new Uint8Array(stride)
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  const row = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride)
    const up = y ? rgba.subarray((y - 1) * stride, y * stride) : zero
    let best = 0
    let bestSum = Number.POSITIVE_INFINITY
    let bestRow = new Uint8Array(stride)
    for (let f = 0; f <= 4; f++) {
      let sum = 0
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? (cur[x - 4] as number) : 0
        const b = up[x] as number
        const c = x >= 4 ? (up[x - 4] as number) : 0
        const pred =
          f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
        const v = ((cur[x] as number) - pred) & 0xff
        row[x] = v
        sum += v < 128 ? v : 256 - v
      }
      if (sum < bestSum) {
        bestSum = sum
        best = f
        bestRow = row.slice()
      }
    }
    out[y * (stride + 1)] = best
    out.set(bestRow, y * (stride + 1) + 1)
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA, no interlace
  const idat = deflateSync(filterScanlines(rgba, w, h), { level: 9 })
  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A PNG's IHDR bytes and inflated IDAT (the filtered scanlines), for byte-exact comparison. */
export function pngPayload(png: Uint8Array): { ihdr: Uint8Array; data: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let ihdr: Uint8Array = new Uint8Array()
  const idat: Uint8Array[] = []
  for (let o = 8; o < png.length; ) {
    const len = dv.getUint32(o)
    const type = new TextDecoder().decode(png.subarray(o + 4, o + 8))
    const body = png.subarray(o + 8, o + 8 + len)
    if (type === "IHDR") ihdr = body
    if (type === "IDAT") idat.push(body)
    o += 12 + len
  }
  return { ihdr, data: new Uint8Array(inflateSync(Buffer.concat(idat))) }
}

/** Reverses PNG filtering (8-bit RGBA) back to pixels. */
export function unfilterScanlines(data: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4
  const out = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)] as number
    for (let x = 0; x < stride; x++) {
      const raw = data[y * (stride + 1) + 1 + x] as number
      const a = x >= 4 ? (out[y * stride + x - 4] as number) : 0
      const b = y ? (out[(y - 1) * stride + x] as number) : 0
      const c = x >= 4 && y ? (out[(y - 1) * stride + x - 4] as number) : 0
      const p = a + b - c
      const pred =
        f === 0
          ? 0
          : f === 1
            ? a
            : f === 2
              ? b
              : f === 3
                ? (a + b) >> 1
                : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
                  ? a
                  : Math.abs(p - b) <= Math.abs(p - c)
                    ? b
                    : c
      out[y * stride + x] = (raw + pred) & 0xff
    }
  }
  return out
}

// --- Output -------------------------------------------------------------------------------------

export interface FrameSet {
  /** Unique images (file name → PNG), image 0 = the static icon. */
  images: { name: string; png: Uint8Array; rgba: Uint8Array }[]
  /** Motion frame → image index. */
  motion: number[]
  /** Reduced-motion frame → image index. */
  reduced: number[]
}

export function buildFrames(size = SIZE): FrameSet {
  const images: FrameSet["images"] = []
  const byHash = new Map<string, number>()
  const add = (p: FrameParams) => {
    const rgba = renderFrame(p, size)
    const h = createHash("sha256").update(rgba).digest("hex")
    let idx = byHash.get(h)
    if (idx === undefined) {
      idx = images.length
      byHash.set(h, idx)
      images.push({
        name: `frame-${String(idx).padStart(2, "0")}.png`,
        png: encodePng(rgba, size, size),
        rgba,
      })
    }
    return idx
  }
  const motion = Array.from({ length: MOTION.frames }, (_, i) => add(motionParams(i)))
  const reduced = Array.from({ length: REDUCED.frames }, (_, i) => add(reducedParams(i)))
  return { images, motion, reduced }
}

export function rustTable(set: FrameSet, size = SIZE): string {
  const list = (a: number[]) => a.join(", ")
  return `// @generated by apps/desktop/scripts/dock-frames.ts (board 32 "Dock activity"). Do not edit;
// run \`bun run dock-frames\` in apps/desktop.

/// Frame size in px.
pub const SIZE: u32 = ${size};
/// Motion loop: ${MOTION.frames} frames at ${MOTION.fps} fps (${MOTION.loopMs} ms).
pub const MOTION_FPS: u32 = ${MOTION.fps};
/// Reduced-motion loop: ${REDUCED.frames} frames at ${REDUCED.fps} fps (${REDUCED.loopMs} ms).
pub const REDUCED_FPS: u32 = ${REDUCED.fps};

/// Unique PNG frames; image 0 is the static icon.
pub static IMAGES: [&[u8]; ${set.images.length}] = [
${set.images.map((i) => `    include_bytes!("../icons/dock/${i.name}"),`).join("\n")}
];

/// Motion frame → image index.
pub const MOTION: [u8; ${set.motion.length}] = [${list(set.motion)}];

/// Reduced-motion frame → image index.
pub const REDUCED: [u8; ${set.reduced.length}] = [${list(set.reduced)}];
`
}

const ROOT = join(import.meta.dir, "..", "src-tauri")
export const FRAMES_DIR = join(ROOT, "icons", "dock")
export const TABLE_PATH = join(ROOT, "src", "dock_frames.rs")

/** Problems with the committed frames (empty: up to date). */
export function checkCommitted(set: FrameSet = buildFrames()): string[] {
  const problems: string[] = []
  let table = ""
  try {
    table = readFileSync(TABLE_PATH, "utf8")
  } catch {
    return [`${TABLE_PATH} is missing`]
  }
  if (table !== rustTable(set)) problems.push(`${TABLE_PATH} is stale`)
  const names = new Set(set.images.map((i) => i.name))
  let files: string[] = []
  try {
    files = readdirSync(FRAMES_DIR)
  } catch {}
  for (const f of files) if (!names.has(f)) problems.push(`unexpected ${f}`)
  for (const img of set.images) {
    let png: Uint8Array
    try {
      png = new Uint8Array(readFileSync(join(FRAMES_DIR, img.name)))
    } catch {
      problems.push(`${img.name} is missing`)
      continue
    }
    const got = pngPayload(png)
    const want = pngPayload(img.png)
    if (
      Buffer.compare(Buffer.from(got.ihdr), Buffer.from(want.ihdr)) !== 0 ||
      Buffer.compare(Buffer.from(got.data), Buffer.from(want.data)) !== 0
    )
      problems.push(`${img.name} is stale`)
  }
  return problems
}

if (import.meta.main) {
  const set = buildFrames()
  if (process.argv.includes("--check")) {
    const problems = checkCommitted(set)
    if (problems.length) {
      console.error(`dock frames are stale (run \`bun run dock-frames\` in apps/desktop):`)
      for (const p of problems) console.error(`  ${p}`)
      process.exit(1)
    }
    console.log(`dock frames up to date (${set.images.length} images)`)
  } else {
    rmSync(FRAMES_DIR, { recursive: true, force: true })
    mkdirSync(FRAMES_DIR, { recursive: true })
    for (const img of set.images) writeFileSync(join(FRAMES_DIR, img.name), img.png)
    writeFileSync(TABLE_PATH, rustTable(set))
    const bytes = set.images.reduce((s, i) => s + i.png.length, 0)
    console.log(
      `${set.images.length} images (${(bytes / 1024).toFixed(0)} KiB) → ${FRAMES_DIR}; table → ${TABLE_PATH}`,
    )
  }
}
