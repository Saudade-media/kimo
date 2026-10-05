/**
 * kimo_script sessions (ADR 0013 addendum 7): a JavaScript snippet runs in QuickJS (WebAssembly,
 * its own heap) and its API compiles to kimo_apply_ops wire ops. The script never touches the
 * document: each API call appends wire ops with generated `@key`s, which then go through the
 * kimo_apply_ops path (validation, scopes, approvals, batch limit, op log, one undo step).
 *
 * The sandbox sees only the API below: no host objects, no I/O, no network, no timers, no
 * modules. Arguments cross the boundary as JSON text and results come back as JSON text, so no
 * host object, prototype or function is ever reachable from the script. Memory, stack, time per
 * run, ops, prints and argument sizes are bounded.
 *
 * Deterministic: keys are a counter, Math.random is seeded, Date is fixed at 0, so running the
 * same code twice (statement by statement while streaming, then whole) yields the same ops.
 */
import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from "quickjs-emscripten-core"
import type { WireOp } from "../ops"

/** The document as it was when the script started: node id → its fields (Get reads only this). */
export type WorldData = Record<string, Record<string, unknown>>

/**
 * Globals a script left for the agent's next scripts: top-level names → a JSON value (layer refs
 * already turned into ids) or a function's source. Restored before the next script runs.
 */
export type Carry = Record<string, { json: string } | { fn: string }>

export interface ScriptLimits {
  /** QuickJS heap. */
  memoryBytes: number
  stackBytes: number
  /** Wall time of one run (a whole script, or one streamed batch of statements). */
  timeMs: number
  /** Wall time of all runs of a session (a streamed script runs many). */
  totalTimeMs: number
  /** Wire ops per script. */
  maxOps: number
  maxPrints: number
  maxPrintChars: number
  /** JSON size of one API call's arguments. */
  maxArgBytes: number
  /** Nesting depth of one API call's arguments. */
  maxArgDepth: number
  /** JSON size of the carried globals. */
  maxCarryBytes: number
}

export const DEFAULT_LIMITS: ScriptLimits = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  timeMs: 3_000,
  totalTimeMs: 6_000,
  maxOps: 2_000,
  maxPrints: 100,
  maxPrintChars: 20_000,
  maxArgBytes: 256 * 1024,
  maxArgDepth: 64,
  maxCarryBytes: 64 * 1024,
}

/** Max carried names. */
export const MAX_CARRY_NAMES = 200

export type RunResult = { ok: true } | { ok: false; message: string; line?: number }

/** What one run added (ops since the previous run of the session). */
export interface RunOutput {
  result: RunResult
  ops: WireOp[]
  lines: number[]
  prints: string[]
  /** key → layer name of the inserts this run added. */
  names: [string, string][]
}

const PRELUDE = `"use strict";
(() => {
  const host = globalThis.__kimo;
  delete globalThis.__kimo;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const call = (cmd, args) => {
    const r = parse(host(cmd, stringify(args), new Error().stack));
    if (r.e !== undefined) throw new Error(r.e);
    return r.v;
  };
  const def = (name, fn) =>
    Object.defineProperty(globalThis, name, { value: fn, writable: false, configurable: false });
  def("Insert", (parent, node, index) => call("insert", [parent, node, index]));
  def("Update", (id, set, unset) => call("update", [id, set, unset]));
  def("Move", (id, parent, index) => call("move", [id, parent, index]));
  def("Delete", (id) => call("delete", [id]));
  def("Copy", (id, parent, set) => call("copy", [id, parent, set]));
  def("Instantiate", (of, parent, fields) => call("instantiate", [of, parent, fields]));
  def("Op", (op) => call("op", [op]));
  def("Get", (id) => call("get", [id]));
  def("Children", (id) => call("children", [id]));
  def("Print", (...a) => call("print", a.map((x) => (typeof x === "string" ? x : stringify(x)))));
  let seed = 0x2f6b1d;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const D = Date;
  const FixedDate = function () { return new D(0); };
  FixedDate.now = () => 0;
  FixedDate.UTC = D.UTC;
  globalThis.Date = FixedDate;
})();
`

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

