/**
 * Board 21 "Agents & MCP" (KGdvA): pure view-model helpers for the agent surfaces (presence chip,
 * session popover, approval prompt, dry run, activity tab, Settings › Agents & MCP). Everything
 * here is data in → strings / rows out, so the rules tables of each board section are unit
 * tested without a DOM.
 */
import type { DocStore, NormalizedOp, OpLogEntry, Revision } from "@kimo/editor-state"
import type {
  McpActivityEntry,
  McpActivityKind,
  McpApprovalRequest,
  McpClientPolicy,
  McpConnectionInfo,
  McpHostConfigStatus,
  McpHostId,
  McpPermissionLevel,
  McpServerStatus,
} from "@kimo/platform"
import type { AgentPillTone } from "@kimo/ui"

// --- Formatting ----------------------------------------------------------------------------------

/** "10:47" (local time, 24 h). */
export function clock(time: number): string {
  const d = new Date(time)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** "k9·43": first two chars of the epoch, a middle dot, the sequence (board 21 revisions). */
export function formatRevision(r: { epoch: string; seq: number } | undefined | null): string {
  if (!r) return ""
  return `${r.epoch.slice(0, 2)}·${r.seq}`
}

/** "1:42" for a countdown. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** `~/…` for paths under the home directory. */
export function tildePath(path: string, home?: string | null): string {
  const h = home ?? guessHome(path)
  if (h && (path === h || path.startsWith(`${h}/`))) return `~${path.slice(h.length)}`
  return path
}

function guessHome(path: string): string | null {
  const m = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/.exec(path)
  return m ? (m[1] ?? null) : null
}

/** "Card 2 +3". */
export function namesSummary(names: readonly string[]): string {
  if (names.length === 0) return ""
  const [first] = names
  return names.length === 1 ? (first ?? "") : `${first} +${names.length - 1}`
}

/** The client slug of an origin: `mcp:claude-code.k3x9qa` → `claude-code`. */
export function clientOf(origin: string): string {
  const body = origin.startsWith("mcp:") ? origin.slice(4) : origin
  const dot = body.lastIndexOf(".")
  return dot > 0 ? body.slice(0, dot) : body
}

// --- Permission levels ---------------------------------------------------------------------------

export const LEVEL_LABEL: Record<McpPermissionLevel, string> = {
  read: "Read only",
  edit: "Edit",
  "edit+delete": "Edit + delete",
}

export const LEVEL_OPTIONS: { value: McpPermissionLevel; label: string }[] = [
  { value: "read", label: "Read only" },
  { value: "edit", label: "Edit" },
  { value: "edit+delete", label: "Edit + delete" },
]

/** Files scope of a policy (rule "Permissions": current file / this folder / any). */
export type FilesScope = "current" | "folder" | "any"

export const FILES_OPTIONS: { value: FilesScope; label: string }[] = [
  { value: "current", label: "Current file" },
  { value: "folder", label: "This folder" },
  { value: "any", label: "Any file" },
]

const FILES_LABEL: Record<FilesScope, string> = {
  current: "current file",
  folder: "this folder",
  any: "any file",
}

/** Reads the files scope back from a policy's allow-list. */
export function filesScopeOf(policy: McpClientPolicy, cwd?: string): FilesScope {
  if (policy.files.some((g) => g === "**" || g === "/**" || g === "**/*")) return "any"
  if (policy.files.length === 0) return "current"
  if (!cwd || policy.files.some((g) => g === `${cwd}/**` || g.startsWith(`${cwd}/`)))
    return "folder"
  return "folder"
}

/** The allow-list for a files scope (files already open in the app always count as allowed). */
export function filesForScope(scope: FilesScope, cwd?: string): string[] {
  if (scope === "any") return ["**"]
  if (scope === "folder") return cwd ? [`${cwd.replace(/\/+$/, "")}/**`] : []
  return []
}

/** ADR 0013 §6 defaults for clients without a stored policy. */
export const DEFAULT_POLICY: McpClientPolicy = {
  level: "edit",
  files: [],
  nodes: [],
  grants: [],
  onExceed: "ask",
  confirmDestructive: true,
}

/** "Edit · this folder", "Read only · current file" (AgentClientRow Scope badge). */
export function scopeLabel(policy: McpClientPolicy, cwd?: string): string {
  return `${LEVEL_LABEL[policy.level]} · ${FILES_LABEL[filesScopeOf(policy, cwd)]}`
}

/** "Can edit · ~/repo/design/" (session popover header). */
export function canLabel(policy: McpClientPolicy, cwd?: string): string {
  const verb =
    policy.level === "read"
      ? "Can read"
      : policy.level === "edit"
        ? "Can edit"
        : "Can edit + delete"
  const scope = filesScopeOf(policy, cwd)
  const where =
    scope === "folder" && cwd ? `${tildePath(cwd)}/` : scope === "any" ? "any file" : "this file"
  return `${verb} · ${where}`
}

// --- Connections ---------------------------------------------------------------------------------

/** "stdio", "http :7341", "headless", "in-process" (meta lines). */
export function transportLabel(c: McpConnectionInfo, status?: McpServerStatus | null): string {
  switch (c.identity.transport) {
    case "socket":
      return "stdio"
    case "http":
      return status?.http.port ? `http :${status.http.port}` : "http"
    case "stdio-headless":
      return "headless"
    default:
      return "in-process"
  }
}

/** "Since 10:42 · 2 files open · stdio" (AgentClientRow Meta). */
export function clientMeta(c: McpConnectionInfo, status?: McpServerStatus | null): string {
  const n = c.docs.length
  return `Since ${clock(c.connectedAt)} · ${n} ${n === 1 ? "file" : "files"} open · ${transportLabel(c, status)}`
}

/** Generic icon per host kind (never a vendor logo). */
export function chipIcon(c: McpConnectionInfo): "terminal" | "editor" | "agent" {
  const slug = c.identity.client
  if (slug === "cursor" || slug === "vscode") return "editor"
  if (slug === "claude-code" || slug === "codex" || slug === "gemini-cli") return "terminal"
  return "agent"
}

// --- Server status (rule "Server status") ---------------------------------------------------------

export interface ServerError {
  /** "EADDRINUSE 127.0.0.1:7341". */
  code: string
  /** Banner body: "Port 7341 is in use (node, pid 48211). Stdio agents still work over the local socket." */
  message: string
  /** The port that failed and a free suggestion (Port Fix row). */
  port?: number
  suggestedPort?: number
}

export function serverPill(
  status: McpServerStatus | null,
  connections: number,
  error?: ServerError | null,
): { tone: AgentPillTone; label: string } {
  if (error || status?.documentHost === "failed")
    return {
      tone: "danger",
      label: status?.socket.listening ? "Error · HTTP down" : "Error · server down",
    }
  if (!status?.socket.listening) return { tone: "neutral", label: "Stopped" }
  if (status.documentHost === "starting" || status.documentHost === "restarting")
    return { tone: "neutral", label: "Starting…" }
  if (connections === 0) return { tone: "success", label: "Running · no clients" }
  return {
    tone: "success",
    label: `Running · ${connections} ${connections === 1 ? "client" : "clients"}`,
  }
}

// --- Host rows (rule "Host rows") ------------------------------------------------------------------

export type HostRowState = "installed" | "outdated" | "not-installed" | "not-found"

const HOST_KEY: Record<McpHostId, string> = {
  "claude-code": "mcpServers.kimo",
  codex: "[mcp_servers.kimo]",
  "gemini-cli": "mcpServers.kimo",
  cursor: "mcpServers.kimo",
  vscode: "servers.kimo",
}

/** Lucide icon per host (generic, board 21 instances). */
export const HOST_ICON: Record<McpHostId, string> = {
  "claude-code": "square-terminal",
  codex: "terminal",
  "gemini-cli": "sparkle",
  cursor: "mouse-pointer-2",
  vscode: "code-xml",
}

/** Display order of the five hosts on the board. */
export const HOST_ORDER: McpHostId[] = ["claude-code", "codex", "gemini-cli", "cursor", "vscode"]

export function hostRowState(h: McpHostConfigStatus): HostRowState {
  if (h.installed) return h.current ? "installed" : "outdated"
  return h.configExists ? "not-installed" : "not-found"
}

export interface HostRowView {
  host: McpHostId
  state: HostRowState
  icon: string
  name: string
  status: { tone: AgentPillTone; label: string }
  path: string
  muted: boolean
}

/** One AgentHostRow from an installer status (`entryVersion` = the version an outdated entry names). */
export function hostRowView(
  h: McpHostConfigStatus,
  opts: { home?: string | null; machine?: string; entryVersion?: string } = {},
): HostRowView {
  const state = hostRowState(h)
  const path = tildePath(h.path, opts.home)
  const machine = opts.machine ?? "this computer"
  const base = { host: h.host, state, icon: HOST_ICON[h.host], name: h.label }
  switch (state) {
    case "installed":
      return {
        ...base,
        status: { tone: "success", label: "Installed" },
        path: `${path} · ${HOST_KEY[h.host]}`,
        muted: false,
      }
    case "outdated":
      return {
        ...base,
        status: {
          tone: "warning",
          label: opts.entryVersion ? `Outdated · kimo-mcp ${opts.entryVersion}` : "Outdated",
        },
        path: `${path} · ${HOST_KEY[h.host]}`,
        muted: false,
      }
    case "not-installed":
      return {
        ...base,
        status: { tone: "neutral", label: "Not installed" },
        path: `${path} · not configured`,
        muted: false,
      }
    default:
      return {
        ...base,
        status: { tone: "neutral", label: "Not found" },
        path: `No ${h.label} install found on ${machine}`,
        muted: true,
      }
  }
}

// --- Session ops (AgentOpRow, rule "Session popover") ------------------------------------------------

export interface OpRowView {
  /** kimo_apply_ops op kind. */
  op: string
  target: string
  detail: string
  tone: "agent" | "danger"
  /** Node the row is about (null for variables / themes). */
  nodeId: string | null
  /** Index of the op group in a session (Revert undoes only the top group). */
  group?: number
}

export interface SessionOps {
  /** Op groups of this origin since the last Keep that are still on its undo stack. */
  groups: Extract<OpLogEntry, { kind: "ops" }>[]
  rows: OpRowView[]
  /** Nodes touched by those groups (layer dots; deleted nodes excluded). */
  touched: Set<string>
  /** Revision before the first group / after the last one. */
  before: Revision | null
  after: Revision | null
  /** Distinct nodes the rows name. */
  nodes: number
}

const WIRE: Record<string, string> = {
  setVariables: "set_variables",
  setThemes: "set_theme_axes",
}

/** Short value for op details: `#F4F1EC`, `20`, `2 paints`, `{…}`. */
export function shortValue(v: unknown): string {
  if (v === undefined) return "none"
  if (v === null) return "null"
  if (typeof v === "string") return v.length > 28 ? `${v.slice(0, 27)}…` : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    if (v.length === 1) return shortValue(v[0])
    return `${v.length} items`
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    if (typeof o.color === "string") return o.color
    if (typeof o.ref === "string") return `$${o.ref}`
    const json = JSON.stringify(v)
    return json.length > 28 ? `${json.slice(0, 27)}…` : json
  }
  return String(v)
}

