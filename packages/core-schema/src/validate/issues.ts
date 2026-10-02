/**
 * Validation issue codes. Errors make a document invalid; warnings are lints (10.6).
 * The descriptions are normative and mirrored in the spec's "Validation" section.
 */
export const ISSUE_CODES = {
  // Structure and versioning
  NOT_AN_OBJECT: "The document root is not a JSON object.",
  SCHEMA: "A value does not match the structural schema.",
  UNKNOWN_PROPERTY: "A property not defined by this format version (preserved, but invalid).",
  UNKNOWN_NODE_TYPE: "A node `type` not defined by this format version.",
  FORMAT_INVALID: "`format` is not a `major.minor.patch` version.",
  FORMAT_NEWER: "The document's format is newer than this reader; it opens read-only.",
  FORMAT_OLDER: "The document's format is older; migrate() it before validating.",
  SCHEMA_URL_MISMATCH: "`$schema` does not name the document's format version.",
  FEATURE_UNKNOWN:
    "`features` lists a feature this reader does not know; the file opens read-only.",
  FEATURE_NOT_DECLARED:
    "A feature-gated construct is used but its feature is not listed in `features`.",
  // Tree
  PARENT_MISSING: "`parent` names a node that does not exist.",
  PARENT_CYCLE: "Following `parent` links leads back to the node.",
  PARENT_NOT_CONTAINER: "The parent's type cannot have children.",
  AT_WITHOUT_INSTANCE: "`at` is set but the parent is not an instance.",
  INSTANCE_CHILD_WITHOUT_AT: "A node whose parent is an instance has no `at`.",
  AT_WITHOUT_OVERRIDE: "`at` does not name a `slot` or `replace` override of the parent instance.",
  REPLACE_COUNT: "A `replace` override does not have exactly one replacement node.",
  ORDER_DUPLICATE: "Two siblings share an `order` key (legal; ties sort by id).",
  // Components and instances
  INSTANCE_VISUAL_FIELD: "A visual field at an instance's top level; it belongs in `props`.",
  REF_MISSING: "An instance's `of` names a node that does not exist.",
  REF_NOT_COMPONENT: "An instance's `of` names a node that is not a component.",
  INSTANCE_CYCLE: "A component contains (directly or transitively) an instance of itself.",
  OVERRIDE_PATH_UNRESOLVED:
    "An override key, `at` or prop target does not resolve to a descendant.",
  OVERRIDE_INVALID: "A `set` override or instance `props` would make the target invalid.",
  SLOT_TARGET_INVALID: "A `slot` override or slot prop targets a node that is not a slot frame.",
  PROP_TARGET_INVALID: "A declared component prop targets a node of the wrong kind.",
  ARG_UNKNOWN: "An instance `args` key is not a declared prop of the component.",
  ARG_INVALID: "An instance `args` value does not fit the declared prop.",
  COMPONENTS_INDEX_INVALID: "The `components` index lists a node that is not a component.",
  // Variables and themes
  VARIABLE_MISSING: "A binding names a variable that does not exist.",
  VARIABLE_TYPE_MISMATCH: "A binding's variable type does not fit the bound property.",
  VARIABLE_CYCLE: "Variable aliases form a cycle.",
  THEME_AXIS_UNKNOWN: "A theme pin or `when` names an undeclared axis.",
  THEME_VALUE_UNKNOWN: "A theme pin or `when` names a value its axis does not declare.",
  THEME_NO_MATCH: "A bound variable has no themed entry for the node's effective theme.",
  // Imports and assets
  ALIAS_UNKNOWN: "A qualified id, binding or axis uses an alias not declared in `imports`.",
  LIBRARY_NOT_LOADED: "References into a library were not checked because it was not supplied.",
  ASSET_MISSING: "An asset reference is not in the asset manifest / asset folder.",
  ASSET_UNUSED: "An asset manifest entry is not referenced.",
  MESH_SIZE: "A mesh paint's `colors` / `points` length is not `cols * rows`.",
  // Lints
  TEXT_INVISIBLE: "A text node's fill paints nothing.",
  FIT_ALL_FILL: "A `fit` frame whose children all `fill` the same axis (circular sizing).",
  VARIABLE_UNUSED: "A variable is not referenced (not reported for library documents).",
} as const

/** A validation issue code. */
export type IssueCode = keyof typeof ISSUE_CODES

/** One problem found by `validate()`. */
export interface ValidationIssue {
  /** JSON Pointer (RFC 6901) into the document. */
  path: string
  code: IssueCode
  message: string
  severity: "error" | "warning"
}

/** Result of `validate()`. `ok` is true when there are no errors (warnings allowed). */
export interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

/** Issue codes reported as warnings. Every other code is an error. */
export const WARNING_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "SCHEMA_URL_MISMATCH",
  "FEATURE_UNKNOWN",
  "ORDER_DUPLICATE",
  "LIBRARY_NOT_LOADED",
  "ASSET_UNUSED",
  "THEME_NO_MATCH",
  "TEXT_INVISIBLE",
  "FIT_ALL_FILL",
  "VARIABLE_UNUSED",
])

/** Collects issues while validating. */
export class IssueSink {
  readonly errors: ValidationIssue[] = []
  readonly warnings: ValidationIssue[] = []
  private readonly seen = new Set<string>()

  add(code: IssueCode, path: string, message: string): void {
    const key = `${code}\u0000${path}\u0000${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    const severity = WARNING_CODES.has(code) ? "warning" : "error"
    ;(severity === "error" ? this.errors : this.warnings).push({ path, code, message, severity })
  }

  result(): ValidationResult {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings }
  }
}
