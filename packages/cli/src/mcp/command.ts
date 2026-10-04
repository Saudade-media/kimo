/**
 * `kimo mcp …` (ADR 0013 §8–9):
 *
 *   kimo mcp [--attach|--headless] [--allow <level>] [--files <glob>]… [--no-autosave] [--client <slug>]
 *   kimo mcp install|remove|status [--host <h>|all] [--project] [--dry-run] [--json] …
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Readable, Writable } from "node:stream"
import {
  DEFAULT_HTTP_PORT,
  decideMode,
  HTTP_PATH,
  KIMO_PATHS,
  type McpModeFlag,
  PERMISSION_LEVELS,
  type PermissionLevel,
} from "@kimo/mcp-server"
import {
  ConcurrentEditError,
  configPath,
  HOST_INFO,
  HOSTS,
  type HostId,
  type HostStatus,
  type InstallScope,
  install,
  type Launcher,
  type PathContext,
  type PlanResult,
  remove,
  status,
} from "@kimo/mcp-server/installer"
import type { CliIO } from "../io"
import { probeApp, runRelay } from "./attach"
import { CLI_VERSION, runHeadless } from "./headless"
import { hostOs, resolveLauncher } from "./launcher"

export class McpUsageError extends Error {}

export const MCP_USAGE = `kimo mcp — Kimo for coding agents (MCP over stdio)

  kimo mcp [--attach | --headless] [--allow <level>] [--files <glob>]... [--no-autosave]
           [--client <slug>] [--experimental]
      Serves MCP on stdin/stdout. Default: attach to the running Kimo app (socket
      ~/.kimo/socket/kimo.sock), else run headless: files open in memory under this
      process's lease, atomic saves, autosave after 2 s idle, no approval prompts (anything
      that would ask is denied).
      --attach       attach or answer APP_NOT_RUNNING (never opens files itself)
      --headless     never attach
      --allow        headless permission level: read | edit | edit+delete (default edit+delete)
      --files        headless file allow-list glob, repeatable (default <cwd>/**)

  kimo mcp install [--host <host>|all] [--project] [--dir <path>] [--dry-run] [--json]
                   [--command <shim path> | --cli] [--transport stdio|http]
  kimo mcp remove  [--host <host>|all] [--project] [--dir <path>] [--dry-run] [--json]
  kimo mcp status  [--host <host>|all] [--project] [--dir <path>] [--json]
      Adds, removes or shows the "kimo" entry in agent host configs. Only that entry changes;
      a backup goes to ~/.kimo/mcp/backups/ first; files that are not plain JSON/TOML are
      never rewritten (the snippet to paste is printed instead).
      Hosts: claude-code, codex, gemini (gemini-cli), cursor, vscode. Default for install:
      the hosts found on this machine; for remove/status: all.
      User scope by default (Claude Code: ~/.claude.json, written compare-and-swap so
      Claude Code's own concurrent writes are kept); --project writes .mcp.json,
      .codex/config.toml, .gemini/settings.json, .cursor/mcp.json, .vscode/mcp.json in --dir
      (default: the current directory).
      The command is the Kimo app's bundled kimo-mcp shim when the app is installed
      (override: --command or $KIMO_MCP_SHIM), else "bunx @kimo/cli mcp" (--cli forces it).
`

/** Streams for the stdio server (tests drive them in process). */
export interface McpStreams {
  stdin?: Readable
  stdout?: Writable
}

interface Parsed {
  positional: string[]
  flags: Map<string, string[]>
}

const VALUE_FLAGS = new Set([
  "--allow",
  "--files",
  "--client",
  "--host",
  "--dir",
  "--command",
  "--transport",
  "--scope",
])

