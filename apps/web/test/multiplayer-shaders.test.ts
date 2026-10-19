/** Shader embedding at share time (spec §16.6). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { contentDigest } from "../src/lib/assets"
import { makePeer, makeTarget, type Relay, startRelay } from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const GLSL = "void main() { gl_FragColor = vec4(1.0); }"

describe("shader embedding", () => {
  test("relative shader paths become hash-named assets in one system change", async () => {
    const owner = makePeer()
    const target = makeTarget()
    target.store.apply(
      [
        { op: "setHeader", set: { features: ["fill/shader"] } },
        {
          op: "insert",
          id: "Shader00001",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./shaders/glow.glsl" } },
        },
        {
          op: "insert",
          id: "Shader00002",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./shaders/gone.glsl" } },
        },
      ] as never,
      { origin: "user" },
    )
    const undoBefore = target.store.canUndo("user")
    const bytes = new TextEncoder().encode(GLSL)
    const sha = await contentDigest(bytes)
    const reads: string[] = []
    const shared = {
      ...target,
      readRelative: async (path: string) => {
        reads.push(path)
        return path === "./shaders/glow.glsl" ? bytes : null
      },
    }
    const logBefore = target.store.log().length
    const { room } = await owner.service.startSharing(shared, { relayUrl: relay.url })

    const key = `${sha.slice(0, 16)}.glsl`
    const fill = target.store.getNode("Shader00001")?.fill as { src: string }
    expect(fill.src).toBe(`./assets/${key}`)
    // The unreadable source is left as it was.
    const gone = target.store.getNode("Shader00002")
    expect((gone?.fill as unknown as { src: string } | undefined)?.src).toBe("./shaders/gone.glsl")
    const manifest = (
      target.store.toHeader() as { assets: Record<string, Record<string, unknown>> }
    ).assets
    expect(manifest[key]).toMatchObject({
      mime: "text/x-glsl",
      bytes: bytes.length,
      name: "glow.glsl",
      sha256: sha,
    })
    expect(await target.assets.bytes(key)).toEqual(bytes)
    // One non-undoable system load: the undo stack did not gain an entry.
    const loads = target.store
      .log()
      .slice(logBefore)
      .filter((e) => e.kind === "load")
    expect(loads).toHaveLength(1)
    expect(target.store.canUndo("user")).toBe(undoBefore)
    await owner.service.stopSharing(room)
  })
})
