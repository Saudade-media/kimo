/**
 * Format versioning (teardown 10.2 rules 6–7, spec section "Versioning").
 *
 * The `format` header is a semver string. Major and minor identify the format; a patch
 * release is editorial only and never changes what a document may contain.
 */

/** The format version this package reads and writes. */
export const FORMAT_VERSION = "1.0.0"

/** `$schema` URL written into every document of this format version. */
export const SCHEMA_URL = "https://getkimo.design/schema/kimo-1.0.json"

/** JSON Schema `$id` of the generated schema (same as {@link SCHEMA_URL}). */
export const SCHEMA_ID = SCHEMA_URL

/**
 * `$schema` URL of format 1.0 on the legacy host. The site moved from kimo.design to
 * getkimo.design in 2026-10; files written before keep this URL, and it means the same as
 * {@link SCHEMA_URL} (no warning, no rewrite on save).
 */
export const LEGACY_SCHEMA_URL = "https://kimo.design/schema/kimo-1.0.json"

/** Pattern of a `$schema` URL for any format version, on either host. */
export const SCHEMA_URL_PATTERN =
  "^https://(?:get)?kimo\\.design/schema/kimo-(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.json$"

/** Whether `url` names this format version ({@link SCHEMA_URL} or {@link LEGACY_SCHEMA_URL}). */
export function isCurrentSchemaUrl(url: unknown): boolean {
  return url === SCHEMA_URL || url === LEGACY_SCHEMA_URL
}

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

/**
 * How a document's `format` relates to this reader.
 * - `current`: same major.minor (any patch).
 * - `older`: must be migrated in memory before editing (10.2 rule 6).
 * - `newer`: opens read-only (10.2 rule 7).
 * - `invalid`: not a semver `format`.
 */
export type FormatStatus = "current" | "older" | "newer" | "invalid"

/** Classifies a document's `format` value against {@link FORMAT_VERSION}. */
export function formatStatus(format: unknown): FormatStatus {
  const v = parseFormatVersion(format)
  if (!v) return "invalid"
  const c = compareFormat(v, CURRENT_FORMAT)
  return c === 0 ? "current" : c < 0 ? "older" : "newer"
}
