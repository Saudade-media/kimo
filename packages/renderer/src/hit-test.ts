/**
 * Hit testing against a `LayoutResult` (ADR 0009 §6): world boxes first, then exact shape
 * tests (rounded rects, ellipses/arcs/rings) in node-local space, honoring ancestor `clip`,
 * visibility and `locked`. Pure (no CanvasKit, no GPU readback), so it works headless.
 *
 * The index is kept per root and built on first use: a query reads only the roots whose bounds
 * it meets, and a layout change drops only the roots it touched (`HitIndex.update`), so a
 * pointer move or an edit never walks the whole document.
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

/** The entries of one root's subtree in paint order, and where they can be hit. */
interface RootHits {
  entries: Entry[]
  byId: Map<string, Entry>
  /** Union of the subtree's world boxes (a clipping root: its own box); null when empty. */
  bounds: Rect | null
}

/** An index over a layout, kept across layout passes with {@link HitIndex.update}. */
export class HitIndex {
  private readonly hits = new Map<string, RootHits>()
  /** Where each root can be hit (see RootHits.bounds), known before its entries are built. */
  private readonly bounds = new Map<string, Rect | null>()
  /** Roots and subtrees derived from `order`, for layouts without `roots` / `subtrees`. */
  private grouped: { roots: string[]; subtrees: Map<string, string[]> } | null = null

  constructor(
    private layout: LayoutResult,
    private readonly nodes: NodeSource,
    private readonly resolve: Resolver,
  ) {}

  /**
   * Moves the index to `layout`. `dirty`: the roots whose nodes, data or layout changed since
   * the layout it had (null: any of them), whose entries are rebuilt on their next use.
   */
  update(layout: LayoutResult, dirty: Iterable<string> | null): void {
    this.layout = layout
    this.grouped = null
    if (dirty === null) {
      this.hits.clear()
      this.bounds.clear()
    } else
      for (const root of dirty) {
        this.hits.delete(root)
        this.bounds.delete(root)
      }
  }

  private group(): { roots: readonly string[]; subtrees: ReadonlyMap<string, readonly string[]> } {
    const l = this.layout
    if (l.roots && l.subtrees) return { roots: l.roots, subtrees: l.subtrees }
    if (!this.grouped) {
      const rootOf = new Map<string, string>()
      const subtrees = new Map<string, string[]>()
      const roots: string[] = []
      for (const id of l.order) {
        const parent = this.nodes.getNode(id)?.parent
        const root = (typeof parent === "string" && rootOf.get(parent)) || id
        rootOf.set(id, root)
        let list = subtrees.get(root)
        if (!list) {
          list = []
          subtrees.set(root, list)
          roots.push(root)
        }
        list.push(id)
      }
      this.grouped = { roots, subtrees }
    }
    return this.grouped
  }

