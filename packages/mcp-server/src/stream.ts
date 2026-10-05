/**
 * Streamed edits (ADR 0013 §4.7): a `kimo_apply_ops` call applied while the model is still
 * writing it. Agents whose provider streams tool input (the built-in agent on Anthropic, OpenAI,
 * Gemini; Claude Code through the editor window) feed the partial input to an
 * {@link ApplyStream}. Each op is applied provisionally as soon as it is complete, through the
 * same validation, scope, approval, feature and batch-limit rules as a whole call, into one
 * provisional op group of the caller's origin. When the call itself arrives, the group is either
 * committed as ONE undo step with the normal result, or rolled back and the call runs the normal
 * way (its input differs, an op failed, the user deleted a parent the ops need, …).
 *
 * This file holds the shared types; the engine lives with the tool handlers
 * (`handlers/stream.ts`) because it reuses their compile and commit code.
 */
import type { PartialEvent } from "./partial-json"

export type StreamState =
  /** Applying ops as they arrive. */
  | "open"
  /** No more provisional ops (an op needs approval or failed, docId missing…); the call decides. */
  | "held"
  /** The call arrived and matched: the group is one undo step now. */
  | "committed"
  /** Provisional ops were undone (stop, retry, a different or failed call). */
  | "rolled-back"

export interface StreamProgress {
  callId: string
  state: StreamState
  /** Ops received complete so far. */
  received: number
  /** Ops applied provisionally (a prefix of `ops`). */
  applied: number
  /** New layers applied so far. */
  inserted: number
  /** The last layer added: where the agent's pointer goes. */
  pointer?: string
  /** Name of the last layer added ("Adding <name>…"). */
  name?: string
  /** Layers the last applied batch inserted or changed. */
  changed: string[]
  /** Why ops stopped being applied (held / rolled back). */
  reason?: string
}

export interface ApplyStream {
  readonly callId: string
  /** Raw partial JSON of the tool input, in order. */
  feed(chunk: string): void
  /** Already-parsed events (a window parses and forwards them to the document host). */
  event(e: PartialEvent): void
  progress(): StreamProgress
  onProgress(listener: (p: StreamProgress) => void): () => void
  /** Resolves when every op received so far was applied (or held). */
  settled(): Promise<void>
  /** Rolls back whatever is provisional (no-op once committed). Idempotent. */
  close(reason?: string): void
  readonly closed: boolean
}

/** The `_meta` key Claude Code sets on `tools/call` with the model's tool-use id. */
export const CLAUDE_CODE_TOOL_USE_META = "claudecode/toolUseId"
