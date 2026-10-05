/**
 * The editor shell — boards "03 Editor — Light" / "05 Editor — Agent — Dark" (ewttY / EHux2):
 * vertical, bg-canvas; Topbar (48) over Body (Left Panel 256 · Canvas fill · Right Panel 280).
 * Owns the file session and the global shortcuts; the canvas is mounted through the
 * CanvasHost contract (CanvasKit renderer + Yoga layout, ADR 0009).
 *
 * M4 (ADR 0012): a `.kimo` on disk ({@link DiskEditor}) opens through the window's session
 * manager and shows board 16's desktop topbar, board 17's banner / toasts / dialogs and board
 * 18's conflicts (canvas markers, layer markers, Conflicts tab, ⌘'). Fonts resolve through the
 * window's font system (Document → Local → Cache → Google, board 19).
 */

import { referencedAssets } from "@kimo/core-schema"
import { createLayoutEngine, type LayoutResult } from "@kimo/layout"
import { KIMO_FILE_FILTER } from "@kimo/platform"
import type { DocumentFontFace, FontFaceKey, OverlayTheme } from "@kimo/renderer"
import { browserIconProvider, createRenderer } from "@kimo/renderer/browser"
import { EmptyState } from "@kimo/ui"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { CleanUpAssetsHost, indexedDbAssetFolder, platformAssetFolder } from "../assets-gc"
import { CanvasHost } from "../canvas/CanvasHost"
import {
  CANVAS_TOOLS,
  type CanvasHandle,
  type CanvasToolId,
  type IconPickerRequest,
} from "../canvas/contract"
import { toggleViewPref, useCanvasViewPrefs } from "../canvas/view-prefs"
import { CanvasConflictOverlay, useNextConflictShortcut } from "../conflicts"
import {
  copySelectionAsPng,
  ExportDialog,
  type ExportPreset,
  type ExportSource,
  exportToastOf,
  pdfFontsFrom,
} from "../export"
import { BannerHost, FailedLoadView, MigrationDialog, ToastHost, useWebTabTitle } from "../files"
import {
  createFontSystem,
  type DocumentFontAsset,
  isFontAsset,
  loadDocumentFontFaces,
  MissingFontsHost,
} from "../fonts"
import { storeFontAsset, withFontManifest } from "../fonts/store-font-asset"
import * as assetsModule from "../lib/assets"
import { contentHash, createAssetStore, createFolderAssetStore, manifestEntry } from "../lib/assets"
import * as filesModule from "../lib/files"
import { createFile, exportFile, importFile, patchFile, pickKimoFile, saveFile } from "../lib/files"
import { useDocHeader } from "../lib/header"
import { createBus, isTyping } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { cssToken, useTheme } from "../lib/theme"
import { useOpenSettings, useRuntime } from "../platform/runtime"
import { exitSelection, PreviewOverlay, pickPreviewFrame, usePreviewTarget } from "../preview"
import { diskPath, navigate } from "../router"
import { useEditorAgentPanel } from "./agent-panel"
import { useAgentTouched, useConnectedOrigins, useEditorAgents } from "./agents"
import { refName } from "./bindings"
import { useCanvasMenu } from "./CanvasMenu"
import { useRasterDrop } from "./clipboard/RasterDrop"
import { useEditorCommands } from "./clipboard/useEditorCommands"
import { DiskTopbar, useConflicts, useFocusNode, useWindowTitle } from "./disk"
import type { FileMenuActions } from "./FileMenu"
import { FloatingToolbar } from "./FloatingToolbar"
import { useEditor } from "./fields"
import { LeftPanel } from "./LeftPanel"
import { createComponent, detachInstance, goToMain } from "./m3/actions"
import { useCanvasDrop } from "./m3/CanvasDrop"
import { M3Context, M3Controller, useBusValue, useLibraries } from "./m3/controller"
import { ConfirmHost, ToastStack } from "./m3/feedback"
import { useReleaseStalePlaceholders } from "./placeholder-release"
import "./m3/m3.css"
import "./m3/m3-panels.css"
import "./m3/component-dialogs.css"
import { type Combo, matchCombo, matches, SHORTCUTS, shortcut } from "../shortcuts/shortcuts"
import { ComponentDialogs } from "./m3/ComponentDialogs"
import { LibraryChanges, LibraryManager } from "./m3/popovers"
import { VariablesDialog } from "./m3/VariablesDialog"
import { PanelContext } from "./panel-context"
import { IconPickerPopover } from "./popovers/IconPicker"
import { RightPanel } from "./RightPanel"
import { type FileSession, useDiskSession, useFileSession, useSyncStatus } from "./session"
import { useSvgImport } from "./svg-drop"
import { Topbar } from "./Topbar"

