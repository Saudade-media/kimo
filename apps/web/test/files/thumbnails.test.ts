/**
 * File previews: which layers a preview shows, skipping unchanged content, the timeout that keeps
 * the old preview, and the desktop cache's keying.
 */
import { describe, expect, test } from "bun:test"
import { createFileThumbnails, thumbnailKey } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  isTemplateHash,
  refreshThumbnail,
  type ThumbnailDoc,
  templateHash,
  thumbnailTargets,
} from "../../src/thumbnails/model"

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
  test("the first top-level frame of the first page", () => {
    expect(
      thumbnailTargets(doc({ t: { type: "text" }, a: { type: "frame" }, b: { type: "frame" } })),
    ).toEqual(["a"])
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

  test("renders under the new hash, but skips unchanged content and a kept template cover", async () => {
    const x = deps()
    expect(await refreshThumbnail(x.d)).toBe("written")
    expect(x.writes).toEqual(["h2"])
    const same = deps({ storedHash: async () => "h2" })
    expect(await refreshThumbnail(same.d)).toBe("unchanged")
    expect(same.renders).toBe(0)
    const cover = deps({ storedHash: async () => templateHash("saas-app"), keep: isTemplateHash })
    expect(await refreshThumbnail(cover.d)).toBe("unchanged")
  })

  test("a render past the timeout keeps the old preview", async () => {
    const x = deps({ render: () => new Promise(() => {}), timeoutMs: 10 })
    expect(await refreshThumbnail(x.d)).toBe("timeout")
    expect(x.writes).toEqual([])
  })

  test("nothing to render, too large and failures write nothing", async () => {
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
})

describe("desktop preview cache (~/.kimo/thumbs)", () => {
  const png = (n: number) => new Uint8Array([137, 80, 78, 71, n])

  test("keyed by the file's path; a rewrite replaces the preview; rename moves it; remove drops it", async () => {
    const platform = createMemoryPlatform()
    const thumbs = createFileThumbnails(platform.files, "/home/test/.kimo/thumbs/")
    const key = await thumbnailKey("/w/a.kimo")
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toBe(await thumbnailKey("/w/b.kimo"))
    await thumbs.write("/w/a.kimo", "h1", png(1))
    expect(await platform.files.stat(`/home/test/.kimo/thumbs/${key}.png`)).not.toBeNull()
    expect([...((await thumbs.read("/w/a.kimo")) ?? [])]).toEqual([...png(1)])
    expect((await thumbs.info("/w/a.kimo"))?.hash).toBe("h1")
    expect(await thumbs.read("/w/b.kimo")).toBeNull()
    await thumbs.write("/w/a.kimo", "h2", png(2))
    expect((await thumbs.info("/w/a.kimo"))?.hash).toBe("h2")
    expect((await thumbs.read("/w/a.kimo"))?.[4]).toBe(2)
    await thumbs.move("/w/a.kimo", "/w/c.kimo")
    expect(await thumbs.read("/w/a.kimo")).toBeNull()
    expect((await thumbs.info("/w/c.kimo"))?.hash).toBe("h2")
    await thumbs.remove("/w/c.kimo")
    expect(await thumbs.read("/w/c.kimo")).toBeNull()
  })
})
