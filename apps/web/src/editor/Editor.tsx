/**
 * The editor shell — boards "03 Editor — Light" / "05 Editor — Agent — Dark" (ewttY / EHux2):
 * vertical, bg-canvas; Topbar (48) over Body (Left Panel 256 · Canvas fill · Right Panel 280).
 * Owns the file session and the global shortcuts; the canvas is mounted through the
 * CanvasHost contract (CanvasKit renderer + Yoga layout, ADR 0009).
 */

import { createLayoutEngine, type LayoutResult } from "@kimo/layout"
import { googleFontsSource, type OverlayTheme } from "@kimo/renderer"
import { browserIconProvider, createRenderer } from "@kimo/renderer/browser"
import { EmptyState } from "@kimo/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CanvasHost } from "../canvas/CanvasHost"
import {
  CANVAS_TOOLS,
  type CanvasHandle,
  type CanvasToolId,
  type IconPickerRequest,
} from "../canvas/contract"
import { createAssetStore, manifestEntry } from "../lib/assets"
import { exportFile, importFile, patchFile, pickKimoFile, saveFile } from "../lib/files"
import { useDocHeader } from "../lib/header"
import { createBus, isTyping } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { useWebFonts } from "../lib/settings"
import { cssToken, useTheme } from "../lib/theme"
import { navigate } from "../router"
import { FloatingToolbar } from "./FloatingToolbar"
import { useEditor } from "./fields"
import { LeftPanel } from "./LeftPanel"
import { PanelContext } from "./panel-context"
import { IconPickerPopover } from "./popovers/IconPicker"
import { RightPanel } from "./RightPanel"
import { type FileSession, useFileSession, useSyncStatus } from "./session"
import { Topbar } from "./Topbar"

/**
 * Google Fonts for families the document uses beyond the bundled Inter / JetBrains Mono. Off
 * when the user disables web fonts (File menu): the renderer then runs with `offlineFonts`.
 */
const FONT_SOURCES = [googleFontsSource()]

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

function EditorShell({ session }: { session: FileSession }) {
  const [name, setName] = useState(session.meta.name)
  // Layout passes go to a bus, not React state: only panels that show a changed box re-render.
  const layout = useMemo(() => createBus<LayoutResult | null>(null), [])
  const canvas = useRef<CanvasHandle | null>(null)
  const syncStatus = useSyncStatus(session.provider)
  const overlayTheme = useOverlayTheme()
  const webFonts = useWebFonts()
  // Image fills and the Image tool store content-addressed assets per file (IndexedDB).
  const assets = useMemo(() => createAssetStore(session.id), [session.id])
  useEffect(() => () => assets.dispose(), [assets])
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

  // Test/debug hook: e2e and perf scripts read the store through it. On in dev; in a
  // production build only when opted in with `?kimo-debug` in the URL (or VITE_KIMO_DEBUG=1 at build time).
  useEffect(() => {
    if (!debugHookEnabled()) return
    const w = window as unknown as { __kimo?: unknown }
    w.__kimo = { session, canvas: () => canvas.current }
    return () => {
      if ((w.__kimo as { session?: unknown } | undefined)?.session === session) w.__kimo = undefined
    }
  }, [session])

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
  const openFile = useCallback(async () => {
    const file = await pickKimoFile()
    if (!file) return
    try {
      navigate(`/file/${(await importFile(file)).id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const activate = useCallback(
    (id: CanvasToolId) => {
      const spec = CANVAS_TOOLS.find((t) => t.id === id)
      if (!spec?.enabled) return
      if (canvas.current) canvas.current.activateTool(id)
      else if (spec.tool) session.ui.getState().setTool(spec.tool)
    },
    [session.ui],
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
        download()
        return
      }
      if (mod && key === "o") {
        e.preventDefault()
        void openFile()
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
  }, [session, activate, download, openFile])

  return (
    <div className="editor">
      <Topbar
        fileName={name}
        pageName="Page 1"
        syncStatus={syncStatus}
        ui={session.ui}
        canvas={() => canvas.current}
        onRename={rename}
        onDownload={download}
        onOpenFile={() => void openFile()}
        onHome={() => navigate("/")}
        onExport={download}
        onPreview={() => {}}
      />
      <div className="editor__body">
        <LeftPanel session={session} />
        <main className="editor__canvas" aria-label="Canvas">
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
            fontSources={FONT_SOURCES}
            offlineFonts={!webFonts}
            overlayTheme={overlayTheme}
            onLayout={layout.set}
            onError={(e) =>
              console.warn("Kimo canvas:", e.kind === "op" ? e.message : e.error.message)
            }
          />
          <FloatingToolbar ui={session.ui} onActivate={activate} />
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
        <RightPanel session={session} layout={layout} assets={assets} icons={icons} />
      </div>
    </div>
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
