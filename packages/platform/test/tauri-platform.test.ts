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
import {
  bytesToBase64,
  createTauriPlatform,
  toPlatformError,
  trafficLightInsetOf,
} from "../src/tauri-platform"

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
    kimo_fs_read_bytes: () => new Uint8Array([1, 2, 3]).buffer,
    kimo_fonts_cache_get: ({ key }) => (key === "hit" ? new Uint8Array([9]).buffer : null),
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
  test("loads app info, window chrome, recovery dir and capabilities", async () => {
    const t = fakeTauri()
    const p = await createTauriPlatform(t.bridge)
    expect(p.kind).toBe("desktop")
    expect(p.os).toBe("macos")
    expect(p.appVersion).toBe("0.4.2")
    expect(p.window.label).toBe("main")
    expect(p.window.trafficLightPosition()).toEqual({ x: 16, y: 18 })
    expect(p.window.trafficLightInset()).toBe(68)
    expect(p.recovery.dir).toBe("/Users/me/.kimo/recovery")
    expect(p.capabilities).toMatchObject({
      fileAccess: "native",
      leases: "os",
      recovery: "disk",
      trafficLights: true,
      settingsWindow: true,
    })
    // All eleven events have a listener.
    expect(t.listeners.size).toBe(11)
    expect(p.arch).toBe("aarch64")
    p.dispose()
    expect([...t.listeners.values()].every((s) => s.size === 0)).toBe(true)
  })

  test("maps arguments exactly as TauriCommandMap", async () => {
    const t = fakeTauri()
    const p = await createTauriPlatform(t.bridge)
    await p.files.writeTextAtomic("/a/doc.kimo", "{}")
    expect(t.last("kimo_fs_write_text_atomic")).toEqual({
      path: "/a/doc.kimo",
      text: "{}",
      mkdirs: false,
    })
    await p.files.writeBytesAtomic("/a/x.bin", new Uint8Array([104, 105]), { mkdirs: true })
    expect(t.last("kimo_fs_write_bytes_atomic")).toEqual({
      path: "/a/x.bin",
      base64: "aGk=",
      mkdirs: true,
    })
    expect(await p.files.readBytes("/a/x.bin")).toEqual(new Uint8Array([1, 2, 3]))
    await p.files.list("/a")
    expect(t.last("kimo_fs_list")).toEqual({ dir: "/a", extensions: null })
    await p.dialogs.openFile()
    expect(t.last("kimo_dialog_open_file")).toEqual({
      title: null,
      filters: [],
      multiple: false,
      defaultDir: null,
    })
    await p.leases.acquire("/a/doc.kimo")
    expect(t.last("kimo_lease_acquire")).toEqual({ path: "/a/doc.kimo", reclaimStale: true })
    await p.leases.acquire("/a/doc.kimo", { reclaimStale: false })
    expect(t.last("kimo_lease_acquire")).toEqual({ path: "/a/doc.kimo", reclaimStale: false })
    await p.recovery.prune()
    expect(t.last("kimo_recovery_prune")).toEqual({ maxAgeMs: 30 * 24 * 60 * 60 * 1000 })
    await p.recovery.restore("0123456789abcdef")
    expect(t.last("kimo_recovery_read")).toEqual({ id: "0123456789abcdef" })
    expect(await p.fonts.cache.get("hit")).toEqual(new Uint8Array([9]))
    expect(await p.fonts.cache.get("miss")).toBeNull()
    await p.settings.ready
    await p.updater.check()
    expect(t.last("kimo_updater_check")).toEqual({ channel: "beta" })
    expect(await p.window.openSettings("fonts")).toBe("window")
    expect(t.last("kimo_window_open_settings")).toEqual({ pane: "fonts" })
    p.dispose()
  })

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
    expect(args).toMatchObject({ paths: ["/a/doc.kimo"], debounceMs: 50, recursive: false })
    const ev = [{ kind: "modified" as const, ref: "/a/doc.kimo", at: 1 }]
    t.emit("kimo://fs-watch", { watchId: "someone-else", events: ev })
    t.emit("kimo://fs-watch", { watchId: args.watchId, events: ev })
    expect(got).toEqual([ev])
    off()
    await tick()
    expect(t.last("kimo_fs_unwatch")).toEqual({ watchId: args.watchId })
    t.emit("kimo://fs-watch", { watchId: args.watchId, events: ev })
    expect(got.length).toBe(1)

    const changes: unknown[] = []
    const offGit = p.git.watch("/a/doc.kimo", (state, change) => changes.push([state, change]))
    await tick()
    const g = t.last("kimo_git_watch")
    t.emit("kimo://git-changed", {
      watchId: g.watchId,
      state: null,
      change: { kind: "status-changed" },
    })
    expect(changes).toEqual([[null, { kind: "status-changed" }]])
    offGit()
    p.dispose()
  })

  test("close handshake answers with the handler's result", async () => {
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

  test("the topbar inset is the right edge of the lights the shell measured", async () => {
    const lights = { x: 16, y: 18 }
    const base = { focused: true, fullscreen: false, trafficLightPosition: lights }
    expect(trafficLightInsetOf(base)).toBe(68)
    expect(trafficLightInsetOf({ ...base, trafficLightsRight: 76 })).toBe(76)
    expect(trafficLightInsetOf({ ...base, trafficLightsRight: 75.2 })).toBe(76)
    expect(trafficLightInsetOf({ ...base, trafficLightsRight: null })).toBe(68)
    expect(trafficLightInsetOf({ ...base, trafficLightsRight: 76, fullscreen: true })).toBe(4)
    expect(
      trafficLightInsetOf({ focused: true, fullscreen: false, trafficLightPosition: null }),
    ).toBe(0)

    const t = fakeTauri({
      kimo_window_state: () => ({ ...base, trafficLightsRight: 76 }),
      kimo_window_titlebar_double_click: () => null,
    })
    const p = await createTauriPlatform(t.bridge)
    expect(p.window.trafficLightInset()).toBe(76)
    const seen: number[] = []
    p.window.onTrafficLightInsetChange((n) => seen.push(n))
    t.emit("kimo://window-state", { ...base, trafficLightsRight: 68 })
    t.emit("kimo://window-state", { ...base, trafficLightsRight: 68 })
    expect(seen).toEqual([68])
    await p.window.titlebarDoubleClick()
    expect(t.last("kimo_window_titlebar_double_click")).toEqual({})
  })

  test("window, updater, settings and launch events", async () => {
    const t = fakeTauri()
    const p = await createTauriPlatform(t.bridge)
    await p.settings.ready
    const focus: boolean[] = []
    const full: boolean[] = []
    p.window.onFocusChange((f) => focus.push(f))
    p.window.onFullscreenChange((f) => full.push(f))
    t.emit("kimo://window-state", {
      focused: false,
      fullscreen: true,
      trafficLightPosition: { x: 16, y: 18 },
    })
    expect([focus, full]).toEqual([[false], [true]])
    expect(p.window.trafficLightInset()).toBe(4)

    t.emit("kimo://updater-status", { state: "checking" })
    expect(p.updater.status()).toEqual({ state: "checking" })

    const changed: unknown[] = []
    p.settings.onChange((k, v) => changed.push([k, v]))
    await p.settings.set("files.autosave", false)
    expect(t.last("kimo_settings_set")).toEqual({ key: "files.autosave", value: false })
    // The broadcast echo of our own write does not fire again.
    t.emit("kimo://settings-changed", { key: "files.autosave", value: false })
    t.emit("kimo://settings-changed", { key: "general.appearance", value: "dark" })
    t.emit("kimo://settings-changed", { key: "general.appearance", value: "neon" })
    expect(changed).toEqual([
      ["files.autosave", false],
      ["general.appearance", "dark"],
    ])
    expect(p.settings.get("general.appearance")).toBe("dark")

    const opened: unknown[] = []
    p.launch.onOpenRequest((r) => opened.push(r))
    t.emit("kimo://open-request", { source: "deep-link", refs: ["/a.kimo"], node: "Abc123xyz9" })
    expect(opened).toEqual([{ source: "deep-link", refs: ["/a.kimo"], node: "Abc123xyz9" }])

    // Board 25 §7 (b): native Help items reach the focused editor; logs are revealed in Rust.
    const help: unknown[] = []
    p.help?.onMenu((a) => help.push(a))
    t.emit("kimo://help-menu", { action: "shortcuts" })
    t.emit("kimo://help-menu", { action: "report-issue" })
    expect(help).toEqual(["shortcuts", "report-issue"])
    // Board 27: native File / View items for the focused editor.
    const menu: unknown[] = []
    p.menu?.onAction((a) => menu.push(a))
    t.emit("kimo://editor-menu", { action: "export" })
    t.emit("kimo://editor-menu", { action: "copy-png" })
    t.emit("kimo://editor-menu", { action: "preview" })
    expect(menu).toEqual(["export", "copy-png", "preview"])
    await p.help?.showLogs()
    expect(t.last("kimo_help_show_logs")).toEqual({})
    p.dispose()
  })

  test("download saves through the dialog and rejects CANCELLED when dismissed", async () => {
    let target: string | null = "/Users/me/out.svg"
    const t = fakeTauri({ kimo_dialog_save_file: () => target })
    const p = await createTauriPlatform(t.bridge)
    await p.files.download("out.svg", new Uint8Array([60]), "image/svg+xml")
    expect(t.last("kimo_dialog_save_file")).toMatchObject({
      suggestedName: "out.svg",
      filters: [{ name: "SVG", extensions: ["svg"] }],
    })
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

  test("base64 handles large buffers", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256)
    expect(Buffer.from(bytesToBase64(big), "base64").equals(Buffer.from(big))).toBe(true)
  })
})
