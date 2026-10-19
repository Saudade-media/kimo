/**
 * Editor pieces for a `.kimo` on disk (ADR 0012 §4, boards 16–18): the document session's
 * conflict session, the desktop topbar (Topbar/Desktop XDqrb) with the File menu under the
 * breadcrumb's file name, and the deep-link node focus.
 */
import { basenameOf, dirnameOf } from "@kimo/platform"
import { type ReactNode, useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import type { EditorConflictSession } from "../conflicts"
import { FileTopbar } from "../files"
import { SaveStatusPill } from "../files/SaveStatusPill"
import { TopbarShare, TopbarSyncStatus } from "../multiplayer/ui/TopbarShare"
import { hasUnsavedChanges, isEdited, type SessionState, windowTitle } from "../platform/contract"
import type { FileDocumentSession } from "../platform/session"
import type { FileMenuActions } from "./FileMenu"
import { fitPage } from "./fit"
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
  /** Board 27 §9 (b): see `TopbarProps.previewTarget`. */
  previewTarget?: string | null
  onHome(): void
  /** Board 37 (E3): the folder crumb opens Home on that folder's section. */
  onHomeFolder?: (dir: string) => void
  /** Board 21 Agent Presence (drag region, before Save Status). */
  presence?: ReactNode
}

/**
 * Board 16 f6gZ3 topbar: inset (or the KimoLogo off macOS) · breadcrumb · branch · drag region ·
 * SaveStatus · trailing. The breadcrumb's file name opens the board 20 File menu (A1jsC).
 */
export function DiskTopbar({
  doc,
  pageName,
  ui,
  canvas,
  onExport,
  onPreview,
  previewTarget,
  onHome,
  onHomeFolder,
  presence,
  ...menu
}: DiskTopbarProps) {
  const fileMenu = useFileMenu({ ...menu, onHome })
  return (
    <>
      <FileTopbar
        session={doc}
        page={pageName}
        fileOpen={fileMenu.open}
        onHome={onHome}
        {...(onHomeFolder ? { onFolderClick: onHomeFolder } : {})}
        onFileClick={(e) => fileMenu.toggle(e.currentTarget)}
        presence={presence}
        // Board 41 §1/§2: sync status in the Save Status slot while shared, Share after Theme.
        status={<TopbarSyncStatus docKey={doc.ref} fallback={<SaveStatusPill session={doc} />} />}
        trailing={
          <TopbarTrailing
            ui={ui}
            canvas={canvas}
            onPreview={onPreview}
            onExport={onExport}
            previewTarget={previewTarget}
            share={
              <TopbarShare
                docKey={doc.ref}
                nodeName={(id) => {
                  const name = doc.store.getNode(id)?.name
                  return typeof name === "string" ? name : null
                }}
                onRevealNodes={(ids) => {
                  const live = ids.filter((id) => doc.store.getNode(id))
                  if (!live.length) return
                  ui.getState().select(live)
                  canvas()?.zoomToFit(live, 96)
                }}
              />
            }
          />
        }
      />
      {fileMenu.menu}
    </>
  )
}

/**
 * Once the canvas has laid out: selects and reveals `node` (kimo://open?…&node=…), or, when no
 * node is asked for, frames the page ({@link fitPage}) so a file never opens on empty canvas.
 */
export function useFocusNode(
  node: string | null | undefined,
  ui: UiStore,
  canvas: { current: CanvasHandle | null },
  roots: () => readonly string[] = () => [],
): void {
  // Read once, when the layout is ready: not a reason to fit again.
  const rootsRef = useRef(roots)
  rootsRef.current = roots
  useEffect(() => {
    let raf = 0
    let tries = 0
    const go = () => {
      const c = canvas.current
      const layout = c?.layout()
      // An empty first layout may still be filling in: give it a few frames before giving up.
      if (c && layout && (node || layout.nodes.size > 0 || tries > 30)) {
        if (node) {
          ui.getState().select([node])
          c.zoomToFit([node], 96)
        } else if (layout.nodes.size > 0) fitPage(c, ui, rootsRef.current())
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
 * "Kimo" when the editor closes (Home). In a browser tab (`os: "web"`) the board 24 (m) format
 * applies: `[●] {file} [· 2 conflicts | read-only | {agent} editing] — Kimo`.
 */
export function useWindowTitle(doc: FileDocumentSession | null, agent: string | null = null): void {
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
        // The web tab's ● means "not safe anywhere" (board 24 m), not "autosave pending".
        edited: os === "web" ? hasUnsavedChanges(state.saveStatus) : e,
        readOnly: state.phase === "read-only" || state.phase === "failed-load",
        conflicts: state.conflicts?.open ?? 0,
        agent,
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
  }, [doc, agent])
}
