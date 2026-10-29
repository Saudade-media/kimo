/**
 * The editor shell — boards "03 Editor — Light" / "05 Editor — Agent — Dark" (ewttY / EHux2):
 * vertical, bg-canvas. Board 44 "Workspace v2": the Body is a Stage where the canvas runs
 * full-bleed under two floating cards (Left 256, Right 280) whose headers replace the topbar.
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
import { KIMO_OPEN_FILTER } from "@kimo/platform"
import type { DocumentFontFace, FontFaceKey, OverlayTheme } from "@kimo/renderer"
import { browserIconProvider, createRenderer } from "@kimo/renderer/browser"
import { EmptyState } from "@kimo/ui"
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { CleanUpAssetsHost, indexedDbAssetFolder, platformAssetFolder } from "../assets-gc"
import { CanvasHost } from "../canvas/CanvasHost"
import {
  type AgentCanvasProps,
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
import {
  BannerHost,
  FailedLoadView,
  MigrationDialog,
  ToastHost,
  useWebTabTitle,
  useWindowChrome,
} from "../files"
import {
  createFontSystem,
  type DocumentFontAsset,
  isFontAsset,
  loadDocumentFontFaces,
  MissingFontsHost,
} from "../fonts"
import { storeFontAsset, withFontManifest } from "../fonts/store-font-asset"
import { joinedToast } from "../join/copy"
import * as assetsModule from "../lib/assets"
import { contentHash, createAssetStore, createFolderAssetStore, manifestEntry } from "../lib/assets"
import * as filesModule from "../lib/files"
import { createFile, exportFile, importFile, patchFile, pickKimoFile, saveFile } from "../lib/files"
import { useDocHeader } from "../lib/header"
import { createBus, isTyping } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { runTextEdit } from "../lib/native-menu"
import { cssToken, useTheme } from "../lib/theme"
import { roomKeyOf } from "../multiplayer/backend"
import { useMultiplayer } from "../multiplayer/hooks"
import { libraryKeyOf } from "../multiplayer/library"
import type { Capabilities } from "../multiplayer/model"
import type { SharedSession } from "../multiplayer/share"
import { TopbarShare, TopbarSyncStatus } from "../multiplayer/ui/TopbarShare"
import { useEditorMultiplayer } from "../multiplayer-canvas/MultiplayerCanvas"
import { useOpenSettings, useRuntime } from "../platform/runtime"
import { exitSelection, PreviewOverlay, pickPreviewFrame, usePreviewTarget } from "../preview"
import { diskPath, lastHomePath, navigate } from "../router"
import { useEditorAgentPanel } from "./agent-panel"
import {
  useAgentTabActivity,
  useAgentTouched,
  useConnectedOrigins,
  useEditorAgents,
} from "./agents"
import { refName } from "./bindings"
import { useCanvasMenu } from "./CanvasMenu"
import {
  EditorChromeContext,
  LeftCardHeader,
  LibrarySaveStatus,
  RightCardHeader,
} from "./CardHeaders"
import { useRasterDrop } from "./clipboard/RasterDrop"
import { useEditorCommands } from "./clipboard/useEditorCommands"
import { DiskLeftCardHeader, useConflicts, useFocusNode, useWindowTitle } from "./disk"
import { failureText } from "./errors"
import type { FileMenuActions } from "./FileMenu"
import { FloatingToolbar } from "./FloatingToolbar"
import { useEditor } from "./fields"
import { LeftPanel } from "./LeftPanel"
import { createComponent, detachInstance, goToMain } from "./m3/actions"
import { useCanvasDrop } from "./m3/CanvasDrop"
import { M3Context, M3Controller, useBusValue, useLibraries } from "./m3/controller"
import { ConfirmHost, ToastStack } from "./m3/feedback"
import { activeRoots } from "./pages/model"
import { useReleaseStalePlaceholders } from "./placeholder-release"
import "./m3/m3.css"
import "./m3/m3-panels.css"
import "./m3/component-dialogs.css"
import "./workspace.css"
import { boundRoomOf, renameWorkspaceFile } from "../multiplayer/cloud/workspace-view"
import { CLOUD_DELETED_REASON, CLOUD_REMOVED_REASON } from "../multiplayer/cloud/workspaces"
import { WorkspaceBanner } from "../multiplayer/ui/WorkspaceBanner"
import { useIsWorkspaceRoom } from "../multiplayer/ui/workspace-parts"
import { type Combo, matchCombo, matches, SHORTCUTS, shortcut } from "../shortcuts/shortcuts"
import { useThumbnailWriter } from "../thumbnails/writer"
import { ComponentDialogs } from "./m3/ComponentDialogs"
import { LibraryChanges, LibraryManager } from "./m3/popovers"
import { VariablesDialog } from "./m3/VariablesDialog"
import { PanelContext } from "./panel-context"
import { toggleBothPanels, usePanels } from "./panels"
import { IconPickerPopover } from "./popovers/IconPicker"
import { RightPanel } from "./RightPanel"
import {
  createRoomSession,
  type FileSession,
  roomFileName,
  useDiskSession,
  useFileSession,
  useSyncStatus,
} from "./session"
import { useSvgImport } from "./svg-drop"
import { ViewOnlyBanner } from "./ViewOnlyBanner"
import {
  fileMenuFor,
  guardViewerTool,
  ViewOnlyContext,
  viewerKeyBlocked,
  viewerToolAllowed,
} from "./view-only"

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
        <a className="editor-status__link" href={`#${lastHomePath()}`}>
          Back to files
        </a>
      )}
    </div>
  )
}

const FILE_CAPABILITIES: Capabilities = {
  canEdit: true,
  canExport: true,
  canDuplicate: true,
  canShare: true,
  viewOnly: false,
}

/** What this window may do in the room `key` (a file that was never shared: everything). */
function useEditorCapabilities(key: string | null): Capabilities {
  const model = useMultiplayer()
  const doc = model && key ? model.document(key) : null
  const subscribe = useCallback((l: () => void) => (doc ? doc.subscribe(l) : () => {}), [doc])
  const get = useCallback(() => (doc ? doc.getState().capabilities : FILE_CAPABILITIES), [doc])
  return useSyncExternalStore(subscribe, get, get)
}