type NameOf = (id: string) => string

/** A name resolver over a store (falls back to the id). */
export function storeNames(
  store: DocStore | null | undefined,
  extra?: Map<string, string>,
): NameOf {
  return (id) => {
    const n = store?.getNode(id) as { name?: unknown; type?: unknown } | undefined
    if (n && typeof n.name === "string" && n.name) return n.name
    const e = extra?.get(id)
    if (e) return e
    if (n && typeof n.type === "string") return n.type
    return id
  }
}

/** Rows for one op group (forward ops + informational inverse). */
export function opRows(
  ops: readonly NormalizedOp[],
  inverse: readonly NormalizedOp[],
  nameOf: NameOf,
  store?: DocStore | null,
): OpRowView[] {
  const rows: OpRowView[] = []
  const inserted = new Map<string, Extract<NormalizedOp, { op: "insert" }>>()
  for (const op of ops) if (op.op === "insert") inserted.set(op.id, op)
  const deletedData = new Map<string, Record<string, unknown>>()
  for (const inv of inverse)
    if (inv.op === "insert") deletedData.set(inv.id, inv.node as Record<string, unknown>)
  const invUpdate = new Map<string, Extract<NormalizedOp, { op: "update" }>>()
  for (const inv of inverse) if (inv.op === "update") invUpdate.set(inv.id, inv)
  const invMove = new Map<string, Extract<NormalizedOp, { op: "move" }>>()
  for (const inv of inverse) if (inv.op === "move") invMove.set(inv.id, inv)
  const nodeName = (id: string, data?: Record<string, unknown>): string => {
    const own = data?.name
    return typeof own === "string" && own ? own : nameOf(id)
  }

  for (const op of ops) {
    switch (op.op) {
      case "insert": {
        const parent = (op.node as { parent?: unknown }).parent
        if (typeof parent === "string" && inserted.has(parent)) break // folded into its parent
        const types = new Set<string>()
        const walk = (id: string) => {
          const ins = inserted.get(id)
          if (!ins) return
          types.add(String((ins.node as { type?: unknown }).type ?? "node"))
          for (const other of inserted.values())
            if ((other.node as { parent?: unknown }).parent === id) walk(other.id)
        }
        walk(op.id)
        const where = typeof parent === "string" ? ` in ${nameOf(parent)}` : ""
        rows.push({
          op: "insert",
          target: nodeName(op.id, op.node as Record<string, unknown>),
          detail: `${[...types].join(" + ")}${where}`,
          tone: "agent",
          nodeId: op.id,
        })
        break
      }
      case "update": {
        if (inserted.has(op.id)) break
        const inv = invUpdate.get(op.id)
        const keys = [...Object.keys(op.set), ...op.unset]
        const target = nodeName(op.id)
        if (keys.length > 3) {
          rows.push({
            op: "update",
            target,
            detail: `${keys.length} props`,
            tone: "agent",
            nodeId: op.id,
          })
          break
        }
        for (const key of keys) {
          const before = inv ? (key in inv.set ? inv.set[key] : undefined) : undefined
          const after = key in op.set ? op.set[key] : undefined
          rows.push({
            op: "update",
            target,
            detail: `${key} ${shortValue(before)} → ${shortValue(after)}`,
            tone: "agent",
            nodeId: op.id,
          })
        }
        break
      }
      case "move": {
        if (inserted.has(op.id)) break
        const from = invMove.get(op.id)?.parent
        const fromName = from === undefined ? "?" : from === null ? "Page" : nameOf(from)
        const toName = op.parent === null ? "Page" : nameOf(op.parent)
        const index = store ? store.children(op.parent, op.at ?? null).indexOf(op.id) : -1
        rows.push({
          op: "move",
          target: nodeName(op.id),
          detail: `${fromName} → ${toName}${index >= 0 ? `, index ${index}` : ""}`,
          tone: "agent",
          nodeId: op.id,
        })
        break
      }
      case "delete": {
        const data = deletedData.get(op.id)
        const type = String(data?.type ?? "node")
        let children = 0
        const kids = new Set<string>([op.id])
        let grew = true
        while (grew) {
          grew = false
          for (const [id, d] of deletedData)
            if (!kids.has(id) && typeof d.parent === "string" && kids.has(d.parent)) {
              kids.add(id)
              children++
              grew = true
            }
        }
        rows.push({
          op: "delete",
          target: nodeName(op.id, data),
          detail: children > 0 ? `${type} · ${children} children` : type,
          tone: "danger",
          nodeId: op.id,
        })
        break
      }
      case "setVariables":
      case "setThemes": {
        const names = [...Object.keys(op.set), ...op.unset]
        rows.push({
          op: WIRE[op.op] ?? op.op,
          target: namesSummary(names),
          detail:
            op.op === "setVariables"
              ? `${names.length} ${names.length === 1 ? "variable" : "variables"}`
              : `${names.length} ${names.length === 1 ? "axis" : "axes"}`,
          tone: op.unset.length > 0 ? "danger" : "agent",
          nodeId: null,
        })
        break
      }
      default:
        break
    }
  }
  return rows
}

