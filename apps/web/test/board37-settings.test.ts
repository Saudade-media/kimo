/**
 * Board 37 settings scope (audit A3, A5, D1–D18): every saved setting takes effect, and every
 * failed action in a settings pane says so.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createDocStore, createEmptyDocument } from "@kimo/editor-state"
import { createSettingsStore } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { bannerCopy } from "../src/platform/contract"
import { forgetWindowFile, noteWindowFile, takeLastFiles } from "../src/platform/last-files"
import { activityDirOf } from "../src/settings/AgentsPane"
import {
  defaultNewFilesDir,
  parseSettingsFocus,
  parseSettingsHash,
  settingsHash,
  settingsWriteErrorCopy,
  updateRowView,
} from "../src/settings/model"
import { createUpdaterController } from "../src/updater/controller"
import { flushAllWindows, serveFlushRequests } from "../src/updater/restart-broadcast"
import { addNode, edit, FILE, nodeNames, setup, sleep, waitFor } from "./m4-helpers"

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

describe("D1 General › On launch: last files", () => {
  test("a window's file is remembered; the most recent comes first; take clears it", () => {
    const st = memoryStorage()
    noteWindowFile("main", "/a.kimo", 10, st)
    noteWindowFile("editor-2", "/b.kimo", 20, st)
    expect(takeLastFiles(st)).toEqual(["/b.kimo", "/a.kimo"])
    expect(takeLastFiles(st)).toEqual([])
  })

  test("Home or a user close forgets the window; garbage reads as nothing", () => {
    const st = memoryStorage()
    noteWindowFile("main", "/a.kimo", 10, st)
    noteWindowFile("main", null, 11, st)
    expect(takeLastFiles(st)).toEqual([])
    noteWindowFile("editor-2", "/b.kimo", 10, st)
    forgetWindowFile("editor-2", st)
    expect(takeLastFiles(st)).toEqual([])
    st.setItem("kimo.lastFiles", "{not json")
    expect(takeLastFiles(st)).toEqual([])
  })

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

describe("D2 When a file changes on disk = Ask first", () => {
  test("local edits are not merged: banner, autosave paused, the file on disk is kept", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.onExternalChange": "ask" },
    })
    const s = await manager.open(FILE)
    edit(s.store, "Local00001")
    const disk = addNode(platform.control.readFile(FILE) as string, "Disk000001")
    platform.control.writeExternal(FILE, disk)
    await waitFor(() => s.state().banner?.kind === "external-change", 2000, "ask banner")
    const copy = bannerCopy(s.state().banner as never, {
      os: "macos",
      formatBytes: String,
      formatTime: String,
      displayDir: String,
    })
    expect(copy.title).toBe("marketing.kimo changed on disk")
    expect(copy.actions.map((a) => a.label)).toEqual(["Keep mine", "Merge"])
    expect(s.store.getNode("Disk000001")).toBeUndefined()
    await sleep(500)
    expect(platform.control.readFile(FILE)).toBe(disk)
    // Merge: the change from disk joins the edits; autosave resumes.
    await s.runAction("external-merge")
    expect(s.state().banner?.kind).not.toBe("external-change")
    expect(s.store.getNode("Disk000001")).toBeDefined()
    expect(s.store.getNode("Local00001")).toBeDefined()
    await waitFor(
      () => nodeNames(platform.control.readFile(FILE)).includes("Local00001"),
      2000,
      "autosave after merge",
    )
    await s.dispose()
  })

  test("Keep mine saves the local version over the file", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.onExternalChange": "ask" },
    })
    const s = await manager.open(FILE)
    edit(s.store, "Local00001")
    platform.control.writeExternal(
      FILE,
      addNode(platform.control.readFile(FILE) as string, "Disk000001"),
    )
    await waitFor(() => s.state().banner?.kind === "external-change", 2000, "ask banner")
    await s.runAction("external-keep")
    expect(s.state().banner?.kind).not.toBe("external-change")
    await waitFor(
      () => nodeNames(platform.control.readFile(FILE)).includes("Local00001"),
      2000,
      "local version saved",
    )
    expect(nodeNames(platform.control.readFile(FILE))).not.toContain("Disk000001")
    await s.dispose()
  })

  test("without local edits the file still reloads", async () => {
    const { platform, manager } = await setup(undefined, {
      settings: { "files.onExternalChange": "ask" },
    })
    const s = await manager.open(FILE)
    platform.control.writeExternal(
      FILE,
      addNode(platform.control.readFile(FILE) as string, "Disk000001"),
    )
    await waitFor(() => !!s.store.getNode("Disk000001"), 2000, "reload")
    expect(s.state().banner?.kind).not.toBe("external-change")
    await s.dispose()
  })
})

describe("D5 New files go to", () => {
  test("the first Save as of an untitled file starts in the new-files folder", async () => {
    const { platform, manager } = await setup(
      {},
      { settings: { "files.newFilesDir": "/Users/me/Design" } },
    )
    let options: { defaultDir?: string } | undefined
    platform.dialogs.saveFile = async (o) => {
      options = o as never
      return null
    }
    const s = await manager.newUntitled()
    await s.saveAs()
    expect(options?.defaultDir).toBe("/Users/me/Design")
    await s.dispose()
  })

  test("default: ~/Documents/Kimo from the home directory", () => {
    const platform = createMemoryPlatform({})
    expect(
      defaultNewFilesDir({
        settings: platform.settings,
        recovery: { dir: "/Users/me/.kimo/recovery" },
      }),
    ).toBe("/Users/me/Documents/Kimo")
  })
})

describe("D6 Recovery snapshots apply live", () => {
  test("changing the setting reaches the open file's provider", async () => {
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    await platform.settings.set("files.recoverySnapshotMs", 60_000)
    expect((s.provider as unknown as { snapshotMs: number }).snapshotMs).toBe(60_000)
    await s.dispose()
  })
})

describe("D4 Embed fonts in .kimoz packages", () => {
  const ttf = new Uint8Array(
    readFileSync(
      join(import.meta.dir, "../../../packages/renderer/assets/fonts/Inter-Regular.ttf"),
    ),
  )
  /** fsType 2 (restricted license): the OS/2 table's fsType field set on a copy of Inter. */
  const restricted = (() => {
    const b = new Uint8Array(ttf)
    const v = new DataView(b.buffer)
    const n = v.getUint16(4)
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16
      const tag = String.fromCharCode(...b.slice(rec, rec + 4))
      if (tag === "OS/2") v.setUint16(v.getUint32(rec + 8) + 8, 2)
    }
    return b
  })()
  const assetsOf = (fonts: Record<string, Uint8Array>) => {
    const bytes: Record<string, Uint8Array> = {
      "0123456789abcdef.png": new Uint8Array([1, 2, 3]),
      ...fonts,
    }
    return {
      bytes: async (k: string) => bytes[k] ?? null,
      info: async (src: string) => {
        const k = src.replace("./assets/", "")
        return bytes[k]
          ? { src, mime: k.endsWith(".png") ? "image/png" : "font/ttf", bytes: bytes[k].length }
          : null
      },
    }
  }
  const store = () => {
    const d = createEmptyDocument("Pkg") as Record<string, unknown> & {
      nodes: Record<string, unknown>
    }
    d.nodes.Rect000001 = {
      type: "rect",
      parent: null,
      order: "a0",
      w: 10,
      h: 10,
      fill: { kind: "image", src: "./assets/0123456789abcdef.png" },
    }
    return createDocStore(d as never)
  }
  const withFonts = (d: Record<string, unknown>) => ({
    ...d,
    assets: {
      "0123456789abcdef.png": { mime: "image/png", bytes: 3 },
      "fedcba9876543210.ttf": { mime: "font/ttf", bytes: 10, name: "A-Regular.ttf" },
    },
  })
  const zipNames = async (blob: Blob) => {
    const { readZip } = await import("../src/lib/zip")
    return (await readZip(new Uint8Array(await blob.arrayBuffer()))).map((f) => f.name)
  }

  test("on: an installable font goes in the package", async () => {
    const { exportFile } = await import("../src/lib/files")
    const f = await exportFile(
      store(),
      "Pkg",
      assetsOf({ "fedcba9876543210.ttf": ttf }) as never,
      withFonts as never,
      true,
    )
    expect(await zipNames(f.data)).toContain("assets/fedcba9876543210.ttf")
  })

  test("on: a font whose fsType forbids embedding is left out (and out of the manifest)", async () => {
    const { exportFile } = await import("../src/lib/files")
    const f = await exportFile(
      store(),
      "Pkg",
      assetsOf({ "fedcba9876543210.ttf": restricted }) as never,
      withFonts as never,
      true,
    )
    const names = await zipNames(f.data)
    expect(names).not.toContain("assets/fedcba9876543210.ttf")
    expect(names).toContain("assets/0123456789abcdef.png")
  })

  test("off: no font goes in the package", async () => {
    const { exportFile } = await import("../src/lib/files")
    const f = await exportFile(
      store(),
      "Pkg",
      assetsOf({ "fedcba9876543210.ttf": ttf }) as never,
      withFonts as never,
      false,
    )
    expect(await zipNames(f.data)).not.toContain("assets/fedcba9876543210.ttf")
  })
})

