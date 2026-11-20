/**
 * Format versioning (teardown 10.2 rules 6–7, spec section "Versioning").
 *
 * The `format` header is a semver string. Major and minor identify the format; a patch
 * release is editorial only and never changes what a document may contain.
 */

/**
 * The format version this package writes by default. Documents with comments are written as
 * {@link COMMENTS_FORMAT_VERSION}; every other document stays 1.0 so older Kimo keeps editing it.
 */
export const FORMAT_VERSION = "1.0.0"

/** The newest format version this package reads and writes (1.1 adds root `comments`). */
export const READER_FORMAT_VERSION = "1.1.0"

/** The format version of a document that has comments. */
export const COMMENTS_FORMAT_VERSION = "1.1.0"

/** `$schema` URL written into every document of format 1.0. */
export const SCHEMA_URL = "https://getkimo.design/schema/kimo-1.0.json"

/** `$schema` URL of format 1.1. */
export const COMMENTS_SCHEMA_URL = "https://getkimo.design/schema/kimo-1.1.json"

/** JSON Schema `$id` of the generated schema (same as {@link SCHEMA_URL}). */
export const SCHEMA_ID = SCHEMA_URL

/** Pattern of a `$schema` URL for any format version. */
export const SCHEMA_URL_PATTERN =
  "^https://getkimo\\.design/schema/kimo-(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.json$"

/** Pattern of the `format` header (semver core, no pre-release or build metadata). */
export const FORMAT_PATTERN = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"

/** A parsed `major.minor.patch` version. */
export interface FormatVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

const FORMAT_RE = new RegExp(FORMAT_PATTERN)

/** Parses a `format` string. Returns `null` when it is not `major.minor.patch`. */
export function parseFormatVersion(format: unknown): FormatVersion | null {
  if (typeof format !== "string") return null
  const m = FORMAT_RE.exec(format)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/** Compares two versions on major and minor only (patch is editorial). */
export function compareFormat(a: FormatVersion, b: FormatVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  return 0
}

/** `"major.minor"` key used by the migration registry. */
export function formatLine(v: FormatVersion): string {
  return `${v.major}.${v.minor}`
}

/** The `$schema` URL that belongs to a version. */
export function schemaUrlFor(v: FormatVersion): string {
  return `https://getkimo.design/schema/kimo-${v.major}.${v.minor}.json`
}

/** The parsed {@link FORMAT_VERSION}. */
export const CURRENT_FORMAT: FormatVersion = parseFormatVersion(FORMAT_VERSION) as FormatVersion

/** The parsed {@link READER_FORMAT_VERSION}. */
export const READER_FORMAT: FormatVersion = parseFormatVersion(
  READER_FORMAT_VERSION,
) as FormatVersion

/**
 * True for a version this reader opens as current: from {@link CURRENT_FORMAT} up to
 * {@link READER_FORMAT}. Format 1.1 only adds a member, so 1.0 and 1.1 need no migration.
 */
export function isCurrentFormat(v: FormatVersion): boolean {
  return compareFormat(v, CURRENT_FORMAT) >= 0 && compareFormat(v, READER_FORMAT) <= 0
}

/**
 * How a document's `format` relates to this reader.
 * - `current`: 1.0 or 1.1 (any patch).
 * - `older`: must be migrated in memory before editing (10.2 rule 6).
 * - `newer`: opens read-only (10.2 rule 7).
 * - `invalid`: not a semver `format`.
 */
export type FormatStatus = "current" | "older" | "newer" | "invalid"

/** Classifies a document's `format` value against {@link FORMAT_VERSION}. */
export function formatStatus(format: unknown): FormatStatus {
  const v = parseFormatVersion(format)
  if (!v) return "invalid"
  if (isCurrentFormat(v)) return "current"
  return compareFormat(v, CURRENT_FORMAT) < 0 ? "older" : "newer"
}
