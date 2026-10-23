/**
 * Live text (ADR 0016 item 17): the link between an inline text edit ({@link RichTextSession})
 * and the document. The session keeps its runs (effective attributes) and writes them through
 * here every ~50 ms as character edits (`DocStore.editText`), so other people see the typing as it
 * happens and their typing merges with it; changes made by anyone else come back as deltas the
 * session applies to its live contenteditable.
 *
 * Writing goes through the same canonical form as the old commit-on-exit (`toNodePatch`): the
 * content's spans become character edits (the minimal diff, the caret placing it among repeated
 * characters) and the node's own `style` / `fill` (attributes every run agrees on) ride in the
 * same op group, with the `text/runs` feature when spans appear.
 */
import {
  type DocStore,
  diffTextRuns,
  type LocalOrigin,
  type Op,
  type TextDelta,
  textRunsOf,
} from "@kimo/editor-state"
import { type Run, runsOf, same, type TextNodeLike, toNodePatch } from "./model"

/** What the session needs from the document while it edits one text layer live. */
export interface LiveTextLink {
  readonly nodeId: string
  /** The node's runs and data now; null when it lost its text (deleted, bound to a variable). */
  read(): { runs: Run[]; node: TextNodeLike } | null
  /** Writes `runs` (one op group). False when the document refused it. */
  write(runs: readonly Run[], caret: number): boolean
  /** The edit's own undo (this person's steps only). */
  breakStep(): void
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Undoes / redoes the latest own step; the deltas it made, or null when nothing changed. */
  undo(): TextDelta[] | null
  redo(): TextDelta[] | null
  /**
   * Changes of the node by anyone else (people, agents, the panel's paragraph edits), once per
   * transaction: the character deltas in order (empty: only attributes or node fields changed),
   * or null when the content was replaced as a whole.
   */
  onRemote(cb: (deltas: TextDelta[] | null) => void): () => void
  /** Runs before any other change of the document starts (write pending edits first). */
  onBeforeChange(cb: () => void): () => void
  /** Ends the edit: everything it wrote is one undo step ("Edit text"). Idempotent. */
  end(): void
}

const isRef = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "$ref" in v

/**
 * Opens a live edit of text node `id` by `origin`, or null when the node cannot be edited live
 * (missing, not a text layer, bound content).
 */
export function createLiveText(
  store: DocStore,
  id: string,
  origin: LocalOrigin,
  label = "Edit text",
): LiveTextLink | null {
  const first = store.getNode(id)
  if (first?.type !== "text" || isRef(first.content) || !store.textRuns(id)) return null
  const handle = store.beginTextEdit(id, origin)
  /** Depth of our own writes / undos: their events are not remote. */
  let own = 0
  let ownDeltas: TextDelta[] = []
  let pending: TextDelta[] | null = []
  let replaced = false
  const remote = new Set<(deltas: TextDelta[] | null) => void>()
  const offs: (() => void)[] = []
  offs.push(
    store.onTextChange((e) => {
      if (e.id !== id) return
      if (own > 0) {
        if (e.delta) ownDeltas.push(e.delta)
        return
      }
      if (e.delta === null) replaced = true
      else pending?.push(e.delta)
    }),
    store.onChange((c) => {
      if (own > 0 || !c.nodes.has(id)) return
      const deltas = replaced ? null : (pending ?? [])
      pending = []
      replaced = false
      for (const cb of [...remote]) cb(deltas)
    }),
  )
  let ended = false

  const ownly = <T>(fn: () => T): T => {
    own++
    try {
      return fn()
    } finally {
      own--
    }
  }

  const replay = (kind: "undo" | "redo"): TextDelta[] | null => {
    if (ended) return null
    ownDeltas = []
    const changed = ownly(() => (kind === "undo" ? handle.undo() : handle.redo()))
    const out = ownDeltas
    ownDeltas = []
    return changed ? out : null
  }

  return {
    nodeId: id,
    read() {
      const node = store.getNode(id)
      if (node?.type !== "text" || isRef(node.content)) return null
      return { runs: runsOf(node), node }
    },
    write(runs, caret) {
      if (ended) return false
      const node = store.getNode(id)
      const from = store.textRuns(id)
      if (!node || !from) return false
      const p = toNodePatch(runs, node)
      const to = textRunsOf(p.content)
      if (!to) return false
      const edits = diffTextRuns(from, to, caret)
      const extra: Op[] = []
      const set: Record<string, unknown> = {}
      const unset: string[] = []
      if (!same(p.style ?? null, node.style ?? null)) {
        if (p.style) set.style = p.style
        else unset.push("style")
      }
      if (!same(p.fill ?? null, node.fill ?? null)) {
        if (p.fill !== undefined) set.fill = p.fill
        else unset.push("fill")
      }
      if (Object.keys(set).length || unset.length)
        extra.push({
          op: "update",
          id,
          ...(Object.keys(set).length ? { set } : {}),
          ...(unset.length ? { unset } : {}),
        } as Op)
      if (p.runs) {
        const have = (store.toHeader().features ?? []) as readonly string[]
        if (!have.includes("text/runs"))
          extra.unshift({
            op: "setHeader",
            set: { features: [...have, "text/runs"].sort() },
          } as Op)
      }
      if (!edits.length && !extra.length) return true
      const r = ownly(() => store.editText(id, edits, { origin, label, with: extra }))
      return r.ok
    },
    breakStep: () => handle.breakStep(),
    get canUndo() {
      return !ended && handle.canUndo
    },
    get canRedo() {
      return !ended && handle.canRedo
    },
    undo: () => replay("undo"),
    redo: () => replay("redo"),
    onRemote(cb) {
      remote.add(cb)
      return () => remote.delete(cb)
    },
    onBeforeChange: (cb) =>
      store.onBeforeChange(() => {
        if (own === 0) cb()
      }),
    end() {
      if (ended) return
      ended = true
      for (const off of offs) off()
      remote.clear()
      handle.end()
    },
  }
}

/** Where the caret goes after an undo or redo: after the last change its deltas made. */
export function caretAfter(deltas: readonly TextDelta[], fallback: number): number {
  let caret: number | null = null
  for (const delta of deltas) {
    let index = 0
    let last: number | null = null
    for (const d of delta) {
      if ("retain" in d) index += d.retain
      else if ("insert" in d) {
        index += d.insert.length
        last = index
      } else last = index
    }
    if (last !== null) caret = last
  }
  return caret ?? fallback
}
