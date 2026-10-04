/**
 * Settings › AI providers controller (contract `AiProvidersController`, ADR 0014 §4/§11): keys
 * through `SecretsApi` (desktop keychain `kimo` / `provider.<id>`; web `localStorage`
 * `kimo.providers`), the non-secret rows in `kimo.ai`, Test via the `@kimo/ai-agent` adapters
 * (desktop: the Rust relay fetch, so the key never enters JS), local CLI detection through the
 * platform CLI host, the default precedence, and usage to date.
 *
 * One controller per window ({@link getAiProviders} in `runtime.ts`); other windows see
 * changes through `onExternalChange` (the `storage` event).
 */
import {
  availableOn,
  BROWSER_SUPPORT,
  BUILTIN_CLI_ADAPTERS,
  type CliAdapter,
  type CliDetection,
  type ConnectionTest,
  cliIdOf,
  complete,
  createProvider,
  detectClis,
  type GenericCliConfig,
  genericAdapter,
  isCliProvider,
  type ModelSelection,
  type ProviderConfig,
  ProviderError,
  reachFor,
  TITLE_SCHEMA,
} from "@kimo/ai-agent"
import { type KeyValueStorage, providerAccount, type SecretsApi } from "@kimo/platform"
import type {
  AgentUsageSettings,
  AiProvidersController,
  AiProvidersState,
  CliAgentRowView,
  ProviderRowView,
} from "../platform/contract"
import {
  AI_CONFIG_KEY,
  type AiConfig,
  agentStatus,
  cliStatusText,
  defaultSelection,
  isCloud,
  keyless,
  monthUsage,
  OLLAMA_ID,
  OLLAMA_URL,
  type PillTone,
  parseConfig,
  providerRows,
  pruneLedger,
  type StoredProvider,
  sanitizeTitle,
  type UsableApi,
  type UsageEntry,
} from "./model"

type Unsubscribe = () => void

const CLOUD_IDS = ["bedrock", "vertex", "foundry"]

/** Minimal CLI host (`@kimo/platform` `CliProcessHostLike` / `@kimo/ai-agent` `CliProcessHost`). */
export type CliHost = Parameters<typeof detectClis>[0]

export interface AiSettingsDeps {
  platform: "desktop" | "web"
  /** `macos` | `windows` | `linux` | `web` (storage copy). */
  os: string
  secrets: SecretsApi
  /** Desktop CLI host; null on web (CLIs never run there). */
  cliHost: CliHost | null
  /** Non-secret config store (`localStorage`). */
  storage: KeyValueStorage
  /** Another window changed `kimo.ai` / the keys (the `storage` event). */
  onExternalChange?: (listener: () => void) => Unsubscribe
  /** fetch for one provider: global fetch on web; the relay on desktop. */
  fetchFor(provider: StoredProvider): typeof fetch
  online?: () => boolean
  now?: () => number
  /** Home directory for `~` paths in CLI rows. */
  home?: string | null
  adapters?: readonly CliAdapter[]
  /** Desktop: writes `~/.kimo/ai/clis.json` (the only generic CLIs Rust will resolve). */
  persistGenericClis?(clis: readonly GenericCliConfig[]): Promise<void>
}

/** Contract state plus what the pane and Home need. */
export interface AiSettingsState extends AiProvidersState {
  /** CLI detection in flight (Re-check spinners). */
  checking: boolean
  /** True once the first detection finished (desktop) — before that the first-run card waits. */
  detected: boolean
  /** Provider id → Test in flight. */
  testing: Record<string, boolean>
  /** What a new session gets (precedence, Settings Default overrides). */
  defaultSelection: ModelSelection | null
  /** Title-bar pill ("Agent ready · Claude Code (subscription)"). */
  agentStatus: { tone: PillTone; label: string }
  /** No usable API provider and no signed-in CLI (Home first-run card, Agent tab first run). */
  noProvider: boolean
  homeCardDismissed: boolean
  secretsBackend: SecretsApi["backend"]
  os: string
  home: string | null
}

