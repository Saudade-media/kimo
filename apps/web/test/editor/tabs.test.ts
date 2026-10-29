/** Tabs: the tab model (open, focus, close, retarget, restore) and the window controller over a session manager. */
import { afterEach, describe, expect, test } from "bun:test"
import type { OpenRequest } from "@kimo/platform"
import { noteWindowFile, noteWindowTabs, takeLastWindow } from "../../src/platform/last-files"
import { openLaunchRequests } from "../../src/platform/runtime"
import { diskPath, parseRoute } from "../../src/router"
import { TabsController } from "../../src/tabs/controller"
import {
  addHomeTab,
  EMPTY_TABS,
  removeTab,
  restoredTabs,
  retarget,
  savedTabs,
  syncRoute,
  type TabsState,
} from "../../src/tabs/model"
import { routeTarget } from "../../src/tabs/useWindowTabs"
import { docText, FILE, ROOT, setup, sleep, waitFor } from "../session-helpers"

const disk = (ref: string) => ({ kind: "disk" as const, ref })
const ids = () => {
  let n = 0
  return () => `t${++n}`
}
const refs = (s: TabsState) =>
  s.tabs.map((t) => {
    const target = t.target
    if (!target) return "home"
    return target.kind === "disk" ? target.ref : target.kind === "file" ? target.id : target.link
  })

function open(...files: string[]): TabsState {
  const id = ids()
  let s = EMPTY_TABS
  for (const f of files) s = syncRoute(s, disk(f), id)
  return s
}

describe("tab model", () => {
  test("one tab per open file in open order; an open file focuses its tab; Home keeps the files", () => {
    const s = open("/a.kimo", "/b.kimo", "/c.kimo")
    expect(refs(s)).toEqual(["/a.kimo", "/b.kimo", "/c.kimo"])
    expect(s.active).toBe("t3")
    const again = syncRoute(open("/a.kimo", "/b.kimo"), disk("/a.kimo"), () => "x")
    expect(refs(again)).toEqual(["/a.kimo", "/b.kimo"])
    expect(again.active).toBe("t1")
    const home = syncRoute(open("/a.kimo"), null, () => "x")
    expect(home.active).toBeNull()
    expect(refs(home)).toEqual(["/a.kimo"])
    // A file picked from the pinned Home opens in a new tab and keeps Home.
    const t = syncRoute(home, disk("/b.kimo"), () => "t9")
    expect(refs(t)).toEqual(["/a.kimo", "/b.kimo"])
    expect(t.active).toBe("t9")
  })

  test("closing the focused tab hands focus to its right, then left neighbour, then Home", () => {
    let s: TabsState = { ...open("/a.kimo", "/b.kimo", "/c.kimo"), active: "t2" }
    s = removeTab(s, "t2")
    expect(s.active).toBe("t3")
    s = removeTab(s, "t3")
    expect(s.active).toBe("t1")
    s = removeTab(s, "t1")
    expect(s.active).toBeNull()
    expect(s.tabs).toEqual([])
    // Closing a background tab keeps the focus.
    const bg = removeTab(open("/a.kimo", "/b.kimo"), "t1")
    expect(bg.active).toBe("t2")
  })

  test("Save as renames the tab in place; a duplicate tab goes", () => {
    const s = open("/a.kimo", "/b.kimo")
    expect(refs(retarget(s, disk("/a.kimo"), disk("/c.kimo")))).toEqual(["/c.kimo", "/b.kimo"])
    const merged = retarget(s, disk("/a.kimo"), disk("/b.kimo"))
    expect(refs(merged)).toEqual(["/b.kimo"])
    expect(merged.active).toBe("t1")
  })

  test("saved tabs keep files on disk in order; new tabs and untitled files drop; restored tabs are deduplicated", () => {
    let s = open("/a.kimo", "kimo-untitled:1", "/b.kimo")
    s = addHomeTab(s, "t9")
    expect(savedTabs(s, (r) => r.startsWith("/"))).toEqual({
      tabs: ["/a.kimo", "/b.kimo"],
      active: null,
    })
    expect(savedTabs({ ...s, active: "t3" }, () => true)).toEqual({
      tabs: ["/a.kimo", "kimo-untitled:1", "/b.kimo"],
      active: "/b.kimo",
    })
    const restored = restoredTabs(["/a.kimo", "/b.kimo", "/a.kimo"], ids())
    expect(refs(restored)).toEqual(["/a.kimo", "/b.kimo"])
    expect(restored.active).toBeNull()
  })

  test("#76: a join link opens the room in a new tab next to the open files (desktop), never saved", () => {
    const link = "kimo://join#relay.example/room/token/key"
    const route = { name: "join" as const, link }
    const target = routeTarget(route, { kind: "desktop" })
    if (!target) throw new Error("a joined room is a tab on desktop")
    const s = syncRoute(open("/a.kimo"), target, () => "t9")
    expect(refs(s)).toEqual(["/a.kimo", link])
    expect(s.active).toBe("t9")
    // The link holds the room key: Last files never keeps it.
    expect(savedTabs(s, () => true)).toEqual({ tabs: ["/a.kimo"], active: null })
    // The web keeps its own join page.
    expect(routeTarget(route, { kind: "browser" })).toBeUndefined()
  })

  test("the last-window record keeps the tabs of the most recent window, and old one-file records still restore", () => {
    const m = new Map<string, string>()
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
    noteWindowTabs("main", { tabs: ["/a.kimo", "/b.kimo"], active: "/b.kimo" }, 10, st)
    noteWindowTabs("editor-2", { tabs: ["/c.kimo"], active: null }, 20, st)
    expect(takeLastWindow(st)).toEqual({ tabs: ["/c.kimo"], active: null })
    expect(takeLastWindow(st)).toBeNull()
    noteWindowFile("main", "/old.kimo", 5, st)
    st.setItem("kimo.lastFiles", JSON.stringify({ main: { ref: "/old.kimo", at: 5 } }))
    expect(takeLastWindow(st)).toEqual({ tabs: ["/old.kimo"], active: "/old.kimo" })
    // No tabs forgets the window.
    noteWindowTabs("main", { tabs: ["/a.kimo"], active: "/a.kimo" }, 10, st)
    noteWindowTabs("main", { tabs: [], active: null }, 11, st)
    expect(takeLastWindow(st)).toBeNull()
  })
})