/**
 * The op groups of `origin` still on its undo stack, after `keepSeq` (the revision seq of the last
 * Keep), from the op log; plus their rows and touched nodes.
 */
export function sessionOps(
  log: readonly OpLogEntry[],
  origin: string,
  keepSeq: number,
  store?: DocStore | null,
): SessionOps {
  const stack: Extract<OpLogEntry, { kind: "ops" }>[] = []
  const undone: Extract<OpLogEntry, { kind: "ops" }>[] = []
  for (const e of log) {
    if (e.kind === "load" && e.origin === "file") {
      stack.length = 0
      undone.length = 0
    }
    if (!("origin" in e) || e.origin !== origin) continue
    if (e.kind === "ops") {
      stack.push(e)
      undone.length = 0
    } else if (e.kind === "undo") {
      const g = stack.pop()
      if (g) undone.push(g)
    } else if (e.kind === "redo") {
      const g = undone.pop()
      if (g) stack.push(g)
    }
  }
  const groups = stack.filter((g) => g.revision.seq > keepSeq)
  const extra = new Map<string, string>()
  for (const g of groups)
    for (const inv of g.inverse)
      if (inv.op === "insert") {
        const nm = (inv.node as { name?: unknown }).name
        if (typeof nm === "string") extra.set(inv.id, nm)
      }
  const nameOf = storeNames(store, extra)
  const rows = groups.flatMap((g, group) =>
    opRows(g.ops, g.inverse, nameOf, store).map((r) => ({ ...r, group })),
  )
  const touched = new Set<string>()
  for (const g of groups)
    for (const op of g.ops)
      if (op.op === "insert" || op.op === "update" || op.op === "move") touched.add(op.id)
  for (const g of groups) for (const op of g.ops) if (op.op === "delete") touched.delete(op.id)
  if (store) for (const id of [...touched]) if (!store.hasNode(id)) touched.delete(id)
  const first = groups[0]
  const last = groups[groups.length - 1]
  return {
    groups,
    rows,
    touched,
    before: first ? { epoch: first.revision.epoch, seq: first.revision.seq - 1 } : null,
    after: last ? last.revision : null,
    nodes: new Set(rows.map((r) => r.nodeId).filter((id): id is string => id !== null)).size,
  }
}