class ApiError extends Error {}

/** Clock for run deadlines (host side, never visible to the script). */
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

export class ScriptSession {
  readonly ops: WireOp[] = []
  /** Script line of each op (1-based; 0 unknown). */
  readonly lines: number[] = []
  readonly prints: string[] = []
  /** key → layer name, for the name table of the result. */
  readonly names = new Map<string, string>()
  private seq = 0
  private printChars = 0
  private readonly rt: QuickJSRuntime
  private readonly vm: QuickJSContext
  private disposed = false
  private readonly mark = { ops: 0, prints: 0, names: 0 }
  /** Wall time spent in runs so far. */
  private spent = 0

  constructor(
    m: QuickJSWASMModule,
    private readonly world: WorldData,
    carry: Carry = {},
    readonly limits: ScriptLimits = DEFAULT_LIMITS,
    /** Page of top-level layers that name none (the editor's active page). */
    private readonly page?: string,
  ) {
    this.rt = m.newRuntime()
    this.rt.setMemoryLimit(limits.memoryBytes)
    this.rt.setMaxStackSize(limits.stackBytes)
    this.vm = this.rt.newContext()
    const fn = this.vm.newFunction("__kimo", (cmd, args, stack) => {
      let r: { v?: unknown; e?: string }
      try {
        const text = this.vm.getString(args)
        if (text.length > limits.maxArgBytes)
          throw new ApiError(`One call's arguments are over ${limits.maxArgBytes} bytes.`)
        if (jsonDepth(text) > limits.maxArgDepth)
          throw new ApiError(`One call's arguments nest deeper than ${limits.maxArgDepth} levels.`)
        const a = JSON.parse(text) as unknown[]
        r = { v: this.dispatch(this.vm.getString(cmd), a, lineOf(this.vm.getString(stack))) }
      } catch (e) {
        r = { e: e instanceof ApiError ? e.message : `Internal error: ${String(e)}` }
      }
      return this.vm.newString(JSON.stringify(r))
    })
    this.vm.setProp(this.vm.global, "__kimo", fn)
    fn.dispose()
    this.evalOrThrow(PRELUDE, "prelude.js")
    this.restore(carry)
  }

  /** Runs code (a whole script, or the next complete statements of a streamed one). */
  run(code: string, firstLine = 1): RunOutput {
    let result: RunResult
    if (this.disposed) result = { ok: false, message: "The script session is closed." }
    else {
      const src = firstLine > 1 ? "\n".repeat(firstLine - 1) + code : code
      const start = clock()
      const deadline = start + Math.min(this.limits.timeMs, this.limits.totalTimeMs - this.spent)
      let timedOut = false
      this.rt.setInterruptHandler(() => {
        timedOut = clock() > deadline
        return timedOut
      })
      const r = this.vm.evalCode(src, "script.js")
      this.rt.removeInterruptHandler()
      this.spent += clock() - start
      if (r.error) {
        result = { ok: false, ...this.describe(r.error, timedOut) }
        r.error.dispose()
      } else {
        r.value.dispose()
        result = { ok: true }
      }
    }
    const out: RunOutput = {
      result,
      ops: this.ops.slice(this.mark.ops),
      lines: this.lines.slice(this.mark.ops),
      prints: this.prints.slice(this.mark.prints),
      names: [...this.names].slice(this.mark.names),
    }
    this.mark.ops = this.ops.length
    this.mark.prints = this.prints.length
    this.mark.names = this.names.size
    return out
  }

