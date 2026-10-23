/**
 * Board 41 › 1 and 6 "Presence on canvas" (desing.pen fb4fD): other people's cursors with their
 * name pill in their presence color (`F6KWF9` Human Cursor: column gap 2 › Pointer
 * mouse-pointer-2 18 › Pill radius 999, padding [4, 10], shadow 0 4 12, label sans 12 / 500
 * on-accent), hidden when Settings › Multiplayer › Show other cursors is off; idle people at 0.5
 * with "· idle" (`QRUbc`); someone working outside the viewport docks at the nearest edge with an
 * arrow (`h065n`), click to jump there; remote selections (`p4Yz5` 1.5 outline, `J5RJD9` tag);
 * following (`i9PNJ` 2 px frame, `Z48EHk` chip).
 *
 * React renders the set (who, which layers, labels, colors); positions follow every remote
 * pointer move, pan, zoom and layout pass imperatively, so a remote mouse move costs style
 * writes only, never a React render.
 */
import type { LayoutResult } from "@kimo/layout"
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react"
import type { UiStore } from "../canvas/contract"
import { currentTextSession, subscribeTextSession } from "../canvas/rich-text/session"
import type { Bus } from "../lib/hooks"
import { Icon } from "../lib/icons"
import {
  cursorLabel,
  dockOffscreen,
  followViewport,
  type SelectionOutlineView,
  selectionOutlines,
} from "../multiplayer/canvas-model"
import type { DocumentShareModel, FollowState, PersonView } from "../multiplayer/model"
import type { PresenceColor } from "../multiplayer/presence"

/** Board 36 › Cursor: the pointer tip sits at (3, 3) inside the cursor box. */
const TIP = 3
/** Section 6 C: a tag sits on the outline's top-left corner (18 above it). */
export const SELECTION_TAG_H = 18

type Box = { x: number; y: number; w: number; h: number }

const colorVar = (c: PresenceColor) => `var(--kimo-${c})`

/** A value that keeps its identity while `keyOf` gives the same string. */
function useKeyed<T>(
  subscribe: (l: () => void) => () => void,
  get: () => T,
  keyOf: (v: T) => string,
) {
  const cache = useRef<{ key: string; value: T } | null>(null)
  const read = useCallback(() => {
    const v = get()
    const key = keyOf(v)
    if (cache.current?.key !== key) cache.current = { key, value: v }
    return cache.current.value
  }, [get, keyOf])
  return useSyncExternalStore(subscribe, read, read)
}

interface Shape {
  others: Pick<PersonView, "peer" | "label" | "color" | "idle" | "page">[]
  selections: Omit<SelectionOutlineView, "box">[]
  follow: Pick<FollowState, "peer" | "label" | "color"> | null
}

export interface PresenceLayerProps {
  doc: DocumentShareModel
  ui: UiStore
  layout: Bus<LayoutResult | null>
  showCursors: boolean
}

