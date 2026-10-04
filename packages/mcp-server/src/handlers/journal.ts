/**
 * Per-store change journal: which node ids changed at which revision, for REVISION_CONFLICT
 * `detail.changed` (teardown 11.1). Unlike the op log it also sees updates that arrive from
 * windows (sync provider) and file reloads. Bounded; attached lazily per store.
 */
import type { DocStore, Revision } from "@kimo/editor-state"

const LIMIT = 2000

interface Entry {
  epoch: string
  seq: number
  nodes: string[]
  header: boolean
  origin: string
}

export class ChangeJournal {
  private readonly entries: Entry[] = []
  private readonly off: () => void

  constructor(readonly store: DocStore) {
    this.off = store.onChange((c) => {
      this.entries.push({
        epoch: c.revision.epoch,
        seq: c.revision.seq,
        nodes: [...c.nodes],
        header: c.header,
        origin: c.origin,
      })
      if (this.entries.length > LIMIT) this.entries.splice(0, this.entries.length - LIMIT)
    })
  }

  /** Node ids changed after `base` (null when unknown: another epoch or trimmed). */
  changedSince(base: Revision): { nodes: string[]; header: boolean } | null {
    const cur = this.store.revision
    if (base.epoch !== cur.epoch) return null
    const first = this.entries.find((e) => e.epoch === cur.epoch)
    if (base.seq < cur.seq && (!first || first.seq > base.seq + 1)) return null
    const nodes = new Set<string>()
    let header = false
    for (const e of this.entries)
      if (e.epoch === cur.epoch && e.seq > base.seq) {
        for (const n of e.nodes) nodes.add(n)
        header ||= e.header
      }
    return { nodes: [...nodes], header }
  }

  /** Origins of the changes after `base` (attribution in conflicts). */
  originsSince(base: Revision): string[] {
    return [
      ...new Set(
        this.entries.filter((e) => e.epoch === base.epoch && e.seq > base.seq).map((e) => e.origin),
      ),
    ]
  }

  dispose(): void {
    this.off()
  }
}

const journals = new WeakMap<DocStore, ChangeJournal>()

/** The journal of `store` (created on first use; hosts call it when they open a document). */
export function journalFor(store: DocStore): ChangeJournal {
  let j = journals.get(store)
  if (!j) {
    j = new ChangeJournal(store)
    journals.set(store, j)
  }
  return j
}