function parse(argv: readonly string[]): Parsed {
  const positional: string[] = []
  const flags = new Map<string, string[]>()
  const add = (k: string, v: string) => flags.set(k, [...(flags.get(k) ?? []), v])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      const k = eq > 0 ? a.slice(0, eq) : a
      if (eq > 0) add(k, a.slice(eq + 1))
      else if (VALUE_FLAGS.has(k)) {
        const v = argv[i + 1]
        if (v === undefined) throw new McpUsageError(`${k} needs a value`)
        add(k, v)
        i++
      } else add(k, "")
    } else positional.push(a)
  }
  return { positional, flags }
}

function only(p: Parsed, allowed: string[]) {
  for (const k of p.flags.keys())
    if (!allowed.includes(k)) throw new McpUsageError(`unknown option ${k}`)
}

export const homeOf = (io: CliIO) => {
  const env = io.env ?? process.env
  return env.HOME || env.USERPROFILE || homedir()
}
export const kimoHomeOf = (io: CliIO) => {
  const env = io.env ?? process.env
  return env.KIMO_HOME || join(homeOf(io), ".kimo")
}

/** `kimo mcp …` entry. */
export async function runMcp(
  argv: readonly string[],
  io: CliIO,
  streams: McpStreams = {},
): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case "install":
    case "remove":
    case "status":
      return runConfig(sub, parse(rest), io)
    case "help":
    case "--help":
    case "-h":
      io.stdout(MCP_USAGE)
      return 0
    default:
      return runServe(parse(argv), io, streams)
  }
}

// --- Serve --------------------------------------------------------------------------------------

async function runServe(p: Parsed, io: CliIO, streams: McpStreams): Promise<number> {
  only(p, [
    "--attach",
    "--headless",
    "--allow",
    "--files",
    "--no-autosave",
    "--client",
    "--experimental",
  ])
  if (p.positional.length) throw new McpUsageError(`unexpected argument ${p.positional[0]}`)
  if (p.flags.has("--attach") && p.flags.has("--headless"))
    throw new McpUsageError("--attach and --headless are exclusive")
  const flag: McpModeFlag = p.flags.has("--attach")
    ? "attach"
    : p.flags.has("--headless")
      ? "headless"
      : "auto"
  let level: PermissionLevel = "edit+delete"
  const files = [...(p.flags.get("--files") ?? [])]
  for (const v of p.flags.get("--allow") ?? []) {
    if ((PERMISSION_LEVELS as readonly string[]).includes(v)) level = v as PermissionLevel
    // ADR 0013 §8 spelling `--allow <glob>` is accepted as a file glob.
    else if (v.includes("/") || v.includes("*")) files.push(v)
    else throw new McpUsageError(`--allow takes read, edit or edit+delete (got ${v})`)
  }
  const client = p.flags.get("--client")?.[0]
  const cwd = io.cwd ?? process.cwd()
  const kimoHome = kimoHomeOf(io)
  const log = (l: string) => io.stderr(`kimo mcp: ${l}\n`)
  const hello = {
    relay: { name: "kimo-cli" as const, version: CLI_VERSION },
    ...(client ? { client } : {}),
    pid: process.pid,
    ppid: process.ppid,
    cwd,
  }
  const conn = flag === "headless" ? null : await probeApp(kimoHome, hello)
  const mode = decideMode(flag, { appReachable: conn !== null })
  if (mode.mode === "headless") {
    return runHeadless({
      kimoHome,
      cwd,
      level,
      files,
      autosaveMs: p.flags.has("--no-autosave") ? 0 : 2_000,
      ...(client ? { client } : {}),
      includeStubs: p.flags.has("--experimental"),
      ...streams,
      log,
    })
  }
  if (mode.mode === "unavailable") log("the Kimo app is not running; waiting for it (--attach)")
  else log(`attached to the Kimo app (${conn?.result.app.version ?? "?"})`)
  return runRelay({ kimoHome, hello, conn, ...streams, log })
}

// --- install / remove / status ------------------------------------------------------------------

const HOST_ALIASES: Record<string, HostId> = {
  gemini: "gemini-cli",
  claude: "claude-code",
  code: "vscode",
  "vs-code": "vscode",
}

