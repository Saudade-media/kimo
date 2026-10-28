/** Updates: background download, one toast per session, never restart before every window saved. */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createUpdaterController } from "../../src/updater/controller"
import { flushAllWindows, serveFlushRequests } from "../../src/updater/restart-broadcast"
import { waitFor } from "../session-helpers"

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(flush: () => Promise<{ ok: boolean; failed: string[] }>, settings = {}) {
  const p = createMemoryPlatform({ appVersion: "0.4.2", settings })
  p.control.publishUpdate({ version: "0.5", channel: "stable", notesUrl: null, publishedIso: null })
  const order: string[] = []
  const c = createUpdaterController({
    platform: p,
    flushAll: async () => {
      order.push("flushAll")
      const r = await flush()
      order.push(`flushed ${r.ok}`)
      return r
    },
  })
  return { p, c, order }
}

describe("updater flow", () => {
  test("downloads in the background and shows one ready toast per session", async () => {
    const { p, c } = setup(async () => ({ ok: true, failed: [] }))
    await p.settings.ready
    c.start()
    await tick()
    expect(c.toast()).toMatchObject({ kind: "update-ready", info: { version: "0.5" } })
    c.dismiss()
    await p.updater.check()
    await p.updater.download()
    expect(c.toast()).toBeNull() // once per session
    expect(p.control.calls).not.toContain("updater restart")
  })

  test("with Download updates off nothing downloads until it is turned on", async () => {
    const { p, c } = setup(async () => ({ ok: true, failed: [] }), { "updates.download": false })
    await p.settings.ready
    c.start()
    await tick()
    expect(p.updater.status().state).toBe("available")
    expect(c.toast()).toBeNull()
    await p.settings.set("updates.download", true)
    await waitFor(() => p.updater.status().state === "ready", 1000, "downloaded")
    c.dispose()
  })

  test("Restart flushes every file first, then restarts", async () => {
    const { p, c, order } = setup(async () => ({ ok: true, failed: [] }))
    await p.settings.ready
    c.start()
    await tick()
    const calls = p.control.calls
    const pending = c.restart()
    expect(calls).not.toContain("updater restart") // not before flushAll resolves
    expect(await pending).toBe("restarting")
    expect(order).toEqual(["flushAll", "flushed true"])
    expect(calls.filter((x) => x === "updater restart").length).toBe(1)
  })

  test("a file that can't save blocks the restart; Save & restart retries", async () => {
    let ok = false
    const { p, c } = setup(async () =>
      ok ? { ok: true, failed: [] } : { ok: false, failed: ["/a.kimo", "/b.kimo"] },
    )
    await p.settings.ready
    c.start()
    await tick()
    expect(await c.restart()).toBe("blocked")
    expect(c.toast()).toEqual({ kind: "update-save-first", unsavedFiles: 2 })
    expect(p.control.calls).not.toContain("updater restart")
    ok = true
    expect(await c.restart()).toBe("restarting")
    expect(p.control.calls).toContain("updater restart")
  })

  test("a throwing flushAll never restarts", async () => {
    const { p, c } = setup(async () => {
      throw new Error("disk full")
    })
    await p.settings.ready
    expect(await c.restart()).toBe("blocked")
    expect(c.toast()).toEqual({ kind: "update-save-first", unsavedFiles: 1 })
    expect(p.control.calls).not.toContain("updater restart")
  })
})

describe("restart from the Settings window", () => {
  test("every editor window is asked to save first, and the files that failed are counted", async () => {
    let flushed = 0
    const off = serveFlushRequests("main", async () => {
      flushed++
      return { ok: true, failed: [] }
    })
    const offBad = serveFlushRequests("editor-2", async () => ({ ok: false, failed: ["/a", "/b"] }))
    expect(await flushAllWindows()).toBe(2)
    expect(flushed).toBe(1)
    off()
    offBad()
  })
})
