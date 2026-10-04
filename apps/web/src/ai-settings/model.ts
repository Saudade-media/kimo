/**
 * Settings › AI providers model (board 22 hxt9h, board 23 g6AqH): the built-in provider rows,
 * the persisted non-secret config (`kimo.ai` — keys never live here), CLI row copy, the default
 * precedence strip, usage-to-date aggregation and copy helpers. Pure: no DOM, no platform.
 */
import {
  type CliDetection,
  type ConnectionTest,
  cliIdOf,
  cliProviderId,
  cliUsable,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER_ID,
  type GenericCliConfig,
  isCliProvider,
  MODEL_CATALOG,
  type ModelSelection,
  type ProviderKind,
  pickDefaultSelection,
} from "@kimo/ai-agent"
import { AGENT_USAGE_DEFAULTS, type AgentUsageSettings } from "../platform/contract"

// --- Persisted config ---------------------------------------------------------------------------

/** One provider row as stored (no secret). Built-in rows exist even when never stored. */
export interface StoredProvider {
  id: string
  kind: ProviderKind
  label: string
  baseURL?: string
  models: { agent: string; fast: string }
  extraModels?: string[]
  /** Anthropic on web: the browser opt-in. */
  allowBrowser?: boolean
  wire?: "openai-chat" | "openai-responses" | "anthropic"
  api?: "chat" | "responses"
  /** No key needed (Ollama / local endpoints): cost estimates $0. */
  free?: boolean
  /** Cloud platforms (relay routing). */
  region?: string
  project?: string
  /** User-added custom endpoint (removable). */
  custom?: boolean
}

/** One finished turn's usage, fed by the agent panel ({@link AiConfig.ledger}). */
export interface UsageEntry {
  at: number
  provider: string
  label: string
  tokens: number
  /** Estimated USD; null = unknown price; subscription CLIs record null with billing set. */
  costUsd: number | null
  billing: "api" | "subscription" | "cli-api-key" | "local"
  sessionId: string
}

export interface StoredTest {
  ok: boolean
  latencyMs: number
  detail: string
  errorKind?: string
  at: number
}

export interface AiConfig {
  version: 1
  /** Overrides of built-in rows + user-added custom endpoints, by id. */
  providers: Record<string, StoredProvider>
  /** Rows whose key/config the user explicitly saved (built-in rows show "Not set" otherwise). */
  configured: string[]
  settings: AgentUsageSettings
  ledger: UsageEntry[]
  tests: Record<string, StoredTest>
  /** Home "Design by hand instead": dismissed until a provider is added. */
  homeCardDismissed: boolean
  genericClis: GenericCliConfig[]
}

/** localStorage key of the non-secret AI config (both hosts; keys live in `SecretsApi`). */
export const AI_CONFIG_KEY = "kimo.ai"

export function emptyConfig(): AiConfig {
  return {
    version: 1,
    providers: {},
    configured: [],
    settings: { ...AGENT_USAGE_DEFAULTS },
    ledger: [],
    tests: {},
    homeCardDismissed: false,
    genericClis: [],
  }
}

/** Lenient read: anything malformed falls back to the empty config. */
export function parseConfig(raw: string | null): AiConfig {
  const base = emptyConfig()
  if (!raw) return base
  try {
    const v = JSON.parse(raw) as Partial<AiConfig>
    if (!v || typeof v !== "object" || v.version !== 1) return base
    return {
      version: 1,
      providers: v.providers && typeof v.providers === "object" ? v.providers : {},
      configured: Array.isArray(v.configured)
        ? v.configured.filter((x) => typeof x === "string")
        : [],
      settings: { ...base.settings, ...(v.settings ?? {}) },
      ledger: Array.isArray(v.ledger) ? v.ledger : [],
      tests: v.tests && typeof v.tests === "object" ? v.tests : {},
      homeCardDismissed: v.homeCardDismissed === true,
      genericClis: Array.isArray(v.genericClis) ? v.genericClis : [],
    }
  } catch {
    return base
  }
}

// --- Built-in rows ------------------------------------------------------------------------------

