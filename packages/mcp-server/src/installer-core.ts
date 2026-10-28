/**
 * Host installer core (`@kimo/mcp-server/installer-core`, teardown 11.5, ADR 0013 §9). It has no
 * Node imports, so the desktop window can load it; `./installer` adds the Node file writer. It
 * adds, removes and inspects the `kimo` MCP entry in each agent host's config. Used by `kimo mcp install|remove|
 * status` and by Settings › Agents in the desktop app.
 *
 * Rules (avoid `[gh pen#1]` config clobbering):
 * - Additive and per host: only the `kimo` entry is touched; every other key, entry and (for
 *   TOML) line is preserved byte for byte where the format allows.
 * - Every write is preceded by a backup `~/.kimo/mcp/backups/<host>-<timestamp>.bak` and done
 *   atomically (temp + rename). `plan()` returns the before/after text for a diff preview.
 * - Writes are compare-and-swap: the target is re-read right before the rename and, when another
 *   program changed it meanwhile, the plan is recomputed from the new text (up to
 *   {@link CAS_ATTEMPTS} times). This is what makes the user-scope default for Claude Code
 *   (`~/.claude.json`, which Claude Code itself rewrites often) safe: ADR 0013 open question 2,
 *   decided for user scope + CAS rather than defaulting to project `.mcp.json`.
 * - File permissions of an existing config are kept; new files are created 0600.
 * - A file that cannot be parsed (JSON with comments, broken TOML) is never rewritten: the plan
 *   fails with `UNPARSABLE` and carries the snippet to paste by hand.
 * - No secrets in configs for stdio (the shim reads the socket token itself). The optional HTTP
 *   transport needs a bearer token; it is written only when the user picks HTTP.
 * - The host's own CLI (`claude mcp add-json`, `codex mcp add`, `gemini mcp add`) is NOT used:
 *   file edits are testable with a temp HOME and behave the same everywhere.
 * - Tests never touch the real HOME: every function takes `home` explicitly.
 */
/**
 * Joins path segments with the separator of the target OS. Browser-safe (the desktop window
 * computes config paths too), so no `node:path`.
 */
function join(os: HostOs, ...parts: string[]): string {
  const sep = os === "windows" ? "\\" : "/"
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((p, i) => i === 0 || p !== "")
    .join(sep)
}

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
        return join(ctx.os, p, ".mcp.json")
      case "codex":
        return join(ctx.os, p, ".codex", "config.toml")
      case "gemini-cli":
        return join(ctx.os, p, ".gemini", "settings.json")
      case "cursor":
        return join(ctx.os, p, ".cursor", "mcp.json")
      case "vscode":
        return join(ctx.os, p, ".vscode", "mcp.json")
    }
  }
  const h = ctx.home
  switch (host) {
    case "claude-code":
      return join(ctx.os, h, ".claude.json")
    case "codex":
      return join(ctx.os, h, ".codex", "config.toml")
    case "gemini-cli":
      return join(ctx.os, h, ".gemini", "settings.json")
    case "cursor":
      return join(ctx.os, h, ".cursor", "mcp.json")
    case "vscode":
      if (ctx.os === "macos")
        return join(ctx.os, h, "Library", "Application Support", "Code", "User", "mcp.json")
      if (ctx.os === "windows")
        return join(
          ctx.os,
          ctx.appData ?? join(ctx.os, h, "AppData", "Roaming"),
          "Code",
          "User",
          "mcp.json",
        )
      return join(ctx.os, h, ".config", "Code", "User", "mcp.json")
  }
}

/** How the host starts Kimo. */
export type Launcher =
  /** The Rust shim inside the app bundle (attach only). */
  | { kind: "shim"; command: string }
  /**
   * `kimo mcp` from the CLI (auto attach/headless). `prefixArgs` go before `mcp` (e.g.
   * `bunx @kimo/cli mcp …` = command `bunx`, prefixArgs `["@kimo/cli"]`).
   */
  | { kind: "cli"; command: string; prefixArgs?: string[] }
  /** Streamable HTTP on localhost (desktop app must run). */
  | { kind: "http"; url: string; token: string }

/** Default shim location per OS (the app reports the real one via `kimo_mcp_status`). */
export const DEFAULT_SHIM_PATH: Record<HostOs, string> = {
  macos: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp",
  linux: "/usr/bin/kimo-mcp",
  windows: "C:\\Program Files\\Kimo\\kimo-mcp.exe",
}

/** The argv after `command` for a stdio launcher. */
export function launcherArgs(
  launcher: Exclude<Launcher, { kind: "http" }>,
  host: HostId,
): string[] {
  return launcher.kind === "cli"
    ? [...(launcher.prefixArgs ?? []), "mcp", "--client", host]
    : ["--client", host]
}

