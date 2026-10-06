/**
 * Board 37 §9 "File previews": what a preview shows, scheduling (debounce, idle, one at a time,
 * back-off), skip-if-unchanged, the timeout that keeps the old preview, the desktop cache's
 * keying, cleanup of deleted files and the template cover seed.
 */
import { describe, expect, test } from "bun:test"
import { createFileThumbnails, createMemoryThumbnails, thumbnailKey } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { seedTemplateCover } from "../src/home/templates"
import {
  contentHash,
  createThumbnailScheduler,
  isTemplateHash,
  refreshThumbnail,
  type SchedulerClock,
  subtreeSize,
  type ThumbnailDoc,
  templateHash,
  thumbnailTargets,
} from "../src/thumbnails/model"
import { copyThumbnail, forgetThumbnails } from "../src/thumbnails/store"

type N = { type: string; parent?: string; page?: string }
function doc(nodes: Record<string, N>, pages?: Record<string, { name: string; order: string }>) {
  const ids = Object.keys(nodes)
  return {
    toHeader: () => (pages ? { pages } : {}),
    children: (p: string | null) => ids.filter((id) => (nodes[id]?.parent ?? null) === p),
    getNode: (id: string) => nodes[id],
  } satisfies ThumbnailDoc
}

describe("thumbnailTargets", () => {
  test("the first top-level frame", () => {
    const d = doc({ t: { type: "text" }, a: { type: "frame" }, b: { type: "frame" } })
    expect(thumbnailTargets(d)).toEqual(["a"])
  })
  test("on the first page only", () => {
    const pages = { p1: { name: "One", order: "a" }, p2: { name: "Two", order: "b" } }
    const d = doc(
      {
        x: { type: "frame", page: "p2" },
        y: { type: "rectangle", page: "p1" },
        z: { type: "frame", page: "p1" },
      },
      pages,
    )
    expect(thumbnailTargets(d)).toEqual(["z"])
  })
  test("no frame: every root of the first page (their union)", () => {
    const d = doc({
      r: { type: "rectangle" },
      t: { type: "text" },
      c: { type: "text", parent: "r" },
    })
    expect(thumbnailTargets(d)).toEqual(["r", "t"])
  })
  test("an empty document has nothing to preview", () => {
    expect(thumbnailTargets(doc({}))).toEqual([])
  })
  test("subtreeSize counts descendants and stops past the cap", () => {
    const d = doc({
      a: { type: "frame" },
      b: { type: "frame", parent: "a" },
      c: { type: "text", parent: "b" },
    })
    expect(subtreeSize(d, ["a"])).toBe(3)
    expect(subtreeSize(d, ["a"], 1)).toBe(2)
  })
})

describe("refreshThumbnail", () => {
  const png = new Uint8Array([137, 80, 78, 71])
  const deps = (over: Partial<Parameters<typeof refreshThumbnail>[0]> = {}) => {
    const writes: string[] = []
    let renders = 0
    return {
      writes,
      get renders() {
        return renders
      },
      d: {
        hash: () => "h2",
        storedHash: async () => "h1",
        render: async () => {
          renders++
          return png
        },
        write: async (h: string) => {
          writes.push(h)
        },
        ...over,
      },
    }
  }
  test("renders and stores under the new hash", async () => {
    const x = deps()
    expect(await refreshThumbnail(x.d)).toBe("written")
    expect(x.writes).toEqual(["h2"])
  })
  test("skips when the content did not change (no render)", async () => {
    const x = deps({ storedHash: async () => "h2" })
    expect(await refreshThumbnail(x.d)).toBe("unchanged")
    expect(x.renders).toBe(0)
    expect(x.writes).toEqual([])
  })
  test("keeps a template cover when asked (before the first save)", async () => {
    const x = deps({ storedHash: async () => templateHash("saas-app"), keep: isTemplateHash })
    expect(await refreshThumbnail(x.d)).toBe("unchanged")
    const y = deps({ storedHash: async () => templateHash("saas-app"), keep: () => false })
    expect(await refreshThumbnail(y.d)).toBe("written")
  })
  test("a render past the timeout keeps the old preview", async () => {
    const x = deps({ render: () => new Promise(() => {}), timeoutMs: 10 })
    expect(await refreshThumbnail(x.d)).toBe("timeout")
    expect(x.writes).toEqual([])
  })
  test("nothing to render, too large, untitled and failures write nothing", async () => {
    expect(await refreshThumbnail(deps({ render: async () => null }).d)).toBe("no-target")
    expect(await refreshThumbnail(deps({ render: async () => "too-large" }).d)).toBe("too-large")
    expect(await refreshThumbnail(deps({ hash: () => null }).d)).toBe("no-target")
    const failing = deps({
      write: async () => {
        throw new Error("disk full")
      },
    })
    expect(await refreshThumbnail(failing.d)).toBe("failed")
  })
  test("contentHash is stable and content-addressed", async () => {
    expect(await contentHash("a")).toBe(await contentHash(new TextEncoder().encode("a")))
    expect(await contentHash("a")).not.toBe(await contentHash("b"))
    expect((await contentHash("a")).length).toBe(32)
  })
})

