/**
 * Headless `kimo mcp` (ADR 0013 §8): one in-process MCP server over stdio, backed by a
 * headless DocumentHost: documents live in memory, each opened file holds the per-file lease
 * ("kimo mcp (headless)"), saves are atomic with read-back, autosave runs after 2 s idle, and on
 * exit unsaved edits are saved (or written to `~/.kimo/recovery/` when the save fails). There is
 * no UI, so anything that would need an approval prompt is denied (policy `onExceed: "deny"`).
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Readable, Writable } from "node:stream"
import { jsonSchemaText } from "@kimo/core-schema"
import { serialize } from "@kimo/editor-state"
import {
  type CallTargets,
  type ClientIdentity,
  type ClientPolicy,
  clientSlug,
  connectionHandlers,
  createMemoryDocumentHost,
  createToolHandlers,
  type DocumentHost,
  emptyAllowances,
  GUIDES,
  HEADLESS_DEFAULTS,
  HEADLESS_POLICY,
  type McpConnection,
  originOf,
  type PermissionLevel,
  type ToolContext,
  type ToolHandlers,
} from "@kimo/mcp-server"
import { createKimoMcpServer, validateInput } from "@kimo/mcp-server/server"
import type { KimoPlatform } from "@kimo/platform"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { pathHash } from "../io"
import { createFallbackHandlers, createFallbackHost } from "./fallback"
import { canonical, createNodePlatform } from "./node-platform"

export const CLI_VERSION = "1.1.0"

export interface HeadlessOptions {
  kimoHome: string
  cwd: string
  level: PermissionLevel
  /** File allow-list globs; default `<cwd>/**`. */
  files: string[]
  /** Idle autosave delay; 0 = only kimo_save writes. */
  autosaveMs: number
  client?: string
  includeStubs?: boolean
  stdin?: Readable
  stdout?: Writable
  log?: (line: string) => void
}

// ---------------------------------------------------------------------------------------------
// Builder 2's runtime-neutral host + real handlers (`@kimo/mcp-server` src/handlers/) over the
// Node platform. The host owns leases, atomic saves, idle autosave, and the exit flush with
// recovery. KIMO_MCP_HOST=fallback selects the stopgap in ./fallback.ts (debugging only;
// it can be deleted once the integrated host has shipped).
// ---------------------------------------------------------------------------------------------

export interface HeadlessRuntime {
  host: DocumentHost
  handlers: ToolHandlers
  impl: "memory-host" | "fallback"
  /** True when the host runs its own idle autosave and exit flush. */
  ownsLifecycle: boolean
  /** Per-client connection of the host runtime (memory host): origin, context, targets. */
  connect?: (identity: Omit<ClientIdentity, "session">) => McpConnection
  /** Flushes (memory host) and releases leases. */
  dispose(): Promise<void>
}

export function createHeadlessRuntime(
  platform: KimoPlatform,
  policy: ClientPolicy,
  o: { autosaveMs: number; env?: Record<string, string | undefined> },
): HeadlessRuntime {
  const env = o.env ?? process.env
  if (env.KIMO_MCP_HOST === "fallback") {
    const host = createFallbackHost(platform)
    return {
      host,
      handlers: createFallbackHandlers(host),
      impl: "fallback",
      ownsLifecycle: false,
      dispose: () => host.dispose(),
    }
  }
  const host = createMemoryDocumentHost({
    platform,
    kind: "headless",
    autosaveMs: o.autosaveMs,
    canonicalPath: async (p) => canonical(p),
    clientPolicy: policy,
    approvals: "deny",
    validate: validateInput,
  })
  return {
    host,
    handlers: createToolHandlers(host, { version: CLI_VERSION, windows: () => 0 }),
    impl: "memory-host",
    ownsLifecycle: true,
    connect: (identity) => host.runtime.connect(identity, { policy }),
    dispose: () => host.dispose(),
  }
}

// --- Policy & targets ----------------------------------------------------------------------------

