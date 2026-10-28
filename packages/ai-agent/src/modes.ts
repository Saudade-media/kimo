/**
 * Modes (board 22 "Modes · side by side, split, iterate", teardown 3.4, ADR 0014 §8):
 *
 * - **Single**: one agent, scoped to the selection (or the page when nothing is selected).
 * - **Side by side**: the lead creates N empty root frames next to the original
 *   (`placeholder`), then spawns one child per frame; each child may write only inside its
 *   frame. N ≤ 6, model per agent, explore Layout / Style / Both.
 * - **Split**: the lead creates placeholder sections, then spawns one child per section via
 *   `kimo_spawn_agents`.
 * - **Iterate**: refine the selected frame in place, one pass per turn, with a review step
 *   between passes.
 *
 * Every child is an in-process M5 client with its own origin `agent:kimo.<session>.<n>`, undo
 * stack, activity rows and a `ClientPolicy` whose `nodes` is its scope; scopes are enforced per
 * op by the ops layer ({@link import("./scope").checkScope}), not by the prompt.
 */
import { type ClientPolicy, failure, success, type WireOp } from "@kimo/mcp-server"
import type { AgentTool, ToolOutcome } from "./toolhost"
import type { ModelSelection, ThinkingMode } from "./types"

export const MODES = ["single", "side-by-side", "split", "iterate"] as const
export type Mode = (typeof MODES)[number]

export type Explore = "layout" | "style" | "both"

/** Lead decision: at most 6 parallel agents (configurable lower). */
export const MAX_AGENTS = 6

export interface ModeConfig {
  mode: Mode
  /** side-by-side / split: 1..MAX_AGENTS. */
  agents: number
  /** One model for all, or one per agent (index = agent number - 1). */
  models: ModelSelection[] | "same"
  explore: Explore
  /** iterate: planned passes (board: "pass 2 of 3"). */
  passes: number
}

export const DEFAULT_MODE: ModeConfig = {
  mode: "single",
  agents: 3,
  models: "same",
  explore: "both",
  passes: 3,
}

function clampAgents(n: number, cap = MAX_AGENTS): number {
  return Math.max(1, Math.min(Math.min(cap, MAX_AGENTS), Math.floor(n)))
}

// --- Origins and policies ------------------------------------------------------------------------

/** `agent:kimo.<session>.<n>` (lead = 0). Session: the agent session's short id. */
export function agentOrigin(session: string, n: number): `agent:${string}` {
  return `agent:kimo.${session}.${n}`
}

export function parseAgentOrigin(origin: string): { session: string; n: number } | null {
  const m = /^agent:kimo\.([a-z0-9]{1,16})\.(\d{1,2})$/.exec(origin)
  return m ? { session: m[1] as string, n: Number(m[2]) } : null
}

/**
 * The in-app lead's policy. Canvas ops are auto-approved and undoable (teardown 3.4); saving,
 * exporting and other files ask; approvals wait indefinitely.
 */
export function leadPolicy(scope: readonly string[] = []): ClientPolicy {
  return {
    level: "edit+delete",
    files: [],
    nodes: [...scope],
    grants: ["globals", "components"],
    onExceed: "ask",
    confirmDestructive: false,
  }
}

/**
 * A spawned child's policy: edit inside its scope only. No grants (no globals, components,
 * save, export, files), never asks — anything outside fails OUT_OF_SCOPE / PERMISSION_DENIED
 * and the batch rolls back.
 */
export function childPolicy(scopeRoots: readonly string[]): ClientPolicy {
  if (scopeRoots.length === 0) throw new Error("A spawned agent needs a non-empty node scope.")
  return {
    level: "edit+delete",
    files: [],
    nodes: [...scopeRoots],
    grants: [],
    onExceed: "deny",
    confirmDestructive: false,
  }
}

/** Single mode scope: the selection, or the whole page (empty = unscoped). */
export function singleScope(selection: readonly string[]): string[] {
  return [...selection]
}

// --- Side by side --------------------------------------------------------------------------------