describe("D10 Updates pane", () => {
  const info = {
    version: "0.4.3",
    currentVersion: "0.4.2",
    channel: "stable" as const,
    notesUrl: null,
    publishedIso: null,
  }
  const seen = { info: null, total: null, action: "check" as const }
  test("available · downloading · ready, as board 37 shows them", () => {
    expect(
      updateRowView({ state: "available", info }, "0.4.2", { ...seen, total: 18_000_000 }),
    ).toMatchObject({
      kind: "available",
      label: "Kimo 0.4.3 is available",
      description: "You have 0.4.2 · 18 MB",
    })
    expect(
      updateRowView(
        { state: "downloading", info, received: 7_600_000, total: 18_000_000 },
        "0.4.2",
        seen,
      ),
    ).toMatchObject({
      kind: "downloading",
      label: "Downloading Kimo 0.4.3",
      description: "7.6 of 18 MB",
      percent: 42,
    })
    expect(updateRowView({ state: "ready", info }, "0.4.2", seen)).toMatchObject({
      kind: "ready",
      label: "Kimo 0.4.3 is ready",
      description: "Restart Kimo to finish. Open files are saved first.",
    })
  })

  test("a failed download keeps the Available row (the banner says what failed)", () => {
    const v = updateRowView({ state: "error", message: "The connection was lost" }, "0.4.2", {
      info,
      total: null,
      action: "download",
    })
    expect(v.kind).toBe("available")
    expect(v.action).toBe("download")
  })

  test("turning Download updates on downloads a waiting update", async () => {
    const platform = createMemoryPlatform({ settings: { "updates.download": false } })
    await platform.settings.ready
    platform.control.publishUpdate({
      version: "0.4.3",
      channel: "stable",
      notesUrl: null,
      publishedIso: null,
    })
    const ctl = createUpdaterController({
      platform,
      flushAll: async () => ({ ok: true, failed: [] }),
    })
    ctl.start()
    await waitFor(() => platform.updater.status().state === "available", 1000, "available")
    await platform.settings.set("updates.download", true)
    await waitFor(() => platform.updater.status().state === "ready", 1000, "downloaded")
    ctl.dispose()
  })

  test("Restart to update asks every window to save first", async () => {
    let flushed = 0
    const off = serveFlushRequests("main", async () => {
      flushed++
      return { ok: true, failed: [] }
    })
    expect(await flushAllWindows()).toBe(0)
    expect(flushed).toBe(1)
    off()
    const offBad = serveFlushRequests("editor-2", async () => ({ ok: false, failed: ["/a", "/b"] }))
    expect(await flushAllWindows()).toBe(2)
    offBad()
  })
})

