/**
 * Canvas context menu model (board 25 §3 jWmmU, rules l2Ev9s). Pure: the shell turns rows into
 * `CanvasContextMenu` items and runs their actions.
 *
 * - Placement (L8EbvG): the agent group first, a Menu/Divider, the standard items, a divider,
 *   Delete. MenuItem/Dense (EAGNC) rows; agent rows carry their icon in the Check Slot.
 * - Note (K6u5Ay): "Convert to prompt" (sparkles) — hidden for notes inside component origins
 *   (a component main's subtree or an instance expansion: read-only for agents).
 * - Prompt (wabqA): "Run prompt" (play) · "Set as target" (crosshair, meta = current target name
 *   or "—"), which enters pick mode.
 * - Placeholder · live (D2DFy): "Clear flag" (flag-off) only.
 * - Placeholder · orphaned (jMJaL): "Resume agent" (AgentMark/12/Idle, meta "session N") +
 *   "Clear flag"; when the owning session is gone, "Ask Kimo to finish" replaces Resume.
 * - Multi-select (Pzcdu): agent items show only when every selected node supports them
 *   ("Convert 3 to prompts").
 * - Standard items: only commands the editor has — Duplicate ⌘D, Bring to front, Lock / Unlock,
 *   Delete ⌫. The design's "Copy ⌘C" row is left out: Kimo has no node clipboard yet.
 */
import { isOrphanPlaceholder, placeholderOwner } from "@kimo/ai-agent"

export interface MenuNodeReader {
  getNode(id: string): Readonly<Record<string, unknown>> | undefined
}

/** Who owns an orphaned placeholder (null: not a Kimo session, e.g. an MCP client). */
export interface MenuOwnerSession {
  sessionId: string
  /** "session N"; null when the session no longer exists. */
  ordinal: number | null
}

export interface CanvasMenuInput {
  doc: MenuNodeReader
  /** The selection the menu acts on (the shell selects the clicked node first). */
  selection: readonly string[]
  /** Live agent origins (`state.canvas.live`). */
  live: ReadonlySet<string>
  /** The built-in agent is available (an AI controller exists): Run / Resume / Ask need it. */
  agent: boolean
  /** True when `id` sits inside an instance expansion (view provenance). */
  inInstance?(id: string): boolean
  /** The Kimo session behind a placeholder owner origin. */
  ownerSession?(owner: string | undefined): MenuOwnerSession | null
  /** Shortcut label of a binding in the SHORTCUTS table (default: the macOS glyphs). */
  kbd?(id: "duplicate" | "delete"): string
}

export type CanvasMenuAction =
  | { kind: "convert"; ids: string[] }
  | { kind: "run"; ids: string[] }
  | { kind: "target"; prompt: string }
  | { kind: "resume"; frame: string; sessionId: string }
  | { kind: "ask"; frame: string }
  | { kind: "clear"; ids: string[] }
  | { kind: "duplicate" }
  | { kind: "front"; ids: string[] }
  | { kind: "lock"; ids: string[]; lock: boolean }
  | { kind: "delete" }

export interface CanvasMenuRow {
  id: string
  label: string
  /** Lucide icon name in the Check Slot, or "agent-mark" (AgentMark/12/Idle). */
  icon?: string
  meta?: string
  metaFont?: "mono" | "sans"
  tone?: "agent" | "danger"
  action: CanvasMenuAction
}

