/**
 * Board 42 section 3 and rules "This computer", "Quick vs named tunnel": the pieces of running a
 * relay here that do not need a process: the port (8787, next free if taken), the addresses, the
 * cloudflared arguments and the quick tunnel's address in its output, and the Bun installer's
 * progress read from its output.
 */
import { RELAY_PORT } from "./commands"

/** How many ports past 8787 are tried before giving up. */
export const PORT_TRIES = 20

/** 8787, or the next free port; null when none of {@link PORT_TRIES} is free. */
export async function pickPort(
  isFree: (port: number) => Promise<boolean>,
  start = RELAY_PORT,
  tries = PORT_TRIES,
): Promise<number | null> {
  for (let port = start; port < start + tries && port <= 65535; port++)
    if (await isFree(port)) return port
  return null
}

/** Same network: `ws://<lan address>:<port>`. */
export const lanRelayUrl = (address: string, port: number) => `ws://${address}:${port}`

/** Who can reach the relay on this computer. */
export type Reach = "lan" | "quick" | "named"

const QUICK_HOST = /^[a-z0-9-]+\.trycloudflare\.com$/

/** Whether a relay URL is a quick tunnel (its address changes on every restart). */
export function isQuickTunnelUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return QUICK_HOST.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The quick tunnel's address in a line of cloudflared output, as a `wss://` relay URL. */
export function parseQuickTunnelUrl(line: string): string | null {
  const m = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)\b/.exec(line)
  if (!m || m[1] === "api.trycloudflare.com") return null
  return `wss://${m[1]}`
}

/** A hostname for a named tunnel: two or more DNS labels. */
export function validHostname(name: string): boolean {
  const h = name.trim().toLowerCase()
  return (
    h.length <= 253 &&
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(h) &&
    !h.endsWith(".trycloudflare.com")
  )
}

/** The named tunnel Kimo creates: one per hostname. */
export const tunnelName = (hostname: string) =>
  `kimo-relay-${hostname
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`.slice(0, 63)

/** cloudflared arguments (the program is the person's installed cloudflared). */
export const cloudflared = {
  quick: (port: number) => ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
  login: () => ["tunnel", "login"],
  create: (hostname: string) => ["tunnel", "create", tunnelName(hostname)],
  route: (hostname: string) => [
    "tunnel",
    "route",
    "dns",
    "--overwrite-dns",
    tunnelName(hostname),
    hostname.trim().toLowerCase(),
  ],
  run: (hostname: string, port: number) => [
    "tunnel",
    "--no-autoupdate",
    "run",
    "--url",
    `http://localhost:${port}`,
    tunnelName(hostname),
  ],
}

/** cloudflared says the tunnel already exists: creating it again is fine. */
export const tunnelExists = (output: string) => /already exists/i.test(output)

/** The relay prints this once it listens (apps/server/src/main.ts). */
export const RELAY_LISTENING = /@kimo\/server listening on /

// --- Install Bun (section 3 F) --------------------------------------------------------------------

export type InstallLineId = "download" | "extract" | "profile" | "check"

export interface InstallLine {
  id: InstallLineId
  label: string
  status: "pending" | "running" | "done" | "failed"
}

/** The four lines of the installer log, as on the board. */
export function bunInstallLines(os: string, arch: string): InstallLine[] {
  const target = `bun-${os === "macos" ? "darwin" : os === "windows" ? "windows" : "linux"}-${
    arch === "aarch64" || arch === "arm64" ? "aarch64" : "x64"
  }.zip`
  return [
    { id: "download", label: `Downloading ${target}`, status: "running" },
    { id: "extract", label: "Extracting to ~/.bun/bin", status: "pending" },
    { id: "profile", label: "Adding ~/.bun/bin to your shell profile", status: "pending" },
    { id: "check", label: "Checking bun --version", status: "pending" },
  ]
}

const order: InstallLineId[] = ["download", "extract", "profile", "check"]

/** Moves the lines along as the bun.sh installer prints its steps. */
export function advanceInstall(lines: InstallLine[], output: string): InstallLine[] {
  let reached: InstallLineId | null = null
  // "bun was installed successfully to ~/.bun/bin/bun": downloaded and extracted.
  if (/installed successfully|Extracting|unzip/i.test(output)) reached = "extract"
  // "Added "~/.bun/bin" to $PATH in "~/.zshrc"" or the manual instructions.
  if (/to \$PATH|shell profile|Manually add|exec \$SHELL|source ~\//i.test(output))
    reached = "profile"
  if (!reached) return lines
  const upTo = order.indexOf(reached)
  const current = order.indexOf(lines.find((l) => l.status === "running")?.id ?? "download")
  if (upTo < current) return lines
  return lines.map((l) => {
    const i = order.indexOf(l.id)
    if (i <= upTo) return { ...l, status: "done" }
    if (i === upTo + 1) return { ...l, status: "running" }
    return l
  })
}

/** The installer ended: the rest done (or the running line failed). */
export function finishInstall(lines: InstallLine[], ok: boolean): InstallLine[] {
  if (ok) return lines.map((l) => ({ ...l, status: "done" }))
  return lines.map((l) => (l.status === "running" ? { ...l, status: "failed" } : l))
}

/** Share of the install done, for the progress bar (0..1). */
export const installProgress = (lines: InstallLine[]) =>
  lines.filter((l) => l.status === "done").length / lines.length

/** `m:ss` for the elapsed times. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** "Up 2 h 14 min" for the running relay. */
export function uptime(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 1) return "Up less than a minute"
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `Up ${h} h ${m} min` : `Up ${m} min`
}
