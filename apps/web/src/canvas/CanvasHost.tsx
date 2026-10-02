/**
 * `<CanvasHost>` (ADR 0009): mounts the CanvasKit renderer + Yoga layout engine on a
 * devicePixelRatio-correct `<canvas>` and drives them from the DocStore and UI store through
 * {@link CanvasController}. DOM layers on top of the canvas: artboard labels (board 03
 * "Artboard Label": 12/500 text-tertiary, 22 px above each root frame, constant screen size)
 * and the inline text editor.
 */
import { RendererError } from "@kimo/renderer"
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTreeRevision, useUi } from "../lib/hooks"
import { CANVAS_TOOLS, type CanvasHandle, type CanvasHostProps } from "./contract"
import { CanvasController, type TextEditState } from "./controller"

/** Board 03: label baseline box sits 22 px above the frame (label y 40, frame y 62). */
const LABEL_OFFSET = 22

export function CanvasHost(props: CanvasHostProps & { ref?: Ref<CanvasHandle> }) {
  const { store, uiStore, className, ref } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctl = useRef<CanvasController | null>(null)
  const [ready, setReady] = useState(false)
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const labels = useRef<HTMLDivElement | null>(null)
  // React renders the label set only when the tree's shape or names change; positions follow
  // pans, zooms and layout passes imperatively (no React work per frame).
  const shape = useTreeRevision(store)
  const roots = useMemo(() => {
    void shape
    return store.children(null).flatMap((id) => {
      const n = store.getNode(id)
      return n?.type === "frame"
        ? [{ id, name: typeof n.name === "string" ? n.name : "Frame" }]
        : []
    })
  }, [store, shape])

  const placeLabels = useCallback(() => {
    const box = labels.current
    const layout = ctl.current?.layout
    if (!box) return
    const v = uiStore.getState().viewport
    for (const el of box.children) {
      if (!(el instanceof HTMLElement)) continue
      const l = layout?.nodes.get(el.dataset.artboard ?? "")
      if (!l?.visible) {
        el.style.display = "none"
        continue
      }
      el.style.display = ""
      el.style.left = `${(l.world.x - v.x) * v.zoom}px`
      el.style.top = `${(l.world.y - v.y) * v.zoom - LABEL_OFFSET}px`
      el.style.maxWidth = `${Math.max(0, l.world.w * v.zoom)}px`
    }
  }, [uiStore])
  useLayoutEffect(() => {
    if (ready) placeLabels()
  })
  useEffect(
    () =>
      uiStore.subscribe((s, prev) => {
        if (s.viewport !== prev.viewport) placeLabels()
      }),
    [uiStore, placeLabels],
  )

  // Latest callbacks without re-creating the pipeline.
  const cb = useRef(props)
  cb.current = props

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      get renderer() {
        return ctl.current?.renderer ?? null
      },
      isGesturing: () => ctl.current?.isGesturing() ?? false,
      layout: () => {
        ctl.current?.flush()
        return ctl.current?.layout ?? null
      },
      activateTool(id) {
        const spec = CANVAS_TOOLS.find((t) => t.id === id)
        if (!spec?.enabled) return
        if (spec.tool) uiStore.getState().setTool(spec.tool)
        // Image tool (file picker → image-filled rect) lands with the asset store: TODO(M1.x).
      },
      zoomToFit(ids, padding) {
        ctl.current?.zoomToFit(ids, padding)
      },
      zoomTo(zoom, anchor) {
        if (ctl.current) ctl.current.zoomTo(zoom, anchor)
        else uiStore.getState().setViewport({ zoom })
      },
      screenToWorld: (p) => {
        const v = uiStore.getState().viewport
        return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y }
      },
      worldToScreen: (p) => {
        const v = uiStore.getState().viewport
        return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom }
      },
      exportPng: (nodeId, scale) =>
        ctl.current
          ? ctl.current.exportPng(nodeId, scale)
          : Promise.reject(new Error("Canvas is not ready")),
      stats: () => ctl.current?.renderer.stats() ?? null,
      focus: () => hostRef.current?.focus({ preventScroll: true }),
    }),
    [uiStore],
  )

  // Pipeline lifetime: one renderer + engine per store.
  // biome-ignore lint/correctness/useExhaustiveDependencies: factories/options are read once per store
  useEffect(() => {
    let cancelled = false
    const p = cb.current
    const renderer = p.createRenderer({
      onError: (error) => cb.current.onError?.({ kind: "renderer", error }),
    })
    const engine = p.createLayoutEngine({})
    void (async () => {
      let engineFailed = false
      try {
        const init: Parameters<typeof renderer.init>[0] = { overlayTheme: p.overlayTheme }
        if (p.canvaskitWasmUrl) init.canvaskitWasmUrl = p.canvaskitWasmUrl
        if (p.fontSources) init.fontSources = p.fontSources
        if (p.offlineFonts) init.offlineFonts = true
        await Promise.all([
          renderer.init(init),
          engine.init().catch((e: unknown) => {
            engineFailed = true
            throw e
          }),
        ])
      } catch (e) {
        if (cancelled) return
        renderer.dispose()
        engine.dispose()
        const message = e instanceof Error ? e.message : String(e)
        setFailed(message)
        // Engine (Yoga) init failures are layout errors; everything else is the renderer's.
        const error = e instanceof Error ? e : new Error(message)
        cb.current.onError?.(
          engineFailed
            ? { kind: "layout", error }
            : { kind: "renderer", error: rendererError(error) },
        )
        return
      }
      const el = hostRef.current
      const canvas = canvasRef.current
      if (cancelled || !el || !canvas) {
        renderer.dispose()
        engine.dispose()
        return
      }
      const c = new CanvasController({
        store,
        ui: uiStore,
        renderer,
        engine,
        assets: p.assets,
        origin: p.origin ?? "user",
        onLayout: (l) => {
          placeLabels()
          cb.current.onLayout?.(l)
        },
        onStats: (s) => cb.current.onStats?.(s),
        onError: (e) => {
          if (cb.current.onError) cb.current.onError(e)
          else console.warn("Kimo canvas:", e)
        },
        onContextMenu: (i) => cb.current.onContextMenu?.(i),
        onTextEdit: setTextEdit,
      })
      ctl.current = c
      c.start(el, canvas)
      el.dataset.ready = "true"
      setReady(true)
      const handle = (ref && typeof ref === "object" ? ref.current : null) as CanvasHandle | null
      if (handle) cb.current.onReady?.(handle)
    })()
    return () => {
      cancelled = true
      ctl.current?.dispose()
      ctl.current = null
      if (hostRef.current) delete hostRef.current.dataset.ready
    }
  }, [store, uiStore])

  // Overlay colors follow the theme.
  useEffect(() => {
    const r = ctl.current?.renderer
    if (!r) return
    void r.init({ overlayTheme: props.overlayTheme }).then(() => r.requestFrame())
  }, [props.overlayTheme])

  // The web-fonts setting applies live (families already loaded stay).
  useEffect(() => {
    const r = ctl.current?.renderer
    if (!r) return
    void r.init({ offlineFonts: props.offlineFonts ?? false }).then(() => r.requestFrame())
  }, [props.offlineFonts])

  return (
    <div
      ref={hostRef}
      className={className ? `canvas-host ${className}` : "canvas-host"}
      data-testid="canvas"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes keyboard focus for its shortcuts
      tabIndex={0}
      role="application"
      aria-label="Design canvas"
    >
      <canvas ref={canvasRef} className="canvas-host__canvas" />
      <div ref={labels} className="canvas-host__labels">
        {ready &&
          roots.map((r) => (
            <div key={r.id} className="canvas-host__label" data-artboard={r.id}>
              {r.name}
            </div>
          ))}
      </div>
      {textEdit && (
        <TextEditor
          key={textEdit.id ?? "new"}
          state={textEdit}
          uiStore={uiStore}
          onInput={(v) => ctl.current?.setDraftText(v)}
          onCommit={(v) => ctl.current?.commitText(v)}
        />
      )}
      {failed && (
        <div className="canvas-host__error" role="alert">
          Canvas failed to start: {failed}
        </div>
      )}
    </div>
  )
}

