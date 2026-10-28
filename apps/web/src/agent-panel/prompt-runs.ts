/**
 * Prompt-node run state in app data (ADR 0014 §9): the footer's "Last run · 12 ops · $0.04" and
 * a failed run's error survive a reload, but never live in the `.kimo` file. Keyed by
 * `promptRunKey(fileId, nodeId)`; one localStorage entry `kimo.prompt-runs` (web and the desktop
 * webview alike, like the sessions store). A run in flight is not persisted: after a reload the
 * node shows its previous finished state.
 */
import { type PromptRunState, promptRunKey } from "@kimo/ai-agent"

export interface PromptRunStore {
  /** The stored states of one file's prompt nodes, by node id. */
  load(fileId: string): Record<string, PromptRunState>
  /** Stores (or with null, forgets) one node's state. `running` states are ignored. */
  save(fileId: string, nodeId: string, state: PromptRunState | null): void
}

const PROMPT_RUNS_KEY = "kimo.prompt-runs"
/** Oldest entries are dropped past this many (a file's deleted prompt nodes leave rows behind). */
const MAX_ENTRIES = 500

interface KeyValue {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type Stored = Record<string, PromptRunState>

/** Only what a finished run needs: no live counters, no in-flight status. */
function persistable(state: PromptRunState): PromptRunState | null {
  if (state.status === "running") return null
  const out: PromptRunState = { status: state.status }
  if (state.lastRun) out.lastRun = { ...state.lastRun }
  if (state.status === "failed" && state.error) out.error = { ...state.error }
  return out
}

export function createPromptRunStore(storage: KeyValue | null = defaultStorage()): PromptRunStore {
  let memory: Stored = {}
  const read = (): Stored => {
    if (!storage) return memory
    try {
      const v = JSON.parse(storage.getItem(PROMPT_RUNS_KEY) ?? "{}") as unknown
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Stored) : {}
    } catch {
      return {}
    }
  }
  const write = (all: Stored) => {
    const keys = Object.keys(all)
    if (keys.length > MAX_ENTRIES) {
      const at = (k: string) => all[k]?.lastRun?.at ?? 0
      for (const k of keys.sort((a, b) => at(a) - at(b)).slice(0, keys.length - MAX_ENTRIES))
        delete all[k]
    }
    if (!storage) {
      memory = all
      return
    }
    try {
      storage.setItem(PROMPT_RUNS_KEY, JSON.stringify(all))
    } catch {
      // Quota or a blocked storage: the state just doesn't survive the reload.
    }
  }
  return {
    load(fileId) {
      const prefix = promptRunKey(fileId, "")
      const out: Record<string, PromptRunState> = {}
      for (const [k, v] of Object.entries(read()))
        if (k.startsWith(prefix) && v && typeof v === "object" && typeof v.status === "string")
          out[k.slice(prefix.length)] = v
      return out
    },
    save(fileId, nodeId, state) {
      const key = promptRunKey(fileId, nodeId)
      const all = read()
      if (state === null) delete all[key]
      else {
        const p = persistable(state)
        if (!p) return
        all[key] = p
      }
      write(all)
    },
  }
}

function defaultStorage(): KeyValue | null {
  try {
    return typeof localStorage === "object" && localStorage ? localStorage : null
  } catch {
    return null
  }
}
