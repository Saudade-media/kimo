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
  type AuthScheme,
  agentStatus,
  authOf,
  authPreview,
  BUILTIN_PROVIDERS,
  cliStatusText,
  defaultSelection,
  isCloud,
  keyless,
  keyWithheld,
  maskForTrace,
  monthUsage,
  OLLAMA_ID,
  OLLAMA_URL,
  originOf,
  type PillTone,
  parseConfig,
  providerRows,
  pruneLedger,
  type StoredProvider,
  type StoredTest,
  sanitizeTitle,
  TEST_TIMEOUT_MS,
  type TestTrace,
  type UsableApi,
  type UsageEntry,
} from "./model"

type Unsubscribe = () => void

const CLOUD_IDS = ["bedrock", "vertex", "foundry"]

/** Minimal CLI host (`@kimo/platform` `CliProcessHostLike` / `@kimo/ai-agent` `CliProcessHost`). */
export type CliHost = Parameters<typeof detectClis>[0]

/** Board 25 cloud cards' fields (rules Oo1ZC / wqHjl / zYzwc). */
export interface CloudFields {
  region?: string
  project?: string
  credentials?: string
  profile?: string
  resource?: string
  /** Bedrock Models / Foundry Deployment: the agent model id. */
  model?: string
}

/** Board 25 Add provider (uOwr0): Type, Name, Base URL, Auth header, API key, Models. */
export interface AddProviderInput {
  type: "custom" | "openai" | "gemini" | "openrouter"
  label: string
  baseURL?: string
  auth?: AuthScheme
  key?: string
  /** First = agent model, second = fast model (rule BdODa). */
  models: string[]
}

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
  /** Test timeout (board 25 AbbSR, default 15 s). */
  testTimeoutMs?: number
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
  /**
   * Cloud row "Set up" (board 25 YewZG / bSx6y / g7Uzta): one platform's routing fields. The
   * platform last set up is the one the row uses; the others keep their fields.
   */
  setCloud(kind: "bedrock" | "vertex" | "foundry", fields: CloudFields): Promise<void>
  /** Board 25 "Add provider" dialog: adds (or keys a built-in row), then runs the Test. */
  addProvider(input: AddProviderInput): Promise<{ id: string; test: ConnectionTest }>
  /** Board 25 footer "Test connection": tests the form's draft without adding it. */
  testDraft(input: AddProviderInput): Promise<StoredTest>
  /** Board 25 Models "Fetch /models": the endpoint's model ids for a draft. */
  fetchModels(input: AddProviderInput): Promise<string[]>
  /** Custom endpoints: the auth header scheme. */
  setAuth(providerId: string, auth: AuthScheme): Promise<void>
  /** The stored row (auth, pin, cloud fields), or undefined. */
  storedOf(providerId: string): StoredProvider | undefined
  /** The last Test (with its Details trace), or undefined. */
  testOf(providerId: string): StoredTest | undefined
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

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
}

class TestTimeout extends Error {}

/**
 * Wraps a provider fetch for one Test: records the last request for the Details expander
 * (request line, status + latency, the first 400 chars of a failed response), collects the ids
 * a `/models` response lists (model-missing warning) and enforces the Test timeout.
 */
