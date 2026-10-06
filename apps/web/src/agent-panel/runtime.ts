/**
 * The agent panel's injected runtime (ADR 0014 §1: host services are injected). The panel
 * controller only talks to this interface:
 *
 * - desktop: providers through the Rust relay (`createRelayFetch`), local CLIs through the
 *   Tauri CLI host, sessions in app data;
 * - web: direct `fetch` per `BROWSER_SUPPORT` (Anthropic needs the browser opt-in), no CLIs,
 *   sessions in IndexedDB `kimo-sessions`;
 * - tests / e2e: a mocked provider and a fake CLI (`testing.ts`).
 *
 * {@link createAppAgentRuntime} builds it from the window's AI providers controller
 * (`getAiProviders(platform)`, apps/web/src/ai-settings) and a tool host factory.
 */
import {
  type CliDetection,
  type CliProcessHost,
  createMemorySessionStore,
  createProvider,
  type KimoMcpLaunch,
  type ModelSelection,
  type Provider,
  type ProviderConfig,
  type Session,
  type SessionMeta,
  type SessionStore,
  type SkillSource,
  type ToolStream,
  type WebNote,
} from "@kimo/ai-agent"
import { createTauriCliHost, type KimoPlatform } from "@kimo/platform"
import type { AiSettingsController } from "../ai-settings/controller"
import type { UsageEntry } from "../ai-settings/model"
import { tauriBridge } from "../host/bridge"
import type { AgentUsageSettings } from "../platform/contract"
import { inTauri } from "../platform/runtime"
import { createPromptRunStore, type PromptRunStore } from "./prompt-runs"
import type { ToolHostFactory } from "./tools"

/** A provider row that is not usable yet (picker "Add a key to use Gemini…"). */
export interface UnavailableProvider {
  id: string
  label: string
  /** "no key", "not signed in", "desktop only". */
  tag: string
}

export interface AgentPanelRuntime {
  platform: "desktop" | "web" | "node"
  /** Configured, usable API providers (web: with keys). */
  providers(): Promise<ProviderConfig[]>
  /** Providers that would show an "Add a key…" row. */
  unavailable?(): UnavailableProvider[]
  /** Local CLI detections (desktop; empty on web). */
  clis(): readonly CliDetection[]
  /** What a new session gets (precedence; Settings "Default" overrides). Null = first run. */
  defaultSelection(): ModelSelection | null
  /** "Anthropic", "Claude Code". */
  labelOf(provider: string): string
  /** Builds the adapter for a provider row (default: `createProvider` with `fetchFor`). */
  createProvider?(config: ProviderConfig): Provider
  /** fetch for one provider (desktop: the relay). Default: global fetch. */
  fetchFor?(config: ProviderConfig): typeof fetch
  /** Desktop CLI process host. */
  cliHost?: CliProcessHost | null
  /** How a CLI launches Kimo's MCP server (bundled shim with `--client <cli>`). */
  mcpLaunch?(cli: string): KimoMcpLaunch
  /**
   * Streamed edits of a local CLI (ADR 0013 §4.7): forwards a tool call the CLI's model is
   * writing to whatever serves the CLI's MCP connection (desktop: the document host).
   * Absent: CLI edits land when their call arrives.
   */
  cliToolStream?(call: { id: string; name: string; workspace: string }): ToolStream | undefined
  /**
   * Board 38: Settings › AI providers › Allow web access, and whether No third-party fetch
   * blocks it. Absent: on, not blocked (the setting's default).
   */
  webAccess?(): { enabled: boolean; blocked: boolean }
  /** Board 38: a local CLI's web search / page read for the Activity log (document host). */
  cliWebNote?(entry: WebNote & { workspace: string }): void
  /** Board 39 Recent: the saved last two provider + model picks (settings `ai.recentModels`). */
  recentModels?(): ModelSelection[]
  saveRecentModels?(list: ModelSelection[]): void | Promise<void>
  /** The document side (in-window tools or the document host's). */
  tools: ToolHostFactory
  sessions: SessionStore
  /** Prompt-node run state in app data (survives reload; never in the `.kimo`). */
  promptRuns?: PromptRunStore
  skills?: SkillSource
  /** Settings › AI providers › Usage & limits, with this month's spend so far. */
  usage?(): AgentUsageSettings & { monthUsd: number }
  recordUsage?(entry: UsageEntry): void
  /** Re-reads providers / CLIs (they changed in Settings). */
  subscribe?(listener: () => void): () => void
  online?(): boolean
  waitForOnline?(signal: AbortSignal): Promise<void>
  now?(): number
  random?(): number
  /** Opens Settings › AI providers (error card actions, "Manage providers…"). */
  openSettings?(pane?: "ai-providers" | "usage"): void
  /** Opens the download page (CORS card "Get desktop") / provider matrix. */
  /** Opens a link from a reply; a rejection is reported as "Couldn't open <url>. <cause>". */
  openLink?(url: string): void | Promise<void>
  /**
   * First run (board 25 rule "First run · CLI"): the user already chose a CLI (Settings default
   * or "Use Claude Code"). Omitted: confirmed (tests, harnesses with CLIs).
   */
  cliConfirmed?(): boolean
  /** An API provider passed its Test (or is local). Omitted: any configured provider. */
  apiReady?(): boolean
  /** "Use Claude Code": makes the CLI the Settings default. */
  chooseCli?(id: string): Promise<void>
  /** Inline key card "Connect": saves the key and runs its Test. */
  connectKey?(provider: string, key: string): Promise<{ ok: boolean; detail: string }>
}

