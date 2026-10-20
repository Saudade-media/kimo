/**
 * The processes behind board 42's one-click parts, over a {@link RelayHostApi}:
 *
 * - {@link LocalRelay}: the relay on this computer (section 3). Checks (Bun, port 8787 or the next
 *   free one, cloudflared), Install Bun with the installer's steps as lines, Start relay with the
 *   secret and origins in its environment, then the tunnel (quick: the trycloudflare.com address
 *   read from cloudflared; named: create, route DNS, run), Stop, and Restart for a new secret.
 * - {@link runFlySteps}: the flyctl deploy log (section 5 B): each command one line that ticks
 *   with its time; an error stops the run with flyctl's last lines.
 */
import { type FlyStep, flyRelayUrl, localRelayEnv } from "./commands"
import type { ProcLine, RelayHostApi, RelayProc, ToolInfo } from "./host"
import {
  advanceInstall,
  bunInstallLines,
  cloudflared,
  finishInstall,
  type InstallLine,
  lanRelayUrl,
  parseQuickTunnelUrl,
  pickPort,
  RELAY_LISTENING,
  type Reach,
  tunnelExists,
} from "./local"

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** How long the relay may take to print that it listens. */
export const RELAY_START_MS = 15_000
/** How long cloudflared may take to print the quick tunnel's address. */
export const TUNNEL_START_MS = 30_000
/** Lines of a failed command kept for the error (the board's "flyctl's last lines"). */
export const TAIL_LINES = 8

/** Resolves with what `until` returns for a line, or rejects when the process exits or time runs out. */
function waitForLine<T>(
  clock: Clock,
  proc: { exited: Promise<number | null> },
  subscribe: (fn: (line: string) => void) => void,
  until: (line: string) => T | null,
  ms: number,
  what: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const handle = clock.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${what} did not start within ${Math.round(ms / 1000)} s`))
    }, ms)
    subscribe((line) => {
      if (settled) return
      const hit = until(line)
      if (hit === null) return
      settled = true
      clock.clearTimeout(handle)
      resolve(hit)
    })
    void proc.exited.then((code) => {
      if (settled) return
      settled = true
      clock.clearTimeout(handle)
      reject(new Error(`${what} stopped (exit ${code ?? "signal"})`))
    })
  })
}

/** Keeps the last {@link TAIL_LINES} lines. */
class Tail {
  lines: string[] = []
  push(line: string) {
    this.lines.push(line)
    if (this.lines.length > TAIL_LINES) this.lines.shift()
  }
}

// --- This computer ---------------------------------------------------------------------------------

export interface LocalChecks {
  bun: ToolInfo | null
  /** 8787 or the next free port; null when none is free. */
  port: number | null
  cloudflared: ToolInfo | null
}

export interface LocalRelayOptions {
  port: number
  secret: string | null
  origins: readonly string[]
  reach: Reach
  hostname: string | null
}

export type LocalStatus = "stopped" | "starting" | "running" | "restarting" | "failed"

export interface LocalRelayState {
  status: LocalStatus
  options: LocalRelayOptions | null
  /** `ws://<lan address>:<port>`. */
  lanUrl: string | null
  /** The tunnel's `wss://` address (quick or named). */
  publicUrl: string | null
  startedAt: number | null
  error: string | null
  /** Install Bun: the four log lines while it runs, null otherwise. */
  install: { lines: InstallLine[]; startedAt: number; error: string | null; tail: string[] } | null
}

const STOPPED: LocalRelayState = {
  status: "stopped",
  options: null,
  lanUrl: null,
  publicUrl: null,
  startedAt: null,
  error: null,
  install: null,
}

export class LocalRelay {
  private state: LocalRelayState = STOPPED
  private readonly listeners = new Set<() => void>()
  private relay: RelayProc | null = null
  private tunnel: RelayProc | null = null
  private installer: RelayProc | null = null

  constructor(
    readonly host: RelayHostApi,
    private readonly info: { os: string; arch: string },
    private readonly clock: Clock = realClock,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): LocalRelayState => this.state

  private set(patch: Partial<LocalRelayState>) {
    this.state = { ...this.state, ...patch }
    for (const l of [...this.listeners]) l()
  }

  async checks(preferredPort?: number): Promise<LocalChecks> {
    const [bun, cf, port] = await Promise.all([
      this.host.findTool("bun"),
      this.host.findTool("cloudflared"),
      this.state.status === "running" && this.state.options
        ? Promise.resolve(this.state.options.port)
        : pickPort((p) => this.host.portFree(p), preferredPort),
    ])
    return { bun, port, cloudflared: cf }
  }

