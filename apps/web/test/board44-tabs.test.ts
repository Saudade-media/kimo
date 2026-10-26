/**
 * Board 44 "Workspace v2" §4 / §5 (rules bXS44fLYOq): the tab model (open, focus, close,
 * reorder, restore, shortcuts) and the window controller over a session manager.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { noteWindowFile, noteWindowTabs, takeLastWindow } from "../src/platform/last-files"
import { matches } from "../src/shortcuts/shortcuts"
import { TabsController } from "../src/tabs/controller"
import {
  addHomeTab,
  dropIndex,
  EMPTY_TABS,
  moveTab,
  removeTab,
  restoredTabs,
  retarget,
  savedTabs,
  stepTab,
  syncRoute,
  type TabsState,
  tabAt,
  tabCommandFor,
  tabPath,
} from "../src/tabs/model"
import { docText, FILE, ROOT, setup, sleep, waitFor } from "./m4-helpers"

const disk = (ref: string) => ({ kind: "disk" as const, ref })
const ids = () => {
  let n = 0
  return () => `t${++n}`
}
const refs = (s: TabsState) =>
  s.tabs.map((t) => (t.target?.kind === "disk" ? t.target.ref : t.target ? t.target.id : "home"))

function open(...files: string[]): TabsState {
  const id = ids()
  let s = EMPTY_TABS
  for (const f of files) s = syncRoute(s, disk(f), id)
  return s
}

describe("Tabs: one tab per open file, in open order", () => {
  test("opening files adds tabs at the end and focuses them", () => {
    const s = open("/a.kimo", "/b.kimo", "/c.kimo")
    expect(refs(s)).toEqual(["/a.kimo", "/b.kimo", "/c.kimo"])
    expect(s.active).toBe("t3")
  })

  test("opening a file that is already open focuses its tab", () => {
    const s = syncRoute(open("/a.kimo", "/b.kimo"), disk("/a.kimo"), () => "x")
    expect(refs(s)).toEqual(["/a.kimo", "/b.kimo"])
    expect(s.active).toBe("t1")
  })

  test("a Home route focuses the pinned Home tab and keeps the files", () => {
    const s = syncRoute(open("/a.kimo"), null, () => "x")
    expect(s.active).toBeNull()
    expect(refs(s)).toEqual(["/a.kimo"])
    // A file picked from the pinned Home opens in a new tab and keeps Home.
    const t = syncRoute(s, disk("/b.kimo"), () => "t9")
    expect(refs(t)).toEqual(["/a.kimo", "/b.kimo"])
    expect(t.active).toBe("t9")
  })

  test("browser library files are tabs too", () => {
    const s = syncRoute(EMPTY_TABS, { kind: "file", id: "abc" }, () => "t1")
    expect(tabPath(s.tabs[0]?.target ?? null, "/")).toBe("/file/abc")
    expect(tabPath(disk("/a b.kimo"), "/")).toBe("/disk/%2Fa%20b.kimo")
    expect(tabPath(null, "/all")).toBe("/all")
  })
})

describe("Home tab: ⌘T and + open Home in a new tab", () => {
  test("picking a file there turns that tab into the file", () => {
    let s = addHomeTab(open("/a.kimo"), "t2")
    expect(s.active).toBe("t2")
    expect(s.tabs[1]?.target).toBeNull()
    // Home routes keep the new tab in front.
    expect(syncRoute(s, null, () => "x")).toBe(s)
    s = syncRoute(s, disk("/b.kimo"), () => "x")
    expect(refs(s)).toEqual(["/a.kimo", "/b.kimo"])
    expect(s.active).toBe("t2")
  })

  test("a file already open from a new tab focuses its own tab", () => {
    const s = syncRoute(addHomeTab(open("/a.kimo"), "t2"), disk("/a.kimo"), () => "x")
    expect(s.active).toBe("t1")
    expect(s.tabs.length).toBe(2)
  })
})

describe("Close", () => {
  test("the focused tab hands focus to its right, then left neighbour, then Home", () => {
    let s: TabsState = { ...open("/a.kimo", "/b.kimo", "/c.kimo"), active: "t2" }
    s = removeTab(s, "t2")
    expect(s.active).toBe("t3")
    s = removeTab(s, "t3")
    expect(s.active).toBe("t1")
    s = removeTab(s, "t1")
    expect(s.active).toBeNull()
    expect(s.tabs).toEqual([])
  })

  test("closing a background tab keeps the focus", () => {
    const s = removeTab(open("/a.kimo", "/b.kimo"), "t1")
    expect(s.active).toBe("t2")
    expect(removeTab(s, "nope")).toBe(s)
  })
})

describe("Drag to reorder", () => {
  test("moves a tab to an index, clamped", () => {
    const s = open("/a.kimo", "/b.kimo", "/c.kimo")
    expect(refs(moveTab(s, "t1", 2))).toEqual(["/b.kimo", "/c.kimo", "/a.kimo"])
    expect(refs(moveTab(s, "t3", -5))).toEqual(["/c.kimo", "/a.kimo", "/b.kimo"])
    expect(moveTab(s, "t2", 1)).toBe(s)
  })

  test("the drop index follows the other tabs' midpoints", () => {
    expect(dropIndex(5, [10, 30, 50])).toBe(0)
    expect(dropIndex(31, [10, 30, 50])).toBe(2)
    expect(dropIndex(99, [10, 30, 50])).toBe(3)
  })
})

describe("Save as and .pen: the tab follows its file", () => {
  test("retarget renames in place; a duplicate tab goes", () => {
    const s = open("/a.kimo", "/b.kimo")
    expect(refs(retarget(s, disk("/a.kimo"), disk("/c.kimo")))).toEqual(["/c.kimo", "/b.kimo"])
    const merged = retarget(s, disk("/a.kimo"), disk("/b.kimo"))
    expect(refs(merged)).toEqual(["/b.kimo"])
    expect(merged.active).toBe("t1")
  })
})

describe("Switch: ⌘⇧] / ⌘⇧[, ⌘1…⌘8, ⌘9", () => {
  const s = { ...open("/a.kimo", "/b.kimo", "/c.kimo"), active: null }

  test("next / previous wrap around Home and the file tabs", () => {
    expect(stepTab(s, 1)).toBe("t1")
    expect(stepTab(s, -1)).toBe("t3")
    expect(stepTab({ ...s, active: "t3" }, 1)).toBeNull()
  })

  test("⌘1 is Home, ⌘2… the file tabs by position, ⌘9 the last", () => {
    expect(tabAt(s, 1)).toBeNull()
    expect(tabAt(s, 2)).toBe("t1")
    expect(tabAt(s, 4)).toBe("t3")
    expect(tabAt(s, 5)).toBeUndefined()
    expect(tabAt(s, 9)).toBe("t3")
    expect(tabAt(EMPTY_TABS, 9)).toBeNull()
  })

  const key = (code: string, k: string, mods: { shift?: boolean; alt?: boolean } = {}) => ({
    key: k,
    code,
    metaKey: true,
    ctrlKey: false,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  })

  test("keys map to commands (Ctrl works as ⌘)", () => {
    expect(tabCommandFor(key("KeyT", "t"))).toEqual({ kind: "new" })
    expect(tabCommandFor(key("KeyW", "w"))).toEqual({ kind: "close" })
    expect(tabCommandFor(key("BracketRight", "}", { shift: true }))).toEqual({
      kind: "step",
      dir: 1,
    })
    expect(tabCommandFor(key("BracketLeft", "{", { shift: true }))).toEqual({
      kind: "step",
      dir: -1,
    })
    expect(tabCommandFor(key("Digit3", "3"))).toEqual({ kind: "goto", n: 3 })
    expect(tabCommandFor(key("Digit9", "9"))).toEqual({ kind: "goto", n: 9 })
    expect(tabCommandFor({ ...key("Digit1", "1"), metaKey: false, ctrlKey: true })).toEqual({
      kind: "goto",
      n: 1,
    })
    // Not ours: ⌘] (Bring forward), ⌘0 (zoom 100%), ⌥⌘T, plain T.
    expect(tabCommandFor(key("BracketRight", "]"))).toBeNull()
    expect(tabCommandFor(key("Digit0", "0"))).toBeNull()
    expect(tabCommandFor(key("KeyT", "†", { alt: true }))).toBeNull()
    expect(tabCommandFor({ ...key("KeyT", "t"), metaKey: false })).toBeNull()
  })

  test("no clash with the existing global bindings", () => {
    const tabIds = ["newTab", "closeTab", "nextTab", "previousTab", "goToTab", "lastTab"]
    const events = [
      key("KeyT", "t"),
      key("KeyW", "w"),
      key("BracketRight", "}", { shift: true }),
      key("BracketLeft", "{", { shift: true }),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => key(`Digit${n}`, String(n))),
    ]
    const others = [
      "bringForward",
      "sendBackward",
      "zoomTo100",
      "newFile",
      "save",
      "askKimo",
      "preview",
    ]
    for (const e of events) {
      expect(tabIds.filter((id) => matches(id, e)).length).toBe(1)
      for (const id of others) {
        try {
          expect(matches(id, e)).toBe(false)
        } catch (err) {
          if (String(err).includes("Unknown shortcut")) continue
          throw err
        }
      }
    }
  })
})

describe("Restore (On launch › Last files)", () => {
  function memoryStorage() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
  }

  test("saved tabs keep files on disk in order; new tabs and untitled files drop", () => {
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
  })

  test("the record keeps the tabs and focused file of the most recent window", () => {
    const st = memoryStorage()
    noteWindowTabs("main", { tabs: ["/a.kimo", "/b.kimo"], active: "/b.kimo" }, 10, st)
    noteWindowTabs("editor-2", { tabs: ["/c.kimo"], active: null }, 20, st)
    expect(takeLastWindow(st)).toEqual({ tabs: ["/c.kimo"], active: null })
    expect(takeLastWindow(st)).toBeNull()
    // Records written before tabs (one file per window) still restore.
    noteWindowFile("main", "/old.kimo", 5, st)
    st.setItem("kimo.lastFiles", JSON.stringify({ main: { ref: "/old.kimo", at: 5 } }))
    expect(takeLastWindow(st)).toEqual({ tabs: ["/old.kimo"], active: "/old.kimo" })
    // No tabs forgets the window.
    noteWindowTabs("main", { tabs: ["/a.kimo"], active: "/a.kimo" }, 10, st)
    noteWindowTabs("main", { tabs: [], active: null }, 11, st)
    expect(takeLastWindow(st)).toBeNull()
  })

  test("restored tabs are deduplicated, in order, Home in front", () => {
    const s = restoredTabs(["/a.kimo", "/b.kimo", "/a.kimo"], ids())
    expect(refs(s)).toEqual(["/a.kimo", "/b.kimo"])
    expect(s.active).toBeNull()
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

  test("switching navigates to the tab's route; ⌘1 shows Home", async () => {
    const { tabs, paths } = await harness()
    tabs.route(disk(FILE))
    tabs.route(disk(B))
    tabs.run({ kind: "step", dir: 1 })
    expect(tabs.getState().active).toBeNull()
    tabs.run({ kind: "goto", n: 2 })
    expect(paths.at(-1)).toBe(`/disk/${encodeURIComponent(FILE)}`)
    tabs.run({ kind: "goto", n: 1 })
    expect(paths.at(-1)).toBe("/")
    tabs.run({ kind: "new" })
    expect(tabs.getState().tabs.at(-1)?.target).toBeNull()
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

  test("Save as moves the tab to the new file", async () => {
    const { platform, manager, tabs } = await harness()
    const u = await manager.newUntitled()
    tabs.route(disk(u.ref))
    await sleep(5)
    u.store.apply(frame("Frame00001"), { origin: "user" })
    const target = `${ROOT}/saved.kimo`
    platform.dialogs.saveFile = async () => target
    await u.saveAs()
    await waitFor(() => tabs.getState().tabs[0]?.target?.kind === "disk", 1000, "tab")
    await waitFor(
      () => (tabs.getState().tabs[0]?.target as { ref?: string } | null)?.ref === target,
      1000,
      "retargeted",
    )
    tabs.route(disk(target))
    expect(tabs.getState().tabs.length).toBe(1)
  })

  test("drag out closes the file here, then opens it in a new window", async () => {
    const { platform, manager, tabs } = await harness()
    tabs.route(disk(FILE))
    await manager.open(FILE)
    await sleep(5)
    const id = tabs.getState().tabs[0]?.id ?? ""
    expect(tabs.canDragOut(id)).toBe(true)
    expect(await tabs.dragOut(id)).toBe(true)
    expect(manager.sessions().length).toBe(0)
    expect(platform.control.calls).toContain(`openFileInNewWindow ${FILE}`)
    expect(tabs.getState().tabs).toEqual([])
  })

  test("⌘W on the pinned Home tab closes the window (desktop)", async () => {
    const { platform, tabs } = await harness()
    tabs.run({ kind: "close" })
    await sleep(1)
    expect(platform.control.calls).toContain("close")
  })
})
