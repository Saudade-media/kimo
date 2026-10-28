/**
 * Board 35 "Agent build motion" (IASl0): layers an agent adds grow into place instead of popping
 * in. This is the scheduler: it picks the layers to animate from store changes (agent and MCP
 * origins only), times their entrances (staggered in document order), records the reflow of
 * the layers the insert pushed around, and turns all of it into per-node {@link NodeMotion}s
 * for one frame. Render only: nothing here writes to the document; the renderer draws the
 * offsets on top of the final layout. Framework-free (unit-tested without a canvas).
 */
import type { LayoutResult, Rect } from "@kimo/layout"
import type { MotionFrame, NodeMotion } from "@kimo/renderer"

/** Board 35 values (rules table x9R37b, keyframes mvNij, timeline HfsF5). */
const BUILD_MOTION = {
  /** Entrance and reflow duration. */
  durationMs: 200,
  /** cubic-bezier(0.2, 0, 0, 1). */
  ease: [0.2, 0, 0, 1] as const,
  fromOpacity: 0,
  fromScale: 0.96,
  /** The layer rises from +6 px below its box. */
  riseY: 6,
  /** Layers of one batch start this far apart, in document order… */
  staggerMs: 16,
  /** …tightened so the whole batch ends by this time. */
  batchMs: 600,
  /** More new layers than this: one fade of the layer holding them all, no reflow. */
  largeBatch: 200,
} as const

/** cubic-bezier easing (x1, y1, x2, y2), solved for y at x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    let t = x
    for (let i = 0; i < 32; i++) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-6) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

const buildEase = cubicBezier(...BUILD_MOTION.ease)

/** Stagger between the layers of an `n`-layer batch (board 35: min(16, 400 / (n − 1))). */
function staggerFor(n: number): number {
  if (n <= 1) return 0
  const room = BUILD_MOTION.batchMs - BUILD_MOTION.durationMs
  return Math.min(BUILD_MOTION.staggerMs, room / (n - 1))
}

/**
 * Whether a change's new layers animate: the built-in agent (`agent:*`) and MCP clients
 * (`mcp:*`), also when relayed by the document host (`remote:agent:*`, `remote:mcp:*`). Never
 * undo / redo, loads or repairs; never the user, collaborators, files or the system.
 */
function animatesChange(origin: string, cause: string): boolean {
  if (cause !== "ops" && cause !== "update") return false
  const o = origin.startsWith("remote:") ? origin.slice(7) : origin
  return o.startsWith("agent:") || o.startsWith("mcp:")
}

/** What the scheduler reads from the document. */
export interface MotionNodes {
  /** Node data (`parent`, `type`), or undefined when it does not exist. */
  getNode(id: string): { parent?: unknown; type?: unknown } | undefined
}

interface Entrance {
  start: number
  /** Large-batch fade: opacity only. */
  fade: boolean
}

