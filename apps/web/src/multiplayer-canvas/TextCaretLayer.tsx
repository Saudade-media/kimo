/**
 * Board 41 › 11 "Live text" (desing.pen ExORz, rules pCwkf) on the canvas: other people's carets
 * and ranges inside text layers, and agents' carets after their writes.
 *
 * - Remote Caret (`T12pYW`, 2 wide, the line box tall, layout none) › Bar (`qs7mU`: 2 screen px
 *   at any zoom, 1.2 × the font size centered on the line, presence color or the agent's persona
 *   hue) · Flag (`BkOUb`: presence fill, radius 3 3 3 0, gap 3, padding [1, 5], center › Label
 *   sans text-xs 500 on-accent; its bottom edge on the bar's top, flipped below with radius 0 3 3
 *   3 on the layer's first line). Agents' flags (`gTDLB`) lead with AgentMark 12, padding
 *   [1, 5, 1, 2].
 * - Carets at one spot (`K5Jj8v`): one bar position, flags stacked 2 apart, the most recent
 *   typer closest and their bar on top.
 * - Remote Range (`d7UsO`): the person's color at 0.24, one full-line-height box per line.
 * - Flags fade 150 ms after 3 s without a keystroke from that person; hovering the caret shows the
 *   flag; below 50 % zoom flags hide and hovering shows a Tooltip; flags hide while you drag.
 * - Idle (`tTnQN`): caret and flag at 0.5, "Maya · idle".
 *
 * Positions come from the renderer's text layout for layers you are not editing and from the
 * contenteditable's range rects for the layer you edit. React renders the set (who, where they
 * stack, labels, colors); offsets, pans, zooms and layout passes move it imperatively, so remote
 * typing costs style writes only, never a React render.
 */
