/**
 * `kimo merge <base> <ours> <theirs> [path] [-o out] [-L ours,base,theirs]`: the semantic git
 * merge driver (spec §21.4, ADR 0012). The desktop app's "Git merge driver" setting installs
 * exactly this (apps/desktop `MERGE_DRIVER_COMMAND`):
 *
 *   git config merge.kimo.name "Kimo semantic merge"
 *   git config merge.kimo.driver "kimo merge %O %A %B %P"
 *   echo '*.kimo merge=kimo diff=kimo' >> .gitattributes
 *
 * base = %O, ours = %A (the result is written into %A), theirs = %B, path = %P (labels and
 * messages). Optional `-L ours,base,theirs` labels (e.g. `-L %X,%S,%Y`) name the sides in the
 * stored `merge` member; without them the path's name is used for nothing but messages.
 *
 * Exit codes ({@link MERGE_EXIT}): 0 clean (`ours` holds the canonical result), 1 merged with
 * stored conflicts (`ours` holds a valid document with `conflicts`; git marks the path
 * conflicted and the editor opens it on board 18), 2 not mergeable semantically (an input is
 * unparsable, invalid or newer): `ours` gets git's textual merge so the user sees ordinary
 * markers, which the editor's failed-load banner explains.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import {
  type KimoDocument,
  MERGE_EXIT,
  type MergeInfo,
  mergeDocuments,
  openDocument,
  serialize,
} from "@kimo/core-schema"
import { type CliIO, plural, resolveIn, writeFileAtomic } from "./io"

export interface MergeArgs {
  base: string
  ours: string
  theirs: string
  /** The path git is merging (`%P`), for messages. */
  path?: string
  /** Where to write the result (default: `ours`, as git expects). */
  output?: string
  /** Display labels (`-L %X,%S,%Y`: ours, base, theirs). */
  labels?: { base?: string; ours?: string; theirs?: string }
  /** Conflict marker size for the textual fallback (`%L`). */
  markerSize?: number
}

type Loaded = { ok: true; doc: KimoDocument } | { ok: false; why: string }

function load(io: CliIO, file: string, role: string): Loaded {
  let text: string
  try {
    text = readFileSync(resolveIn(io, file), "utf8")
  } catch (e) {
    return { ok: false, why: `${role}: cannot read ${file} (${(e as Error).message})` }
  }
  try {
    const r = openDocument(text)
    if (r.readOnly)
      return {
        ok: false,
        why: `${role}: ${r.readOnlyReasons.map((x) => x.message).join("; ") || "read-only"}`,
      }
    return { ok: true, doc: r.doc }
  } catch (e) {
    return { ok: false, why: `${role}: ${(e as Error).message}` }
  }
}

/** Runs the driver; returns its exit code. */
export function runMerge(args: MergeArgs, io: CliIO): number {
  const display = args.path ?? basename(args.ours)
  const output = resolveIn(io, args.output ?? args.ours)
  const inputs = [
    load(io, args.base, "base"),
    load(io, args.ours, "ours"),
    load(io, args.theirs, "theirs"),
  ] as const
  const failed = inputs.filter((x): x is { ok: false; why: string } => !x.ok)
  if (failed.length > 0) {
    for (const f of failed) io.stderr(`kimo merge: ${display}: ${f.why}\n`)
    textualFallback(args, output, io)
    io.stderr(`kimo merge: ${display}: not mergeable semantically; left git's textual merge\n`)
    return MERGE_EXIT.failed
  }
  const [base, ours, theirs] = inputs.map((x) => (x as { doc: KimoDocument }).doc) as [
    KimoDocument,
    KimoDocument,
    KimoDocument,
  ]
  const labels: Pick<MergeInfo, "base" | "ours" | "theirs"> = {}
  if (args.labels?.base) labels.base = args.labels.base.slice(0, 200)
  if (args.labels?.ours) labels.ours = args.labels.ours.slice(0, 200)
  if (args.labels?.theirs) labels.theirs = args.labels.theirs.slice(0, 200)
  const result = mergeDocuments({ base, ours, theirs, labels })
  writeFileAtomic(output, serialize(result.doc))
  const n = Object.keys(result.conflicts).length
  const repaired =
    result.repairs.length > 0 ? `, ${plural(result.repairs.length, "cycle")} repaired` : ""
  if (n === 0) {
    io.stderr(`kimo merge: ${display}: ${plural(result.changes, "change")} merged${repaired}\n`)
    return MERGE_EXIT.clean
  }
  io.stderr(
    `kimo merge: ${display}: ${plural(result.changes, "change")} applied, ${plural(n, "conflict")} stored${repaired}. Open the file in Kimo to resolve them.\n`,
  )
  return MERGE_EXIT.conflicts
}

/** Writes git's line-based merge (with conflict markers) to `output`; keeps ours without git. */
function textualFallback(args: MergeArgs, output: string, io: CliIO): void {
  const l = args.labels ?? {}
  const cmd = [
    "git",
    "merge-file",
    "-p",
    ...(args.markerSize ? [`--marker-size=${args.markerSize}`] : []),
    "-L",
    l.ours ?? "ours",
    "-L",
    l.base ?? "base",
    "-L",
    l.theirs ?? "theirs",
    resolveIn(io, args.ours),
    resolveIn(io, args.base),
    resolveIn(io, args.theirs),
  ]
  try {
    const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" })
    // merge-file exits with the number of conflicts (>= 0); negative/high values are errors.
    if (p.exitCode !== null && p.exitCode >= 0 && p.exitCode < 128 && p.stdout.length > 0) {
      writeFileSync(output, p.stdout)
      return
    }
  } catch {
    // git is not installed: leave ours as it is.
  }
  if (output !== resolveIn(io, args.ours))
    writeFileSync(output, readFileSync(resolveIn(io, args.ours)))
}
