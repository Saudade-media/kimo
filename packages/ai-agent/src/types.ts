/**
 * The provider-neutral message model (ADR 0006 §1, ADR 0014 §2). The agent loop, sessions,
 * skills and modes speak only these types; each adapter maps them to its wire format.
 *
 * Rules:
 * - Messages are append-only. An assistant message keeps the adapter's native content in
 *   {@link AssistantMessage.native} so the same provider + model can replay it byte-for-byte
 *   (Anthropic thinking blocks are bound to the model and the conversation: "preserved
 *   thinking"). Other adapters ignore `native` and use the neutral parts.
 * - Tool calls carry the M5 registry tool name verbatim (`kimo_apply_ops`, …).
 */

import type { WebTool } from "./web"

/** Typed model selection (ADR 0006 §4): never a delimited string. */
export interface ModelSelection {
  /** Configured provider id: `anthropic`, `openai`, `gemini`, `openrouter`, `custom:<slug>`, … */
  provider: string
  model: string
}

/**
 * Board 39 Effort: how hard the model thinks this turn. Each model lists the levels it supports
 * (`effortLevels`); a model with none hides the control.
 */
export type EffortLevel = "low" | "medium" | "high" | "max"

/** Every effort level, lowest first. */
export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "max"]

/**
 * The per-session effort (`thinking` in sessions, turns and requests). Before board 39 it was
 * Off / Auto / Max; `migrateThinking` reads those saved values.
 */
export type ThinkingMode = EffortLevel

/** Saved values from before board 39 (Off / Auto / Max), still read from old sessions. */
export type LegacyThinkingMode = "off" | "auto" | "max"

// --- Content -----------------------------------------------------------------------------------

export interface TextPart {
  type: "text"
  text: string
}

/** png, jpeg or webp, ≤ 5 MB (board 22 attachments). Base64 without a data: prefix. */
export interface ImagePart {
  type: "image"
  mimeType: "image/png" | "image/jpeg" | "image/webp"
  data: string
}

export interface ToolCallPart {
  type: "tool_call"
  /** Provider call id (Anthropic `toolu_…`, OpenAI `call_…`, synthesized for Gemini). */
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultPart {
  type: "tool_result"
  callId: string
  /** Tool name (Gemini needs it on the response part). */
  name: string
  /** The M5 envelope as JSON text (never prose-only). */
  content: string
  images?: ImagePart[]
  isError: boolean
}

/** Reasoning shown in the UI (summaries only; providers never return raw chains of thought). */
export interface ThinkingPart {
  type: "thinking"
  text: string
}

export type UserPart = TextPart | ImagePart
export type AssistantPart = TextPart | ToolCallPart | ThinkingPart

export interface SystemPrompt {
  /** Stable text first (cacheable): base prompt + enabled skills. */
  stable: string
  /** Volatile text after the cache breakpoint (selection summary, date…). */
  volatile?: string
}

export interface UserMessage {
  role: "user"
  content: UserPart[]
}

export interface AssistantMessage {
  role: "assistant"
  content: AssistantPart[]
  /** Adapter-native content for exact replay on the same provider + model. */
  native?: { provider: string; model: string; content: unknown }
}

export interface ToolResultsMessage {
  role: "tool"
  results: ToolResultPart[]
}

export type ChatMessage = UserMessage | AssistantMessage | ToolResultsMessage

// --- Tools -------------------------------------------------------------------------------------

/** A tool offered to the model (from the M5 registry or an agent-only tool such as spawn). */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema in ADR 0013's portable profile (object root, no $ref/oneOf/const). */
  inputSchema: Record<string, unknown>
}

// --- Usage -------------------------------------------------------------------------------------

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Prompt-cache reads (Anthropic `cache_read_input_tokens`, OpenAI `cached_tokens`). */
  cacheReadTokens: number
  /** Prompt-cache writes (Anthropic `cache_creation_input_tokens`). */
  cacheWriteTokens: number
  /** Server-side web searches billed per search (Anthropic `server_tool_use.web_search_requests`). */
  webSearches?: number
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

export function addUsage(a: Usage, b: Usage): Usage {
  const searches = (a.webSearches ?? 0) + (b.webSearches ?? 0)
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    ...(searches ? { webSearches: searches } : {}),
  }
}

// --- Requests and stream events ----------------------------------------------------------------

export interface ProviderRequest {
  model: string
  system: SystemPrompt
  messages: ChatMessage[]
  tools: ToolSpec[]
  thinking: ThinkingMode
  /** Output cap; adapters default per model. */
  maxTokens?: number
  /**
   * Structured output: the final text must be JSON matching this schema (titles, layer names,
   * prompt-node plans). Adapters use native JSON-schema output where they have it.
   */
  responseSchema?: { name: string; schema: Record<string, unknown> }
  /** Cancels the request and the stream (Stop / Esc). */
  signal?: AbortSignal
  /**
   * Board 38: offer the provider's own web tools (server-side search / page fetch) when it has
   * them. Their calls come back as `web_start` / `web_end` events, never as tool calls.
   */
  webAccess?: boolean
}

export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "stop_sequence"
  | "pause_turn"
  | "other"

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; partialJson: string }
  /** A server-side web call (board 38) started, with its input. */
  | { type: "web_start"; id: string; tool: WebTool; input: Record<string, unknown> }
  /** Its result arrived (the provider ran it; nothing for the loop to run). */
  | {
      type: "web_end"
      id: string
      tool: WebTool
      ok: boolean
      /** The call's input when it is only known at the end (OpenAI web_search_call actions). */
      input?: Record<string, unknown>
    }
  /** Live token counts while streaming (board 22 "Streaming" meta). */
  | { type: "usage"; usage: Usage }
  | {
      type: "message_end"
      message: AssistantMessage
      stopReason: StopReason
      usage: Usage
      /** Model that actually served the turn (differs after a server-side fallback). */
      servedBy: string
    }
