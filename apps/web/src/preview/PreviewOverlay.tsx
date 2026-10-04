/**
 * Preview overlay — board 27 §9 (a) "Editor Window · Preview" (PMt3U, 868 × 540 in the vignette,
 * the whole window here): vertical, fill #0E0E10, clip. Children in node order:
 *
 *   Preview Bar (dMexB) 44 high, fill #161618, bottom stroke 1 #FFFFFF14, gap 10, padding [0, 12],
 *     alignItems center: KimoLogo/Small 16 (#F2F2F3) · Frame Name (sans 12 #F2F2F3) ·
 *     Frame Nav (pill #FFFFFF0F, padding [0, 4], gap 2: chevron-left 24² · Count mono 11 · chevron-right 24²) ·
 *     Spacer · Theme Toggle (pill #FFFFFF0F, padding 2, gap 2: sun / moon 28 × 24 segments) ·
 *     Theme Select (one per axis; pill 28 high #FFFFFF0F, padding [0, 10], gap 6) ·
 *     Zoom (same, mono value) · Exit (28 high, stroke 1 #FFFFFF24, padding [0, 6, 0, 10], gap 6, esc key)
 *   Stage (I6kjY) fill × fill, padding 24 (the fit margin), the frame centred with shadow 0 12 40 #00000080
 *   Hint Row (szqdl) 28 high, centred, gap 16: ← → Previous / next frame · 0 Fit · 1 100 % ·
 *     T Toggle light / dark · esc Exit
 *
 * Rules PTmL2: in-place (ui mode "preview"), every editor surface hidden; ‹ › / ← → step through
 * the page's top-level frames; T + axis selects are preview-only theme overrides (never written);
 * Fit (0) · 50 · 100 (1) · 200 %, ⌘-scroll / pinch zoom, space-drag pans; Esc / Exit / ⇧Space
 * leave and restore the selection (the last frame becomes selected when navigation happened).
 */
import type { Libraries, Theme } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import { KimoLogo, MenuItem } from "@kimo/ui"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Icon } from "../lib/icons"
import { MenuPopover } from "../lib/MenuPopover"
import {
  type Box,
  centeredView,
  clampZoom,
  countLabel,
  fitZoom,
  frameName,
  initialThemes,
  isDark,
  lightDarkAxis,
  presetLabel,
  previewKey,
  selectAxes,
  stepFrame,
  themeAxes,
  toggleLightDark,
  topLevelFrames,
  type View,
  ZOOM_PRESETS,
  type ZoomPreset,
  zoomAbout,
  zoomLabel,
} from "./model"
import { PreviewRender, type PreviewRenderDeps } from "./render"
import "./preview.css"

export interface PreviewOverlayProps extends PreviewRenderDeps {
  store: DocStore
  libraries: () => Libraries
  /** The frame Preview opened on. */
  frameId: string
  /** The page's root ids (null: the store's roots). */
  roots?: () => readonly string[]
  /** Leaves Preview with the last previewed frame and whether ‹ › navigation happened. */
  onExit(last: string, navigated: boolean): void
}