import type { DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { TextGeometry } from "@kimo/renderer"
import { TooltipContent } from "@kimo/ui"
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { CanvasAgentMark } from "../canvas/agent-mark"
import type { UiStore } from "../canvas/contract"
import { editorTextGeometry } from "../canvas/rich-text/dom-geometry"
import { currentTextSession, subscribeTextSession } from "../canvas/rich-text/session"
import type { Bus } from "../lib/hooks"
import {
  type ClaimOutlineView,
  type ClaimPersona,
  personaOfHolder,
} from "../multiplayer/canvas-model"
import type { DocumentShareModel } from "../multiplayer/model"
import type { PresenceColor } from "../multiplayer/presence"
import {
  type AgentTextCaret,
  CaretActivity,
  caretBar,
  caretGroups,
  caretSpot,
  flagLabel,
  flagRadius,
  flagState,
  flagTop,
  nextFade,
  REMOTE_CARET_W,
  rangeRows,
  typists,
} from "../multiplayer/text-caret-view"
import { remoteTextCarets } from "../multiplayer/text-carets"

/** One caret in a text layer, whatever its source. */
interface Item {
  key: string
  kind: "person" | "agent"
  node: string
  label: string
  idle: boolean
  color: PresenceColor | null
  persona: ClaimPersona | null
  /** An agent running here (its mark animates). */
  working: boolean
  anchor: number
  focus: number
  /** Changes whenever the caret moves (encoded positions). */
  sig: string
}

interface Shape {
  groups: { id: string; keys: string[] }[]
  carets: Omit<Item, "anchor" | "focus" | "sig">[]
  ranges: string[]
}

const hue = (it: Pick<Item, "color" | "persona">) =>
  it.color ? `var(--kimo-${it.color})` : "var(--mp-hue)"

/** Hover tolerance around a 2 px bar (screen px). */
const HOVER_SLOP = 3

export interface TextCaretLayerProps {
  /** The shared document (people's carets); null while not shared. */
  doc: DocumentShareModel | null
  store: DocStore
  ui: UiStore
  layout: Bus<LayoutResult | null>
  /** The renderer's layout of a text layer (layers you are not editing). */
  geometry(node: string): TextGeometry | null
  /** Agents' carets after their writes. */
  agentCarets: readonly AgentTextCaret[]
  /** Claim outlines (an agent's caret takes its label and hue). */
  outlines: readonly ClaimOutlineView[]
}

export function TextCaretLayer(props: TextCaretLayerProps) {
  const { doc, store, ui, layout } = props
  const layer = useRef<HTMLDivElement>(null)
  const activity = useRef(new CaretActivity()).current
  const propsRef = useRef(props)
  propsRef.current = props

  /** Every caret now (offsets resolved against the store). */
  const collect = useCallback((): Item[] => {
    const { agentCarets, outlines } = propsRef.current
    const out: Item[] = []
    if (doc) {
      const view = doc.getState()
      const nodes = new Set<string>()
      for (const p of view.people) if (!p.isYou && p.text) nodes.add(p.text.node)
      for (const a of view.agents) if (!a.isYours && a.text) nodes.add(a.text.node)
      for (const node of nodes)
        for (const c of remoteTextCarets(view, store, node)) {
          const t =
            c.kind === "person"
              ? view.people.find((p) => p.peer === c.peer)?.text
              : view.agents.find((a) => a.holder === c.key)?.text
          out.push({
            key: c.key,
            kind: c.kind,
            node,
            label: c.label,
            idle: c.idle,
            color: c.color,
            persona: c.kind === "agent" ? personaOfHolder(c.key) : null,
            working: false,
            anchor: c.anchor,
            focus: c.focus,
            sig: t ? `${t.anchor}\n${t.focus}` : "",
          })
        }
    }
    for (const a of agentCarets) {
      if (out.some((x) => x.key === a.holder)) continue
      const o = outlines.find((x) => x.holder === a.holder)
      if (!o) continue
      const at = store.resolveTextPosition(a.node, a.position)
      if (at === null) continue
      out.push({
        key: a.holder,
        kind: "agent",
        node: a.node,
        label: o.label,
        idle: false,
        color: null,
        persona: o.persona,
        working: o.local && !o.paused,
        anchor: at,
        focus: at,
        sig: `${a.position}\n${a.at}`,
      })
    }
    const now = Date.now()
    for (const it of out) activity.touch(it.key, it.sig, now)
    activity.keep(out.map((x) => x.key))
    return out
  }, [doc, store, activity])

  const getShape = useCallback((): string => {
    const items = collect()
    const groups = caretGroups(items.map((it) => ({ ...it, activeAt: activity.at(it.key) }))).map(
      (g) => ({ id: g.map((x) => x.key).join("|"), keys: g.map((x) => x.key) }),
    )
    const shape: Shape = {
      groups,
      carets: items.map(({ anchor: _a, focus: _f, sig: _s, ...rest }) => rest),
      ranges: items.filter((it) => it.anchor !== it.focus).map((it) => it.key),
    }
    return JSON.stringify(shape)
  }, [collect, activity])

  const subscribe = useCallback(
    (l: () => void) => {
      const offs = [store.onChange(l), layout.subscribe(l), ...(doc ? [doc.subscribe(l)] : [])]
      return () => {
        for (const off of offs) off()
      }
    },
    [doc, store, layout],
  )
  // Read on every render too, so agent carets and outlines (props) count.
  const shapeKey = useSyncExternalStore(subscribe, getShape, getShape)
  const shape = JSON.parse(shapeKey) as Shape
  const byKey = new Map(shape.carets.map((c) => [c.key, c]))

  const hovered = useRef<string | null>(null)
  const dragging = useRef(false)
  const [tip, setTip] = useState<string | null>(null)
  /** Bars on screen (hover hit testing), from the last placement. */
  const bars = useRef<{ key: string; x: number; y: number; h: number }[]>([])
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Positions every caret, range and flag for the current text, viewport and layout. */
  const place = useCallback(() => {
    const root = layer.current
    if (!root) return
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    fadeTimer.current = null
    const v = ui.getState().viewport
    const z = v.zoom
    const now = Date.now()
    const items = new Map(collect().map((it) => [it.key, it]))
    const session = currentTextSession(ui)
    const editing = session?.nodeId ?? null
    const editor =
      editing !== null
        ? (root.parentElement?.querySelector<HTMLElement>(".canvas-host__text-editor") ??
          document.querySelector<HTMLElement>(".canvas-host__text-editor"))
        : null
    const origin = root.getBoundingClientRect()
    const geometries = new Map<string, TextGeometry | null>()
    const geometryOf = (node: string) => {
      if (geometries.has(node)) return geometries.get(node) ?? null
      const g =
        node === editing && editor
          ? editorTextGeometry(editor, (cx, cy) => ({
              x: (cx - origin.left) / z + v.x,
              y: (cy - origin.top) / z + v.y,
            }))
          : propsRef.current.geometry(node)
      geometries.set(node, g)
      return g
    }
    const placed: { key: string; x: number; y: number; h: number }[] = []
    let soonest: number | null = null

    for (const el of root.querySelectorAll<HTMLElement>("[data-mp-text-range]")) {
      const it = items.get(el.dataset.mpTextRange ?? "")
      const g = it ? geometryOf(it.node) : null
      const rows = it && g ? rangeRows(g, it.anchor, it.focus) : []
      while (el.childElementCount > rows.length) el.lastElementChild?.remove()
      while (el.childElementCount < rows.length) {
        const r = document.createElement("div")
        r.className = "mp-text-range__row"
        r.dataset.testid = "mp-text-range-row"
        el.append(r)
      }
      rows.forEach((row, i) => {
        const r = el.children[i] as HTMLElement
        r.style.left = `${(row.x - v.x) * z}px`
        r.style.top = `${(row.y - v.y) * z}px`
        r.style.width = `${row.w * z}px`
        r.style.height = `${row.h * z}px`
      })
    }

    for (const el of root.querySelectorAll<HTMLElement>("[data-mp-text-caret]")) {
      const keys = (el.dataset.mpTextCaret ?? "").split("|")
      const lead = items.get(keys[0] ?? "")
      const g = lead ? geometryOf(lead.node) : null
      const spot = lead && g ? caretSpot(g, lead.focus) : null
      if (!lead || !spot) {
        el.style.display = "none"
        continue
      }
      el.style.display = ""
      const x = (spot.x - v.x) * z
      const top = (spot.top - v.y) * z
      el.style.left = `${x}px`
      el.style.top = `${top}px`
      el.style.height = `${spot.height * z}px`
      const bar = caretBar(spot, z)
      for (const b of el.querySelectorAll<HTMLElement>("[data-mp-text-bar]")) {
        b.style.top = `${bar.top}px`
        b.style.height = `${bar.height}px`
      }
      placed.push({ key: el.dataset.mpTextCaret ?? "", x, y: top + bar.top, h: bar.height })
      const isHovered = hovered.current === el.dataset.mpTextCaret
      keys.forEach((key, index) => {
        const flag = el.querySelector<HTMLElement>(`[data-mp-text-flag="${CSS.escape(key)}"]`)
        const it = items.get(key)
        if (!flag || !it) return
        const activeAt = activity.at(key)
        const state = flagState({
          now,
          activeAt,
          zoom: z,
          hovered: isHovered,
          dragging: dragging.current,
        })
        flag.dataset.state = state
        flag.dataset.below = spot.firstLine ? "true" : "false"
        flag.style.top = `${flagTop(bar, spot.firstLine, index)}px`
        flag.style.borderRadius = flagRadius(spot.firstLine)
        if (state === "shown" && !isHovered) {
          const next = nextFade(now, activeAt)
          if (next !== null && (soonest === null || next < soonest)) soonest = next
        }
      })
      const tooltip = root.querySelector<HTMLElement>("[data-mp-text-tooltip]")
      if (tooltip && tooltip.dataset.mpTextTooltip === el.dataset.mpTextCaret) {
        const show = isHovered && z < 0.5 && !dragging.current
        tooltip.style.display = show ? "" : "none"
        tooltip.style.left = `${x + REMOTE_CARET_W / 2}px`
        tooltip.style.top = `${top + bar.top - 6}px`
      }
    }
    bars.current = placed
    if (soonest !== null) fadeTimer.current = setTimeout(place, soonest + 1)
  }, [ui, collect, activity])

  useLayoutEffect(() => {
    place()
  })
  useEffect(() => {
    let offSession: (() => void) | null = null
    const watch = () => {
      offSession?.()
      offSession = currentTextSession(ui)?.subscribe(() => requestAnimationFrame(place)) ?? null
      place()
    }
    const offs = [
      // Someone else's keystrokes: the flag shows at once (theirs is the caret at the end).
      store.onTextChange((e) => {
        if (e.origin === "user" || !e.delta) return
        const now = Date.now()
        for (const key of typists(e.id, e.delta, collect())) activity.bump(key, now)
      }),
      store.onChange(place),
      layout.subscribe(place),
      ui.subscribe((s, prev) => {
        if (s.viewport !== prev.viewport) place()
      }),
      subscribeTextSession(ui, watch),
      ...(doc ? [doc.subscribe(place)] : []),
    ]
    watch()
    // Hover a caret (its flag or Tooltip shows); drag a selection (flags hide).
    let down: { x: number; y: number } | null = null
    const onMove = (e: PointerEvent) => {
      if (down && (e.buttons & 1) === 1) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3
        if (moved && !dragging.current) {
          dragging.current = true
          place()
        }
      }
      const root = layer.current
      if (!root) return
      const r = root.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const hit =
        bars.current.find(
          (b) =>
            px >= b.x - HOVER_SLOP &&
            px <= b.x + REMOTE_CARET_W + HOVER_SLOP &&
            py >= b.y &&
            py <= b.y + b.h,
        )?.key ?? null
      if (hit !== hovered.current) {
        hovered.current = hit
        setTip(hit)
        place()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => {
      down = null
      if (dragging.current) {
        dragging.current = false
        place()
      }
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("pointerdown", onDown, { capture: true })
    window.addEventListener("pointerup", onUp, { capture: true })
    window.addEventListener("pointercancel", onUp, { capture: true })
    const root = layer.current
    let ro: ResizeObserver | null = null
    if (root && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(place)
      ro.observe(root)
    }
    return () => {
      for (const off of offs) off()
      offSession?.()
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerdown", onDown, { capture: true })
      window.removeEventListener("pointerup", onUp, { capture: true })
      window.removeEventListener("pointercancel", onUp, { capture: true })
      ro?.disconnect()
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    }
  }, [doc, store, ui, layout, place, collect, activity])

  if (!shape.carets.length) return null
  const tipGroup = tip ? shape.groups.find((g) => g.id === tip) : undefined
  const tipCaret = tipGroup ? byKey.get(tipGroup.keys[0] ?? "") : undefined
  return (
    <div ref={layer} className="mp-text" data-testid="mp-text-layer">
      {shape.ranges.map((key) => {
        const c = byKey.get(key)
        if (!c) return null
        return (
          <div
            key={`r:${key}`}
            className={`mp-text-range${c.persona && !c.color ? ` mp-claim--${c.persona}` : ""}`}
            data-testid="mp-text-range"
            data-mp-text-range={key}
            style={{ "--mp-color": hue(c) } as CSSProperties}
          />
        )
      })}
      {shape.groups.map((g) => {
        const carets = g.keys.flatMap((k) => byKey.get(k) ?? [])
        const allIdle = carets.every((c) => c.idle)
        return (
          <div
            key={`c:${g.id}`}
            className={`mp-text-caret${allIdle ? " mp-text-caret--idle" : ""}`}
            data-testid="mp-text-caret"
            data-mp-text-caret={g.id}
            style={{ display: "none" }}
          >
            {/* The most recent typer's bar is drawn last (on top); bars never offset. */}
            {[...carets].reverse().map((c) => (
              <div
                key={`b:${c.key}`}
                className={`mp-text-caret__bar${c.persona && !c.color ? ` mp-claim--${c.persona}` : ""}${!allIdle && c.idle ? " mp-text-caret--idle" : ""}`}
                data-testid="mp-text-caret-bar"
                data-mp-text-bar={c.key}
                style={{ background: hue(c) }}
              />
            ))}
            {carets.map((c) => (
              <div
                key={`f:${c.key}`}
                className={`mp-text-flag${c.kind === "agent" ? " mp-text-flag--agent" : ""}${c.persona && !c.color ? ` mp-claim--${c.persona}` : ""}${!allIdle && c.idle ? " mp-text-caret--idle" : ""}`}
                data-testid="mp-text-flag"
                data-mp-text-flag={c.key}
                data-state="shown"
                style={{ background: hue(c) }}
              >
                {c.kind === "agent" && (
                  <CanvasAgentMark
                    state={c.working ? "working" : "idle"}
                    persona={c.persona ?? "agent"}
                    size={12}
                  />
                )}
                <span className="mp-text-flag__label">{flagLabel(c.label, c.idle)}</span>
              </div>
            ))}
          </div>
        )
      })}
      {tipGroup && tipCaret && (
        <div
          className="mp-text-tooltip"
          data-mp-text-tooltip={tipGroup.id}
          style={{ display: "none" }}
        >
          <TooltipContent data-testid="mp-text-tooltip">
            {flagLabel(tipCaret.label, tipCaret.idle)}
          </TooltipContent>
        </div>
      )}
    </div>
  )
}
