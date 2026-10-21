/**
 * Board 42 rule "What Kimo stores": the relay URL (`multiplayer.relayUrl`), extra allowed origins,
 * where the relay runs and, for This computer, port, tunnel and hostname
 * (`multiplayer.relaySetup`). No secret: a relay belongs to this device's key (ADR 0017), which
 * lives in the keychain or IndexedDB (`../device-key`). Nothing about the relay is sent anywhere
 * else.
 */
import type { RelaySetupSetting, SettingsApi } from "@kimo/platform"
import type { Reach } from "./local"

export type RelayPath = "local" | "docker" | "fly" | "railway" | "existing"

export interface RelaySetupState {
  path: RelayPath | null
  extraOrigins: string[]
  local: { port: number; reach: Reach; hostname: string | null } | null
  /** A relay deployed on Fly.io; `byKimo` when Kimo ran the deploy with flyctl. */
  fly: { app: string; region: string; byKimo: boolean } | null
}

export const EMPTY_SETUP: RelaySetupState = Object.freeze({
  path: null,
  extraOrigins: [],
  local: null,
  fly: null,
}) as RelaySetupState

const PATHS: readonly RelayPath[] = ["local", "docker", "fly", "railway", "existing"]
const REACH: readonly Reach[] = ["lan", "quick", "named"]

/** Reads `multiplayer.relaySetup` leniently: unknown or invalid fields fall back. */
export function parseSetup(raw: RelaySetupSetting | null | undefined): RelaySetupState {
  if (!raw || typeof raw !== "object") return EMPTY_SETUP
  const str = (v: unknown) => (typeof v === "string" && v ? v : null)
  const path = PATHS.includes(raw.path as RelayPath) ? (raw.path as RelayPath) : null
  const extraOrigins = Array.isArray(raw.extraOrigins)
    ? raw.extraOrigins.filter((o): o is string => typeof o === "string" && o !== "").slice(0, 32)
    : []
  const l = raw.local
  const port = l && Number.isInteger(l.port) && (l.port as number) > 0 && (l.port as number) < 65536
  const local =
    l && typeof l === "object"
      ? {
          port: port ? (l.port as number) : 8787,
          reach: REACH.includes(l.reach as Reach) ? (l.reach as Reach) : "lan",
          hostname: str(l.hostname),
        }
      : null
  const f = raw.fly
  const fly =
    f && typeof f === "object" && str(f.app)
      ? { app: f.app as string, region: str(f.region) ?? "iad", byKimo: f.byKimo === true }
      : null
  return { path, extraOrigins, local, fly }
}

export function serializeSetup(state: RelaySetupState): RelaySetupSetting {
  return {
    path: state.path,
    extraOrigins: [...state.extraOrigins],
    local: state.local ? { ...state.local } : null,
    fly: state.fly ? { ...state.fly } : null,
  }
}

export interface RelaySetupStore {
  subscribe(listener: () => void): () => void
  getState(): RelaySetupState
  update(patch: Partial<RelaySetupState>): Promise<void>
  /** Save and use: the wizard's choices. */
  save(input: { patch: Partial<RelaySetupState> }): Promise<void>
}

export function createRelaySetupStore(deps: { settings: SettingsApi | null }): RelaySetupStore {
  const { settings } = deps
  const listeners = new Set<() => void>()
  let memory: RelaySetupState = EMPTY_SETUP
  let cached: { raw: unknown; state: RelaySetupState } | null = null
  const read = (): RelaySetupState => {
    if (!settings) return memory
    const raw = settings.get("multiplayer.relaySetup")
    if (cached && cached.raw === raw) return cached.state
    cached = { raw, state: parseSetup(raw) }
    return cached.state
  }
  const emit = () => {
    for (const l of [...listeners]) l()
  }
  const off = settings?.onChange((key) => {
    if (key === "multiplayer.relaySetup") emit()
  })
  void off
  const store: RelaySetupStore = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: read,
    async update(patch) {
      const next = { ...read(), ...patch }
      if (settings) await settings.set("multiplayer.relaySetup", serializeSetup(next))
      else {
        memory = next
        emit()
      }
    },
    async save({ patch }) {
      await store.update(patch)
    },
  }
  return store
}
