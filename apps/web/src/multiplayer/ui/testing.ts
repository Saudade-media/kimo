/**
 * A scriptable in-memory {@link ShareBackend} for the board 41 share UI tests and the e2e harness:
 * per-key snapshots set by hand, links kept in memory, failures on demand. No network, no timers
 * beyond what the model schedules.
 */
import type { PresenceState } from "@kimo/sync"
import type { RelayInfo } from "@kimo/sync/mp"
import { MultiplayerError } from "@kimo/sync/mp"
import { emptySnapshot, type PeerSnapshot, type ShareBackend, type ShareSnapshot } from "../backend"
import type { IssuedLink } from "../registry"

export interface FakeShareBackend {
  backend: ShareBackend
  calls: string[]
  /** Replaces part of a key's snapshot and notifies. */
  set(key: string, patch: Partial<ShareSnapshot>): void
  /** Seeds the issued links of a key. */
  setLinks(key: string, links: IssuedLink[]): void
  /** The next mint / revoke / reset / start / stop rejects with this error. */
  failNext(op: "mint" | "revoke" | "reset" | "start" | "stop", error: Error): void
}

export function createFakeShareBackend(): FakeShareBackend {
  const snaps = new Map<string, ShareSnapshot>()
  const listeners = new Map<string, Set<() => void>>()
  const links = new Map<string, IssuedLink[]>()
  const failures = new Map<string, Error>()
  const calls: string[] = []
  let serial = 0
  const snap = (key: string) => snaps.get(key) ?? emptySnapshot(key)
  const notify = (key: string) => {
    for (const l of [...(listeners.get(key) ?? [])]) l()
  }
  const fail = (op: string) => {
    const e = failures.get(op)
    if (e) {
      failures.delete(op)
      throw e
    }
  }
  const backend: ShareBackend = {
    snapshot: snap,
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set<() => void>()
      listeners.set(key, set)
      set.add(listener)
      return () => set.delete(listener)
    },
    async start(key, options) {
      calls.push(`start:${key}:${options?.relayUrl ?? ""}`)
      fail("start")
      snaps.set(key, {
        ...snap(key),
        room: `room-${key}`,
        relayUrl: options?.relayUrl ?? null,
        owner: true,
        role: "edit",
        status: "synced",
        self: 1,
      })
      notify(key)
    },
    async stop(key) {
      calls.push(`stop:${key}`)
      fail("stop")
      snaps.set(key, emptySnapshot(key))
      links.delete(key)
      notify(key)
      return { relayNotified: true }
    },
    links: async (key) => links.get(key) ?? [],
    async mintLink(key, options) {
      calls.push(`mint:${key}:${options.role}:${options.ttlSeconds}`)
      fail("mint")
      const now = Math.floor(Date.now() / 1000)
      const n = ++serial
      const link: IssuedLink = {
        jti: `j${n}`,
        role: options.role,
        exp: options.ttlSeconds === null ? 0 : now + options.ttlSeconds,
        iat: now,
        kid: 1,
        origin: "user",
        revoked: false,
        link: `https://kimo.test/join?r=${n}#key-${n}`,
      }
      links.set(key, [...(links.get(key) ?? []), link])
      return link
    },
    async revokeLink(key, jti) {
      calls.push(`revoke:${key}:${jti}`)
      fail("revoke")
      links.set(
        key,
        (links.get(key) ?? []).map((l) => (l.jti === jti ? { ...l, revoked: true } : l)),
      )
    },
    async resetAllLinks(key) {
      calls.push(`reset:${key}`)
      fail("reset")
      links.set(
        key,
        (links.get(key) ?? []).map((l) => ({ ...l, revoked: true })),
      )
      return { kid: 2 }
    },
    setPresence: (key) => calls.push(`presence:${key}`),
    ensureAsset: async () => true,
    resumeAgent: (key, holder) => calls.push(`resume:${key}:${holder}`),
    stopAgent: (key, holder) => calls.push(`stopAgent:${key}:${holder}`),
  }
  return {
    backend,
    calls,
    set(key, patch) {
      snaps.set(key, { ...snap(key), ...patch })
      notify(key)
    },
    setLinks(key, next) {
      links.set(key, next)
    },
    failNext(op, error) {
      failures.set(op, error)
    },
  }
}

/** A person's presence. */
export const presenceOf = (
  id: string,
  name: string,
  color: string,
  extra: Partial<PresenceState> = {},
): PresenceState => ({ user: { id, name, color }, origin: "user", ...extra })