export interface FrameBox {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * The lead's deterministic setup for side by side: N empty top-level frames to the right of the
 * original, same size, `placeholder` owned by the child that will fill each (keys `v1`…`vN`).
 */
export function planSideBySide(
  original: FrameBox,
  n: number,
  childOrigins: readonly string[],
  opts: { gap?: number; now?: Date } = {},
): WireOp[] {
  const gap = opts.gap ?? 80
  const since = (opts.now ?? new Date()).toISOString()
  return Array.from({ length: clampAgents(n) }, (_, i) => ({
    op: "insert",
    key: `v${i + 1}`,
    parent: "root",
    node: {
      type: "frame",
      name: `${original.name} · v${i + 1}`,
      x: original.x + (original.w + gap) * (i + 1),
      y: original.y,
      w: original.w,
      h: original.h,
      placeholder: { by: childOrigins[i] ?? "", since },
    },
  })) as unknown as WireOp[]
}

/** The explore brief appended to each child's prompt ("Let it cook"). */
export function exploreBrief(explore: Explore, index: number, total: number): string {
  const which = `You are variant ${index + 1} of ${total}. Make it clearly different from the other variants.`
  const focus =
    explore === "layout"
      ? "Explore LAYOUT: change structure, hierarchy, grouping, alignment and spacing. Keep the existing colors, type and tokens."
      : explore === "style"
        ? "Explore STYLE: change color use, type scale, radius, elevation and imagery treatment. Keep the structure and content order."
        : "Explore both LAYOUT and STYLE, while keeping the content and the document's tokens."
  return `${which} ${focus} Work only inside your frame; it starts empty — rebuild the original's content there (read it with kimo_query). Clear your frame's placeholder when done.`
}

// --- Spawn ---------------------------------------------------------------------------------------

export interface ChildSpec {
  index: number
  origin: `agent:${string}`
  docId: string
  scopeRoots: string[]
  policy: ClientPolicy
  model: ModelSelection
  thinking: ThinkingMode
  brief: string
}

export interface ChildResult {
  index: number
  origin: string
  status: "done" | "stopped" | "error" | "budget" | "refusal" | "max_steps"
  opsApplied: number
  rejected: number
  summary: string
  costUsd: number | null
}

export type ChildRunner = (spec: ChildSpec, signal: AbortSignal) => Promise<ChildResult>

/** Runs children in parallel (≤ cap). Aborting `signal` stops all ("Stop all"). */
export async function runChildren(
  specs: readonly ChildSpec[],
  runner: ChildRunner,
  signal: AbortSignal,
  cap = MAX_AGENTS,
): Promise<ChildResult[]> {
  if (specs.length > Math.min(cap, MAX_AGENTS))
    throw new Error(`At most ${Math.min(cap, MAX_AGENTS)} agents can run at once.`)
  return Promise.all(
    specs.map(async (s) => {
      try {
        return await runner(s, signal)
      } catch (e) {
        return {
          index: s.index,
          origin: s.origin,
          status: signal.aborted ? ("stopped" as const) : ("error" as const),
          opsApplied: 0,
          rejected: 0,
          summary: e instanceof Error ? e.message : String(e),
          costUsd: null,
        }
      }
    }),
  )
}

/** Input schema of `kimo_spawn_agents` (portable profile, ADR 0013 §3). */
export const SPAWN_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["docId", "agents"],
  properties: {
    docId: { type: "string", description: "Document id from kimo_get_state." },
    agents: {
      type: "array",
      minItems: 1,
      maxItems: MAX_AGENTS,
      description: "One entry per child agent. Each child can write only inside its frame.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["frameId", "brief"],
        properties: {
          frameId: {
            type: "string",
            description: "Existing frame (usually a placeholder you created) the child owns.",
          },
          brief: { type: "string", description: "What the child should build in its frame." },
          provider: {
            type: "string",
            description: "Optional provider id for this child (default: the session's).",
          },
          model: { type: "string", description: "Optional model id at that provider." },
        },
      },
    },
  },
}

