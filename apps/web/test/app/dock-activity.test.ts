import { expect, test } from "bun:test"
import { createDockReporter, DOCK_HEARTBEAT_MS } from "../../src/platform/dock-activity"

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

test("dock activity sends turn edges once, heartbeats while working, and stops on dispose", async () => {
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
})