export interface AiSettingsController extends AiProvidersController {
  readonly state: AiSettingsState
  subscribe(listener: (s: AiSettingsState) => void): Unsubscribe
  /** Re-reads keys and config (on pane open). Detects CLIs once if never detected. */
  refresh(): Promise<void>
  /** Web only: the stored key for "Reveal" (desktop keys never leave the keychain). */
  revealKey(providerId: string): Promise<string | null>
  /** Cloud row "Set up": which platform and its routing fields. */
  setCloud(
    kind: "bedrock" | "vertex" | "foundry",
    fields: { region?: string; project?: string },
  ): Promise<void>
  /** Ollama / custom keyless endpoints: mark configured (after a passing Test). */
  setConfigured(providerId: string, configured: boolean): Promise<void>
  dismissHomeCard(dismissed?: boolean): void
  /** Agent panel: one finished turn (usage to date, the monthly limit). */
  recordUsage(entry: UsageEntry): void
  /** Agent panel: the configured providers as `@kimo/ai-agent` configs (web: with keys). */
  providerConfigs(): Promise<ProviderConfig[]>
  /**
   * Agent panel: the fetch for one provider id (desktop: the Rust relay with that row's auth,
   * incl. Bedrock / Vertex region and project and custom endpoints; web: the page's fetch).
   * Unknown ids fall back to the global fetch.
   */
  fetchFor(providerId: string): typeof fetch
  /** Agent panel: the CLI detections (desktop). */
  clis(): readonly CliDetection[]
  /** Copy for a provider id (`anthropic` → "Anthropic", `cli:codex` → "Codex"). */
  labelOf(provider: string): string
  /**
   * Home: names a new file with the fast model of a usable API provider (the session's provider
   * first). Null when none is usable, on error or after `timeoutMs` (the caller falls back to
   * "Untitled").
   */
  nameFile(prompt: string, timeoutMs?: number): Promise<string | null>
  dispose(): void
}

/** Shown by the Base URL field of built-in providers. */
export const BUILTIN_BASE_URL_NOTE =
  "Built-in providers only call their own API. Add a proxy or self-hosted endpoint as a custom provider."

async function cloudTest(
  provider: ReturnType<typeof createProvider>,
  model: string,
  now: () => number,
): Promise<ConnectionTest> {
  const t0 = now()
  try {
    await complete(provider, {
      model,
      system: { stable: "Connection test. Reply with OK." },
      messages: [{ role: "user", content: [{ type: "text", text: "OK?" }] }],
      tools: [],
      thinking: "off",
      maxTokens: 16,
    })
    return { ok: true, latencyMs: now() - t0, detail: `${model} reachable · streaming` }
  } catch (e) {
    const error =
      e instanceof ProviderError
        ? e
        : new ProviderError("unknown", e instanceof Error ? e.message : String(e), {
            provider: provider.id,
          })
    return { ok: false, latencyMs: now() - t0, detail: error.message, error }
  }
}