/** "6 changes · 4 nodes" (session popover List Header). */
export function changesLabel(s: Pick<SessionOps, "rows" | "nodes">): string {
  const c = s.rows.length
  return `${c} ${c === 1 ? "change" : "changes"} · ${s.nodes} ${s.nodes === 1 ? "node" : "nodes"}`
}

// --- Approval prompt (rule "Approval") --------------------------------------------------------------

const GRANT_PHRASE: Record<string, string> = {
  globals: "change variables and themes",
  components: "edit components",
  save: "save this file",
  export: "export files",
  "files.create": "create a file",
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return i >= 0 ? p.slice(i + 1) : p
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What kind of nodes a list is: "frames" when all are frames, else "layers". */
function nodesNoun(ids: readonly string[], store?: DocStore | null): [string, string] {
  const types = ids.map((id) => (store?.getNode(id) as { type?: unknown } | undefined)?.type)
  if (types.length > 0 && types.every((t) => t === "frame")) return ["frame", "frames"]
  return ["layer", "layers"]
}

/** "Codex wants to delete 3 frames". */
export function approvalTitle(r: McpApprovalRequest, store?: DocStore | null): string {
  const who = r.client.label
  const reason = r.reason
  switch (reason.kind) {
    case "destructive": {
      const deletes = reason.ops.every((o) => o === "delete")
      if (deletes && reason.nodeIds.length > 0) {
        const [one, many] = nodesNoun(reason.nodeIds, store)
        return `${who} wants to delete ${plural(reason.nodeIds.length, one, many)}`
      }
      return `${who} wants to ${reason.ops.join(", ")}`
    }
    case "level":
      return reason.need === "delete"
        ? `${who} wants to delete layers`
        : reason.need === "edit"
          ? `${who} wants to edit this file`
          : `${who} wants to read this file`
    case "file":
      return `${who} wants to ${reason.action} ${basename(reason.path)}`
    case "grant":
      return `${who} wants to ${GRANT_PHRASE[reason.grant] ?? reason.grant}`
    case "scope":
      return `${who} wants to edit ${plural(reason.nodeIds.length, "layer")} outside its scope`
  }
}

/** The prompt description (Desc Ckwa6). */
export function approvalDescription(r: McpApprovalRequest, level: McpPermissionLevel): string {
  const tail = "Nothing is applied while you decide. The canvas shows a dry run."
  const reason = r.reason
  switch (reason.kind) {
    case "destructive":
      return `Its permission is ${LEVEL_LABEL[level]}, so deletes need your OK. ${tail}`
    case "level":
      return `Its permission is ${LEVEL_LABEL[reason.have]}, so this call needs your OK. ${tail}`
    case "file":
      return `${tildePath(reason.path)} is outside the files it may touch. Allowing applies to this call only.`
    case "grant":
      return `Its permission doesn’t include ${GRANT_PHRASE[reason.grant] ?? reason.grant}. ${tail}`
    case "scope":
      return `These layers are outside its node scope. Allowing applies to this call only.`
  }
}

/** Target rows of the prompt (AgentOpRow without Revert): deletes, then inserts / updates. */
export function approvalTargets(r: McpApprovalRequest, store?: DocStore | null): OpRowView[] {
  const nameOf = storeNames(store)
  const rows: OpRowView[] = []
  const deleted = new Set<string>(r.reason.kind === "destructive" ? r.reason.nodeIds : [])
  for (const id of deleted) {
    const node = store?.getNode(id) as { type?: unknown } | undefined
    const kids = store ? countDescendants(store, id) : 0
    const type = String(node?.type ?? "node")
    rows.push({
      op: "delete",
      target: nameOf(id),
      detail: kids > 0 ? `${type} · ${kids} children` : type,
      tone: "danger",
      nodeId: id,
    })
  }
  const kinds = r.preview?.kinds
  for (const id of r.preview?.nodeIds ?? []) {
    if (deleted.has(id)) continue
    const kind = kinds?.[id]
    if (kind === "delete") {
      const node = store?.getNode(id) as { type?: unknown } | undefined
      const kids = store ? countDescendants(store, id) : 0
      const type = String(node?.type ?? "node")
      rows.push({
        op: "delete",
        target: nameOf(id),
        detail: kids > 0 ? `${type} · ${kids} children` : type,
        tone: "danger",
        nodeId: id,
      })
      continue
    }
    // The host's dry run says insert / update; older hosts: infer from the replica.
    const exists = kind ? kind === "update" : (store?.hasNode(id) ?? true)
    rows.push({
      op: exists ? "update" : "insert",
      target: exists ? nameOf(id) : id,
      detail: exists ? "" : "new",
      tone: "agent",
      nodeId: id,
    })
  }
  return rows
}

function countDescendants(store: DocStore, id: string): number {
  let n = 0
  const stack = [...store.children(id)]
  while (stack.length) {
    const c = stack.pop() as string
    n++
    stack.push(...store.children(c))
  }
  return n
}

/** Board 34 §4: up to this many target rows show as a flat list; more are grouped by kind. */
export const APPROVAL_FLAT_MAX = 8
/** Board 34 §4: rows shown per kind before "and N more". */
export const APPROVAL_PER_KIND = 3

export interface ApprovalTargetGroup {
  kind: "delete" | "insert" | "update"
  /** "Delete", "Insert", "Update" (Group Header Kind). */
  label: string
  /** Layers of this kind in the request (the dry run's count when larger than the rows sent). */
  total: number
  rows: OpRowView[]
  /** Layers not listed ("and N more"). */
  more: number
}

const GROUP_LABEL = { delete: "Delete", insert: "Insert", update: "Update" } as const

/**
 * Board 34 "Approval with many changes": null while the rows fit a flat list
 * ({@link APPROVAL_FLAT_MAX}); else one group per kind with its first {@link APPROVAL_PER_KIND}
 * rows (all rows with `all`) and the count left.
 */
export function groupApprovalTargets(
  r: McpApprovalRequest,
  rows: readonly OpRowView[],
  all = false,
): ApprovalTargetGroup[] | null {
  if (rows.length <= APPROVAL_FLAT_MAX) return null
  const p = r.preview
  const counts = { delete: p?.deleted ?? 0, insert: p?.inserted ?? 0, update: p?.updated ?? 0 }
  const out: ApprovalTargetGroup[] = []
  for (const kind of ["delete", "insert", "update"] as const) {
    const of = rows.filter((x) => x.op === kind)
    const total = Math.max(of.length, counts[kind])
    if (total === 0) continue
    const shown = all ? of : of.slice(0, APPROVAL_PER_KIND)
    out.push({ kind, label: GROUP_LABEL[kind], total, rows: shown, more: total - shown.length })
  }
  return out
}

/** "kimo_apply_ops · label “Replace hero”" (Meta xydSY). */
export function approvalMeta(r: McpApprovalRequest): string {
  return r.summary ? `${r.tool} · label “${r.summary}”` : r.tool
}

/** Denial code shown in the footnote (rule: Deny → PERMISSION_DENIED / OUT_OF_SCOPE). */
export function denialCode(r: McpApprovalRequest): "PERMISSION_DENIED" | "OUT_OF_SCOPE" {
  return r.reason.kind === "file" || r.reason.kind === "scope"
    ? "OUT_OF_SCOPE"
    : "PERMISSION_DENIED"
}

/** "Codex is waiting. No answer in 2 min → PERMISSION_DENIED. Esc = Deny." */
export function approvalFootnote(
  r: McpApprovalRequest,
  remainingMs: number,
  queued: number,
): string {
  const left = remainingMs >= 119_000 ? "2 min" : countdown(remainingMs)
  const more = queued > 1 ? ` ${queued - 1} more waiting.` : ""
  return `${r.client.label} is waiting. No answer in ${left} → ${denialCode(r)}. Esc = Deny.${more}`
}

// --- Dry run (rule "Dry run") ---------------------------------------------------------------------

export type GhostKind = "delete" | "insert" | "update"

export interface DryRunView {
  ghosts: { id: string; kind: GhostKind; name: string }[]
  counts: { delete: number; insert: number; update: number }
}

/** Ghosts and counts for a pending approval's preview. */
export function dryRunFromApproval(r: McpApprovalRequest, store?: DocStore | null): DryRunView {
  const rows = approvalTargets(r, store)
  const ghosts = rows
    .filter((row) => row.nodeId)
    .map((row) => ({ id: row.nodeId as string, kind: row.op as GhostKind, name: row.target }))
  const p = r.preview
  return {
    ghosts,
    counts: {
      delete: p?.deleted ?? ghosts.filter((g) => g.kind === "delete").length,
      insert: p?.inserted ?? ghosts.filter((g) => g.kind === "insert").length,
      update: p?.updated ?? ghosts.filter((g) => g.kind === "update").length,
    },
  }
}

// --- Activity (rules "Grouping", "Entry", "States") --------------------------------------------------

export type KindFilter = "writes-errors" | "all" | "writes" | "errors"

export const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "writes-errors", label: "Writes + errors" },
  { value: "all", label: "All calls" },
  { value: "writes", label: "Writes" },
  { value: "errors", label: "Errors" },
]