/** The renderer's own error, or a WASM_LOAD_FAILED wrapper for anything else it threw. */
function rendererError(e: Error): RendererError {
  return e instanceof RendererError ? e : new RendererError("WASM_LOAD_FAILED", e.message)
}

function TextEditor({
  state,
  uiStore,
  onInput,
  onCommit,
}: {
  state: TextEditState
  uiStore: CanvasHostProps["uiStore"]
  onInput(value: string): void
  onCommit(value: string): void
}) {
  const viewport = useUi(uiStore, (s) => s.viewport)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const committed = useRef(false)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus({ preventScroll: true })
    t.select()
  }, [])
  const z = viewport.zoom
  const s = state.style
  const lh = s.lineHeight
  const commit = () => {
    if (committed.current || !ref.current) return
    committed.current = true
    onCommit(ref.current.value)
  }
  return (
    <textarea
      ref={ref}
      data-canvas-overlay=""
      className="canvas-host__text-editor"
      aria-label="Edit text"
      defaultValue={state.value}
      spellCheck={false}
      rows={1}
      onInput={(e) => onInput(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        // Escape commits and exits, like Figma (deliberate): there is no separate cancel. An
        // existing text emptied this way is deleted, as in Figma; ⌘Z restores it in one step.
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          commit()
        }
      }}
      style={{
        left: (state.at.x - viewport.x) * z,
        top: (state.at.y - viewport.y) * z,
        minWidth: state.box ? state.box.w * z : 4,
        minHeight: state.box ? state.box.h * z : undefined,
        fontFamily: `"${s.fontFamily}", var(--kimo-font-sans)`,
        fontSize: s.fontSize * z,
        fontWeight: s.fontWeight,
        fontStyle: s.italic ? "italic" : "normal",
        letterSpacing: s.letterSpacing * z,
        lineHeight: !lh ? "normal" : "px" in lh ? `${lh.px * z}px` : lh.multiplier,
        textAlign: s.align,
        color: state.color || undefined,
      }}
    />
  )
}
