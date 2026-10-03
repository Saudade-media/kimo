/**
 * Contract of the semantic three-way merge (`kimo merge`, the file watcher's merge with local
 * edits, git "Keep my edits"), spec §21.4 and ADR 0012. The implementation lands in
 * `src/merge/three-way.ts` (M4 merge builder) and is exported as `mergeDocuments`.
 */
import type { KimoDocument } from "../schema/document"
import type { Conflict, MergeInfo } from "../schema/merge"

/** Inputs of a three-way merge: all three documents at the reader's current format. */
export interface ThreeWayMergeInput {
  base: KimoDocument
  ours: KimoDocument
  theirs: KimoDocument
  /** Labels written to the result's `merge` member (git `%S` / `%X` / `%Y`). */
  labels?: Pick<MergeInfo, "base" | "ours" | "theirs">
}

/** Options of a three-way merge. */
export interface ThreeWayMergeOptions {
  /**
   * Generates conflict ids (node-id grammar). Default: 10-char base62 ids that do not collide
   * with node ids of any input. Injectable for deterministic tests.
   */
  newId?: () => string
}

/** A post-merge cycle repair (teardown 9.2 "Tree moves on Yjs"). */
export interface CycleRepair {
  node: string
  /** Where the node was reparented to (its previous parent, or the root). */
  parent: string | null
}

/** Result of a three-way merge. */
export interface ThreeWayMergeResult {
  /**
   * The merged document. With conflicts it carries `conflicts`, `merge` and the
   * `merge/conflicts` feature, and its body holds `ours` for every conflict (except delete vs
   * edit, where it holds the edited side); it always validates (spec §21.4 rule 6).
   */
  doc: KimoDocument
  /** The stored conflicts by id (empty when clean). */
  conflicts: Record<string, Conflict>
  /** Changes applied without conflict (also `merge.changes`). */
  changes: number
  /** Cycles repaired after the merge. */
  repairs: CycleRepair[]
}

/** The merge function's signature. */
export type ThreeWayMerge = (
  input: ThreeWayMergeInput,
  options?: ThreeWayMergeOptions,
) => ThreeWayMergeResult

/**
 * Exit codes of `kimo merge <base> <ours> <theirs> [path] [-o out] [-L ours,base,theirs]` when
 * used as a git merge driver (`*.kimo merge=kimo diff=kimo` with
 * `driver = kimo merge %O %A %B %P`: base = %O, ours = %A, which receives the result,
 * theirs = %B, path = %P for messages; the `-L` labels are optional):
 * - 0: clean merge, `%A` holds the canonical result;
 * - 1: merged with stored conflicts, `%A` holds a valid document with `conflicts` (git marks
 *   the path conflicted; the editor opens it on board 18);
 * - 2: could not merge semantically (an input is unparsable, invalid or a newer format); `%A`
 *   is left as git's textual merge result so the user sees ordinary markers (board 17
 *   "Failed load" explains them).
 */
export const MERGE_EXIT = { clean: 0, conflicts: 1, failed: 2 } as const
