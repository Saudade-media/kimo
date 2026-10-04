/**
 * Prompt and note nodes (board 22 "Note & prompt nodes", format §5.5, ADR 0014 §9).
 *
 * Run = one turn of the built-in agent with node scope = the prompt's `target` frame, or a new
 * placeholder frame next to the prompt when it has no (valid) target. The run is one undo group
 * per batch and its op groups are kept, so a failed run never leaves un-undoable partial ops.
 * Run state (last run, op count, cost, failure) is app data keyed by `<fileId>/<nodeId>`, not
 * stored in the file.
 */
import type { WireOp } from "@kimo/mcp-server"
import { ProviderError } from "./errors"
import {
  type ConfiguredProvider,
  type ResolvedModel,
  resolveLegacyModelId,
  resolveModel,
} from "./models"
import type { ModelSelection } from "./types"

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PromptNodeView {
  id: string
  name?: string
  content: string
  /** Format: `{provider, model}` or the legacy bare string. */
  model?: ModelSelection | string
  target?: string
  box: Box
}

export interface NoteView {
  id: string
  content: string
  author?: string
  parent: string | null
  box: Box
}

export interface PromptRunPlan {
  model: ResolvedModel
  /** Scope of the run: [target] or [@new frame key]. */
  scopeRoots: string[]
  /** Ops to apply first (new target frame) or empty. */
  setup: WireOp[]
  /** Key of the created frame when setup is non-empty. */
  createdKey?: string
  userText: string
  notes: { author?: string; content: string }[]
}

export type PromptRunStatus = "idle" | "running" | "failed"

/** App-data run state shown in the prompt footer and the layer row. */
export interface PromptRunState {
  status: PromptRunStatus
  lastRun?: {
    at: number
    ops: number
    costUsd: number | null
    billing: "api" | "subscription" | "local"
  }
  /** Failed: the ProviderError kind and message ("no key for Gemini"). */
  error?: { kind: string; message: string }
  /** Running: live op count and cost. */
  live?: { ops: number; costUsd: number | null }
}

export const promptRunKey = (fileId: string, nodeId: string): string => `${fileId}/${nodeId}`

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Notes that are attached to (children of) or overlap the target: the run's human context. */
export function contextNotes(
  notes: readonly NoteView[],
  target: { id: string; box: Box } | null,
): NoteView[] {
  if (!target) return []
  return notes.filter((n) => n.parent === target.id || intersects(n.box, target.box))
}

export function planPromptRun(
  node: PromptNodeView,
  doc: {
    frame(id: string): { id: string; box: Box } | null
    notes: readonly NoteView[]
    origin: string
    now?: Date
  },
  providers: readonly ConfiguredProvider[],
  defaultModel: ModelSelection,
): PromptRunPlan {
  if (!node.content.trim())
    throw new ProviderError("invalid_request", "The prompt is empty.", {
      provider: defaultModel.provider,
    })
  const model =
    node.model === undefined
      ? resolveModel(defaultModel, providers)
      : typeof node.model === "string"
        ? resolveLegacyModelId(node.model, providers)
        : resolveModel(node.model, providers)
  const target = node.target ? doc.frame(node.target) : null
  const notes = contextNotes(doc.notes, target).map((n) => ({
    ...(n.author ? { author: n.author } : {}),
    content: n.content,
  }))
  if (target) return { model, scopeRoots: [target.id], setup: [], userText: node.content, notes }
  const key = "prompt_target"
  const setup = [
    {
      op: "insert",
      key,
      parent: "root",
      node: {
        type: "frame",
        name: node.name ? `${node.name} · result` : "Prompt result",
        x: node.box.x + node.box.w + 80,
        y: node.box.y,
        w: 1200,
        h: { mode: "fit" },
        placeholder: { by: doc.origin, since: (doc.now ?? new Date()).toISOString() },
      },
    },
  ] as unknown as WireOp[]
  return { model, scopeRoots: [`@${key}`], setup, createdKey: key, userText: node.content, notes }
}

/** "Convert to prompt" on a note: replace keeps id and position (format: same fields + model). */
export function convertNoteToPromptOp(
  note: { id: string; body: Record<string, unknown> },
  model?: ModelSelection,
): WireOp {
  return {
    op: "replace",
    id: note.id,
    node: { ...note.body, type: "prompt", ...(model ? { model } : {}) },
  } as unknown as WireOp
}

/** Footer copy: "Ran 4m ago · 18 ops · $0.06" / "Running · 9 ops · $0.02" / "Failed · no key for Gemini". */
export function promptFooter(
  state: PromptRunState,
  ago: (t: number) => string,
  usd: (v: number | null) => string,
): string {
  if (state.status === "running")
    return `Running · ${state.live?.ops ?? 0} ops · ${usd(state.live?.costUsd ?? 0)}`
  if (state.status === "failed") return `Failed · ${state.error?.message ?? "error"}`
  if (!state.lastRun) return "Not run yet"
  const cost =
    state.lastRun.billing === "subscription" ? "subscription" : usd(state.lastRun.costUsd)
  return `Ran ${ago(state.lastRun.at)} · ${state.lastRun.ops} ops · ${cost}`
}
