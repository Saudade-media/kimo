/**
 * Agent sessions (board 22 "Sessions", ADR 0014 §7). Sessions live in app data — desktop
 * `~/.kimo/sessions/<fileId>/<sessionId>.json`, web IndexedDB `kimo-sessions` — and never in
 * the `.kimo` file. Per file, newest first, then other files; searchable by title and content.
 */
import type { CliBilling } from "./cli/types"
import type { TurnRecord } from "./loop"
import { DEFAULT_MODE, type ModeConfig } from "./modes"
import type { ChatMessage, ModelSelection, ThinkingMode, Usage, UserMessage } from "./types"
import { ZERO_USAGE } from "./types"

export const SESSION_LOCATIONS = {
  desktop: "~/.kimo/sessions/<fileId>/<sessionId>.json",
  web: "IndexedDB database kimo-sessions, store sessions (key: id, index: fileId)",
} as const

export type SessionOrigin = "panel" | "home" | "prompt-node"

export interface SessionMeta {
  id: string
  /** Same id as leases/recovery/activity: sha256(path)[:16], or `untitled-<docId>`. */
  fileId: string
  fileName: string
  /** Named by the fast model after turn 1; "New session" before. */
  title: string
  createdAt: number
  updatedAt: number
  model: ModelSelection
  thinking: ThinkingMode
  mode: ModeConfig
  origin: SessionOrigin
  enabledSkills: string[]
  messageCount: number
  usage: Usage
  /** Estimated USD (API providers), null when unknown; subscription CLIs report no dollars. */
  costUsd: number | null
  billing: CliBilling | "api"
  /** Number of agents for side by side / split sessions. */
  agents?: number
}

export interface Session extends SessionMeta {
  turns: TurnRecord[]
  /** Local-CLI sessions: the CLI's own session id for resume. */
  cliSessionId?: string
}

export interface SessionStore {
  /** Newest first. With fileId: that file's sessions only. */
  list(fileId?: string): Promise<SessionMeta[]>
  get(id: string): Promise<Session | null>
  put(session: Session): Promise<void>
  delete(id: string): Promise<void>
  /** Title and message text, case-insensitive. */
  search(query: string): Promise<SessionMeta[]>
}

export function newSessionId(random: () => number = Math.random): string {
  let s = ""
  for (let i = 0; i < 6; i++) s += Math.floor(random() * 36).toString(36)
  return s
}

export function newSession(init: {
  id?: string
  fileId: string
  fileName: string
  model: ModelSelection
  thinking?: ThinkingMode
  mode?: ModeConfig
  origin?: SessionOrigin
  enabledSkills?: string[]
  billing?: SessionMeta["billing"]
  now?: number
}): Session {
  const now = init.now ?? Date.now()
  return {
    id: init.id ?? newSessionId(),
    fileId: init.fileId,
    fileName: init.fileName,
    title: "New session",
    createdAt: now,
    updatedAt: now,
    model: init.model,
    thinking: init.thinking ?? "auto",
    mode: init.mode ?? DEFAULT_MODE,
    origin: init.origin ?? "panel",
    enabledSkills: init.enabledSkills ?? ["kimo-design"],
    messageCount: 0,
    usage: { ...ZERO_USAGE },
    costUsd: 0,
    billing: init.billing ?? "api",
    turns: [],
  }
}

/** The conversation so far (append-only concatenation of the turns' messages). */
export function historyOf(session: Pick<Session, "turns">): ChatMessage[] {
  return session.turns.flatMap((t) => t.messages)
}

