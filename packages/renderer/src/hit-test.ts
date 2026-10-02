/**
 * Hit testing against a `LayoutResult` (ADR 0009 §6): world boxes first, then exact shape
 * tests (rounded rects, ellipses/arcs/rings) in node-local space, honoring ancestor `clip`,
 * visibility and `locked`. Pure (no CanvasKit, no GPU readback), so it works headless.
 */
import type { LayoutNodeData, LayoutResult, NodeLayout, NodeSource, Resolver } from "@kimo/layout"
import {
  apply,
  contains,
  inEllipse,
  inRoundedRect,
  intersection,
  intersects,
  invert,
  resolveNum,
  resolveRadii,
} from "./geometry"
import type { HitTestOptions, HitTestRectOptions, Point, Rect } from "./types"

interface Entry {
  id: string
  layout: NodeLayout
  node: LayoutNodeData
  /** Effective lock (own or ancestor). */
  locked: boolean
  /** Clipping ancestors, nearest last. */
  clips: readonly string[]
}

/** A per-layout index; rebuild when the layout or the document changes. */
export class HitIndex {
  private readonly entries: Entry[] = []
  private readonly byId = new Map<string, Entry>()

  constructor(
    private readonly layout: LayoutResult,
    nodes: NodeSource,
    private readonly resolve: Resolver,
  ) {
    for (const id of layout.order) {
      const l = layout.nodes.get(id)
      const node = nodes.getNode(id)
      if (!l || !node) continue
      const parent = typeof node.parent === "string" ? this.byId.get(node.parent) : undefined
      let clips: readonly string[] = parent?.clips ?? []
      if (parent && parent.node.type === "frame" && this.clipOf(parent))
        clips = [...clips, parent.id]
      const entry: Entry = {
        id,
        layout: l,
        node,
        locked: node.locked === true || parent?.locked === true,
        clips,
      }
      this.entries.push(entry)
      this.byId.set(id, entry)
    }
  }

  private clipOf(e: Entry): boolean {
    return this.resolve.value(e.id, e.node.clip) === true
  }

  private eligible(e: Entry, o: HitTestOptions | HitTestRectOptions): boolean {
    if (!o.includeHidden && !e.layout.visible) return false
    if (!o.includeLocked && e.locked) return false
    if (o.within && !o.within.has(e.id)) return false
    return true
  }

  /** Is the world point inside the node's exact shape (local space)? */
  private inShape(e: Entry, world: Point, tol: number): boolean {
    const inv = invert(e.layout.transform)
    if (!inv) return false
    const p = apply(inv, world)
    const { w, h } = e.layout.local
    const n = e.node
    switch (n.type) {
      case "rect":
      case "frame":
      case "browser":
        return inRoundedRect(p, w, h, resolveRadii(this.resolve, e.id, n, w, h), tol)
      case "ellipse":
        return inEllipse(
          p,
          w,
          h,
          resolveNum(this.resolve, e.id, n.innerRadius, 0),
          resolveNum(this.resolve, e.id, n.startAngle, 0),
          resolveNum(this.resolve, e.id, n.sweepAngle, 360),
          tol,
        )
      default:
        return p.x >= -tol && p.y >= -tol && p.x <= w + tol && p.y <= h + tol
    }
  }

  private insideClips(e: Entry, world: Point): boolean {
    for (const c of e.clips) {
      const ce = this.byId.get(c)
      if (ce && !this.inShape(ce, world, 0)) return false
    }
    return true
  }

  /** Visible world box after ancestor clips (null when fully clipped away). */
  clippedBox(id: string): Rect | null {
    const e = this.byId.get(id)
    if (!e) return null
    let box: Rect | null = e.layout.world
    for (const c of e.clips) {
      const ce = this.byId.get(c)
      if (ce && box) box = intersection(box, ce.layout.world)
    }
    return box
  }

  /** Ids under a world point, top-most first. `tolerance` is in world units. */
  point(world: Point, tolerance: number, options: HitTestOptions = {}): string[] {
    const out: string[] = []
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i] as Entry
      if (!this.eligible(e, options)) continue
      const b = e.layout.world
      if (
        world.x < b.x - tolerance ||
        world.y < b.y - tolerance ||
        world.x > b.x + b.w + tolerance ||
        world.y > b.y + b.h + tolerance
      )
        continue
      if (!this.inShape(e, world, tolerance)) continue
      if (!this.insideClips(e, world)) continue
      out.push(e.id)
    }
    return out
  }

  /** Ids whose (clipped) world boxes meet a world rect, top-most first. */
  rect(world: Rect, options: HitTestRectOptions = {}): string[] {
    const mode = options.mode ?? "intersect"
    const out: string[] = []
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i] as Entry
      if (!this.eligible(e, options)) continue
      const box = this.clippedBox(e.id)
      if (!box) continue
      if (mode === "contain" ? contains(world, e.layout.world) : intersects(world, box))
        out.push(e.id)
    }
    return out
  }

  get source(): LayoutResult {
    return this.layout
  }
}
