/**
 * Which command the agent hosts should run (ADR 0013 §9):
 *
 * 1. `--command <path>` or `$KIMO_MCP_SHIM`: that shim binary;
 * 2. the bundled `kimo-mcp` shim of an installed desktop app (attach-only, fastest start), looked
 *    up in the usual install locations, including the app bundle's `MacOS/` and `Resources/`;
 * 3. otherwise the CLI itself: `bunx @kimo/cli mcp` (auto attach / headless).
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_SHIM_PATH, type HostOs, type Launcher } from "@kimo/mcp-server/installer"

export const hostOs = (): HostOs =>
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

/** Candidate shim locations, most likely first. */
export function shimCandidates(
  os: HostOs,
  home: string,
  env: Record<string, string | undefined>,
): string[] {
  switch (os) {
    case "macos":
      return [
        DEFAULT_SHIM_PATH.macos,
        "/Applications/Kimo.app/Contents/Resources/kimo-mcp",
        join(home, "Applications", "Kimo.app", "Contents", "MacOS", "kimo-mcp"),
        join(home, "Applications", "Kimo.app", "Contents", "Resources", "kimo-mcp"),
      ]
    case "windows":
      return [
        DEFAULT_SHIM_PATH.windows,
        join(
          env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
          "Programs",
          "Kimo",
          "kimo-mcp.exe",
        ),
        join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Kimo", "kimo-mcp.exe"),
      ]
    case "linux":
      return [DEFAULT_SHIM_PATH.linux, "/opt/Kimo/kimo-mcp", "/usr/lib/kimo/kimo-mcp"]
  }
}

export const CLI_LAUNCHER: Launcher = { kind: "cli", command: "bunx", prefixArgs: ["@kimo/cli"] }

export interface LauncherChoice {
  launcher: Launcher
  /** Human explanation for `status` / dry runs. */
  reason: string
}

export function resolveLauncher(o: {
  os: HostOs
  home: string
  env: Record<string, string | undefined>
  command?: string
  useCli?: boolean
  exists?: (p: string) => boolean
}): LauncherChoice {
  const exists = o.exists ?? existsSync
  if (o.useCli) return { launcher: CLI_LAUNCHER, reason: "--cli: bunx @kimo/cli mcp" }
  const explicit = o.command ?? o.env.KIMO_MCP_SHIM
  if (explicit) return { launcher: { kind: "shim", command: explicit }, reason: `shim ${explicit}` }
  // Tests and packagers can replace the search list (path-separated).
  const list = o.env.KIMO_MCP_SHIM_CANDIDATES
    ? o.env.KIMO_MCP_SHIM_CANDIDATES.split(o.os === "windows" ? ";" : ":").filter(Boolean)
    : shimCandidates(o.os, o.home, o.env)
  for (const c of list)
    if (exists(c)) return { launcher: { kind: "shim", command: c }, reason: `bundled shim ${c}` }
  return {
    launcher: CLI_LAUNCHER,
    reason: "Kimo app not found: bunx @kimo/cli mcp (attaches to the app when it runs)",
  }
}
