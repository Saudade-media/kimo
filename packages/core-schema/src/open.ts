/**
 * `openDocument`: parse → version check → migrate → validate, returning the flags an editor
 * needs to decide whether it may save (teardown 10.2 rules 6–7, 9.4 "failed loads are terminal").
 */
import { isKnownFeature, KNOWN_FEATURES } from "./features"
import type { JsonObject } from "./json"
import { type Migration, migrate } from "./migrate"
import type { KimoDocument } from "./schema/document"
import { parse } from "./serialize"
import { type ValidateOptions, type ValidationResult, validate } from "./validate/index"

/** Why a document opened read-only. */
export interface ReadOnlyReason {
  code: "FORMAT_NEWER" | "FORMAT_INVALID" | "NO_MIGRATION_PATH" | "FEATURE_UNSUPPORTED" | "INVALID"
  message: string
}

/** Result of {@link openDocument}. */
export interface OpenResult {
  /** The document (migrated in memory when it was older). Unknown properties are preserved. */
  doc: KimoDocument
  /** True when saving must be refused. */
  readOnly: boolean
  readOnlyReasons: ReadOnlyReason[]
  /** The file's `format` as read. */
  sourceFormat: string | null
  /**
   * True when the document was migrated in memory: autosave goes to a recovery file, never
   * the working file, until the user accepts the upgrade or saves explicitly (10.2 rule 6).
   */
  needsUpgradeConsent: boolean
  /** Descriptions of the migration steps applied. */
  appliedMigrations: string[]
  /** Validation of the (migrated) document; null when it could not be validated (newer/invalid format). */
  validation: ValidationResult | null
}

/** Options for {@link openDocument}. */
export interface OpenOptions extends ValidateOptions {
  /** Migration registry (default: the built-in one). */
  migrations?: readonly Migration[]
  /** Open documents with validation errors for editing anyway (default false: read-only). */
  allowInvalid?: boolean
}

/**
 * Opens `.kimo` text. Throws only for unreadable input (`KimoParseError`); every other problem
 * is reported through `readOnly` / `readOnlyReasons` / `validation`.
 */
export function openDocument(text: string, options: OpenOptions = {}): OpenResult {
  const parsed = parse(text) as unknown as JsonObject
  const sourceFormat = typeof parsed.format === "string" ? parsed.format : null
  const reasons: ReadOnlyReason[] = []
  const m = migrate(parsed, options.migrations ? { migrations: options.migrations } : {})
  if (m.status === "newer") {
    reasons.push({ code: "FORMAT_NEWER", message: `Format ${sourceFormat} needs a newer Kimo` })
  } else if (m.status === "invalid") {
    reasons.push({
      code: "FORMAT_INVALID",
      message: `Unrecognized format ${JSON.stringify(parsed.format)}`,
    })
  } else if (m.status === "no-path") {
    reasons.push({ code: "NO_MIGRATION_PATH", message: `No migration from format ${sourceFormat}` })
  }
  const supported = new Set<string>(options.supportedFeatures ?? KNOWN_FEATURES)
  const features = Array.isArray(m.doc.features) ? m.doc.features : []
  for (const f of features) {
    if (typeof f === "string" && (!isKnownFeature(f) || !supported.has(f))) {
      reasons.push({ code: "FEATURE_UNSUPPORTED", message: `Feature "${f}" needs a newer Kimo` })
    }
  }
  let validation: ValidationResult | null = null
  if (reasons.length === 0 || reasons.every((r) => r.code === "FEATURE_UNSUPPORTED")) {
    validation = validate(m.doc, options)
    if (!validation.ok && !options.allowInvalid) {
      reasons.push({ code: "INVALID", message: `${validation.errors.length} validation error(s)` })
    }
  }
  return {
    doc: m.doc as unknown as KimoDocument,
    readOnly: reasons.length > 0,
    readOnlyReasons: reasons,
    sourceFormat,
    needsUpgradeConsent: m.status === "migrated",
    appliedMigrations: m.applied,
    validation,
  }
}