  /**
   * The globals to carry to the agent's next script: `names` (top-level declarations of the
   * scripts so far) whose values are JSON data or functions, with `@key` refs replaced by ids.
   */
  carry(names: readonly string[], refs: Readonly<Record<string, string>>): Carry {
    if (this.disposed) return {}
    const list = [...new Set(names)]
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
      .slice(0, MAX_CARRY_NAMES)
    if (!list.length) return {}
    // Runs in the sandbox (bounded like a run): reads each name, typeof-guarded.
    const reader = `(() => { const fnSource = (f) => Function.prototype.toString.call(f); const out = {}; ${list
      .map(
        (n) =>
          `try { if (typeof ${n} === "function") out[${JSON.stringify(n)}] = { fn: fnSource(${n}) }; else if (typeof ${n} !== "undefined") out[${JSON.stringify(n)}] = { json: JSON.stringify(${n}) }; } catch (e) {}`,
      )
      .join(" ")} return JSON.stringify(out); })()`
    const deadline = clock() + this.limits.timeMs
    this.rt.setInterruptHandler(() => clock() > deadline)
    const r = this.vm.evalCode(reader, "carry.js")
    this.rt.removeInterruptHandler()
    if (r.error) {
      r.error.dispose()
      return {}
    }
    const text = this.vm.getString(r.value)
    r.value.dispose()
    let raw: Record<string, { fn?: unknown; json?: unknown }>
    try {
      raw = JSON.parse(text)
    } catch {
      return {}
    }
    const out: Carry = {}
    let size = 0
    for (const [name, v] of Object.entries(raw)) {
      let entry: Carry[string] | null = null
      if (typeof v.fn === "string" && !v.fn.includes("[native code]")) entry = { fn: v.fn }
      else if (typeof v.json === "string") entry = { json: resolveRefs(v.json, refs) }
      if (!entry) continue
      const n = name.length + ("fn" in entry ? entry.fn.length : entry.json.length)
      if (size + n > this.limits.maxCarryBytes) continue
      size += n
      out[name] = entry
    }
    return out
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.vm.dispose()
    this.rt.dispose()
  }

  private evalOrThrow(code: string, file: string): void {
    const p = this.vm.evalCode(code, file)
    if (p.error) {
      const msg = JSON.stringify(this.vm.dump(p.error))
      p.error.dispose()
      throw new Error(`${file}: ${msg}`)
    }
    p.value.dispose()
  }

  /** Carried globals: configurable properties, so a script may redeclare the same names. */
  private restore(carry: Carry): void {
    for (const [name, v] of Object.entries(carry)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
      const value = "fn" in v ? `(${v.fn})` : `JSON.parse(${JSON.stringify(v.json)})`
      const code = `Object.defineProperty(globalThis, ${JSON.stringify(name)}, { value: ${value}, writable: true, configurable: true, enumerable: false });`
      // Restored code is the agent's own (sandboxed) source: bounded like a run.
      const deadline = clock() + this.limits.timeMs
      this.rt.setInterruptHandler(() => clock() > deadline)
      const r = this.vm.evalCode(code, "carry.js")
      this.rt.removeInterruptHandler()
      if (r.error) r.error.dispose()
      else r.value.dispose()
    }
  }

  private describe(h: QuickJSHandle, timedOut: boolean): { message: string; line?: number } {
    let e: unknown
    try {
      e = this.vm.dump(h)
    } catch {
      e = "Error"
    }
    if (timedOut)
      return {
        message:
          this.spent >= this.limits.totalTimeMs
            ? `The script ran longer than ${this.limits.totalTimeMs} ms in all.`
            : `The script ran longer than ${this.limits.timeMs} ms.`,
      }
    if (isObj(e)) {
      const msg = typeof e.message === "string" ? e.message : String(e)
      const name = typeof e.name === "string" ? e.name : "Error"
      const line = lineOf(typeof e.stack === "string" ? e.stack : "")
      const text =
        /out of memory/i.test(msg) || name === "InternalError"
          ? `${name}: ${msg} (limits: ${Math.round(this.limits.memoryBytes / 1048576)} MB memory, ${Math.round(this.limits.stackBytes / 1024)} KB stack)`
          : `${name}: ${msg}`
      return line ? { message: text, line } : { message: text }
    }
    return { message: typeof e === "string" ? e : "The script threw a non-error value." }
  }