export const ANTHROPIC_URL = "https://api.anthropic.com"
export const OPENAI_URL = "https://api.openai.com/v1"
export const GEMINI_URL = "https://generativelanguage.googleapis.com"
export const OPENROUTER_URL = "https://openrouter.ai/api/v1"
export const OLLAMA_URL = "http://localhost:11434/v1"
export const OLLAMA_ID = "custom:ollama"

/** Board 23 order: Anthropic, OpenAI-compatible, Gemini, OpenRouter, Custom · Ollama, cloud. */
export const BUILTIN_PROVIDERS: readonly StoredProvider[] = [
  {
    id: "anthropic",
    kind: "anthropic",
    label: "Anthropic",
    models: DEFAULT_MODELS.anthropic ?? { agent: "", fast: "" },
  },
  {
    id: "openai",
    kind: "openai",
    label: "OpenAI-compatible",
    models: DEFAULT_MODELS.openai ?? { agent: "", fast: "" },
  },
  {
    id: "gemini",
    kind: "gemini",
    label: "Google Gemini",
    models: DEFAULT_MODELS.gemini ?? { agent: "", fast: "" },
  },
  { id: "openrouter", kind: "openrouter", label: "OpenRouter", models: { agent: "", fast: "" } },
  {
    id: OLLAMA_ID,
    kind: "custom",
    label: "Custom endpoint · Ollama",
    baseURL: OLLAMA_URL,
    wire: "openai-chat",
    free: true,
    models: { agent: "", fast: "" },
  },
  {
    id: "bedrock",
    kind: "bedrock",
    label: "Bedrock · Vertex · Foundry",
    models: DEFAULT_MODELS.bedrock ?? { agent: "", fast: "" },
  },
]

/** Lucide icon names per row (board 23 V2yoe overrides). */
export const PROVIDER_ICON: Record<ProviderKind, string> = {
  anthropic: "sparkle",
  openai: "braces",
  gemini: "gem",
  openrouter: "route",
  custom: "server",
  bedrock: "cloud",
  vertex: "cloud",
  foundry: "cloud",
}

export const isCloud = (k: ProviderKind): k is "bedrock" | "vertex" | "foundry" =>
  k === "bedrock" || k === "vertex" || k === "foundry"

/** Rows shown in the pane: built-ins (with stored overrides) then custom endpoints. */
export function providerRows(config: AiConfig): StoredProvider[] {
  const builtins = BUILTIN_PROVIDERS.map((b) => {
    // The cloud row stores whichever platform the user set up (bedrock | vertex | foundry).
    const stored =
      b.id === "bedrock"
        ? (config.providers.bedrock ?? config.providers.vertex ?? config.providers.foundry)
        : config.providers[b.id]
    return stored ? { ...b, ...stored, label: b.label } : b
  })
  const customs = Object.values(config.providers).filter((p) => p.custom)
  return [...builtins, ...customs]
}

export function keyless(p: Pick<StoredProvider, "kind" | "free">): boolean {
  return p.free === true || isCloud(p.kind)
}

// --- Copy -----------------------------------------------------------------------------------------

/** "api.openai.com/v1" (scheme dropped for https, kept for http like the board). */
export function hostOf(url: string): string {
  return url.startsWith("https://") ? url.slice(8).replace(/\/$/, "") : url.replace(/\/$/, "")
}

export function defaultBaseURL(p: Pick<StoredProvider, "kind" | "id">): string {
  switch (p.kind) {
    case "anthropic":
      return ANTHROPIC_URL
    case "openai":
      return OPENAI_URL
    case "gemini":
      return GEMINI_URL
    case "openrouter":
      return OPENROUTER_URL
    case "custom":
      return OLLAMA_URL
    default:
      return ""
  }
}

const WIRE_LABEL = {
  "openai-chat": "OpenAI-compatible",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic-compatible",
} as const