  /** Install Bun (after the confirm): the official installer, its steps as lines. */
  async installBun(): Promise<ToolInfo | null> {
    const tail = new Tail()
    let lines = bunInstallLines(this.info.os, this.info.arch)
    const startedAt = this.clock.now()
    this.set({ install: { lines, startedAt, error: null, tail: [] } })
    const onLine = ({ line }: ProcLine) => {
      tail.push(line)
      lines = advanceInstall(lines, line)
      this.set({ install: { lines, startedAt, error: null, tail: [...tail.lines] } })
    }
    try {
      this.installer = await this.host.spawn({ kind: "bun-install" }, onLine)
      const code = await this.installer.exited
      if (code !== 0) throw new Error(`the installer stopped (exit ${code ?? "signal"})`)
      lines = lines.map((l) => ({ ...l, status: l.id === "check" ? "running" : "done" }))
      this.set({ install: { lines, startedAt, error: null, tail: [...tail.lines] } })
      const bun = await this.host.findTool("bun")
      if (!bun) throw new Error("bun was not found after installing")
      this.set({ install: { lines: finishInstall(lines, true), startedAt, error: null, tail: [] } })
      return bun
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.set({
        install: {
          lines: finishInstall(lines, false),
          startedAt,
          error: message,
          tail: tail.lines,
        },
      })
      return null
    } finally {
      this.installer = null
    }
  }

  cancelInstall(): void {
    void this.installer?.kill()
  }

  clearInstall(): void {
    this.set({ install: null })
  }

  async start(options: LocalRelayOptions): Promise<LocalRelayState> {
    await this.stopProcesses()
    this.set({ ...STOPPED, status: "starting", options, install: null })
    const relayLines: ((line: string) => void)[] = []
    const tail = new Tail()
    try {
      this.relay = await this.host.spawn(
        { kind: "relay", env: localRelayEnv(options) },
        ({ line }) => {
          tail.push(line)
          for (const fn of relayLines) fn(line)
        },
      )
      const relay = this.relay
      void relay.exited.then(() => {
        if (this.relay !== relay) return
        this.relay = null
        if (this.state.status === "running")
          this.set({
            status: "failed",
            error: `The relay stopped. ${tail.lines.at(-1) ?? ""}`.trim(),
          })
      })
      await waitForLine(
        this.clock,
        relay,
        (fn) => relayLines.push(fn),
        (line) => (RELAY_LISTENING.test(line) ? true : null),
        RELAY_START_MS,
        "The relay",
      )
      const lan = await this.host.lanAddress()
      const lanUrl = lan ? lanRelayUrl(lan, options.port) : lanRelayUrl("127.0.0.1", options.port)
      const publicUrl = options.reach === "lan" ? null : await this.startTunnel(options)
      this.set({ status: "running", lanUrl, publicUrl, startedAt: this.clock.now(), error: null })
    } catch (error) {
      await this.stopProcesses()
      const message = error instanceof Error ? error.message : String(error)
      const last = tail.lines.at(-1)
      this.set({ status: "failed", error: last ? `${message}: ${last}` : message })
    }
    return this.state
  }

  private async startTunnel(options: LocalRelayOptions): Promise<string> {
    const subs: ((line: string) => void)[] = []
    const onLine = ({ line }: ProcLine) => {
      for (const fn of subs) fn(line)
    }
    if (options.reach === "quick") {
      this.tunnel = await this.host.spawn(
        { kind: "cloudflared", args: cloudflared.quick(options.port) },
        onLine,
      )
      return waitForLine(
        this.clock,
        this.tunnel,
        (fn) => subs.push(fn),
        parseQuickTunnelUrl,
        TUNNEL_START_MS,
        "The quick tunnel",
      )
    }
    const hostname = options.hostname?.trim().toLowerCase()
    if (!hostname) throw new Error("Pick a hostname for the named tunnel")
    for (const args of [cloudflared.create(hostname), cloudflared.route(hostname)]) {
      const out = new Tail()
      const proc = await this.host.spawn({ kind: "cloudflared", args }, ({ line }) =>
        out.push(line),
      )
      const code = await proc.exited
      if (code !== 0 && !tunnelExists(out.lines.join("\n")))
        throw new Error(
          `cloudflared ${args.slice(1, 3).join(" ")} failed: ${out.lines.at(-1) ?? ""}`,
        )
    }
    this.tunnel = await this.host.spawn(
      { kind: "cloudflared", args: cloudflared.run(hostname, options.port) },
      onLine,
    )
    await waitForLine(
      this.clock,
      this.tunnel,
      (fn) => subs.push(fn),
      (line) =>
        /Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(line) ? true : null,
      TUNNEL_START_MS,
      "The named tunnel",
    )
    return `wss://${hostname}`
  }

  private async stopProcesses() {
    const procs = [this.tunnel, this.relay]
    this.tunnel = null
    this.relay = null
    await Promise.all(procs.map((p) => p?.kill().catch(() => undefined)))
  }

  async stop(): Promise<void> {
    await this.stopProcesses()
    this.set({ ...STOPPED })
  }

  /** Regenerate: the same relay with a new secret (a second or two). */
  async restart(secret: string): Promise<LocalRelayState> {
    const options = this.state.options
    if (!options) throw new Error("The relay on this computer is not running")
    this.set({ status: "restarting" })
    return this.start({ ...options, secret })
  }

