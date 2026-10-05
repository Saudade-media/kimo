/**
 * Live progress of an agent turn (board 31 "Agent progress"): the one status line the panel
 * shows while a turn runs, the step labels it falls back to, and the reply shown at turn end.
 *
 * Status mechanism: **narration**. Agents are told to write one short line before each tool
 * call ("Building the pricing section"); the text a model streams between two tool calls is
 * therefore its progress note, and the text after its last tool call is the reply. This needs
 * no extra tool or protocol, costs no round trip, and works the same for every API provider
 * and every local CLI (their stdout is parsed into the same `text_delta` / `step_start` events).
 * When a step has no note, the status describes the running tool from its input
 * ({@link stepLabel}). Thinking text never reaches the status.
 */
import type { ToolCallRequest } from "./toolhost"
import type { ChatMessage } from "./types"

/** Node names for step labels ("Editing 6 layers in Pricing"). All optional. */
export interface StepNames {
  /** A node's layer name, undefined when unknown. */
  name?(id: string): string | undefined
  /** The name of a node's parent, undefined at top level / unknown. */
  parentName?(id: string): string | undefined
}

/** Max characters of a status line (the panel ellipsizes to one line anyway). */
export const STATUS_MAX = 120

type Op = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
const isRef = (v: unknown): v is string => typeof v === "string" && v.startsWith("@")

const ADD_OPS = new Set(["insert", "copy", "instantiate"])

/** "Adding 12 layers in Pricing", "Editing 6 layers in Hero", "Copying Home", "Deleting 2 layers". */
export function describeOps(ops: readonly Op[], names: StepNames = {}): string | null {
  if (!ops.length) return null
  const nameOf = (id: unknown) =>
    typeof id === "string" && !isRef(id) ? names.name?.(id) : undefined
  const keyed = new Map<string, Op>()
  for (const op of ops) if (typeof op.key === "string") keyed.set(`@${op.key}`, op)
  /** The name of a parent reference: an existing node, or a node inserted earlier in the call. */
  const parentLabel = (p: unknown): string | undefined => {
    if (p === "root" || p === undefined) return undefined
    if (isRef(p)) {
      const o = keyed.get(p)
      const body = o?.node as Op | undefined
      return str(body?.name) ?? (o ? parentLabel(o.parent) : undefined)
    }
    return nameOf(p)
  }
  const adds = ops.filter((o) => ADD_OPS.has(String(o.op)))
  const deletes = ops.filter((o) => o.op === "delete")
  const edits = ops.filter((o) => !ADD_OPS.has(String(o.op)) && o.op !== "delete")
  if (adds.length) {
    const copies = adds.filter((o) => o.op === "copy")
    if (copies.length === adds.length && copies.length === 1) {
      const n = nameOf(copies[0]?.id)
      return n ? `Copying ${n}` : "Copying a layer"
    }
    // Where: the first add whose parent is a named node; else the first new top-level node.
    let where: string | undefined
    for (const o of adds) {
      where = parentLabel(o.parent)
      if (where) break
    }
    if (!where) {
      const top = adds.find((o) => o.parent === "root")
      where = str((top?.node as Op | undefined)?.name)
    }
    return `Adding ${plural(adds.length, "layer")}${where ? ` in ${where}` : ""}`
  }
  if (edits.length) {
    const first = edits[0] as Op
    const id = first.id ?? first.instance ?? first.node ?? first.frame ?? first.component
    if (edits.length === 1) {
      const n = nameOf(id)
      if (n) return `Editing ${n}`
    }
    const parent = typeof id === "string" && !isRef(id) ? names.parentName?.(id) : undefined
    const where = parent ?? nameOf(id)
    return `Editing ${plural(edits.length, "layer")}${where ? ` in ${where}` : ""}`
  }
  const where = deletes.length === 1 ? nameOf(deletes[0]?.id) : undefined
  return where ? `Deleting ${where}` : `Deleting ${plural(deletes.length, "layer")}`
}

const STATIC: Record<string, string> = {
  kimo_get_state: "Reading the document",
  kimo_get_variables: "Reading variables",
  kimo_list_components: "Reading components",
  kimo_find_space: "Finding space on the canvas",
  kimo_validate: "Checking for problems",
  kimo_save: "Saving",
  kimo_open: "Opening a file",
  kimo_create: "Creating a file",
  kimo_focus: "Showing the result",
  kimo_assets: "Managing assets",
  kimo_activity: "Reading activity",
  kimo_spawn_agents: "Starting agents",
  kimo_script: "Running a script",
}

/**
 * The step label of a tool call (AgentStep row while running, status fallback): what the tool is
 * doing, with layer counts and names where the input tells.
 */