const WRITE_KINDS = new Set<McpActivityKind>([
  "edit",
  "dry-run",
  "undo",
  "redo",
  "save",
  "export",
  "approval",
])
const ERROR_KINDS = new Set<McpActivityKind>(["denied", "error"])

export function matchesKind(kind: McpActivityKind, f: KindFilter): boolean {
  if (f === "all") return true
  if (f === "writes") return WRITE_KINDS.has(kind)
  if (f === "errors") return ERROR_KINDS.has(kind)
  return WRITE_KINDS.has(kind) || ERROR_KINDS.has(kind)
}

const UNDOABLE = new Set<McpActivityKind>(["edit", "undo", "redo"])

export interface ActivityRowView {
  key: string
  entry: McpActivityEntry | null
  request: McpApprovalRequest | null
  time: string
  label: string
  tool: string
  target: string
  tone: "default" | "agent" | "danger" | "warning"
  pending: boolean
  undoable: boolean
  stale: boolean
  /** Undone by you (board 24 h): struck-through label, "Undone by you · 10:52", Redo. */
  undone: boolean
  nodeIds: string[]
}

export interface ActivityGroupView {
  origin: string
  client: string
  name: string
  meta: string
  rows: ActivityRowView[]
  undoable: boolean
}

function toneOf(e: McpActivityEntry): ActivityRowView["tone"] {
  // Board 34: an auto-approved request reads in warning, like a conflict.
  if (e.code === "REVISION_CONFLICT" || e.outcome === "auto") return "warning"
  if (e.kind === "denied" || e.code === "PERMISSION_DENIED" || e.code === "OUT_OF_SCOPE")
    return "danger"
  if (e.kind === "error") return "danger"
  return "default"
}

