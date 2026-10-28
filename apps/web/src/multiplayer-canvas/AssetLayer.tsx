/**
 * Board 41 › 8 "Asset sync" (desing.pen y4J6x) on the canvas of a shared file:
 *
 * - A image fetching (`rUsd3`): at the layer's own box and radius, a checkerboard of 16 px
 *   bg-muted cells on bg-subtle, 1 px border, the size chip (`p43U1`: bg-overlay, pill, 1 px
 *   border, gap 5, padding [3, 8, 3, 6] › loader-circle 12 · mono 11 text-secondary) 10 from the
 *   left and 10 above the 3 px bar on the bottom edge (`lBwFc` track bg-muted, `aV8Nw` bar
 *   text-secondary). The relay reports no byte progress, so the bar is indeterminate and the
 *   chip shows the size the manifest lists.
 * - B not available yet (`A7Hy5t`): image-off 12 text-tertiary, "Waiting for someone who has
 *   it", no bar.
 * - C uploading (`PFM80`): your image stays visible; chip arrow-up "Sharing" and a white bar on
 *   a #FFFFFF66 track.
 *
 * The placeholder is clipped like the layer it covers (by every clipping frame above it), and its
 * chip scales down with small boxes (hidden below CHIP_MIN_SCALE) so it never spills out.
 *
 * A missing image that comes into view is fetched (`ensureAsset`) when Settings › Multiplayer ›
 * Fetch images and fonts is on.
 */
