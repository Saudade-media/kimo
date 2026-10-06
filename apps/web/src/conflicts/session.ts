/**
 * `ConflictSession` (contract, board 18) over a `DocStore`. Every pick computes the next
 * document with core-schema's reference functions (`applyConflictSide`, `applyAllConflicts`,
 * `finishMerge`) and applies the difference as ONE `store.apply` op group, so each choice is one
 * undo step, applies live on canvas, and syncs like any edit.
 */
import {
  applyAllConflicts,
  applyConflictSide,
  type Conflict,
  ConflictError,
  type ConflictSide,
  conflictCounts,
  finishMerge,
  isObject,
  type KimoDocument,
  type MergeInfo,
} from "@kimo/core-schema"
import type { DocStore, LocalOrigin } from "@kimo/editor-state"
import type { ConflictRowView, ConflictSession, Toast } from "../platform/contract"
import { diffOps } from "./ops"
import { conflictNode, conflictRows, displayName } from "./rows"

/** What a conflict session needs from its document session and the editor. */
export interface ConflictHost {
  store: DocStore
  /** Undo stack of the picks. Default `"user"`. */
  origin?: LocalOrigin
  /** For the `merge-saved` toast ("saved marketing.kimo"). */
  fileName?: string
  /** Writes the document (⌘S path of the document session). */
  save(): Promise<void>
  addToast?(toast: Toast): void
  /** Board 18 "Ready to commit" banner. */
  showMergeReady?(show?: boolean): void
  /** True while git still has MERGE_HEAD for the file's repository. */
  gitMerging?(): Promise<boolean>
  /** A pick the store refused (the shell may toast it). */
  onReject?(message: string): void
}

/** Editor hooks bound once the canvas is mounted ({@link EditorConflictSession.bindView}). */
export interface ConflictView {
  /** Selects the node (UI store). */
  select(nodeId: string): void
  /** Scrolls / zooms the canvas so the node is visible. */
  reveal(nodeId: string): void
}

/** The contract plus what the board 18 UI reads. */
export interface EditorConflictSession extends ConflictSession {
  /** Row focused by Next conflict / a marker click (the panel scrolls to it). */
  focused(): string | null
  /** Open rows per node id (layer markers, canvas markers). */
  openByNode(): ReadonlyMap<string, readonly ConflictRowView[]>
  fileName(): string
  /**
   * Layer path of a node, outermost first (["Pricing", "Cards", "Item 3"]): board 24 (l) "+N"
   * menu rows (middle-truncated "Pricing / … / Item 3").
   */
  layerPath(nodeId: string): string[]
  bindView(view: ConflictView | null): void
  destroy(): void
}

type Obj = Record<string, unknown>

/**
 * `doc` with conflict `id` open again (`resolved` back to its default, false). The body keeps
 * the applied side, so the row reopens on what the canvas shows.
 */
export function reopenConflict(doc: KimoDocument, id: string): KimoDocument {
  const d = doc as unknown as Obj
  const table = isObject(d.conflicts) ? (d.conflicts as Record<string, Conflict>) : undefined
  const c = table?.[id]
  if (!table || !c) throw new ConflictError("NOT_FOUND", `No conflict ${id}`, id)
  if (c.resolved !== true) return doc
  const { resolved: _resolved, ...open } = c as Conflict & { resolved?: boolean }
  return { ...d, conflicts: { ...table, [id]: open as Conflict } } as unknown as KimoDocument
}

const LABELS: Record<ConflictSide, string> = { ours: "ours", theirs: "theirs", base: "base" }