/** A manual clock: timers fire on `advance`, idle callbacks on `idleNow`. */
function fakeClock() {
  let t = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const idles: (() => void)[] = []
  const clock: SchedulerClock = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { at: t + ms, fn })
      return id
    },
    clearTimeout(h) {
      timers.delete(h as number)
    },
    idle(fn) {
      idles.push(fn)
      return () => {
        const i = idles.indexOf(fn)
        if (i >= 0) idles.splice(i, 1)
      }
    },
  }
  return {
    clock,
    advance(ms: number) {
      t += ms
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at))
        if (x.at <= t) {
          timers.delete(id)
          x.fn()
        }
    },
    idleNow() {
      for (const fn of idles.splice(0)) fn()
    },
    get pendingIdle() {
      return idles.length
    },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("createThumbnailScheduler", () => {
  test("debounces pokes and runs only when idle", async () => {
    const c = fakeClock()
    let runs = 0
    const s = createThumbnailScheduler(
      async () => {
        runs++
      },
      { delayMs: 100, minIntervalMs: 0, clock: c.clock },
    )
    s.poke()
    c.advance(50)
    s.poke()
    c.advance(99)
    expect(c.pendingIdle).toBe(0)
    c.advance(1)
    expect(runs).toBe(0) // waits for idle
    expect(s.busy).toBe(true)
    c.idleNow()
    await flush()
    expect(runs).toBe(1)
    expect(s.busy).toBe(false)
  })
  test("keeps the minimum interval between runs and backs off slow runs", async () => {
    const c = fakeClock()
    let runs = 0
    const s = createThumbnailScheduler(
      async () => {
        runs++
        c.advance(500) // a slow run (over the 120 ms budget)
      },
      { delayMs: 10, minIntervalMs: 1000, clock: c.clock },
    )
    s.poke()
    c.advance(10)
    c.idleNow()
    await flush()
    expect(runs).toBe(1)
    s.poke()
    c.advance(1000) // started at 10, interval doubled to 2000 → not before 2010
    c.idleNow()
    await flush()
    expect(runs).toBe(1)
    c.advance(1000)
    c.idleNow()
    await flush()
    expect(runs).toBe(2)
  })
  test("one run at a time; a poke during a run schedules one more", async () => {
    const c = fakeClock()
    let release: () => void = () => {}
    let runs = 0
    const s = createThumbnailScheduler(
      () => {
        runs++
        return new Promise<void>((r) => {
          release = r
        })
      },
      { delayMs: 10, minIntervalMs: 0, clock: c.clock },
    )
    s.poke()
    c.advance(10)
    c.idleNow()
    s.poke()
    s.poke()
    expect(runs).toBe(1)
    release()
    await flush()
    c.advance(10)
    c.idleNow()
    await flush()
    expect(runs).toBe(2)
    release()
    await flush()
    c.advance(100)
    c.idleNow()
    expect(runs).toBe(2)
  })
  test("input defers a pending run; with nothing pending it does nothing", async () => {
    const c = fakeClock()
    let runs = 0
    const s = createThumbnailScheduler(
      async () => {
        runs++
      },
      { delayMs: 100, minIntervalMs: 0, clock: c.clock },
    )
    s.defer()
    expect(s.busy).toBe(false)
    s.poke()
    c.advance(90)
    s.defer() // the user moves the pointer
    c.advance(90)
    expect(c.pendingIdle).toBe(0)
    c.advance(10)
    c.idleNow()
    await flush()
    expect(runs).toBe(1)
  })
  test("dispose cancels a pending run", () => {
    const c = fakeClock()
    let runs = 0
    const s = createThumbnailScheduler(
      async () => {
        runs++
      },
      { delayMs: 10, clock: c.clock },
    )
    s.poke()
    s.dispose()
    c.advance(100)
    c.idleNow()
    expect(runs).toBe(0)
  })
})

