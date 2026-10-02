/**
 * Test helpers: a tiny absolute-position layout (no flex; enough for renderer goldens without
 * depending on the Yoga engine) and scene construction from a plain document.
 */
import type { KimoDocument } from "@kimo/core-schema"
import {
  createResolver,
  type LayoutResult,
  type Matrix,
  type NodeLayout,
  nodeSourceFromDocument,
  type Rect,
  resolveText,
  type TextMeasurer,
} from "@kimo/layout"
import type { AssetSource, RenderScene } from "../../src"

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

/** A loosely typed document (fixtures exercise malformed/edge values too). */
export type TestDoc = { nodes: Record<string, Record<string, unknown>> } & Partial<
  Omit<KimoDocument, "nodes">
>

export function sceneOf(doc: TestDoc, assets?: Record<string, Uint8Array>): RenderScene {
  const nodes = nodeSourceFromDocument(doc as unknown as Pick<KimoDocument, "nodes">)
  const header = { variables: doc.variables, themes: doc.themes, imports: doc.imports }
  const resolve = createResolver(header, nodes)
  const source: AssetSource = { load: async (src) => assets?.[src] ?? null }
  return { nodes, header, resolve, assets: source }
}

/** Absolute layout: x/y/w/h numbers, auto text measured, groups = union of children. */
export function simpleLayout(scene: RenderScene, measure: TextMeasurer, version = 1): LayoutResult {
  const out = new Map<string, NodeLayout>()
  const order: string[] = []
  let bounds: Rect | null = null
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d)
  const visit = (id: string, parentT: Matrix, parentVisible: boolean) => {
    const n = scene.nodes.getNode(id)
    if (!n) return
    let w = num(n.w, 0)
    let h = num(n.h, 0)
    let text: NodeLayout["text"]
    if (n.type === "text" || n.type === "note" || n.type === "prompt") {
      const input = resolveText(id, n, scene.resolve)
      const grow = n.grow ?? "auto"
      const m = measure.measure(input, grow === "auto" ? undefined : w)
      text = m
      if (grow === "auto") {
        w = m.w
        h = m.h
      } else if (grow === "fixed-width") h = m.h
    }
    const x = num(n.x, 0)
    const y = num(n.y, 0)
    const rot = (num(n.rotation, 0) * Math.PI) / 180
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    let T = mul(parentT, [1, 0, 0, 1, x, y])
    T = mul(T, [c, -s, s, c, 0, 0])
    if (n.flipX === true) T = mul(T, [-1, 0, 0, 1, w, 0])
    if (n.flipY === true) T = mul(T, [1, 0, 0, -1, 0, h])
    const visible = parentVisible && n.visible !== false
    order.push(id)
    const corners = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([px = 0, py = 0]) => [T[0] * px + T[2] * py + T[4], T[1] * px + T[3] * py + T[5]])
    const xs = corners.map((p) => p[0] as number)
    const ys = corners.map((p) => p[1] as number)
    const world = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    }
    out.set(id, {
      id,
      local: { x, y, w, h },
      world,
      transform: T,
      visible,
      ...(text ? { text } : {}),
    })
    for (const ch of scene.nodes.children(id)) visit(ch, n.type === "group" ? parentT : T, visible)
    if (n.type === "group") {
      // Group box = union of children (children are placed in the group's parent space).
      let u: Rect | null = null
      for (const ch of scene.nodes.children(id)) {
        const cl = out.get(ch)
        if (!cl) continue
        const r = cl.world
        u = u
          ? {
              x: Math.min(u.x, r.x),
              y: Math.min(u.y, r.y),
              w: Math.max(u.x + u.w, r.x + r.w) - Math.min(u.x, r.x),
              h: Math.max(u.y + u.h, r.y + r.h) - Math.min(u.y, r.y),
            }
          : { ...r }
      }
      if (u)
        out.set(id, { id, local: { ...u }, world: u, transform: [1, 0, 0, 1, u.x, u.y], visible })
    }
  }
  for (const r of scene.nodes.children(null)) {
    visit(r, [1, 0, 0, 1, 0, 0], true)
    const w = out.get(r)?.world
    if (w)
      bounds = bounds
        ? {
            x: Math.min(bounds.x, w.x),
            y: Math.min(bounds.y, w.y),
            w: Math.max(bounds.x + bounds.w, w.x + w.w) - Math.min(bounds.x, w.x),
            h: Math.max(bounds.y + bounds.h, w.y + w.h) - Math.min(bounds.y, w.y),
          }
        : { ...w }
  }
  return { version, nodes: out, order, bounds, issues: [], changed: new Set(out.keys()) }
}
