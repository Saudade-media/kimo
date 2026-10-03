/**
 * Editor pieces for a `.kimo` on disk (ADR 0012 §4, boards 16–18): the document session's
 * conflict session, the desktop topbar (Topbar/Desktop XDqrb) with the File menu under the
 * breadcrumb's file name, and the deep-link node focus.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import type { CanvasHandle, UiStore } from "../canvas/contract"
import type { EditorConflictSession } from "../conflicts"
import { FileTopbar } from "../files"
import type { FileDocumentSession } from "../platform/session"
import { AnchoredMenu, type FileMenuActions, FileMenuItems, TopbarTrailing } from "./Topbar"

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
}

/** Board 16 f6gZ3 topbar: inset · breadcrumb · branch · drag region · SaveStatus · trailing. */
export function DiskTopbar({
  doc,
  pageName,
  ui,
  canvas,
  onExport,
  onPreview,
  ...menu
}: DiskTopbarProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return (
    <>
      <FileTopbar
        session={doc}
        page={pageName}
        onFileClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAnchor((a) => (a ? null : r))
        }}
        trailing={
          <TopbarTrailing ui={ui} canvas={canvas} onPreview={onPreview} onExport={onExport} />
        }
      />
      {anchor && (
        <AnchoredMenu anchor={anchor} label="File" onClose={() => setAnchor(null)}>
          <FileMenuItems {...menu} />
        </AnchoredMenu>
      )}
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