interface Reflow {
  start: number
  from: Rect
  to: Rect
  /** Draws an in-between size (frames and rectangles). */
  sized: boolean
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export class BuildMotion {
  /** Every id a change has touched so far: a layer seen before never animates again. */
  private readonly seen = new Set<string>()
  /** New layers from agent changes, waiting for the layout that places them. */
  private readonly pending = new Set<string>()
  private readonly entrances = new Map<string, Entrance>()
  private readonly reflows = new Map<string, Reflow>()

  constructor(
    private readonly nodes: MotionNodes,
    private readonly reduced: () => boolean,
    private readonly now: () => number = () => globalThis.performance?.now() ?? Date.now(),
  ) {}

  /**
   * One store change (call before the layout update). `laidOut` answers for the layout the
   * canvas shows now (a layer already on screen is never new).
   */
  noteChange(
    change: { origin: string; cause: string; nodes: Iterable<string> },
    laidOut: (id: string) => boolean,
  ): void {
    const agent = animatesChange(change.origin, change.cause) && !this.reduced()
    // Your own edits stay instant: they end every animation at once.
    if (change.origin === "user") this.clear()
    for (const id of change.nodes) {
      if (agent && !this.seen.has(id) && !laidOut(id) && this.nodes.getNode(id))
        this.pending.add(id)
      this.seen.add(id)
    }
  }

  /** Forgets every running animation (the next frame draws the final state). */
  clear(): void {
    this.pending.clear()
    this.entrances.clear()
    this.reflows.clear()
  }

  /**
   * The layout pass after the changes (`prev` = the one before): starts the entrances of the
   * pending layers it placed and the reflow of the layers it moved.
   */
  afterLayout(prev: LayoutResult | null, next: LayoutResult): void {
    if (this.pending.size === 0) return
    const fresh = new Set<string>()
    for (const id of this.pending) if (next.nodes.get(id)?.visible) fresh.add(id)
    this.pending.clear()
    if (fresh.size === 0 || this.reduced()) return
    const t = this.now()
    if (fresh.size > BUILD_MOTION.largeBatch) {
      for (const id of this.fadeTargets(fresh, next))
        this.entrances.set(id, { start: t, fade: true })
      return
    }
    // Document order: the layout's paint order (parents before children, sibling order).
    const ordered: string[] = []
    for (const id of next.order) if (fresh.has(id)) ordered.push(id)
    const step = staggerFor(ordered.length)
    ordered.forEach((id, i) => {
      this.entrances.set(id, { start: t + i * step, fade: false })
    })
    if (!prev) return
    // Reflow: what moved or resized, from where it is drawn now to its new box.
    const isNew = (id: string): boolean => {
      for (let c: string | null = id, i = 0; c && i < 4096; i++) {
        if (fresh.has(c)) return true
        c = this.parentOf(c)
      }
      return false
    }
    for (const id of next.changed) {
      const a = prev.nodes.get(id)
      const b = next.nodes.get(id)
      if (!a || !b || !a.visible || !b.visible || isNew(id)) continue
      if (sameRect(a.world, b.world)) continue
      const drawn = this.drawnBox(id, a.world, t)
      const type = this.nodes.getNode(id)?.type
      this.reflows.set(id, {
        start: t,
        from: drawn,
        to: b.world,
        sized: type === "frame" || type === "rect",
      })
    }
  }

  /** True while an entrance or reflow is still running (or waiting for its start). */
  animating(): boolean {
    if (this.entrances.size === 0 && this.reflows.size === 0) return false
    const t = this.now()
    const end = BUILD_MOTION.durationMs
    for (const e of this.entrances.values()) if (t - e.start < end) return true
    for (const r of this.reflows.values()) if (t - r.start < end) return true
    return false
  }

  /**
   * Per-node motion for the frame at `now` (null when nothing moves: the renderer draws the
   * final state). Drops what has finished.
   */
  frame(layout: LayoutResult | null): MotionFrame | null {
    if (!layout || (this.entrances.size === 0 && this.reflows.size === 0)) return null
    if (this.reduced()) {
      this.clear()
      return null
    }
    const t = this.now()
    const d = BUILD_MOTION.durationMs
    const out = new Map<string, NodeMotion>()
    /** World offset each node is drawn at (its own plus its ancestors'). */
    const abs = new Map<string, { x: number; y: number }>()
    for (const [id, r] of this.reflows) {
      const k = buildEase((t - r.start) / d)
      if (t - r.start >= d || !layout.nodes.has(id)) {
        this.reflows.delete(id)
        continue
      }
      const box = lerpRect(r.from, r.to, k)
      const fin = layout.nodes.get(id)?.world ?? r.to
      abs.set(id, { x: box.x - fin.x, y: box.y - fin.y })
      const m: NodeMotion = {}
      if (r.sized && (Math.abs(box.w - fin.w) > 0.01 || Math.abs(box.h - fin.h) > 0.01)) {
        const local = layout.nodes.get(id)?.local
        if (local) {
          m.w = Math.max(0, local.w + (box.w - fin.w))
          m.h = Math.max(0, local.h + (box.h - fin.h))
        }
      }
      out.set(id, m)
    }
    // Offsets relative to the nearest moving ancestor (children ride with their parent).
    for (const [id, m] of out) {
      const own = abs.get(id) ?? { x: 0, y: 0 }
      const up = this.ancestorOffset(id, abs)
      const dx = own.x - up.x
      const dy = own.y - up.y
      if (Math.abs(dx) > 0.01) m.dx = dx
      if (Math.abs(dy) > 0.01) m.dy = dy
      if (m.dx === undefined && m.dy === undefined && m.w === undefined && m.h === undefined)
        out.delete(id)
    }
    for (const [id, e] of this.entrances) {
      if (!layout.nodes.has(id) || t - e.start >= d) {
        this.entrances.delete(id)
        continue
      }
      const k = t < e.start ? 0 : buildEase((t - e.start) / d)
      const m = out.get(id) ?? {}
      m.opacity = lerp(BUILD_MOTION.fromOpacity, 1, k)
      if (!e.fade) {
        m.scale = lerp(BUILD_MOTION.fromScale, 1, k)
        m.dy = (m.dy ?? 0) + BUILD_MOTION.riseY * (1 - k)
      }
      out.set(id, m)
    }
    return out.size ? out : null
  }

  private parentOf(id: string): string | null {
    const p = this.nodes.getNode(id)?.parent
    return typeof p === "string" ? p : null
  }

  private ancestorOffset(id: string, abs: ReadonlyMap<string, { x: number; y: number }>) {
    for (let c = this.parentOf(id), i = 0; c && i < 4096; i++, c = this.parentOf(c)) {
      const o = abs.get(c)
      if (o) return o
    }
    return { x: 0, y: 0 }
  }

  /** Where a layer is drawn now: mid-reflow, its in-between box; else `fallback`. */
  private drawnBox(id: string, fallback: Rect, t: number): Rect {
    const r = this.reflows.get(id)
    if (!r) return fallback
    const k = buildEase((t - r.start) / BUILD_MOTION.durationMs)
    return lerpRect(r.from, r.to, k)
  }

  /**
   * Large batch: the layer holding every new layer (their lowest common ancestor, a new layer
   * itself when one contains the rest); the top-most new layers when that is the page.
   */
  private fadeTargets(fresh: ReadonlySet<string>, layout: LayoutResult): string[] {
    const top = [...fresh].filter((id) => {
      const p = this.parentOf(id)
      return !(p && fresh.has(p))
    })
    const chain = (id: string): string[] => {
      const out: string[] = []
      for (let c: string | null = id, i = 0; c && i < 4096; i++, c = this.parentOf(c)) out.push(c)
      return out
    }
    let common: string[] | null = null
    for (const id of top) {
      const c = chain(id)
      if (!common) common = c
      else {
        const set = new Set(c)
        common = common.filter((x) => set.has(x))
      }
      if (common.length === 0) break
    }
    const lca = common?.[0]
    if (lca && layout.nodes.has(lca)) return [lca]
    return top.filter((id) => layout.nodes.has(id))
  }
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.w - b.w) < 0.01 &&
    Math.abs(a.h - b.h) < 0.01
  )
}

function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) }
}