/** Canonicalizes the literal prefix of a glob (so `/var/…/**` matches `/private/var/…`). */
export function canonicalGlob(glob: string): string {
  const i = glob.search(/[*?[]/)
  if (i < 0) return canonical(glob)
  const cut = glob.lastIndexOf("/", i)
  if (cut <= 0) return glob
  return `${canonical(glob.slice(0, cut))}${glob.slice(cut)}`
}

export function headlessPolicy(o: Pick<HeadlessOptions, "level" | "files" | "cwd">): ClientPolicy {
  const files = (o.files.length ? o.files : HEADLESS_DEFAULTS(canonical(o.cwd)).allow).map(
    canonicalGlob,
  )
  return { ...HEADLESS_POLICY, level: o.level, files }
}

export function makeTargets(host: DocumentHost) {
  return async (def: { name: string }, input: Record<string, unknown>): Promise<CallTargets> => {
    const raw =
      typeof input.path === "string" && def.name !== "kimo_read_docs"
        ? input.path
        : def.name === "kimo_export" && typeof input.outDir === "string"
          ? input.outDir
          : undefined
    if (raw && !raw.startsWith("untitled:")) {
      const path = await host.canonicalPath(raw)
      return { path, pathAlreadyOpen: host.list().some((d) => d.ref.path === path) }
    }
    if (typeof input.docId === "string") {
      const d = host.get(input.docId)
      if (d.ok) return { path: d.value.ref.path, pathAlreadyOpen: true }
    }
    return {}
  }
}

// --- Autosave ------------------------------------------------------------------------------------

/**
 * Saves every dirty writable document `delayMs` after its last change (ADR 0013 §8, same 2 s as
 * the app). Works over any DocumentHost: it watches the stores the host lists.
 */
export function startAutosave(host: DocumentHost, delayMs: number, log: (l: string) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const watched = new Map<string, () => void>()
  const schedule = (path: string) => {
    if (delayMs <= 0) return
    const t = timers.get(path)
    if (t) clearTimeout(t)
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path)
        const doc = host.list().find((d) => d.ref.path === path)
        if (!doc?.ref.dirty || doc.ref.readOnly) return
        void host.save(doc.ref.id).then((r) => {
          if (!r.ok) log(`autosave failed for ${path}: ${r.error.code} ${r.error.message}`)
        })
      }, delayMs),
    )
  }
  const sync = () => {
    const live = new Set<string>()
    for (const d of host.list()) {
      live.add(d.ref.path)
      if (!watched.has(d.ref.path)) {
        const path = d.ref.path
        watched.set(
          path,
          d.store.onChange((c) => {
            if (c.cause !== "load") schedule(path)
          }),
        )
      }
    }
    for (const [p, off] of watched)
      if (!live.has(p)) {
        off()
        watched.delete(p)
      }
  }
  const poll = setInterval(sync, 250)
  poll.unref?.()
  return {
    /** Re-scan the host (call after each tool call so new documents are watched at once). */
    sync,
    stop() {
      clearInterval(poll)
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      for (const off of watched.values()) off()
      watched.clear()
    },
  }
}

/** Final flush on exit: save dirty docs, else write a recovery file. */
export async function flushOnExit(
  host: DocumentHost,
  kimoHome: string,
  log: (l: string) => void,
): Promise<void> {
  for (const d of host.list()) {
    if (!d.ref.dirty || d.ref.readOnly) continue
    const r = await host.save(d.ref.id)
    if (r.ok) continue
    try {
      const dir = join(kimoHome, "recovery")
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const file = join(dir, `${pathHash(d.ref.path)}.kimo`)
      writeFileSync(file, serialize(d.store.toDocument()), { mode: 0o600 })
      log(`could not save ${d.ref.path} (${r.error.code}); unsaved edits kept in ${file}`)
    } catch (e) {
      log(`could not save or recover ${d.ref.path}: ${(e as Error).message}`)
    }
  }
}

// --- Resources -----------------------------------------------------------------------------------

/**
 * The document-independent resources (ADR 0013 §2): the guides as `kimo://docs/{path}` (same
 * text as kimo_read_docs) and the format schema `kimo://schema/1.0`.
 */
export function registerStaticResources(server: ReturnType<typeof createKimoMcpServer>): void {
  for (const [path, g] of Object.entries(GUIDES)) {
    const uri = `kimo://docs/${path}`
    server.registerResource(
      `kimo-docs-${path.replace("/", "-")}`,
      uri,
      { title: g.title, description: `Kimo agent guide: ${g.title}`, mimeType: "text/markdown" },
      async () => ({ contents: [{ uri, mimeType: "text/markdown", text: g.markdown }] }),
    )
  }
  server.registerResource(
    "kimo-schema",
    "kimo://schema/1.0",
    {
      title: ".kimo JSON Schema",
      description: "The normative JSON Schema (draft 2020-12) of the .kimo format, version 1.0.",
      mimeType: "application/schema+json",
    },
    async () => ({
      contents: [
        { uri: "kimo://schema/1.0", mimeType: "application/schema+json", text: jsonSchemaText() },
      ],
    }),
  )
}

// --- Server --------------------------------------------------------------------------------------

const session = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0")

