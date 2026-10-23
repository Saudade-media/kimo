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
 * - Standard items (board 25): Duplicate ⌘D, Bring to front, Lock / Unlock, Delete ⌫.
 * - Board 27 §2 (g1jiG, with `structure`): Copy · Paste here · Duplicate ─ Group selection ·
 *   Ungroup · Wrap in frame ─ Add / Remove auto layout ─ Create component · Bring to front ·
 *   Send to back · Lock ─ Delete; the same list as the layer-row menu (identical order).
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
  kbd?(id: string): string
  /**
   * Board 27 §2 (g1jiG "Context menu"): the clipboard and structure commands' availability.
   * When given, the standard items follow board 27: Copy · Paste here · Duplicate ─ Group
   * selection · Ungroup · Wrap in frame ─ Add / Remove auto layout ─ Create component · Bring to
   * front · Send to back · Lock ─ Delete. Items that don't apply are disabled, not hidden (the
   * auto layout pair swaps).
   */
  structure?: StructureMenuState
  /**
   * Board 27 §7 (rule RAez2, H7PYY): variable items, as a group before Delete — "Bind
   * visibility to variable…" / "Bind text to variable…" (boolean / string variables exist) and
   * "Detach all variables" (the selection has bindings). Hidden when nothing applies.
   */
  variables?: VariableMenuState
  /**
   * Board 41 section 9: a View link. The menu keeps what only reads (Copy): no agent group, no
   * Duplicate, structure, lock or Delete.
   */
  viewOnly?: boolean
}

/** What the board 27 §7 variable items can do for the current selection. */
export interface VariableMenuState {
  /** Some selected node holds a variable binding (any field). */
  bound: boolean
  /** Visibility can be bound (boolean variables exist and it is not bound already). */
  bindVisible: boolean
  /** Text content can be bound (text selection, string variables exist, not bound already). */
  bindText: boolean
}

/** What the board 27 structure items can do for the current selection. */
export interface StructureMenuState {
  canPaste: boolean
  canGroup: boolean
  canUngroup: boolean
  /** "add" / "remove" auto layout, or null (disabled "Add auto layout"). */
  layout: "add" | "remove" | null
  canCreateComponent: boolean
  /**
   * Board 27 §8 (b) rule Y4XQq6: the main to replace when the selection is exactly one main +
   * one other non-instance node ("Replace main with selection…"); absent otherwise.
   */
  replaceMain?: string | null
}

export type CanvasMenuAction =
  | { kind: "convert"; ids: string[] }
  | { kind: "run"; ids: string[] }
  | { kind: "target"; prompt: string }
  | { kind: "resume"; frame: string; sessionId: string }
  | { kind: "ask"; frame: string }
  | { kind: "clear"; ids: string[] }
  | { kind: "duplicate" }
  | { kind: "copy" }
  | { kind: "pasteHere" }
  | { kind: "group" }
  | { kind: "ungroup" }
  | { kind: "wrap" }
  | { kind: "addLayout" }
  | { kind: "removeLayout" }
  | { kind: "createComponent" }
  | { kind: "replaceMain"; main: string }
  | { kind: "back"; ids: string[] }
  | { kind: "front"; ids: string[] }
  | { kind: "lock"; ids: string[]; lock: boolean }
  | { kind: "delete" }
  | { kind: "bindVariable"; field: "visible" | "content" }
  | { kind: "detachVariables"; ids: string[] }

export interface CanvasMenuRow {
  id: string
  label: string
  /** Lucide icon name in the Check Slot, or "agent-mark" (AgentMark/12/Idle). */
  icon?: string
  meta?: string
  metaFont?: "mono" | "sans"
  tone?: "agent" | "danger"
  disabled?: boolean
  action: CanvasMenuAction
}

export interface CanvasMenuModel {
  agent: CanvasMenuRow[]
  standard: CanvasMenuRow[]
  /** Board 27 groups between the standard items and Delete (empty without `structure`). */
  structure: CanvasMenuRow[][]
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
  const model = fullCanvasMenuModel(i)
  if (!model || !i.viewOnly) return model
  const kbd = i.kbd ?? ((id: string) => DEFAULT_KBD[id] ?? "")
  return {
    agent: [],
    standard: [{ id: "copy", label: "Copy", meta: kbd("copy"), action: { kind: "copy" } }],
    structure: [],
    danger: [],
  }
}