/** Overlay colors from the live `--kimo-*` tokens (board 03: handle fill is a #FFFFFF literal). */
function useOverlayTheme(): OverlayTheme {
  const mode = useTheme()
  return useMemo(() => {
    const mono = cssToken("--kimo-font-mono")
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "")
    return {
      selection: cssToken("--kimo-selection") || "#2F6BFF",
      handleFill: "#FFFFFF",
      onSelection: cssToken("--kimo-on-accent") || "#FFFFFF",
      monoFamily: mono || "JetBrains Mono",
      // M2 overlays (board 10); empty → the renderer's light defaults.
      ...tokenColors({
        measure: "--kimo-measure",
        measureSoft: "--kimo-measure-soft",
        onAccent: "--kimo-on-accent",
        selectionSoft: "--kimo-selection-soft",
        accentText: "--kimo-accent-text",
        accent: "--kimo-accent",
        // M3: component / instance identity (violet; 02c "Canvas outlines").
        component: "--kimo-component",
        componentSoft: "--kimo-component-soft",
        // Board 27 §4 rulers (Ko6aO): bg-app strips, border edges, border-strong ticks.
        rulerBg: "--kimo-bg-app",
        rulerBorder: "--kimo-border",
        rulerTick: "--kimo-border-strong",
        rulerText: "--kimo-text-tertiary",
      }),
      // Board 27 rule zyQtF: pixel grid lines #0000000F light / #FFFFFF1F dark (literals).
      pixelGrid: mode === "dark" ? "#FFFFFF1F" : "#0000000F",
    }
  }, [mode])
}

function tokenColors<K extends string>(vars: Record<K, string>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {}
  for (const [k, v] of Object.entries(vars) as [K, string][]) {
    const c = cssToken(v)
    if (c) out[k] = c
  }
  return out
}

function debugHookEnabled(): boolean {
  if (import.meta.env.DEV || import.meta.env.VITE_KIMO_DEBUG === "1") return true
  try {
    return new URLSearchParams(location.search).has("kimo-debug")
  } catch {
    return false
  }
}

export function Editor({ fileId }: { fileId: string }) {
  const state = useFileSession(fileId)
  if (state.status === "ready")
    return <EditorShell key={state.session.id} session={state.session} />
  return (
    <div className="editor-status">
      {state.status === "loading" ? (
        <span className="editor-status__label">Opening file…</span>
      ) : (
        <EmptyState
          icon={<Icon name="files" size={18} />}
          title={state.status === "missing" ? "File not found" : "Could not open file"}
          description={
            state.status === "error" ? state.message : "It may have been deleted from this browser."
          }
        />
      )}
      {state.status !== "loading" && (
        <a className="editor-status__link" href="#/">
          Back to files
        </a>
      )}
    </div>
  )
}

/** A `.kimo` on disk (`#/disk/<ref>`), opened through the window's session manager. */
export function DiskEditor({ fileRef, node }: { fileRef: string; node?: string | null }) {
  const { manager } = useRuntime()
  const state = useDiskSession(manager, fileRef)
  if (state.status === "ready")
    return <EditorShell key={state.session.id} session={state.session} focusNode={node ?? null} />
  return (
    <div className="editor-status">
      {state.status === "loading" ? (
        <span className="editor-status__label">Opening file…</span>
      ) : (
        <EmptyState
          icon={<Icon name="files" size={18} />}
          title="Could not open file"
          description={state.message}
        />
      )}
      {state.status !== "loading" && (
        <a className="editor-status__link" href="#/">
          Back to files
        </a>
      )}
    </div>
  )
}

