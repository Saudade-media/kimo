/**
 * Home → editor hand-off (board 22 "Home composer rules" › Hand-off; contract
 * `HomeAgentHandoff`). Home creates the file, stashes the prompt here and navigates; the
 * editor's Agent tab takes it once when it mounts for that file and starts the session:
 * origin `home`, mode Single, scope page, the prompt as the first user message tagged "From
 * Home", and the first root frame (already in the file with `placeholder: {by: owner}`).
 *
 * Kept in `sessionStorage` (this window/tab only: Home navigates in place) with an in-memory
 * mirror for hosts without storage. Entries older than {@link HANDOFF_TTL_MS} are ignored.
 */
import type { ModelSelection } from "@kimo/ai-agent"
import type { HomeAgentHandoff } from "../platform/contract"

/** The contract hand-off plus what the panel needs to start without asking again. */
export interface HomeHandoffRecord extends HomeAgentHandoff {
  /** Desktop: the FileRef (absolute path). Web: the library file id (`#/file/<id>`). */
  path: string
  /** "Pricing page.kimo". */
  fileName: string
  /** The selection the Home composer showed (precedence / Settings default). */
  model: ModelSelection
  /** The placeholder root frame Home created (`placeholder.by` = {@link owner}). */
  frameId: string
  /** `agent:kimo.<session>.0` (API) or `mcp:<cli>.<session>` (local CLI). */
  owner: string
  createdAt: number
}

export const HANDOFF_KEY = "kimo.home.handoff"
export const HANDOFF_TTL_MS = 5 * 60_000

const memory = new Map<string, HomeHandoffRecord>()

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

function readAll(): Record<string, HomeHandoffRecord> {
  const out: Record<string, HomeHandoffRecord> = Object.fromEntries(memory)
  try {
    const raw = storage()?.getItem(HANDOFF_KEY)
    if (raw) Object.assign(out, JSON.parse(raw) as Record<string, HomeHandoffRecord>)
  } catch {}
  return out
}

function writeAll(all: Record<string, HomeHandoffRecord>): void {
  memory.clear()
  for (const [k, v] of Object.entries(all)) memory.set(k, v)
  try {
    const s = storage()
    if (!s) return
    if (Object.keys(all).length) s.setItem(HANDOFF_KEY, JSON.stringify(all))
    else s.removeItem(HANDOFF_KEY)
  } catch {}
}

export function stashHomeHandoff(h: HomeHandoffRecord): void {
  writeAll({ ...readAll(), [h.path]: h })
}

/** The pending hand-off for `path` (FileRef or web file id), removed once taken. */
export function takeHomeHandoff(path: string, now = Date.now()): HomeHandoffRecord | null {
  const all = readAll()
  const h = all[path] ?? null
  if (h) delete all[path]
  for (const [k, v] of Object.entries(all)) if (now - v.createdAt > HANDOFF_TTL_MS) delete all[k]
  writeAll(all)
  return h && now - h.createdAt <= HANDOFF_TTL_MS ? h : null
}

/** Without taking it (the Agent tab decides whether to activate itself). */
export function peekHomeHandoff(path: string, now = Date.now()): HomeHandoffRecord | null {
  const h = readAll()[path] ?? null
  return h && now - h.createdAt <= HANDOFF_TTL_MS ? h : null
}
