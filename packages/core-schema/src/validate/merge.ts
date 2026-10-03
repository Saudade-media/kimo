/**
 * Semantic rules for stored merge conflicts (spec §21.3). Whole-document runs only: the codes
 * are in DOCUMENT_LEVEL_CODES, so incremental runs neither report nor clear them.
 */
import { escapePointer, isObject } from "../json"
import {
  conflictMatchesBody,
  conflictTargetsOverlap,
  listConflicts,
  pointerTokens,
} from "../merge/conflicts"
import { Variable } from "../schema/document"
import { Conflict, HEADER_CONFLICT_MEMBERS, PROP_CONFLICT_FORBIDDEN } from "../schema/merge"
import type { IssueSink } from "./issues"
import { check, schemaIssues } from "./structural"

const at = (id: string, key?: string) =>
  `/conflicts/${escapePointer(id)}${key === undefined ? "" : `/${key}`}`

/** Reports the conflict rules. `need` declares the feature gate. */
export function checkConflicts(
  raw: Record<string, unknown>,
  sink: IssueSink,
  lints: boolean,
  need: (feature: string, path: string, what: string) => void,
): void {
  const table = raw.conflicts
  const hasTable = isObject(table) && Object.keys(table).length > 0
  if (raw.merge !== undefined && !hasTable) {
    sink.add("MERGE_WITHOUT_CONFLICTS", "/merge", "`merge` needs a non-empty `conflicts` table")
  }
  if (raw.merge !== undefined) need("merge/conflicts", "/merge", "`merge`")
  if (!isObject(table)) return
  need("merge/conflicts", "/conflicts", "Stored merge conflicts")
  const entries = listConflicts(raw).filter((e) => isObject(e.conflict))
  const wellFormed: { id: string; conflict: Conflict }[] = []
  for (const { id, conflict } of entries) {
    // Structurally broken entries are reported by the schema pass (SCHEMA) and skipped here.
    if (!check(Conflict, conflict)) continue
    const c = conflict as Conflict
    if (c.kind === "prop" && typeof c.path === "string") {
      const first = pointerTokens(c.path)[0]
      if (first !== undefined && PROP_CONFLICT_FORBIDDEN.has(first)) {
        sink.add(
          "CONFLICT_PATH_INVALID",
          at(id, "path"),
          `"${first}" is not a property conflict; use a ${first === "type" ? "node" : "move"} conflict`,
        )
        continue
      }
    }
    if (c.kind === "header" && typeof c.path === "string") {
      const first = pointerTokens(c.path)[0] ?? ""
      if (!HEADER_CONFLICT_MEMBERS.has(first)) {
        sink.add(
          "CONFLICT_PATH_INVALID",
          at(id, "path"),
          `A header conflict cannot address "${first}"`,
        )
        continue
      }
    }
    if (c.kind === "variable" && c.when === undefined) {
      let bad = false
      for (const side of ["base", "ours", "theirs"] as const) {
        const v = (c as Record<string, unknown>)[side]
        if (v !== undefined && !check(Variable, v)) {
          schemaIssues(Variable, v, at(id, side), sink)
          bad = true
        }
      }
      if (bad) continue
    }
    wellFormed.push({ id, conflict: c })
  }
  for (let i = 0; i < wellFormed.length; i++) {
    for (let j = i + 1; j < wellFormed.length; j++) {
      const a = wellFormed[i] as { id: string; conflict: Conflict }
      const b = wellFormed[j] as { id: string; conflict: Conflict }
      if (conflictTargetsOverlap(a.conflict, b.conflict)) {
        sink.add("CONFLICT_DUPLICATE", at(b.id), `Overlaps conflict "${a.id}"`)
      }
    }
  }
  if (!lints) return
  for (const { id, conflict } of wellFormed) {
    if (conflict.resolved !== true) {
      sink.add("CONFLICT_OPEN", at(id), `Conflict on ${describe(conflict)} is not resolved`)
    }
    if (!conflictMatchesBody(raw, conflict)) {
      sink.add(
        "CONFLICT_STALE",
        at(id, "applied"),
        `The document no longer holds "${conflict.applied}" for ${describe(conflict)}`,
      )
    }
  }
}

function describe(c: Conflict): string {
  switch (c.kind) {
    case "prop":
      return `node ${c.node} ${c.path}`
    case "node":
    case "move":
      return `node ${c.node}`
    case "variable":
      return `variable ${c.variable}`
    case "header":
      return c.path
  }
}
