/**
 * Board 42 rule "What Kimo stores": the relay URL (`multiplayer.relayUrl`), the secret's mode,
 * extra allowed origins, where the relay runs and, for This computer, port, tunnel and hostname
 * (`multiplayer.relaySetup`), and the secret itself in the keychain or browser storage. Nothing
 * about the relay is sent anywhere else.
 */
import type { RelaySetupSetting, SettingsApi } from "@kimo/platform"
import type { Reach } from "./local"
import { generateSecret, type RelaySecretStore, type SecretMode } from "./secret"

export type RelayPath = "local" | "docker" | "fly" | "railway" | "existing"

export interface RelaySetupState {
  path: RelayPath | null
  secretMode: SecretMode
  extraOrigins: string[]
  local: { port: number; reach: Reach; hostname: string | null } | null
  /** A relay deployed on Fly.io; `byKimo` when Kimo ran the deploy with flyctl. */
  fly: { app: string; region: string; byKimo: boolean } | null
  /** Regenerate on a relay Kimo can't restart: the restart banner shows until a test passes. */
  restartPending: boolean
}

export const EMPTY_SETUP: RelaySetupState = Object.freeze({
  path: null,
  secretMode: "auto",
  extraOrigins: [],
  local: null,
  fly: null,
  restartPending: false,
}) as RelaySetupState

const PATHS: readonly RelayPath[] = ["local", "docker", "fly", "railway", "existing"]
const REACH: readonly Reach[] = ["lan", "quick", "named"]

/** Reads `multiplayer.relaySetup` leniently: unknown or invalid fields fall back. */
export function parseSetup(raw: RelaySetupSetting | null | undefined): RelaySetupState {
  if (!raw || typeof raw !== "object") return EMPTY_SETUP
  const str = (v: unknown) => (typeof v === "string" && v ? v : null)
  const path = PATHS.includes(raw.path as RelayPath) ? (raw.path as RelayPath) : null
  const secretMode: SecretMode =
    raw.secretMode === "custom" || raw.secretMode === "none" ? raw.secretMode : "auto"
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
  return { path, secretMode, extraOrigins, local, fly, restartPending: raw.restartPending === true }
}

export function serializeSetup(state: RelaySetupState): RelaySetupSetting {
  return {
    path: state.path,
    secretMode: state.secretMode,
    extraOrigins: [...state.extraOrigins],
    local: state.local ? { ...state.local } : null,
    fly: state.fly ? { ...state.fly } : null,
    restartPending: state.restartPending,
  }
}

/** Whether Kimo can restart the relay with a new secret itself (Regenerate confirm, F and G). */
export function kimoRestarts(
  state: RelaySetupState,
  can: { localRunning: boolean; flyctl: boolean },
): "local" | "fly" | null {
  if (state.path === "local" && can.localRunning) return "local"
  if (state.path === "fly" && state.fly?.byKimo && can.flyctl) return "fly"
  return null
}

export interface RelaySetupStore {
  subscribe(listener: () => void): () => void
  getState(): RelaySetupState
  update(patch: Partial<RelaySetupState>): Promise<void>
  readonly secrets: RelaySecretStore
  /** The stored secret (Automatic or Custom), or null. */
  secret(): Promise<string | null>
  /** What Kimo sends when it creates a room: null for "No secret needed". */
  sendSecret(): Promise<string | null>
  /** The stored secret, or a new Automatic one generated and kept now (only in Automatic). */
  ensureAutoSecret(): Promise<string>
  /** A new Automatic secret (Regenerate, or Custom back to Automatic). */
  regenerate(): Promise<string>
  setCustomSecret(value: string): Promise<void>
  /** Save and use: the wizard's choices, the secret into the keychain (or removed for none). */
  save(input: {
    patch: Partial<RelaySetupState>
    secretMode: SecretMode
    secret: string | null
  }): Promise<void>
}

export function createRelaySetupStore(deps: {
  settings: SettingsApi | null
  secrets: RelaySecretStore
  generate?: () => string
}): RelaySetupStore {
  const { settings, secrets } = deps
  const generate = deps.generate ?? (() => generateSecret())
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
    secrets,
    secret: () => secrets.get(),
    async sendSecret() {
      return read().secretMode === "none" ? null : await secrets.get()
    },
    async ensureAutoSecret() {
      const current = await secrets.get()
      if (current) return current
      const fresh = generate()
      await secrets.set(fresh)
      return fresh
    },
    async regenerate() {
      const fresh = generate()
      await secrets.set(fresh)
      if (read().secretMode !== "auto") await store.update({ secretMode: "auto" })
      return fresh
    },
    async save({ patch, secretMode, secret }) {
      if (secretMode !== "none" && secret) await secrets.set(secret)
      await store.update({ ...patch, secretMode, restartPending: false })
    },
    async setCustomSecret(value) {
      const v = value.trim()
      if (v) await secrets.set(v)
      else await secrets.delete()
      if (read().secretMode !== "custom") await store.update({ secretMode: "custom" })
    },
  }
  return store
}
