/**
 * Board 42 section 8 and rule "Test": reach, Kimo handshake, protocol, ownership, within 5 s in
 * all. Results: testing, ok (protocol and latency; the relay is this device's, claimed now or
 * already), unreachable, not a relay, too old (an older protocol), belongs to another Kimo
 * (ADR 0017). Save and use needs `ok`.
 */
import { MultiplayerError, normalizeRelayUrl, PROTOCOL, type RelayInfo } from "@kimo/sync/mp"
import type { RelayOwnerState } from "../ownership"

/** The whole test times out after this long. */
export const RELAY_SETUP_TEST_MS = 5000

export type CheckId = "reach" | "handshake" | "protocol" | "ownership"
export type CheckStatus = "pending" | "running" | "ok" | "failed" | "warning"

export interface RelayCheck {
  id: CheckId
  status: CheckStatus
  /** Mono meta at the row's end ("84 ms", "ok", "kimo-mp/1", "claimed by you", "not yours"). */
  meta: string | null
}

export type RelayTestOutcome =
  | "testing"
  | "ok"
  | "invalid"
  | "unreachable"
  | "not-a-relay"
  | "too-old"
  | "not-yours"

/** How the relay became this device's: claimed by this test, or already (pre-claimed). */
export type RelayOwnedHow = "claimed" | "already"

export interface RelaySetupTest {
  outcome: RelayTestOutcome
  /** The normalized relay URL (what Save and use stores), or the input when it does not parse. */
  url: string
  checks: RelayCheck[]
  /** Round trip of the handshake. */
  ms: number | null
  protocol: string | null
  /** On `ok`: whether this test claimed the relay or it was this device's already. */
  owned: RelayOwnedHow | null
  message: string | null
}

export interface RelayTestDeps {
  probe(url: string): Promise<RelayInfo>
  /** Whose the relay is, with this device's key (§16.9). */
  ownership(url: string): Promise<RelayOwnerState>
  /** Claims an unclaimed relay for this device (owner op 1). */
  claim(url: string): Promise<void>
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const CHECK_IDS: CheckId[] = ["reach", "handshake", "protocol", "ownership"]

export function pendingChecks(): RelayCheck[] {
  return CHECK_IDS.map((id) => ({ id, status: "pending", meta: null }))
}

/** The protocol an older relay named (`kimo-mp/0`), or null when it is not a too-old answer. */
export function olderProtocol(error: unknown): string | null {
  if (!(error instanceof MultiplayerError)) return null
  if (error.code === "PROTOCOL_MISMATCH") return "kimo-mp/0"
  if (error.code !== "NOT_A_RELAY") return null
  const m = /\(protocol (?:kimo-mp\/)?(\d+)\)/.exec(error.message)
  if (!m) return null
  return Number(m[1]) < 1 ? `kimo-mp/${m[1]}` : null
}

/** The status a not-a-relay server answered with ("404"), else "not a relay". */
export function notRelayMeta(error: unknown): string {
  const m = error instanceof Error ? /answered (\d{3})/.exec(error.message) : null
  return m ? (m[1] as string) : "not a relay"
}

class Timeout extends Error {}

/**
 * Runs the test, reporting each tick through `onUpdate`. Never throws: every failure is an
 * outcome. An unclaimed relay is claimed for this device on the Ownership line.
 */
export async function testRelaySetup(
  input: string,
  deps: RelayTestDeps,
  onUpdate: (state: RelaySetupTest) => void = () => {},
): Promise<RelaySetupTest> {
  let state: RelaySetupTest = {
    outcome: "testing",
    url: input.trim(),
    checks: pendingChecks(),
    ms: null,
    protocol: null,
    owned: null,
    message: null,
  }
  const set = (
    patch: Partial<RelaySetupTest>,
    checks?: Partial<Record<CheckId, Partial<RelayCheck>>>,
  ) => {
    state = {
      ...state,
      ...patch,
      checks: state.checks.map((c) => (checks?.[c.id] ? { ...c, ...checks[c.id] } : c)),
    }
    onUpdate(state)
    return state
  }
  let url: string
  try {
    url = normalizeRelayUrl(input)
  } catch (error) {
    return set(
      { outcome: "invalid", message: error instanceof Error ? error.message : String(error) },
      { reach: { status: "failed", meta: "not a relay URL" } },
    )
  }
  set({ url }, { reach: { status: "running" } })

  const started = deps.now()
  let handle: unknown = null
  const deadline = new Promise<never>((_, reject) => {
    handle = deps.setTimeout(() => reject(new Timeout("no answer within 5 s")), RELAY_SETUP_TEST_MS)
  })
  const race = <T>(p: Promise<T>) => Promise.race([p, deadline])
  try {
    let info: RelayInfo
    try {
      info = await race(deps.probe(url))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const old = olderProtocol(error)
      const ms = Math.max(0, deps.now() - started)
      if (old !== null)
        return set(
          { outcome: "too-old", ms, protocol: old, message },
          {
            reach: { status: "ok", meta: `${ms} ms` },
            handshake: { status: "ok", meta: "ok" },
            protocol: { status: "warning", meta: `${old} · needs ${PROTOCOL}` },
          },
        )
      if (error instanceof MultiplayerError && error.code === "NOT_A_RELAY")
        return set(
          { outcome: "not-a-relay", ms, message },
          {
            reach: { status: "ok", meta: `${ms} ms` },
            handshake: { status: "failed", meta: notRelayMeta(error) },
          },
        )
      return set(
        { outcome: "unreachable", message },
        {
          reach: {
            status: "failed",
            meta: error instanceof Timeout ? "no answer · 5 s" : "no answer",
          },
        },
      )
    }
    const ms = Math.max(0, deps.now() - started)
    set(
      { ms, protocol: info.protocol },
      {
        reach: { status: "ok", meta: `${ms} ms` },
        handshake: { status: "ok", meta: "ok" },
        protocol: { status: "ok", meta: info.protocol },
        ownership: { status: "running", meta: info.owner === "unclaimed" ? "claiming" : null },
      },
    )
    try {
      if (info.owner === "unclaimed") {
        try {
          await race(deps.claim(url))
          return set(
            { outcome: "ok", owned: "claimed" },
            { ownership: { status: "ok", meta: "claimed by you" } },
          )
        } catch (error) {
          // Someone claimed it between the probe and the claim: see whose it is now.
          if (!(error instanceof MultiplayerError && error.code === "RELAY_CLAIMED")) throw error
        }
      }
      const state = await race(deps.ownership(url))
      if (state === "yours")
        return set(
          { outcome: "ok", owned: "already" },
          { ownership: { status: "ok", meta: "yours" } },
        )
      if (state === "other")
        return set(
          { outcome: "not-yours", message: "This relay belongs to another Kimo" },
          { ownership: { status: "warning", meta: "not yours" } },
        )
      // Reset since the probe: claim it now.
      await race(deps.claim(url))
      return set(
        { outcome: "ok", owned: "claimed" },
        { ownership: { status: "ok", meta: "claimed by you" } },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return set(
        { outcome: "unreachable", message },
        {
          ownership: {
            status: "failed",
            meta: error instanceof Timeout ? "no answer · 5 s" : "no answer",
          },
        },
      )
    }
  } finally {
    deps.clearTimeout(handle)
  }
}
