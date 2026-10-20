/**
 * @kimo/core-schema — the `.kimo` file format (1.0, stable): TypeBox schemas and static types,
 * the generated JSON Schema, validation, normative defaults, canonical serialization,
 * versioning and migrations. Spec: docs/spec/kimo-format-1.0.md.
 */

export {
  type AssetFile,
  type AssetGcPlan,
  isContentAddressed,
  planAssetGc,
  prunedManifest,
  referencedAssets,
  usedFontFamilies,
} from "./assets/gc"
export {
  applySetEntry,
  argEffect,
  argEffects,
  baseRoot,
  COMPONENT_DESCRIPTION_META_KEY,
  type ComponentScope,
  componentOfInstance,
  type DeclaredProp,
  declaredProps,
  derivedChain,
  enclosingComponent,
  instanceSwaps,
  instancesOf,
  isComponentNode,
  isDescendant,
  isLocated,
  type LocatedNode,
  type LocateFailure,
  libraryComponents,
  localComponents,
  locate,
  nodesOf,
  type PathResolution,
  qualify,
  qualifyPath,
  resolveIdPath,
} from "./components"
export { DEFAULTS, DEFAULTS_ADDED_IN_SPEC, type DefaultScope } from "./defaults"
export {
  applyDefaults,
  applyNodeDefaults,
  jsonEqual,
  stripDefaults,
  stripNodeDefaults,
} from "./defaults-ops"
export * from "./edit/index"
export {
  type AppliedOverride,
  createExpandedView,
  documentLookup,
  type ExpandedView,
  type ExpandedViewOptions,
  type ExpansionIssue,
  type ExpansionIssueCode,
  type InstanceInfo,
  MAX_EXPANDED_NODES,
  type NodeLookup,
  type NodeOrigin,
  type NodeRecord,
  type OverrideLayer,
  parseVirtualId,
  qualifyNodeData,
  SHAPING_FIELDS,
  shapesExpansion,
  type ViewLocation,
  virtualId,
} from "./expand"
export { FEATURE_PATTERN, FEATURES, type Feature, isKnownFeature, KNOWN_FEATURES } from "./features"
export {
  escapePointer,
  isObject,
  type JsonObject,
  type JsonValue,
  KimoParseError,
  type ParseErrorCode,
  parseJson,
  pointer,
} from "./json"
export { buildJsonSchema, jsonSchemaText } from "./json-schema"
export {
  type ApplyConflictOptions,
  applyAllConflicts,
  applyConflictSide,
  attachConflicts,
  type ConflictEntry,
  ConflictError,
  type ConflictErrorCode,
  conflictCounts,
  conflictMatchesBody,
  conflictTargetKey,
  conflictTargetsOverlap,
  finishMerge,
  hasConflicts,
  listConflicts,
  MERGE_FEATURE,
  markConflictEdited,
  mergeInfo,
  pointerTokens,
  readPointer,
  type SideValue,
  sideValue,
} from "./merge/conflicts"
export { type MergeDocumentsOptions, mergeDocuments, threeWayMerge } from "./merge/three-way"
export {
  type CycleRepair,
  MERGE_EXIT,
  type ThreeWayMerge,
  type ThreeWayMergeInput,
  type ThreeWayMergeOptions,
  type ThreeWayMergeResult,
} from "./merge/types"
export {
  MIGRATE_0_1_TO_1_0,
  MIGRATIONS,
  type MigrateOptions,
  type MigrateResult,
  type MigrateStatus,
  type Migration,
  migrate,
} from "./migrate"
export { type OpenOptions, type OpenResult, openDocument, type ReadOnlyReason } from "./open"
export {
  DEFAULT_PAGE_NAME,
  isOnPage,
  listPages,
  type PageInfo,
  pageOfRoot,
  rootsByPage,
} from "./pages"
export * from "./pen/index"
export {
  defaultTextFill,
  defaultTheme,
  effectiveTheme,
  isRef,
  isThemedValue,
  type Libraries,
  type Resolution,
  type ResolveFailure,
  resolveVariable,
  selectThemedValue,
  splitQualified,
  TEXT_DEFAULT_VARIABLE,
  type Theme,
  type ThemedSelection,
} from "./resolve"
export * from "./schema/index"
export {
  canonicalize,
  isCanonical,
  KEY_ORDER,
  parse,
  type SerializeOptions,
  serialize,
  structOrder,
} from "./serialize"
export { buildTree, compareCodeUnits, compareSiblings, type Tree } from "./tree"
export {
  DOCUMENT_LEVEL_CODES,
  type FeatureNeed,
  featureGate,
  featuresNeeded,
  ISSUE_CODES,
  type IssueCode,
  type ValidateOptions,
  type ValidationIssue,
  type ValidationResult,
  validate,
  WARNING_CODES,
} from "./validate/index"
export {
  CURRENT_FORMAT,
  compareFormat,
  FORMAT_PATTERN,
  FORMAT_VERSION,
  type FormatStatus,
  type FormatVersion,
  formatLine,
  formatStatus,
  parseFormatVersion,
  SCHEMA_ID,
  SCHEMA_URL,
  SCHEMA_URL_PATTERN,
  schemaUrlFor,
} from "./version"
