/** Diffs measured site boxes against a design fixture. */
import type { Box } from "./measure-lib"

export interface Diff {
  path: string
  design?: Box
  site?: Box
  delta?: { x: number; y: number; w: number; h: number }
}

export type Field = "x" | "y" | "w" | "h"

export interface StyleDiff {
  path: string
  kind: "type" | "fill"
  design: string
  site: string
}

/** Compares computed type (text nodes) and fills (frames) of matched nodes. */
export function diffStyles(
  design: Box[],
  site: Box[],
  filter?: (path: string) => boolean,
): StyleDiff[] {
  const byPath = new Map(site.map((b) => [b.path, b]))
  const out: StyleDiff[] = []
  const radius = (f: string) =>
    f.replace(/r(\d+(?:\.\d+)?)px$/, (_m, n) => `r${Math.min(Number(n), 999)}px`)
  for (const d of design) {
    if (filter && !filter(d.path)) continue
    const s = byPath.get(d.path)
    if (!s) continue
    if (d.t && s.t && d.t !== s.t) out.push({ path: d.path, kind: "type", design: d.t, site: s.t })
    if (d.f && s.f !== undefined && radius(d.f) !== radius(s.f))
      out.push({ path: d.path, kind: "fill", design: d.f, site: s.f })
    if (d.f && s.f === undefined)
      out.push({ path: d.path, kind: "fill", design: d.f, site: "none" })
  }
  return out
}

/**
 * Re-bases every box's y on its top-level section, so one section's height difference does not
 * cascade into every node below it (each section is then checked on its own).
 */
export function perSection(boxes: Box[]): Box[] {
  const top = new Map(boxes.filter((b) => !b.path.includes("/")).map((b) => [b.path, b.y]))
  return boxes.map((b) => {
    const section = b.path.split("/")[0] as string
    return b.path.includes("/") ? { ...b, y: b.y - (top.get(section) ?? 0) } : { ...b, y: 0 }
  })
}

export function diffBoxes(
  design: Box[],
  site: Box[],
  tol = 1,
  filter?: (path: string) => boolean,
  fields: Field[] = ["x", "y", "w", "h"],
) {
  const byPath = new Map(site.map((b) => [b.path, b]))
  const missing: string[] = []
  const off: Diff[] = []
  let matched = 0
  for (const d of design) {
    if (filter && !filter(d.path)) continue
    const s = byPath.get(d.path)
    if (!s) {
      missing.push(d.path)
      continue
    }
    matched++
    const delta = { x: s.x - d.x, y: s.y - d.y, w: s.w - d.w, h: s.h - d.h }
    if (fields.some((f) => Math.abs(delta[f]) > tol))
      off.push({ path: d.path, design: d, site: s, delta })
  }
  const designPaths = new Set(design.map((d) => d.path))
  const extra = site
    .filter((s) => !designPaths.has(s.path) && (!filter || filter(s.path)))
    .map((s) => s.path)
  return { matched, missing, off, extra }
}