export function providerFor(rt: AgentPanelRuntime, config: ProviderConfig): Provider {
  if (rt.createProvider) return rt.createProvider(config)
  return createProvider(config, {
    platform: rt.platform,
    fetch: rt.fetchFor?.(config) ?? globalThis.fetch.bind(globalThis),
    online: rt.online ?? (() => true),
  })
}

/** The app runtime over the window's AI providers controller. */
export function createAppAgentRuntime(o: {
  ai: AiSettingsController
  tools: ToolHostFactory
  sessions?: SessionStore
  promptRuns?: PromptRunStore
  fetchFor?: (config: ProviderConfig) => typeof fetch
  cliHost?: CliProcessHost | null
  mcpLaunch?: (cli: string) => KimoMcpLaunch
  cliToolStream?: AgentPanelRuntime["cliToolStream"]
  cliWebNote?: AgentPanelRuntime["cliWebNote"]
  /** App settings (Allow web access, No third-party fetch). */
  settings?: KimoPlatform["settings"]
  skills?: SkillSource
  openSettings?: AgentPanelRuntime["openSettings"]
  openLink?: AgentPanelRuntime["openLink"]
}): AgentPanelRuntime {
  const ai = o.ai
  const settings = o.settings
  const online = () => (typeof navigator === "object" ? navigator.onLine !== false : true)
  return {
    platform: ai.state.platform,
    providers: () => ai.providerConfigs(),
    unavailable: () =>
      ai.state.providers
        .filter((p) => p.status === "not-set" || p.status === "desktop-only")
        .map((p) => ({
          id: p.id,
          label: p.label,
          tag: p.status === "desktop-only" ? "desktop only" : "no key",
        })),
    clis: () => ai.clis(),
    defaultSelection: () => ai.state.defaultSelection,
    labelOf: (p) => ai.labelOf(p),
    ...(o.fetchFor ? { fetchFor: o.fetchFor } : {}),
    cliHost: o.cliHost ?? null,
    ...(o.mcpLaunch ? { mcpLaunch: o.mcpLaunch } : {}),
    ...(o.cliToolStream ? { cliToolStream: o.cliToolStream } : {}),
    ...(o.cliWebNote ? { cliWebNote: o.cliWebNote } : {}),
    ...(settings
      ? {
          webAccess: () => {
            const v = settings.all()
            return { enabled: v["ai.webAccess"], blocked: v["privacy.noThirdPartyFetch"] }
          },
        }
      : {}),
    ...(settings
      ? {
          recentModels: () => settings.all()["ai.recentModels"].map((r) => ({ ...r })),
          saveRecentModels: (list: ModelSelection[]) =>
            settings
              .set(
                "ai.recentModels",
                list.map((s) => ({ provider: s.provider, model: s.model })),
              )
              .catch(() => {}),
        }
      : {}),
    tools: o.tools,
    sessions: o.sessions ?? createIndexedDbSessionStore(),
    promptRuns: o.promptRuns ?? createPromptRunStore(),
    ...(o.skills ? { skills: o.skills } : {}),
    usage: () => ({ ...ai.state.settings, monthUsd: ai.state.usage.costUsd }),
    recordUsage: (e) => ai.recordUsage(e),
    subscribe: (l) => {
      const offAi = ai.subscribe(() => l())
      // Board 38: the composer's globe follows Allow web access / No third-party fetch.
      const offSettings = settings?.onChange(() => l())
      return () => {
        offAi()
        offSettings?.()
      }
    },
    online,
    ...(o.openSettings ? { openSettings: o.openSettings } : {}),
    ...(o.openLink ? { openLink: o.openLink } : {}),
    cliConfirmed: () => {
      const d = ai.state.settings.defaultModel
      return d?.provider.startsWith("cli:") === true
    },
    apiReady: () =>
      ai.state.providers.some(
        (p) =>
          p.status === "connected" ||
          p.status === "local" ||
          (p.status === "key-saved" && p.lastTest?.ok !== false && ai.state.testing[p.id] !== true),
      ),
    chooseCli: (id) => ai.setDefault({ provider: `cli:${id}`, model: "default" }),
    connectKey: async (provider, key) => {
      // Web: Anthropic needs the browser opt-in; pressing Connect on this card is that opt-in.
      if (ai.state.platform === "web" && provider === "anthropic")
        await ai.setAllowBrowser(provider, true)
      const t = await ai.setKey(provider, key)
      return { ok: t.ok, detail: t.detail }
    },
  }
}