function recordingFetch(inner: typeof fetch, timeoutMs: number, now: () => number) {
  const rec: {
    request: string
    response: string
    body: string
    status?: number
    listed: string[] | null
    timedOut: boolean
  } = { request: "", response: "", body: "", listed: null, timedOut: false }
  const started = now()
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    rec.request = `${req.method} ${req.url.replace(/^kimo-relay:\/\//, "")}`
    const t0 = now()
    const left = Math.max(0, timeoutMs - (t0 - started))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const res = await Promise.race([
        inner(input, init),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            rec.timedOut = true
            reject(new TestTimeout(`no response in ${Math.round(timeoutMs / 1000)} s`))
          }, left)
        }),
      ])
      clearTimeout(timer)
      rec.status = res.status
      rec.response = `← ${res.status} ${res.statusText || STATUS_TEXT[res.status] || ""}`.trimEnd()
      rec.response += ` · ${now() - t0} ms`
      if (!res.ok) {
        rec.body = (
          await res
            .clone()
            .text()
            .catch(() => "")
        ).slice(0, 400)
      } else if (/\/models\/?(\?|$)/.test(new URL(req.url).pathname + new URL(req.url).search)) {
        const j = (await res
          .clone()
          .json()
          .catch(() => null)) as { data?: { id?: string }[]; models?: { name?: string }[] } | null
        const ids = [
          ...(j?.data ?? []).map((m) => m.id ?? ""),
          ...(j?.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")),
        ].filter(Boolean)
        rec.listed = ids
      }
      return res
    } catch (e) {
      clearTimeout(timer)
      rec.response = `← ${e instanceof Error ? e.message : String(e)} · ${now() - t0} ms`
      throw e
    }
  }) as typeof fetch
  return { fetch: f, rec }
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

  async function providerConfig(p: StoredProvider, draftKey?: string): Promise<ProviderConfig> {
    // Board 25 "Origin pin": a key pinned to another origin is withheld (re-enter it).
    const withheld = keyWithheld(p)
    const key =
      draftKey ??
      (deps.platform === "web" && !keyless(p) && !withheld
        ? ((await deps.secrets.get(providerAccount(p.id)).catch(() => null)) ?? undefined)
        : undefined)
    // Custom endpoints on web: a scheme the adapter doesn't send by itself goes as a header.
    let apiKey = key
    let headers: Record<string, string> | undefined
    if (key && p.kind === "custom") {
      const a = authOf(p)
      const native = p.wire === "anthropic" ? a.scheme === "x-api-key" : a.scheme === "bearer"
      if (!native) {
        apiKey = undefined
        headers =
          a.scheme === "bearer"
            ? { authorization: `Bearer ${key}` }
            : { [a.scheme === "x-api-key" ? "x-api-key" : a.header?.trim() || "x-api-key"]: key }
      }
    }
    return {
      id: p.id,
      kind: p.kind,
      label: p.label,
      models: p.models,
      ...(p.extraModels ? { extraModels: p.extraModels } : {}),
      ...(p.baseURL ? { baseURL: p.baseURL } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(headers ? { headers } : {}),
      ...(p.allowBrowser !== undefined ? { allowBrowser: p.allowBrowser } : {}),
      ...(p.wire ? { wire: p.wire } : {}),
      ...(p.api ? { api: p.api } : {}),
      ...(p.free ? { free: true } : {}),
    }
  }

  /** "auth: Authorization: Bearer acme_live_…7c21" (the key masked; desktop: its last 4). */
  async function authLine(p: StoredProvider, draftKey?: string): Promise<string> {
    if (isCloud(p.kind)) return "auth: signed credentials (Rust side)"
    if (!draftKey && keyless(p) && !hints[p.id]) return "auth: none"
    const key =
      draftKey ??
      (deps.platform === "web"
        ? await deps.secrets.get(providerAccount(p.id)).catch(() => null)
        : null)
    const masked = key ? maskForTrace(key) : hints[p.id] ? `…${hints[p.id]}` : "<none>"
    const scheme: AuthScheme =
      p.kind === "custom"
        ? authOf(p)
        : p.kind === "anthropic"
          ? { scheme: "x-api-key" }
          : p.kind === "gemini"
            ? { scheme: "custom", header: "x-goog-api-key" }
            : { scheme: "bearer" }
    return `auth: ${authPreview(scheme, masked)}`
  }

  /** One Test of a row or a draft: the result plus what the pane stores (with Details). */
  async function runTest(
    p: StoredProvider,
    draftKey?: string,
  ): Promise<{ result: ConnectionTest; stored: StoredTest }> {
    let result: ConnectionTest
    const t0 = now()
    const timeoutMs = deps.testTimeoutMs ?? TEST_TIMEOUT_MS
    const { fetch: recorded, rec } = recordingFetch(deps.fetchFor(p), timeoutMs, now)
    const reach = availableOn(
      { kind: p.kind, allowBrowser: p.allowBrowser === true },
      deps.platform,
    )
    try {
      if (!reach.ok)
        throw new ProviderError("unsupported_platform", reach.reason, { provider: p.id })
      const provider = createProvider(
        await providerConfig(p, deps.platform === "web" ? draftKey : undefined),
        { platform: deps.platform, fetch: recorded, online },
      )
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
    // Board 25 variants: timed out, reachable but the model isn't listed (warning).
    let errorKind: string | undefined = result.error?.kind
    let detail = result.detail
    if (!result.ok && rec.timedOut) {
      errorKind = "timeout"
      detail = `no response in ${Math.round(timeoutMs / 1000)} s`
    } else if (
      !result.ok &&
      errorKind !== "auth" &&
      rec.listed &&
      p.models.agent &&
      !rec.listed.includes(p.models.agent)
    ) {
      errorKind = "model_missing"
      detail = `${p.models.agent} not in /models`
    }
    if (errorKind !== result.error?.kind || detail !== result.detail)
      result = {
        ...result,
        detail,
        error: new ProviderError((errorKind ?? "unknown") as never, detail, { provider: p.id }),
      }
    const trace: TestTrace | undefined = result.ok
      ? undefined
      : {
          request: rec.request || `${isCloud(p.kind) ? "POST" : "GET"} ${p.baseURL ?? ""}`,
          response: rec.response || `← ${detail}`,
          body: rec.body,
          auth: await authLine(p, draftKey),
        }
    const stored: StoredTest = {
      ok: result.ok,
      latencyMs: result.latencyMs,
      detail,
      ...(errorKind ? { errorKind } : {}),
      ...(rec.status !== undefined && !result.ok ? { status: rec.status } : {}),
      at: now(),
      ...(trace ? { trace } : {}),
    }
    return { result, stored }
  }

  /** A provider row for the Add provider form (not stored). */
  function draftOf(input: AddProviderInput): StoredProvider {
    const base = BUILTIN_PROVIDERS.find((b) => b.id === input.type)
    const models = input.models.map((m) => m.trim()).filter(Boolean)
    const fallback = base?.models ?? { agent: "", fast: "" }
    return {
      id: input.type === "custom" ? "custom:draft" : input.type,
      kind: input.type,
      label: input.label.trim() || (base?.label ?? "Custom endpoint"),
      models: models[0] ? { agent: models[0], fast: models[1] ?? models[0] } : fallback,
      ...(input.type === "custom"
        ? { baseURL: (input.baseURL ?? "").trim(), wire: "openai-chat" as const }
        : {}),
      ...(input.auth ? { auth: input.auth } : {}),
      ...(input.key?.trim() ? {} : { free: true }),
    }
  }

  /**
   * Desktop: the relay injects the key from the keychain by provider id, so a draft's key is
   * stored under a throwaway account (`provider.custom:draft`) for the call and removed after
   * (its origin pin with it). Built-in drafts on desktop need their key saved first.
   */
  async function withDraftKey<T>(
    draft: StoredProvider,
    key: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const stash = deps.platform === "desktop" && !!key && draft.id === "custom:draft"
    if (stash && key) await deps.secrets.set(providerAccount(draft.id), key)
    try {
      return await run()
    } finally {
      if (stash) await deps.secrets.delete(providerAccount(draft.id)).catch(() => {})
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
      // Saving the key clears its origin pin (board 25 rule "Origin pin": re-enter the key).
      const stored = config.providers[p.id]
      if (stored?.pinnedOrigin) {
        const { pinnedOrigin: _o, ...rest } = stored
        config = { ...config, providers: { ...config.providers, [p.id]: rest } }
      }
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
      const { result, stored } = await runTest(p)
      testing[p.id] = false
      config = { ...config, tests: { ...config.tests, [p.id]: stored } }
      const cur = config.providers[p.id]
      if (result.ok && cur) {
        // First successful request pins a custom endpoint's key to its origin (board 25).
        const pin =
          p.kind === "custom" && !keyless(p) && !cur.pinnedOrigin ? originOf(p.baseURL) : null
        const { unverified: _u, ...rest } = cur
        config = {
          ...config,
          providers: {
            ...config.providers,
            [p.id]: { ...rest, ...(pin ? { pinnedOrigin: pin } : {}) },
          },
        }
      }
      if (keyless(p) && result.ok) markConfigured(p.id, true)
      save()
      emit()
      return result
    },
    async testDraft(input) {
      const draft = draftOf(input)
      const key = input.key?.trim()
      return withDraftKey(draft, key, async () => (await runTest(draft, key)).stored)
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
      const prev: StoredProvider = providers[kind] ?? {
        id: kind,
        kind,
        label: "Bedrock · Vertex · Foundry",
        models: (BUILTIN_PROVIDERS.find((b) => b.id === "bedrock") as StoredProvider).models,
      }
      const next: StoredProvider = { ...prev, id: kind, kind }
      for (const k of ["region", "project", "credentials", "profile", "resource"] as const) {
        if (!(k in fields)) continue
        const v = fields[k]?.trim()
        if (v) next[k] = v
        else delete next[k]
      }
      if (fields.model?.trim()) next.models = { ...next.models, agent: fields.model.trim() }
      providers[kind] = next
      config = {
        ...config,
        providers,
        configured: [...config.configured.filter((x) => !CLOUD_IDS.includes(x)), kind],
      }
      save()
      emit()
    },
    async addProvider(input) {
      const models = input.models.map((m) => m.trim()).filter(Boolean)
      const key = input.key?.trim() ?? ""
      let id: string
      if (input.type === "custom") {
        const agent = models[0] ?? ""
        id = await ctl.addCustom({
          label: input.label.trim(),
          baseURL: (input.baseURL ?? "").trim(),
          wire: "openai-chat",
          models: { agent, fast: models[1] ?? agent },
          ...(key ? {} : { free: true }),
        })
        putProvider(id, {
          ...(input.auth ? { auth: input.auth } : {}),
          ...(models.length > 2 ? { extraModels: models.slice(2) } : {}),
          unverified: true,
        })
      } else {
        id = input.type
        putProvider(id, {
          ...(models[0] ? { models: { agent: models[0], fast: models[1] ?? models[0] } } : {}),
          ...(models.length > 2 ? { extraModels: models.slice(2) } : {}),
          unverified: true,
        })
      }
      emit()
      const test = key ? await ctl.setKey(id, key) : await ctl.test(id)
      return { id, test }
    },
    async fetchModels(input) {
      const draft = draftOf(input)
      const key = input.key?.trim()
      return withDraftKey(draft, key, async () => {
        const cfg = await providerConfig(draft, deps.platform === "web" ? key : undefined)
        const provider = createProvider(cfg, {
          platform: deps.platform,
          fetch: deps.fetchFor(draft),
          online,
        })
        return provider.listModels()
      })
    },
    async setAuth(providerId, auth) {
      putProvider(providerId, { auth })
      emit()
    },
    storedOf: (providerId) => config.providers[providerId] ?? rowOf(providerId),
    testOf: (providerId) => config.tests[providerId],
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
      return Promise.all(rows.map((r) => providerConfig(r)))
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
