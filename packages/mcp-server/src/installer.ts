/**
 * Host installer (`@kimo/mcp-server/installer`, teardown 11.5, ADR 0013 §9): adds, removes and
 * inspects the `kimo` MCP entry in each agent host's config. Used by `kimo mcp install|remove|
 * status` and by Settings › Agents in the desktop app.
 *
 * Rules (avoid `[gh pen#1]` config clobbering):
 * - Additive and per host: only the `kimo` entry is touched; every other key, entry and (for
 *   TOML) line is preserved byte for byte where the format allows.
 * - Every write is preceded by a backup `~/.kimo/mcp/backups/<host>-<timestamp>.bak` and done
 *   atomically (temp + rename). `plan()` returns the before/after text for a diff preview.
 * - A file that cannot be parsed (JSON with comments, broken TOML) is never rewritten: the plan
 *   fails with `UNPARSABLE` and carries the snippet to paste by hand.
 * - No secrets in configs for stdio (the shim reads the socket token itself). The optional HTTP
 *   transport needs a bearer token; it is written only when the user picks HTTP.
 * - The host's own CLI (`claude mcp add-json`, `codex mcp add`, `gemini mcp add`) is NOT used:
 *   file edits are testable with a temp HOME and behave the same everywhere.
 * - Tests never touch the real HOME: every function takes `home` explicitly.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const SERVER_KEY = "kimo"

export const HOSTS = ["claude-code", "codex", "gemini-cli", "cursor", "vscode"] as const
export type HostId = (typeof HOSTS)[number]

/** Host rows in Settings › Agents: generic icons only, never vendor logos (lead decision). */
export const HOST_INFO: Record<
  HostId,
  { label: string; icon: "terminal" | "editor"; format: "json" | "toml"; docs: string }
> = {
  "claude-code": {
    label: "Claude Code",
    icon: "terminal",
    format: "json",
    docs: "https://code.claude.com/docs/en/mcp",
  },
  codex: {
    label: "Codex",
    icon: "terminal",
    format: "toml",
    docs: "https://learn.chatgpt.com/docs/extend/mcp",
  },
  "gemini-cli": {
    label: "Gemini CLI",
    icon: "terminal",
    format: "json",
    docs: "https://geminicli.com/docs/tools/mcp-server/",
  },
  cursor: {
    label: "Cursor",
    icon: "editor",
    format: "json",
    docs: "https://cursor.com/docs/context/mcp",
  },
  vscode: {
    label: "VS Code",
    icon: "editor",
    format: "json",
    docs: "https://code.visualstudio.com/docs/copilot/reference/mcp-configuration",
  },
}

export type InstallScope = "user" | "project"
export type HostOs = "macos" | "linux" | "windows"

export interface PathContext {
  home: string
  os: HostOs
  /** Project root for `project` scope. */
  project?: string
  /** `%APPDATA%` on Windows (VS Code user dir); default `<home>/AppData/Roaming`. */
  appData?: string
}

/**
 * Config file per host and scope (verified 2026-10 against each host's docs):
 * - Claude Code: user `~/.claude.json` top-level `mcpServers`; project `<root>/.mcp.json`.
 * - Codex: `~/.codex/config.toml` / `<root>/.codex/config.toml`, table `[mcp_servers.kimo]`.
 * - Gemini CLI: `~/.gemini/settings.json` / `<root>/.gemini/settings.json`, `mcpServers`.
 * - Cursor: `~/.cursor/mcp.json` / `<root>/.cursor/mcp.json`, `mcpServers`.
 * - VS Code: user profile `mcp.json` (macOS `~/Library/Application Support/Code/User/mcp.json`,
 *   Linux `~/.config/Code/User/mcp.json`, Windows `%APPDATA%\Code\User\mcp.json`; default
 *   profile only) / `<root>/.vscode/mcp.json`, top-level `servers`.
 */
export function configPath(host: HostId, scope: InstallScope, ctx: PathContext): string {
  if (scope === "project") {
    if (!ctx.project) throw new Error("project scope needs a project root")
    const p = ctx.project
    switch (host) {
      case "claude-code":
        return join(p, ".mcp.json")
      case "codex":
        return join(p, ".codex", "config.toml")
      case "gemini-cli":
        return join(p, ".gemini", "settings.json")
      case "cursor":
        return join(p, ".cursor", "mcp.json")
      case "vscode":
        return join(p, ".vscode", "mcp.json")
    }
  }
  const h = ctx.home
  switch (host) {
    case "claude-code":
      return join(h, ".claude.json")
    case "codex":
      return join(h, ".codex", "config.toml")
    case "gemini-cli":
      return join(h, ".gemini", "settings.json")
    case "cursor":
      return join(h, ".cursor", "mcp.json")
    case "vscode":
      if (ctx.os === "macos")
        return join(h, "Library", "Application Support", "Code", "User", "mcp.json")
      if (ctx.os === "windows")
        return join(ctx.appData ?? join(h, "AppData", "Roaming"), "Code", "User", "mcp.json")
      return join(h, ".config", "Code", "User", "mcp.json")
  }
}