export function parseHosts(values: string[] | undefined): HostId[] | null {
  if (!values || values.length === 0) return null
  const out = new Set<HostId>()
  for (const raw of values.flatMap((v) => v.split(","))) {
    const v = raw.trim().toLowerCase()
    if (v === "all") for (const h of HOSTS) out.add(h)
    else if ((HOSTS as readonly string[]).includes(v)) out.add(v as HostId)
    else if (HOST_ALIASES[v]) out.add(HOST_ALIASES[v] as HostId)
    else
      throw new McpUsageError(
        `unknown host ${raw} (claude-code, codex, gemini, cursor, vscode, all)`,
      )
  }
  return [...out]
}

/** Hosts that look installed: their config file or its directory exists. */
export function detectHosts(ctx: PathContext): HostId[] {
  return HOSTS.filter((h) => {
    const p = configPath(h, "user", ctx)
    return existsSync(p) || (h !== "claude-code" && existsSync(dirname(p)))
  })
}

function httpLauncher(io: CliIO, host: HostId): Launcher {
  const kh = kimoHomeOf(io)
  let url = `http://127.0.0.1:${DEFAULT_HTTP_PORT}${HTTP_PATH}`
  try {
    const e = JSON.parse(readFileSync(join(kh, KIMO_PATHS.endpoint), "utf8")) as {
      http?: { url: string }
    }
    if (e.http?.url) url = e.http.url
  } catch {
    // App not running: default port.
  }
  let token: string | undefined
  try {
    token = (
      JSON.parse(readFileSync(join(kh, KIMO_PATHS.httpTokens), "utf8")) as Record<string, string>
    )[host]
  } catch {
    token = undefined
  }
  if (!token)
    throw new McpUsageError(
      `no HTTP token for ${host}: turn on HTTP in Kimo › Settings › Agents first (it creates ${KIMO_PATHS.httpTokens})`,
    )
  return { kind: "http", url, token }
}

/** Minimal line diff for previews (good enough for small config files). */
export function previewDiff(before: string | null, after: string | null): string {
  const a = (before ?? "").split("\n")
  const b = (after ?? "").split("\n")
  const out: string[] = []
  const inA = new Set(a)
  const inB = new Set(b)
  for (const l of a) if (!inB.has(l)) out.push(`- ${l}`)
  for (const l of b) if (!inA.has(l)) out.push(`+ ${l}`)
  return out.join("\n")
}

interface Row {
  host: HostId
  path: string
  outcome: "installed" | "updated" | "removed" | "unchanged" | "not-installed" | "error" | "status"
  dryRun?: boolean
  backup?: string
  diff?: string
  error?: string
  snippet?: string
  status?: HostStatus
}