/** The mono meta line under a provider name (board 23 YxpAP overrides). */
export function providerMeta(p: StoredProvider, opts: { isApiDefault: boolean }): string {
  if (isCloud(p.kind)) return "Signed credentials · routed through Rust-side HTTP"
  const url = hostOf(p.baseURL ?? defaultBaseURL(p))
  switch (p.kind) {
    case "anthropic":
      return opts.isApiDefault
        ? `API default · ${p.models.agent} · used when no CLI is signed in`
        : `${url} · ${p.models.agent}`
    case "openai":
      return `${url} · Chat Completions + Responses`
    case "gemini":
      return url
    case "openrouter":
      return `${url} · OpenAI-compatible`
    default:
      return `${url} · ${WIRE_LABEL[p.wire ?? "openai-chat"]}`
  }
}

export type PillTone = "success" | "warning" | "neutral" | "danger"

/** Status pill per row status (board 23 ADF2h overrides). */
export function providerPill(status: string): { tone: PillTone; label: string } {
  switch (status) {
    case "connected":
      return { tone: "success", label: "Connected" }
    case "key-saved":
      return { tone: "success", label: "Key saved" }
    case "local":
      return { tone: "success", label: "Local · no key" }
    case "desktop-only":
      return { tone: "warning", label: "Desktop only" }
    case "failed":
      return { tone: "danger", label: "Test failed" }
    default:
      return { tone: "neutral", label: "Not set" }
  }
}

/** Masked key (board 23 o1wfg: prefix, 18 bullets on desktop / 10 on web, last 4). */
export function maskKey(kind: ProviderKind, hint: string, platform: "desktop" | "web"): string {
  const prefix =
    kind === "anthropic"
      ? "sk-ant-api03-"
      : kind === "openrouter"
        ? "sk-or-v1-"
        : kind === "openai"
          ? "sk-"
          : kind === "gemini"
            ? "AIza"
            : ""
  return `${prefix}${"•".repeat(platform === "desktop" ? 18 : 10)}${hint}`
}

/** "Paste your Anthropic key (sk-ant-…)" (board 22 OlFwb). */
export function keyPlaceholder(p: Pick<StoredProvider, "kind" | "label">): string {
  switch (p.kind) {
    case "anthropic":
      return "Paste your Anthropic key (sk-ant-…)"
    case "openai":
      return "Paste your OpenAI key (sk-…)"
    case "gemini":
      return "Paste your Gemini key (AIza…)"
    case "openrouter":
      return "Paste your OpenRouter key (sk-or-…)"
    default:
      return `Paste your ${p.label} key`
  }
}

/** "Get a key at console.anthropic.com ↗" (board 22 op3mJ). */
export const KEY_PAGES: Partial<Record<ProviderKind, string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
}

export function storageLabel(
  providerId: string,
  backend: "keychain" | "localStorage" | "memory",
  os: string,
): string {
  if (backend === "localStorage") return "localStorage · kimo.providers (this origin only)"
  const store =
    os === "windows"
      ? "Windows Credential Manager"
      : os === "linux"
        ? "Secret Service"
        : "macOS Keychain"
  return `Stored in ${store} · service kimo, account provider.${providerId}`
}

export function testDetail(t: Pick<ConnectionTest, "ok" | "latencyMs" | "detail">): string {
  return t.ok ? `${t.latencyMs} ms · ${t.detail}` : t.detail
}

/** Inline test result label (board 22 "Test" rule: OK · 401 · 429 · network / CORS). */
export function testLabel(t: { ok: boolean; errorKind?: string }): string {
  if (t.ok) return "Connection OK"
  switch (t.errorKind) {
    case "auth":
      return "Invalid key (401)"
    case "rate_limit":
      return "Rate limited (429)"
    case "cors":
      return "Blocked by CORS"
    case "network":
    case "offline":
      return "Network error"
    case "unsupported_platform":
      return "Not available here"
    default:
      return "Connection failed"
  }
}

// --- Local agents ------------------------------------------------------------------------------

export const CLI_ICON: Record<string, string> = {
  "claude-code": "square-terminal",
  codex: "terminal",
  "gemini-cli": "square-chevron-right",
}

/** "Sign in in terminal: run “codex login”" — the exact command per CLI. */
export const CLI_SIGN_IN: Record<string, string> = {
  "claude-code": "claude auth login",
  codex: "codex login",
  "gemini-cli": "gemini",
}

