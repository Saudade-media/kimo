/**
 * Remote carets and selections inside text layers (live text, ADR 0016 item 17). The visuals are
 * a later design pass; this module is their data:
 *
 * - {@link localTextPresence}: what this client publishes (`PresenceState.text`) while a person
 *   edits a text layer live: the node and the anchor and focus as opaque positions that follow
 *   edits (`DocStore.encodeTextPosition`).
 * - {@link remoteTextCarets}: every other person's (and own-link agent's) caret and selection in
 *   one text node as absolute offsets of the text as this client holds it now
 *   (`DocStore.resolveTextPosition`), so they move as anyone types.
 * - {@link useRemoteTextCarets}: the same as a React hook, updated on presence changes and on
 *   changes of the node.
 */
import type { DocStore } from "@kimo/editor-state"
import type { TextPresence } from "@kimo/sync"
import { useCallback, useRef, useSyncExternalStore } from "react"
import type { RichTextSession } from "../canvas/rich-text/session"
import type { DocumentShareView, MultiplayerModel } from "./model"
import type { PresenceColor } from "./presence"

/** One remote caret (or selection) in a text layer. */
export interface RemoteTextCaret {
  /** Stable key: `peer:<n>` for a person, the holder for an agent. */
  key: string
  kind: "person" | "agent"
  /** Relay peer id of a person; null for an agent. */
  peer: number | null
  /** Display label ("Ana", "Guest 2", an agent's name). */
  label: string
  /** A person's presence color token; null for an agent (agents use the agent hue). */
  color: PresenceColor | null
  /** Offsets in the text (UTF-16): equal for a caret; `focus` is where the caret is. */
  anchor: number
  focus: number
  /** True when the person is idle (cosmetic, like their pointer). */
  idle: boolean
}

/**
 * The text presence of a live edit, or null (not editing, not live). Pending typing is written
 * first so the positions name characters the document already has.
 */
export function localTextPresence(
  session: RichTextSession | null,
  store: DocStore,
): TextPresence | null {
  if (!session?.live || !session.nodeId) return null
  session.flush()
  const anchor = store.encodeTextPosition(session.nodeId, session.sel.anchor)
  const focus = store.encodeTextPosition(session.nodeId, session.sel.focus)
  return anchor && focus ? { node: session.nodeId, anchor, focus } : null
}

/** Every other collaborator's caret in text node `nodeId`, resolved against `store`. */
export function remoteTextCarets(
  view: Pick<DocumentShareView, "people" | "agents">,
  store: Pick<DocStore, "resolveTextPosition">,
  nodeId: string,
): RemoteTextCaret[] {
  const out: RemoteTextCaret[] = []
  const resolve = (t: TextPresence | null | undefined) => {
    if (!t || t.node !== nodeId) return null
    const anchor = store.resolveTextPosition(nodeId, t.anchor)
    const focus = store.resolveTextPosition(nodeId, t.focus)
    return anchor === null || focus === null ? null : { anchor, focus }
  }
  for (const p of view.people) {
    if (p.isYou) continue
    const at = resolve(p.text)
    if (at)
      out.push({
        key: `peer:${p.peer}`,
        kind: "person",
        peer: p.peer,
        label: p.label,
        color: p.color,
        idle: p.idle,
        ...at,
      })
  }
  for (const a of view.agents) {
    if (a.isYours) continue
    const at = resolve(a.text)
    if (at)
      out.push({
        key: a.holder,
        kind: "agent",
        peer: null,
        label: a.label,
        color: null,
        idle: false,
        ...at,
      })
  }
  return out
}

const sameCarets = (a: readonly RemoteTextCaret[], b: readonly RemoteTextCaret[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i] as RemoteTextCaret
    return (
      x.key === y.key &&
      x.anchor === y.anchor &&
      x.focus === y.focus &&
      x.label === y.label &&
      x.color === y.color &&
      x.idle === y.idle
    )
  })

const NONE: readonly RemoteTextCaret[] = Object.freeze([])

/**
 * Remote carets in text node `nodeId` of document `key` (null node or model: none). The array
 * keeps its identity while nothing changed.
 */
export function useRemoteTextCarets(
  model: MultiplayerModel | null,
  key: string,
  store: DocStore,
  nodeId: string | null,
): readonly RemoteTextCaret[] {
  const last = useRef<readonly RemoteTextCaret[]>(NONE)
  const subscribe = useCallback(
    (l: () => void) => {
      if (!model || !nodeId) return () => {}
      const doc = model.document(key)
      const offDoc = doc.subscribe(l)
      const offStore = store.onChange((c) => {
        if (c.nodes.has(nodeId)) l()
      })
      return () => {
        offDoc()
        offStore()
      }
    },
    [model, key, store, nodeId],
  )
  const get = useCallback(() => {
    if (!model || !nodeId) return NONE
    const next = remoteTextCarets(model.document(key).getState(), store, nodeId)
    if (sameCarets(next, last.current)) return last.current
    last.current = next.length ? next : NONE
    return last.current
  }, [model, key, store, nodeId])
  return useSyncExternalStore(subscribe, get, get)
}