/** Appends a finished turn and updates the meta totals. */
export function appendTurn(session: Session, turn: TurnRecord, now = Date.now()): Session {
  const usage = {
    inputTokens: session.usage.inputTokens + turn.usage.inputTokens,
    outputTokens: session.usage.outputTokens + turn.usage.outputTokens,
    cacheReadTokens: session.usage.cacheReadTokens + turn.usage.cacheReadTokens,
    cacheWriteTokens: session.usage.cacheWriteTokens + turn.usage.cacheWriteTokens,
  }
  const costUsd =
    session.costUsd === null || turn.cost.usd === null ? null : session.costUsd + turn.cost.usd
  return {
    ...session,
    turns: [...session.turns, turn],
    usage,
    costUsd,
    updatedAt: now,
    messageCount: session.messageCount + turn.messages.filter((m) => m.role !== "tool").length,
  }
}

export interface RegeneratePlan {
  /** kimo_history undo calls, newest op group first. */
  undo: { docId: string; token: string }[]
  prompt: UserMessage
  model: ModelSelection
  thinking: ThinkingMode
  /** Session without the regenerated turn (the new turn is appended after it). */
  rest: Session
}

/**
 * Regenerate = undo that turn's op group(s), then resend the same prompt and model (board 22
 * "Message meta"). Only the last turn: an older turn's groups are no longer on top of the undo
 * stack (`kimo_history` with token refuses), so the UI disables regenerate there.
 */
export function planRegenerate(session: Session, turnId: string): RegeneratePlan | null {
  const last = session.turns[session.turns.length - 1]
  if (!last || last.id !== turnId) return null
  const prompt = last.messages[0]
  if (prompt?.role !== "user") return null
  return {
    undo: [...last.opGroups].reverse().map((g) => ({ docId: g.docId, token: g.undoToken })),
    prompt,
    model: last.model,
    thinking: last.thinking,
    rest: { ...session, turns: session.turns.slice(0, -1) },
  }
}

/** kimo_history inputs for {@link RegeneratePlan.undo} / "Undo turn". */
export function undoCallInputs(undo: RegeneratePlan["undo"]): Record<string, unknown>[] {
  return undo.map((u) => ({ docId: u.docId, action: "undo", token: u.token }))
}

/** Structured-output schema the fast model fills after turn 1. */
export const TITLE_SCHEMA = {
  name: "session_title",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: { type: "string", description: "3–6 word title, sentence case, no quotes." },
    },
  },
} as const

export function titlePrompt(firstUserText: string): string {
  return `Name this design session in 3 to 6 words (sentence case, no quotes, no trailing period). The user's first request:\n\n${firstUserText.slice(0, 2000)}`
}

/** Text of a session for search. */
export function sessionText(s: Session): string {
  const parts: string[] = [s.title]
  for (const m of historyOf(s)) {
    if (m.role === "user" || m.role === "assistant")
      for (const p of m.content) if (p.type === "text") parts.push(p.text)
  }
  return parts.join("\n").toLowerCase()
}

/** In-memory store (tests, web fallback when IndexedDB is unavailable). */
export function createMemorySessionStore(): SessionStore {
  const all = new Map<string, Session>()
  const meta = ({ turns: _t, cliSessionId: _c, ...m }: Session): SessionMeta => m
  const sorted = (xs: Session[]) => xs.sort((a, b) => b.updatedAt - a.updatedAt).map(meta)
  return {
    async list(fileId) {
      return sorted([...all.values()].filter((s) => fileId === undefined || s.fileId === fileId))
    },
    async get(id) {
      const s = all.get(id)
      return s ? structuredClone(s) : null
    },
    async put(s) {
      all.set(s.id, structuredClone(s))
    },
    async delete(id) {
      all.delete(id)
    },
    async search(q) {
      const needle = q.trim().toLowerCase()
      return sorted([...all.values()].filter((s) => !needle || sessionText(s).includes(needle)))
    },
  }
}

/** Board 22 sessions list: this file first (newest first), then other files. */
export function groupSessions(
  metas: readonly SessionMeta[],
  fileId: string,
): { thisFile: SessionMeta[]; otherFiles: SessionMeta[] } {
  const byTime = [...metas].sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    thisFile: byTime.filter((m) => m.fileId === fileId),
    otherFiles: byTime.filter((m) => m.fileId !== fileId),
  }
}