export const CLI_INSTALL_GUIDE: Record<string, string> = {
  "claude-code": "https://docs.claude.com/en/docs/claude-code/setup",
  codex: "https://developers.openai.com/codex/cli",
  "gemini-cli": "https://github.com/google-gemini/gemini-cli#installation",
}

/** Row name: "Claude Code CLI", "Codex CLI", "Gemini CLI". */
export function cliName(d: Pick<CliDetection, "label">): string {
  return /\bCLI$/.test(d.label) ? d.label : `${d.label} CLI`
}

export type CliState = "signed-in" | "not-signed-in" | "unknown" | "not-found"

export function cliState(d: CliDetection): CliState {
  if (!d.installed) return "not-found"
  if (d.signedIn === true) return "signed-in"
  if (d.signedIn === false) return "not-signed-in"
  return "unknown"
}

export function cliPill(d: CliDetection): { tone: PillTone; label: string } {
  switch (cliState(d)) {
    case "signed-in":
      return { tone: "success", label: "Signed in" }
    case "not-signed-in":
      return { tone: "warning", label: "Not signed in" }
    case "unknown":
      return { tone: "warning", label: "Sign-in unknown" }
    default:
      return { tone: "neutral", label: "Not found" }
  }
}

const PLAN_LABEL: Record<string, string> = {
  max: "Claude Max plan",
  pro: "Claude Pro plan",
  team: "Claude Team plan",
  enterprise: "Claude Enterprise plan",
}

/** `/Users/me/.local/bin/claude` → `~/.local/bin/claude`. */
export function tildify(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  const m = /^\/(?:Users|home)\/[^/]+(\/.*)?$/.exec(path)
  return m ? `~${m[1] ?? ""}` : path
}

/** Mono meta: "claude 2.1.4 · ~/.local/bin/claude · Claude Max plan" (board 23 mOc0k). */
export function cliMeta(d: CliDetection, command: string, home: string | null): string {
  if (!d.installed) return "Not on PATH · install it, then Re-check"
  const parts = [d.version ? `${command} ${d.version}` : command]
  if (d.path) parts.push(tildify(d.path, home))
  if (d.signedIn === true) {
    if (d.plan) parts.push(PLAN_LABEL[d.plan] ?? `${d.plan} plan`)
    else if (d.billing === "cli-api-key") parts.push("API key")
    else if (d.account) parts.push(d.account)
  }
  return parts.join(" · ")
}

/** Contract `CliAgentRowView.status`. */
export function cliStatusText(d: CliDetection): string {
  switch (cliState(d)) {
    case "signed-in":
      return ["Signed in", d.plan, d.account].filter(Boolean).join(" · ")
    case "not-signed-in":
    case "unknown":
      return `Not signed in — run \`${CLI_SIGN_IN[d.id] ?? d.id}\``
    default:
      return "Not found"
  }
}

// --- Default precedence -----------------------------------------------------------------------

export interface UsableApi {
  id: string
  agentModel: string
}

/** The selection a new session gets (ADR 0014 §11 precedence; Settings "Default" overrides). */
export function defaultSelection(input: {
  platform: "desktop" | "web"
  clis: readonly CliDetection[]
  apis: readonly UsableApi[]
  preferred: ModelSelection | null
}): ModelSelection | null {
  return pickDefaultSelection({
    platform: input.platform,
    clis: input.clis,
    apiProviders: [...input.apis].sort(
      (a, b) => Number(b.id === DEFAULT_PROVIDER_ID) - Number(a.id === DEFAULT_PROVIDER_ID),
    ),
    ...(input.preferred ? { preferred: input.preferred } : {}),
  })
}