/** Creates the session for a store that holds stored conflicts (spec §21). */
export function createConflictSession(host: ConflictHost): EditorConflictSession {
  const { store } = host
  const origin = host.origin ?? "user"
  const listeners = new Set<() => void>()
  let view: ConflictView | null = null
  let focusedId: string | null = null
  let rowsCache: ConflictRowView[] | null = null
  let countsCache: { total: number; open: number; resolved: number } | null = null
  let byNodeCache: Map<string, ConflictRowView[]> | null = null
  /** Nodes whose changes can change a row's labels (conflict nodes and their parents). */
  let watched = new Set<string>()

  const header = () => store.toHeader() as Obj
  const table = (): Record<string, Conflict> | undefined => {
    const c = header().conflicts
    return isObject(c) ? (c as Record<string, Conflict>) : undefined
  }
  const invalidate = () => {
    rowsCache = null
    countsCache = null
    byNodeCache = null
  }
  const emit = () => {
    for (const l of [...listeners]) l()
  }
  const unsubscribe = store.onChange((change) => {
    let hit = change.header
    if (!hit) for (const id of change.nodes) if (watched.has(id)) hit = true
    if (!hit) return
    invalidate()
    emit()
  })

  const rows = (): ConflictRowView[] => {
    if (rowsCache) return rowsCache
    const t = table()
    rowsCache = conflictRows(t, store)
    const w = new Set<string>()
    for (const c of Object.values(t ?? {})) {
      const id = conflictNode(c)
      if (!id) continue
      w.add(id)
      const p = store.getNode(id)?.parent
      if (typeof p === "string") w.add(p)
    }
    watched = w
    return rowsCache
  }

  /** Why the last `commit` was rejected (A5: Mark resolved & save surfaces it). */
  let lastReject = ""
  const commit = (next: (doc: KimoDocument) => KimoDocument, label: string): boolean => {
    const doc = store.toDocument()
    let target: KimoDocument
    try {
      target = next(doc)
    } catch (e) {
      lastReject = e instanceof Error ? e.message : String(e)
      host.onReject?.(lastReject)
      return false
    }
    const ops = diffOps(doc, target)
    if (ops.length === 0) return true
    const r = store.apply({ op: "batch", ops }, { origin, label })
    if (!r.ok) {
      lastReject = r.errors.map((e) => e.message).join("; ")
      host.onReject?.(lastReject)
      return false
    }
    return true
  }

  const step = (dir: 1 | -1, fromId?: string): string | null => {
    const all = rows()
    if (!all.some((r) => !r.resolved)) return null
    const start = fromId ?? focusedId
    const at = start ? all.findIndex((r) => r.id === start) : -1
    const n = all.length
    for (let k = 1; k <= n; k++) {
      const i = at < 0 ? (dir === 1 ? k - 1 : n - k) : (((at + dir * k) % n) + n) % n
      const r = all[i] as ConflictRowView
      if (!r.resolved) return r.id
    }
    return null
  }

  const session: EditorConflictSession = {
    get info(): MergeInfo | null {
      const m = header().merge
      return isObject(m) ? (m as MergeInfo) : null
    },
    counts() {
      if (!countsCache) countsCache = conflictCounts({ conflicts: table() ?? {} })
      return countsCache
    },
    rows,
    choose(id, side) {
      commit((d) => applyConflictSide(d, id, side), `Take ${LABELS[side]}`)
    },
    chooseAll(side) {
      commit((d) => applyAllConflicts(d, side), `Take all ${LABELS[side]}`)
    },
    reopen(id) {
      commit((d) => reopenConflict(d, id), "Reopen conflict")
    },
    next: (fromId) => step(1, fromId),
    previous: (fromId) => step(-1, fromId),
    focus(id) {
      const row = rows().find((r) => r.id === id)
      if (!row) return
      focusedId = id
      if (row.nodeId && store.hasNode(row.nodeId) && view) {
        view.select(row.nodeId)
        view.reveal(row.nodeId)
      }
      emit()
    },
    async markResolvedAndSave() {
      const { open, total } = session.counts()
      if (open > 0) throw new ConflictError("OPEN_CONFLICTS", `${open} conflict(s) are still open`)
      // A5: a rejected finishMerge throws, so the panel shows "Couldn't save …" instead of a
      // dead click (onReject alone only reaches the console).
      if (!commit((d) => finishMerge(d), "Mark resolved"))
        throw new ConflictError("CANNOT_APPLY", lastReject || "The merge could not be finished")
      await host.save()
      host.addToast?.({ kind: "merge-saved", resolved: total, fileName: session.fileName() })
      if (host.gitMerging && (await host.gitMerging().catch(() => false)))
        host.showMergeReady?.(true)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    focused: () => focusedId,
    openByNode() {
      if (byNodeCache) return byNodeCache
      const m = new Map<string, ConflictRowView[]>()
      for (const r of rows()) {
        if (r.resolved || !r.nodeId) continue
        const list = m.get(r.nodeId)
        if (list) list.push(r)
        else m.set(r.nodeId, [r])
      }
      byNodeCache = m
      return m
    },
    fileName: () => host.fileName ?? "this file",
    layerPath(nodeId) {
      const out: string[] = []
      const seen = new Set<string>()
      for (let id: string | null = nodeId; id !== null && !seen.has(id); ) {
        seen.add(id)
        const n = store.getNode(id) as Obj | undefined
        if (!n) break
        out.unshift(displayName(n, store))
        id = typeof n.parent === "string" ? n.parent : null
      }
      return out
    },
    bindView(v) {
      view = v
    },
    destroy() {
      unsubscribe()
      listeners.clear()
    },
  }
  return session
}

/**
 * Structural view of `apps/web/src/platform/session.ts`'s `FileDocumentSession` (builder 2),
 * so this module does not depend on its internals.
 */
export interface DocumentSessionLike {
  readonly store: DocStore
  readonly fileName?: string
  readonly ref?: string
  save(): Promise<void>
  /** True while the last write failed and edits are unsaved (the save-failed banner). */
  readonly saveFailed?: boolean
  readonly failure?: { message: string } | null
  addToast?(toast: Toast): void
  showMergeReady?(show?: boolean): void
  readonly manager?: {
    readonly platform?: {
      readonly git?: {
        state(ref: string): Promise<{ operation: string | null } | null>
      }
    }
  }
}

/**
 * `SessionManagerOptions.createConflictSession` for the document session: one conflict
 * session per document while it has stored conflicts.
 */
export function conflictSessionFactory(
  options: { onReject?: (message: string) => void } = {},
): (session: DocumentSessionLike) => EditorConflictSession {
  return (s) => {
    const host: ConflictHost = {
      store: s.store,
      // E13: a failed write rejects (no "saved" toast; the panel says "Couldn't save …").
      save: async () => {
        await s.save()
        if (s.saveFailed) throw new Error(s.failure?.message ?? "The file wasn't written")
      },
      gitMerging: async () => {
        const git = s.manager?.platform?.git
        if (!git || !s.ref) return false
        const state = await git.state(s.ref)
        return state?.operation === "merge"
      },
    }
    if (s.fileName) host.fileName = s.fileName
    if (s.addToast) host.addToast = (t) => s.addToast?.(t)
    if (s.showMergeReady) host.showMergeReady = (v) => s.showMergeReady?.(v)
    if (options.onReject) host.onReject = options.onReject
    return createConflictSession(host)
  }
}
