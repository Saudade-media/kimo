/**
 * The bridge between dispatch and the kimo_script handler: dispatch compiles the script first
 * (the handler set's {@link SCRIPT_COMPILER}), then validates and authorizes the kimo_apply_ops
 * call it compiles to, and hands the plan to the handler under {@link SCRIPT_PLAN}.
 */
import type { ToolError } from "../envelope"
import type { HandlerOutput, ToolContext } from "../runtime"
import type { RunnerSession } from "./runner"

export const SCRIPT_COMPILER: unique symbol = Symbol.for("kimo.scriptCompiler")
export const SCRIPT_PLAN: unique symbol = Symbol.for("kimo.scriptPlan")

export interface ScriptPlan {
  /** The kimo_apply_ops call the script compiles to. */
  call: Record<string, unknown>
  /** Script line of each op of `call.ops`. */
  lines: number[]
  prints: string[]
  /** key → layer name of the layers it inserts. */
  names: [string, string][]
  /** Names to carry to the agent's next script (earlier ones plus this script's). */
  declared: string[]
  /** The session that ran it (its globals are carried after a commit). */
  session: RunnerSession
  dispose(): void
}

export type ScriptCompiler = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<{ ok: true; plan: ScriptPlan } | { ok: false; output: HandlerOutput }>

/** The compiler of a handler set (undefined for hand-made handler sets). */
export function scriptCompilerOf(handlers: object): ScriptCompiler | undefined {
  return (handlers as { [SCRIPT_COMPILER]?: ScriptCompiler })[SCRIPT_COMPILER]
}

/** Index of the op an error names (`ops[3]…`, `/ops/3…` in the path or the message). */
function opIndex(e: ToolError): number | null {
  for (const s of [e.path ?? "", e.message]) {
    const m = /(?:^|\W)ops(?:\[(\d+)\]|\/(\d+))/.exec(s)
    if (m) return Number(m[1] ?? m[2])
  }
  return null
}

/** An error about a compiled op, told as the script line that made it. */
export function scriptLine(e: ToolError, lines: readonly number[]): ToolError {
  const i = opIndex(e)
  const line = i === null ? 0 : (lines[i] ?? 0)
  if (!line || e.message.startsWith("line ")) return e
  return { ...e, message: `line ${line}: ${e.message}` }
}
