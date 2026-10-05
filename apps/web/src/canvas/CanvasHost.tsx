/**
 * `<CanvasHost>` (ADR 0009): mounts the CanvasKit renderer + Yoga layout engine on a
 * devicePixelRatio-correct `<canvas>` and drives them from the DocStore and UI store through
 * {@link CanvasController}. DOM layers on top of the canvas: artboard labels (board 03
 * "Artboard Label": 12/500 text-tertiary, 22 px above each root frame, constant screen size)
 * and the inline text editor.
 */

import {
  AGENT_CANVAS_TOKENS,
  type AgentCanvasTheme,
  type AssetSource,
  type OverlayTheme,
  RendererError,
} from "@kimo/renderer"
import { SlotBadge, SlotQuickInsert, TooltipContent } from "@kimo/ui"
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { activeRoots } from "../editor/pages/model"
import { contentHash, extensionFor, IMAGE_ACCEPT, MAX_ASSET_BYTES, sniffImage } from "../lib/assets"
import { useDocHeader } from "../lib/header"
import { useTreeRevision, useUi } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { pathOf } from "./commands"
import "./canvas-m2.css"
import "./structure.css"
import { AgentCanvasDom } from "./AgentCanvasDom"
import { type AgentDomState, EMPTY_DOM } from "./agent-canvas"
import {
  type AgentCanvasProps,
  CANVAS_TOOLS,
  type CanvasHandle,
  type CanvasHint,
  type CanvasHostProps,
  type ComponentDomOverlay,
  type ImagePlacement,
} from "./contract"
import { CanvasController, MEASURING_OFFSET, type TextEditState } from "./controller"
import { HintPill, ZoomBadge } from "./hints"
import type { StructureDom } from "./insertion"
import { PathEditBar } from "./PathEditBar"
import { RichTextEditor } from "./rich-text/RichTextEditor"
import { StructureOverlay } from "./StructureOverlay"
import { canvasToolStore } from "./tool-state"

/** Board 27 §2 rules: the paste target flashes for 600 ms. */
const FLASH_MS = 600

/** Board 03: label baseline box sits 22 px above the frame (label y 40, frame y 62). */
/** Board 27 rule bFozp: 1 px / ⇧ 10 px. */
const DEFAULT_NUDGE = { step: 1, big: 10 } as const
const LABEL_OFFSET = 22
/** Roots narrower than this on screen get no label (board 11 annex note icB1k, as in Figma). */
const MIN_LABEL_WIDTH = 40