export function PresenceLayer({ doc, ui, layout, showCursors }: PresenceLayerProps) {
  const layer = useRef<HTMLDivElement>(null)
  const subscribe = useCallback(
    (l: () => void) => {
      const a = doc.subscribe(l)
      const b = ui.subscribe((s, prev) => {
        if (s.page !== prev.page || s.selection !== prev.selection) l()
      })
      const c = layout.subscribe(l)
      const d = subscribeTextSession(ui, l)
      return () => {
        a()
        b()
        c()
        d()
      }
    },
    [doc, ui, layout],
  )
  const getShape = useCallback((): Shape => {
    const view = doc.getState()
    const page = ui.getState().page
    const lay = layout.get()
    const has = (id: string) => !!lay?.nodes.get(id)?.visible
    return {
      others: view.people
        .filter((p) => !p.isYou)
        .map((p) => ({ peer: p.peer, label: p.label, color: p.color, idle: p.idle, page: p.page })),
      selections: selectionOutlines(view.people, {
        page,
        box: (id) => (has(id) ? { x: 0, y: 0, w: 0, h: 0 } : null),
        editing: currentTextSession(ui)?.nodeId ?? null,
      }).map(({ box: _box, ...rest }) => rest),
      follow: view.follow
        ? { peer: view.follow.peer, label: view.follow.label, color: view.follow.color }
        : null,
    }
  }, [doc, ui, layout])
  const shape = useKeyed(subscribe, getShape, JSON.stringify)
  const page = useSyncExternalStore(ui.subscribe, () => ui.getState().page)
  const onPage = (p: { page: string | null }) => p.page === null || page === null || p.page === page

  /** Positions every piece for the current presence, viewport and layout. */
  const place = useCallback(() => {
    const root = layer.current
    if (!root) return
    const view = doc.getState()
    const v = ui.getState().viewport
    const lay = layout.get()
    const size = { w: root.clientWidth, h: root.clientHeight }
    const toScreen = (b: Box): Box => ({
      x: (b.x - v.x) * v.zoom,
      y: (b.y - v.y) * v.zoom,
      w: b.w * v.zoom,
      h: b.h * v.zoom,
    })
    for (const el of root.querySelectorAll<HTMLElement>("[data-mp-cursor]")) {
      const peer = Number(el.dataset.mpCursor)
      const p = view.people.find((x) => x.peer === peer)
      const dock = root.querySelector<HTMLElement>(`[data-mp-offscreen="${peer}"]`)
      const c = p?.cursor
      if (!p || !c) {
        el.style.display = "none"
        if (dock) dock.style.display = "none"
        continue
      }
      const sx = (c.x - v.x) * v.zoom
      const sy = (c.y - v.y) * v.zoom
      const out =
        dock &&
        dockOffscreen({ x: sx, y: sy }, size, {
          w: dock.offsetWidth || 50,
          h: dock.offsetHeight || 19,
        })
      if (out && dock) {
        el.style.display = "none"
        dock.style.display = ""
        dock.style.left = `${out.x}px`
        dock.style.top = `${out.y}px`
        dock.dataset.arrow = out.arrow
        dock.dataset.x = String(c.x)
        dock.dataset.y = String(c.y)
        continue
      }
      if (dock) dock.style.display = "none"
      el.style.display = ""
      el.style.left = `${sx - TIP}px`
      el.style.top = `${sy - TIP}px`
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-mp-selection]")) {
      const id = el.dataset.mpSelection ?? ""
      const l = lay?.nodes.get(id)
      if (!l?.visible) {
        el.style.display = "none"
        continue
      }
      const b = toScreen(l.world)
      el.style.display = ""
      el.style.left = `${b.x}px`
      el.style.top = `${b.y}px`
      el.style.width = `${b.w}px`
      el.style.height = `${b.h}px`
      const tags = root.querySelector<HTMLElement>(`[data-mp-tags="${CSS.escape(id)}"]`)
      if (tags) {
        tags.style.left = `${b.x}px`
        tags.style.top = `${b.y - SELECTION_TAG_H}px`
      }
    }
  }, [doc, ui, layout])

  useLayoutEffect(() => {
    place()
  })
  useEffect(() => {
    const offs = [
      doc.subscribe(place),
      ui.subscribe((s, prev) => {
        if (s.viewport !== prev.viewport) place()
      }),
      layout.subscribe(place),
    ]
    const root = layer.current
    let ro: ResizeObserver | null = null
    if (root && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(place)
      ro.observe(root)
    }
    return () => {
      for (const off of offs) off()
      ro?.disconnect()
    }
  }, [doc, ui, layout, place])

  useFollowing(doc, ui, layer)

  const jump = (el: HTMLElement) => {
    const x = Number(el.dataset.x)
    const y = Number(el.dataset.y)
    const root = layer.current
    if (!root || !Number.isFinite(x) || !Number.isFinite(y)) return
    const v = ui.getState().viewport
    ui.getState().setViewport({
      x: x - root.clientWidth / (2 * v.zoom),
      y: y - root.clientHeight / (2 * v.zoom),
    })
  }

  return (
    <div ref={layer} className="mp-presence" data-testid="mp-presence-layer">
      {shape.selections.map((s) => (
        <div
          key={`s:${s.id}`}
          className="mp-selection"
          data-testid="mp-remote-selection"
          data-mp-selection={s.id}
          data-color={s.color}
          style={{ boxShadow: `inset 0 0 0 1.5px ${colorVar(s.color)}`, display: "none" }}
        />
      ))}
      {shape.selections.map((s) =>
        s.tags.length === 0 ? null : s.tags.length === 1 ? (
          <SelectionTag
            key={`t:${s.id}`}
            tag={s.tags[0] as Shape["selections"][0]["tags"][0]}
            id={s.id}
          />
        ) : (
          <div key={`t:${s.id}`} className="mp-selection-tags" data-mp-tags={s.id}>
            {s.tags.map((t) => (
              <SelectionTag key={t.peer} tag={t} />
            ))}
          </div>
        ),
      )}
      {showCursors &&
        shape.others.filter(onPage).map((p) => (
          <div
            key={`c:${p.peer}`}
            className={`mp-cursor${p.idle ? " mp-cursor--idle" : ""}`}
            data-testid="mp-cursor"
            data-mp-cursor={p.peer}
            data-color={p.color}
            style={{ display: "none", ["--mp-color" as string]: colorVar(p.color) }}
          >
            <span className="mp-cursor__pointer">
              <Icon name="mouse-pointer-2" size={18} />
            </span>
            <div className="mp-cursor__pill">
              <span className="mp-cursor__label">{cursorLabel(p)}</span>
            </div>
          </div>
        ))}
      {showCursors &&
        shape.others.filter(onPage).map((p) => (
          <button
            key={`o:${p.peer}`}
            type="button"
            className="mp-offscreen"
            data-testid="mp-offscreen"
            data-mp-offscreen={p.peer}
            data-canvas-overlay=""
            style={{ display: "none", ["--mp-color" as string]: colorVar(p.color) }}
            onClick={(e) => jump(e.currentTarget)}
          >
            <OffscreenArrow />
            <span className="mp-offscreen__label">{p.label}</span>
          </button>
        ))}
      {shape.follow && (
        <>
          <div
            className="mp-follow-frame"
            data-testid="mp-follow-frame"
            style={{ boxShadow: `inset 0 0 0 2px ${colorVar(shape.follow.color)}` }}
          />
          <div
            className="mp-follow-chip"
            data-testid="mp-follow-chip"
            style={{ background: colorVar(shape.follow.color) }}
          >
            <Icon name="eye" size={12} />
            <span className="mp-follow-chip__label">Following {shape.follow.label}</span>
            <span className="mp-follow-chip__key">Esc</span>
          </div>
        </>
      )}
    </div>
  )
}