export interface CanvasMenuModel {
  agent: CanvasMenuRow[]
  standard: CanvasMenuRow[]
  danger: CanvasMenuRow[]
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

/** Display name of a node (its `name`, else its type capitalised). */
export function menuNodeName(doc: MenuNodeReader, id: string | undefined): string | undefined {
  const n = id ? doc.getNode(id) : undefined
  if (!n) return undefined
  const t = str(n.type) ?? "Layer"
  return str(n.name) ?? t.charAt(0).toUpperCase() + t.slice(1)
}

/** True when `id` or an ancestor is a component main (has `component`). */
function inComponentMain(doc: MenuNodeReader, id: string): boolean {
  let cur: string | undefined = id
  for (let guard = 0; cur && guard < 256; guard++) {
    const n = doc.getNode(cur)
    if (!n) return false
    if (n.component !== undefined) return true
    cur = str(n.parent)
  }
  return false
}

function agentRows(i: CanvasMenuInput): CanvasMenuRow[] {
  const { doc, selection: sel } = i
  if (sel.length === 0) return []
  const nodes = sel.map((id) => doc.getNode(id))
  if (nodes.some((n) => !n)) return []
  const types = new Set(nodes.map((n) => str(n?.type)))
  const only = types.size === 1 ? [...types][0] : undefined

  if (only === "note") {
    const readOnly = sel.some((id) => inComponentMain(doc, id) || i.inInstance?.(id))
    if (readOnly) return []
    return [
      {
        id: "convert",
        label: sel.length === 1 ? "Convert to prompt" : `Convert ${sel.length} to prompts`,
        icon: "sparkles",
        tone: "agent",
        action: { kind: "convert", ids: [...sel] },
      },
    ]
  }

  if (only === "prompt") {
    const rows: CanvasMenuRow[] = []
    if (i.agent)
      rows.push({
        id: "run",
        label: sel.length === 1 ? "Run prompt" : `Run ${sel.length} prompts`,
        icon: "play",
        tone: "agent",
        action: { kind: "run", ids: [...sel] },
      })
    if (sel.length === 1) {
      const target = str(nodes[0]?.target)
      rows.push({
        id: "target",
        label: "Set as target",
        icon: "crosshair",
        tone: "agent",
        meta: (target && menuNodeName(doc, target)) || "—",
        action: { kind: "target", prompt: sel[0] as string },
      })
    }
    return rows
  }

  // Placeholder frames: every selected node is a flagged frame.
  const flagged = nodes.every(
    (n) => n?.type === "frame" && n.placeholder !== undefined && n.placeholder !== false,
  )
  if (!flagged) return []
  const rows: CanvasMenuRow[] = []
  const clear: CanvasMenuRow = {
    id: "clear",
    label: "Clear flag",
    icon: "flag-off",
    tone: "agent",
    action: { kind: "clear", ids: [...sel] },
  }
  const orphan = nodes.every((n) => isOrphanPlaceholder(n?.placeholder, i.live))
  if (orphan && sel.length === 1 && i.agent) {
    const frame = sel[0] as string
    const owner = i.ownerSession?.(placeholderOwner(nodes[0]?.placeholder)) ?? null
    if (owner && owner.ordinal !== null)
      rows.push({
        id: "resume",
        label: "Resume agent",
        icon: "agent-mark",
        meta: `session ${owner.ordinal}`,
        metaFont: "sans",
        tone: "agent",
        action: { kind: "resume", frame, sessionId: owner.sessionId },
      })
    else
      rows.push({
        id: "ask",
        label: "Ask Kimo to finish",
        icon: "agent-mark",
        tone: "agent",
        action: { kind: "ask", frame },
      })
  }
  rows.push(clear)
  return rows
}

/** The menu for the current selection, or null when nothing is selected. */
export function canvasMenuModel(i: CanvasMenuInput): CanvasMenuModel | null {
  const sel = i.selection.filter((id) => i.doc.getNode(id) || i.inInstance?.(id))
  if (sel.length === 0) return null
  const kbd = i.kbd ?? ((id: "duplicate" | "delete") => (id === "duplicate" ? "⌘D" : "⌫"))
  const real = sel.filter((id) => i.doc.getNode(id))
  const allLocked = real.length > 0 && real.every((id) => i.doc.getNode(id)?.locked === true)
  const standard: CanvasMenuRow[] = [
    { id: "duplicate", label: "Duplicate", meta: kbd("duplicate"), action: { kind: "duplicate" } },
    { id: "front", label: "Bring to front", action: { kind: "front", ids: real } },
    {
      id: "lock",
      label: allLocked ? "Unlock" : "Lock",
      action: { kind: "lock", ids: real, lock: !allLocked },
    },
  ]
  return {
    agent: agentRows({ ...i, selection: sel }),
    standard,
    danger: [
      {
        id: "delete",
        label: "Delete",
        meta: kbd("delete"),
        tone: "danger",
        action: { kind: "delete" },
      },
    ],
  }
}