  /** Picks up a relay another window started (Settings, Share popover). */
  async adopt(saved?: { reach: Reach; hostname: string | null }): Promise<void> {
    if (this.relay) return
    const running = await this.host.running().catch(() => [])
    const relay = running.find((p) => p.kind === "relay")
    if (!relay) return
    this.relay = this.host.attach(relay, () => {})
    const tunnel = running.find((p) => p.kind === "cloudflared" && p.args.includes("--url"))
    if (tunnel) this.tunnel = this.host.attach(tunnel, () => {})
    const port = Number(/listening on https?:\/\/[^:]+:(\d+)/.exec(relay.tail.join("\n"))?.[1])
    const lan = await this.host.lanAddress()
    const quick = tunnel
      ? (tunnel.tail.map(parseQuickTunnelUrl).find((u) => u !== null) ?? null)
      : null
    const named =
      tunnel && !quick && saved?.reach === "named" && saved.hostname ? saved.hostname : null
    const reach: Reach = quick ? "quick" : named ? "named" : "lan"
    this.set({
      status: "running",
      lanUrl: port ? lanRelayUrl(lan ?? "127.0.0.1", port) : null,
      publicUrl: quick ?? (named ? `wss://${named}` : null),
      startedAt: relay.startedAt,
      options: port ? { port, secret: null, origins: [], reach, hostname: named } : null,
    })
  }
}

// --- Fly.io -----------------------------------------------------------------------------------------

export interface FlyLine {
  id: FlyStep["id"]
  label: string
  status: "pending" | "running" | "done" | "failed"
  /** Its time once it ran ("2 s", "1:05"). */
  ms: number | null
}

export interface FlyRun {
  lines: FlyLine[]
  startedAt: number
  /** The failed command's last lines. */
  tail: string[]
  /** Every line flyctl printed (the full output behind the disclosure), bounded. */
  output: string[]
  error: string | null
  done: boolean
}

/** Health check: polls until the relay answers, at most this long. */
export const FLY_HEALTH_MS = 180_000
export const FLY_HEALTH_EVERY_MS = 3000
export const MAX_OUTPUT_LINES = 500

/**
 * Runs the steps in order. `healthy(url)` resolves true once the relay answers (the relay test's
 * probe). Never throws: a failure is in the returned run.
 */
export async function runFlySteps(
  host: RelayHostApi,
  steps: FlyStep[],
  app: string,
  healthy: (url: string) => Promise<boolean>,
  onUpdate: (run: FlyRun) => void,
  clock: Clock = realClock,
  cancelled: () => boolean = () => false,
): Promise<FlyRun> {
  let run: FlyRun = {
    lines: steps.map((s) => ({ id: s.id, label: s.label, status: "pending", ms: null })),
    startedAt: clock.now(),
    tail: [],
    output: [],
    error: null,
    done: false,
  }
  const update = (
    patch: Partial<FlyRun>,
    line?: { id: FlyStep["id"]; patch: Partial<FlyLine> },
  ) => {
    run = {
      ...run,
      ...patch,
      lines: line
        ? run.lines.map((l) => (l.id === line.id ? { ...l, ...line.patch } : l))
        : run.lines,
    }
    onUpdate(run)
  }
  for (const step of steps) {
    if (cancelled()) return run
    const started = clock.now()
    update({}, { id: step.id, patch: { status: "running" } })
    try {
      if (step.args === null) {
        const until = started + FLY_HEALTH_MS
        let ok = false
        while (!ok && clock.now() < until && !cancelled()) {
          ok = await healthy(flyRelayUrl(app)).catch(() => false)
          if (!ok) await new Promise<void>((r) => clock.setTimeout(r, FLY_HEALTH_EVERY_MS))
        }
        if (!ok)
          throw new Error(`${app}.fly.dev did not answer within ${FLY_HEALTH_MS / 60_000} min`)
      } else {
        const tail = new Tail()
        const proc = await host.spawn(
          { kind: "flyctl", args: step.args, ...(step.stdin ? { stdin: step.stdin } : {}) },
          ({ line }) => {
            tail.push(line)
            update({ output: [...run.output, line].slice(-MAX_OUTPUT_LINES) })
          },
        )
        const code = await proc.exited
        if (code !== 0) {
          run = { ...run, tail: tail.lines }
          throw new Error(tail.lines.at(-1) ?? `flyctl exited with ${code ?? "a signal"}`)
        }
      }
      update({}, { id: step.id, patch: { status: "done", ms: clock.now() - started } })
    } catch (error) {
      update(
        { error: error instanceof Error ? error.message : String(error), done: true },
        { id: step.id, patch: { status: "failed", ms: clock.now() - started } },
      )
      return run
    }
  }
  update({ done: true })
  return run
}

/** "2 s" under a minute, else "1:05". */
export function stepTime(ms: number | null): string {
  if (ms === null) return ""
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