  /** Own entries only: "__proto__" and friends are not nodes. */
  private node(id: string): Record<string, unknown> | null {
    return Object.hasOwn(this.world, id) ? (this.world[id] ?? null) : null
  }

  private key(): string {
    return `s${++this.seq}`
  }

  private push(op: Record<string, unknown>, line: number): void {
    for (const o of this.page && op.parent === "root" ? onPage(op, this.page) : [op]) {
      if (this.ops.length >= this.limits.maxOps)
        throw new ApiError(`More than ${this.limits.maxOps} ops in one script.`)
      this.ops.push(o as WireOp)
      this.lines.push(line)
    }
  }

  private dispatch(cmd: string, a: unknown[], line: number): unknown {
    if (!Array.isArray(a)) throw new ApiError("Bad call.")
    switch (cmd) {
      case "insert": {
        const [parent, node, index] = a
        return this.insert(ref(parent, "Insert(parent, …)"), node, index, line, 0)
      }
      case "update": {
        const [id, set, unset] = a
        if (set !== undefined && set !== null && !isObj(set))
          throw new ApiError("Update(id, set, unset?): set must be an object.")
        if (unset !== undefined && unset !== null && !Array.isArray(unset))
          throw new ApiError("Update(id, set, unset?): unset must be an array of field names.")
        this.push(
          {
            op: "update",
            id: ref(id, "Update(id, …)"),
            ...(isObj(set) ? { set } : {}),
            ...(Array.isArray(unset) ? { unset } : {}),
          },
          line,
        )
        return undefined
      }
      case "move": {
        const [id, parent, index] = a
        this.push(
          {
            op: "move",
            id: ref(id, "Move(id, …)"),
            parent: ref(parent, "Move(id, parent)"),
            ...(typeof index === "number" ? { index } : {}),
          },
          line,
        )
        return undefined
      }
      case "delete":
        this.push({ op: "delete", id: ref(a[0], "Delete(id)") }, line)
        return undefined
      case "copy": {
        const [id, parent, set] = a
        const key = this.key()
        this.push(
          {
            op: "copy",
            id: ref(id, "Copy(id, …)"),
            key,
            parent: ref(parent, "Copy(id, parent)"),
            ...(isObj(set) ? { set } : {}),
          },
          line,
        )
        return `@${key}`
      }
      case "instantiate": {
        const [of, parent, fields] = a
        const key = this.key()
        const extra = isObj(fields) ? fields : {}
        this.push(
          {
            ...extra,
            op: "instantiate",
            of: ref(of, "Instantiate(component, …)"),
            key,
            parent: ref(parent, "Instantiate(component, parent)"),
          },
          line,
        )
        if (typeof extra.name === "string") this.names.set(key, extra.name)
        return `@${key}`
      }
      case "op": {
        const [op] = a
        if (!isObj(op) || typeof op.op !== "string")
          throw new ApiError("Op(op): give one kimo_apply_ops op object.")
        const creates =
          op.op === "insert" ||
          op.op === "copy" ||
          op.op === "instantiate" ||
          (op.op === "page" && op.action === "add")
        const key = creates ? (typeof op.key === "string" ? op.key : this.key()) : undefined
        this.push(key ? { ...op, key } : op, line)
        const node = op.node as Record<string, unknown> | undefined
        if (key && isObj(node) && typeof node.name === "string") this.names.set(key, node.name)
        return key ? `@${key}` : undefined
      }
      case "get": {
        const id = a[0]
        if (typeof id !== "string") throw new ApiError("Get(id): id must be a string.")
        if (id.startsWith("@"))
          throw new ApiError(
            "Get reads the document as it was before the script, not its new layers.",
          )
        return this.node(id)
      }
      case "children": {
        const id = a[0]
        if (id !== "root" && typeof id !== "string")
          throw new ApiError('Children(id): id must be a node id or "root".')
        const ids =
          id === "root"
            ? Object.values(this.world)
                .filter((n) => n.parent === null)
                .map((n) => n.id)
            : ((this.node(id as string)?.children as string[] | undefined) ?? [])
        return ids.map((c) => this.node(String(c))).filter(Boolean)
      }
      case "print": {
        if (this.prints.length >= this.limits.maxPrints) return undefined
        const text = a.map(String).join(" ")
        const room = this.limits.maxPrintChars - this.printChars
        if (room <= 0) return undefined
        const t = text.length > room ? `${text.slice(0, room)}…` : text
        this.printChars += t.length
        this.prints.push(t)
        return undefined
      }
      default:
        throw new ApiError(`Unknown call ${cmd}.`)
    }
  }