/**
 * The window's runtime for its platform: desktop (Tauri) calls providers through the Rust relay
 * (the key is injected in Rust; `relayAuthFor` per provider) and drives local CLIs through the
 * Tauri CLI host; the browser uses the page's fetch and never runs CLIs.
 */
export function createPlatformAgentRuntime(
  platform: KimoPlatform,
  ai: AiSettingsController,
  tools: ToolHostFactory,
  extra: Omit<Parameters<typeof createAppAgentRuntime>[0], "ai" | "tools"> = {},
): AgentPanelRuntime {
  // Provider calls use the AI settings controller's own fetch per row: the relay with that
  // row's auth on desktop (Bedrock / Vertex region + project, custom endpoints), the page's
  // fetch on the web.
  const fetchFor = (config: ProviderConfig) => ai.fetchFor(config.id)
  if (platform.kind === "desktop" && inTauri()) {
    const bridge = tauriBridge()
    const relay = {
      invoke: (cmd: string, args?: Record<string, unknown>) => bridge.invoke(cmd, args),
      listen: (event: string, handler: (payload: unknown) => void) => bridge.listen(event, handler),
    }
    return createAppAgentRuntime({
      ai,
      tools,
      fetchFor,
      settings: platform.settings,
      cliHost: createTauriCliHost(relay),
      ...extra,
    })
  }
  return createAppAgentRuntime({ ai, tools, fetchFor, settings: platform.settings, ...extra })
}

// --- Sessions: IndexedDB `kimo-sessions` (ADR 0014 §7) -----------------------------------------

const DB = "kimo-sessions"
const STORE = "sessions"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" })
        s.createIndex("fileId", "fileId")
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const r = run(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

const metaOf = ({ turns: _t, cliSessionId: _c, ...m }: Session): SessionMeta => m

/**
 * Web (and desktop webview) session store: IndexedDB `kimo-sessions`, store `sessions` (key id,
 * index fileId). Falls back to memory when IndexedDB is unavailable (private mode, tests).
 */
export function createIndexedDbSessionStore(): SessionStore {
  if (typeof indexedDB === "undefined") return createMemorySessionStore()
  let db: Promise<IDBDatabase> | null = null
  const get = () => {
    db ??= openDb()
    return db
  }
  const all = async (): Promise<Session[]> =>
    tx(await get(), "readonly", (s) => s.getAll() as IDBRequest<Session[]>)
  const text = (s: Session) =>
    [
      s.title,
      ...s.turns.flatMap((t) =>
        t.messages.flatMap((m) =>
          m.role === "tool" ? [] : m.content.flatMap((p) => (p.type === "text" ? [p.text] : [])),
        ),
      ),
    ]
      .join("\n")
      .toLowerCase()
  const sorted = (xs: Session[]) => xs.sort((a, b) => b.updatedAt - a.updatedAt).map(metaOf)
  return {
    async list(fileId) {
      return sorted((await all()).filter((s) => fileId === undefined || s.fileId === fileId))
    },
    async get(id) {
      return ((await tx(await get(), "readonly", (s) => s.get(id))) as Session | undefined) ?? null
    },
    async put(session) {
      await tx(await get(), "readwrite", (s) => s.put(structuredClone(session)))
    },
    async delete(id) {
      await tx(await get(), "readwrite", (s) => s.delete(id))
    },
    async search(q) {
      const needle = q.trim().toLowerCase()
      return sorted((await all()).filter((s) => !needle || text(s).includes(needle)))
    },
  }
}