/** Sessions whose "You joined" toast was shown (StrictMode runs effects twice). */
const joinedToasts = new WeakSet<SharedSession>()

/**
 * A room joined from a link (board 41 sections 5 and 9): the editor over the room's guest
 * document. A Toast says the role once; a View link adds the banner and the read-only chrome.
 */
export function RoomEditor({ shared }: { shared: SharedSession }) {
  const session = useMemo(
    () => createRoomSession(shared, roomFileName(shared.store) ?? "Shared file"),
    [shared],
  )
  return <EditorShell key={session.id} session={session} joinedRole={shared.role} />
}

/** A `.kimo` on disk (`#/disk/<ref>`), opened through the window's session manager. */
export function DiskEditor({ fileRef, node }: { fileRef: string; node?: string | null }) {
  const { manager } = useRuntime()
  const state = useDiskSession(manager, fileRef)
  const openedRef = state.status === "ready" ? state.session.id : null
  useEffect(() => {
    // A `.pen` opens as the `.kimo` it was converted to: show that file's route instead.
    if (openedRef && openedRef !== fileRef) location.replace(`#${diskPath(openedRef, node)}`)
  }, [openedRef, fileRef, node])
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
        <a className="editor-status__link" href={`#${lastHomePath()}`}>
          Back to files
        </a>
      )}
    </div>
  )
}

