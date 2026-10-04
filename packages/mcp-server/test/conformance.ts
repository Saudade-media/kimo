/**
 * Host conformance suite (ADR 0013 §10): the behaviours every DocumentHost + handler set must
 * show, run against the desktop document host (with a memory platform) and headless `kimo mcp`.
 * Builders call `describeHostConformance(name, makeHarness)` from their package's tests and turn
 * each todo into a real test. Kept here so the list is one contract.
 */
import { describe, test } from "bun:test"
import type { DocumentHost, ToolHandlers } from "../src/runtime"

export interface ConformanceHarness {
  host: DocumentHost
  handlers: ToolHandlers
  /** Writes a file the host may open (temp dir). */
  writeFile(path: string, text: string): Promise<void>
  readFile(path: string): Promise<string | null>
  dispose(): Promise<void>
}

export const CONFORMANCE_CASES = [
  // Targeting (11.1)
  "every document tool without docId fails INVALID_INPUT (no active-document fallback)",
  "a stale docId fails DOCUMENT_NOT_OPEN with detail.currentDocId",
  // No-overwrite (M5 exit criterion)
  "kimo_create on an existing path fails FILE_EXISTS and leaves the file byte-identical",
  "kimo_open of an unparsable file fails LOAD_FAILED and never writes it, even after edits/save attempts",
  "kimo_save of a read-only (newer format) document fails READ_ONLY and leaves the file untouched",
  "kimo_export never overwrites without overwrite=true (FILE_EXISTS)",
  "kimo_save reports bytes/sha256 only after read-back matched",
  // Concurrency (11.4)
  "kimo_apply_ops with a stale baseRevision fails REVISION_CONFLICT with current revision and changed ids",
  "a baseRevision from another epoch fails REVISION_CONFLICT",
  "dryRun returns ops/inverse/warnings and leaves the revision unchanged",
  "a failing op rolls back the whole call (rolledBack: true, revision unchanged)",
  "@key references resolve within one call and created lists every key",
  // Attribution and undo
  "edits carry origin mcp:<client>.<session>; kimo_history list shows it",
  "kimo_history undo never undoes the user's or another client's edits",
  "kimo_history undo with a non-top token fails without changing anything",
  // Leases (9.4)
  "kimo_open of a file leased by another live process fails DOCUMENT_LOCKED with holder",
  "headless: a lease held by the desktop app suggests attaching",
  // Render
  "kimo_render after kimo_apply_ops in the same turn shows the committed change",
  // Approvals
  "a destructive op with no approver (headless) is denied per policy, not silently applied",
] as const

export function describeHostConformance(
  name: string,
  _make: () => Promise<ConformanceHarness>,
): void {
  describe(`host conformance: ${name}`, () => {
    for (const c of CONFORMANCE_CASES) test.todo(c, () => {})
  })
}