function outcomeText(e: McpActivityEntry): string {
  switch (e.outcome) {
    case "deny":
      return "denied by you"
    case "timeout":
      return "no answer in 2 min"
    case "disconnected":
      return "client disconnected"
    case "once":
      return "allowed once"
    case "session":
      return "allowed for this session"
    case "auto":
      return "approved automatically"
    default:
      return e.summary
  }
}

/** One ActivityRow from a log entry. */
export function activityRowView(
  e: McpActivityEntry,
  nameOf: NameOf,
  flags: { stale?: boolean; undone?: boolean; undoneAt?: number } = {},
): ActivityRowView {
  const names = (e.nodeIds ?? []).map(nameOf)
  const nodes = namesSummary(names)
  const rev =
    e.revisionBefore && e.revision
      ? `${formatRevision(e.revisionBefore)} → ${formatRevision(e.revision)}`
      : formatRevision(e.revision)
  const failed = e.kind === "denied" || e.kind === "error"
  let tool: string
  if (e.code) tool = `${e.code} · ${outcomeText(e)}`
  else if (e.kind === "approval") tool = `${e.tool ?? "approval"} · ${outcomeText(e)}`
  else {
    const t = e.tool ?? e.kind
    const n = e.nodeIds?.length ?? 0
    // Op count when the host reports it (M5 addendum), else the node count.
    tool =
      e.kind === "edit" && e.opCount
        ? `${t} · ${plural(e.opCount, "op")}`
        : e.kind === "edit" && n > 0
          ? `${t} · ${plural(n, "node")}`
          : t
  }
  let target: string
  if (flags.stale) target = "stale · nothing left to undo"
  else if (failed) target = `${nodes || "document"} · no change`
  else if (!nodes && !rev) target = "no doc change"
  else target = [nodes, rev].filter(Boolean).join(" · ")
  // Board 24 (h) uKH9b: an undone entry stays in the log; the tool line says who and when.
  if (flags.undone && !flags.stale)
    tool =
      flags.undoneAt !== undefined ? `Undone by you · ${clock(flags.undoneAt)}` : "Undone by you"
  return {
    key: `e${e.seq}`,
    entry: e,
    request: null,
    time: clock(e.time),
    label: e.kind === "edit" && e.label ? e.label : e.summary,
    tool,
    target,
    tone: toneOf(e),
    pending: false,
    undoable: !!e.undoToken && UNDOABLE.has(e.kind) && !flags.undone,
    stale: !!flags.stale,
    undone: !!flags.undone && !flags.stale,
    nodeIds: [...(e.nodeIds ?? [])],
  }
}

