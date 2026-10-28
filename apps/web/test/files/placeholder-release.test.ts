/**
 * An agent flag never outlives its agent: the serialized document and the open/close/disconnect
 * paths of `editor/placeholder-release.ts` (the user's "layer stays blocked by an agent that is
 * not working anymore" bug: a bare `placeholder: true` left by a CLI turn counted as live forever).
 */
import { describe, expect, test } from "bun:test"
import { type KimoDocument, parse, serialize } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument, type Op } from "@kimo/editor-state"
import {
  releaseOnClose,
  releaseOnOpen,
  releaseOnUnmount,
  stopAgentTurn,
  watchMcpClients,
  watchTurns,
} from "../../src/editor/placeholder-release"
import { FILE, setup } from "../session-helpers"

const frame = (extra: Record<string, unknown>, order: string) => ({
  type: "frame" as const,
  parent: null,
  order,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  ...extra,
})

function docWithFlags(): KimoDocument {
  const d = createEmptyDocument("Flags")
  const nodes = d.nodes as unknown as Record<string, unknown>
  nodes.Bare000001 = frame({ name: "Bare", placeholder: true }, "a0")
  nodes.Dead000001 = frame({ name: "Dead", placeholder: { by: "agent:kimo.old.0" } }, "a1")
  nodes.Mcp0000001 = frame({ name: "Mcp", placeholder: { by: "mcp:claude-code.k3x9qa" } }, "a2")
  nodes.Plain00001 = frame({ name: "Plain" }, "a3")
  nodes.Child00001 = {
    type: "rect" as const,
    parent: "Bare000001",
    order: "a0",
    name: "Child",
    w: 10,
    h: 10,
  }
  return d
}

const flagged = (store: DocStore) =>
  store
    .nodeIds()
    .filter((id) => (store.getNode(id) as { placeholder?: unknown })?.placeholder !== undefined)
    .sort()

function target(store: DocStore) {
  return {
    store,
    apply: (ops: Op | readonly Op[], label?: string) =>
      store.apply(ops, { origin: "user", ...(label ? { label } : {}) }).ok,
  }
}

/** A tiny observable standing in for a controller. */
function emitter<S>(initial: S) {
  const ls = new Set<(s: S) => void>()
  let state = initial
  return {
    get state() {
      return state
    },
    set(s: S) {
      state = s
      for (const l of [...ls]) l(s)
    },
    subscribe(l: (s: S) => void) {
      ls.add(l)
      return () => ls.delete(l)
    },
  }
}

const conns = (...origins: string[]) => ({ connections: origins.map((origin) => ({ origin })) })

describe("release on open", () => {
  test("every flag nobody owns goes, leaves no undo step, and the saved text has none", () => {
    const store = importDocument(docWithFlags())
    expect(flagged(store)).toEqual(["Bare000001", "Dead000001", "Mcp0000001"])
    const released = releaseOnOpen(target(store))
    expect(released.sort()).toEqual(["Bare000001", "Dead000001", "Mcp0000001"])
    expect(flagged(store)).toEqual([])
    expect(store.canUndo("user")).toBe(false)
    const text = serialize(store.toDocument())
    expect(text.includes("placeholder")).toBe(false)
    // The frames and their content stay.
    expect(store.getNode("Child00001")).toBeDefined()
    expect(store.getNode("Bare000001")).toBeDefined()
  })

  test("only the Home hand-off owner is kept", () => {
    const store = importDocument(docWithFlags())
    releaseOnOpen(target(store), "agent:kimo.old.0")
    expect(flagged(store)).toEqual(["Dead000001"])
  })

  test("a read-only document is left alone", () => {
    const store = importDocument(docWithFlags())
    store.setReadOnly("Locked by another app")
    expect(releaseOnOpen(target(store))).toEqual([])
    expect(flagged(store)).toHaveLength(3)
  })
})

