import { describe, expect, test } from "bun:test"
import { createSettingsStore, normalizeSettings } from "../src/index"
import { createMemoryPlatform } from "../src/memory"

describe("settings", () => {
  test("normalize drops unknown keys and invalid values", () => {
    const s = normalizeSettings({
      "files.autosaveIntervalMs": 5000,
      "files.autosave": "yes",
      "updates.channel": "nightly",
      bogus: 1,
    })
    expect(s["files.autosaveIntervalMs"]).toBe(5000)
    expect(s["files.autosave"]).toBe(true)
    expect(s["updates.channel"]).toBe("stable")
    expect("bogus" in s).toBe(false)
  })

  test("set validates and notifies", async () => {
    const p = createMemoryPlatform()
    await p.settings.ready
    const seen: string[] = []
    p.settings.onChange((k, v) => seen.push(`${k}=${v}`))
    await p.settings.set("updates.channel", "beta")
    expect(p.settings.get("updates.channel")).toBe("beta")
    expect(seen).toEqual(["updates.channel=beta"])
    await expect(p.settings.set("updates.channel", "nightly" as never)).rejects.toThrow()
  })

  test("a set() before ready survives the initial load and keeps the other persisted keys", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let persisted: Record<string, unknown> = {
      "updates.channel": "beta",
      "files.autosaveIntervalMs": 5000,
    }
    const writes: Record<string, unknown>[] = []
    const store = createSettingsStore({
      load: async () => {
        await gate
        return persisted
      },
      // A whole-map backend (browser localStorage, memory): `all` must include loaded values.
      persist: async (_k, _v, all) => {
        persisted = { ...all }
        writes.push(persisted)
      },
    })
    const pending = store.set("updates.channel", "stable")
    expect(store.get("updates.channel")).toBe("stable")
    expect(writes).toHaveLength(0)
    release()
    await store.ready
    await pending
    expect(store.get("updates.channel")).toBe("stable")
    expect(store.get("files.autosaveIntervalMs")).toBe(5000)
    expect(persisted["updates.channel"]).toBe("stable")
    expect(persisted["files.autosaveIntervalMs"]).toBe(5000)
    expect(writes).toHaveLength(1)
  })
})
