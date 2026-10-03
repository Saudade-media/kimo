/**
 * `kimo validate <file...> [--json] [--strict] [--no-lints]`: schema, references, cycles and
 * lints (teardown 10.6) of `.kimo` files, with the imported libraries and the `assets/` folder
 * listing next to each file. `CONFLICT_OPEN` is a warning, so CI flags unfinished merges with
 * `--strict`.
 *
 * Exit codes ({@link VALIDATE_EXIT}): 0 valid (warnings allowed), 1 errors (or warnings with
 * `--strict`), 2 unreadable: missing file, not JSON, or a newer/unknown format or feature.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  isObject,
  type KimoDocument,
  KimoParseError,
  openDocument,
  parse,
  type ValidationIssue,
} from "@kimo/core-schema"
import { type CliIO, plural, resolveIn } from "./io"

export const VALIDATE_EXIT = { ok: 0, invalid: 1, unreadable: 2 } as const

export interface ValidateArgs {
  files: string[]
  json?: boolean
  strict?: boolean
  lints?: boolean
}

export interface FileReport {
  file: string
  exit: number
  /** Why the file could not be validated (exit 2). */
  error?: string
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

/** Libraries imported by `doc`, read relative to the file's directory (missing ones skipped). */
export function loadLibraries(doc: KimoDocument, dir: string): Record<string, KimoDocument> {
  const out: Record<string, KimoDocument> = {}
  const imports = (doc as { imports?: unknown }).imports
  if (!isObject(imports)) return out
  for (const [alias, rel] of Object.entries(imports)) {
    if (typeof rel !== "string") continue
    try {
      out[alias] = parse(readFileSync(resolve(dir, rel), "utf8"))
    } catch {
      // Not loaded: validate reports LIBRARY_NOT_LOADED.
    }
  }
  return out
}

/** File names in `<dir>/assets` (empty when the folder does not exist). */
export function assetListing(dir: string): string[] {
  const assets = join(dir, "assets")
  if (!existsSync(assets)) return []
  return readdirSync(assets).filter((f) => !f.startsWith(".") && statSync(join(assets, f)).isFile())
}

export function validateFile(io: CliIO, file: string, args: ValidateArgs): FileReport {
  const abs = resolveIn(io, file)
  const report: FileReport = { file, exit: VALIDATE_EXIT.ok, errors: [], warnings: [] }
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch (e) {
    return { ...report, exit: VALIDATE_EXIT.unreadable, error: (e as Error).message }
  }
  let preview: KimoDocument
  try {
    preview = parse(text)
  } catch (e) {
    const pe = e as KimoParseError
    const where =
      pe instanceof KimoParseError && pe.line ? ` (line ${pe.line}, column ${pe.column})` : ""
    return { ...report, exit: VALIDATE_EXIT.unreadable, error: `${pe.message}${where}` }
  }
  const dir = dirname(abs)
  const r = openDocument(text, {
    libraries: loadLibraries(preview, dir),
    assetFiles: assetListing(dir),
    lints: args.lints !== false,
    allowInvalid: true,
  })
  const blocking = r.readOnlyReasons.filter((x) => x.code !== "INVALID")
  if (blocking.length > 0 || !r.validation)
    return {
      ...report,
      exit: VALIDATE_EXIT.unreadable,
      error: blocking.map((x) => x.message).join("; ") || "cannot validate",
    }
  report.errors = r.validation.errors
  report.warnings = r.validation.warnings
  if (report.errors.length > 0 || (args.strict && report.warnings.length > 0))
    report.exit = VALIDATE_EXIT.invalid
  return report
}

export function runValidate(args: ValidateArgs, io: CliIO): number {
  const reports = args.files.map((f) => validateFile(io, f, args))
  if (args.json) {
    io.stdout(`${JSON.stringify(reports, null, 2)}\n`)
  } else {
    for (const r of reports) {
      if (r.error) {
        io.stdout(`${r.file}: cannot validate: ${r.error}\n`)
        continue
      }
      const head =
        r.errors.length === 0
          ? `${r.file}: valid${r.warnings.length > 0 ? ` (${plural(r.warnings.length, "warning")})` : ""}`
          : `${r.file}: ${plural(r.errors.length, "error")}${r.warnings.length > 0 ? `, ${plural(r.warnings.length, "warning")}` : ""}`
      io.stdout(`${head}\n`)
      for (const i of [...r.errors, ...r.warnings])
        io.stdout(`  ${i.severity.padEnd(7)} ${i.code}  ${i.path || "/"}  ${i.message}\n`)
    }
  }
  return reports.reduce((m, r) => Math.max(m, r.exit), 0)
}