export function createAiSettingsController(deps: AiSettingsDeps): AiSettingsController {
  const now = deps.now ?? Date.now
  const online = deps.online ?? (() => true)
  let config: AiConfig = parseConfig(deps.storage.getItem(AI_CONFIG_KEY))
  let hints: Record<string, string | null> = {}
  let detections: CliDetection[] = []
  let checking = false
  let detected = deps.platform === "web" || deps.cliHost === null
  const testing: Record<string, boolean> = {}
  const listeners = new Set<(s: AiSettingsState) => void>()

  const adapters = (): readonly CliAdapter[] => [
    ...(deps.adapters ?? BUILTIN_CLI_ADAPTERS),
    ...config.genericClis.map(genericAdapter),
  ]

  const save = () => {
    config = { ...config, ledger: pruneLedger(config.ledger, now()) }
    deps.storage.setItem(AI_CONFIG_KEY, JSON.stringify(config))
  }

  const rowOf = (id: string): StoredProvider | undefined =>
    providerRows(config).find((p) => p.id === id)

  const hasKey = (p: StoredProvider) => hints[p.id] != null
  const isConfigured = (p: StoredProvider) =>
    keyless(p) ? config.configured.includes(p.id) : hasKey(p)

  const usableApis = (): UsableApi[] =>
    providerRows(config)
      .filter(
        (p) =>
          isConfigured(p) &&
          // A key the provider rejected (401/403) is not usable.
          config.tests[p.id]?.errorKind !== "auth" &&
          // A key being tested right after entry counts once the test passes.
          testing[p.id] !== true &&
          p.models.agent !== "" &&
          availableOn({ kind: p.kind, allowBrowser: p.allowBrowser === true }, deps.platform).ok,
      )
      .map((p) => ({ id: p.id, agentModel: p.models.agent }))

  const labelOf = (provider: string): string => {
    if (isCliProvider(provider)) {
      const id = cliIdOf(provider)
      return (
        detections.find((d) => d.id === id)?.label ??
        adapters().find((a) => a.def.id === id)?.def.label ??
        id
      )
    }
    return providerRows(config).find((p) => p.id === provider)?.label ?? provider
  }

  function rowStatus(p: StoredProvider): ProviderRowView["status"] {
    const test = config.tests[p.id]
    if (isCloud(p.kind))
      return deps.platform === "desktop" && config.configured.includes(p.id) && test?.ok
        ? "connected"
        : "desktop-only"
    if (keyless(p)) return config.configured.includes(p.id) ? "local" : "not-set"
    if (!hasKey(p)) return "not-set"
    return test?.ok ? "connected" : "key-saved"
  }

  function compute(): AiSettingsState {
    const sel = defaultSelection({
      platform: deps.platform,
      clis: detections,
      apis: usableApis(),
      preferred: config.settings.defaultModel,
    })
    const providers: ProviderRowView[] = providerRows(config).map((p) => {
      const t = config.tests[p.id]
      return {
        id: p.id,
        kind: p.kind,
        label: p.label,
        status: rowStatus(p),
        isDefault: sel?.provider === p.id,
        baseURL: p.baseURL ?? "",
        models: p.models,
        keyHint: hints[p.id] ?? null,
        storage: deps.secrets.backend === "keychain" ? "keychain" : "localStorage",
        ...(p.kind === "anthropic" && deps.platform === "web"
          ? { allowBrowser: p.allowBrowser === true }
          : {}),
        ...(t
          ? {
              lastTest: {
                ok: t.ok,
                latencyMs: t.latencyMs,
                detail: t.detail,
                ...(t.errorKind
                  ? { error: new ProviderError(t.errorKind as never, t.detail, { provider: p.id }) }
                  : {}),
              },
            }
          : {}),
        reach: { web: reachFor(p.kind, "web"), desktop: reachFor(p.kind, "desktop") },
      }
    })
    const clis: CliAgentRowView[] =
      deps.platform === "desktop"
        ? detections.map((d) => ({
            detection: d,
            isDefault: sel?.provider === `cli:${d.id}`,
            status: cliStatusText(d),
          }))
        : []
    const u = monthUsage(config.ledger, now())
    return {
      platform: deps.platform,
      providers,
      clis,
      usage: { ...u, limitUsd: config.settings.monthlyLimitUsd },
      settings: config.settings,
      matrix: BROWSER_SUPPORT,
      checking,
      detected,
      testing: { ...testing },
      defaultSelection: sel,
      agentStatus: agentStatus(sel, labelOf, detections),
      noProvider: sel === null,
      homeCardDismissed: config.homeCardDismissed,
      secretsBackend: deps.secrets.backend,
      os: deps.os,
      home: deps.home ?? null,
    }
  }

  let state = compute()
  const emit = () => {
    state = compute()
    for (const l of listeners) l(state)
  }

  async function loadHints() {
    const next: Record<string, string | null> = {}
    const accounts = new Set(await deps.secrets.list().catch(() => [] as string[]))
    await Promise.all(
      providerRows(config).map(async (p) => {
        const acc = providerAccount(p.id)
        next[p.id] = accounts.has(acc) ? await deps.secrets.hint(acc).catch(() => null) : null
      }),
    )
    hints = next
  }

  async function providerConfig(p: StoredProvider): Promise<ProviderConfig> {
    const apiKey =
      deps.platform === "web" && !keyless(p)
        ? ((await deps.secrets.get(providerAccount(p.id)).catch(() => null)) ?? undefined)
        : undefined
    return {
      id: p.id,
      kind: p.kind,
      label: p.label,
      models: p.models,
      ...(p.extraModels ? { extraModels: p.extraModels } : {}),
      ...(p.baseURL ? { baseURL: p.baseURL } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(p.allowBrowser !== undefined ? { allowBrowser: p.allowBrowser } : {}),
      ...(p.wire ? { wire: p.wire } : {}),
      ...(p.api ? { api: p.api } : {}),
      ...(p.free ? { free: true } : {}),
    }
  }

  const putProvider = (id: string, patch: Partial<StoredProvider>) => {
    const base = rowOf(id)
    if (!base) throw new Error(`Unknown provider ${id}`)
    config = { ...config, providers: { ...config.providers, [id]: { ...base, ...patch, id } } }
    save()
  }

  const markConfigured = (id: string, on: boolean) => {
    const has = config.configured.includes(id)
    if (on && !has)
      config = { ...config, configured: [...config.configured, id], homeCardDismissed: false }
    if (!on && has) config = { ...config, configured: config.configured.filter((x) => x !== id) }
  }

  const ctl: AiSettingsController = {
    get state() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async refresh() {
      config = parseConfig(deps.storage.getItem(AI_CONFIG_KEY))
      await loadHints()
      emit()
      if (!detected && !checking) await ctl.redetectClis()
    },
    async setKey(providerId, key) {
      const k = key.trim()
      if (!k) throw new Error("Paste a key first.")
      const p = rowOf(providerId)
      if (!p) throw new Error(`Unknown provider ${providerId}`)
      await deps.secrets.set(providerAccount(p.id), k)
      // The previous test result belongs to the previous key.
      const tests = { ...config.tests }
      delete tests[p.id]
      config = { ...config, tests }
      testing[p.id] = true
      hints = { ...hints, [p.id]: k.slice(-4) }
      markConfigured(p.id, true)
      save()
      emit()
      return ctl.test(p.id)
    },
    async deleteKey(providerId) {
      await deps.secrets.delete(providerAccount(providerId))
      hints = { ...hints, [providerId]: null }
      const tests = { ...config.tests }
      delete tests[providerId]
      config = { ...config, tests }
      markConfigured(providerId, false)
      save()
      emit()
    },
    async test(providerId) {
      const p = rowOf(providerId)
      if (!p) throw new Error(`Unknown provider ${providerId}`)
      testing[p.id] = true
      emit()
      let result: ConnectionTest
      const t0 = now()
      const reach = availableOn(
        { kind: p.kind, allowBrowser: p.allowBrowser === true },
        deps.platform,
      )
      try {
        if (!reach.ok)
          throw new ProviderError("unsupported_platform", reach.reason, { provider: p.id })
        const provider = createProvider(await providerConfig(p), {
          platform: deps.platform,
          fetch: deps.fetchFor(p),
          online,
        })
        // Bedrock / Vertex only serve POST /v1/messages (listModels → 404): one tiny message
        // instead of the adapter's models-list + tool probe.
        result = isCloud(p.kind)
          ? await cloudTest(provider, p.models.agent, now)
          : await provider.test()
      } catch (e) {
        const error =
          e instanceof ProviderError
            ? e
            : new ProviderError("unknown", e instanceof Error ? e.message : String(e), {
                provider: p.id,
              })
        result = { ok: false, latencyMs: now() - t0, detail: error.message, error }
      }
      testing[p.id] = false
      config = {
        ...config,
        tests: {
          ...config.tests,
          [p.id]: {
            ok: result.ok,
            latencyMs: result.latencyMs,
            detail: result.detail,
            ...(result.error ? { errorKind: result.error.kind } : {}),
            at: now(),
          },
        },
      }
      if (keyless(p) && result.ok) markConfigured(p.id, true)
      save()
      emit()
      return result
    },
    async setModels(providerId, models) {
      putProvider(providerId, { models })
      emit()
    },
    async setBaseURL(providerId, baseURL) {
      const p = rowOf(providerId)
      if (!p) return
      const v = baseURL?.trim()
      // Built-in providers never send their key to another origin (the relay refuses it):
      // proxies and self-hosted endpoints are `custom:*` providers.
      if (p.kind !== "custom") throw new Error(BUILTIN_BASE_URL_NOTE)
      const stored: StoredProvider = { ...p }
      if (v) stored.baseURL = v
      else if (p.id === OLLAMA_ID) stored.baseURL = OLLAMA_URL
      else delete stored.baseURL
      config = { ...config, providers: { ...config.providers, [p.id]: stored } }
      save()
      emit()
    },
    async setAllowBrowser(providerId, allow) {
      putProvider(providerId, { allowBrowser: allow })
      emit()
      // A key entered before the opt-in gets its Test now.
      if (allow && hints[providerId] != null) await ctl.test(providerId)
    },
    async addCustom(c) {
      const slug =
        c.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || "endpoint"
      let id = `custom:${slug}`
      for (let n = 2; providerRows(config).some((p) => p.id === id); n++) id = `custom:${slug}-${n}`
      config = {
        ...config,
        providers: {
          ...config.providers,
          [id]: {
            id,
            kind: "custom",
            label: c.label,
            baseURL: c.baseURL,
            wire: c.wire,
            models: c.models,
            custom: true,
            ...(c.free ? { free: true } : {}),
          },
        },
      }
      if (c.free) markConfigured(id, true)
      save()
      await loadHints()
      emit()
      return id
    },
    async removeProvider(providerId) {
      await deps.secrets.delete(providerAccount(providerId)).catch(() => {})
      const providers = { ...config.providers }
      delete providers[providerId]
      const tests = { ...config.tests }
      delete tests[providerId]
      config = { ...config, providers, tests }
      markConfigured(providerId, false)
      if (config.settings.defaultModel?.provider === providerId)
        config = { ...config, settings: { ...config.settings, defaultModel: null } }
      hints = { ...hints, [providerId]: null }
      save()
      emit()
    },
    async setDefault(selection) {
      config = { ...config, settings: { ...config.settings, defaultModel: selection } }
      save()
      emit()
    },
    async setUsageSettings(patch: Partial<Omit<AgentUsageSettings, "defaultModel">>) {
      config = { ...config, settings: { ...config.settings, ...patch } }
      save()
      emit()
    },
    async redetectClis() {
      if (deps.platform !== "desktop" || !deps.cliHost) {
        detected = true
        emit()
        return []
      }
      checking = true
      emit()
      try {
        detections = await detectClis(deps.cliHost, adapters())
      } finally {
        checking = false
        detected = true
        emit()
      }
      return detections
    },
    async addGenericCli(c: GenericCliConfig) {
      config = { ...config, genericClis: [...config.genericClis.filter((g) => g.id !== c.id), c] }
      save()
      // Desktop: Rust resolves only generic CLIs listed in ~/.kimo/ai/clis.json.
      await deps.persistGenericClis?.(config.genericClis)
      await ctl.redetectClis()
    },
    async revealKey(providerId) {
      if (deps.platform !== "web") return null
      return deps.secrets.get(providerAccount(providerId)).catch(() => null)
    },
    async setCloud(kind, fields) {
      const providers = { ...config.providers }
      for (const k of CLOUD_IDS) delete providers[k]
      providers[kind] = {
        id: kind,
        kind,
        label: "Bedrock · Vertex · Foundry",
        models: (rowOf("bedrock") as StoredProvider).models,
        ...(fields.region ? { region: fields.region } : {}),
        ...(fields.project ? { project: fields.project } : {}),
      }
      config = {
        ...config,
        providers,
        configured: [...config.configured.filter((x) => !CLOUD_IDS.includes(x)), kind],
      }
      save()
      emit()
    },
    async setConfigured(providerId, on) {
      markConfigured(providerId, on)
      save()
      emit()
    },
    dismissHomeCard(dismissed = true) {
      config = { ...config, homeCardDismissed: dismissed }
      save()
      emit()
    },
    recordUsage(entry) {
      config = { ...config, ledger: [...config.ledger, entry] }
      save()
      emit()
    },
    async providerConfigs() {
      const rows = providerRows(config).filter(isConfigured)
      return Promise.all(rows.map(providerConfig))
    },
    fetchFor(providerId) {
      const row = rowOf(providerId)
      return row ? deps.fetchFor(row) : globalThis.fetch.bind(globalThis)
    },
    clis: () => detections,
    labelOf,
    async nameFile(prompt, timeoutMs = 1500) {
      const sel = state.defaultSelection
      const usable = usableApis().map((u) => u.id)
      const order = [
        ...(sel && usable.includes(sel.provider) ? [sel.provider] : []),
        ...usable.filter((id) => id !== sel?.provider),
      ]
      const p = order.map(rowOf).find((r) => r && (r.models.fast || r.models.agent))
      if (!p) return null
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), timeoutMs)
      try {
        const provider = createProvider(await providerConfig(p), {
          platform: deps.platform,
          fetch: deps.fetchFor(p),
          online,
        })
        const r = await complete(provider, {
          model: p.models.fast || p.models.agent,
          system: {
            stable:
              "You name design files. Reply with JSON only: a 1 to 4 word title in sentence case, no quotes, no file extension.",
          },
          messages: [{ role: "user", content: [{ type: "text", text: prompt.slice(0, 2000) }] }],
          tools: [],
          thinking: "off",
          maxTokens: 64,
          responseSchema: TITLE_SCHEMA,
          signal: abort.signal,
        })
        const raw = r.text.trim()
        let title: unknown = raw
        try {
          title = (JSON.parse(raw) as { title?: unknown }).title
        } catch {}
        return typeof title === "string" ? sanitizeTitle(title) : null
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },
    dispose() {
      offExternal?.()
      listeners.clear()
    },
  }

  const offExternal = deps.onExternalChange?.(() => {
    void ctl.refresh()
  })

  return ctl
}