export function CanvasHost(props: CanvasHostProps & { ref?: Ref<CanvasHandle> }) {
  const { store, uiStore, className, ref } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctl = useRef<CanvasController | null>(null)
  const [ready, setReady] = useState(false)
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  /** Board 27 §2: InsertionBar, vacated slots, drag ghosts, draw ghost and the layout hint. */
  const [structure, setStructure] = useState<StructureDom | null>(null)
  /** Board 27 §2 (R8OJ3 "Parent Outline"): the paste target's 600 ms flash, screen px. */
  const [flash, setFlash] = useState<{
    key: number
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])
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
  // Board 27 §1: labels for the active page's roots only.
  const page = useUi(uiStore, (s) => s.page)
  const header = useDocHeader(store)
  const roots = useMemo(() => {
    void shape
    void header
    return activeRoots(store, page).flatMap((id) => {
      const n = store.getNode(id)
      if (n?.type !== "frame" && n?.type !== "instance") return []
      // M3: root mains get CanvasLabel/Component (`tl5O8`), root instances
      // CanvasLabel/Instance (`J3FKSK`); a derived component reads "… · from <base>" (`GtzU7`).
      const isMain = n.component !== undefined && n.component !== false
      const kind: "component" | "instance" | null = isMain
        ? "component"
        : n.type === "instance"
          ? "instance"
          : null
      let name = typeof n.name === "string" ? n.name : n.type === "frame" ? "Frame" : "Instance"
      if (isMain && n.type === "instance" && typeof n.of === "string") {
        const base = store.getNode(n.of)
        if (base && typeof base.name === "string") name = `${name} · from ${base.name}`
      }
      // Board 14 (HauJa `EnjCg`): a root frame pinned to a theme shows a pin chip after its name.
      const pins =
        typeof n.theme === "object" && n.theme !== null
          ? Object.entries(n.theme as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => `${k}: ${v as string}`)
              .join(" · ")
          : ""
      return [{ id, name, kind, pins }]
    })
  }, [store, shape, page, header])
  // Board 31 "Position lock": the DOM overlays that follow the viewport (component labels and
  // slot badges, agent tags / cursors / chips) live in external stores read with
  // useSyncExternalStore, so a viewport change re-renders them synchronously (SyncLane, before
  // the frame is painted) instead of a scheduler task later — they never trail the canvas.
  const compStore = useMemo(() => domStore<ComponentDomOverlay | null>(null), [])
  const compDom = useSyncExternalStore(compStore.subscribe, compStore.get)
  // M6: agent DOM (placeholder tags, scope tags, cursors, prompt footers…), re-rendered only
  // when its projection changes (nothing at all while the document has no agent surfaces).
  const agentStore = useMemo(() => domStore<AgentDomState>(EMPTY_DOM), [])
  const agentDom = useSyncExternalStore(agentStore.subscribe, agentStore.get)
  const agentKey = useRef("")
  const refreshAgentDom = useCallback(() => {
    const d = ctl.current?.agentDom() ?? EMPTY_DOM
    const key = d === EMPTY_DOM ? "" : JSON.stringify(d)
    if (key === agentKey.current) return
    agentKey.current = key
    agentStore.set(d)
  }, [agentStore])
  const hovered = useUi(uiStore, (s) => s.hovered)
  // Harness / imperative override of the agent state (`CanvasHandle.setAgentCanvas`).
  const [agentOverride, setAgentOverride] = useState<AgentCanvasProps | null>(null)
  // The imperative override wins while set (harnesses drive a mounted editor); null returns
  // to the shell's `agentCanvas` prop.
  const agentCanvas = agentOverride ?? props.agentCanvas
  /** Root labels hidden because a nested component/instance label sits on them (note icB1k). */
  const covered = useMemo(
    () => new Set((compDom?.labels ?? []).flatMap((l) => (l.covers ? [l.covers] : []))),
    [compDom],
  )
  const compKey = useRef("")
  const refreshComponentDom = useCallback(() => {
    const d = ctl.current?.componentDom() ?? null
    const empty = !d || (d.labels.length === 0 && d.slots.length === 0 && !d.quickInsert)
    const key = empty ? "" : JSON.stringify(d)
    if (key === compKey.current) return
    compKey.current = key
    compStore.set(empty ? null : d)
  }, [compStore])

  // Labels are placed for one viewport (`placed`); a pan at the same zoom only translates the
  // whole layer (one style write instead of one per label). Labels outside the placed area
  // plus a one-screen margin are hidden; a pan past that margin, a zoom or a layout pass
  // places them again. Display is toggled only when it changes.
  const placed = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const placeLabels = useCallback(
    (force = true) => {
      const box = labels.current
      const host = hostRef.current
      const layout = ctl.current?.layout
      if (!box) return
      const v = uiStore.getState().viewport
      const p = placed.current
      const w = host?.clientWidth ?? 0
      const h = host?.clientHeight ?? 0
      if (!force && p && p.zoom === v.zoom) {
        const dx = (p.x - v.x) * v.zoom
        const dy = (p.y - v.y) * v.zoom
        if (Math.abs(dx) < w && Math.abs(dy) < h) {
          // While panning the layer is composited, so a pan frame only moves it.
          if (box.style.willChange !== "transform") box.style.willChange = "transform"
          box.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : ""
          return
        }
      }
      placed.current = { x: v.x, y: v.y, zoom: v.zoom }
      box.style.transform = ""
      box.style.willChange = ""
      for (const el of box.children) {
        if (!(el instanceof HTMLElement)) continue
        const l = layout?.nodes.get(el.dataset.artboard ?? "")
        const left = l ? (l.world.x - v.x) * v.zoom : 0
        const top = l ? (l.world.y - v.y) * v.zoom - LABEL_OFFSET : 0
        const width = l ? Math.max(0, l.world.w * v.zoom) : 0
        const show =
          !!l?.visible &&
          width >= MIN_LABEL_WIDTH &&
          (w === 0 || (left + width > -w && left < 2 * w && top + LABEL_OFFSET > -h && top < 2 * h))
        const display = show ? "" : "none"
        if (el.style.display !== display) el.style.display = display
        if (!show) continue
        // Style writes only for values that changed.
        const lx = `${left}px`
        const tp = `${top}px`
        if (el.style.left !== lx) el.style.left = lx
        if (el.style.top !== tp) el.style.top = tp
        const mw = `${width}px`
        if (el.style.maxWidth !== mw) el.style.maxWidth = mw
      }
    },
    [uiStore],
  )
  useLayoutEffect(() => {
    if (ready) placeLabels()
  })
  useEffect(
    () =>
      uiStore.subscribe((s, prev) => {
        if (s.viewport !== prev.viewport) {
          placeLabels(false)
          refreshComponentDom()
          refreshAgentDom()
        }
      }),
    [uiStore, placeLabels, refreshComponentDom, refreshAgentDom],
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
      viewPath: (id) => (ctl.current ? pathOf(ctl.current.vdoc, id) : []),
      activateTool(id) {
        const spec = CANVAS_TOOLS.find((t) => t.id === id)
        if (!spec?.enabled) return
        if (spec.placement === "image") {
          pickImage()
          return
        }
        // M6: Note (N) / Prompt (⇧P) insert at the viewport center and open the body.
        if (spec.action === "insertNote" || spec.action === "insertPrompt") {
          ctl.current?.insertAgentNode(spec.action === "insertNote" ? "note" : "prompt")
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
      pointer: () => ctl.current?.pointerPosition() ?? null,
      size: () => ctl.current?.canvasSize ?? { w: 0, h: 0 },
      flash(id) {
        ctl.current?.flush()
        const box = ctl.current?.layout?.nodes.get(id)?.world
        const c = ctl.current
        if (!box || !c) return
        const v = uiStore.getState().viewport
        setFlash({
          key: Date.now(),
          x: (box.x - v.x) * v.zoom,
          y: (box.y - v.y) * v.zoom,
          w: box.w * v.zoom,
          h: box.h * v.zoom,
        })
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
      previewComponentDrop: (target) => ctl.current?.previewComponentDrop(target),
      previewFlowInsert: (screen) => ctl.current?.previewFlowInsert(screen) ?? null,
      insertAgentNode: (type, at) => ctl.current?.insertAgentNode(type, at) ?? null,
      setPromptTarget: (promptId, frameId) =>
        ctl.current?.setPromptTarget(promptId, frameId) ?? false,
      convertNoteToPrompt: (id) => ctl.current?.convertNoteToPrompt(id) ?? false,
      clearPlaceholder: (id) => ctl.current?.clearPlaceholder(id) ?? false,
      setAgentCanvas: (p) => setAgentOverride(p),
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
        const init: Parameters<typeof renderer.init>[0] = {
          overlayTheme: withAgentCanvasTheme(p.overlayTheme, hostRef.current),
        }
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
        snapToPixelGrid: () => cb.current.snapToPixelGrid ?? true,
        rulers: () => cb.current.rulers ?? false,
        nudge: () => cb.current.nudge ?? DEFAULT_NUDGE,
        onHint: (h) => {
          if (cb.current.onHint) cb.current.onHint(h)
          else setHint(h)
        },
        onPixelGrid: setGridOn,
        onPlacementChange: (pl) => cb.current.onPlacementChange?.(pl),
        onIconPicker: (r) => cb.current.onIconPicker?.(r),
        confirmBoundText: (id, ref) =>
          cb.current.confirmBoundText?.(id, ref) ?? Promise.resolve(true),
        duplicateMainPref: () => cb.current.duplicateMainPref?.() ?? "instance",
        askDuplicateMain: (main, ids) =>
          cb.current.askDuplicateMain?.(main, ids) ?? Promise.resolve("instance"),
        toolStore,
        origin: p.origin ?? "user",
        onLayout: (l) => {
          placeLabels()
          refreshComponentDom()
          cb.current.onLayout?.(l)
        },
        onOverlayChange: () => {
          refreshComponentDom()
          refreshAgentDom()
        },
        onStats: (s) => cb.current.onStats?.(s),
        onError: (e) => {
          if (cb.current.onError) cb.current.onError(e)
          else console.warn("Kimo canvas:", e)
        },
        onContextMenu: (i) => cb.current.onContextMenu?.(i),
        onTextEdit: setTextEdit,
        onStructure: setStructure,
        libraries: () => cb.current.libraries ?? {},
        author: () => cb.current.noteAuthor,
        route: (ops) => (cb.current.route ? cb.current.route(ops) : ops),
      })
      ctl.current = c
      c.setAgentCanvas(cb.current.agentCanvas ?? null)
      c.start(el, canvas)
      el.dataset.ready = "true"
      setReady(true)
      const handle = (ref && typeof ref === "object" ? ref.current : null) as CanvasHandle | null
      if (handle) cb.current.onReady?.(handle)
    })()
    return () => {
      cancelled = true
      canvasToolStore(uiStore).set({ placement: null, penHint: false, pathEdit: null })
      ctl.current?.dispose()
      ctl.current = null
      if (hostRef.current) delete hostRef.current.dataset.ready
    }
  }, [store, uiStore])

  // M6: the host's agent state (scopes, cursors, rejections, prompt runs, live origins).
  useEffect(() => {
    ctl.current?.setAgentCanvas(agentCanvas ?? null)
  }, [agentCanvas])

  // M3: linked libraries load / re-read / unlink → rebuild the expanded view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-expand when the libraries change
  useEffect(() => {
    ctl.current?.setLibraries()
  }, [props.libraries])

  // Overlay colors follow the theme.
  useEffect(() => {
    const r = ctl.current?.renderer
    if (!r) return
    void r
      .init({ overlayTheme: withAgentCanvasTheme(props.overlayTheme, hostRef.current) })
      .then(() => r.requestFrame())
  }, [props.overlayTheme])

  // View settings apply live.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate when the settings change
  useEffect(() => {
    ctl.current?.updateGrid()
    ctl.current?.requestOverlay()
  }, [props.pixelGrid, props.snapping, props.snapToPixelGrid, props.rulers])

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
      <div
        ref={labels}
        className="canvas-host__labels"
        // View › Show layer names on canvas (board 27 rmQMe).
        style={props.layerNames === false ? { display: "none" } : undefined}
      >
        {ready &&
          roots.map((r) => (
            <div
              key={r.id}
              className={
                r.kind
                  ? "canvas-host__label canvas-host__label--component"
                  : r.pins
                    ? "canvas-host__label canvas-host__label--pinned"
                    : "canvas-host__label"
              }
              data-artboard={r.id}
              data-label-kind={r.kind ?? undefined}
              style={covered.has(r.id) ? { visibility: "hidden" } : undefined}
            >
              {r.kind ? (
                <>
                  <Icon name={r.kind === "component" ? "component" : "diamond"} size={12} />
                  <span className="canvas-host__label-name">{r.name}</span>
                </>
              ) : r.pins ? (
                <>
                  <span className="canvas-host__label-name">{r.name}</span>
                  <span className="canvas-host__theme-chip" data-testid="theme-pin-chip">
                    <Icon name="pin" size={10} />
                    <span className="canvas-host__theme-chip-label">{r.pins}</span>
                  </span>
                </>
              ) : (
                r.name
              )}
            </div>
          ))}
      </div>
      {flash && (
        <div
          key={flash.key}
          className="canvas-host__flash"
          data-testid="paste-flash"
          aria-hidden="true"
          style={{ left: flash.x, top: flash.y, width: flash.w, height: flash.h }}
        />
      )}
      {structure && <StructureOverlay dom={structure} />}
      {ready && agentDom !== EMPTY_DOM && (
        <AgentCanvasDom dom={agentDom} props={agentCanvas ?? null} hovered={hovered} />
      )}
      {ready && compDom && (
        <ComponentDom overlay={compDom} onQuickInsert={(q) => cb.current.onQuickInsert?.(q)} />
      )}
      {textEdit && (
        <TextEditor
          key={textEdit.id ?? "new"}
          state={textEdit}
          uiStore={uiStore}
          onCommit={() => ctl.current?.commitText(null)}
        />
      )}
      {ready && gridOn && <ZoomBadge ui={uiStore} rulers={props.rulers ?? false} />}
      {hint?.kind === "crop" && (
        // Board 27 §6 (d) ud74f: under the canvas content, above the floating toolbar.
        <HintPill icon={hint.icon} className="canvas-hint--toolbar">
          {hint.text}
        </HintPill>
      )}
      {hint?.kind === "path-edit" && (
        <HintPill icon={hint.icon} className="canvas-hint--top">
          {hint.text}
        </HintPill>
      )}
      {ready && <PathEditBar ui={uiStore} run={(c) => ctl.current?.pathEditCommand(c)} />}
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

