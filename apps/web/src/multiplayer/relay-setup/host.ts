/**
 * The desktop side of the relay setup wizard (board 42 sections 3 and 5): finding Bun,
 * cloudflared and flyctl, the port and same-network address, and the processes Kimo runs for the
 * person (the relay with their Bun, the bun.sh installer, cloudflared, flyctl). Rust is the gate
 * (apps/desktop/src-tauri/src/relay_host.rs): it runs only those programs, with arguments it
 * checks, and stops every one when Kimo quits. Web has none of this (`null`).
 */

export type RelayTool = "bun" | "cloudflared" | "flyctl"

export interface ToolInfo {
  /** Absolute path of the binary. */
  path: string
  /** From `<tool> --version`; null when it did not say. */
  version: string | null
}

export type ProcKind = "relay" | "bun-install" | "cloudflared" | "flyctl"

export interface ProcLine {
  stream: "stdout" | "stderr"
  line: string
}

export interface RelayProc {
  readonly id: string
  readonly kind: ProcKind
  /** Exit code (null when killed by a signal). */
  readonly exited: Promise<number | null>
  kill(): Promise<void>
}

export interface RelayProcInfo {
  id: string
  kind: ProcKind
  args: string[]
  /** ms since the epoch. */
  startedAt: number
  /** The last lines of output (bounded), to pick a running relay up in another window. */
  tail: string[]
}

export interface SpawnInput {
  kind: ProcKind
  /** cloudflared and flyctl arguments; the relay and the installer take none. */
  args?: string[]
  /** The relay's environment (PORT, HOST, KIMO_CREATE_SECRET, KIMO_ALLOWED_ORIGINS only). */
  env?: Record<string, string>
  /** Written to stdin, then stdin closes (flyctl secrets import). */
  stdin?: string
}

export interface RelayHostApi {
  findTool(tool: RelayTool): Promise<ToolInfo | null>
  portFree(port: number): Promise<boolean>
  /** This computer's private IPv4 address on the local network. */
  lanAddress(): Promise<string | null>
  /** The Fly.io region closest to this computer, or null. */
  flyRegion(): Promise<string | null>
  /** Whether `cloudflared tunnel login` has left its certificate (~/.cloudflared/cert.pem). */
  cloudflaredLoggedIn(): Promise<boolean>
  /** Writes the fly.toml for a one-click deploy; returns its path. */
  writeFlyConfig(content: string): Promise<string>
  spawn(input: SpawnInput, onLine: (line: ProcLine) => void): Promise<RelayProc>
  /** Processes still running (any window started them). */
  running(): Promise<RelayProcInfo[]>
  /** Follows a running process from {@link running}. */
  attach(info: RelayProcInfo, onLine: (line: ProcLine) => void): RelayProc
}

export const RELAY_OUTPUT_EVENT = "kimo://relay-output"
export const RELAY_EXIT_EVENT = "kimo://relay-exit"

/** The Rust commands (also listed in command_list_relay.rs). */
export const TAURI_RELAY_COMMANDS = [
  "kimo_relay_secret_get",
  "kimo_relay_secret_set",
  "kimo_relay_secret_delete",
  "kimo_relay_find_tool",
  "kimo_relay_port_free",
  "kimo_relay_lan_address",
  "kimo_relay_fly_region",
  "kimo_relay_cloudflared_logged_in",
  "kimo_relay_write_fly_config",
  "kimo_relay_spawn",
  "kimo_relay_kill",
  "kimo_relay_running",
] as const

export interface Bridge {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>
}

/** The host over Tauri IPC: output arrives as `kimo://relay-output` / `kimo://relay-exit`. */
export function createTauriRelayHost(bridge: Bridge): RelayHostApi {
  const lineSinks = new Map<string, Set<(l: ProcLine) => void>>()
  const exitSinks = new Map<string, Set<(code: number | null) => void>>()
  const exitedCodes = new Map<string, number | null>()
  let listening: Promise<void> | null = null
  const listen = () => {
    listening ??= Promise.all([
      bridge.listen(RELAY_OUTPUT_EVENT, (p) => {
        const { procId, stream, line } = p as {
          procId: string
          stream: ProcLine["stream"]
          line: string
        }
        for (const s of lineSinks.get(procId) ?? []) s({ stream, line })
      }),
      bridge.listen(RELAY_EXIT_EVENT, (p) => {
        const { procId, code } = p as { procId: string; code: number | null }
        exitedCodes.set(procId, code)
        for (const s of exitSinks.get(procId) ?? []) s(code)
        lineSinks.delete(procId)
        exitSinks.delete(procId)
      }),
    ]).then(() => undefined)
    return listening
  }
  const follow = (id: string, kind: ProcKind, onLine: (l: ProcLine) => void): RelayProc => {
    const lines = lineSinks.get(id) ?? new Set()
    lineSinks.set(id, lines)
    lines.add(onLine)
    const exited = new Promise<number | null>((resolve) => {
      if (exitedCodes.has(id)) return resolve(exitedCodes.get(id) ?? null)
      const exits = exitSinks.get(id) ?? new Set()
      exitSinks.set(id, exits)
      exits.add(resolve)
    })
    return {
      id,
      kind,
      exited,
      kill: async () => {
        await bridge.invoke("kimo_relay_kill", { procId: id })
      },
    }
  }
  return {
    findTool: async (tool) =>
      ((await bridge.invoke("kimo_relay_find_tool", { tool })) as ToolInfo | null) ?? null,
    portFree: async (port) => (await bridge.invoke("kimo_relay_port_free", { port })) === true,
    lanAddress: async () =>
      ((await bridge.invoke("kimo_relay_lan_address")) as string | null) ?? null,
    flyRegion: async () =>
      ((await bridge.invoke("kimo_relay_fly_region")) as string | null) ?? null,
    cloudflaredLoggedIn: async () =>
      (await bridge.invoke("kimo_relay_cloudflared_logged_in")) === true,
    writeFlyConfig: async (content) =>
      (await bridge.invoke("kimo_relay_write_fly_config", { content })) as string,
    async spawn(input, onLine) {
      await listen()
      const { procId } = (await bridge.invoke("kimo_relay_spawn", {
        kind: input.kind,
        args: input.args ?? [],
        env: input.env ?? {},
        ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
      })) as { procId: string }
      return follow(procId, input.kind, onLine)
    },
    running: async () => ((await bridge.invoke("kimo_relay_running")) as RelayProcInfo[]) ?? [],
    attach(info, onLine) {
      void listen()
      return follow(info.id, info.kind, onLine)
    },
  }
}

