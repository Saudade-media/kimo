/** Settings: writes that are refused, and the files remembered for "On launch: last files". */
import { describe, expect, test } from "bun:test"
import { createSettingsStore } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { noteWindowFile } from "../../src/platform/last-files"
import { FILE, setup } from "../session-helpers"

/** A Map-backed localStorage (the record lives there in the desktop app). */
function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  }
}

describe("settings writes", () => {
  test("a bad value is rejected with INVALID and the stored value stays", async () => {
    const p = createMemoryPlatform()
    await p.settings.ready
    const before = p.settings.get("files.autosaveIntervalMs")
    await expect(p.settings.set("files.autosaveIntervalMs", -1)).rejects.toMatchObject({
      code: "INVALID",
    })
    await expect(p.settings.set("fonts.extraFolders", [""])).rejects.toMatchObject({
      code: "INVALID",
    })
    expect(p.settings.get("files.autosaveIntervalMs")).toBe(before)
    await p.settings.set("files.autosaveIntervalMs", 5000)
    expect(p.settings.get("files.autosaveIntervalMs")).toBe(5000)
  })

  test("a refused write rolls the stored value back", async () => {
    const store = createSettingsStore({
      load: async () => ({}),
      persist: async () => {
        throw new Error("IO: ~/.kimo/settings.json is read-only")
      },
    })
    await store.ready
    const before = store.get("general.canvasZoom")
    await expect(store.set("general.canvasZoom", "mouse")).rejects.toThrow("read-only")
    expect(store.get("general.canvasZoom")).toBe(before)
  })
})

describe("On launch: last files", () => {
  test("the close handler forgets on a user close and keeps on quit", async () => {
    const st = memoryStorage()
    const g = globalThis as { localStorage?: unknown }
    const before = g.localStorage
    g.localStorage = st
    try {
      const { platform, manager } = await setup()
      manager.install()
      noteWindowFile("main", FILE)
      expect(await platform.control.requestClose({ quitting: true })).toBe(true)
      expect(st.m.get("kimo.lastFiles")).toContain(FILE)
      expect(await platform.control.requestClose()).toBe(true)
      expect(st.m.has("kimo.lastFiles")).toBe(false)
    } finally {
      g.localStorage = before
    }
  })
})