/** The entry object for JSON hosts (`mcpServers.kimo` / `servers.kimo`). */
export function jsonEntry(host: HostId, launcher: Launcher): Record<string, unknown> {
  if (launcher.kind === "http") {
    const headers = { Authorization: `Bearer ${launcher.token}` }
    if (host === "gemini-cli") return { httpUrl: launcher.url, headers }
    return { type: "http", url: launcher.url, headers }
  }
  const args = launcherArgs(launcher, host)
  const base: Record<string, unknown> = { command: launcher.command, args }
  if (host === "gemini-cli") return { ...base, timeout: 600_000, trust: false }
  return { type: "stdio", ...base }
}

/**
 * Codex per-server tool approval (`mcp_servers.<id>.default_tools_approval_mode`, values
 * `auto | prompt | writes | approve`; developers.openai.com/codex/config-reference, codex-rs
 * `AppToolApproval`, checked 2026-10-04). `auto` (Codex's default) asks before every tool that
 * is not annotated read-only, and `codex exec` — scripted runs, and how Kimo's built-in agent
 * drives Codex (`--sandbox read-only`) — cannot answer that prompt, so `kimo_apply_ops` would
 * fail. `approve` lets Codex call Kimo's tools without its own prompt; Kimo's per-client policy,
 * scopes and approval prompts (ADR 0013 §6) still guard every edit in the app.
 *
 * Kimo-spawned Codex runs (the built-in agent's CLI adapter) always pass `approve` on the command
 * line. The installer, which edits the user's own `~/.codex/config.toml`, writes it only on
 * explicit opt-in (`kimo mcp install --auto-approve`), so the user's interactive Codex keeps its
 * own prompts by default.
 */
export const CODEX_APPROVAL_MODES = ["auto", "prompt", "writes", "approve"] as const
export type CodexApprovalMode = (typeof CODEX_APPROVAL_MODES)[number]

/**
 * The TOML table for Codex. The approval line is written only when `approvalMode` is given
 * (opt-in, or a valid value the user set by hand in our table, which a reinstall keeps).
 */