async function runConfig(
  sub: "install" | "remove" | "status",
  p: Parsed,
  io: CliIO,
): Promise<number> {
  const common = ["--host", "--project", "--dir", "--json", "--scope"]
  only(
    p,
    sub === "install"
      ? [...common, "--dry-run", "--command", "--cli", "--transport"]
      : sub === "remove"
        ? [...common, "--dry-run"]
        : common,
  )
  if (p.positional.length) throw new McpUsageError(`unexpected argument ${p.positional[0]}`)
  const env = io.env ?? process.env
  const home = homeOf(io)
  const scopeFlag = p.flags.get("--scope")?.[0]
  if (scopeFlag && scopeFlag !== "user" && scopeFlag !== "project")
    throw new McpUsageError("--scope takes user or project")
  const scope: InstallScope =
    p.flags.has("--project") || scopeFlag === "project" ? "project" : "user"
  const os = hostOs()
  const ctx: PathContext = {
    home,
    os,
    project: p.flags.get("--dir")?.[0] ?? io.cwd ?? process.cwd(),
    ...(env.APPDATA ? { appData: env.APPDATA } : {}),
  }
  const explicit = parseHosts(p.flags.get("--host"))
  let hosts = explicit ?? (sub === "install" ? detectHosts(ctx) : [...HOSTS])
  if (sub === "install" && !explicit && scope === "project") hosts = [...HOSTS]
  if (hosts.length === 0)
    throw new McpUsageError(
      "no agent hosts found on this machine; pass --host <host> or --host all",
    )
  const transport = p.flags.get("--transport")?.[0] ?? "stdio"
  if (transport !== "stdio" && transport !== "http")
    throw new McpUsageError("--transport takes stdio or http")
  const choice = resolveLauncher({
    os,
    home,
    env,
    ...(p.flags.get("--command")?.[0] ? { command: p.flags.get("--command")?.[0] as string } : {}),
    useCli: p.flags.has("--cli"),
  })
  const dryRun = p.flags.has("--dry-run")
  const rows: Row[] = []
  for (const host of hosts) {
    const launcher = transport === "http" ? httpLauncher(io, host) : choice.launcher
    const path = configPath(host, scope, ctx)
    try {
      if (sub === "status") {
        rows.push({
          host,
          path,
          outcome: "status",
          status: status(host, launcher, { ...ctx, scope }),
        })
        continue
      }
      const r =
        sub === "install"
          ? install(host, launcher, { ...ctx, scope, dryRun })
          : remove(host, { ...ctx, scope, dryRun })
      rows.push(rowOf(sub, host, r.plan, dryRun, r.backup))
    } catch (e) {
      rows.push({
        host,
        path,
        outcome: "error",
        error: e instanceof ConcurrentEditError ? e.message : (e as Error).message,
      })
    }
  }
  const failed = rows.some((r) => r.outcome === "error")
  if (p.flags.has("--json")) {
    io.stdout(
      `${JSON.stringify({ command: sub, scope, launcher: choice.launcher, rows }, null, 2)}\n`,
    )
    return failed ? 1 : 0
  }
  if (sub !== "status") io.stdout(`command: ${choice.reason}\n`)
  for (const r of rows) io.stdout(formatRow(r))
  return failed ? 1 : 0
}

function rowOf(
  sub: "install" | "remove",
  host: HostId,
  plan: PlanResult,
  dryRun: boolean,
  backup?: string,
): Row {
  if (!plan.ok)
    return { host, path: plan.path, outcome: "error", error: plan.message, snippet: plan.snippet }
  const hadEntry =
    plan.before !== null &&
    (plan.before.includes('"kimo"') || plan.before.includes("[mcp_servers.kimo]"))
  const outcome: Row["outcome"] = !plan.changed
    ? sub === "remove"
      ? "not-installed"
      : "unchanged"
    : sub === "remove"
      ? "removed"
      : hadEntry
        ? "updated"
        : "installed"
  return {
    host,
    path: plan.path,
    outcome,
    ...(dryRun ? { dryRun: true } : {}),
    ...(backup ? { backup } : {}),
    ...(dryRun && plan.changed ? { diff: previewDiff(plan.before, plan.after) } : {}),
  }
}

function formatRow(r: Row): string {
  const label = HOST_INFO[r.host].label.padEnd(12)
  if (r.outcome === "status") {
    const s = r.status as HostStatus
    const state = s.error
      ? `unreadable (${s.error})`
      : s.installed
        ? s.current
          ? "installed"
          : "installed (outdated: run kimo mcp install)"
        : "not installed"
    return `${label} ${state.padEnd(16)} ${s.path}\n`
  }
  if (r.outcome === "error")
    return `${label} ERROR ${r.error}\n${r.snippet ? `${indent(r.snippet)}\n` : ""}`
  const verb =
    r.dryRun && r.outcome !== "unchanged" && r.outcome !== "not-installed"
      ? `would be ${r.outcome}`
      : r.outcome
  let s = `${label} ${verb.padEnd(16)} ${r.path}\n`
  if (r.backup) s += `${" ".repeat(13)}backup: ${r.backup}\n`
  if (r.diff) s += `${indent(r.diff)}\n`
  return s
}

const indent = (t: string) =>
  t
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")
