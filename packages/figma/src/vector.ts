/**
 * Figma vector networks (`vectorData.vectorNetworkBlob`) as SVG path data.
 *
 * Blob layout (little-endian): uint32 vertex, segment and region counts; vertices are
 * (styleID u32, x f32, y f32); segments are (styleID u32, start u32, start tangent f32×2,
 * end u32, end tangent f32×2); regions are (u32: bit 0 = nonzero winding, rest = styleID, then
 * a u32 loop count, each loop a u32 count of segment indices). Coordinates are in the
 * network's `normalizedSize` space.
 */

export interface VectorPath {
  d: string
  fillRule: "nonzero" | "evenodd"
}

interface Segment {
  a: number
  b: number
  ta: [number, number]
  tb: [number, number]
}

/** Decodes a vector network into path data scaled by `sx`/`sy`, or null when malformed. */
export function vectorNetworkPath(blob: Uint8Array, sx = 1, sy = 1): VectorPath | null {
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  let o = 0
  const u32 = () => {
    if (o + 4 > blob.byteLength) throw new RangeError("vector network: truncated")
    const r = v.getUint32(o, true)
    o += 4
    return r
  }
  const f32 = () => {
    if (o + 4 > blob.byteLength) throw new RangeError("vector network: truncated")
    const r = v.getFloat32(o, true)
    o += 4
    return r
  }
  try {
    const nv = u32()
    const ns = u32()
    const nr = u32()
    if (nv * 12 + ns * 28 > blob.byteLength) return null
    const verts: [number, number][] = []
    for (let i = 0; i < nv; i++) {
      u32()
      verts.push([f32() * sx, f32() * sy])
    }
    const segs: Segment[] = []
    for (let i = 0; i < ns; i++) {
      u32()
      const a = u32()
      const ta: [number, number] = [f32() * sx, f32() * sy]
      const b = u32()
      const tb: [number, number] = [f32() * sx, f32() * sy]
      if (a >= nv || b >= nv) return null
      segs.push({ a, b, ta, tb })
    }
    let fillRule: VectorPath["fillRule"] = "nonzero"
    const loops: number[][] = []
    for (let i = 0; i < nr; i++) {
      const head = u32()
      if (i === 0) fillRule = head & 1 ? "nonzero" : "evenodd"
      const nl = u32()
      for (let j = 0; j < nl; j++) {
        const n = u32()
        const loop: number[] = []
        for (let k = 0; k < n; k++) {
          const s = u32()
          if (s >= ns) return null
          loop.push(s)
        }
        loops.push(loop)
      }
    }
    // Segments no region uses (open strokes) are drawn too.
    const used = new Set(loops.flat())
    const rest = segs.map((_, i) => i).filter((i) => !used.has(i))
    const parts: string[] = []
    for (const loop of loops) parts.push(chain(loop, segs, verts, true))
    if (rest.length) parts.push(chain(rest, segs, verts, false))
    const d = parts.join(" ").trim()
    return d ? { d, fillRule } : null
  } catch {
    return null
  }
}

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? "0" : String(r)
}

/** Walks `indices` as connected chains, reorienting segments so each starts where the last ended. */
function chain(
  indices: readonly number[],
  segs: readonly Segment[],
  verts: readonly [number, number][],
  closeLoops: boolean,
): string {
  const out: string[] = []
  let start = -1
  let cur = -1
  for (const i of indices) {
    let { a, b, ta, tb } = segs[i] as Segment
    if (cur !== -1 && a !== cur && b === cur) [a, b, ta, tb] = [b, a, tb, ta]
    if (a !== cur) {
      if (closeLoops && cur !== -1 && cur === start) out.push("Z")
      const p = verts[a] as [number, number]
      out.push(`M${fmt(p[0])} ${fmt(p[1])}`)
      start = a
    }
    const p0 = verts[a] as [number, number]
    const p1 = verts[b] as [number, number]
    if (ta[0] === 0 && ta[1] === 0 && tb[0] === 0 && tb[1] === 0) {
      out.push(`L${fmt(p1[0])} ${fmt(p1[1])}`)
    } else {
      out.push(
        `C${fmt(p0[0] + ta[0])} ${fmt(p0[1] + ta[1])} ${fmt(p1[0] + tb[0])} ${fmt(p1[1] + tb[1])} ${fmt(p1[0])} ${fmt(p1[1])}`,
      )
    }
    cur = b
  }
  if (closeLoops && cur !== -1 && cur === start) out.push("Z")
  return out.join(" ")
}
