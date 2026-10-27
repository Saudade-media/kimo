/**
 * `repairDocument`: fixes the validation errors that have a lossless fix, so a damaged file
 * opens for editing as it is. Nothing is ever deleted: a node whose `parent` is missing, part of
 * a cycle or not a container moves to the root of its page, a stray `at` is dropped, and a
 * manifest `sha256` that contradicts its key is dropped (the key keeps the hash).
 *
 * Pure: the input is not modified; the result is a copy when something changed.
 */
import type { JsonObject } from "./json"
import { type ValidateOptions, validate } from "./validate/index"
import type { IssueCode } from "./validate/issues"

/** One fix {@link repairDocument} applied. */
export interface Repair {
  code: IssueCode
  /** JSON pointer of the repaired value. */
  path: string
  message: string
}

/** Codes {@link repairDocument} fixes. */
export const REPAIRABLE_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "PARENT_MISSING",
  "PARENT_CYCLE",
  "PARENT_NOT_CONTAINER",
  "AT_WITHOUT_INSTANCE",
  "ASSET_HASH_MISMATCH",
])

/** A fix can expose another (a cycle broken, then its other members): a few passes settle it. */
const MAX_PASSES = 4

type Obj = Record<string, unknown>

function segments(path: string): string[] {
  return path
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
}

/** The page of `id`'s root ancestor, or undefined (no page, or a broken chain). */
function pageOf(nodes: Obj, id: string): unknown {
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const n = nodes[cur] as Obj | undefined
    if (!n) return undefined
    if (n.parent === null || n.parent === undefined) return n.page
    cur = typeof n.parent === "string" ? n.parent : null
  }
  return undefined
}

/** Returns the document with every {@link REPAIRABLE_CODES} error fixed, and what was fixed. */
export function repairDocument(
  input: JsonObject,
  options: ValidateOptions = {},
): { doc: JsonObject; repairs: Repair[] } {
  const repairs: Repair[] = []
  let doc = input
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const issues = validate(doc, { ...options, lints: false }).errors.filter((i) =>
      REPAIRABLE_CODES.has(i.code),
    )
    if (issues.length === 0) break
    if (doc === input) doc = structuredClone(input)
    const nodes = (doc.nodes ?? {}) as Obj
    const cyclesBroken = new Set<string>()
    for (const issue of issues) {
      const [root, key, field] = segments(issue.path)
      if (root === "assets" && key && field === "sha256") {
        const entry = (doc.assets as Obj | undefined)?.[key] as Obj | undefined
        if (entry && "sha256" in entry) {
          delete entry.sha256
          repairs.push({
            code: issue.code,
            path: issue.path,
            message: `Dropped the sha256 of "${key}"`,
          })
        }
        continue
      }
      if (root !== "nodes" || !key) continue
      const node = nodes[key] as Obj | undefined
      if (!node) continue
      if (issue.code === "AT_WITHOUT_INSTANCE") {
        if ("at" in node) {
          delete node.at
          repairs.push({ code: issue.code, path: issue.path, message: `Dropped "at" of ${key}` })
        }
        continue
      }
      // One member per cycle moves to the root; the next pass sees the cycle gone.
      if (issue.code === "PARENT_CYCLE") {
        const cycle = issue.message.replace(/^[^:]*:\s*/, "").split(" → ")
        if (cycle.some((id) => cyclesBroken.has(id))) continue
        for (const id of cycle) cyclesBroken.add(id)
      }
      if (typeof node.parent !== "string") continue
      const former = node.parent
      const page = issue.code === "PARENT_CYCLE" ? undefined : pageOf(nodes, former)
      node.parent = null
      delete node.at
      if (typeof page === "string" && node.page === undefined) node.page = page
      repairs.push({
        code: issue.code,
        path: issue.path,
        message: `Moved ${key} to the page root (its parent "${former}" ${
          issue.code === "PARENT_MISSING"
            ? "does not exist"
            : issue.code === "PARENT_CYCLE"
              ? "formed a cycle"
              : "cannot have children"
        })`,
      })
    }
  }
  return { doc, repairs }
}
