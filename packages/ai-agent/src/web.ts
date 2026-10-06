/**
 * Web access for the built-in agent (board 38 "Web access"). On by default (Settings › AI
 * providers › Allow web access, `ai.webAccess`), off for a session from the composer, and off
 * everywhere while No third-party fetch is on.
 *
 * What each provider gets when it is on:
 * - Claude Code: its own WebSearch and WebFetch tools (`--tools`, `--allowedTools`).
 * - Codex CLI: its live web_search tool (`-c web_search="live"`; "disabled" when off, because
 *   Codex defaults to cached search).
 * - Gemini CLI: google_web_search and web_fetch (both excluded when off).
 * - Anthropic API: the server tools web_search and web_fetch ({@link anthropicWebTools}).
 * - OpenAI API: the Responses API web_search tool. Chat Completions has none.
 * - Gemini API, OpenRouter, custom endpoints, Bedrock: none in this release.
 *
 * Every search and page read is one step (AgentStep row + status line) and one {@link WebStep}
 * in the turn record, so it survives in the session transcript.
 */
import type { ProviderKind } from "./models"

/** The two web tools, as the panel and the Activity log name them. */
export type WebTool = "web_search" | "web_fetch"

/** One search or page read of a turn (session transcript, board 38 §3). */
export interface WebStep {
  callId: string
  tool: WebTool
  /** Done label: `Searched the web for “q”` / `Read example.com`. */
  label: string
  /** The query or the URL. */
  detail: string
  ok: boolean
}

/** A web step for the Activity log (desktop): one row, no Undo. */
export interface WebNote {
  tool: WebTool
  /** The done label ("Read example.com"). */
  summary: string
  /** The query or the URL (the row's target line). */
  detail: string
  ok: boolean
}

/** The finished step of a web call: its transcript entry. */
export function webStep(
  callId: string,
  tool: WebTool,
  input: Record<string, unknown>,
  ok: boolean,
): WebStep {
  return { callId, tool, label: webLabel(tool, input, "done"), detail: webDetail(tool, input), ok }
}

/** The web tool a provider's tool name stands for (CLI and API spellings), else null. */
export function webToolOf(name: string): WebTool | null {
  switch (name) {
    case "WebSearch":
    case "web_search":
    case "google_web_search":
      return "web_search"
    case "WebFetch":
    case "web_fetch":
      return "web_fetch"
    default:
      return null
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** First http(s) URL in a text (Gemini CLI's web_fetch takes a prompt with URLs in it). */
function firstUrl(text: string): string {
  return /https?:\/\/[^\s"'<>)]+/.exec(text)?.[0] ?? ""
}

/** "example.com" from a URL ("www." dropped); the text itself when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** The query or URL of a web call's input. */
export function webDetail(tool: WebTool, input: Record<string, unknown>): string {
  if (tool === "web_search") return str(input.query)
  return str(input.url) || firstUrl(str(input.prompt)) || firstUrl(str(input.query))
}

const MAX_QUERY = 60

function quoted(q: string): string {
  const t = q.length > MAX_QUERY ? `${q.slice(0, MAX_QUERY - 1).trimEnd()}…` : q
  return `“${t}”`
}

/**
 * Step label of a web call (board 38 §3). Running: "Searching the web for “q”" / "Reading
 * example.com" (the panel adds the ellipsis). Done: "Searched the web for “q”" / "Read
 * example.com".
 */
export function webLabel(
  tool: WebTool,
  input: Record<string, unknown>,
  state: "running" | "done",
): string {
  const d = webDetail(tool, input)
  if (tool === "web_search") {
    const verb = state === "running" ? "Searching the web" : "Searched the web"
    return d ? `${verb} for ${quoted(d)}` : verb
  }
  const verb = state === "running" ? "Reading" : "Read"
  return d ? `${verb} ${hostOf(d)}` : `${verb} a page`
}

/** Prompt text when web access is on (stable part: it changes only per session). */
export const WEB_PROMPT =
  "You can search the web and read pages. Use them only when the task needs facts from outside the document, such as current product details, a brand's colors or a library's defaults. Never paste page text into the design: take the facts you need and write the copy yourself. End your reply with “Sources:” and the URLs you used, one per line, as plain links."

/** The built-in CLIs that have web tools (a generic "Add CLI agent" one has none). */
const WEB_CLIS = new Set(["cli:claude-code", "cli:codex", "cli:gemini-cli"])

/**
 * Whether the model a session uses can reach the web (board 38 D: no → the composer's globe
 * is disabled with "This model can't use the web"). `config` is the API provider row of
 * `provider`, absent for CLIs.
 */
export function webSupported(
  selection: { provider: string; model: string },
  config?: { kind: ProviderKind; baseURL?: string; api?: "chat" | "responses" } | null,
): boolean {
  if (selection.provider.startsWith("cli:")) return WEB_CLIS.has(selection.provider)
  if (!config) return false
  if (config.kind === "openai") return config.api === "responses"
  const first = !config.baseURL || config.baseURL === "https://api.anthropic.com"
  const tools = anthropicWebTools(config.kind, selection.model, first)
  return !!(tools.search || tools.fetch)
}

/** Anthropic server tool versions per model and platform (`platform-availability`). */
export function anthropicWebTools(
  kind: ProviderKind,
  model: string,
  firstParty: boolean,
): { search?: string; fetch?: string } {
  // Dynamic filtering (_20260209) on Opus/Sonnet 4.6 and later; basic versions elsewhere.
  const modern = /^claude-(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])/.test(model)
  const search = modern ? "web_search_20260209" : "web_search_20250305"
  const fetch = modern ? "web_fetch_20260209" : "web_fetch_20250910"
  switch (kind) {
    case "anthropic":
      return firstParty ? { search, fetch } : {}
    case "foundry":
      return { search: "web_search_20250305", fetch: "web_fetch_20250910" }
    case "vertex":
      return { search: "web_search_20250305" }
    default:
      return {}
  }
}

/** USD per web search on the Anthropic API ($10 per 1,000). */
export const ANTHROPIC_SEARCH_USD = 0.01