/** The pending-approval row (agent-soft, teal tool line). */
export function pendingRowView(r: McpApprovalRequest): ActivityRowView {
  const p = r.preview
  const count = p ? p.inserted + p.updated + p.deleted : 0
  return {
    key: `a${r.id}`,
    entry: null,
    request: r,
    time: clock(r.requestedAt),
    label: r.summary,
    tool: `${r.tool} · waiting for approval`,
    target: count > 0 ? `${plural(count, "op")} · not applied yet` : "not applied yet",
    tone: "agent",
    pending: true,
    undoable: false,
    stale: false,
    undone: false,
    nodeIds: [...(p?.nodeIds ?? [])],
  }
}

/**
 * Activity grouped by session (origin), newest first, filtered. `pending` approvals sit at the top of
 * their client's newest group. `transport` names a live session's transport.
 */
export function activityGroups(input: {
  entries: readonly McpActivityEntry[]
  pending: readonly McpApprovalRequest[]
  nameOf: NameOf
  client: string | "all"
  kind: KindFilter
  stale: ReadonlySet<number>
  undone: ReadonlySet<number>
  /** When each undone entry was undone (tool line "Undone by you · 10:52"). */
  undoneAt?: ReadonlyMap<number, number>
  transport?: (origin: string) => string | null
  label?: (origin: string, actor: string) => string
}): ActivityGroupView[] {
  const groups = new Map<
    string,
    {
      origin: string
      actor: string
      first: number
      last: number
      lastSeq: number
      entries: McpActivityEntry[]
    }
  >()
  for (const e of input.entries) {
    let g = groups.get(e.origin)
    if (!g) {
      g = {
        origin: e.origin,
        actor: e.actor,
        first: e.time,
        last: e.time,
        lastSeq: e.seq,
        entries: [],
      }
      groups.set(e.origin, g)
    }
    g.first = Math.min(g.first, e.time)
    g.last = Math.max(g.last, e.time)
    g.lastSeq = Math.max(g.lastSeq, e.seq)
    g.entries.push(e)
  }
  const pendingBy = new Map<string, McpApprovalRequest[]>()
  for (const r of input.pending) {
    const origin = `mcp:${r.client.client}.${r.client.session}`
    const list = pendingBy.get(origin) ?? []
    list.push(r)
    pendingBy.set(origin, list)
    if (!groups.has(origin))
      groups.set(origin, {
        origin,
        actor: r.client.label,
        first: r.requestedAt,
        last: r.requestedAt,
        lastSeq: 0,
        entries: [],
      })
    const g = groups.get(origin)
    if (g) {
      g.last = Math.max(g.last, r.requestedAt)
      g.lastSeq = Number.MAX_SAFE_INTEGER
    }
  }
  const out: ActivityGroupView[] = []
  for (const g of [...groups.values()].sort((a, b) => b.last - a.last || b.lastSeq - a.lastSeq)) {
    const client = clientOf(g.origin)
    if (input.client !== "all" && client !== input.client) continue
    const rows: ActivityRowView[] = []
    for (const r of [...(pendingBy.get(g.origin) ?? [])].sort(
      (a, b) => b.requestedAt - a.requestedAt,
    ))
      rows.push(pendingRowView(r))
    for (const e of [...g.entries].sort((a, b) => b.seq - a.seq)) {
      if (!matchesKind(e.kind, input.kind)) continue
      rows.push(
        activityRowView(e, input.nameOf, {
          stale: input.stale.has(e.seq),
          undone: input.undone.has(e.seq),
          ...(input.undoneAt?.has(e.seq) ? { undoneAt: input.undoneAt.get(e.seq) as number } : {}),
        }),
      )
    }
    if (rows.length === 0) continue
    const transport = input.transport?.(g.origin)
    out.push({
      origin: g.origin,
      client,
      name: input.label?.(g.origin, g.actor) ?? g.actor,
      meta: transport ? `${clock(g.first)} · ${transport}` : clock(g.first),
      rows,
      undoable: rows.some((r) => r.undoable),
    })
  }
  return out
}