/** How the host starts Kimo. */
export type Launcher =
  /** The Rust shim inside the app bundle (attach only). */
  | { kind: "shim"; command: string }
  /** `kimo mcp` from the CLI (auto attach/headless). */
  | { kind: "cli"; command: string }
  /** Streamable HTTP on localhost (desktop app must run). */
  | { kind: "http"; url: string; token: string }

/** Default shim location per OS (the app reports the real one via `kimo_mcp_status`). */
export const DEFAULT_SHIM_PATH: Record<HostOs, string> = {
  macos: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp",
  linux: "/usr/bin/kimo-mcp",
  windows: "C:\\Program Files\\Kimo\\kimo-mcp.exe",
}

/** The entry object for JSON hosts (`mcpServers.kimo` / `servers.kimo`). */
export function jsonEntry(host: HostId, launcher: Launcher): Record<string, unknown> {
  if (launcher.kind === "http") {
    const headers = { Authorization: `Bearer ${launcher.token}` }
    if (host === "gemini-cli") return { httpUrl: launcher.url, headers }
    return { type: "http", url: launcher.url, headers }
  }
  const args = launcher.kind === "cli" ? ["mcp", "--client", host] : ["--client", host]
  const base: Record<string, unknown> = { command: launcher.command, args }
  if (host === "gemini-cli") return { ...base, timeout: 600_000, trust: false }
  return { type: "stdio", ...base }
}

/** The TOML table for Codex. */
export function tomlTable(launcher: Launcher): string {
  const q = (s: string) => JSON.stringify(s)
  if (launcher.kind === "http")
    return `[mcp_servers.${SERVER_KEY}]\nurl = ${q(launcher.url)}\nhttp_headers = { Authorization = ${q(`Bearer ${launcher.token}`)} }\n`
  const args = launcher.kind === "cli" ? ["mcp", "--client", "codex"] : ["--client", "codex"]
  return `[mcp_servers.${SERVER_KEY}]\ncommand = ${q(launcher.command)}\nargs = [${args.map(q).join(", ")}]\n`
}

const rootKey = (host: HostId) => (host === "vscode" ? "servers" : "mcpServers")

export type PlanResult =
  | { ok: true; path: string; before: string | null; after: string | null; changed: boolean }
  | { ok: false; path: string; code: "UNPARSABLE"; message: string; snippet: string }

/** Pure: computes the new file text for install (`launcher`) or remove (`null`). */
export function planEdit(
  host: HostId,
  path: string,
  before: string | null,
  launcher: Launcher | null,
): PlanResult {
  if (HOST_INFO[host].format === "toml") return planToml(path, before, launcher)
  let doc: Record<string, unknown> = {}
  if (before !== null && before.trim() !== "") {
    try {
      const parsed = JSON.parse(before) as unknown
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("not an object")
      doc = parsed as Record<string, unknown>
    } catch (e) {
      return {
        ok: false,
        path,
        code: "UNPARSABLE",
        message: `${path} is not plain JSON (${e instanceof Error ? e.message : "parse error"}); it was left untouched. Add the snippet by hand.`,
        snippet: launcher
          ? JSON.stringify(
              { [rootKey(host)]: { [SERVER_KEY]: jsonEntry(host, launcher) } },
              null,
              2,
            )
          : "",
      }
    }
  }
  const key = rootKey(host)
  const servers = { ...((doc[key] as Record<string, unknown> | undefined) ?? {}) }
  if (launcher) servers[SERVER_KEY] = jsonEntry(host, launcher)
  else delete servers[SERVER_KEY]
  const next = { ...doc, [key]: servers }
  if (!launcher && Object.keys(servers).length === 0 && !(key in doc)) delete next[key]
  const indent = detectIndent(before) ?? 2
  const after = `${JSON.stringify(next, null, indent)}\n`
  const changed =
    before === null ? launcher !== null : normalizeJson(before) !== normalizeJson(after)
  return { ok: true, path, before, after: changed ? after : before, changed }
}