/** The arrow of a docked pill: every direction is drawn, CSS shows the one in `data-arrow`. */
function OffscreenArrow() {
  return (
    <span className="mp-offscreen__arrow">
      {(
        [
          "arrow-up",
          "arrow-down",
          "arrow-left",
          "arrow-right",
          "arrow-up-left",
          "arrow-up-right",
          "arrow-down-left",
          "arrow-down-right",
        ] as const
      ).map((a) => (
        <span key={a} className="mp-offscreen__icon" data-arrow={a}>
          <Icon name={a} size={12} />
        </span>
      ))}
    </span>
  )
}

function SelectionTag({
  tag,
  id,
}: {
  tag: { peer: number; label: string; color: PresenceColor }
  /** Set on a lone tag (positioned itself); tags of a shared layer sit in a row. */
  id?: string
}) {
  return (
    <div
      className="mp-selection-tag"
      data-testid="mp-selection-tag"
      {...(id !== undefined ? { "data-mp-tags": id } : {})}
      style={{ background: colorVar(tag.color) }}
    >
      <span className="mp-selection-tag__label">{tag.label}</span>
    </div>
  )
}

/**
 * Following (section 6 D): the viewport tracks the followed person's visible rectangle (fitted,
 * centered) and page. Any pan or zoom of yours, or Esc, stops following.
 */
function useFollowing(
  doc: DocumentShareModel,
  ui: UiStore,
  layer: { current: HTMLDivElement | null },
) {
  const subscribe = useCallback((l: () => void) => doc.subscribe(l), [doc])
  const get = useCallback(() => {
    const f = doc.getState().follow
    return f ? { peer: f.peer, page: f.page, viewport: f.viewport } : null
  }, [doc])
  // Their cursor moving does not re-render: only their page and viewport matter here.
  const follow = useKeyed(subscribe, get, JSON.stringify)
  const setting = useRef(false)
  useEffect(() => {
    if (!follow) return
    const root = layer.current
    const vp = follow.viewport
    const next =
      vp && root ? followViewport(vp, { w: root.clientWidth, h: root.clientHeight }) : null
    setting.current = true
    try {
      if (follow.page && follow.page !== ui.getState().page) ui.getState().setPage(follow.page)
      if (next) ui.getState().setViewport(next)
    } finally {
      setting.current = false
    }
  }, [follow, ui, layer])
  const following = follow !== null
  useEffect(() => {
    if (!following) return
    const off = ui.subscribe((s, prev) => {
      // Any pan or zoom that is not the follow itself stops following.
      if (s.viewport !== prev.viewport && !setting.current) doc.follow(null)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, [contenteditable=true], [role=dialog]")) return
      doc.follow(null)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      off()
      window.removeEventListener("keydown", onKey)
    }
  }, [following, ui, doc])
}
