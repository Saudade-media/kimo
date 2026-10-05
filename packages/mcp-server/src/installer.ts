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
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import {
  type ApplyResult,
  type HostId,
  type HostStatus,
  type InstallerFs,
  type InstallOptions,
  type InstallScope,
  install as installWith,
  type Launcher,
  type PathContext,
  remove as removeWith,
  status as statusWith,
} from "./installer-core"

// Everything except the Node file writer lives in the browser-safe core (the desktop window
// imports `@kimo/mcp-server/installer-core`); these wrappers default to the real fs.
export * from "./installer-core"

export const nodeInstallerFs: InstallerFs = {
  read(path) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return null
    }
  },
  writeAtomic(path, text, expect) {
    mkdirSync(dirname(path), { recursive: true })
    let mode = 0o600
    try {
      // Keep the permissions of an existing config (e.g. 0644 settings files).
      mode = statSync(path).mode & 0o777
    } catch {
      // New file.
    }
    const tmp = `${path}.kimo-tmp-${process.pid}-${Date.now().toString(36)}`
    writeFileSync(tmp, text, { mode })
    try {
      chmodSync(tmp, mode)
      if (expect !== undefined && nodeInstallerFs.read(path) !== expect) {
        rmSync(tmp, { force: true })
        return false
      }
      renameSync(tmp, path)
    } catch (e) {
      rmSync(tmp, { force: true })
      throw e
    }
    return true
  },
  now: () => Date.now(),
}

export function install(
  host: HostId,
  launcher: Launcher,
  o: InstallOptions,
  fs: InstallerFs = nodeInstallerFs,
): ApplyResult {
  return installWith(host, launcher, o, fs)
}

export function remove(
  host: HostId,
  o: InstallOptions,
  fs: InstallerFs = nodeInstallerFs,
): ApplyResult {
  return removeWith(host, o, fs)
}

export function status(
  host: HostId,
  launcher: Launcher,
  o: PathContext & { scope: InstallScope },
  fs: InstallerFs = nodeInstallerFs,
): HostStatus {
  return statusWith(host, launcher, o, fs)
}