function fullCanvasMenuModel(i: CanvasMenuInput): CanvasMenuModel | null {
  const sel = i.selection.filter((id) => i.doc.getNode(id) || i.inInstance?.(id))
  if (sel.length === 0) return null
  const kbd = i.kbd ?? ((id: string) => DEFAULT_KBD[id] ?? "")
  const real = sel.filter((id) => i.doc.getNode(id))
  const allLocked = real.length > 0 && real.every((id) => i.doc.getNode(id)?.locked === true)
  const lock: CanvasMenuRow = {
    id: "lock",
    label: allLocked ? "Unlock" : "Lock",
    action: { kind: "lock", ids: real, lock: !allLocked },
  }
  const danger: CanvasMenuRow[] = [
    {
      id: "delete",
      label: "Delete",
      meta: kbd("delete"),
      tone: "danger",
      action: { kind: "delete" },
    },
  ]
  const vars = variableRows(i.variables, real)
  const st = i.structure
  if (st) {
    const row = (
      id: string,
      label: string,
      action: CanvasMenuAction,
      enabled: boolean,
      key?: string,
    ): CanvasMenuRow => ({
      id,
      label,
      ...(key ? { meta: kbd(key) } : {}),
      ...(enabled ? {} : { disabled: true }),
      action,
    })
    return {
      agent: agentRows({ ...i, selection: sel }),
      standard: [
        row("copy", "Copy", { kind: "copy" }, real.length > 0, "copy"),
        row("pasteHere", "Paste here", { kind: "pasteHere" }, st.canPaste, "paste"),
        row("duplicate", "Duplicate", { kind: "duplicate" }, real.length > 0, "duplicate"),
      ],
      structure: [
        [
          row("group", "Group selection", { kind: "group" }, st.canGroup, "group"),
          row("ungroup", "Ungroup", { kind: "ungroup" }, st.canUngroup, "ungroup"),
          row("wrap", "Wrap in frame", { kind: "wrap" }, st.canGroup, "wrapInFrame"),
        ],
        [
          st.layout === "remove"
            ? row(
                "removeLayout",
                "Remove auto layout",
                { kind: "removeLayout" },
                true,
                "removeAutoLayout",
              )
            : row(
                "addLayout",
                "Add auto layout",
                { kind: "addLayout" },
                st.layout === "add",
                "addAutoLayout",
              ),
        ],
        [
          row(
            "createComponent",
            "Create component",
            { kind: "createComponent" },
            st.canCreateComponent,
            "createComponent",
          ),
          ...(st.replaceMain
            ? [
                row(
                  "replaceMain",
                  "Replace main with selection…",
                  { kind: "replaceMain", main: st.replaceMain },
                  true,
                ),
              ]
            : []),
          row(
            "front",
            "Bring to front",
            { kind: "front", ids: real },
            real.length > 0,
            "bringToFront",
          ),
          row("back", "Send to back", { kind: "back", ids: real }, real.length > 0, "sendToBack"),
          lock,
        ],
        ...(vars.length ? [vars] : []),
      ],
      danger,
    }
  }
  const standard: CanvasMenuRow[] = [
    { id: "duplicate", label: "Duplicate", meta: kbd("duplicate"), action: { kind: "duplicate" } },
    { id: "front", label: "Bring to front", action: { kind: "front", ids: real } },
    lock,
  ]
  return {
    agent: agentRows({ ...i, selection: sel }),
    standard,
    structure: vars.length ? [vars] : [],
    danger,
  }
}

/** Board 27 §7 variable rows (empty when none applies). */
function variableRows(v: VariableMenuState | undefined, real: string[]): CanvasMenuRow[] {
  if (!v || real.length === 0) return []
  const out: CanvasMenuRow[] = []
  if (v.bindVisible)
    out.push({
      id: "bindVisible",
      label: "Bind visibility to variable…",
      action: { kind: "bindVariable", field: "visible" },
    })
  if (v.bindText)
    out.push({
      id: "bindText",
      label: "Bind text to variable…",
      action: { kind: "bindVariable", field: "content" },
    })
  if (v.bound)
    out.push({
      id: "detachVariables",
      label: "Detach all variables",
      action: { kind: "detachVariables", ids: real },
    })
  return out
}

/** macOS glyphs of the bindings the menu shows (when the shell passes no `kbd`). */
const DEFAULT_KBD: Record<string, string> = {
  duplicate: "⌘D",
  delete: "⌫",
  copy: "⌘C",
  paste: "⌘V",
  group: "⌘G",
  ungroup: "⇧⌘G",
  wrapInFrame: "⌥⌘G",
  addAutoLayout: "⇧A",
  removeAutoLayout: "⌥⇧A",
  createComponent: "⌥⌘K",
  bringToFront: "⌘]",
  sendToBack: "⌘[",
}