/** Runs headless until stdin closes; resolves to the exit code. */
export async function runHeadless(o: HeadlessOptions): Promise<number> {
  const log = o.log ?? ((l: string) => process.stderr.write(`kimo mcp: ${l}\n`))
  const platform = createNodePlatform({ kimoHome: o.kimoHome, appVersion: CLI_VERSION })
  const policy = headlessPolicy(o)
  const runtime = createHeadlessRuntime(platform, policy, { autosaveMs: o.autosaveMs })
  const autosave = startAutosave(runtime.host, runtime.ownsLifecycle ? 0 : o.autosaveMs, log)
  const controller = new AbortController()

  // One connection per process, created lazily on the first call (after initialize, so the
  // MCP clientInfo is known). Memory host: the host runtime's connection (origin, policy,
  // activity, presence, targets). Fallback: a plain context.
  const serverRef: { current: ReturnType<typeof createKimoMcpServer> | null } = { current: null }
  let identity: ClientIdentity | null = null
  const identityOf = (): Omit<ClientIdentity, "session"> => {
    const info = serverRef.current?.server.getClientVersion()
    const client = clientSlug(o.client ?? info?.name ?? "client")
    return {
      client,
      label: info?.name ?? client,
      ...(info?.version ? { version: info.version } : {}),
      transport: "stdio-headless",
    }
  }
  let conn: McpConnection | null = null
  let ctx: ToolContext | null = null
  const fallbackTargets = makeTargets(runtime.host)
  const connection = (): McpConnection | null => {
    if (!runtime.connect) return null
    conn ??= runtime.connect(identityOf())
    return conn
  }
  const context = (): ToolContext => {
    const c = connection()
    if (c) return c.context()
    if (ctx) return ctx
    identity = { ...identityOf(), session: session() }
    ctx = {
      identity,
      origin: originOf(identity),
      policy,
      allowances: emptyAllowances(),
      host: runtime.host,
      requestApproval: async () => "deny",
      recordActivity: () => {},
      signal: controller.signal,
      now: () => Date.now(),
      newId: () => Math.random().toString(36).slice(2, 12),
    }
    return ctx
  }
  const opened = new Set<string>()
  const handlers = new Proxy(runtime.handlers, {
    get(t, name) {
      return async (input: Record<string, unknown>, c: ToolContext) => {
        const live = connection()
        const h = Reflect.get(
          live ? connectionHandlers(live) : t,
          name,
        ) as ToolHandlers[keyof ToolHandlers]
        try {
          const out = await h(input, c)
          // stderr names every file this process opens (the agent host's log shows which).
          const doc = out.result.ok ? out.result.doc : undefined
          if (
            (name === "kimo_open" || name === "kimo_create") &&
            doc?.path &&
            !opened.has(doc.path)
          ) {
            opened.add(doc.path)
            log(`headless: ${name === "kimo_create" ? "created" : "opened"} ${doc.path}`)
          }
          return out
        } finally {
          autosave.sync()
        }
      }
    },
  })
  const server = createKimoMcpServer({
    host: "headless",
    includeStubs: o.includeStubs ?? false,
    version: CLI_VERSION,
    handlers,
    context,
    targets: (def, input, c) => {
      const live = connection()
      return live ? live.targets(def, input, c) : fallbackTargets(def, input)
    },
  })
  serverRef.current = server
  registerStaticResources(server)
  const transport = new StdioServerTransport(o.stdin ?? process.stdin, o.stdout ?? process.stdout)
  log(
    `headless${runtime.impl === "fallback" ? " (fallback host)" : ""}, files: ${policy.files.join(", ")}, level ${policy.level}`,
  )

  await server.connect(transport)
  const ppid = process.ppid
  let parentTimer: ReturnType<typeof setInterval> | undefined
  await new Promise<void>((resolve) => {
    // Chain onto the SDK's handler (connect() installs its own).
    const prev = transport.onclose
    transport.onclose = () => {
      prev?.()
      resolve()
    }
    o.stdin?.once("end", () => resolve())
    process.once("SIGTERM", () => resolve())
    process.once("SIGINT", () => resolve())
    // No zombies: exit when the agent host disappears even if stdin stays open.
    parentTimer = setInterval(() => {
      if (process.ppid !== ppid) resolve()
    }, 2_000)
    parentTimer.unref?.()
  })
  clearInterval(parentTimer)
  controller.abort()
  ;(conn as McpConnection | null)?.close()
  autosave.stop()
  if (!runtime.ownsLifecycle) await flushOnExit(runtime.host, o.kimoHome, log)
  await runtime.dispose()
  await server.close().catch(() => {})
  return 0
}