describe("desktop preview cache (~/.kimo/thumbs)", () => {
  const png = (n: number) => new Uint8Array([137, 80, 78, 71, n])
  const setup = () => {
    const platform = createMemoryPlatform()
    return { platform, thumbs: createFileThumbnails(platform.files, "/home/test/.kimo/thumbs/") }
  }
  test("keyed by the file's path: <sha256(path)[:32]>.png + .json", async () => {
    const { platform, thumbs } = setup()
    const key = await thumbnailKey("/w/a.kimo")
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toBe(await thumbnailKey("/w/b.kimo"))
    await thumbs.write("/w/a.kimo", "h1", png(1))
    expect(await platform.files.stat(`/home/test/.kimo/thumbs/${key}.png`)).not.toBeNull()
    const meta = JSON.parse(
      (await platform.files.readText(`/home/test/.kimo/thumbs/${key}.json`)).text,
    )
    expect(meta).toMatchObject({ ref: "/w/a.kimo", hash: "h1" })
    expect([...((await thumbs.read("/w/a.kimo")) ?? [])]).toEqual([...png(1)])
    expect((await thumbs.info("/w/a.kimo"))?.hash).toBe("h1")
    expect(await thumbs.read("/w/b.kimo")).toBeNull()
    expect(await thumbs.info("/w/b.kimo")).toBeNull()
  })
  test("rewrites replace the preview and its hash", async () => {
    const { thumbs } = setup()
    await thumbs.write("/w/a.kimo", "h1", png(1))
    await thumbs.write("/w/a.kimo", "h2", png(2))
    expect((await thumbs.info("/w/a.kimo"))?.hash).toBe("h2")
    expect((await thumbs.read("/w/a.kimo"))?.[4]).toBe(2)
  })
  test("rename moves the preview; remove drops it", async () => {
    const { thumbs } = setup()
    await thumbs.write("/w/a.kimo", "h1", png(1))
    await thumbs.move("/w/a.kimo", "/w/c.kimo")
    expect(await thumbs.read("/w/a.kimo")).toBeNull()
    expect((await thumbs.info("/w/c.kimo"))?.hash).toBe("h1")
    await thumbs.remove("/w/c.kimo")
    expect(await thumbs.read("/w/c.kimo")).toBeNull()
    await thumbs.remove("/w/never.kimo") // no-op
  })
  test("the memory host has a preview cache apart from its files", async () => {
    const platform = createMemoryPlatform()
    expect(platform.thumbnails).toBeDefined()
    await platform.thumbnails?.write("/w/a.kimo", "h", png(3))
    expect((await platform.files.list("/home/test/.kimo/thumbs")).length).toBe(0)
    expect((await platform.thumbnails?.read("/w/a.kimo"))?.[4]).toBe(3)
  })
})

describe("cleanup and copies", () => {
  test("files deleted for good from the Trash lose their previews", async () => {
    const t = createMemoryThumbnails()
    await t.write("/w/a.kimo", "h", new Uint8Array([1]))
    await t.write("/w/b.kimo", "h", new Uint8Array([2]))
    await forgetThumbnails(t, ["/w/a.kimo", "/w/gone.kimo"])
    expect(await t.read("/w/a.kimo")).toBeNull()
    expect(await t.read("/w/b.kimo")).not.toBeNull()
    await forgetThumbnails(null, ["/w/b.kimo"]) // no cache: no-op
  })
  test("a duplicate starts with its original's preview", async () => {
    const t = createMemoryThumbnails()
    await t.write("/w/a.kimo", "h7", new Uint8Array([7]))
    await copyThumbnail(t, "/w/a.kimo", "/w/a copy.kimo")
    expect((await t.info("/w/a copy.kimo"))?.hash).toBe("h7")
    await copyThumbnail(t, "/w/none.kimo", "/w/x.kimo")
    expect(await t.read("/w/x.kimo")).toBeNull()
  })
})

describe("template cover seed", () => {
  test("a file made from a template starts with the cover, under a template hash", async () => {
    const t = createMemoryThumbnails()
    const urls: string[] = []
    await seedTemplateCover(t, "/w/saas.kimo", "saas-app", async (url) => {
      urls.push(url)
      return new Uint8Array([137, 80, 78, 71])
    })
    expect(urls[0]).toMatch(/saas-app\/cover\.png$/)
    expect((await t.info("/w/saas.kimo"))?.hash).toBe(templateHash("saas-app"))
    expect(isTemplateHash(templateHash("saas-app"))).toBe(true)
  })
  test("a missing cover or a failed fetch leaves the placeholder", async () => {
    const t = createMemoryThumbnails()
    await seedTemplateCover(t, "/w/x.kimo", "no-such-template", async () => new Uint8Array([1]))
    await seedTemplateCover(t, "/w/y.kimo", "saas-app", async () => {
      throw new Error("offline")
    })
    expect(await t.read("/w/x.kimo")).toBeNull()
    expect(await t.read("/w/y.kimo")).toBeNull()
  })
})
