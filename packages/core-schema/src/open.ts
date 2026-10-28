/**
 * `openDocument`: parse → version check → migrate → repair → validate, returning the flags an
 * editor needs to decide whether it may save (teardown 10.2 rules 6–7, 9.4 "failed loads are
 * terminal"). Only a file this reader cannot understand opens read-only (a newer or unknown
 * format, an unsupported feature); validation errors never lock a file: the lossless ones are
 * repaired in memory and the rest are reported.
 */
import { isKnownFeature, KNOWN_FEATURES } from "./features"
import type { JsonObject } from "./json"
import { type Migration, migrate } from "./migrate"
import { type Repair, repairDocument } from "./repair"
import type { KimoDocument } from "./schema/document"
import { parse } from "./serialize"
import { type ValidateOptions, type ValidationResult, validate } from "./validate/index"

/** Why a document opened read-only. */
export interface ReadOnlyReason {
  code: "FORMAT_NEWER" | "FORMAT_INVALID" | "NO_MIGRATION_PATH" | "FEATURE_UNSUPPORTED"
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
  /** Validation of the (migrated, repaired) document; null when it could not be validated (newer/invalid format). */
  validation: ValidationResult | null
  /**
   * Fixes applied in memory ({@link repairDocument}). The file itself changes only when the
   * document is next saved, so opening never writes.
   */
  repairs: Repair[]
}

/** Options for {@link openDocument}. */
export interface OpenOptions extends ValidateOptions {
  /** Migration registry (default: the built-in one). */
  migrations?: readonly Migration[]
  /** Repair lossless validation errors in memory (default true). `kimo validate` reports the file as written. */
  repair?: boolean
  /** @deprecated Validation errors never make a document read-only; ignored. */
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
  let doc = m.doc
  let repairs: Repair[] = []
  if (reasons.length === 0 || reasons.every((r) => r.code === "FEATURE_UNSUPPORTED")) {
    if (options.repair !== false) ({ doc, repairs } = repairDocument(doc, options))
    validation = validate(doc, options)
  }
  return {
    doc: doc as unknown as KimoDocument,
    readOnly: reasons.length > 0,
    readOnlyReasons: reasons,
    sourceFormat,
    needsUpgradeConsent: m.status === "migrated",
    appliedMigrations: m.applied,
    validation,
    repairs,
  }
}
