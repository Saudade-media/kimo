/** Board 19 updater toasts: background download, one toast per session, never restart before flushAll. */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { createUpdaterController, UpdateToastView } from "../src/updater"

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

  test("Download updates off: no download, no toast", async () => {
    const { p, c } = setup(async () => ({ ok: true, failed: [] }), { "updates.download": false })
    await p.settings.ready
    c.start()
    await tick()
    expect(p.updater.status().state).toBe("available")
    expect(c.toast()).toBeNull()
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

  test("a file that can't save → save-first toast, no restart; Save & restart retries", async () => {
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

  test("toast copy (wsHiA / aF0vX)", () => {
    const ready = renderToString(
      h(UpdateToastView, {
        toast: {
          kind: "update-ready",
          info: {
            version: "0.5",
            currentVersion: "0.4.2",
            channel: "stable",
            notesUrl: null,
            publishedIso: null,
          },
        },
        onAction: () => {},
      }),
    )
    expect(ready).toContain("Kimo 0.5 is ready")
    expect(ready).toContain("Restart")
    expect(ready).toContain("kimo-toast--neutral")
    const save = renderToString(
      h(UpdateToastView, {
        toast: { kind: "update-save-first", unsavedFiles: 2 },
        onAction: () => {},
      }),
    )
    expect(save).toContain("Restart after saving 2 files?")
    expect(save).toContain("Save &amp; restart")
    expect(save).toContain("kimo-toast--warning")
  })
})