function EditorShell({
  session,
  focusNode = null,
  joinedRole = null,
}: {
  session: FileSession
  focusNode?: string | null
  /** A joined room: the role the "You joined" Toast names. */
  joinedRole?: "edit" | "view" | null
}) {
  const {
    platform,
    manager,
    hostClient = null,
    libraryShare = null,
    workspaces = null,
  } = useRuntime()
  const openSettings = useOpenSettings()
  const windowChrome = useWindowChrome(platform)
  /** Board 44: this window's collapsed cards (header button, ⌘\, View menu). */
  const cards = usePanels()
  /** Board 44: zoom to fit frames content beside the expanded cards (8 + 256, 280 + 8). */
  const fitInsets = useMemo(
    () => ({ left: cards.left ? 0 : 264, right: cards.right ? 0 : 288, top: 0, bottom: 0 }),
    [cards.left, cards.right],
  )
  /** False once a tab strip above the editor owns the traffic lights and the drag region. */
  const ownsChrome = useContext(EditorChromeContext)
  /** The document session of a file on disk (null: browser library). */
  const doc = session.document
  /** A room joined from a link (null: a file of this device). */
  const room = session.shared ?? null
  const caps = useEditorCapabilities(room ? roomKeyOf(room.room) : null)
  const viewOnly = caps.viewOnly
  const workspaceRoom = useIsWorkspaceRoom(room?.room ?? null)
  const [name, setName] = useState(session.meta.name)
  // Layout passes go to a bus, not React state: only panels that show a changed box re-render.
  const layout = useMemo(() => createBus<LayoutResult | null>(null), [])
  const canvas = useRef<CanvasHandle | null>(null)
  // Board 37 §9: Home's preview of this file, refreshed after saves while the editor is idle.
  useThumbnailWriter(session, canvas, platform)
  /** ⌘K "Ask Kimo" (set once the agent panel exists). */
  const askRef = useRef<(() => void) | null>(null)
  const syncStatus = useSyncStatus(session.provider)
  const overlayTheme = useOverlayTheme()
  // Board 27 §4: snapping, pixel grid, rulers, nudge, layer names (app preferences).
  const viewPrefs = useCanvasViewPrefs(platform.settings)
  // Image fills and the Image tool store content-addressed assets per file: IndexedDB for the
  // browser library, `assets/` beside the file on disk.
  const assets = useMemo(
    () =>
      room
        ? room.assets
        : doc
          ? createFolderAssetStore(platform, doc.ref)
          : createAssetStore(session.id),
    [doc, room, platform, session.id],
  )
  // A room's asset store belongs to the room session.
  useEffect(() => () => (room ? undefined : assets.dispose()), [assets, room])
  /** The share key of this document: a joined room, a file on disk, a browser library file. */
  const shareKey = room ? roomKeyOf(room.room) : doc ? doc.ref : libraryKeyOf(session.id)
  // Board 46 5D, 6E "Save a copy": an editable copy of a read-only workspace copy. On disk, Save as
  // (the copy is a plain local file, so the cloud read-only reason goes); else a library file.
  const saveCopy = useCallback(async () => {
    if (doc) {
      const ref = await doc.saveAs()
      if (!ref) return
      const reason = session.store.readOnly?.reason
      if (reason === CLOUD_DELETED_REASON || reason === CLOUD_REMOVED_REASON)
        session.store.setReadOnly(null)
      navigate(diskPath(ref))
      return
    }
    const id = await createFile(name || "Untitled", { document: session.store.toDocument() })
    navigate(`/file/${id}`)
  }, [doc, session.store, name])
  // Board 41: a browser library file shares like a file on disk; one this device shared
  // reconnects to its room while the editor shows it.
  useEffect(() => {
    if (room || doc || !libraryShare) return
    return libraryShare.open({ fileId: session.id, store: session.store, assets })
  }, [room, doc, libraryShare, session, assets])
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
  // Assets stored after the canvas drew them as missing (a shared file's images fetched from the
  // relay as a guest opens it): the canvas asks again instead of keeping the placeholder.
  useEffect(() => assets.subscribe(() => canvas.current?.renderer?.retryAssets?.()), [assets])
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
    // E10: ⇧Space and the desktop menu bar's View › Preview stay live with no frames; say why
    // nothing opened instead of a dead click.
    else m3.toast({ tone: "warning", text: "Nothing to preview. Add a frame to this page." })
  }, [session, m3])
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
  useFocusNode(focusNode, session.ui, canvas, () =>
    activeRoots(session.store, session.ui.getState().page),
  )

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
      // A joined room has no file of this device to rename.
      if (!room) void patchFile(session.id, { name: next })
    },
    [session.id, room],
  )
  const download = useCallback(
    () =>
      void exportFile(
        session.store,
        name,
        assets,
        prepareWrite,
        platform.settings.get("fonts.embedInKimoz"),
      ).then((file) => {
        if (file.missingAssets.length)
          console.warn(`Kimo: images not in this browser: ${file.missingAssets.join(", ")}`)
        return saveFile(file)
      }),
    [session.store, name, assets, prepareWrite, platform.settings],
  )
  // Double-click on the file name (board 44 card header): the file on disk is renamed, a workspace
  // copy renames the workspace file for everyone too, and the route follows the new name.
  const renameDisk = useCallback(
    async (next: string) => {
      if (!doc) return
      const was = doc.fileName
      try {
        const room = workspaces ? boundRoomOf(workspaces.getState(), doc.ref) : null
        const to =
          room && workspaces
            ? await renameWorkspaceFile(workspaces, (ref, n) => manager.rename(ref, n), room, next)
            : await manager.rename(doc.ref, next)
        if (to) navigate(diskPath(to))
      } catch (e) {
        m3.toast({ tone: "danger", text: failureText(`rename ${was}`, e) })
      }
    },
    [doc, workspaces, manager, m3],
  )
  const saveAs = useCallback(async () => {
    // Browser library: Save as… writes through the File System Access picker when granted,
    // otherwise downloads the .kimo / .kimoz (board 20 note p0SuJa).
    if (!doc) return download()
    const wasUntitled = doc.untitled
    // A5: a failed write or a locked target shows "Couldn't save …" (a cancelled dialog
    // resolves null inside saveAs and stays silent).
    const ref = await doc.saveAs().catch((e: unknown) => {
      m3.toast({ tone: "danger", text: failureText(`save ${doc.fileName}`, e) })
      return null
    })
    if (ref) navigate(diskPath(ref))
    else if (wasUntitled && !doc.untitled) navigate(diskPath(doc.ref))
  }, [doc, download, m3])
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
        .openFile({ title: "Open", filters: [KIMO_OPEN_FILTER] })
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
      // View only: Select is the one tool.
      if (viewOnly && !(spec?.tool && viewerToolAllowed(spec.tool))) return
      // M3: the Component button is a one-shot action (⌥⌘K), not a mode.
      if (spec?.action === "createComponent") {
        createComponent(m3, session.ui.getState().selection, canvas.current?.layout() ?? null)
        return
      }
      if (!spec?.enabled) return
      if (canvas.current) canvas.current.activateTool(id)
      else if (spec.tool) session.ui.getState().setTool(spec.tool)
    },
    [session.ui, m3, viewOnly],
  )

  // View only (board 41 section 9): the tool stays Select, and the keys that write, duplicate or
  // save a copy never reach the editor or the canvas (capture phase, before every other handler).
  useEffect(() => {
    if (!viewOnly) return
    const offTool = guardViewerTool(session.ui)
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !viewerKeyBlocked(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      offTool()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [viewOnly, session.ui])

  // Joined: the editor opens on the owner's view when they published one (board 41 B); else the
  // page framed as any file opens. Runs after the framing (same frame, registered later).
  useEffect(() => {
    if (!room) return
    let raf = 0
    let tries = 0
    const go = () => {
      if (!canvas.current?.layout()) {
        if (++tries < 600) raf = requestAnimationFrame(go)
        return
      }
      const owner = [...(room.presence?.().values() ?? [])].find((p) => p.owner && p.viewport)
      const v = owner?.viewport
      if (v) session.ui.getState().setViewport({ x: v.x, y: v.y, zoom: v.zoom })
    }
    raf = requestAnimationFrame(go)
    return () => cancelAnimationFrame(raf)
  }, [room, session.ui])

  // Joined: a Toast names the role once (board 41 B).
  useEffect(() => {
    if (!room || joinedRole === null || joinedToasts.has(room)) return
    joinedToasts.add(room)
    m3.toast(
      joinedRole === "edit"
        ? { tone: "success", icon: "users", text: joinedToast("edit", name) }
        : { tone: "component", icon: "eye", text: joinedToast("view", name) },
    )
  }, [room, joinedRole, m3, name])

  // ⌘Z / ⇧⌘Z and Edit › Undo / Redo (E5): a canvas gesture owns the stack until it ends (its
  // steps collapse into one entry); the pen's points are not in the document yet (⌘Z removes the
  // last one, Figma).
  const undoRedo = useCallback(
    (redo: boolean) => {
      if (canvas.current?.isGesturing()) return
      if (canvas.current?.penUndo(redo)) return
      if (redo) session.store.redo("user")
      else session.store.undo("user")
    },
    [session],
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
        undoRedo(redo)
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
      // Board 44 §5 rule "Collapse": ⌘\ collapses both floating cards, or opens both again.
      if (matches("togglePanels", e)) {
        e.preventDefault()
        toggleBothPanels()
        return
      }
      // Board 27 §4 View menu: ⇧' pixel grid, ⇧R rulers (the same keys as Settings › Canvas).
      if (matches("view.pixelGrid", e)) {
        e.preventDefault()
        toggleViewPref(platform.settings, "canvas.pixelGrid", (err) =>
          m3.toast({ tone: "danger", text: failureText("change the view setting", err) }),
        )
        return
      }
      if (matches("view.rulers", e)) {
        e.preventDefault()
        toggleViewPref(platform.settings, "canvas.rulers", (err) =>
          m3.toast({ tone: "danger", text: failureText("change the view setting", err) }),
        )
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
    undoRedo,
  ])

  // Board 21: agents (avatars in the stack, approvals, canvas attribution, layer dots, Activity).
  const agents = useEditorAgents({
    platform,
    hostClient,
    session,
    doc,
    canvas,
    layout,
    // D17: the session popover's client settings open Agents & MCP on that client.
    openSettings: (client) => openSettings("agents-mcp", client ?? null),
    onSaveCopy: () => void saveAs(),
    onError: (n) =>
      m3.toast({ tone: "danger", text: n.text, ...(n.action ? { action: n.action } : {}) }),
  })
  const agentNodes = useAgentTouched(agents.controller)
  const mcpOrigins = useConnectedOrigins(agents.controller)

  // M6: the built-in agent (Agent tab, canvas surfaces, prompt runs, Home hand-off).
  const openAgent = useMemo(() => createBus(0), [])
  const openAgentTab = useCallback(() => openAgent.set(openAgent.get() + 1), [openAgent])
  askRef.current = openAgentTab
  // Board 41: presence, agent claims and asset sync on the canvas; name-only fonts banner.
  const agentPersona = useRef<AgentCanvasProps | undefined>(undefined)
  const personaOf = useCallback(
    (origin: string) => agentPersona.current?.agent(origin)?.persona,
    [],
  )
  const [fontsRequest, setFontsRequest] = useState(0)
  const textGeometry = useCallback(
    (node: string) => canvas.current?.renderer?.textGeometry?.(node) ?? null,
    [],
  )
  const multiplayer = useEditorMultiplayer({
    session,
    shareKey,
    layout,
    assets,
    container: canvasEl,
    personaOf,
    fonts,
    onOpenFonts: () => setFontsRequest((n) => n + 1),
    textGeometry,
  })
  const agentPanel = useEditorAgentPanel({
    platform,
    hostClient,
    session,
    doc,
    canvas,
    layout,
    // D18: the Usage card opens AI providers scrolled to Usage & limits.
    openSettings: (pane) =>
      pane === "usage" ? openSettings("ai-providers", "usage") : openSettings(pane),
    openAgentTab,
    onError: (text) => m3.toast({ tone: "danger", text }),
    areaBusy: multiplayer.areaBusy,
  })
  agentPersona.current = agentPanel.canvas
  // Board 48 §5: the Agent tab's dot (the built-in agent and this window's MCP clients).
  const agentTabActivity = useAgentTabActivity(agentPanel.controller, agents.controller)
  const { claimedOrigins, hiddenOrigins } = multiplayer
  // Connected MCP clients count as live agents on the canvas (their placeholders read "building").
  // Board 41 › 7: agents with a claim outline lose board 36's section outline; paused agents
  // hide their cursor.
  const agentCanvas = useMemo(() => {
    const base =
      agentPanel.canvas && mcpOrigins.size
        ? {
            ...agentPanel.canvas,
            liveOrigins: new Set([...agentPanel.canvas.liveOrigins, ...mcpOrigins]),
          }
        : agentPanel.canvas
    return base && (claimedOrigins.size || hiddenOrigins.size)
      ? { ...base, claimedOrigins, hiddenOrigins }
      : base
  }, [agentPanel.canvas, mcpOrigins, claimedOrigins, hiddenOrigins])
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
    viewOnly,
    ...(caps.canExport ? { onExport: openExport } : {}),
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
  // Home: a never-saved document asks first (board 24 (i) close prompt). `to` is a Home route
  // (board 37 rules: `/` Recents, `/folder/<ref>` a folder's section).
  const goHome = useCallback(
    (to = lastHomePath()) => {
      if (!doc?.untitled) return navigate(to)
      void doc.requestClose().then((ok) => {
        if (ok) navigate(to)
      })
    },
    [doc],
  )

  // Native menu bar (board 37, audit A6 / E3 / E5): Back to files, New file, Open… and Edit ›
  // Undo / Redo / Select All. With a text field focused the Edit items act on the field.
  const menuRun = useRef({ goHome, newFile, openFile, undoRedo, editorCommands })
  menuRun.current = { goHome, newFile, openFile, undoRedo, editorCommands }
  useEffect(() => {
    const menu = platform.menu
    if (!menu) return
    // The menu's state only: a failed call leaves the items as they were.
    void menu.setContext("editor").catch(() => {})
    const off = menu.onAction((a) => {
      const run = menuRun.current
      if (a === "go-home") run.goHome()
      else if (a === "new-file") void run.newFile()
      else if (a === "open-file") void run.openFile()
      else if (a === "undo" || a === "redo" || a === "select-all") {
        if (runTextEdit(a)) return
        if (a === "select-all") run.editorCommands.commands.selectAll()
        else run.undoRedo(a === "redo")
      }
    })
    // No "home" on cleanup: Home reports its own context when it mounts, and a cleanup call
    // could reach Rust after the next mount's "editor" (commands run concurrently).
    return off
  }, [platform])

  const fileMenu: FileMenuActions = fileMenuFor(
    {
      // Board 37 Xq4V0 (E3): "Back to files" leads the File menu.
      onHome: () => goHome(),
      onNewFile: () => void newFile(),
      onOpenFile: () => void openFile(),
      onOpenRecent: (ref) => navigate(diskPath(ref)),
      onSave: save,
      onSaveAs: () => void saveAs(),
      // Desktop only (web cPHVm omits it); an untitled document has nothing on disk to reveal.
      ...(doc && !doc.untitled && platform.capabilities.reveal
        ? {
            onReveal: () =>
              void platform.files
                .reveal(doc.ref)
                .catch((e: unknown) =>
                  m3.toast({ tone: "danger", text: failureText(`reveal ${doc.fileName}`, e) }),
                ),
          }
        : {}),
      onExportDialog: openExport,
      onCopyPng: copyPng,
      // A joined room's assets belong to the room, not to this device's folders.
      ...(room ? {} : { onCleanUpAssets: () => setGcOpen(true) }),
      onSettings: () => openSettings("general"),
    },
    caps,
  )

  // Board 44: the card headers replace the topbar (boards 03 / 16). Left: File Menu (logo, file
  // name, File menu) and Collapse; right: People (avatar stack with agents and people, Share),
  // Zoom (View menu), Play and Collapse.
  // macOS overlay title bar: the lights sit over the left card header until the tab strip owns
  // the window chrome (`EditorChromeContext` false).
  const lightsInset = ownsChrome && platform.capabilities.trafficLights ? windowChrome.inset : 0
  const leftHeader = doc ? (
    <DiskLeftCardHeader
      doc={doc}
      {...fileMenu}
      {...(doc.untitled ? {} : { onRename: (n: string) => void renameDisk(n) })}
      onHome={() => goHome()}
      lightsInset={lightsInset}
      collapsed={cards.left}
    />
  ) : (
    <LeftCardHeader
      fileName={name}
      onRename={rename}
      {...fileMenu}
      onHome={() => goHome()}
      saveStatus={syncStatus}
      // Board 41 §2: a shared file's sync status, else the library status (attention only).
      status={
        <TopbarSyncStatus
          docKey={shareKey}
          quietWhenSynced
          fallback={<LibrarySaveStatus status={syncStatus} />}
        />
      }
      lightsInset={lightsInset}
      collapsed={cards.left}
    />
  )
  const rightHeader = (
    <RightCardHeader
      ui={session.ui}
      canvas={() => canvas.current}
      onPreview={openPreview}
      previewTarget={previewTarget}
      collapsed={cards.right}
      people={agents.stack((stack) => (
        // Board 48 §1: one stack for everyone (this window's agents first, then the people of a
        // file's or a joined room's share), the people popover, and Share.
        <TopbarShare
          docKey={shareKey}
          card
          agents={stack.agents}
          onPeopleOpenChange={stack.onPeopleOpenChange}
          nodeName={(id) => {
            const n = session.store.getNode(id)?.name
            return typeof n === "string" ? n : null
          }}
          onRevealNodes={(ids) => {
            const live = ids.filter((id) => session.store.getNode(id))
            if (!live.length) return
            session.ui.getState().select(live)
            canvas.current?.zoomToFit(live, 96)
          }}
        />
      ))}
    />
  )

  return (
    <M3Context.Provider value={m3}>
      <ViewOnlyContext.Provider value={viewOnly}>
        <div className={viewOnly ? "editor editor--view-only" : "editor"}>
          {/* A workspace file's view-only state is board 46's banner below, not board 41's. */}
          {viewOnly && !workspaceRoom && <ViewOnlyBanner shared={room} />}
          {/* Board 46 5A to 5D, 6E: a workspace file's plan, or a copy left after leaving. */}
          <WorkspaceBanner docKey={shareKey} room={room?.room ?? null} onSaveCopy={saveCopy} />
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
          {multiplayer.banner}
          <div className="editor__body">
            <LeftPanel
              header={leftHeader}
              collapsed={cards.left}
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
                wheelZoom={viewPrefs.wheelZoom}
                fitInsets={fitInsets}
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
              {/* One stacking context under the side cards: the layers' own z-indexes order them
                  among themselves, never above the cards. */}
              <div className="editor__canvas-layers">
                {agents.canvasLayer}
                {multiplayer.canvasLayer}
              </div>
              {agentPanel.modeSummary}
              {conflicts && (
                <CanvasConflictOverlay session={conflicts} ui={session.ui} layout={layout} />
              )}
              <FloatingToolbar
                ui={session.ui}
                onActivate={activate}
                {...(agentPanel.controller ? { onAsk: openAgentTab } : {})}
                viewOnly={viewOnly}
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
                  onPick={(set, name, weight) => {
                    canvas.current?.insertIcon({ set, name, ...(weight ? { weight } : {}) })
                    setIconRequest(null)
                  }}
                  onClose={() => setIconRequest(null)}
                />
              )}
            </main>
            <RightPanel
              header={rightHeader}
              collapsed={cards.right}
              agentActivity={agentTabActivity}
              {...(caps.canExport ? { onExport: openExport } : {})}
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
              lightsInset={platform.kind === "desktop" ? windowChrome.inset : 0}
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
            nameOnly={multiplayer.nameOnlyFonts}
            openRequest={fontsRequest}
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
      </ViewOnlyContext.Provider>
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
  /** `weight`: the Material weight slider's value (E11); undefined for sets without weights. */
  onPick(set: string, name: string, weight?: number): void
  onClose(): void
}) {
  const host = useRef<HTMLSpanElement>(null)
  const [weight, setWeight] = useState(400)
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
            weight={weight}
            onPick={(set, name) =>
              onPick(set, name, set.startsWith("material") ? weight : undefined)
            }
            onWeight={setWeight}
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