  private insert(
    parent: string,
    node: unknown,
    index: unknown,
    line: number,
    depth: number,
  ): string {
    if (!isObj(node)) throw new ApiError("Insert(parent, node): node must be an object.")
    if (depth > 64) throw new ApiError("Insert: children nested deeper than 64 levels.")
    const { children, ...body } = node
    if (children !== undefined && !Array.isArray(children))
      throw new ApiError("Insert: children must be an array of nodes.")
    const key = this.key()
    this.push(
      {
        op: "insert",
        key,
        parent,
        ...(typeof index === "number" ? { index } : {}),
        node: body,
      },
      line,
    )
    if (typeof body.name === "string") this.names.set(key, body.name)
    for (const c of (children ?? []) as unknown[])
      this.insert(`@${key}`, c, undefined, line, depth + 1)
    return `@${key}`
  }
}

/** A top-level op on `page` unless it names one (the rules of the editor's page defaults). */
function onPage(op: Record<string, unknown>, page: string): Record<string, unknown>[] {
  switch (op.op) {
    case "insert": {
      const node = isObj(op.node) ? op.node : {}
      return [node.page === undefined ? { ...op, node: { ...node, page } } : op]
    }
    case "copy": {
      const set = isObj(op.set) ? op.set : {}
      return [set.page === undefined ? { ...op, set: { ...set, page } } : op]
    }
    case "move":
      return [op, { op: "update", id: op.id, set: { page } }]
    case "instantiate":
      return typeof op.key === "string"
        ? [op, { op: "update", id: `@${op.key}`, set: { page } }]
        : [op]
    default:
      return [op]
  }
}

function ref(v: unknown, where: string): string {
  if (typeof v !== "string" || !v)
    throw new ApiError(`${where}: give a node id, a ref an earlier call returned, or "root".`)
  return v
}

/** Max bracket nesting of a JSON text (strings skipped). */
export function jsonDepth(text: string): number {
  let depth = 0
  let max = 0
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (inStr) {
      if (c === 92) i++
      else if (c === 34) inStr = false
    } else if (c === 34) inStr = true
    else if (c === 123 || c === 91) max = Math.max(max, ++depth)
    else if (c === 125 || c === 93) depth--
  }
  return max
}

/** Line of the innermost script frame of a QuickJS stack. */
function lineOf(stack: string): number {
  const m = /script\.js:(\d+)/.exec(stack)
  return m ? Number(m[1]) : 0
}

/**
 * `"@s3"` / `"@s3/<id>"` strings of a JSON text → the ids they were given; a ref that named
 * nothing becomes null (the next script's keys restart at s1 and must not alias it).
 */
export function resolveRefs(json: string, refs: Readonly<Record<string, string>>): string {
  return json.replace(/"@(s\d+(?:\/[A-Za-z0-9]+)?)"/g, (_m, k: string) =>
    refs[k] ? JSON.stringify(refs[k]) : "null",
  )
}
