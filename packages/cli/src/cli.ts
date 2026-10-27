/**
 * `kimo`: the command line (teardown 9.1 `packages/cli`, ADR 0012 builder 3).
 *
 *   kimo merge <base> <ours> <theirs> [path] [-o out] [-L ours,base,theirs] [--marker-size n]
 *   kimo gc <file> [--yes] [--json]
 *   kimo validate <file...> [--json] [--strict] [--no-lints]
 *   kimo mcp [--attach|--headless] …          (MCP server over stdio, ADR 0013 §8)
 *   kimo mcp install|remove|status [--host …]  (agent host configs, ADR 0013 §9)
 *
 * {@link run} is the whole program as a function, so tests run it in process.
 */
import { GC_EXIT, runGc } from "./gc"
import { type CliIO, processIO } from "./io"
import { MCP_USAGE, type McpStreams, McpUsageError, runMcp } from "./mcp/command"
import { type MergeArgs, runMerge } from "./merge"
import { runValidate, VALIDATE_EXIT } from "./validate"

export { MERGE_EXIT, referencedAssets } from "@kimo/core-schema"
export { GC_EXIT, type GcArgs, type GcPlan, planGc, runGc } from "./gc"
export { type CliIO, liveLease, pathHash, processIO, writeFileAtomic } from "./io"
export { MCP_USAGE, type McpStreams, runMcp } from "./mcp/command"
export { type MergeArgs, runMerge } from "./merge"
export { runValidate, VALIDATE_EXIT, type ValidateArgs, validateFile } from "./validate"

/** Exit code for a malformed command line (BSD `EX_USAGE`). */
export const USAGE_EXIT = 64

export const USAGE = `kimo — Kimo's command line

Usage:
  kimo merge <base> <ours> <theirs> [path] [-o <out>] [-L <ours>,<base>,<theirs>]
      Semantic three-way merge of .kimo files; the git merge driver. Writes the result to
      <ours> (or <out>). Exit 0 clean, 1 conflicts stored in the file, 2 not mergeable
      (git's textual merge is left instead).
      git config merge.kimo.driver "kimo merge %O %A %B %P"
      echo '*.kimo merge=kimo diff=kimo' >> .gitattributes

  kimo gc <file> [--yes] [--json]
      Lists asset files in assets/ that the document no longer references; --yes deletes
      them and drops their manifest entries. Exit 0 ok, 2 unreadable, 3 locked.

  kimo validate <file...> [--json] [--strict] [--no-lints]
      Validates documents (with their libraries and assets/ listing). Exit 0 valid,
      1 errors (or warnings with --strict), 2 unreadable or newer format.

  kimo mcp [--attach | --headless] [--allow <level>] [--files <glob>]...
      MCP server for coding agents on stdio: attaches to the running Kimo app, else
      edits files headless. See kimo mcp --help.

  kimo mcp install | remove | status [--host <host>|all] [--project] [--dry-run]
      Adds/removes/shows the kimo entry in Claude Code, Codex, Gemini CLI, Cursor and
      VS Code configs (backup first; only the kimo entry changes).

  kimo help | --help    kimo version | --version
`

/** Splits flags (`--x`, `--x=v`, `-o v`) from positionals. */
function parseArgs(
  argv: readonly string[],
  withValue: ReadonlySet<string>,
): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = []
  const flags = new Map<string, string[]>()
  const add = (k: string, v: string) => flags.set(k, [...(flags.get(k) ?? []), v])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === "--") {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith("-") && a.length > 1) {
      const eq = a.indexOf("=")
      const key = eq > 0 ? a.slice(0, eq) : a
      if (eq > 0) add(key, a.slice(eq + 1))
      else if (withValue.has(key)) {
        const v = argv[i + 1]
        if (v === undefined) throw new UsageError(`${key} needs a value`)
        add(key, v)
        i++
      } else add(key, "")
      continue
    }
    positional.push(a)
  }
  return { positional, flags }
}

class UsageError extends Error {}

function only(flags: Map<string, string[]>, allowed: readonly string[]) {
  for (const k of flags.keys())
    if (!allowed.includes(k)) throw new UsageError(`unknown option ${k}`)
}

/** Runs one command line; resolves to the process exit code. */
export async function run(
  argv: readonly string[],
  io: CliIO = processIO,
  streams: McpStreams = {},
): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case "merge": {
        const { positional, flags } = parseArgs(
          rest,
          new Set(["-o", "--output", "-L", "--labels", "--marker-size"]),
        )
        only(flags, ["-o", "--output", "-L", "--labels", "--marker-size"])
        if (positional.length < 3 || positional.length > 4)
          throw new UsageError("merge needs <base> <ours> <theirs> [path]")
        const [base, ours, theirs, path] = positional as [string, string, string, string?]
        const args: MergeArgs = { base, ours, theirs }
        if (path) args.path = path
        const out = flags.get("-o") ?? flags.get("--output")
        if (out?.[0]) args.output = out[0]
        const labelFlags = [...(flags.get("-L") ?? []), ...(flags.get("--labels") ?? [])]
        const labels = labelFlags.length === 1 ? (labelFlags[0] as string).split(",") : labelFlags
        if (labels.length > 0) {
          // Same order as `git merge-file -L`: ours, base, theirs.
          if (labels.length !== 3) throw new UsageError("-L takes ours,base,theirs")
          args.labels = { ours: labels[0], base: labels[1], theirs: labels[2] }
        }
        const size = flags.get("--marker-size")?.[0]
        if (size) args.markerSize = Number(size)
        return runMerge(args, io)
      }
      case "gc": {
        const { positional, flags } = parseArgs(rest, new Set())
        only(flags, ["--yes", "-y", "--json"])
        if (positional.length !== 1) throw new UsageError("gc needs exactly one <file>")
        return runGc(
          {
            file: positional[0] as string,
            yes: flags.has("--yes") || flags.has("-y"),
            json: flags.has("--json"),
          },
          io,
        )
      }
      case "validate": {
        const { positional, flags } = parseArgs(rest, new Set())
        only(flags, ["--json", "--strict", "--no-lints"])
        if (positional.length === 0) throw new UsageError("validate needs at least one <file>")
        return runValidate(
          {
            files: positional,
            json: flags.has("--json"),
            strict: flags.has("--strict"),
            lints: !flags.has("--no-lints"),
          },
          io,
        )
      }
      case "mcp":
        return await runMcp(rest, io, streams)
      case "version":
      case "--version":
      case "-v":
        io.stdout("kimo 1.1.0 (format 1.0)\n")
        return 0
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(USAGE)
        return 0
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`kimo: ${e.message}\n\n${USAGE}`)
      return USAGE_EXIT
    }
    if (e instanceof McpUsageError) {
      io.stderr(`kimo mcp: ${e.message}\n\n${MCP_USAGE}`)
      return USAGE_EXIT
    }
    io.stderr(`kimo: ${(e as Error).stack ?? String(e)}\n`)
    return command === "mcp"
      ? 1
      : command === "merge"
        ? 2
        : command === "gc"
          ? GC_EXIT.unreadable
          : VALIDATE_EXIT.unreadable
  }
}