describe("D13 · A5 errors", () => {
  test("a refused write names the setting and the cause", () => {
    expect(
      settingsWriteErrorCopy(
        "general.canvasZoom",
        new Error("IO: ~/.kimo/settings.json is read-only"),
      ),
    ).toEqual({ title: "Couldn't save Canvas zoom", body: "~/.kimo/settings.json is read-only." })
  })

  test("a refused write rolls the stored value back", async () => {
    const store = createSettingsStore({
      load: async () => ({}),
      persist: async () => {
        throw new Error("IO: ~/.kimo/settings.json is read-only")
      },
    })
    await store.ready
    await expect(store.set("general.canvasZoom", "mouse")).rejects.toThrow("read-only")
    expect(store.get("general.canvasZoom")).toBe("trackpad")
  })
})

describe("D7 · D17 · D18 deep links", () => {
  test("Settings routes carry an optional focus", () => {
    expect(parseSettingsHash("#/settings/agents-mcp/claude-code")).toBe("agents-mcp")
    expect(parseSettingsFocus("#/settings/agents-mcp/claude-code")).toBe("claude-code")
    expect(parseSettingsFocus("#/settings/ai-providers/usage")).toBe("usage")
    expect(parseSettingsFocus("#/settings/general")).toBeNull()
    expect(settingsHash("ai-providers", "usage")).toBe("#/settings/ai-providers/usage")
    expect(settingsHash("general")).toBe("#/settings/general")
  })

  test("Open log reveals the activity logs next to the server log", () => {
    expect(activityDirOf("/Users/me/.kimo/mcp/server.log")).toBe("/Users/me/.kimo/activity")
  })

  test("the memory host records the focus", async () => {
    const platform = createMemoryPlatform({})
    await platform.window.openSettings("agents-mcp", "claude-code")
    expect(platform.control.calls).toContain("openSettings agents-mcp claude-code")
  })
})
