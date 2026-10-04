/**
 * The Kimo-owned `Provider` interface (ADR 0006 §1, ADR 0014 §2). Everything above it — the
 * loop, sessions, skills, modes — depends only on this file. Adapters: Anthropic (default,
 * `@anthropic-ai/sdk`), OpenAI-compatible (Chat Completions + Responses), Gemini, OpenRouter,
 * custom endpoints (Ollama, any OpenAI- or Anthropic-compatible server) and the desktop-only
 * cloud platforms (Bedrock, Vertex, Foundry via the Rust relay).
 */
import type { ConfiguredProvider, ModelInfo, ProviderKind } from "../models"
import type { AssistantMessage, ProviderRequest, StopReason, StreamEvent, Usage } from "../types"

/** Where the agent runs. `node` = tests, CLI. */
export type RuntimePlatform = "desktop" | "web" | "node"

/** Host services an adapter may use (injected so adapters stay runtime-neutral and testable). */
export interface ProviderRuntime {
  platform: RuntimePlatform
  /**
   * fetch to use. Desktop: the platform relay (`@kimo/platform` `createRelayFetch`), which adds
   * the key from the keychain in Rust and bypasses CORS; web/node: global fetch.
   */
  fetch: typeof fetch
  /** `navigator.onLine` on web; true elsewhere unless the platform says otherwise. */
  online(): boolean
}

/** One configured provider as the adapters see it (Settings › AI providers row). */
export interface ProviderConfig extends ConfiguredProvider {
  /** Overrides the family's default base URL (custom endpoints, Ollama, proxies). */
  baseURL?: string
  /**
   * API key for web and node. Desktop leaves it undefined: the relay injects the key from the
   * keychain (`kimo` / `provider.<id>`), so the key never enters JS.
   */
  apiKey?: string
  /** Anthropic on web: the explicit browser opt-in (`dangerouslyAllowBrowser`). */
  allowBrowser?: boolean
  /** `custom` only: which wire format the endpoint speaks. */
  wire?: "openai-chat" | "openai-responses" | "anthropic"
  /** `openai` only: Chat Completions (default) or Responses. */
  api?: "chat" | "responses"
  /** Extra request headers (OpenRouter attribution, proxies). Never secrets on desktop. */
  headers?: Record<string, string>
  /** Local runtime with no billing (Ollama): cost estimates are $0. */
  free?: boolean
  /** Anthropic first-party only: send `fallbacks: "default"` (server-side refusal fallback). */
  refusalFallback?: boolean
}

export interface ConnectionTest {
  ok: boolean
  latencyMs: number
  /** "claude-opus-5-5 reachable · tools + streaming" */
  detail: string
  error?: import("../errors").ProviderError
}

export interface Provider {
  readonly id: string
  readonly kind: ProviderKind
  readonly config: ProviderConfig
  /** Streams one model call. Throws {@link import("../errors").ProviderError} (never raw SDK errors). */
  stream(request: ProviderRequest): AsyncIterable<StreamEvent>
  /** Model ids the endpoint lists (open families feed `extraModels`). */
  listModels(signal?: AbortSignal): Promise<string[]>
  /** Settings "Test": models list + a 1-token tool call (board 22 pane rules). */
  test(signal?: AbortSignal): Promise<ConnectionTest>
  /** Capabilities of a model id at this provider. */
  modelInfo(model: string): ModelInfo
}

export interface CompleteResult {
  message: AssistantMessage
  text: string
  stopReason: StopReason
  usage: Usage
  servedBy: string
}

/** Drains a stream into the final message (titles, summaries, structured output). */
export async function complete(
  provider: Provider,
  request: ProviderRequest,
): Promise<CompleteResult> {
  let end: Extract<StreamEvent, { type: "message_end" }> | undefined
  for await (const e of provider.stream(request)) if (e.type === "message_end") end = e
  if (!end) throw new Error(`${provider.id}: stream ended without a final message`)
  const text = end.message.content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("")
  return {
    message: end.message,
    text,
    stopReason: end.stopReason,
    usage: end.usage,
    servedBy: end.servedBy,
  }
}

// --- Browser support matrix (board 22 "Browser support matrix", teardown 9.2) -----------------

export type Reach = "direct" | "opt-in" | "proxy" | "none"

export interface ReachRow {
  kind: ProviderKind
  label: string
  web: Reach
  desktop: Reach
  how: string
}

/** Published per-provider matrix. Desktop always goes through the Rust relay (no CORS). */
export const BROWSER_SUPPORT: readonly ReachRow[] = [
  {
    kind: "anthropic",
    label: "Anthropic",
    web: "opt-in",
    desktop: "direct",
    how: "Browser calls need the explicit opt-in (dangerouslyAllowBrowser); the key is visible to page scripts.",
  },
  {
    kind: "openai",
    label: "OpenAI-compatible",
    web: "proxy",
    desktop: "direct",
    how: "CORS varies per endpoint; tested by Test connection, else use desktop or a local proxy.",
  },
  {
    kind: "gemini",
    label: "Google Gemini",
    web: "direct",
    desktop: "direct",
    how: "Direct from the browser with the key.",
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    web: "direct",
    desktop: "direct",
    how: "Direct; CORS allowed.",
  },
  {
    kind: "custom",
    label: "Custom · Ollama",
    web: "proxy",
    desktop: "direct",
    how: "localhost needs OLLAMA_ORIGINS to allow the Kimo origin.",
  },
  {
    kind: "bedrock",
    label: "Bedrock · Vertex · Foundry",
    web: "none",
    desktop: "direct",
    how: "Signed / OAuth credentials: desktop (Rust-side HTTP) or a user-run proxy only.",
  },
  {
    kind: "vertex",
    label: "Bedrock · Vertex · Foundry",
    web: "none",
    desktop: "direct",
    how: "Signed / OAuth credentials: desktop (Rust-side HTTP) or a user-run proxy only.",
  },
  {
    kind: "foundry",
    label: "Bedrock · Vertex · Foundry",
    web: "none",
    desktop: "direct",
    how: "Signed / OAuth credentials: desktop (Rust-side HTTP) or a user-run proxy only.",
  },
]

export function reachFor(kind: ProviderKind, platform: RuntimePlatform): Reach {
  const row = BROWSER_SUPPORT.find((r) => r.kind === kind)
  if (!row) return "none"
  return platform === "web" ? row.web : row.desktop
}

/**
 * Whether a provider can be called on this platform right now. Web: Anthropic needs the opt-in,
 * cloud platforms never work; "proxy" rows are allowed (Test tells the truth about CORS).
 */
export function availableOn(
  config: Pick<ProviderConfig, "kind" | "allowBrowser" | "baseURL">,
  platform: RuntimePlatform,
): { ok: true } | { ok: false; reason: string } {
  const reach = reachFor(config.kind, platform)
  if (reach === "none")
    return { ok: false, reason: "Desktop only: signed credentials go through Rust-side HTTP." }
  if (reach === "opt-in" && platform === "web" && !config.allowBrowser)
    return {
      ok: false,
      reason:
        "Allow Anthropic calls from the browser in Settings › AI providers (required by Anthropic for direct browser access).",
    }
  return { ok: true }
}
