/**
 * Agent area claims over presence (ADR 0016 item 16, docs/spec/multiplayer.md §15.11). The relay
 * is blind (it never sees node ids), so claims travel inside the sealed awareness state:
 *
 * - the local agents' claims ({@link ClaimRegistry.localRecords}) are published as
 *   `PresenceState.claims`, with `working` set to the union of their ids;
 * - every other peer's `claims` feed the registry (`setRemote`), which resolves simultaneous
 *   claims; a peer that leaves (or a closed connection) takes its claims with it.
 */
import type { ClaimRecord, ClaimRegistry } from "@kimo/editor-state"
import type { Awareness, PresenceState } from "./network"

export interface BindClaimsOptions {
  /**
   * Who this client is, for publishing claims before the app set any presence. Without it,
   * claims are published only once the app has set a local state.
   */
  user?: PresenceState["user"]
}

type LocalPresence = Omit<PresenceState, "origin">

/** Keeps `registry` and `awareness` in step. Returns the unbind function. */
export function bindClaimsToPresence(
  registry: ClaimRegistry,
  awareness: Awareness,
  options: BindClaimsOptions = {},
): () => void {
  let published = "[]"
  /** The `working` list this binding wrote (dropped again when the claims go). */
  let wroteWorking: string | null = null

  const publish = () => {
    const records = registry.localRecords()
    const cur = awareness.getLocalState()
    const key = JSON.stringify(records)
    if (cur && key === JSON.stringify(cur.claims ?? [])) {
      published = key
      return
    }
    if (!cur && records.length === 0) return
    let base: LocalPresence
    if (cur) {
      const { origin: _origin, ...rest } = cur
      base = rest
    } else if (options.user) base = { user: options.user }
    else return
    const { claims: _claims, ...next } = base as LocalPresence & { claims?: unknown }
    const state: LocalPresence = next
    if (records.length) {
      state.claims = records
      const working = [...new Set(records.flatMap((r) => r.ids))]
      state.working = working
      wroteWorking = JSON.stringify(working)
    } else if (wroteWorking !== null && JSON.stringify(state.working ?? null) === wroteWorking) {
      delete state.working
      wroteWorking = null
    }
    published = key
    awareness.setLocalState(state)
  }

  const feed = (peer: number) => {
    if (peer === awareness.clientId) return
    const s = awareness.getStates().get(peer)
    registry.setRemote(peer, (s?.claims ?? []) as ClaimRecord[])
  }

  const offRegistry = registry.subscribe(() => {
    if (JSON.stringify(registry.localRecords()) !== published) publish()
  })
  const offAwareness = awareness.onChange(({ added, updated, removed }) => {
    for (const peer of removed) if (peer !== awareness.clientId) registry.removePeer(peer)
    for (const peer of [...added, ...updated]) {
      // The app replaced our own state (cursor, selection): put the claims back.
      if (peer === awareness.clientId) publish()
      else feed(peer)
    }
  })
  for (const peer of awareness.getStates().keys()) feed(peer)
  publish()

  return () => {
    offRegistry()
    offAwareness()
    registry.clearRemote()
  }
}
