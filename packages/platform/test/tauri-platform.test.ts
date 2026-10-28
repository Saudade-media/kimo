import { describe, expect, test } from "bun:test"
import { isPlatformError } from "../src/errors"
import type {
  TauriCommand,
  TauriCommandMap,
  TauriEvent,
  TauriEventMap,
  TypedInvoke,
  TypedListen,
} from "../src/tauri"
import { bytesToBase64, createTauriPlatform, toPlatformError } from "../src/tauri-platform"

type Handler = (args: Record<string, unknown>) => unknown

/** A fake Tauri: records invokes, answers from `handlers`, and lets tests emit events. */
function fakeTauri(overrides: Partial<Record<TauriCommand, Handler>> = {}) {
  const calls: { command: TauriCommand; args: Record<string, unknown> }[] = []
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  let settings: Record<string, unknown> = { "updates.channel": "beta" }
  const defaults: Partial<Record<TauriCommand, Handler>> = {
    kimo_app_info: () => ({
      version: "0.4.2",
      os: "macos",
      arch: "aarch64",
      host: "mbp",
      pid: 42,
      kimoHome: "/Users/me/.kimo",
      windowLabel: "main",
    }),
    kimo_window_state: () => ({
      focused: true,
      fullscreen: false,
      trafficLightPosition: { x: 16, y: 18 },
    }),
    kimo_updater_status: () => ({ state: "idle" }),
    kimo_recovery_dir: () => "/Users/me/.kimo/recovery",
    kimo_settings_get_all: () => settings,
    kimo_settings_set: ({ key, value }) => {
      settings = { ...settings, [key as string]: value }
      return null
    },
  }
  const invoke = (async (command: TauriCommand, args: Record<string, unknown>) => {
    calls.push({ command, args })
    const h = overrides[command] ?? defaults[command]
    return h ? h(args) : null
  }) as unknown as TypedInvoke
  const listen = (async (event: TauriEvent, handler: (p: unknown) => void) => {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }) as unknown as TypedListen
  const emit = <E extends TauriEvent>(event: E, payload: TauriEventMap[E]) => {
    for (const h of listeners.get(event) ?? []) h(payload)
  }
  const last = <C extends TauriCommand>(command: C) =>
    calls.filter((c) => c.command === command).at(-1)?.args as TauriCommandMap[C]["args"]
  return { bridge: { invoke, listen }, calls, emit, last, listeners }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("createTauriPlatform", () => {
  test("rethrows payloads as PlatformError", async () => {
    const t = fakeTauri({
      kimo_fs_write_text_atomic: () => {
        throw { code: "DISK_FULL", message: "/a: No space left on device", errno: "ENOSPC" }
      },
      kimo_fs_read_text: () => {
        throw "command kimo_fs_read_text not allowed by ACL"
      },
    })
    const p = await createTauriPlatform(t.bridge)
    const e = await p.files.writeTextAtomic("/a", "x").catch((x) => x)
    expect(isPlatformError(e, "DISK_FULL")).toBe(true)
    expect(e.errno).toBe("ENOSPC")
    const e2 = await p.files.readText("/a").catch((x) => x)
    expect(isPlatformError(e2, "PERMISSION")).toBe(true)
    expect(toPlatformError({ code: "WHAT", message: "m" }).code).toBe("IO")
    p.dispose()
  })

  test("routes watch events by watchId and unwatches", async () => {
    const t = fakeTauri()
    const p = await createTauriPlatform(t.bridge)
    const got: unknown[] = []
    const off = p.files.watch(["/a/doc.kimo"], { debounceMs: 50 }, (events) => got.push(events))
    await tick()
    const args = t.last("kimo_fs_watch")
    const ev = [{ kind: "modified" as const, ref: "/a/doc.kimo", at: 1 }]
    t.emit("kimo://fs-watch", { watchId: "someone-else", events: ev })
    t.emit("kimo://fs-watch", { watchId: args.watchId, events: ev })
    expect(got).toEqual([ev])
    off()
    await tick()
    expect(t.last("kimo_fs_unwatch")).toEqual({ watchId: args.watchId })
    t.emit("kimo://fs-watch", { watchId: args.watchId, events: ev })
    expect(got.length).toBe(1)
    p.dispose()
  })

  test("a close request is allowed unless the handler declines or throws", async () => {
    const t = fakeTauri()
    const p = await createTauriPlatform(t.bridge)
    t.emit("kimo://close-requested", { requestId: "r1" })
    await tick()
    expect(t.last("kimo_window_confirm_close")).toEqual({ requestId: "r1", allow: true })
    p.window.onCloseRequested(async () => false)
    t.emit("kimo://close-requested", { requestId: "r2" })
    await tick()
    expect(t.last("kimo_window_confirm_close")).toEqual({ requestId: "r2", allow: false })
    p.window.onCloseRequested(() => {
      throw new Error("flush failed")
    })
    t.emit("kimo://close-requested", { requestId: "r3" })
    await tick()
    expect(t.last("kimo_window_confirm_close")).toEqual({ requestId: "r3", allow: false })
    p.dispose()
  })

  test("settings: our own broadcast echo does not fire again, invalid values are dropped", async () => {
    const t = fakeTauri()
    const p = await createTauriPlatform(t.bridge)
    await p.settings.ready
    const changed: unknown[] = []
    p.settings.onChange((k, v) => changed.push([k, v]))
    await p.settings.set("files.autosave", false)
    t.emit("kimo://settings-changed", { key: "files.autosave", value: false })
    t.emit("kimo://settings-changed", { key: "general.appearance", value: "dark" })
    t.emit("kimo://settings-changed", { key: "general.appearance", value: "neon" })
    expect(changed).toEqual([
      ["files.autosave", false],
      ["general.appearance", "dark"],
    ])
    expect(p.settings.get("general.appearance")).toBe("dark")
    p.dispose()
  })

  test("download saves through the dialog and rejects CANCELLED when dismissed", async () => {
    let target: string | null = "/Users/me/out.svg"
    const t = fakeTauri({ kimo_dialog_save_file: () => target })
    const p = await createTauriPlatform(t.bridge)
    await p.files.download("out.svg", new Uint8Array([60]), "image/svg+xml")
    expect(t.last("kimo_fs_write_bytes_atomic")).toMatchObject({
      path: "/Users/me/out.svg",
      base64: "PA==",
    })
    target = null
    const e = await p.files
      .download("out.svg", new Uint8Array([60]), "image/svg+xml")
      .catch((x) => x)
    expect(isPlatformError(e, "CANCELLED")).toBe(true)
    p.dispose()
  })

  test("the clipboard falls back to the page API when Rust says BLOCKED", async () => {
    const t = fakeTauri({
      kimo_clipboard_write_text: () => {
        throw { code: "BLOCKED", message: "No native clipboard" }
      },
    })
    const p = await createTauriPlatform(t.bridge)
    const written: string[] = []
    const nav = globalThis as unknown as { navigator?: unknown }
    const prev = nav.navigator
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: async (s: string) => void written.push(s) } },
      configurable: true,
    })
    try {
      await p.clipboard?.writeText("Kimo 1.0.0")
      expect(written).toEqual(["Kimo 1.0.0"])
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: prev, configurable: true })
    }
    p.dispose()
  })

  test("base64 handles large buffers", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256)
    expect(Buffer.from(bytesToBase64(big), "base64").equals(Buffer.from(big))).toBe(true)
  })
})