describe("agent disconnect and turn end", () => {
  test("a client's flags go when it disconnects; a bare flag goes with the last agent", () => {
    const store = importDocument(docWithFlags())
    const agents = emitter(conns("mcp:claude-code.k3x9qa", "mcp:other.zz"))
    const stop = watchMcpClients(target(store), agents as never)
    expect(flagged(store)).toHaveLength(3)
    agents.set(conns("mcp:other.zz"))
    expect(flagged(store)).toEqual(["Bare000001", "Dead000001"].sort())
    // Another client is still connected: the owner-less flag stays.
    agents.set(conns())
    expect(flagged(store)).toEqual(["Dead000001"])
    stop()
  })

  test("the turn's flags and owner-less flags go when it ends", () => {
    const state = (busy: boolean, live: string[] = []) => ({ busy, canvas: { live } })
    const store = importDocument(docWithFlags())
    const panel = {
      ...emitter(state(true, ["agent:kimo.old.0"])),
      stop() {},
    }
    watchTurns(target(store), panel as never)
    panel.set(state(true, ["agent:kimo.old.0"]))
    expect(flagged(store)).toHaveLength(3)
    panel.set(state(false))
    // Dead (this turn's) and Bare (no owner) go; the MCP client's own flag stays until it disconnects.
    expect(flagged(store)).toEqual(["Mcp0000001"])
  })

  test("unmount releases what is not owned by a connected client", () => {
    const store = importDocument(docWithFlags())
    const agents = emitter(conns("mcp:claude-code.k3x9qa"))
    releaseOnUnmount(target(store), agents as never)
    expect(flagged(store)).toEqual(["Mcp0000001"])
  })
})

describe("close", () => {
  test("stopping the turn waits for it to settle, and gives up on one that does not stop", async () => {
    const panel = emitter({ busy: true, canvas: { live: [] } })
    let stopped = 0
    const c = {
      get state() {
        return panel.state
      },
      subscribe: panel.subscribe,
      stop() {
        stopped++
        queueMicrotask(() => panel.set({ busy: false, canvas: { live: [] } }))
      },
    }
    await stopAgentTurn(c as never, 500)
    expect(stopped).toBe(1)
    expect(panel.state.busy).toBe(false)

    const stuck = emitter({ busy: true, canvas: { live: [] } })
    const t = Date.now()
    await stopAgentTurn({ state: stuck.state, subscribe: stuck.subscribe, stop() {} } as never, 30)
    expect(Date.now() - t).toBeGreaterThanOrEqual(25)
  })

  test("quit mid-turn: the window close stops the turn, releases the flags and saves a clean file", async () => {
    const text = serialize(docWithFlags())
    const { platform, manager } = await setup({ [FILE]: text })
    const s = await manager.open(FILE)
    const panel = emitter({ busy: true, canvas: { live: ["agent:kimo.s1.0"] } })
    let stopped = false
    const c = {
      get state() {
        return panel.state
      },
      subscribe: panel.subscribe,
      stop() {
        stopped = true
        queueMicrotask(() => panel.set({ busy: false, canvas: { live: [] } }))
      },
    }
    manager.addCloseHook(() => releaseOnClose(target(s.store), c as never, null))
    manager.install()
    expect(flagged(s.store)).toHaveLength(3)
    expect(await platform.control.requestClose()).toBe(true)
    expect(stopped).toBe(true)
    expect(flagged(s.store)).toEqual([])
    const onDisk = platform.control.readFile(FILE) ?? ""
    expect(onDisk.includes("placeholder")).toBe(false)
    expect(Object.keys((parse(onDisk) as KimoDocument).nodes ?? {})).toContain("Bare000001")
    await manager.dispose()
  })

  test("a close hook that throws does not keep the window open", async () => {
    const { platform, manager } = await setup()
    await manager.open(FILE)
    manager.addCloseHook(() => {
      throw new Error("boom")
    })
    manager.install()
    expect(await platform.control.requestClose()).toBe(true)
    await manager.dispose()
  })
})
