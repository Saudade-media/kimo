/**
 * Editor pieces for a `.kimo` on disk (ADR 0012 §4, boards 16–18): the document session's
 * conflict session, the save status of the left card header (board 44, replacing board 16's
 * desktop topbar), and the deep-link node focus.
 */
import { basenameOf, dirnameOf } from "@kimo/platform"
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import type { EditorConflictSession } from "../conflicts"
import { useSessionState } from "../files/hooks"
import { SaveStatusPill } from "../files/SaveStatusPill"
import { TopbarSyncStatus } from "../multiplayer/ui/TopbarShare"
import { hasUnsavedChanges, isEdited, type SessionState, windowTitle } from "../platform/contract"
import type { FileDocumentSession } from "../platform/session"
import { LeftCardHeader, type LeftCardHeaderProps } from "./CardHeaders"
import { fitPage } from "./fit"

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

/** The file name and save status kind of `doc` (the left card header's). */
function useDiskHeaderState(doc: FileDocumentSession): {
  fileName: string
  saveStatus: string
} {
  const state = useSessionState(doc)
  return { fileName: state.fileName, saveStatus: state.saveStatus.kind }
}

/**
 * Board 44: the Save Status pill (XDqrb > Oxn3z, with its tooltip and Locked popover) in the
 * left card header, only while it needs attention: nothing while the file is saved to disk.
 */
function DiskSaveStatus({ doc }: { doc: FileDocumentSession }) {
  const { saveStatus } = useDiskHeaderState(doc)
  return saveStatus === "saved" ? null : <SaveStatusPill session={doc} />
}

/**
 * Board 44 Left Card header for a file on disk: its file name and, in the status slot, the
 * shared file's sync status (board 41 §2) or else the Save Status pill, each only while it
 * needs attention.
 */
export function DiskLeftCardHeader({
  doc,
  ...props
}: Omit<LeftCardHeaderProps, "fileName" | "saveStatus" | "status"> & { doc: FileDocumentSession }) {
  const { fileName, saveStatus } = useDiskHeaderState(doc)
  return (
    <LeftCardHeader
      {...props}
      fileName={fileName}
      saveStatus={saveStatus}
      status={
        <TopbarSyncStatus
          docKey={doc.ref}
          quietWhenSynced
          fallback={<DiskSaveStatus doc={doc} />}
        />
      }
    />
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
function titleFolder(state: SessionState): string {
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