/** Export JSON (rule "Retention"): the entries as stored, newest last. */
export function exportActivityJson(fileId: string, entries: readonly McpActivityEntry[]): string {
  return `${JSON.stringify({ version: 1, fileId, exportedAt: new Date().toISOString(), entries }, null, 2)}\n`
}

// --- Presence (rule "Presence chip") ----------------------------------------------------------------

/** Chip label: "Claude Code is editing" / "· edits paused" / "needs approval". */
export function presenceLabel(
  label: string,
  state: "editing" | "paused" | "waiting",
  conn?: Pick<McpConnectionInfo, "state"> | null,
): string {
  if (state === "waiting") return `${label} needs approval`
  if (state === "paused") return `${label} · edits paused`
  const verb =
    conn?.state === "reading" ? "reading" : conn?.state === "rendering" ? "rendering" : "editing"
  return `${label} is ${verb}`
}

/** Now-row copy: the running call when the host reports it, else per connection state. */
export function nowCopy(c: McpConnectionInfo): { label: string; tool: string } | null {
  if (c.call) return { label: c.call.label, tool: c.call.tool }
  return NOW_COPY[c.state]
}

/** Fallback Now-row copy per connection state (hosts without `McpConnectionInfo.call`). */
export const NOW_COPY: Record<McpConnectionInfo["state"], { label: string; tool: string } | null> =
  {
    idle: null,
    reading: { label: "Reading the document", tool: "kimo_query" },
    editing: { label: "Applying ops", tool: "kimo_apply_ops" },
    rendering: { label: "Rendering", tool: "kimo_render" },
    "waiting-approval": { label: "Waiting for your approval", tool: "kimo_apply_ops" },
  }

// --- Copy config -----------------------------------------------------------------------------------

/** The `kimo` entry for a host's config (ADR 0013 §9 table), for "Copy config". */
export function configSnippet(host: McpHostId, command: string): string {
  const args = ["--client", host]
  if (host === "codex")
    return `[mcp_servers.kimo]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\ndefault_tools_approval_mode = "approve"\n`
  const entry =
    host === "gemini-cli"
      ? { command, args, timeout: 600000, trust: false }
      : { type: "stdio", command, args }
  const key = host === "vscode" ? "servers" : "mcpServers"
  return `${JSON.stringify({ [key]: { kimo: entry } }, null, 2)}\n`
}

/** "kimo_pat_••••••••••••3f9a". */
export function maskToken(token: string): string {
  const m = /^(kimo_pat_)?(.*)$/.exec(token)
  const prefix = m?.[1] ?? ""
  const body = m?.[2] ?? token
  return `${prefix}${"•".repeat(12)}${body.slice(-4)}`
}
