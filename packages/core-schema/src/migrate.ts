/**
 * Format migrations (teardown 10.2 rule 6, 10.6). A migration is a pure function from one
 * format line (`major.minor`) to the next. Migrations run in memory on open; writing the
 * result to the working file needs the user's consent (see {@link OpenResult.needsUpgradeConsent}).
 */
import { isObject, type JsonObject, setOwn } from "./json"
import {
  CURRENT_FORMAT,
  compareFormat,
  type FormatVersion,
  formatLine,
  parseFormatVersion,
  schemaUrlFor,
} from "./version"

/** One step of the migration chain. */
export interface Migration {
  /** Source format line, `"major.minor"`. */
  readonly from: string
  /** Target format line, `"major.minor"`. */
  readonly to: string
  /** One-line human description (shown in the upgrade prompt). */
  readonly description: string
  /**
   * Rewrites a document of format `from` into format `to`. Receives a private deep copy and
   * may mutate and return it. Must keep every property it does not understand, and must not
   * touch `format` / `$schema` (the runner sets them).
   */
  readonly migrate: (doc: JsonObject) => JsonObject
}

/**
 * 0.1 → 1.0: the spec freeze. Format 1.0 is format 0.1 declared stable (spec §16.4): every
 * 0.1 document is a valid 1.0 document, so the step is the identity and only the header
 * (`format`, `$schema`) changes, which the runner rewrites.
 */
export const MIGRATE_0_1_TO_1_0: Migration = {
  from: "0.1",
  to: "1.0",
  description: "format 1.0 (stable): same content, new format header",
  migrate: (doc) => doc,
}

/**
 * The registry, oldest first. Every format line adds exactly one entry
 * `{ from: previous, to: new }` with fixtures under `fixtures/migrations/`.
 */
export const MIGRATIONS: readonly Migration[] = [MIGRATE_0_1_TO_1_0]

/** Outcome of {@link migrate}. */
export type MigrateStatus =
  /** Already at the target line (any patch); returned unchanged. */
  | "current"
  /** Migrated in memory. */
  | "migrated"
  /** Newer than the target: returned unchanged; open read-only. */
  | "newer"
  /** No `major.minor.patch` format. */
  | "invalid"
  /** Older, but the registry has no path to the target. */
  | "no-path"

/** Result of {@link migrate}. */
export interface MigrateResult {
  status: MigrateStatus
  /** The (possibly migrated) document. Unchanged input for every status but "migrated". */
  doc: JsonObject
  /** The document's original `format`. */
  from: string | null
  /** The document's `format` after migration. */
  to: string | null
  /** Descriptions of the applied steps, in order. */
  applied: string[]
}

/** Options for {@link migrate}. */
export interface MigrateOptions {
  /** Registry to use (default {@link MIGRATIONS}). */
  migrations?: readonly Migration[]
  /** Target version (default: this package's format version). */
  target?: string
}

/**
 * Migrates a document to the target format version. Pure: the input is never mutated.
 * Unknown properties survive unless a migration step rewrites them.
 */
export function migrate(doc: JsonObject, options: MigrateOptions = {}): MigrateResult {
  const migrations = options.migrations ?? MIGRATIONS
  const target: FormatVersion | null = options.target
    ? parseFormatVersion(options.target)
    : CURRENT_FORMAT
  const fromString = typeof doc.format === "string" ? doc.format : null
  const from = parseFormatVersion(doc.format)
  if (!from || !target)
    return { status: "invalid", doc, from: fromString, to: fromString, applied: [] }
  const c = compareFormat(from, target)
  if (c === 0) return { status: "current", doc, from: fromString, to: fromString, applied: [] }
  if (c > 0) return { status: "newer", doc, from: fromString, to: fromString, applied: [] }

  let current: JsonObject = structuredClone(doc)
  let line = formatLine(from)
  const applied: string[] = []
  const targetLine = formatLine(target)
  const seen = new Set<string>()
  while (line !== targetLine) {
    const step = migrations.find((m) => m.from === line)
    if (!step || seen.has(line))
      return { status: "no-path", doc, from: fromString, to: fromString, applied: [] }
    seen.add(line)
    const next = step.migrate(current)
    if (!isObject(next))
      throw new TypeError(`Migration ${step.from}→${step.to} did not return an object`)
    current = next as JsonObject
    applied.push(`${step.from}→${step.to}: ${step.description}`)
    line = step.to
  }
  const to = `${target.major}.${target.minor}.${target.patch}`
  const out: JsonObject = {}
  // Keep key positions stable: rewrite `format` / `$schema` in place.
  for (const [k, v] of Object.entries(current)) setOwn(out, k, v)
  out.format = to
  if ("$schema" in out) out.$schema = schemaUrlFor(target)
  return { status: "migrated", doc: out, from: fromString, to, applied }
}