function EditorShell({
  session,
  focusNode = null,
}: {
  session: FileSession
  focusNode?: string | null
}) {
  const { platform, manager, hostClient = null } = useRuntime()
  const openSettings = useOpenSettings()
  /** The document session of a file on disk (null: browser library). */
  const doc = session.document
  const [name, setName] = useState(session.meta.name)
  // Layout passes go to a bus, not React state: only panels that show a changed box re-render.
  const layout = useMemo(() => createBus<LayoutResult | null>(null), [])
  const canvas = useRef<CanvasHandle | null>(null)
  /** ⌘K "Ask Kimo" (set once the agent panel exists). */
  const askRef = useRef<(() => void) | null>(null)
  const syncStatus = useSyncStatus(session.provider)
  const overlayTheme = useOverlayTheme()
  // Board 27 §4: snapping, pixel grid, rulers, nudge, layer names (app preferences).
  const viewPrefs = useCanvasViewPrefs(platform.settings)
  // Image fills and the Image tool store content-addressed assets per file: IndexedDB for the
  // browser library, `assets/` beside the file on disk.
  const assets = useMemo(
    () => (doc ? createFolderAssetStore(platform, doc.ref) : createAssetStore(session.id)),
    [doc, platform, session.id],
  )
  useEffect(() => () => assets.dispose(), [assets])
  // Fonts (board 19): one font system per editor window, Document → Local → Pack → Cache →
  // Google. Board 28: a face fetched from Google is stored once in the file's assets/ (never a
  // document edit); writes list it in the `assets` manifest (`withFontManifest`).
  const faces = useRef<readonly DocumentFontAsset[]>([])
  const storeFetched = useRef<(face: FontFaceKey, bytes: Uint8Array) => void>(() => {})
  storeFetched.current = (face, bytes) => void storeFontAsset(face, bytes, assets)
  /** The document as written: font assets the text uses join the manifest (board 28). */
  const prepareWrite = useCallback(
    <D extends object>(d: D): D =>
      withFontManifest(d, faces.current, (k) => assets.entrySync(`./assets/${k}`)),
    [assets],
  )
  useEffect(() => {
    if (!doc) return
    doc.prepareWrite = prepareWrite
    return () => {
      doc.prepareWrite = (d) => d
    }
  }, [doc, prepareWrite])
  const fonts = useMemo(
    () =>
      createFontSystem({
        platform,
        documentFaces: () => faces.current,
        onRemoteFetched: (face, bytes) => storeFetched.current(face, bytes),
        // Board 25 §6 (d): OpenType font support reads the face the canvas renders with.
        faceBytes: (k) =>
          canvas.current?.renderer?.fonts.faceBytes?.(k.family, k.weight, k.style) ?? null,
      }),
    [platform],
  )
  useEffect(() => () => fonts.dispose(), [fonts])
  // Fonts that resolve differently now (document fonts loaded, the offline pack downloaded):
  // families the canvas gave up on are asked again.
  useEffect(() => fonts.subscribe(() => canvas.current?.renderer?.retryFonts?.()), [fonts])
  const offlineFonts = useSyncExternalStore(fonts.subscribe, fonts.offline)
  useEffect(() => {
    let live = true
    const load = async () => {
      const manifest = session.store.toHeader().assets as
        | Readonly<Record<string, { mime?: string; name?: string }>>
        | undefined
      const keys = await assets.keys().catch(() => [] as string[])
      // Faces stored this session are not in the manifest yet: their entries (name = face)
      // come from the asset store. Without a manifest, the entries of the referenced assets
      // are read too, so a write may add one (withFontManifest).
      const known: Record<string, { mime?: string; name?: string }> = {}
      for (const k of keys) {
        const e = assets.entrySync(`./assets/${k}`)
        if (e) known[k] = e
      }
      if (!manifest && keys.some((k) => isFontAsset(k)))
        for (const r of referencedAssets(session.store.toDocument() as never))
          await assets.info(`./assets/${r}`).catch(() => null)
      const next = await loadDocumentFontFaces({ ...known, ...manifest }, keys, (k) =>
        assets.bytes(k),
      )
      const sig = (l: readonly DocumentFontFace[]) =>
        l.map((f) => `${f.family}/${f.weight}/${f.style}`).join("|")
      // Unchanged faces (an image URL resolved, an image stored): no font invalidation.
      if (!live || sig(next) === sig(faces.current)) return
      faces.current = next
      fonts.invalidate()
    }
    void load()
    const off = assets.subscribe(() => void load())
    return () => {
      live = false
      off()
    }
  }, [session.store, assets, fonts])
  const conflicts = useConflicts(doc)
  const icons = useMemo(() => browserIconProvider(), [])
  const importImage = useCallback(
    async (file: File) => {
      const info = await assets.put(file)
      return info.width && info.height
        ? { src: info.src, width: info.width, height: info.height, entry: manifestEntry(info) }
        : null
    },
    [assets],
  )
  // Edits adding an asset reference also add its manifest entry (spec §12; see session).
  useEffect(() => {
    session.assetEntry = assets.entrySync
    return () => {
      session.assetEntry = () => null
    }
  }, [session, assets])
  // I key (board 09 icon picker at the pointer).
  const [iconRequest, setIconRequest] = useState<IconPickerRequest | null>(null)
  // M3: libraries, expanded view, commands, toasts, confirms (one per open file).
  const m3 = useMemo(() => new M3Controller(session, () => canvas.current), [session])
  useEffect(() => m3.attach(), [m3])
  useLibraries(m3)
  const panels = useBusValue(m3.panels)
  const drop = useCanvasDrop(m3)
  const canvasEl = useRef<HTMLElement | null>(null)
  // Board 27 §3: raster drop / paste (image rectangles, drop overlay).
  const raster = useRasterDrop({ session, m3, canvas, assets, container: canvasEl })
  // Board 27 §1–§2: clipboard, structure commands, ⌘P page switcher.
  const editorCommands = useEditorCommands({ session, m3, canvas, assets })
  const svg = useSvgImport({
    session,
    assets,
    canvas,
    container: canvasEl,
    // Board 20 M4Pij9 / fW1JW: one Toast/Danger per rejected file (6 s), "Details" lists the
    // offending elements and lines (the import log is not designed: a second toast shows them).
    onError: (text, details) =>
      m3.toast({
        tone: "danger",
        text,
        ...(details?.length
          ? {
              action: {
                label: "Details",
                run: () =>
                  m3.toast({ tone: "danger", text: details.join(" · "), duration: 10_000 }),
              },
            }
          : {}),
      }),
  })
  // Board 27 §9 (j52y5f): Preview — an in-place overlay over the whole window (ui mode
  // "preview"); the editor stays mounted underneath, so its viewport is untouched on exit.
  const [preview, setPreview] = useState<{ frame: string; selection: readonly string[] } | null>(
    null,
  )
  const openPreview = useCallback(() => {
    const ui = session.ui.getState()
    const frame = pickPreviewFrame(session.store, ui.selection)
    if (frame) setPreview({ frame, selection: ui.selection })
  }, [session])
  const previewTarget = usePreviewTarget(session.store, session.ui)
  // Desktop menu bar View › Preview (`kimo://editor-menu` {action: "preview"}).
  useEffect(
    () => platform.menu?.onAction((a) => (a === "preview" ? openPreview() : undefined)),
    [platform, openPreview],
  )
  // Board 07 Export dialog (M7): code / tokens / SVG·PNG from the selection or every root frame.
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPreset, setExportPreset] = useState<ExportPreset | null>(null)
  const exportSource = useMemo<ExportSource>(
    () => ({
      fileName: doc ? doc.fileName.replace(/\.kimoz?$/, "") : name,
      document: () => session.store.toDocument(),
      libraries: () => m3.libraries(),
      selection: () => session.ui.getState().selection,
      renderer: () => canvas.current?.renderer ?? null,
      layout: () => canvas.current?.layout() ?? null,
      icons,
      // PDF "Embed fonts": the faces the canvas renders with.
      fonts: pdfFontsFrom(() => {
        const fonts = canvas.current?.renderer?.fonts
        return fonts?.faceBytes ? (f, w, s) => fonts.faceBytes?.(f, w, s) ?? null : null
      }),
    }),
    [doc, name, session, m3, icons],
  )
  // Board 27 §10 (d): File › Export… ⇧⌘E (selection, else the page) and Copy selection as PNG ⇧⌘C.
  const openExport = useCallback(() => {
    setExportPreset(null)
    setExportOpen(true)
  }, [])
  const copyPng = useCallback(() => {
    void copySelectionAsPng({
      selection: session.ui.getState().selection,
      renderer: canvas.current?.renderer ?? null,
    }).then((r) =>
      m3.toast(
        r.ok
          ? { tone: "success", text: "Copied as PNG (2×)" }
          : { tone: r.reason === "failed" ? "danger" : "warning", text: r.message },
      ),
    )
  }, [session, m3])
  useEffect(
    () =>
      platform.menu?.onAction((a) => {
        if (a === "export") openExport()
        else if (a === "copy-png") copyPng()
      }),
    [platform, openExport, copyPng],
  )
  // Clean up assets (board 19 Vqeu7): same rules as `kimo gc`.
  const [gcOpen, setGcOpen] = useState(false)
  const gcFolder = useMemo(
    () => (doc ? platformAssetFolder(platform, doc.ref) : indexedDbAssetFolder(session.id)),
    [doc, platform, session.id],
  )
  // Toast "Review" (external conflicts) opens the Conflicts tab.
  const review = useMemo(() => createBus(0), [])

  // Board 18: Next conflict selects + reveals the node; ⌘' / ⇧⌘'.
  useEffect(() => {
    if (!conflicts) return
    conflicts.bindView({
      select: (id) => session.ui.getState().select([id]),
      reveal: (id) => canvas.current?.zoomToFit([id], 96),
    })
    return () => conflicts.bindView(null)
  }, [conflicts, session])
  useNextConflictShortcut(conflicts)
  useFocusNode(focusNode, session.ui, canvas)

  // Test/debug hook: e2e and perf scripts read the store through it. On in dev; in a
  // production build only when opted in with `?kimo-debug` in the URL (or VITE_KIMO_DEBUG=1 at build time).
  useEffect(() => {
    if (!debugHookEnabled()) return
    const w = window as unknown as { __kimo?: unknown }
    w.__kimo = {
      session,
      canvas: () => canvas.current,
      m3,
      doc,
      platform,
      fonts,
      // Board 28: the document as a save writes it (font assets join the manifest).
      prepareWrite,
    }
    // Source-path keyed modules for e2e scripts, which import them directly on the dev server
    // and read them from here against a production bundle.
    ;(window as unknown as { __kimoModules?: unknown }).__kimoModules = {
      "/src/lib/files.ts": filesModule,
      "/src/lib/assets.ts": assetsModule,
    }
    return () => {
      if ((w.__kimo as { session?: unknown } | undefined)?.session === session) w.__kimo = undefined
    }
  }, [session, m3, doc, platform, fonts, prepareWrite])

  const rename = useCallback(
    (next: string) => {
      setName(next)
      void patchFile(session.id, { name: next })
    },
    [session.id],
  )
  const download = useCallback(
    () =>
      void exportFile(session.store, name, assets, prepareWrite).then((file) => {
        if (file.missingAssets.length)
          console.warn(`Kimo: images not in this browser: ${file.missingAssets.join(", ")}`)
        return saveFile(file)
      }),
    [session.store, name, assets, prepareWrite],
  )
  const saveAs = useCallback(async () => {
    // Browser library: Save as… writes through the File System Access picker when granted,
    // otherwise downloads the .kimo / .kimoz (board 20 note p0SuJa).
    if (!doc) return download()
    const wasUntitled = doc.untitled
    const ref = await doc.saveAs().catch(() => null)
    if (ref) navigate(diskPath(ref))
    else if (wasUntitled && !doc.untitled) navigate(diskPath(doc.ref))
  }, [doc, download])
  const save = useCallback(() => {
    // An untitled document's first ⌘S is Save as… (board 20 V7ey1Q).
    if (doc?.untitled) void saveAs()
    else if (doc) void doc.save().catch((e: unknown) => console.warn("Kimo: save failed", e))
    else download()
  }, [doc, download, saveAs])
  const newFile = useCallback(async () => {
    // Desktop: an untitled document opens right away (board 20 V7ey1Q); the browser library
    // creates a file in IndexedDB.
    if (platform.kind === "desktop" || doc) {
      const s = await manager.newUntitled()
      navigate(diskPath(s.ref))
      return
    }
    navigate(`/file/${await createFile("Untitled")}`)
  }, [platform, manager, doc])
  const openFile = useCallback(async () => {
    // Desktop (and files on disk): a native open dialog through the session manager.
    if (doc || platform.kind === "desktop") {
      const [ref] = await platform.dialogs
        .openFile({ title: "Open", filters: [KIMO_FILE_FILTER] })
        .catch(() => [] as string[])
      if (ref) navigate(diskPath(ref))
      return
    }
    const file = await pickKimoFile()
    if (!file) return
    try {
      navigate(`/file/${(await importFile(file)).id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }, [doc, platform])

  const activate = useCallback(
    (id: CanvasToolId) => {
      const spec = CANVAS_TOOLS.find((t) => t.id === id)
      // M3: the Component button is a one-shot action (⌥⌘K), not a mode.
      if (spec?.action === "createComponent") {
        createComponent(m3, session.ui.getState().selection, canvas.current?.layout() ?? null)
        return
      }
      if (!spec?.enabled) return
      if (canvas.current) canvas.current.activateTool(id)
      else if (spec.tool) session.ui.getState().setTool(spec.tool)
    },
    [session.ui, m3],
  )

  useEffect(() => {
    // Every binding below is a row of the SHORTCUTS table (board 25 §7 GJYcL), matched in order.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      const ui = session.ui.getState()
      const undo = matches("undo", e)
      const redo = matches("redo", e)
      // A canvas gesture owns the undo stack until it ends (its steps collapse into one entry).
      if ((undo || redo) && canvas.current?.isGesturing()) {
        e.preventDefault()
        return
      }
      // The pen's points are not in the document yet: ⌘Z removes the last one (Figma).
      if ((undo || redo) && canvas.current?.penUndo(redo)) {
        e.preventDefault()
        return
      }
      if (undo || redo) {
        e.preventDefault()
        if (redo) session.store.redo("user")
        else session.store.undo("user")
        return
      }
      if (matches("save", e) || matches("saveAs", e)) {
        e.preventDefault()
        if (e.shiftKey) void saveAs()
        else save()
        return
      }
      if (matches("openFile", e)) {
        e.preventDefault()
        void openFile()
        return
      }
      if (matches("exportDialog", e)) {
        e.preventDefault()
        openExport()
        return
      }
      if (matches("copyAsPng", e)) {
        e.preventDefault()
        copyPng()
        return
      }
      if (matches("newFile", e)) {
        // The browser keeps ⌘N for a new window; it reaches the page when the canvas has focus.
        e.preventDefault()
        void newFile()
        return
      }
      // ⌘0 (the canvas owns ⇧0): works before the canvas has mounted too.
      if (matchCombo(ZOOM_100_MOD, e)) {
        e.preventDefault()
        if (canvas.current) canvas.current.zoomTo(1)
        else ui.setViewport({ zoom: 1 })
        return
      }
      // "Ask Kimo" (board 03 floating toolbar Kbd ⌘K): the Agent tab — except with text selected,
      // where ⌘K is the Text section's Link… (board 24 (a)).
      const textSelected =
        ui.selection.length > 0 &&
        ui.selection.every((id) => session.store.getNode(id)?.type === "text")
      if (matches("askKimo", e) && askRef.current && !textSelected) {
        e.preventDefault()
        askRef.current()
        return
      }
      if (matches("tool.image", e)) {
        e.preventDefault()
        activate("image")
        return
      }
      // M3 shortcuts (boards 11/12/14): ⌥⌘K create component, ⌥⌘B detach, ⌥⏎ go to main,
      // ⌥⇧⌘V variables (matched by `e.code`: ⌥ changes `e.key` on macOS).
      if (matches("createComponent", e)) {
        e.preventDefault()
        createComponent(m3, ui.selection, canvas.current?.layout() ?? null)
        return
      }
      if (matches("detachInstance", e)) {
        e.preventDefault()
        const id = ui.selection[0]
        if (id && session.store.getNode(id)?.type === "instance") void detachInstance(m3, id)
        return
      }
      if (matches("goToMain", e)) {
        const id = ui.selection[0]
        if (id && m3.view().origin(id)?.instance) {
          e.preventDefault()
          goToMain(m3, id)
        }
        return
      }
      if (matches("variables", e)) {
        e.preventDefault()
        m3.openPanel({ variables: !m3.panels.get().variables })
        return
      }
      // Board 27 §9: ⇧Space opens Preview (the overlay owns every key while open).
      if (matches("preview", e)) {
        e.preventDefault()
        openPreview()
        return
      }
      // Board 27 §4 View menu: ⇧' pixel grid, ⇧R rulers (the same keys as Settings › Canvas).
      if (matches("view.pixelGrid", e)) {
        e.preventDefault()
        toggleViewPref(platform.settings, "canvas.pixelGrid")
        return
      }
      if (matches("view.rulers", e)) {
        e.preventDefault()
        toggleViewPref(platform.settings, "canvas.rulers")
        return
      }
      // Escape, Delete, arrows, ⌘D/⌘G and zoom keys are canvas commands (CanvasController).
      if (matches("tool.hand", e)) {
        // Hand tool (no toolbar entry in board 03; Space-drag pans temporarily).
        e.preventDefault()
        ui.setTool("hand")
        return
      }
      // Single-key tools (V F R O L T P N), ⇧P Prompt and the board 27 shape slot's ⇧L ⇧S.
      const tool = TOOL_SHORTCUTS.find((t) => matches(t.shortcut, e))
      if (tool) {
        e.preventDefault()
        activate(tool.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    session,
    activate,
    save,
    saveAs,
    openFile,
    newFile,
    m3,
    platform,
    openPreview,
    openExport,
    copyPng,
  ])

  // Board 21: agents (presence chip, approvals, canvas attribution, layer dots, Activity tab).
  const agents = useEditorAgents({
    platform,
    hostClient,
    session,
    doc,
    canvas,
    layout,
    openSettings: () => openSettings("agents-mcp"),
    onSaveCopy: () => void saveAs(),
  })
  const agentNodes = useAgentTouched(agents.controller)
  const mcpOrigins = useConnectedOrigins(agents.controller)

  // M6: the built-in agent (Agent tab, canvas surfaces, prompt runs, Home hand-off).
  const openAgent = useMemo(() => createBus(0), [])
  const openAgentTab = useCallback(() => openAgent.set(openAgent.get() + 1), [openAgent])
  askRef.current = openAgentTab
  const agentPanel = useEditorAgentPanel({
    platform,
    hostClient,
    session,
    doc,
    canvas,
    layout,
    openSettings: (pane) => openSettings(pane),
    openAgentTab,
  })
  // Connected MCP clients count as live agents on the canvas (their placeholders read "building").
  const agentCanvas = useMemo(
    () =>
      agentPanel.canvas && mcpOrigins.size
        ? {
            ...agentPanel.canvas,
            liveOrigins: new Set([...agentPanel.canvas.liveOrigins, ...mcpOrigins]),
          }
        : agentPanel.canvas,
    [agentPanel.canvas, mcpOrigins],
  )
  // An agent flag never outlives its agent: release stale ones on open, on MCP disconnect, on
  // window close (after stopping the turn) and on unmount.
  useReleaseStalePlaceholders({
    session,
    manager,
    panel: agentPanel.controller,
    agents: agents.controller,
    keepOwner: agentPanel.handoffOwner,
    pendingOwner: agentPanel.pendingHandoffOwner,
  })
  // Debug hook (see above): the Agent tab controller, for e2e scripts (board 25 §3 Resume agent).
  useEffect(() => {
    if (!debugHookEnabled()) return
    const w = window as unknown as { __kimo?: { session?: unknown; agent?: unknown } }
    if (w.__kimo?.session === session) w.__kimo.agent = agentPanel.controller
  }, [session, agentPanel.controller])
  // Board 25 §3: the canvas context menu (agent group first) and "Set as target" pick mode.
  const canvasMenu = useCanvasMenu({
    session,
    m3,
    canvas,
    container: canvasEl,
    controller: agentPanel.controller,
    runPrompt: agentPanel.runPrompt,
    openAgentTab,
  })
  // Board 20 / 24 (m): window title ("<Agent> editing" while the built-in agent works); the
  // browser library's tab title.
  useWindowTitle(doc, agentPanel.editingAgent)
  useWebTabTitle(
    platform,
    doc
      ? null
      : { fileName: name, unsaved: syncStatus === "error", agent: agentPanel.editingAgent },
  )
  // Home: a never-saved document asks first (board 24 (i) close prompt).
  const goHome = useCallback(() => {
    if (!doc?.untitled) return navigate("/")
    void doc.requestClose().then((ok) => {
      if (ok) navigate("/")
    })
  }, [doc])

  const fileMenu: FileMenuActions = {
    onNewFile: () => void newFile(),
    onOpenFile: () => void openFile(),
    onOpenRecent: (ref) => navigate(diskPath(ref)),
    onSave: save,
    onSaveAs: () => void saveAs(),
    // Desktop only (web cPHVm omits it); an untitled document has nothing on disk to reveal.
    ...(doc && !doc.untitled && platform.capabilities.reveal
      ? { onReveal: () => void platform.files.reveal(doc.ref).catch(() => {}) }
      : {}),
    onExportDialog: openExport,
    onCopyPng: copyPng,
    onCleanUpAssets: () => setGcOpen(true),
    onSettings: () => openSettings("general"),
  }

  return (
    <M3Context.Provider value={m3}>
      <div className="editor">
        {doc ? (
          <DiskTopbar
            doc={doc}
            pageName="Page 1"
            ui={session.ui}
            canvas={() => canvas.current}
            {...fileMenu}
            onHome={goHome}
            onExport={() => {
              setExportPreset(null)
              setExportOpen(true)
            }}
            onPreview={openPreview}
            previewTarget={previewTarget}
            presence={agents.presence}
          />
        ) : (
          <Topbar
            fileName={name}
            pageName="Page 1"
            syncStatus={syncStatus}
            ui={session.ui}
            canvas={() => canvas.current}
            onRename={rename}
            {...fileMenu}
            onHome={goHome}
            onExport={() => {
              setExportPreset(null)
              setExportOpen(true)
            }}
            onPreview={openPreview}
            previewTarget={previewTarget}
          />
        )}
        {doc && (
          <BannerHost
            session={doc}
            // Board 25 §6 (e) "Review changes": the merge's resolved nodes.
            onReview={(ids) => {
              const live = ids.filter((id) => session.store.getNode(id))
              if (!live.length) return
              session.ui.getState().select(live)
              canvas.current?.zoomToFit(live, 96)
            }}
          />
        )}
        {agents.banner}
        <div className="editor__body">
          <LeftPanel
            session={session}
            m3={m3}
            conflicts={conflicts}
            agentNodes={agentNodes}
            promptRun={agentPanel.promptRun}
            onRunPrompt={agentPanel.runPrompt}
          />
          <main
            ref={canvasEl}
            className="editor__canvas"
            aria-label="Canvas"
            onDragOver={(e) => {
              drop.handlers.onDragOver(e)
              // Board 27 §3: raster files (overlay + target), then SVG files.
              if (!e.defaultPrevented) raster.handlers.onDragOver(e)
              if (!e.defaultPrevented) svg.handlers.onDragOver(e)
            }}
            onDragLeave={(e) => {
              drop.handlers.onDragLeave(e)
              raster.handlers.onDragLeave(e)
            }}
            onDrop={(e) => {
              drop.handlers.onDrop(e)
              if (!e.defaultPrevented) raster.handlers.onDrop(e)
              if (!e.defaultPrevented) svg.handlers.onDrop(e)
            }}
          >
            {doc && <FailedLoadView session={doc} />}
            <CanvasHost
              ref={canvas}
              store={session.store}
              uiStore={session.ui}
              createRenderer={createRenderer}
              createLayoutEngine={createLayoutEngine}
              assets={assets.source}
              icons={icons}
              onImportImage={importImage}
              onIconPicker={setIconRequest}
              confirmBoundText={(_id, ref) =>
                // Board 27 §7 (uu8Qa): editing bound text asks "Detach copy/cta?" first.
                m3.confirm({
                  title: `Detach ${refName(ref)}?`,
                  desc: "This text is bound to a string variable. Editing it here replaces the binding with the current text.",
                  icon: "unlink",
                  tone: "component",
                  items: [
                    { icon: "type", accent: true, text: "The text keeps its current value" },
                    { icon: "variable", text: `${refName(ref)} stays in the file, unchanged` },
                  ],
                  confirm: "Detach & edit",
                })
              }
              duplicateMainPref={() => m3.prefs?.duplicateMain() ?? "ask"}
              askDuplicateMain={(main, ids) =>
                // Board 27 §8 (d): ⌥-drag of a main asks like ⌘D.
                new Promise((resolve) =>
                  m3.componentDialog.set({ kind: "duplicateMain", ids, main, resolve }),
                )
              }
              fontSources={fonts.sources}
              offlineFonts={offlineFonts}
              overlayTheme={overlayTheme}
              snapping={viewPrefs.snapToObjects}
              snapToPixelGrid={viewPrefs.snapToPixelGrid}
              pixelGrid={viewPrefs.pixelGrid}
              rulers={viewPrefs.rulers}
              layerNames={viewPrefs.layerNames}
              nudge={viewPrefs.nudge}
              onLayout={layout.set}
              agentCanvas={agentCanvas}
              noteAuthor={agentPanel.noteAuthor}
              onContextMenu={canvasMenu.onContextMenu}
              libraries={m3.libraries()}
              route={(ops) => (session.route ? session.route(ops) : ops)}
              onNotice={(n) => m3.toast({ tone: n.tone, text: n.text, action: n.action })}
              onQuickInsert={({ slot, of, name }) => {
                // Board 12: a main's slot takes default children; an instance's slot `at` nodes.
                const loc = m3.view().locate(slot)
                const placement =
                  loc?.instance && loc.path !== undefined
                    ? { parent: loc.instance, at: loc.path, name }
                    : { parent: slot, name }
                m3.run({ cmd: "createInstance", of, placement }, "Insert instance")
              }}
              onError={(e) => {
                if (e.kind === "command") {
                  if (e.refused) m3.toastRefusal(e.refused)
                  else m3.toastRejected(e.label, e.rejected ?? [{ message: e.error.message }])
                  return
                }
                console.warn("Kimo canvas:", e.kind === "op" ? e.message : e.error.message)
              }}
            />
            {agents.canvasLayer}
            {conflicts && (
              <CanvasConflictOverlay session={conflicts} ui={session.ui} layout={layout} />
            )}
            <FloatingToolbar
              ui={session.ui}
              onActivate={activate}
              {...(agentPanel.controller ? { onAsk: openAgentTab } : {})}
            />
            {drop.hint}
            {raster.overlay}
            <ToastStack m3={m3} />
            {doc && <ToastHost session={doc} onReview={() => review.set(review.get() + 1)} />}
            {svg.popover}
            {canvasMenu.element}
            {editorCommands.element}
            {iconRequest && (
              <CanvasIconPicker
                session={session}
                request={iconRequest}
                icons={icons}
                onPick={(set, name) => {
                  canvas.current?.insertIcon({ set, name })
                  setIconRequest(null)
                }}
                onClose={() => setIconRequest(null)}
              />
            )}
          </main>
          <RightPanel
            session={session}
            layout={layout}
            assets={assets}
            icons={icons}
            m3={m3}
            conflicts={conflicts}
            review={review}
            fonts={fonts}
            activity={agents.activity}
            openActivity={agents.openActivity}
            agent={agentPanel.panel}
            openAgent={openAgent}
            initialTab={agentPanel.initialAgentTab ? "agent" : "design"}
            onOpenExport={(p) => {
              setExportPreset(p)
              setExportOpen(true)
            }}
          />
        </div>
        {panels.variables && (
          <VariablesDialog
            session={session}
            m3={m3}
            onClose={() => m3.openPanel({ variables: false })}
          />
        )}
        <ComponentDialogs m3={m3} />
        {panels.libraryManager && (
          <LibraryManager m3={m3} onClose={() => m3.openPanel({ libraryManager: false })} />
        )}
        {panels.libraryChanges && (
          <LibraryChanges
            m3={m3}
            alias={panels.libraryChanges}
            onClose={() => m3.openPanel({ libraryChanges: null })}
          />
        )}
        <ConfirmHost m3={m3} />
        {doc && <MigrationDialog session={doc} />}
        {exportOpen && (
          <ExportDialog
            platform={platform}
            source={exportSource}
            fileRef={doc && !doc.untitled ? doc.ref : null}
            preset={exportPreset}
            onClose={() => setExportOpen(false)}
            onSelectNode={(id) => {
              session.ui.getState().select([id])
              canvas.current?.zoomToFit([id], 96)
            }}
            onExported={(o) => {
              const t = exportToastOf(o)
              const reveal = t.reveal
              m3.toast({
                tone: t.tone,
                text: t.text,
                duration: t.duration,
                ...(reveal && platform.kind === "desktop"
                  ? { action: { label: "Reveal", run: () => void platform.files.reveal(reveal) } }
                  : {}),
              })
            }}
          />
        )}
        {preview && (
          <PreviewOverlay
            store={session.store}
            libraries={() => m3.libraries()}
            frameId={preview.frame}
            createRenderer={createRenderer}
            createLayoutEngine={createLayoutEngine}
            assets={assets.source}
            icons={icons}
            fontSources={fonts.sources}
            offlineFonts={offlineFonts}
            onExit={(last, navigated) => {
              // Rule "Exit": viewport untouched; the last frame becomes selected after ‹ ›.
              if (navigated)
                session.ui.getState().select(exitSelection(preview.selection, last, true))
              setPreview(null)
              requestAnimationFrame(() => canvas.current?.focus())
            }}
          />
        )}
        <MissingFontsHost
          platform={platform}
          system={fonts}
          fileKey={session.id}
          fileName={doc ? doc.fileName : name}
          doc={() => session.store.toDocument()}
          apply={(ops, label) => session.store.apply(ops, { origin: "user", label })}
          openFontSettings={() => openSettings("fonts")}
          addDocumentFont={async (f) => {
            // "Choose font file…": a document asset (spec §12) + its manifest entry.
            const key = `${await contentHash(f.bytes)}.${f.ext}`
            await assets.putKey(key, f.bytes, { mime: f.mime, name: f.name })
            const manifest = (session.store.toHeader().assets ?? {}) as Record<string, unknown>
            if (!Object.hasOwn(manifest, key))
              session.store.apply(
                {
                  op: "setHeader",
                  set: {
                    assets: {
                      ...manifest,
                      [key]: { mime: f.mime, bytes: f.bytes.byteLength, name: f.name },
                    },
                  },
                },
                { origin: "user", label: `Add font ${f.family}` },
              )
          }}
        />
        {gcOpen && (
          <CleanUpAssetsHost
            folder={gcFolder}
            fileName={doc ? doc.fileName : name}
            doc={() => session.store.toDocument() as unknown as Record<string, unknown>}
            apply={(ops, label) => session.store.apply(ops, { origin: "user", label })}
            onDone={() => setGcOpen(false)}
          />
        )}
      </div>
    </M3Context.Provider>
  )
}

/**
 * The icon picker opened by the I key (board 09 `jKClR`), anchored at the pointer. The pick
 * inserts one icon node (one undo step) where the key was pressed.
 */
function CanvasIconPicker({
  session,
  request,
  icons,
  onPick,
  onClose,
}: {
  session: FileSession
  request: IconPickerRequest
  icons: ReturnType<typeof browserIconProvider>
  onPick(set: string, name: string): void
  onClose(): void
}) {
  const host = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const editor = useEditor(session, "canvas-icon-picker")
  const header = useDocHeader(session.store)
  useEffect(() => setAnchor(host.current), [])
  return (
    <>
      <span
        ref={host}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: request.screen.x,
          top: request.screen.y,
          width: 0,
          height: 0,
        }}
      />
      {anchor && (
        <PanelContext.Provider
          value={{ session, editor, header, layout: NULL_LAYOUT, assets: null, icons }}
        >
          <IconPickerPopover
            anchor={anchor}
            placement={{ side: "right", align: "start", offset: 8 }}
            provider={icons}
            set="lucide"
            name=""
            weight={400}
            onPick={onPick}
            onWeight={() => {}}
            onClose={onClose}
            focusSearch
          />
        </PanelContext.Provider>
      )}
    </>
  )
}

const NULL_LAYOUT = createBus<LayoutResult | null>(null)

/** ⌘0 / Ctrl+0 (the first combo of "Zoom to 100 %"; ⇧0 is the canvas's). */
const ZOOM_100_MOD = shortcut("zoom100").combos[0] as Combo

/** Toolbar tools with a single-key row in SHORTCUTS (`tool.<id>`). */
const TOOL_SHORTCUTS = CANVAS_TOOLS.flatMap((t) =>
  SHORTCUTS[`tool.${t.id}`] && t.id !== "image" ? [{ id: t.id, shortcut: `tool.${t.id}` }] : [],
)
