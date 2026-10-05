import { describe, expect, test } from "bun:test"
import {
  bindDockActivity,
  createDockReporter,
  DOCK_HEARTBEAT_MS,
  type DockAgentSource,
} from "../src/platform/dock-activity"

function fakeTimers() {
  const live = new Map<number, () => void>()
  let id = 0
  return {
    live,
    setInterval: ((fn: () => void, ms: number) => {
      expect(ms).toBe(DOCK_HEARTBEAT_MS)
      live.set(++id, fn)
      return id
    }) as unknown as typeof setInterval,
    clearInterval: ((h: number) => void live.delete(h)) as unknown as typeof clearInterval,
    tick: () => {
      for (const fn of live.values()) fn()
    },
  }
}

describe("dock activity (board 32)", () => {
  test("sends turn edges once, heartbeats while working, stops on dispose", async () => {
    const calls: [string, boolean][] = []
    const dock = { setAgentWorking: async (s: string, w: boolean) => void calls.push([s, w]) }
    const t = fakeTimers()
    const r = createDockReporter({ dock }, t)
    r.set(false) // already idle: nothing
    r.set(true)
    r.set(true) // no duplicate edge
    expect(calls.map((c) => c[1])).toEqual([true])
    t.tick()
    t.tick()
    expect(calls.map((c) => c[1])).toEqual([true, true, true])
    r.set(false)
    expect(t.live.size).toBe(0)
    r.set(true)
    r.dispose()
    expect(calls.map((c) => c[1])).toEqual([true, true, true, false, true, false])
    expect(new Set(calls.map((c) => c[0])).size).toBe(1)
    expect(createDockReporter({ dock }, t)).toBeTruthy()
  })

  test("no dock (web, memory): never reports", () => {
    const r = createDockReporter({}, fakeTimers())
    r.set(true)
    r.dispose()
  })

  test("a controller's turn counts while its composer streams", () => {
    const calls: boolean[] = []
    const dock = { setAgentWorking: async (_s: string, w: boolean) => void calls.push(w) }
    const box: { listener: ((s: { composer: { state: string } }) => void) | null } = {
      listener: null,
    }
    const controller: DockAgentSource = {
      state: { composer: { state: "streaming" } },
      subscribe: (l) => {
        box.listener = l
        return () => {
          box.listener = null
        }
      },
    }
    const unbind = bindDockActivity({ dock }, controller, fakeTimers())
    expect(calls).toEqual([true]) // already streaming when bound
    for (const state of ["waiting-approval", "streaming", "paused", "idle"])
      box.listener?.({ composer: { state } })
    expect(calls).toEqual([true, false, true, false])
    box.listener?.({ composer: { state: "streaming" } })
    unbind() // window / controller teardown mid-turn
    expect(calls).toEqual([true, false, true, false, true, false])
    expect(box.listener).toBeNull()
  })
})