/** A peer in the room. */
export const peerOf = (
  peer: number,
  state: PresenceState | null,
  options: { role?: "view" | "edit"; changedAt?: number; origin?: string } = {},
): PeerSnapshot => ({
  peer,
  role: options.role ?? "edit",
  origin: options.origin ?? "user",
  state,
  changedAt: options.changedAt ?? Date.now(),
})

/** A link issued `ageSeconds` ago that expires in `ttlSeconds` (null: never). */
export function issuedLink(
  jti: string,
  role: "view" | "edit",
  ttlSeconds: number | null,
  nowMs = Date.now(),
): IssuedLink {
  const now = Math.floor(nowMs / 1000)
  return {
    jti,
    role,
    exp: ttlSeconds === null ? 0 : now + ttlSeconds,
    iat: now - 60,
    kid: 1,
    origin: "user",
    revoked: false,
    link: `https://kimo.test/join?r=${jti}#key-${jti}`,
  }
}

/** How a fake relay answers: a version, an error code, or never (`pending`). */
export interface FakeRelayAnswer {
  version?: string
  protocol?: string
  /** Whose the relay is (ADR 0017). Default `claimed`. */
  owner?: "unclaimed" | "claimed"
  code?: string
  message?: string
  pending?: boolean
  delayMs?: number
}

/**
 * A relay probe: the first answer whose key is a substring of the URL (else the first one)
 * answers as Kimo relay `version`, fails with `code`, or never answers.
 */
export function fakeProbe(
  answers: Record<string, FakeRelayAnswer>,
): (url: string) => Promise<RelayInfo> {
  return async (url) => {
    const hit = Object.entries(answers).find(([k]) => url.includes(k))
    const a = hit?.[1] ?? Object.values(answers)[0] ?? {}
    if (a.pending) return new Promise<RelayInfo>(() => {})
    if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs))
    if (a.code) throw new MultiplayerError(a.code as never, a.message ?? a.code)
    return {
      relayUrl: url,
      name: "kimo-relay",
      version: a.version ?? "1.2",
      protocol: a.protocol ?? "kimo-mp/1",
      relayId: new Uint8Array(16),
      owner: a.owner ?? "claimed",
    } as unknown as RelayInfo
  }
}

/** Node names of the board 41 file (claims show "editing Hero Image"). */
export const BOARD41_NODES: Readonly<Record<string, string>> = {
  hero: "Hero Image",
  pricing: "Pricing",
}

/**
 * Board 41's file as the owner Gui sees it (sections 1, 2 C, 3 C, 6 B): Maya (clay, edit, her
 * agent Sol on Pricing), Jonas (pine, edit, idle), Ana (ochre, view), Lea (plum, view), an
 * unnamed guest (slate, view) and Gui's agent Kimo on Hero Image.
 */
export function board41Snapshot(
  now = Date.now(),
  options: { others?: number } = {},
): Partial<ShareSnapshot> {
  const claim = (holder: string, label: string, ids: string[]) => ({
    holder,
    label,
    ids,
    since: now - 60_000,
    renewed: now,
  })
  const others: PeerSnapshot[] = [
    peerOf(
      2,
      presenceOf("u-maya", "Maya Rossi", "presence-clay", {
        claims: [claim("agent:sol", "Sol", ["pricing"])],
      }),
      { changedAt: now },
    ),
    peerOf(3, presenceOf("u-jonas", "Jonas Tan", "presence-pine"), { changedAt: now - 120_000 }),
    peerOf(4, presenceOf("u-ana", "Ana Lima", "presence-ochre"), { role: "view", changedAt: now }),
    peerOf(5, presenceOf("u-lea", "Lea Berg", "presence-plum"), { role: "view", changedAt: now }),
    peerOf(6, presenceOf("u-guest", "", "presence-slate"), { role: "view", changedAt: now }),
  ].slice(0, options.others ?? 5)
  return {
    room: "room-board41",
    relayUrl: "wss://relay.maya.studio",
    owner: true,
    role: "edit",
    status: "synced",
    self: 1,
    selfState: presenceOf("u-gui", "Gui Rodrigues", "presence-graphite", { owner: true }),
    peers: others,
    claims: [
      {
        ...claim("agent:kimo", "Kimo", ["hero"]),
        local: true,
        expiresAt: now + 600_000,
        state: "live",
      },
    ],
  }
}
