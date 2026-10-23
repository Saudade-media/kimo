/**
 * @kimo/editor-state — the document engine shared by the editor, agent, MCP server, CLI and
 * apps/server (teardown 9.1–9.4): a {@link DocStore} over a flat Yjs node table, the typed op
 * layer (validate → apply as one transaction with an origin → revision + inverse + op log),
 * per-origin undo, post-merge cycle repair, and a separate Zustand store for UI state.
 *
 * Runs unchanged in Bun, Node, browsers and workers (no DOM or Node APIs).
 */
import {
  FORMAT_VERSION,
  type KimoDocument,
  SCHEMA_URL,
  type ValidateOptions,
  validate,
} from "@kimo/core-schema"
import type { DocStore, DocStoreOptions, LoadOptions } from "./types"
import { DocumentInvalidError } from "./types"
import { YjsDocStore } from "./yjs-store"

/**
 * File-format entry points re-exported for persistence providers (`@kimo/sync`), which per
 * teardown 9.1 depend only on editor-state, never on `@kimo/core-schema` directly.
 */
export {
  KimoParseError,
  type OpenOptions,
  type OpenResult,
  openDocument,
  type ReadOnlyReason,
  serialize,
} from "@kimo/core-schema"
export {
  CLAIM_EXPIRING_MS,
  CLAIM_TTL_MS,
  type ClaimConflict,
  type ClaimRecord,
  ClaimRegistry,
  type ClaimRegistryOptions,
  type ClaimTree,
  type ClaimView,
  claimsFor,
  claimTeam,
  type HumanEdit,
  isClaimingOrigin,
  isClaimRespectingOrigin,
  MAX_PUBLISHED_CLAIM_IDS,
  releaseClaims,
} from "./claims"
export { generateId, isNodeId } from "./ids"
export {
  applyTextEdits,
  changedRegion,
  contentOf,
  diffTextRuns,
  liveRepresentable,
  normalizeTextRuns,
  sameTextAttrs,
  type TextAttrs,
  type TextDelta,
  type TextEdit,
  TextEditError,
  type TextRun,
  textOfRuns,
  textRunsOf,
  transformOffset,
} from "./live-text"
export type {
  BatchOp,
  DeleteOp,
  HeaderOpKey,
  InsertOp,
  MoveOp,
  NodeData,
  NodeInput,
  NormalizedDelete,
  NormalizedInsert,
  NormalizedMove,
  NormalizedOp,
  NormalizedSetHeader,
  NormalizedSetThemes,
  NormalizedSetVariables,
  NormalizedUpdate,
  Op,
  Placement,
  SetHeaderOp,
  SetThemesOp,
  SetVariablesOp,
  UpdateOp,
} from "./ops"
export { flattenOps, HEADER_OP_KEYS } from "./ops"
export {
  type InsertKeyPlan,
  isFractionalKey,
  isOrderKey,
  keyBetween,
  keysBetween,
  MAX_ORDER_KEY_LENGTH,
  ORDER_DIGITS,
  OrderKeyError,
  type OrderKeyOptions,
  planInsertKeys,
} from "./order-key"
export {
  isLocalOrigin,
  isOrigin,
  isRemoteOrigin,
  type LocalOrigin,
  type Origin,
  type RemoteOrigin,
} from "./origin"
export {
  addPageOps,
  deletePageOps,
  duplicatePageOps,
  materializePageOps,
  movePageOps,
  moveToPageOps,
  nextPageName,
  type PageEdit,
  type PageReader,
  pageOfNode,
  pageRoots,
  pagesOf,
  renamePageOps,
} from "./pages"
export { type MoveRecord, planTreeRepairs, type TreeFields, type TreeRepair } from "./repair"
export * from "./types"
export {
  bindUiToDocument,
  createUiStore,
  MAX_ZOOM,
  MIN_ZOOM,
  type Tool,
  type UiInit,
  type UiState,
  type Viewport,
} from "./ui-store"
export { createDocStore, YjsDocStore } from "./yjs-store"

/** A new, empty, valid document at the current format version. */
export function createEmptyDocument(name?: string): KimoDocument {
  const doc: KimoDocument = { $schema: SCHEMA_URL, format: FORMAT_VERSION, nodes: {} }
  if (name !== undefined) doc.meta = { name }
  return doc
}

/**
 * Creates a store holding `doc` (validated; throws {@link DocumentInvalidError} on errors).
 * Equivalent to `createDocStore(doc, options)`.
 */
export function importDocument(
  doc: KimoDocument,
  options: DocStoreOptions & { load?: LoadOptions } = {},
): DocStore {
  const store = new YjsDocStore(options)
  store.loadDocument(doc, options.load)
  return store
}

/**
 * Exports a store's content as a plain document, validated against `validateOptions`.
 * Throws {@link DocumentInvalidError} when the content is invalid, unless `allowInvalid`.
 */
export function exportDocument(
  store: DocStore,
  options: { validateOptions?: ValidateOptions; allowInvalid?: boolean } = {},
): KimoDocument {
  const doc = store.toDocument()
  if (!options.allowInvalid) {
    const r = validate(doc, options.validateOptions)
    if (!r.ok) throw new DocumentInvalidError(r.errors)
  }
  return doc
}