  /** Union of the root's subtree boxes; a clipping root's own box (nothing is hit outside). */
  private rootBounds(root: string, ids: readonly string[] | undefined): Rect | null {
    const known = this.bounds.get(root)
    if (known !== undefined) return known
    let b: Rect | null = null
    const node = this.nodes.getNode(root)
    const l = this.layout.nodes.get(root)
    if (node && l && node.type === "frame" && this.resolve.value(root, node.clip) === true)
      b = l.world
    else if (ids) {
      let x0 = Number.POSITIVE_INFINITY
      let y0 = Number.POSITIVE_INFINITY
      let x1 = Number.NEGATIVE_INFINITY
      let y1 = Number.NEGATIVE_INFINITY
      for (const id of ids) {
        const w = this.layout.nodes.get(id)?.world
        if (!w) continue
        if (w.x < x0) x0 = w.x
        if (w.y < y0) y0 = w.y
        if (w.x + w.w > x1) x1 = w.x + w.w
        if (w.y + w.h > y1) y1 = w.y + w.h
      }
      if (x1 >= x0) b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    this.bounds.set(root, b)
    return b
  }

  private rootHits(root: string, ids: readonly string[] | undefined): RootHits | null {
    let h = this.hits.get(root)
    if (h) return h
    if (!ids) return null
    const entries: Entry[] = []
    const byId = new Map<string, Entry>()
    for (const id of ids) {
      const l = this.layout.nodes.get(id)
      const node = this.nodes.getNode(id)
      if (!l || !node) continue
      const parent = typeof node.parent === "string" ? byId.get(node.parent) : undefined
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
      entries.push(entry)
      byId.set(id, entry)
    }
    h = { entries, byId, bounds: this.rootBounds(root, ids) }
    this.hits.set(root, h)
    return h
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

  private insideClips(h: RootHits, e: Entry, world: Point): boolean {
    for (const c of e.clips) {
      const ce = h.byId.get(c)
      if (ce && !this.inShape(ce, world, 0)) return false
    }
    return true
  }

  private clipped(h: RootHits, e: Entry): Rect | null {
    let box: Rect | null = e.layout.world
    for (const c of e.clips) {
      const ce = h.byId.get(c)
      if (ce && box) box = intersection(box, ce.layout.world)
    }
    return box
  }

  /** Visible world box after ancestor clips (null when fully clipped away). */
  clippedBox(id: string): Rect | null {
    const subtrees = this.group().subtrees
    let root = id
    // Up to an indexed root: a layout of a subtree has roots that still have parents.
    for (let i = 0; i < 4096 && !subtrees.has(root); i++) {
      const p = this.nodes.getNode(root)?.parent
      if (typeof p !== "string") break
      root = p
    }
    const h = this.rootHits(root, subtrees.get(root))
    const e = h?.byId.get(id)
    return h && e ? this.clipped(h, e) : null
  }

  /** Ids under a world point, top-most first. `tolerance` is in world units. */
  point(world: Point, tolerance: number, options: HitTestOptions = {}): string[] {
    const out: string[] = []
    const { roots, subtrees } = this.group()
    for (let r = roots.length - 1; r >= 0; r--) {
      const root = roots[r] as string
      const ids = subtrees.get(root)
      const rb = this.rootBounds(root, ids)
      if (
        !rb ||
        world.x < rb.x - tolerance ||
        world.y < rb.y - tolerance ||
        world.x > rb.x + rb.w + tolerance ||
        world.y > rb.y + rb.h + tolerance
      )
        continue
      const h = this.rootHits(root, ids)
      if (!h) continue
      for (let i = h.entries.length - 1; i >= 0; i--) {
        const e = h.entries[i] as Entry
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
        if (!this.insideClips(h, e, world)) continue
        out.push(e.id)
      }
    }
    return out
  }

  /** Ids whose (clipped) world boxes meet a world rect, top-most first. */
  rect(world: Rect, options: HitTestRectOptions = {}): string[] {
    const mode = options.mode ?? "intersect"
    const out: string[] = []
    const { roots, subtrees } = this.group()
    for (let r = roots.length - 1; r >= 0; r--) {
      const root = roots[r] as string
      const ids = subtrees.get(root)
      const rb = this.rootBounds(root, ids)
      // Touching counts: a zero-size box on the rect's edge can still be contained.
      if (
        !rb ||
        rb.x > world.x + world.w ||
        world.x > rb.x + rb.w ||
        rb.y > world.y + world.h ||
        world.y > rb.y + rb.h
      )
        continue
      const h = this.rootHits(root, ids)
      if (!h) continue
      for (let i = h.entries.length - 1; i >= 0; i--) {
        const e = h.entries[i] as Entry
        if (!this.eligible(e, options)) continue
        const box = this.clipped(h, e)
        if (!box) continue
        if (mode === "contain" ? contains(world, e.layout.world) : intersects(world, box))
          out.push(e.id)
      }
    }
    return out
  }

  get source(): LayoutResult {
    return this.layout
  }
}