describe("TabsController over a session manager", () => {
  const B = `${ROOT}/pricing.kimo`
  const frame = (id: string) => ({
    op: "insert" as const,
    id,
    node: { type: "frame", name: id, w: 100, h: 100 },
  })

  const live: TabsController[] = []
  afterEach(() => {
    for (const t of live.splice(0)) t.dispose()
  })

  async function harness() {
    const { platform, manager } = await setup({ [FILE]: docText(), [B]: docText("Pricing") })
    const paths: string[] = []
    const tabs = new TabsController({ navigate: (p) => paths.push(p), homePath: () => "/" })
    tabs.attach(manager, platform)
    live.push(tabs)
    return { platform, manager, tabs, paths }
  }

  test("tabs keep their files open while another tab shows; closing one closes its file", async () => {
    const { manager, tabs, paths } = await harness()
    tabs.route(disk(FILE))
    await manager.open(FILE)
    tabs.route(disk(B))
    await manager.open(B)
    await sleep(5)
    expect(manager.sessions().length).toBe(2)
    expect(await tabs.close(tabs.getState().tabs[0]?.id ?? "")).toBe(true)
    await waitFor(() => manager.sessions().length === 1, 1000, "file closed")
    expect(manager.get(B)).toBeDefined()
    // Closing the focused tab shows Home (no tab left).
    expect(await tabs.close(tabs.getState().active ?? "")).toBe(true)
    expect(paths.at(-1)).toBe("/")
    await waitFor(() => manager.sessions().length === 0, 1000, "all closed")
  })

  test("a cold start with a file and a link, two links or two files gives each its tab in order, the last in front (a bug: only one got a tab)", async () => {
    const A = "kimo://join#relay.example/room-a/token/key"
    const Z = "kimo://join#relay.example/room-z/token/key"
    const cases: [OpenRequest[], string[]][] = [
      [
        [
          { source: "argv", refs: [FILE] },
          { source: "argv", refs: [], join: A },
        ],
        [FILE, A],
      ],
      [
        [
          { source: "deep-link", refs: [], join: A },
          { source: "deep-link", refs: [], join: Z },
        ],
        [A, Z],
      ],
      // `kimo-desktop a.kimo b.kimo`: the files arrive as one request.
      [[{ source: "argv", refs: [FILE, B] }], [FILE, B]],
    ]
    for (const [requests, want] of cases) {
      const { platform, manager } = await setup({ [FILE]: docText(), [B]: docText("Pricing") })
      for (const r of requests) platform.control.open(r)
      const tabs = new TabsController({ navigate: () => {}, homePath: () => "/" })
      live.push(tabs)
      // The window's hash route: hash changes in a row reach the route as the newest hash.
      let hash = "#/"
      const navigate = (path: string) => {
        hash = `#${path}`
        setTimeout(() => {
          const target = routeTarget(parseRoute(hash), platform)
          if (target !== undefined) tabs.route(target)
        }, 0)
      }
      await openLaunchRequests({ platform, manager, tabs, navigate }, (s, r) =>
        navigate(diskPath(s.ref, r.node, r.page)),
      )
      await sleep(5)
      const state = tabs.getState()
      expect(refs(state)).toEqual(want)
      // The last request is in front.
      expect(state.active).toBe(state.tabs.at(-1)?.id ?? "none")
    }
  })

  test("an untitled file with edits asks first; Cancel keeps the tab", async () => {
    const { manager, tabs } = await harness()
    const u = await manager.newUntitled()
    tabs.route(disk(u.ref))
    tabs.route(disk(FILE))
    await sleep(5)
    u.store.apply(frame("Frame00001"), { origin: "user" })
    const id = tabs.getState().tabs[0]?.id ?? ""
    const closing = tabs.close(id)
    await waitFor(() => !!u.state().closePrompt, 1000, "prompt")
    // The prompt is shown by the tab's editor, so the tab comes to the front.
    expect(tabs.getState().active).toBe(id)
    u.respondToClose("cancel")
    expect(await closing).toBe(false)
    expect(tabs.getState().tabs.length).toBe(2)
  })
})