export function tomlTable(launcher: Launcher, approvalMode?: CodexApprovalMode): string {
  const q = (s: string) => JSON.stringify(s)
  const approval = approvalMode ? `default_tools_approval_mode = ${q(approvalMode)}\n` : ""
  if (launcher.kind === "http")
    return `[mcp_servers.${SERVER_KEY}]\nurl = ${q(launcher.url)}\nhttp_headers = { Authorization = ${q(`Bearer ${launcher.token}`)} }\n${approval}`
  const args = launcherArgs(launcher, "codex")
  return `[mcp_servers.${SERVER_KEY}]\ncommand = ${q(launcher.command)}\nargs = [${args.map(q).join(", ")}]\n${approval}`
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
  options: { codexApproval?: CodexApprovalMode } = {},
): PlanResult {
  if (HOST_INFO[host].format === "toml")
    return planToml(path, before, launcher, options.codexApproval)
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

function planToml(
  path: string,
  before: string | null,
  launcher: Launcher | null,
  codexApproval?: CodexApprovalMode,
): PlanResult {
  const text = before ?? ""
  const problem = tomlProblem(text)
  if (problem)
    return {
      ok: false,
      path,
      code: "UNPARSABLE",
      message: `${path} does not look like valid TOML (${problem}); it was left untouched. Add the snippet by hand.`,
      snippet: launcher ? tomlTable(launcher, codexApproval) : "",
    }
  const lines = text.split("\n")
  const isOurs = (l: string) => {
    const t = l.trim()
    return t === `[mcp_servers.${SERVER_KEY}]` || t.startsWith(`[mcp_servers.${SERVER_KEY}.`)
  }
  const out: string[] = []
  let skipping = false
  let removed = false
  let inMain = false
  let kept: CodexApprovalMode | undefined
  for (const l of lines) {
    if (/^\s*\[/.test(l)) {
      skipping = isOurs(l)
      inMain = l.trim() === `[mcp_servers.${SERVER_KEY}]`
      if (skipping) removed = true
    }
    // The user's own approval mode in our table survives a reinstall.
    const m = inMain && /^\s*default_tools_approval_mode\s*=\s*["']([a-z]+)["']/.exec(l)
    if (m && (CODEX_APPROVAL_MODES as readonly string[]).includes(m[1] as string))
      kept = m[1] as CodexApprovalMode
    if (!skipping) out.push(l)
  }
  let after = out.join("\n").replace(/\n{3,}$/, "\n\n")
  if (launcher) {
    if (after.length && !after.endsWith("\n")) after += "\n"
    if (after.trim().length) after += "\n"
    after += tomlTable(launcher, codexApproval ?? kept)
  }
  if (!launcher && !removed) return { ok: true, path, before, after: before, changed: false }
  const changed = after !== text
  return { ok: true, path, before, after: changed ? after : before, changed }
}

/**
 * Structural TOML check (not a full parser): every top-level line must be blank, a comment, a
 * `[table]` / `[[array]]` header or a `key = value` pair, with brackets, braces and multi-line
 * strings balanced. Enough to refuse files we would corrupt by appending a table. Returns the
 * first problem, or null.
 */
export function tomlProblem(text: string): string | null {
  let depth = 0
  let multi: '"""' | "'''" | null = null
  const lines = text.split("\n")
  for (let n = 0; n < lines.length; n++) {
    const line = (lines[n] as string).replace(/\r$/, "")
    let i = 0
    const t = line.trim()
    if (!multi && depth === 0) {
      if (t === "" || t.startsWith("#")) continue
      if (t.startsWith("[")) {
        if (!/^\[\[?\s*[A-Za-z0-9_\-."' ]+\s*\]\]?\s*(#.*)?$/.test(t))
          return `line ${n + 1}: bad table header`
        continue
      }
      if (
        !/^(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*\s*=/.test(
          t,
        )
      )
        return `line ${n + 1}: expected key = value`
      i = line.indexOf("=") + 1
    }
    for (; i < line.length; i++) {
      const c = line[i] as string
      if (multi) {
        if (line.startsWith(multi, i)) {
          i += 2
          multi = null
        } else if (c === "\\" && multi === '"""') i++
        continue
      }
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        multi = line.slice(i, i + 3) as '"""' | "'''"
        i += 2
        continue
      }
      if (c === "#") break
      if (c === '"' || c === "'") {
        let j = i + 1
        while (j < line.length && line[j] !== c) j += c === '"' && line[j] === "\\" ? 2 : 1
        if (j >= line.length) return `line ${n + 1}: unterminated string`
        i = j
        continue
      }
      if (c === "[" || c === "{") depth++
      else if (c === "]" || c === "}") {
        depth--
        if (depth < 0) return `line ${n + 1}: unbalanced ${c}`
      }
    }
  }
  if (multi) return "unterminated multi-line string"
  if (depth !== 0) return "unbalanced brackets"
  return null
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
  /**
   * Atomic replace (temp + rename). With `expect` (the text the plan was computed from, null =
   * the file did not exist), the implementation re-reads the target right before the rename and
   * returns false without touching it when the content moved (compare-and-swap).
   */
  writeAtomic(path: string, text: string, expect?: string | null): boolean | undefined
  now(): number
}

export interface InstallOptions extends PathContext {
  scope: InstallScope
  /** Compute and return the plan without writing. */
  dryRun?: boolean
  /** Codex only: write `default_tools_approval_mode` (opt-in, `--auto-approve`). */
  codexApproval?: CodexApprovalMode
}

export interface ApplyResult {
  plan: PlanResult
  /** Backup written before the change (absent when nothing changed or the file was new). */
  backup?: string
}

/** Attempts before giving up when another program keeps rewriting the file (CAS misses). */
export const CAS_ATTEMPTS = 5

/** Raised when the config kept changing under us for {@link CAS_ATTEMPTS} attempts. */
export class ConcurrentEditError extends Error {
  override readonly name = "ConcurrentEditError"
  constructor(readonly path: string) {
    super(`${path} kept changing while Kimo tried to update it; nothing was written. Try again.`)
  }
}

/**
 * Plan → backup → compare-and-swap write. The plan is recomputed from a fresh read when the file
 * changed between our read and the rename (e.g. Claude Code rewriting `~/.claude.json`), so a
 * concurrent writer's change is merged rather than clobbered. The remaining window is the
 * rename itself (microseconds), which no file-based protocol can close without the other
 * program's cooperation.
 */
function apply(
  fs: InstallerFs,
  host: HostId,
  launcher: Launcher | null,
  o: InstallOptions,
): ApplyResult {
  const path = configPath(host, o.scope, o)
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const before = fs.read(path)
    const plan = planEdit(host, path, before, launcher, { codexApproval: o.codexApproval })
    if (!plan.ok || !plan.changed || o.dryRun || plan.after === null) return { plan }
    let backup: string | undefined
    if (before !== null) {
      backup = join(o.os, o.home, ".kimo", "mcp", "backups", `${host}-${fs.now()}.bak`)
      fs.writeAtomic(backup, before)
    }
    if (fs.writeAtomic(path, plan.after, before) === false) continue
    return backup ? { plan, backup } : { plan }
  }
  throw new ConcurrentEditError(path)
}

export function install(
  host: HostId,
  launcher: Launcher,
  o: InstallOptions,
  fs: InstallerFs,
): ApplyResult {
  return apply(fs, host, launcher, o)
}

export function remove(host: HostId, o: InstallOptions, fs: InstallerFs): ApplyResult {
  return apply(fs, host, null, o)
}

export function status(
  host: HostId,
  launcher: Launcher,
  o: PathContext & { scope: InstallScope },
  fs: InstallerFs,
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
