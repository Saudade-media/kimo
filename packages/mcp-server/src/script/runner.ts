/**
 * Where kimo_script sessions run. In a browser or the desktop document host (a webview) they run
 * in a Web Worker, so a long script never blocks the editor and a stuck one is killed with the
 * worker; headless (Bun / Node: the CLI, tests) they run in-process. Either way the sandbox is
 * QuickJS with its own heap, the deadline interrupt and the limits of {@link ScriptLimits}.
 */
import type { QuickJSWASMModule } from "quickjs-emscripten-core"
import {
  type Carry,
  DEFAULT_LIMITS,
  type RunOutput,
  type ScriptLimits,
  ScriptSession,
  type WorldData,
} from "./session"

export interface RunnerSession {
  run(code: string, firstLine?: number): Promise<RunOutput>
  carry(names: readonly string[], refs: Readonly<Record<string, string>>): Promise<Carry>
  dispose(): void
}

export interface ScriptRunner {
  open(
    world: WorldData,
    carry?: Carry,
    limits?: ScriptLimits,
    page?: string,
  ): Promise<RunnerSession>
  dispose?(): void
}

let nodeModule: Promise<QuickJSWASMModule> | null = null
/** The Bun / Node build of QuickJS; a variable so browser bundles leave it out (they use the worker). */
const NODE_VARIANT = "@jitl/quickjs-singlefile-mjs-release-sync"
/** QuickJS for Bun / Node (wasm embedded in the module). */
function loadNodeQuickJS(): Promise<QuickJSWASMModule> {
  nodeModule ??= Promise.all([
    import("quickjs-emscripten-core"),
    import(/* @vite-ignore */ NODE_VARIANT) as Promise<{
      default: Parameters<
        typeof import("quickjs-emscripten-core").newQuickJSWASMModuleFromVariant
      >[0]
    }>,
  ]).then(([core, variant]) => core.newQuickJSWASMModuleFromVariant(variant.default))
  return nodeModule
}

/** Sessions in this thread. */
export function inProcessRunner(
  load: () => Promise<QuickJSWASMModule> = loadNodeQuickJS,
): ScriptRunner {
  return {
    async open(world, carry = {}, limits = DEFAULT_LIMITS, page) {
      const s = new ScriptSession(await load(), world, carry, limits, page)
      return {
        run: async (code, firstLine) => s.run(code, firstLine),
        carry: async (names, refs) => s.carry(names, refs),
        dispose: () => s.dispose(),
      }
    },
  }
}

/** Messages to the worker (`worker.ts`). */
export type WorkerRequest =
  | {
      t: "open"
      id: number
      sid: number
      world: WorldData
      carry: Carry
      limits: ScriptLimits
      page?: string
    }
  | { t: "run"; id: number; sid: number; code: string; firstLine: number }
  | { t: "carry"; id: number; sid: number; names: string[]; refs: Record<string, string> }
  | { t: "close"; sid: number }

export type WorkerReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string }

/** Grace beyond a run's own deadline before the worker is presumed stuck and terminated. */
const WORKER_GRACE_MS = 2_000

interface WorkerLike {
  postMessage(m: unknown): void
  terminate(): void
  onmessage: ((e: { data: unknown }) => void) | null
  onerror: ((e: unknown) => void) | null
}

/**
 * Sessions in a Web Worker. A run that outlives its deadline (plus a grace) terminates the
 * worker: its sessions fail and the next open starts a fresh one.
 */
export function workerRunner(create: () => WorkerLike): ScriptRunner {
  let worker: WorkerLike | null = null
  let seq = 0
  let sids = 0
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  /** Sessions of the current worker. */
  let live = new Set<number>()
  const kill = (why: string) => {
    worker?.terminate()
    worker = null
    live = new Set()
    for (const p of pending.values()) p.reject(new Error(why))
    pending.clear()
  }
  const ensure = (): WorkerLike => {
    if (worker) return worker
    const w = create()
    w.onmessage = (e) => {
      const r = e.data as WorkerReply
      const p = pending.get(r.id)
      if (!p) return
      pending.delete(r.id)
      if (r.ok) p.resolve(r.value)
      else p.reject(new Error(r.message))
    }
    w.onerror = () => kill("The script worker failed.")
    worker = w
    return w
  }
  type Body = WorkerRequest extends infer R
    ? R extends { id: number }
      ? Omit<R, "id">
      : never
    : never
  const request = <T>(m: Body, timeoutMs: number) =>
    new Promise<T>((resolve, reject) => {
      const w = ensure()
      const id = ++seq
      const timer = setTimeout(() => {
        if (!pending.has(id)) return
        kill("The script did not stop at its deadline; its worker was stopped.")
      }, timeoutMs)
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      w.postMessage({ ...m, id })
    })
  return {
    async open(world, carry = {}, limits = DEFAULT_LIMITS, page) {
      const sid = ++sids
      await request(
        { t: "open", sid, world, carry, limits, ...(page ? { page } : {}) },
        limits.timeMs + 10_000,
      )
      live.add(sid)
      const alive = () => {
        if (!live.has(sid)) throw new Error("The script worker was stopped.")
      }
      return {
        async run(code, firstLine = 1) {
          try {
            alive()
            return await request<RunOutput>(
              { t: "run", sid, code, firstLine },
              limits.timeMs + WORKER_GRACE_MS,
            )
          } catch (e) {
            return {
              result: { ok: false, message: e instanceof Error ? e.message : String(e) },
              ops: [],
              lines: [],
              prints: [],
              names: [],
            }
          }
        },
        async carry(names, refs) {
          try {
            alive()
            return await request<Carry>(
              { t: "carry", sid, names: [...names], refs: { ...refs } },
              limits.timeMs + WORKER_GRACE_MS,
            )
          } catch {
            return {}
          }
        },
        dispose() {
          if (!live.delete(sid)) return
          worker?.postMessage({ t: "close", sid })
        },
      }
    },
    dispose: () => kill("The script runner was disposed."),
  }
}

/** The worker in a browser / webview (Vite bundles `worker.ts`), else in-process. */
export function defaultScriptRunner(): ScriptRunner {
  const g = globalThis as { Worker?: unknown; document?: unknown }
  if (typeof g.Worker === "function" && typeof g.document === "object")
    return workerRunner(
      () =>
        new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
          name: "kimo-script",
        }) as unknown as WorkerLike,
    )
  return inProcessRunner()
}
