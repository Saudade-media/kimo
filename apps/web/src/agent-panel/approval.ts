/**
 * Op rows of the in-thread approval card (board 25 "v1 Polish" §5 G9V6Kf, rule hb9kv: "op rows
 * (icon · verb · target · scope)"). Built from the M5 approval request: its dry-run preview
 * counts when present, else the reason. Lucide icon names; the board draws `trash-2` (delete)
 * and `variable` (a global); the others are chosen here (not drawn).
 */
import type { McpApprovalRequest } from "@kimo/platform"

export type ApprovalOpIcon =
  | "trash-2"
  | "pencil"
  | "plus"
  | "variable"
  | "component"
  | "save"
  | "download"
  | "file-plus"
  | "folder-open"
  | "square-dashed"

export interface ApprovalOpRow {
  icon: ApprovalOpIcon
  label: string
  meta?: string
}

const layers = (n: number) => `${n} layer${n === 1 ? "" : "s"}`
const base = (p: string) => p.split(/[\\/]/).pop() ?? p

export function approvalOps(
  req: McpApprovalRequest,
  names: {
    nodeName?: (id: string) => string | undefined
    parentName?: (id: string) => string | undefined
  } = {},
): ApprovalOpRow[] {
  const ids = req.preview?.nodeIds ?? ("nodeIds" in req.reason ? req.reason.nodeIds : [])
  const first = ids[0]
  const parent = first ? names.parentName?.(first) : undefined
  const one = ids.length === 1 && first ? names.nodeName?.(first) : undefined
  const where = parent ? `in ${parent}` : one
  const r = req.reason
  if (r.kind === "file") {
    const icon: ApprovalOpIcon =
      r.action === "open"
        ? "folder-open"
        : r.action === "create"
          ? "file-plus"
          : r.action === "export"
            ? "download"
            : "save"
    const verb = { open: "Open", create: "Create", export: "Export to", save: "Save" }[r.action]
    const dir = r.path.slice(0, Math.max(0, r.path.length - base(r.path).length - 1))
    return [{ icon, label: `${verb} ${base(r.path)}`, ...(dir ? { meta: dir } : {}) }]
  }
  if (r.kind === "grant") {
    switch (r.grant) {
      case "globals":
        return [{ icon: "variable", label: "Edit global variables", meta: "global" }]
      case "components":
        return [{ icon: "component", label: "Edit components", meta: "library" }]
      case "save":
        return [
          { icon: "save", label: "Save the file", ...(req.path ? { meta: base(req.path) } : {}) },
        ]
      case "export":
        return [
          { icon: "download", label: "Export", ...(req.path ? { meta: base(req.path) } : {}) },
        ]
      case "files.create":
        return [{ icon: "file-plus", label: "Create a file" }]
    }
  }
  const p = req.preview
  const rows: ApprovalOpRow[] = []
  const meta = r.kind === "scope" ? "outside its area" : where
  const withMeta = (row: ApprovalOpRow): ApprovalOpRow => (meta ? { ...row, meta } : row)
  if (p && p.deleted + p.updated + p.inserted > 0) {
    if (p.deleted) rows.push(withMeta({ icon: "trash-2", label: `Delete ${layers(p.deleted)}` }))
    if (p.updated) rows.push(withMeta({ icon: "pencil", label: `Edit ${layers(p.updated)}` }))
    if (p.inserted) rows.push(withMeta({ icon: "plus", label: `Add ${layers(p.inserted)}` }))
    return rows
  }
  if (r.kind === "destructive")
    return [
      withMeta({
        icon: "trash-2",
        label: r.ops.some((o) => /delete|remove/i.test(o))
          ? `Delete ${layers(Math.max(1, r.nodeIds.length))}`
          : req.summary,
      }),
    ]
  if (r.kind === "scope")
    return [
      {
        icon: "square-dashed",
        label: `Edit ${layers(r.nodeIds.length)}`,
        meta: "outside its area",
      },
    ]
  return [{ icon: "pencil", label: req.summary, meta: `needs ${r.need}` }]
}

const PAST: Record<string, string> = { Delete: "deleted", Edit: "edited", Add: "added" }

/**
 * Board 34 thread line for a request auto-approve let through: "Approved automatically: saved
 * landing.kimo". Built from the same request as the card's op rows, in the past tense.
 */
export function autoApprovalLine(
  req: McpApprovalRequest,
  names: {
    name?: (id: string) => string | undefined
    parentName?: (id: string) => string | undefined
  } = {},
): string {
  const r = req.reason
  const what = ((): string => {
    if (r.kind === "file") {
      const name = base(r.path.replace(/[\\/]+$/, "")) + (/[\\/]$/.test(r.path) ? "/" : "")
      return { open: "opened", create: "created", export: "exported to", save: "saved" }[
        r.action
      ].concat(` ${name}`)
    }
    if (r.kind === "grant") {
      const file = req.path ? ` ${base(req.path)}` : ""
      switch (r.grant) {
        case "globals":
          return "changed global variables"
        case "components":
          return "changed components"
        case "save":
          return file ? `saved${file}` : "saved the file"
        case "export":
          return `exported${file}`
        case "files.create":
          return "created a file"
      }
    }
    if (r.kind === "level" && !req.preview) return req.summary
    const rows = approvalOps(req, {
      ...(names.name ? { nodeName: names.name } : {}),
      ...(names.parentName ? { parentName: names.parentName } : {}),
    })
    const meta = rows[0]?.meta
    const verbs = rows.map((row) => {
      const [verb = "", ...rest] = row.label.split(" ")
      const past = PAST[verb]
      return past ? [past, ...rest].join(" ") : row.label
    })
    return `${verbs.join(", ")}${meta ? ` ${meta}` : ""}`
  })()
  return `Approved automatically: ${what}`
}