function planToml(path: string, before: string | null, launcher: Launcher | null): PlanResult {
  const text = before ?? ""
  const lines = text.split("\n")
  const isOurs = (l: string) => {
    const t = l.trim()
    return t === `[mcp_servers.${SERVER_KEY}]` || t.startsWith(`[mcp_servers.${SERVER_KEY}.`)
  }
  const out: string[] = []
  let skipping = false
  let removed = false
  for (const l of lines) {
    if (/^\s*\[/.test(l)) {
      skipping = isOurs(l)
      if (skipping) removed = true
    }
    if (!skipping) out.push(l)
  }
  let after = out.join("\n").replace(/\n{3,}$/, "\n\n")
  if (launcher) {
    if (after.length && !after.endsWith("\n")) after += "\n"
    if (after.trim().length) after += "\n"
    after += tomlTable(launcher)
  }
  if (!launcher && !removed) return { ok: true, path, before, after: before, changed: false }
  const changed = after !== text
  return { ok: true, path, before, after: changed ? after : before, changed }
}

function detectIndent(text: string | null): number | null {
  const m = text ? /\n( +)"/.exec(text) : null
  return m ? (m[1] as string).length : null
}

function normalizeJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

/** Status of one host. */
export interface HostStatus {
  host: HostId
  label: string
  icon: "terminal" | "editor"
  scope: InstallScope
  path: string
  /** Config file exists. */
  configExists: boolean
  installed: boolean
  /** Installed entry equals what `install` would write now (else "Update"). */
  current: boolean
  entry?: unknown
  error?: string
}

/** Minimal fs the executor needs (tests use a temp HOME with the real fs). */
export interface InstallerFs {
  read(path: string): string | null
  writeAtomic(path: string, text: string): void
  now(): number
}

export const nodeInstallerFs: InstallerFs = {
  read(path) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return null
    }
  },
  writeAtomic(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.kimo-tmp-${process.pid}`
    writeFileSync(tmp, text, { mode: 0o600 })
    renameSync(tmp, path)
  },
  now: () => Date.now(),
}

export interface InstallOptions extends PathContext {
  scope: InstallScope
  /** Compute and return the plan without writing. */
  dryRun?: boolean
}

export interface ApplyResult {
  plan: PlanResult
  /** Backup written before the change (absent when nothing changed or the file was new). */
  backup?: string
}

function apply(
  fs: InstallerFs,
  host: HostId,
  launcher: Launcher | null,
  o: InstallOptions,
): ApplyResult {
  const path = configPath(host, o.scope, o)
  const before = fs.read(path)
  const plan = planEdit(host, path, before, launcher)
  if (!plan.ok || !plan.changed || o.dryRun || plan.after === null) return { plan }
  let backup: string | undefined
  if (before !== null) {
    backup = join(o.home, ".kimo", "mcp", "backups", `${host}-${fs.now()}.bak`)
    fs.writeAtomic(backup, before)
  }
  fs.writeAtomic(path, plan.after)
  return backup ? { plan, backup } : { plan }
}

export function install(
  host: HostId,
  launcher: Launcher,
  o: InstallOptions,
  fs: InstallerFs = nodeInstallerFs,
): ApplyResult {
  return apply(fs, host, launcher, o)
}

export function remove(
  host: HostId,
  o: InstallOptions,
  fs: InstallerFs = nodeInstallerFs,
): ApplyResult {
  return apply(fs, host, null, o)
}

export function status(
  host: HostId,
  launcher: Launcher,
  o: PathContext & { scope: InstallScope },
  fs: InstallerFs = nodeInstallerFs,
): HostStatus {
  const path = configPath(host, o.scope, o)
  const text = fs.read(path)
  const base = {
    host,
    label: HOST_INFO[host].label,
    icon: HOST_INFO[host].icon,
    scope: o.scope,
    path,
    configExists: text !== null,
  }
  if (text === null) return { ...base, installed: false, current: false }
  const plan = planEdit(host, path, text, launcher)
  if (!plan.ok) return { ...base, installed: false, current: false, error: plan.message }
  const installed =
    HOST_INFO[host].format === "toml"
      ? text.split("\n").some((l) => l.trim() === `[mcp_servers.${SERVER_KEY}]`)
      : SERVER_KEY in
        (((JSON.parse(text) as Record<string, unknown>)[rootKey(host)] as Record<
          string,
          unknown
        >) ?? {})
  const entry =
    installed && HOST_INFO[host].format === "json"
      ? (JSON.parse(text) as Record<string, Record<string, unknown>>)[rootKey(host)]?.[SERVER_KEY]
      : undefined
  return {
    ...base,
    installed,
    current: installed && !plan.changed,
    ...(entry !== undefined ? { entry } : {}),
  }
}