// --- Fake (tests, harnesses) ---------------------------------------------------------------------

export interface FakeProcScript {
  /** Lines printed one by one (each after `everyMs`). */
  lines?: string[]
  /** Exit code after the lines; undefined keeps it running until killed. */
  exit?: number
  everyMs?: number
}

export interface FakeRelayHostOptions {
  tools?: Partial<Record<RelayTool, ToolInfo | null>>
  busyPorts?: number[]
  lan?: string | null
  region?: string | null
  cloudflaredLoggedIn?: boolean
  /** What each spawn does, by kind (or `flyctl:<subcommand>`). */
  scripts?: Partial<Record<string, FakeProcScript>>
  setTimeout?: (fn: () => void, ms: number) => unknown
}

/**
 * A scripted host: bounded output, no real processes. `spawned` records every call (arguments,
 * env, stdin) for assertions.
 */
export function createFakeRelayHost(options: FakeRelayHostOptions = {}) {
  const tools = { ...options.tools }
  const busy = new Set(options.busyPorts ?? [])
  const later = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const spawned: (SpawnInput & { id: string })[] = []
  const live = new Map<string, { info: RelayProcInfo; kill(): void }>()
  let next = 0
  let loggedIn = options.cloudflaredLoggedIn ?? false
  const host: RelayHostApi & {
    spawned: typeof spawned
    setTool(tool: RelayTool, info: ToolInfo | null): void
    setLoggedIn(v: boolean): void
  } = {
    spawned,
    setTool(tool, info) {
      tools[tool] = info
    },
    setLoggedIn(v) {
      loggedIn = v
    },
    findTool: async (tool) => tools[tool] ?? null,
    portFree: async (port) => !busy.has(port),
    lanAddress: async () => (options.lan === undefined ? "192.168.1.24" : options.lan),
    flyRegion: async () => (options.region === undefined ? "ams" : options.region),
    cloudflaredLoggedIn: async () => loggedIn,
    writeFlyConfig: async () => "/fake/.kimo/relay/fly.toml",
    async spawn(input, onLine) {
      const id = `fake-${++next}`
      spawned.push({ ...input, id })
      const key =
        input.kind === "flyctl" && input.args?.[0] ? `flyctl:${input.args[0]}` : input.kind
      const script = options.scripts?.[key] ?? options.scripts?.[input.kind] ?? { exit: 0 }
      const lines = (script.lines ?? []).slice(0, 200)
      let done = false
      let resolveExit!: (code: number | null) => void
      const exited = new Promise<number | null>((r) => {
        resolveExit = r
      })
      const finish = (code: number | null) => {
        if (done) return
        done = true
        live.delete(id)
        resolveExit(code)
      }
      const info: RelayProcInfo = {
        id,
        kind: input.kind,
        args: input.args ?? [],
        startedAt: Date.now(),
        tail: [],
      }
      live.set(id, { info, kill: () => finish(null) })
      const step = (i: number) => {
        if (done) return
        if (i < lines.length) {
          const line = lines[i] as string
          info.tail = [...info.tail, line].slice(-50)
          onLine({ stream: "stderr", line })
          later(() => step(i + 1), script.everyMs ?? 1)
        } else if (script.exit !== undefined) finish(script.exit)
      }
      later(() => step(0), script.everyMs ?? 1)
      return { id, kind: input.kind, exited, kill: async () => finish(null) }
    },
    running: async () => [...live.values()].map((p) => p.info),
    attach(info) {
      const p = live.get(info.id)
      return {
        id: info.id,
        kind: info.kind,
        exited: new Promise(() => {}),
        kill: async () => p?.kill(),
      }
    },
  }
  return host
}