import type { DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { UiStore } from "../canvas/contract"
import type { Bus } from "../lib/hooks"
import { Icon } from "../lib/icons"
import type { AssetTransfers } from "../multiplayer/backend"
import {
  type AssetPlaceholderState,
  assetState,
  formatBytes,
  nodeAssetKeys,
} from "../multiplayer/canvas-model"

/** Image asset keys per node, kept current from store changes. */
class ImageIndex {
  readonly byNode = new Map<string, string[]>()
  private version = 0
  private readonly listeners = new Set<() => void>()
  private readonly off: () => void
  constructor(private readonly store: DocStore) {
    for (const id of store.nodeIds()) this.read(id)
    this.off = store.onChange((c) => {
      let any = false
      for (const id of c.nodes) if (this.read(id)) any = true
      if (any) {
        this.version += 1
        for (const l of [...this.listeners]) l()
      }
    })
  }
  private read(id: string): boolean {
    const keys = nodeAssetKeys(this.store.getNode(id) as Record<string, unknown> | undefined)
    const had = this.byNode.get(id)
    if (!keys.length) return this.byNode.delete(id)
    if (had && had.join() === keys.join()) return false
    this.byNode.set(id, keys)
    return true
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getVersion = () => this.version
  dispose() {
    this.off()
    this.listeners.clear()
  }
}

export interface AssetLayerProps {
  store: DocStore
  ui: UiStore
  layout: Bus<LayoutResult | null>
  transfers: AssetTransfers
  /** Keys held locally (the editor's asset store). */
  localKeys: ReadonlySet<string>
  fetchAssets: boolean
  ensure(key: string): void
}

interface Placeholder {
  id: string
  key: string
  state: Exclude<AssetPlaceholderState, null>
  box: { x: number; y: number; w: number; h: number; r: number }
  /** Insets (screen px) cut by clipping ancestors, as CSS `inset()` [top, right, bottom, left]. */
  clip: [number, number, number, number] | null
  /** Chip scale: 1 at the board's size, less on small boxes, 0 when hidden. */
  chip: number
  bytes: number | null
}

/** Box the chip is drawn at full size in (chip plus its 10 px insets and the bar). */
const CHIP_BOX = { w: 160, h: 64 }
const CHIP_MIN_SCALE = 0.4

/** Chip scale for a `w` × `h` box (screen px). */
function chipScale(w: number, h: number): number {
  const s = Math.min(1, w / CHIP_BOX.w, h / CHIP_BOX.h)
  return s < CHIP_MIN_SCALE ? 0 : s
}

type Rect = { x: number; y: number; w: number; h: number }

/** World rect of the clipping frames above `id` (their intersection), or null when none clips. */
function clipRect(
  store: DocStore,
  nodes: ReadonlyMap<string, { world: Rect }>,
  id: string,
): Rect | null {
  let out: Rect | null = null
  const seen = new Set<string>([id])
  let p = (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null
  while (p && !seen.has(p)) {
    seen.add(p)
    const n = store.getNode(p) as { type?: unknown; clip?: unknown; parent?: string | null }
    const l = nodes.get(p)
    if (n?.type === "frame" && n.clip === true && l) {
      const w = l.world
      if (!out) out = { ...w }
      else {
        const x = Math.max(out.x, w.x)
        const y = Math.max(out.y, w.y)
        out = {
          x,
          y,
          w: Math.min(out.x + out.w, w.x + w.w) - x,
          h: Math.min(out.y + out.h, w.y + w.h) - y,
        }
      }
    }
    p = n?.parent ?? null
  }
  return out
}

export function AssetLayer(props: AssetLayerProps) {
  const { store, ui, layout, transfers, localKeys, fetchAssets, ensure } = props
  const index = useMemo(() => new ImageIndex(store), [store])
  useEffect(() => () => index.dispose(), [index])
  useSyncExternalStore(index.subscribe, index.getVersion)
  const v = useSyncExternalStore(ui.subscribe, () => ui.getState().viewport)
  const lay = useSyncExternalStore(layout.subscribe, layout.get)
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = root.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const items: Placeholder[] = []
  const wanted: string[] = []
  for (const [id, keys] of index.byNode) {
    const l = lay?.nodes.get(id)
    if (!l?.visible) continue
    const x = (l.world.x - v.x) * v.zoom
    const y = (l.world.y - v.y) * v.zoom
    const w = l.world.w * v.zoom
    const h = l.world.h * v.zoom
    // In view only (with no measured size yet, everything laid out counts).
    if (size.w > 0 && (x + w < 0 || y + h < 0 || x > size.w || y > size.h)) continue
    // Cut by clipping frames, like the layer itself; skipped when nothing of it shows.
    const c = clipRect(store, lay?.nodes ?? new Map(), id)
    let clip: Placeholder["clip"] = null
    let vw = w
    let vh = h
    if (c) {
      const cx = (c.x - v.x) * v.zoom
      const cy = (c.y - v.y) * v.zoom
      const t = Math.max(0, cy - y)
      const lft = Math.max(0, cx - x)
      const b = Math.max(0, y + h - (cy + c.h * v.zoom))
      const rt = Math.max(0, x + w - (cx + c.w * v.zoom))
      vw = w - lft - rt
      vh = h - t - b
      if (vw <= 0 || vh <= 0) continue
      if (t || rt || b || lft) clip = [t, rt, b, lft]
    }
    for (const key of keys) {
      const state = assetState(key, { local: localKeys, ...transfers })
      if (!state) continue
      if (state === "missing" && fetchAssets) wanted.push(key)
      const n = store.getNode(id) as { radius?: unknown } | undefined
      const r = typeof n?.radius === "number" ? n.radius * v.zoom : 0
      items.push({
        id,
        key,
        state,
        box: { x, y, w, h, r },
        clip,
        chip: chipScale(vw, vh),
        bytes: transfers.fetching.find((f) => f.key === key)?.bytes ?? null,
      })
      break
    }
  }

  // Fetches start when the layer comes into view (once per key).
  const asked = useRef(new Set<string>())
  const wantedKey = wanted.join(",")
  useEffect(() => {
    for (const key of wantedKey ? wantedKey.split(",") : []) {
      if (asked.current.has(key)) continue
      asked.current.add(key)
      ensure(key)
    }
  }, [wantedKey, ensure])

  return (
    <div ref={root} className="mp-assets" data-testid="mp-asset-layer">
      {items.map((p) => (
        <AssetPlaceholderView key={`${p.id}:${p.key}`} p={p} fetching={fetchAssets} />
      ))}
    </div>
  )
}

function AssetPlaceholderView({ p, fetching }: { p: Placeholder; fetching: boolean }) {
  const { x, y, w, h, r } = p.box
  // A missing image that is being asked for shows as fetching.
  const state = p.state === "missing" && fetching ? "fetching" : p.state
  const style: CSSProperties & Record<"--mp-asset-chip", number> = {
    left: x,
    top: y,
    width: w,
    height: h,
    borderRadius: r,
    "--mp-asset-chip": p.chip,
  }
  if (p.clip) style.clipPath = `inset(${p.clip.map((n) => `${n}px`).join(" ")})`
  return (
    <div
      className={`mp-asset mp-asset--${state}${p.chip ? "" : " mp-asset--no-chip"}`}
      data-testid="mp-asset-placeholder"
      data-state={state}
      data-node-id={p.id}
      data-key={p.key}
      style={style}
    >
      <div
        className="mp-asset__view"
        style={
          p.clip
            ? { top: p.clip[0], right: p.clip[1], bottom: p.clip[2], left: p.clip[3] }
            : undefined
        }
      >
        {state === "fetching" && (
          <div className="mp-asset__status" data-testid="mp-asset-status">
            <Icon name="loader-circle" size={12} />
            <span className="mp-asset__label mp-asset__label--mono">
              {p.bytes !== null ? formatBytes(p.bytes) : "Fetching"}
            </span>
          </div>
        )}
        {state === "unavailable" && (
          <div className="mp-asset__status mp-asset__status--muted" data-testid="mp-asset-status">
            <Icon name="image-off" size={12} />
            <span className="mp-asset__label">Waiting for someone who has it</span>
          </div>
        )}
        {state === "uploading" && (
          <div className="mp-asset__status" data-testid="mp-asset-status">
            <Icon name="arrow-up" size={12} />
            <span className="mp-asset__label mp-asset__label--mono">Sharing</span>
          </div>
        )}
        {(state === "fetching" || state === "uploading") && (
          <div className="mp-asset__track" data-testid="mp-asset-track">
            <div className="mp-asset__bar" />
          </div>
        )}
      </div>
    </div>
  )
}