export interface SpawnToolOptions {
  session: string
  /** Lead's scope (children must be inside it); empty = whole document. */
  leadScope: readonly string[]
  defaultModel: ModelSelection
  thinking: ThinkingMode
  cap?: number
  /** Validates frame ids against the document (exists, is a frame, inside the lead scope). */
  validateFrame(docId: string, frameId: string): string | null
  runner: ChildRunner
  /** Next child number (1-based, monotonic per session). */
  nextIndex(): number
}

/**
 * `kimo_spawn_agents` (teardown 11.3; excluded from M5, added in M6 as an agent-only tool, ADR
 * 0013 addendum). Lead only: children never receive it. Frames must be distinct and not nested.
 */
export function createSpawnTool(o: SpawnToolOptions): AgentTool {
  return {
    spec: {
      name: "kimo_spawn_agents",
      description:
        "Spawn parallel child agents, one per frame, and wait for them. Use after creating one empty placeholder frame per part of the work (split) or per variant (side by side). Each child edits only inside its frame (other edits fail OUT_OF_SCOPE), cannot touch variables, theme axes or components, and cannot save or export. Returns each child's status, ops applied and cost.",
      inputSchema: SPAWN_INPUT_SCHEMA,
    },
    async run(input, signal): Promise<ToolOutcome> {
      const docId = String(input.docId ?? "")
      const agents = Array.isArray(input.agents)
        ? (input.agents as { frameId: string; brief: string; provider?: string; model?: string }[])
        : []
      const cap = Math.min(o.cap ?? MAX_AGENTS, MAX_AGENTS)
      if (agents.length === 0 || agents.length > cap)
        return {
          result: failure({
            code: "INVALID_INPUT",
            message: `Spawn 1 to ${cap} agents.`,
            path: "agents",
          }),
        }
      const frames = agents.map((a) => a.frameId)
      if (new Set(frames).size !== frames.length)
        return {
          result: failure({
            code: "INVALID_INPUT",
            message: "Each child needs its own frame.",
            path: "agents",
          }),
        }
      for (const [i, f] of frames.entries()) {
        const bad = o.validateFrame(docId, f)
        if (bad)
          return {
            result: failure({
              code: "INVALID_INPUT",
              message: bad,
              path: `agents[${i}].frameId`,
              nodeId: f,
            }),
          }
      }
      const specs: ChildSpec[] = agents.map((a) => {
        const index = o.nextIndex()
        return {
          index,
          origin: agentOrigin(o.session, index),
          docId,
          scopeRoots: [a.frameId],
          policy: childPolicy([a.frameId]),
          model: a.provider && a.model ? { provider: a.provider, model: a.model } : o.defaultModel,
          thinking: o.thinking,
          brief: a.brief,
        }
      })
      const results = await runChildren(specs, o.runner, signal, cap)
      const done = results.filter((r) => r.status === "done").length
      return {
        result: success(
          { agents: results },
          `${done} of ${results.length} agents done · ${results.reduce((n, r) => n + r.opsApplied, 0)} ops`,
        ),
      }
    },
  }
}

// --- Iterate -------------------------------------------------------------------------------------

export type ReviewDecision =
  | { action: "next"; steer?: string }
  | { action: "stop" }
  /** Revert to a pass (0 = original) by undoing later passes' op groups. */
  | { action: "revert"; toPass: number }

export interface IteratePass {
  pass: number
  undoTokens: { docId: string; token: string }[]
  changes: number
  costUsd: number | null
}

/** Prompt for pass k of an iterate run. */
export function iteratePrompt(goal: string, pass: number, total: number, steer?: string): string {
  return [
    `Iterate pass ${pass} of ${total} on the selected frame. Goal: ${goal}`,
    steer ? `Steer for this pass: ${steer}` : "",
    "Make one focused round of improvements in place (inside the frame only), then stop and summarize what changed in one sentence.",
  ]
    .filter(Boolean)
    .join("\n")
}

/** Undo calls that revert to `toPass` (newest first), from the recorded passes. */
export function revertCalls(
  passes: readonly IteratePass[],
  toPass: number,
): { docId: string; token: string }[] {
  return passes
    .filter((p) => p.pass > toPass)
    .sort((a, b) => b.pass - a.pass)
    .flatMap((p) => [...p.undoTokens].reverse())
}
