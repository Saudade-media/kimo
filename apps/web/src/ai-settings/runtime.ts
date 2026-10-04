/**
 * The window's AI providers controller over the platform (ADR 0014 §4/§11):
 *
 * - Desktop (Tauri): keys in the OS keychain (`createTauriSecrets`), provider calls through the
 *   Rust relay (`createRelayFetch`, the key is injected in Rust), CLI detection through
 *   `createTauriCliHost`.
 * - Browser: keys in `localStorage` `kimo.providers` (`createWebSecrets`), the page's fetch, no
 *   CLIs.
 *
 * `AiSettingsContext` lets harnesses and tests provide their own controller (fake CLI host,
 * mocked fetch, memory secrets).
 */
import {
  type AiRelayRequest,
  createRelayFetch,
  createTauriCliHost,
  createTauriSecrets,
  createWebSecrets,
  type KeyValueStorage,
  type KimoPlatform,
  WEB_SECRETS_KEY,
} from "@kimo/platform"
import { createContext, useContext, useMemo, useSyncExternalStore } from "react"
import { tauriBridge } from "../host/bridge"
import { inTauri } from "../platform/runtime"
import { homeOf } from "../settings/model"
import {
  type AiSettingsController,
  type AiSettingsState,
  createAiSettingsController,
} from "./controller"
import { AI_CONFIG_KEY, authOf, isCloud, keyWithheld, type StoredProvider } from "./model"

/** How the relay injects one provider's credentials (desktop). */
export function relayAuthFor(p: StoredProvider): AiRelayRequest["auth"] {
  if (isCloud(p.kind)) {
    // Foundry: the relay's `project` slot carries the resource (`<resource>.services.ai.azure.com`).
    const project = p.kind === "foundry" ? (p.resource ?? p.project) : p.project
    return {
      kind: "cloud",
      platform: p.kind,
      ...(p.region ? { region: p.region } : {}),
      ...(project ? { project } : {}),
      ...(p.credentials ? { credentials: p.credentials } : {}),
      ...(p.kind === "bedrock" && p.profile?.trim() ? { profile: p.profile.trim() } : {}),
    }
  }
  // Board 25 "Origin pin": the base URL's host left the pinned origin → the key is withheld.
  if (keyWithheld(p)) return { kind: "none" }
  switch (p.kind) {
    case "anthropic":
      return { kind: "header", header: "x-api-key" }
    case "gemini":
      return { kind: "header", header: "x-goog-api-key" }
    case "openai":
    case "openrouter":
      return { kind: "header", header: "authorization", scheme: "Bearer" }
    default: {
      if (p.free) return { kind: "none" }
      const a = authOf(p)
      if (a.scheme === "bearer")
        return { kind: "header", header: "authorization", scheme: "Bearer" }
      if (a.scheme === "x-api-key") return { kind: "header", header: "x-api-key" }
      return { kind: "header", header: (a.header?.trim() || "x-api-key").toLowerCase() }
    }
  }
}

/** `localStorage` that never throws (private windows, blocked storage). */
export function safeLocalStorage(): KeyValueStorage {
  const mem = new Map<string, string>()
  const ls = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }
  return {
    getItem: (k) => {
      try {
        return ls()?.getItem(k) ?? mem.get(k) ?? null
      } catch {
        return mem.get(k) ?? null
      }
    },
    setItem: (k, v) => {
      try {
        const s = ls()
        if (s) s.setItem(k, v)
        else mem.set(k, v)
      } catch {
        mem.set(k, v)
      }
    },
    removeItem: (k) => {
      try {
        ls()?.removeItem(k)
      } catch {}
      mem.delete(k)
    },
  }
}

/** Builds the controller for this window's platform. */
export function createAiSettingsForPlatform(platform: KimoPlatform): AiSettingsController {
  const storage = safeLocalStorage()
  const onExternalChange = (listener: () => void) => {
    const on = (e: StorageEvent) => {
      if (e.key === AI_CONFIG_KEY || e.key === WEB_SECRETS_KEY || e.key === null) listener()
    }
    globalThis.addEventListener?.("storage", on)
    return () => globalThis.removeEventListener?.("storage", on)
  }
  const home = homeOf(platform.recovery.dir)
  const online = () => (typeof navigator === "object" ? navigator.onLine !== false : true)
  if (platform.kind === "desktop" && inTauri()) {
    const bridge = tauriBridge()
    const relay = {
      invoke: (cmd: string, args?: Record<string, unknown>) => bridge.invoke(cmd, args),
      listen: (event: string, handler: (payload: unknown) => void) => bridge.listen(event, handler),
    }
    return createAiSettingsController({
      platform: "desktop",
      os: platform.os,
      secrets: createTauriSecrets(relay.invoke),
      cliHost: createTauriCliHost(relay),
      storage,
      onExternalChange,
      fetchFor: (p) => createRelayFetch(relay, () => ({ provider: p.id, auth: relayAuthFor(p) })),
      online,
      home,
      // Rust resolves only the generic CLIs listed in ~/.kimo/ai/clis.json.
      persistGenericClis: async (clis) => {
        if (!home) return
        const sep = home.includes("\\") ? "\\" : "/"
        await platform.files.writeTextAtomic(
          [home, ".kimo", "ai", "clis.json"].join(sep),
          `${JSON.stringify(clis, null, 2)}\n`,
          { mkdirs: true },
        )
      },
    })
  }
  return createAiSettingsController({
    platform: "web",
    os: platform.os,
    secrets: createWebSecrets(storage),
    cliHost: null,
    storage,
    onExternalChange,
    fetchFor: () => globalThis.fetch.bind(globalThis),
    online,
    home,
  })
}

const byPlatform = new WeakMap<KimoPlatform, AiSettingsController>()

/** One controller per window (per platform object). */
export function getAiProviders(platform: KimoPlatform): AiSettingsController {
  let c = byPlatform.get(platform)
  if (!c) {
    c = createAiSettingsForPlatform(platform)
    byPlatform.set(platform, c)
  }
  return c
}

/** Harnesses/tests: an explicit controller wins over the platform one. */
export const AiSettingsContext = createContext<AiSettingsController | null>(null)

/** The window's controller (context first, then the platform's). */
export function useAiProviders(platform: KimoPlatform | null): AiSettingsController | null {
  const provided = useContext(AiSettingsContext)
  return useMemo(
    () => provided ?? (platform ? getAiProviders(platform) : null),
    [provided, platform],
  )
}

const NO_STATE = () => null
const NO_SUB = () => () => {}

/** Subscribes to a controller's state. */
export function useAiSettingsState(ctl: AiSettingsController | null): AiSettingsState | null {
  const get = ctl ? () => ctl.state : NO_STATE
  return useSyncExternalStore(ctl ? (l) => ctl.subscribe(l) : NO_SUB, get, get)
}
