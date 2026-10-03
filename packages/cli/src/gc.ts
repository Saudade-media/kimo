/**
 * `kimo gc <file> [--yes] [--json]`: removes asset files in `assets/` next to the document that
 * nothing references (spec §12: assets are content-addressed and merge add-only, so unused
 * files pile up). Without `--yes` it is a dry run that only lists them. With `--yes` it deletes
 * them and drops their entries from the document's asset manifest (atomic write).
 *
 * It refuses to touch anything while another process holds the file's lease (the editor may
 * have unsaved edits that reference an asset): exit 3, "locked".
 *
 * Exit codes ({@link GC_EXIT}): 0 done (or nothing to do), 2 the document cannot be read,
 * 3 locked by another process.
 */
import { readFileSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  isObject,
  parse,
  planAssetGc,
  prunedManifest,
  referencedAssets,
  serialize,
} from "@kimo/core-schema"
import { type CliIO, formatBytes, liveLease, plural, resolveIn, writeFileAtomic } from "./io"
import { assetListing } from "./validate"

export const GC_EXIT = { ok: 0, unreadable: 2, locked: 3 } as const

export interface GcArgs {
  file: string
  yes?: boolean
  json?: boolean
}

export interface GcPlan {
  /** Unreferenced content-addressed files in `assets/`, by name. */
  files: { name: string; bytes: number }[]
  /** Manifest entries that nothing references and whose file (if any) is not kept. */
  manifest: string[]
  bytes: number
}

/**
 * The shared plan (`planAssetGc`, same rules as the editor's Clean up assets). The CLI does not
 * read font `name` tables, so unreferenced font files are always kept (conservative).
 */
export function planGc(doc: unknown, dir: string): GcPlan {
  const record = isObject(doc) ? doc : {}
  const listing = assetListing(dir).map((name) => ({
    name,
    bytes: statSync(join(dir, "assets", name)).size,
  }))
  const plan = planAssetGc(record, listing)
  const files = [...plan.unused].sort((a, b) => a.name.localeCompare(b.name))
  const used = referencedAssets(record)
  const kept = new Set(plan.kept.map((f) => f.name))
  const manifest = isObject(record.assets) ? Object.keys(record.assets) : []
  return {
    files,
    manifest: manifest.filter((m) => !used.has(m) && !kept.has(m)).sort(),
    bytes: plan.unusedBytes,
  }
}

export function runGc(args: GcArgs, io: CliIO): number {
  const abs = resolveIn(io, args.file)
  let doc: Record<string, unknown>
  try {
    doc = parse(readFileSync(abs, "utf8")) as unknown as Record<string, unknown>
  } catch (e) {
    io.stderr(`kimo gc: cannot read ${args.file}: ${(e as Error).message}\n`)
    return GC_EXIT.unreadable
  }
  const dir = dirname(abs)
  const plan = planGc(doc, dir)
  const nothing = plan.files.length === 0 && plan.manifest.length === 0
  if (args.yes && !nothing) {
    const lease = liveLease(io, abs)
    if (lease) {
      io.stderr(
        `kimo gc: ${args.file} is locked by ${lease.appLabel} (pid ${lease.pid}). Close it there, or run Clean up from the editor.\n`,
      )
      return GC_EXIT.locked
    }
    const assets = prunedManifest(doc.assets, plan.manifest)
    if (assets) {
      if (Object.keys(assets).length > 0) doc.assets = assets
      else delete doc.assets
      writeFileAtomic(abs, serialize(doc))
    }
    for (const f of plan.files) rmSync(join(dir, "assets", f.name), { force: true })
  }
  if (args.json) {
    io.stdout(`${JSON.stringify({ ...plan, removed: Boolean(args.yes) }, null, 2)}\n`)
    return GC_EXIT.ok
  }
  if (nothing) {
    io.stdout(`${args.file}: no unused assets\n`)
    return GC_EXIT.ok
  }
  const verb = args.yes ? "Removed" : "Would remove"
  io.stdout(
    `${verb} ${plural(plan.files.length, "unused asset")} (${formatBytes(plan.bytes)}) from ${args.file}:\n`,
  )
  for (const f of plan.files) io.stdout(`  assets/${f.name}  ${formatBytes(f.bytes)}\n`)
  if (plan.manifest.length > 0)
    io.stdout(
      `${args.yes ? "Dropped" : "Would drop"} ${plural(plan.manifest.length, "manifest entry", "manifest entries")}: ${plan.manifest.join(", ")}\n`,
    )
  if (!args.yes) io.stdout("Dry run. Run again with --yes to delete.\n")
  return GC_EXIT.ok
}
