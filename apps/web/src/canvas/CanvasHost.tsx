/**
 * `<CanvasHost>` (ADR 0009): mounts the CanvasKit renderer + Yoga layout engine on a
 * devicePixelRatio-correct `<canvas>` and drives them from the DocStore and UI store through
 * {@link CanvasController}. DOM layers on top of the canvas: artboard labels (board 03
 * "Artboard Label": 12/500 text-tertiary, 22 px above each root frame, constant screen size)
 * and the inline text editor.
 */
import { type AssetSource, RendererError } from "@kimo/renderer"
import { TooltipContent } from "@kimo/ui"
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
import { contentHash, extensionFor, IMAGE_ACCEPT, MAX_ASSET_BYTES, sniffImage } from "../lib/assets"
import { useTreeRevision, useUi } from "../lib/hooks"
import "./canvas-m2.css"
import {
  CANVAS_TOOLS,
  type CanvasHandle,
  type CanvasHint,
  type CanvasHostProps,
  type ImagePlacement,
} from "./contract"
import { CanvasController, MEASURING_OFFSET, type TextEditState } from "./controller"
import { HintPill, ZoomBadge } from "./hints"
import { canvasToolStore } from "./tool-state"

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
  const [hint, setHint] = useState<CanvasHint | null>(null)
  const [gridOn, setGridOn] = useState(false)
  const measuringRef = useRef<HTMLDivElement | null>(null)
  const labels = useRef<HTMLDivElement | null>(null)
  // Images imported by the Image tool when the shell has no asset store (`onImportImage`):
  // kept in memory for this session and served to the renderer ahead of `props.assets`.
  const localAssets = useRef(new Map<string, Uint8Array>())
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

  /** Image tool: file picker → asset → armed placement (click places it at natural size). */
  const pickImage = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = IMAGE_ACCEPT
    input.style.display = "none"
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      void (async () => {
        try {
          const imported = cb.current.onImportImage
            ? await cb.current.onImportImage(file)
            : await importLocal(file, localAssets.current)
          if (!imported) return
          ctl.current?.armPlacement({ kind: "image", ...imported })
        } catch (e) {
          cb.current.onError?.({
            kind: "op",
            message: `Could not import image: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
      })()
    })
    document.body.append(input)
    input.click()
  }, [])

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      get renderer() {
        return ctl.current?.renderer ?? null
      },
      isGesturing: () => ctl.current?.isGesturing() ?? false,
      penUndo: (redo) => ctl.current?.penUndo(redo) ?? false,
      layout: () => {
        ctl.current?.flush()
        return ctl.current?.layout ?? null
      },
      activateTool(id) {
        const spec = CANVAS_TOOLS.find((t) => t.id === id)
        if (!spec?.enabled) return
        if (spec.placement === "image") {
          pickImage()
          return
        }
        ctl.current?.armPlacement(null)
        if (spec.tool) uiStore.getState().setTool(spec.tool)
      },
      armPlacement(placement: ImagePlacement | null) {
        ctl.current?.armPlacement(placement)
      },
      placement: () => ctl.current?.placement ?? null,
      editPath(nodeId) {
        ctl.current?.editPath(nodeId)
      },
      editingPath: () => ctl.current?.editingPath ?? null,
      insertIcon: (icon, at, parent) => ctl.current?.insertIcon(icon, at, parent) ?? null,
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
    [uiStore, pickImage],
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
        if (p.icons) init.icons = p.icons
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
      const assets: AssetSource = {
        load: (src) => {
          const local = localAssets.current.get(src)
          return local ? Promise.resolve(local) : cb.current.assets.load(src)
        },
      }
      const toolStore = canvasToolStore(uiStore)
      const c = new CanvasController({
        store,
        ui: uiStore,
        renderer,
        engine,
        assets,
        snapping: () => cb.current.snapping ?? true,
        pixelGrid: () => cb.current.pixelGrid ?? true,
        onHint: (h) => {
          if (cb.current.onHint) cb.current.onHint(h)
          else setHint(h)
        },
        onPixelGrid: setGridOn,
        onPlacementChange: (pl) => cb.current.onPlacementChange?.(pl),
        onIconPicker: (r) => cb.current.onIconPicker?.(r),
        toolStore,
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
      canvasToolStore(uiStore).set({ placement: null, penHint: false })
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

  // View settings apply live.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate when the settings change
  useEffect(() => {
    ctl.current?.updateGrid()
    ctl.current?.requestOverlay()
  }, [props.pixelGrid, props.snapping])

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
      onPointerMove={(e) => {
        // The ⌥ "Measuring" tooltip follows the pointer (positioned without React renders).
        const m = measuringRef.current
        const host = hostRef.current
        if (!m || !host) return
        const r = host.getBoundingClientRect()
        m.style.left = `${e.clientX - r.left + MEASURING_OFFSET.x}px`
        m.style.top = `${e.clientY - r.top + MEASURING_OFFSET.y}px`
      }}
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
      {ready && gridOn && <ZoomBadge ui={uiStore} />}
      {hint?.kind === "path-edit" && (
        <HintPill icon={hint.icon} className="canvas-hint--top">
          {hint.text}
        </HintPill>
      )}
      {hint?.kind === "pen-close" && (
        <HintPill
          icon={hint.icon}
          className="canvas-hint--cursor"
          style={{ left: hint.screen.x, top: hint.screen.y }}
        >
          {hint.text}
        </HintPill>
      )}
      {hint?.kind === "measuring" && (
        <div
          ref={(el) => {
            measuringRef.current = el
            const p = ctl.current?.lastPointer
            if (el && p) {
              el.style.left = `${p.x + MEASURING_OFFSET.x}px`
              el.style.top = `${p.y + MEASURING_OFFSET.y}px`
            }
          }}
          className="canvas-measuring"
          data-canvas-overlay=""
        >
          <TooltipContent role="status" shortcut={hint.keys}>
            {hint.text}
          </TooltipContent>
        </div>
      )}
      {failed && (
        <div className="canvas-host__error" role="alert">
          Canvas failed to start: {failed}
        </div>
      )}
    </div>
  )
}

/**
 * Fallback import without a shell asset store: content-addressed `./assets/<16 hex>.<ext>`
 * (spec §12, the same hashing and format sniffing as the web asset store), bytes kept in
 * `store`, natural size decoded.
 */
async function importLocal(
  file: File,
  store: Map<string, Uint8Array>,
): Promise<Omit<ImagePlacement, "kind"> | null> {
  if (file.size > MAX_ASSET_BYTES) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffImage(bytes)
  const ext = mime ? extensionFor(mime) : null
  if (!mime || !ext) return null
  const src = `./assets/${await contentHash(bytes)}.${ext}`
  const size = await naturalSize(new Blob([bytes], { type: mime }))
  if (!size) return null
  store.set(src, bytes)
  return { src, ...size, entry: { mime, bytes: bytes.byteLength, ...size } }
}

async function naturalSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file)
    const out = { width: bmp.width, height: bmp.height }
    bmp.close()
    return out
  } catch {
    // SVG and some formats: decode through an <img>.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  }
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