/**
 * M6: note / prompt chrome and agent overlay colors follow the live design tokens
 * (`--kimo-note`, `--kimo-agent-iris`, …) read from the canvas host, unless the shell already
 * passes `overlayTheme.agentCanvas`. Missing tokens keep the renderer's .pen light defaults.
 */
function withAgentCanvasTheme(theme: OverlayTheme, el: HTMLElement | null): OverlayTheme {
  if (theme.agentCanvas || !el || typeof getComputedStyle !== "function") return theme
  const cs = getComputedStyle(el)
  const agentCanvas: Partial<AgentCanvasTheme> = {}
  for (const [key, token] of Object.entries(AGENT_CANVAS_TOKENS)) {
    const v = cs.getPropertyValue(`--kimo-${token}`).trim()
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) agentCanvas[key as keyof AgentCanvasTheme] = v
  }
  return { ...theme, agentCanvas }
}

/** A tiny external store (one value, listeners) for useSyncExternalStore-driven overlays. */
function domStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      if (Object.is(v, value)) return
      value = v
      for (const l of listeners) l()
    },
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/** The renderer's own error, or a WASM_LOAD_FAILED wrapper for anything else it threw. */
function rendererError(e: Error): RendererError {
  return e instanceof RendererError ? e : new RendererError("WASM_LOAD_FAILED", e.message)
}

