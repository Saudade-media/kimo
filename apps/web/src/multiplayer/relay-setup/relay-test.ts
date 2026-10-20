/**
 * Board 42 section 8 and rule "Test": reach, Kimo handshake, protocol, create secret, within 5 s
 * in all. Results: testing, ok (protocol and latency), unreachable, not a relay, too old (an older
 * protocol), secret rejected. Save and use needs `ok`.
 */
import { MultiplayerError, normalizeRelayUrl, PROTOCOL, type RelayInfo } from "@kimo/sync/mp"

/** The whole test times out after this long. */
export const RELAY_SETUP_TEST_MS = 5000

export type CheckId = "reach" | "handshake" | "protocol" | "secret"
export type CheckStatus = "pending" | "running" | "ok" | "failed" | "warning"

export interface RelayCheck {
  id: CheckId
  status: CheckStatus
  /** Mono meta at the row's end ("84 ms", "ok", "kimo-mp/1", "accepted", "rejected · 403"). */
  meta: string | null
}

export type RelayTestOutcome =
  | "testing"
  | "ok"
  | "invalid"
  | "unreachable"
  | "not-a-relay"
  | "too-old"
  | "secret-rejected"

export interface RelaySetupTest {
  outcome: RelayTestOutcome
  /** The normalized relay URL (what Save and use stores), or the input when it does not parse. */
  url: string
  checks: RelayCheck[]
  /** Round trip of the handshake. */
  ms: number | null
  protocol: string | null
  /** What `/version` said; null until it answered. */
  createSecretRequired: boolean | null
  message: string | null
}

export interface RelayTestDeps {
  probe(url: string): Promise<RelayInfo>
  /** `POST /create-secret/check`; null for a relay without the route. */
  checkSecret(url: string, secret: string | null): Promise<{ required: boolean } | null>
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const CHECK_IDS: CheckId[] = ["reach", "handshake", "protocol", "secret"]

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
 * outcome. `secret` is what Kimo would send (null: no secret).
 */
export async function testRelaySetup(
  input: string,
  secret: string | null,
  deps: RelayTestDeps,
  onUpdate: (state: RelaySetupTest) => void = () => {},
): Promise<RelaySetupTest> {
  let state: RelaySetupTest = {
    outcome: "testing",
    url: input.trim(),
    checks: pendingChecks(),
    ms: null,
    protocol: null,
    createSecretRequired: null,
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
      { ms, protocol: info.protocol, createSecretRequired: info.createSecretRequired },
      {
        reach: { status: "ok", meta: `${ms} ms` },
        handshake: { status: "ok", meta: "ok" },
        protocol: { status: "ok", meta: info.protocol },
        secret: { status: "running" },
      },
    )
    try {
      const answer = await race(deps.checkSecret(url, secret))
      const meta = answer === null ? "not checked" : answer.required ? "accepted" : "not needed"
      return set({ outcome: "ok" }, { secret: { status: "ok", meta } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof MultiplayerError && error.code === "CREATE_FORBIDDEN")
        return set(
          { outcome: "secret-rejected", createSecretRequired: true, message },
          { secret: { status: "failed", meta: "rejected · 403" } },
        )
      return set(
        { outcome: "unreachable", message },
        {
          secret: {
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
