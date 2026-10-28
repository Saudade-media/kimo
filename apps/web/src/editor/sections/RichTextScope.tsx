/**
 * Board 30 "Rich text": scopes the Text and Fill sections to character ranges. While a text is
 * being edited they show and change the editor's selection; a text with runs selected on the
 * canvas shows "Mixed" where its runs differ and changes every run (see
 * `canvas/rich-text/panel-bridge.ts`).
 */
import { type ReactNode, useMemo, useSyncExternalStore } from "react"
import { richSelection, translateOps } from "../../canvas/rich-text/panel-bridge"
import {
  currentTextSession,
  type RichTextSession,
  subscribeTextSession,
} from "../../canvas/rich-text/session"
import type { Editor } from "../fields"
import { PanelContext, type Sel, usePanel } from "../panel-context"

/** The live text edit of this file's canvas (null when not editing). */
function useTextSession(): RichTextSession | null {
  const { session } = usePanel()
  const ui = session.ui
  const live = useSyncExternalStore(
    (cb) => subscribeTextSession(ui, cb),
    () => currentTextSession(ui),
  )
  // Re-render on every change of the edit (selection moves, style changes, typing).
  useSyncExternalStore(
    (cb) => (live ? live.subscribe(cb) : () => {}),
    () => live?.version ?? 0,
  )
  return live
}

export function RichTextScope({
  sel,
  children,
}: {
  sel: readonly Sel[]
  children: (sel: readonly Sel[], editing: RichTextSession | null) => ReactNode
}) {
  const ctx = usePanel()
  const live = useTextSession()
  const version = live?.version ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-derives the groups
  const view = useMemo(() => richSelection(sel, live), [sel, live, version])
  const editor = useMemo<Editor | null>(() => {
    if (!view) return null
    const base = ctx.editor
    return {
      apply(ops, label) {
        const header = ctx.session.store.toHeader()
        const out = translateOps(
          ops,
          view,
          (id) => ctx.session.store.getNode(id),
          live,
          (header.features ?? []) as readonly string[],
        )
        if (out.length) base.apply(out, label)
      },
      begin: () => base.begin(),
      end: () => base.end(),
      get active() {
        return base.active
      },
    }
  }, [view, ctx.editor, ctx.session, live])
  const editing = live?.nodeId && sel.some((s) => s.id === live.nodeId) ? live : null
  if (!view || !editor) return <>{children(sel, editing)}</>
  return (
    <PanelContext.Provider value={{ ...ctx, editor }}>
      {children(view as Sel[], editing)}
    </PanelContext.Provider>
  )
}
