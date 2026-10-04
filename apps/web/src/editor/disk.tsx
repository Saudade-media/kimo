/**
 * Editor pieces for a `.kimo` on disk (ADR 0012 §4, boards 16–18): the document session's
 * conflict session, the desktop topbar (Topbar/Desktop XDqrb) with the File menu under the
 * breadcrumb's file name, and the deep-link node focus.
 */
import { basenameOf, dirnameOf } from "@kimo/platform"
import { type ReactNode, useCallback, useEffect, useSyncExternalStore } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import type { EditorConflictSession } from "../conflicts"
import { FileTopbar } from "../files"
import { isEdited, type SessionState, windowTitle } from "../platform/contract"
import type { FileDocumentSession } from "../platform/session"
import type { FileMenuActions } from "./FileMenu"
import { TopbarTrailing, useFileMenu } from "./Topbar"

const NO_SUBSCRIBE = () => () => {}

/**
 * The board 18 conflict session of `doc` while the file has stored conflicts (null otherwise,
 * and after "Mark resolved & save" removed them).
 */
export function useConflicts(doc: FileDocumentSession | null): EditorConflictSession | null {
  const subscribe = useCallback(
    (cb: () => void) => (doc ? doc.subscribe(() => cb()) : NO_SUBSCRIBE()),
    [doc],
  )
  return useSyncExternalStore(
    subscribe,
    () => (doc?.conflicts ?? null) as EditorConflictSession | null,
  )
}

export interface DiskTopbarProps extends FileMenuActions {
  doc: FileDocumentSession
  pageName: string
  ui: UiStore
  canvas: () => CanvasHandle | null
  onExport(): void
  onPreview(): void
  onHome(): void
  /** Board 21 Agent Presence (drag region, before Save Status). */
  presence?: ReactNode
}

/**
 * Board 16 f6gZ3 topbar: inset (or the k logo off macOS) · breadcrumb · branch · drag region ·
 * SaveStatus · trailing. The breadcrumb's file name opens the board 20 File menu (A1jsC).
 */
export function DiskTopbar({
  doc,
  pageName,
  ui,
  canvas,
  onExport,
  onPreview,
  onHome,
  presence,
  ...menu
}: DiskTopbarProps) {
  const fileMenu = useFileMenu(menu)
  return (
    <>
      <FileTopbar
        session={doc}
        page={pageName}
        fileOpen={fileMenu.open}
        onHome={onHome}
        onFileClick={(e) => fileMenu.toggle(e.currentTarget)}
        presence={presence}
        trailing={
          <TopbarTrailing ui={ui} canvas={canvas} onPreview={onPreview} onExport={onExport} />
        }
      />
      {fileMenu.menu}
    </>
  )
}

/** Selects and reveals `node` once the canvas has laid out (kimo://open?…&node=…). */
export function useFocusNode(
  node: string | null | undefined,
  ui: UiStore,
  canvas: { current: CanvasHandle | null },
): void {
  useEffect(() => {
    if (!node) return
    let raf = 0
    let tries = 0
    const go = () => {
      const c = canvas.current
      if (c?.layout()) {
        ui.getState().select([node])
        c.zoomToFit([node], 96)
        return
      }
      if (++tries < 600) raf = requestAnimationFrame(go)
    }
    raf = requestAnimationFrame(go)
    return () => cancelAnimationFrame(raf)
  }, [node, ui, canvas])
}

/** The folder named in the window title: the repository's, else the containing folder's. */
export function titleFolder(state: SessionState): string {
  return state.git?.repoRoot ? basenameOf(state.git.repoRoot) : basenameOf(dirnameOf(state.ref))
}

/**
 * Board 20 window title rule (G1gEPp) for the window showing `doc`: `<file> — <folder>`, the
 * macOS close-button dot through `setDocumentEdited`, "● … - Kimo" on Windows / Linux. Back to
 * "Kimo" when the editor closes (Home).
 */
export function useWindowTitle(doc: FileDocumentSession | null): void {
  useEffect(() => {
    if (!doc) return
    const win = doc.manager.platform.window
    const os = doc.manager.platform.os
    let title: string | null = null
    let edited: boolean | null = null
    const apply = (state: SessionState) => {
      const e = isEdited(state.saveStatus)
      const t = windowTitle({
        os,
        fileName: state.fileName,
        folder: titleFolder(state),
        untitled: doc.untitled,
        edited: e,
        readOnly: state.phase === "read-only" || state.phase === "failed-load",
      })
      if (t !== title) {
        title = t
        void win.setTitle(t).catch(() => {})
      }
      if (e !== edited) {
        edited = e
        void win.setDocumentEdited(e).catch(() => {})
      }
    }
    apply(doc.state())
    const off = doc.subscribe(apply)
    return () => {
      off()
      void win.setTitle(windowTitle({ os, fileName: null, folder: null })).catch(() => {})
      void win.setDocumentEdited(false).catch(() => {})
    }
  }, [doc])
}
