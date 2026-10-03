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

import { createLayoutEngine, type LayoutResult } from "@kimo/layout"
import { KIMO_FILE_FILTER } from "@kimo/platform"
import type { DocumentFontFace, OverlayTheme } from "@kimo/renderer"
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
import { CanvasConflictOverlay, useNextConflictShortcut } from "../conflicts"
import { BannerHost, FailedLoadView, MigrationDialog, ToastHost } from "../files"
import { createFontSystem, loadDocumentFontFaces, MissingFontsHost } from "../fonts"
import * as assetsModule from "../lib/assets"
import { contentHash, createAssetStore, createFolderAssetStore, manifestEntry } from "../lib/assets"
import * as filesModule from "../lib/files"
import { createFile, exportFile, importFile, patchFile, pickKimoFile, saveFile } from "../lib/files"
import { useDocHeader } from "../lib/header"
import { createBus, isTyping } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { cssToken, useTheme } from "../lib/theme"
import { useOpenSettings, useRuntime } from "../platform/runtime"
import { diskPath, navigate } from "../router"
import { DiskTopbar, useConflicts, useFocusNode, useWindowTitle } from "./disk"
import type { FileMenuActions } from "./FileMenu"
import { FloatingToolbar } from "./FloatingToolbar"
import { useEditor } from "./fields"
import { LeftPanel } from "./LeftPanel"
import { createComponent, detachInstance, goToMain } from "./m3/actions"
import { useCanvasDrop } from "./m3/CanvasDrop"
import { M3Context, M3Controller, useBusValue, useLibraries } from "./m3/controller"
import { ConfirmHost, ToastStack } from "./m3/feedback"
import "./m3/m3.css"
import "./m3/m3-panels.css"
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: tokens change with the theme mode
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
      }),
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
  const { platform, manager } = useRuntime()
  const openSettings = useOpenSettings()
  /** The document session of a file on disk (null: browser library). */
  const doc = session.document
  useWindowTitle(doc)
  const [name, setName] = useState(session.meta.name)
  // Layout passes go to a bus, not React state: only panels that show a changed box re-render.
  const layout = useMemo(() => createBus<LayoutResult | null>(null), [])
  const canvas = useRef<CanvasHandle | null>(null)
  const syncStatus = useSyncStatus(session.provider)
  const overlayTheme = useOverlayTheme()
  // Image fills and the Image tool store content-addressed assets per file: IndexedDB for the
  // browser library, `assets/` beside the file on disk.
  const assets = useMemo(
    () => (doc ? createFolderAssetStore(platform, doc.ref) : createAssetStore(session.id)),
    [doc, platform, session.id],
  )
  useEffect(() => () => assets.dispose(), [assets])
  // Fonts (board 19): one font system per editor window, Document → Local → Cache → Google.
  const faces = useRef<readonly DocumentFontFace[]>([])
  const fonts = useMemo(
    () => createFontSystem({ platform, documentFaces: () => faces.current }),
    [platform],
  )
  useEffect(() => () => fonts.dispose(), [fonts])
  const offlineFonts = useSyncExternalStore(fonts.subscribe, fonts.offline)
  useEffect(() => {
    let live = true
    const load = async () => {
      const manifest = session.store.toHeader().assets as
        | Readonly<Record<string, { mime?: string; name?: string }>>
        | undefined
      const keys = await assets.keys().catch(() => [] as string[])
      const next = await loadDocumentFontFaces(manifest, keys, (k) => assets.bytes(k))
      if (!live || (next.length === 0 && faces.current.length === 0)) return
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
    w.__kimo = { session, canvas: () => canvas.current, m3, doc, platform, fonts }
    // Source-path keyed modules for e2e scripts, which import them directly on the dev server
    // and read them from here against a production bundle.
    ;(window as unknown as { __kimoModules?: unknown }).__kimoModules = {
      "/src/lib/files.ts": filesModule,
      "/src/lib/assets.ts": assetsModule,
    }
    return () => {
      if ((w.__kimo as { session?: unknown } | undefined)?.session === session) w.__kimo = undefined
    }
  }, [session, m3, doc, platform, fonts])

  const rename = useCallback(
    (next: string) => {
      setName(next)
      void patchFile(session.id, { name: next })
    },
    [session.id],
  )
  const download = useCallback(
    () =>
      void exportFile(session.store, name, assets).then((file) => {
        if (file.missingAssets.length)
          console.warn(`Kimo: images not in this browser: ${file.missingAssets.join(", ")}`)
        return saveFile(file)
      }),
    [session.store, name, assets],
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
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const ui = session.ui.getState()
      // A canvas gesture owns the undo stack until it ends (its steps collapse into one entry).
      if (mod && (key === "z" || key === "y") && canvas.current?.isGesturing()) {
        e.preventDefault()
        return
      }
      // The pen's points are not in the document yet: ⌘Z removes the last one (Figma).
      if (
        mod &&
        (key === "z" || key === "y") &&
        canvas.current?.penUndo(key === "y" || e.shiftKey)
      ) {
        e.preventDefault()
        return
      }
      if (mod && key === "z") {
        e.preventDefault()
        if (e.shiftKey) session.store.redo("user")
        else session.store.undo("user")
        return
      }
      if (mod && key === "y") {
        e.preventDefault()
        session.store.redo("user")
        return
      }
      if (mod && key === "s") {
        e.preventDefault()
        if (e.shiftKey) void saveAs()
        else save()
        return
      }
      if (mod && key === "o") {
        e.preventDefault()
        void openFile()
        return
      }
      if (mod && !e.shiftKey && key === "n") {
        // The browser keeps ⌘N for a new window; it reaches the page when the canvas has focus.
        e.preventDefault()
        void newFile()
        return
      }
      if (mod && key === "0") {
        e.preventDefault()
        if (canvas.current) canvas.current.zoomTo(1)
        else ui.setViewport({ zoom: 1 })
        return
      }
      if (mod && e.shiftKey && key === "k") {
        e.preventDefault()
        activate("image")
        return
      }
      // M3 shortcuts (boards 11/12/14): ⌥⌘K create component, ⌥⌘B detach, ⌥⏎ go to main,
      // ⌘⇧V variables. `e.code` because ⌥ changes `e.key` on macOS.
      if (mod && e.altKey && e.code === "KeyK") {
        e.preventDefault()
        createComponent(m3, ui.selection, canvas.current?.layout() ?? null)
        return
      }
      if (mod && e.altKey && e.code === "KeyB") {
        e.preventDefault()
        const id = ui.selection[0]
        if (id && session.store.getNode(id)?.type === "instance") void detachInstance(m3, id)
        return
      }
      if (!mod && e.altKey && e.key === "Enter") {
        const id = ui.selection[0]
        if (id && m3.view().origin(id)?.instance) {
          e.preventDefault()
          goToMain(m3, id)
        }
        return
      }
      if (mod && e.shiftKey && e.code === "KeyV") {
        e.preventDefault()
        m3.openPanel({ variables: !m3.panels.get().variables })
        return
      }
      if (mod || e.altKey) return
      // Escape, Delete, arrows, ⌘D/⌘G and zoom keys are canvas commands (CanvasController).
      if (key === "h" && !e.shiftKey) {
        // Hand tool (no toolbar entry in board 03; Space-drag pans temporarily).
        e.preventDefault()
        ui.setTool("hand")
        return
      }
      const tool = CANVAS_TOOLS.find((t) => t.shortcut.toLowerCase() === key)
      if (tool) {
        e.preventDefault()
        activate(tool.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [session, activate, save, saveAs, openFile, newFile, m3])

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
            onHome={() => navigate("/")}
            onExport={download}
            onPreview={() => {}}
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
            onHome={() => navigate("/")}
            onExport={download}
            onPreview={() => {}}
          />
        )}
        {doc && <BannerHost session={doc} />}
        <div className="editor__body">
          <LeftPanel session={session} m3={m3} conflicts={conflicts} />
          <main
            ref={canvasEl}
            className="editor__canvas"
            aria-label="Canvas"
            onDragOver={(e) => {
              drop.handlers.onDragOver(e)
              if (!e.defaultPrevented) svg.handlers.onDragOver(e)
            }}
            onDragLeave={drop.handlers.onDragLeave}
            onDrop={(e) => {
              drop.handlers.onDrop(e)
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
              fontSources={fonts.sources}
              offlineFonts={offlineFonts}
              overlayTheme={overlayTheme}
              onLayout={layout.set}
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
            {conflicts && (
              <CanvasConflictOverlay session={conflicts} ui={session.ui} layout={layout} />
            )}
            <FloatingToolbar ui={session.ui} onActivate={activate} />
            {drop.hint}
            <ToastStack m3={m3} />
            {doc && <ToastHost session={doc} onReview={() => review.set(review.get() + 1)} />}
            {svg.popover}
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
          />
        </div>
        {panels.variables && (
          <VariablesDialog
            session={session}
            m3={m3}
            onClose={() => m3.openPanel({ variables: false })}
          />
        )}
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
        <MissingFontsHost
          platform={platform}
          system={fonts}
          fileKey={session.id}
          fileName={doc ? doc.fileName : name}
          doc={() => session.store.toDocument()}
          apply={(ops, label) => session.store.apply(ops, { origin: "user", label })}
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
