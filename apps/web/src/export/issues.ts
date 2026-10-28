/**
 * Export dialog Issues tab (board 27 §10 (c) f6LWt, rule AiMJh): the exporter's warnings and
 * errors from the dry run, grouped per output file, each with a level, the message and the node
 * it concerns ("Card › Glass", "—" without one); "Copy report" copies {@link issuesReport}.
 * Issues never block the export. Pure — unit-tested directly.
 */

/** Exporter issue codes that mean the output is wrong, not just approximated. */
const ERROR_CODES = new Set([
  "NODE_NOT_FOUND",
  "INSTANCE_UNRESOLVED",
  "VARIABLE_UNRESOLVED",
  "ICON_MISSING",
])

type IssueLevel = "error" | "warning"

/** `@kimo/exporters` `ExportIssue` (with the `file` `exportDocument` attributes). */
interface RawIssue {
  code: string
  message: string
  nodeId?: string
  file?: string
}

export interface IssueRow {
  level: IssueLevel
  message: string
  /** The node to select (view id), or null. */
  nodeId: string | null
  /** Node chip text: "Card › Glass", or "—". */
  path: string
}

export interface IssueGroup {
  file: string
  issues: IssueRow[]
}

/** File name of issues that belong to no output file (a target that could not run). */
export const EXPORT_GROUP = "Export"

const issueLevel = (code: string): IssueLevel => (ERROR_CODES.has(code) ? "error" : "warning")

/** "Card › Glass": the node's parent and own layer names (just its name at a root). */
function nodePath(names: readonly string[] | null | undefined): string {
  if (!names || names.length === 0) return "—"
  return names.slice(-2).join(" › ")
}

/**
 * Issues grouped per file, files in output order (`files`), then any other file named by an
 * issue; duplicates (same level, node and message in one file) collapse. `failures` (targets
 * that could not be generated) form a trailing {@link EXPORT_GROUP} group of errors.
 */
export function groupIssues(
  issues: readonly RawIssue[],
  options: {
    files?: readonly string[]
    names?: (nodeId: string) => readonly string[] | null
    failures?: readonly string[]
  } = {},
): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const f of options.files ?? []) groups.set(f, { file: f, issues: [] })
  const seen = new Set<string>()
  for (const i of issues) {
    const file = i.file ?? EXPORT_GROUP
    const level = issueLevel(i.code)
    const key = `${file}\u0000${level}\u0000${i.nodeId ?? ""}\u0000${i.message}`
    if (seen.has(key)) continue
    seen.add(key)
    let g = groups.get(file)
    if (!g) {
      g = { file, issues: [] }
      groups.set(file, g)
    }
    const nodeId = i.nodeId ?? null
    g.issues.push({
      level,
      message: i.message,
      nodeId,
      path: nodeId ? nodePath(options.names?.(nodeId) ?? null) : "—",
    })
  }
  for (const message of options.failures ?? []) {
    const g = groups.get(EXPORT_GROUP) ?? { file: EXPORT_GROUP, issues: [] }
    groups.set(EXPORT_GROUP, g)
    g.issues.push({ level: "error", message, nodeId: null, path: "—" })
  }
  return [...groups.values()].filter((g) => g.issues.length > 0)
}

export const issueTotal = (groups: readonly IssueGroup[]) =>
  groups.reduce((n, g) => n + g.issues.length, 0)

export const hasIssueError = (groups: readonly IssueGroup[]) =>
  groups.some((g) => g.issues.some((i) => i.level === "error"))

/** "2 issues" / "1 issue". */
export const issuesLabel = (n: number) => `${n} issue${n === 1 ? "" : "s"}`

/** "Copy report": plain text, one block per file. */
export function issuesReport(groups: readonly IssueGroup[], title = "Kimo export issues"): string {
  const total = issueTotal(groups)
  const errors = groups.reduce((n, g) => n + g.issues.filter((i) => i.level === "error").length, 0)
  const lines = [`${title}: ${issuesLabel(total)} (${errors} error${errors === 1 ? "" : "s"})`]
  for (const g of groups) {
    lines.push("", `${g.file}: ${issuesLabel(g.issues.length)}`)
    for (const i of g.issues)
      lines.push(`  ${i.level === "error" ? "error  " : "warning"}  ${i.message}  [${i.path}]`)
  }
  return `${lines.join("\n")}\n`
}