export function stepLabel(call: ToolCallRequest, names: StepNames = {}): string {
  const i = call.input
  const nameOf = (id: unknown) => (typeof id === "string" ? names.name?.(id) : undefined)
  switch (call.name) {
    case "kimo_apply_ops": {
      const d = Array.isArray(i.ops) ? describeOps(i.ops as Op[], names) : null
      return d ?? (str(i.label) ? `Editing · ${i.label}` : "Editing")
    }
    case "kimo_query": {
      const sel = (i.select ?? {}) as Op
      const ids = Array.isArray(sel.ids) ? sel.ids : []
      const n = nameOf(sel.under) ?? nameOf(sel.page) ?? nameOf(ids[0])
      if (n) return `Reading ${n}`
      return "Reading the document"
    }
    case "kimo_render": {
      const ids = Array.isArray(i.ids) ? i.ids : []
      const n = nameOf(ids[0])
      return n ? `Rendering ${n}` : "Rendering"
    }
    case "kimo_export": {
      const f = str(i.format) ?? str(i.target)
      return f ? `Exporting ${f.toUpperCase()}` : "Exporting"
    }
    case "kimo_import":
      return str(i.kind) ? `Importing ${String(i.kind).replace(/-/g, " ")}` : "Importing"
    case "kimo_read_docs":
      return str(i.path) ? `Reading the ${i.path} guide` : "Reading the guides"
    case "kimo_history":
      return i.action === "redo" ? "Redoing" : i.action === "undo" ? "Undoing" : "Reading history"
    default:
      return STATIC[call.name] ?? call.name.replace(/^kimo_/, "").replace(/_/g, " ")
  }
}

/** The note in a stretch of streamed text: its last non-empty line, plain, ≤ {@link STATUS_MAX}. */
export function noteOf(text: string): string {
  const lines = text
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•>]|#{1,6}|\d+[.)])\s+/, "")
        .replace(/[*_`]+/g, "")
        .trim(),
    )
    .filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  return last.length > STATUS_MAX ? `${last.slice(0, STATUS_MAX - 1).trimEnd()}…` : last
}

/** Status while the agent writes more than a one-line note (its reply). */
export const WRITING_REPLY = "Writing the reply…"

/** More than one line / sentence, or longer than a status line: not a progress note. */
function isLong(text: string): boolean {
  const t = text.trim()
  if (t.length > STATUS_MAX) return true
  const lines = t.split("\n").filter((l) => l.trim()).length
  const sentences = (t.match(/[.!?…](?=\s|$)/g) ?? []).length
  return lines > 1 || sentences > 1
}

/** The complete part of streamed text: up to its last line break or sentence end. */
export function completePart(text: string): string {
  const nl = text.lastIndexOf("\n")
  const m = /^[\s\S]*[.!?…](?=\s)/.exec(text)
  const end = Math.max(nl, m ? m[0].length : -1)
  return end < 0 ? "" : text.slice(0, end)
}

export type StatusSource = "start" | "note" | "tool"

export interface ProgressStatus {
  text: string
  source: StatusSource
}

/** What the status line starts with (before any text or tool call). */
export const START_STATUS: ProgressStatus = { text: "Thinking…", source: "start" }

/**
 * Status line state of one turn, fed with its events. The current stretch of text (since the
 * last tool call) is the agent's note; a tool call without a note shows the tool's label.
 */
export class ProgressTracker {
  status: ProgressStatus = START_STATUS
  /** Text streamed since the last tool call. */
  private segment = ""
  /** The segment as of the last committed model message (a retry discards back to it). */
  private committed = ""

  /**
   * Streamed text. Only complete lines or sentences become the status, so a reply being written
   * never shows word by word; an unterminated note becomes the status when its tool call starts.
   */
  text(delta: string): void {
    this.segment += delta
    this.showComplete()
  }

  /** The partial output is void (a retry resends it). */
  discard(): void {
    this.segment = this.committed
    this.showComplete()
  }

  private showComplete(): void {
    const done = completePart(this.segment)
    const note = noteOf(done)
    if (!note) return
    // A note is one short line. Longer text is the reply being written (it shows at turn end).
    this.status = isLong(done)
      ? { text: WRITING_REPLY, source: "note" }
      : { text: note, source: "note" }
  }

  messageEnd(): void {
    this.committed = this.segment
  }

  /** A tool call starts: its note (if any) stays, else the tool's label. */
  step(label: string): void {
    const note = noteOf(this.segment)
    this.status = note ? { text: note, source: "note" } : { text: label, source: "tool" }
    this.segment = ""
    this.committed = ""
  }
}

const textOf = (m: ChatMessage): string =>
  m.role === "tool"
    ? ""
    : m.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("")

/**
 * The reply of a turn: the text of its last assistant message that has any (the one after the
 * last tool call when the turn ended normally). Progress notes written before tool calls are not
 * part of it.
 */
export function replyOf(messages: readonly ChatMessage[]): string {
  for (let k = messages.length - 1; k >= 0; k--) {
    const m = messages[k] as ChatMessage
    if (m.role !== "assistant") continue
    const t = textOf(m).trim()
    if (t) return t
  }
  return ""
}