/** "Agent ready · Claude Code (subscription)" / "Agent ready · Anthropic (API key)" / off. */
export function agentStatus(
  sel: ModelSelection | null,
  labelOf: (provider: string) => string,
  clis: readonly CliDetection[],
): { tone: PillTone; label: string } {
  if (!sel) return { tone: "neutral", label: "Agent off · add a provider" }
  if (isCliProvider(sel.provider)) {
    const d = clis.find((c) => c.id === cliIdOf(sel.provider))
    const billing = d?.billing === "cli-api-key" ? "API key" : "subscription"
    return {
      tone: "success",
      label: `Agent ready · ${d?.label ?? labelOf(sel.provider)} (${billing})`,
    }
  }
  return { tone: "success", label: `Agent ready · ${labelOf(sel.provider)} (API key)` }
}

/** Short model label for composers: "Opus 5.5", "gpt-4.1", "Claude Code". */
export function shortModelLabel(sel: ModelSelection | null, clis: readonly CliDetection[]): string {
  if (!sel) return "No model"
  if (isCliProvider(sel.provider)) {
    const d = clis.find((c) => c.id === cliIdOf(sel.provider))
    return sel.model === "default" ? (d?.label ?? cliIdOf(sel.provider)) : sel.model
  }
  for (const list of Object.values(MODEL_CATALOG)) {
    const m = list.find((x) => x.id === sel.model)
    if (m) return m.label.replace(/^Claude /, "")
  }
  return sel.model
}

export const usableCliSelection = (d: CliDetection): ModelSelection | null =>
  cliUsable(d) ? { provider: cliProviderId(d.id), model: "default" } : null

// --- Usage -----------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function monthBounds(now: number): { start: number; end: number; label: string } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const last = new Date(end.getTime() - 1).getDate()
  const m = MONTHS[d.getMonth()] ?? ""
  return { start: start.getTime(), end: end.getTime(), label: `${m} 1 – ${m} ${last}` }
}

export interface UsageSummary {
  period: string
  costUsd: number
  tokens: number
  sessions: number
  byProvider: {
    provider: string
    label: string
    costUsd: number | null
    tokens: number
    billing: UsageEntry["billing"]
  }[]
}

/** Sum of this month's usage events per provider (board 22 "Usage" rule: resets on the 1st). */
export function monthUsage(ledger: readonly UsageEntry[], now: number): UsageSummary {
  const { start, end, label } = monthBounds(now)
  const rows = new Map<string, UsageSummary["byProvider"][number]>()
  const sessions = new Set<string>()
  let costUsd = 0
  let tokens = 0
  for (const e of ledger) {
    if (e.at < start || e.at >= end) continue
    sessions.add(e.sessionId)
    tokens += e.tokens
    if (e.costUsd !== null && e.billing === "api") costUsd += e.costUsd
    const r = rows.get(e.provider) ?? {
      provider: e.provider,
      label: e.label,
      costUsd: e.billing === "subscription" ? null : 0,
      tokens: 0,
      billing: e.billing,
    }
    r.tokens += e.tokens
    if (r.costUsd !== null && e.costUsd !== null) r.costUsd += e.costUsd
    rows.set(e.provider, r)
  }
  return {
    period: label,
    costUsd,
    tokens,
    sessions: sessions.size,
    byProvider: [...rows.values()].sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1)),
  }
}

/** Ledger entries older than 13 months are dropped on write. */
export function pruneLedger(ledger: readonly UsageEntry[], now: number): UsageEntry[] {
  const cutoff = now - 400 * 24 * 3600 * 1000
  return ledger.filter((e) => e.at >= cutoff)
}

/** "$18.42" for the big number; amount field value "50.00". */
export const money = (usd: number): string => `$${usd.toFixed(2)}`
export const amount = (usd: number): string => usd.toFixed(2)

export function parseAmount(raw: string): number | null {
  const v = Number(raw.replace(/[$,\s]/g, ""))
  return Number.isFinite(v) && v >= 0 && v <= 100_000 ? Math.round(v * 100) / 100 : null
}

/** A model-suggested title as a safe file name ("Pricing page"); null when nothing is left. */
export function sanitizeTitle(raw: string): string | null {
  const printable = [...raw].map((c) => ((c.codePointAt(0) ?? 0) < 32 ? " " : c)).join("")
  const t = printable
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/^["'“”‘’\s.]+|["'“”‘’\s.]+$/g, "")
    .replace(/\.kimo$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim()
  return t ? t : null
}