export function PreviewOverlay(props: PreviewOverlayProps) {
  const { store, libraries, onExit } = props
  const frames = useFrames(store, props.roots)
  const [frame, setFrame] = useState(props.frameId)
  const [navigated, setNavigated] = useState(false)
  const header = useHeaderThemes(store)
  const axes = useMemo(() => themeAxes(header), [header])
  const ld = useMemo(() => lightDarkAxis(axes), [axes])
  // Preview-only overrides (never written): each frame starts from its own pinned themes; the
  // axes the viewer picked here (T, the selects) stay picked while stepping through frames.
  const [picked, setPicked] = useState<Theme>({})
  // biome-ignore lint/correctness/useExhaustiveDependencies: pins re-read when the header changes
  const themes = useMemo<Theme>(
    () => ({ ...initialThemes(store.toDocument(), frame, libraries()), ...picked }),
    [store, frame, picked, libraries, header],
  )
  const themesRef = useRef(themes)
  themesRef.current = themes
  const pick = useCallback(
    (axis: string, value: string | undefined) =>
      value !== undefined && setPicked((p) => ({ ...p, [axis]: value })),
    [],
  )
  const [preset, setPreset] = useState<ZoomPreset | null>("fit")
  const [view, setView] = useState<View | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pipe = useRef<PreviewRender | null>(null)
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const presetRef = useRef(preset)
  presetRef.current = preset
  const spaceHeld = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view

  // Exit: stable callback reading the latest frame / navigation flag.
  const exitRef = useRef(() => onExit(frame, navigated))
  exitRef.current = () => onExit(frame, navigated)
  const exit = useCallback(() => exitRef.current(), [])

  const go = useCallback(
    (delta: -1 | 1) => {
      const next = stepFrame(frames, frame, delta)
      if (next === frame) return
      setFrame(next)
      setNavigated(true)
      setPreset("fit")
    },
    [frames, frame],
  )

  const applyPreset = useCallback((p: ZoomPreset, b: Box | null = pipe.current?.box() ?? null) => {
    setPreset(p)
    const { w, h } = size.current
    if (!b || !w || !h) return
    const z = p === "fit" ? fitZoom(b, w, h) : p
    setView(centeredView(b, w, h, z))
  }, [])

  // Pipeline lifetime.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one pipeline per overlay
  useEffect(() => {
    const el = stage.current
    const c = canvas.current
    if (!el || !c) return
    const r = el.getBoundingClientRect()
    size.current = { w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 }
    const p = new PreviewRender(props, (b) => {
      setBox(b)
      // Re-fit while at Fit (first layout, a frame switch, a background edit resizing it).
      if (presetRef.current === "fit" && b) {
        const { w, h } = size.current
        if (w && h) setView(centeredView(b, w, h, fitZoom(b, w, h)))
      }
    })
    pipe.current = p
    p.set(frame, themes)
    p.start(c, size.current.w, size.current.h, size.current.dpr).catch((e: unknown) =>
      setFailed(e instanceof Error ? e.message : String(e)),
    )
    const ro = new ResizeObserver(() => {
      const b = el.getBoundingClientRect()
      size.current = { w: b.width, h: b.height, dpr: window.devicePixelRatio || 1 }
      p.resize(b.width, b.height, size.current.dpr)
      if (presetRef.current) applyPreset(presetRef.current)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      p.dispose()
      pipe.current = null
    }
  }, [])

  useEffect(() => {
    pipe.current?.set(frame, themes)
  }, [frame, themes])

  useEffect(() => {
    if (view) pipe.current?.setView(view)
  }, [view])

  // Keys: capture phase on window, before every editor / canvas binding; all keys stay here
  // while Preview is open (the hidden editor must not edit underneath).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = previewKey(e)
      if (e.code === "Space" && !e.shiftKey) {
        spaceHeld.current = true
        stage.current?.classList.add("preview__stage--grab")
      }
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (!a) {
        if (!e.metaKey && !e.ctrlKey) e.preventDefault()
        return
      }
      e.preventDefault()
      if (a.kind === "exit") exit()
      else if (a.kind === "step") go(a.delta)
      else if (a.kind === "zoom") applyPreset(a.preset)
      else if (ld) pick(ld.axis, toggleLightDark(axes, themesRef.current)[ld.axis])
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false
        stage.current?.classList.remove("preview__stage--grab")
      }
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("keyup", onUp, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keyup", onUp, true)
    }
  }, [exit, go, applyPreset, axes, ld, pick])

  // Pan (space-drag, middle-drag, wheel) and zoom (⌘ / ctrl wheel, pinch) on the stage.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      if (!v) return
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const z = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.01))
        setPreset(null)
        setView(zoomAbout(v, e.clientX - r.left, e.clientY - r.top, z))
      } else {
        setPreset(null)
        setView({ ...v, x: v.x + e.deltaX / v.zoom, y: v.y + e.deltaY / v.zoom })
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!spaceHeld.current && e.button !== 1) return
    const v0 = viewRef.current
    if (!v0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const move = (m: PointerEvent) => {
      setPreset(null)
      setView({ ...v0, x: v0.x - (m.clientX - sx) / v0.zoom, y: v0.y - (m.clientY - sy) / v0.zoom })
    }
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }

  const zoom = view?.zoom ?? 1
  const shadow =
    box && view
      ? {
          left: (box.x - view.x) * view.zoom,
          top: (box.y - view.y) * view.zoom,
          width: box.w * view.zoom,
          height: box.h * view.zoom,
        }
      : null
  const dark = isDark(axes, themes)
  const index = frames.indexOf(frame)

  return (
    <div
      className="preview"
      role="dialog"
      aria-label="Preview"
      data-frame={frame}
      data-zoom={view ? view.zoom.toFixed(4) : undefined}
      data-box={box ? `${box.x},${box.y},${box.w},${box.h}` : undefined}
    >
      <div className="preview__bar">
        <span className="preview__logo">
          <KimoLogo size={16} />
        </span>
        <span className="preview__name">{frameName(store, frame)}</span>
        <div className="preview__nav">
          <button
            type="button"
            className="preview__nav-btn"
            aria-label="Previous frame"
            disabled={index <= 0}
            onClick={() => go(-1)}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <span className="preview__count">{countLabel(frames, frame)}</span>
          <button
            type="button"
            className="preview__nav-btn"
            aria-label="Next frame"
            disabled={index < 0 || index >= frames.length - 1}
            onClick={() => go(1)}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
        <span className="preview__spacer" />
        <div className="preview__theme">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={(m === "dark") === dark}
              aria-label={m === "dark" ? "Dark" : "Light"}
              className={(m === "dark") === dark ? "preview__seg preview__seg--on" : "preview__seg"}
              disabled={!ld}
              onClick={() => {
                if (!ld) return
                pick(ld.axis, m === "dark" ? ld.dark : ld.light)
              }}
            >
              <Icon name={m === "dark" ? "moon" : "sun"} size={14} />
            </button>
          ))}
        </div>
        {selectAxes(axes).map((axis) => (
          <MenuPopover
            key={axis}
            label={`Theme ${axis}`}
            align="end"
            className="preview__menu"
            trigger={(t) => (
              <button type="button" className="preview__pill" aria-label={`Theme ${axis}`} {...t}>
                <span className="preview__pill-value">
                  {axis}: {themes[axis] ?? axes[axis]?.[0]}
                </span>
                <span className="preview__pill-icon">
                  <Icon name="chevron-down" size={12} />
                </span>
              </button>
            )}
          >
            {() =>
              (axes[axis] ?? []).map((v) => (
                <MenuItem key={v} onSelect={() => pick(axis, v)}>
                  {v}
                </MenuItem>
              ))
            }
          </MenuPopover>
        ))}
        <MenuPopover
          label="Zoom"
          align="end"
          className="preview__menu"
          trigger={(t) => (
            <button type="button" className="preview__pill" aria-label="Zoom" {...t}>
              <span className="preview__pill-value preview__pill-value--mono">
                {zoomLabel(preset, zoom)}
              </span>
              <span className="preview__pill-icon">
                <Icon name="chevron-down" size={12} />
              </span>
            </button>
          )}
        >
          {() =>
            ZOOM_PRESETS.map((p) => (
              <MenuItem
                key={String(p)}
                shortcut={p === "fit" ? "0" : p === 1 ? "1" : undefined}
                onSelect={() => applyPreset(p)}
              >
                {presetLabel(p)}
              </MenuItem>
            ))
          }
        </MenuPopover>
        <button type="button" className="preview__exit" onClick={exit}>
          <span className="preview__exit-label">Exit</span>
          <span className="preview__key preview__key--bar">esc</span>
        </button>
      </div>
      <div ref={stage} className="preview__stage" onPointerDown={onPointerDown}>
        {shadow && <div className="preview__frame-shadow" style={shadow} />}
        <canvas ref={canvas} className="preview__canvas" />
        {failed && <span className="preview__failed">Preview could not render: {failed}</span>}
      </div>
      <div className="preview__hints">
        <Hint keys="← →" label="Previous / next frame" />
        <Hint keys="0" label="Fit" />
        <Hint keys="1" label="100 %" />
        <Hint keys="T" label="Toggle light / dark" />
        <Hint keys="esc" label="Exit" />
      </div>
    </div>
  )
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="preview__hint">
      <span className="preview__key">{keys}</span>
      <span className="preview__hint-label">{label}</span>
    </span>
  )
}

/** The page's top-level frames, live (an agent may add or remove frames while previewing). */
function useFrames(store: DocStore, roots?: () => readonly string[]): string[] {
  const read = useCallback(() => topLevelFrames(store, roots?.()), [store, roots])
  const [frames, setFrames] = useState(read)
  useLayoutEffect(() => {
    setFrames(read())
    return store.onChange(() => {
      const next = read()
      setFrames((prev) =>
        prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next,
      )
    })
  }, [store, read])
  return frames
}

/** The header's `themes` (axes), live. */
function useHeaderThemes(store: DocStore): unknown {
  const [themes, setThemes] = useState<unknown>(() => store.toHeader().themes)
  useEffect(
    () =>
      store.onChange((c) => {
        if (c.header || c.cause === "load") setThemes(store.toHeader().themes)
      }),
    [store],
  )
  return themes
}