/** Board 30: the rich-text overlay, projected through the live viewport. */
function TextEditor({
  state,
  uiStore,
  onCommit,
}: {
  state: TextEditState
  uiStore: CanvasHostProps["uiStore"]
  onCommit(): void
}) {
  const viewport = useUi(uiStore, (s) => s.viewport)
  return (
    <RichTextEditor
      session={state.session}
      geometry={state.geometry}
      viewport={viewport}
      css={state.css}
      onCommit={onCommit}
    />
  )
}

/**
 * M3 DOM overlays (contract `ComponentDomOverlay`): CanvasLabel above a selected / hovered
 * nested main or instance (`tl5O8` / `J3FKSK`, board 11 `B70Th`), SlotBadge (`kMGG0`, board 12
 * `LQoWJ`) and the SlotQuickInsert row (`AJSok` chips + "+N", board 12 `g9pFd`).
 */
function ComponentDom({
  overlay,
  onQuickInsert,
}: {
  overlay: ComponentDomOverlay
  onQuickInsert: (insert: { slot: string; of: string; name: string }) => void
}) {
  const q = overlay.quickInsert
  return (
    <div className="canvas-host__component-dom">
      {overlay.labels.map((l) => (
        <div
          key={`label:${l.id}`}
          className="canvas-host__label canvas-host__label--component canvas-host__label--nested"
          data-label-kind={l.kind}
          data-node-label={l.id}
          style={{ left: l.screen.x, top: l.screen.y }}
        >
          <Icon name={l.kind === "component" ? "component" : "diamond"} size={12} />
          <span className="canvas-host__label-name">{l.text}</span>
        </div>
      ))}
      {overlay.slots.map((b) => (
        <SlotBadge
          key={`slot:${b.id}`}
          name={b.name}
          className="canvas-host__slot-badge"
          data-slot-badge={b.id}
          style={{ left: b.screen.x, top: b.screen.y }}
        />
      ))}
      {q && (
        <div
          className="canvas-host__quick-insert"
          data-testid="slot-quick-insert"
          data-canvas-overlay=""
          style={{ left: q.screen.x, top: q.screen.y }}
        >
          {q.items.map((it) => (
            <SlotQuickInsert
              key={it.of}
              label={it.name}
              onClick={() => onQuickInsert({ slot: q.slot, of: it.of, name: it.name })}
            />
          ))}
          {q.more > 0 && <SlotQuickInsert more label={`+${q.more}`} tabIndex={-1} />}
        </div>
      )}
    </div>
  )
}
