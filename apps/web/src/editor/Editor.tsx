/**
 * The editor shell — boards "03 Editor — Light" / "05 Editor — Agent — Dark" (ewttY / EHux2):
 * vertical, bg-canvas; Topbar (48) over Body (Left Panel 256 · Canvas fill · Right Panel 280).
 * Owns the file session and the global shortcuts; the canvas is mounted through the
 * CanvasHost contract (CanvasKit renderer + Yoga layout, ADR 0009).
 */

import { createLayoutEngine, type LayoutResult } from "@kimo/layout"
import { type AssetSource, googleFontsSource, type OverlayTheme } from "@kimo/renderer"
import { createRenderer } from "@kimo/renderer/browser"
import { EmptyState } from "@kimo/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CanvasHost } from "../canvas/CanvasHost"
import { CANVAS_TOOLS, type CanvasHandle, type CanvasToolId } from "../canvas/contract"
import { exportKimo, importKimo, patchFile, pickKimoFile, saveKimoFile } from "../lib/files"
import { createBus, isTyping } from "../lib/hooks"
import { Icon } from "../lib/icons"
import { useWebFonts } from "../lib/settings"
import { cssToken, useTheme } from "../lib/theme"
import { navigate } from "../router"
import { FloatingToolbar } from "./FloatingToolbar"
import { LeftPanel } from "./LeftPanel"
import { RightPanel } from "./RightPanel"
import { type FileSession, useFileSession, useSyncStatus } from "./session"
import { Topbar } from "./Topbar"

/** Image assets are not stored on web yet (image tool lands with the asset store): missing. */
const NO_ASSETS: AssetSource = { load: async () => null }
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
    }
  }, [mode])
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
    () => void saveKimoFile(exportKimo(session.store, name), name),
    [session.store, name],
  )
  const openFile = useCallback(async () => {
    const file = await pickKimoFile()
    if (!file) return
    try {
      navigate(`/file/${await importKimo(await file.text(), file.name)}`)
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
            assets={NO_ASSETS}
            fontSources={FONT_SOURCES}
            offlineFonts={!webFonts}
            overlayTheme={overlayTheme}
            onLayout={layout.set}
            onError={(e) =>
              console.warn("Kimo canvas:", e.kind === "op" ? e.message : e.error.message)
            }
          />
          <FloatingToolbar ui={session.ui} onActivate={activate} />
        </main>
        <RightPanel session={session} layout={layout} />
      </div>
    </div>
  )
}
