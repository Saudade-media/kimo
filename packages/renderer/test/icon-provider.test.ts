import { describe, expect, test } from "bun:test"
import { packIconSource, SourceIconProvider } from "../src/icons/provider"
import { PACK_SHARDS, shardOf } from "../src/icons/sets"

const shard = `lucide/${shardOf("heart", PACK_SHARDS.lucide ?? 1)}.json`
const glyph = [[0, 0, 24, 24], [["M0 0L24 24", 1]], 2]

describe("icon provider: transient failures", () => {
  test("a failed shard fetch is retried, not cached as missing", async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return calls === 1
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ heart: glyph }), { status: 200 })
    }
    const p = new SourceIconProvider(packIconSource({ [shard]: "u" }, fetchFn))
    const loaded: string[] = []
    p.onIconLoaded((_, n) => loaded.push(n))
    expect(await p.load("lucide", "heart")).toBeNull()
    expect(p.status("lucide", "heart")).toBe("failed")
    // The provider retries on its own after the backoff (1 s) and notifies listeners.
    await new Promise((r) => setTimeout(r, 1100))
    await Promise.resolve()
    expect(p.status("lucide", "heart")).toBe("ready")
    expect(p.get("lucide", "heart")?.name).toBe("heart")
    expect(loaded).toEqual(["heart"])
    expect(calls).toBe(2)
  })

  test("a glyph absent from its shard is missing (final)", async () => {
    const fetchFn = async () => new Response(JSON.stringify({}), { status: 200 })
    const p = new SourceIconProvider(packIconSource({ [shard]: "u" }, fetchFn))
    expect(await p.load("lucide", "heart")).toBeNull()
    expect(p.status("lucide", "heart")).toBe("missing")
  })

  test("a failed catalog is not cached", async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return calls === 1
        ? new Response("x", { status: 500 })
        : new Response(JSON.stringify([{ name: "heart" }]), { status: 200 })
    }
    const p = new SourceIconProvider(packIconSource({ "lucide/catalog.json": "c" }, fetchFn))
    expect(await p.catalog("lucide")).toEqual([])
    expect((await p.catalog("lucide")).map((e) => e.name)).toEqual(["heart"])
  })
})
