import { describe, expect, test } from "bun:test"
import { embedShaders, MAX_SHADER_BYTES, sha256, toHex, utf8 } from "../../src/mp"

const GLSL = utf8("precision mediump float;\nvoid main(){ gl_FragColor = vec4(1.0); }\n")

function store() {
  const files = new Map<string, Uint8Array>()
  const puts: { key: string; entry: unknown }[] = []
  return {
    files,
    puts,
    putKey: async (key: string, bytes: Uint8Array, entry?: unknown) => {
      files.set(key, bytes)
      puts.push({ key, entry })
      return { src: `./assets/${key}` }
    },
  }
}

describe("embedShaders", () => {
  test("rewrites relative sources to hash-named assets and reports entries", async () => {
    const assets = store()
    const sha = toHex(await sha256(GLSL))
    const doc = {
      children: [
        { fill: { kind: "shader", src: "./shaders/x.glsl", uniforms: { a: 1 } } },
        {
          fills: [
            { kind: "shader", src: "./shaders/x.glsl" },
            { kind: "solid", color: "#fff" },
          ],
        },
      ],
    }
    const out = await embedShaders(
      doc,
      async (p) => (p === "./shaders/x.glsl" ? GLSL : null),
      assets,
    )
    const key = `${sha.slice(0, 16)}.glsl`
    expect(out.embedded).toBe(1)
    expect(out.missing).toEqual([])
    expect(out.doc.children[0]?.fill).toEqual({
      kind: "shader",
      src: `./assets/${key}`,
      uniforms: { a: 1 },
    })
    expect((out.doc.children[1] as { fills: { src: string }[] }).fills[0]?.src).toBe(
      `./assets/${key}`,
    )
    expect(out.entries[key]).toEqual({
      mime: "text/x-glsl",
      bytes: GLSL.length,
      name: "x.glsl",
      sha256: sha,
    })
    expect(assets.puts.length).toBe(1)
    // The input is not mutated.
    expect(doc.children[0]?.fill?.src).toBe("./shaders/x.glsl")
  })

  test("already embedded and unreadable sources are left alone; unreadable ones are reported", async () => {
    const assets = store()
    const doc = [
      { kind: "shader", src: "./assets/0123456789abcdef.glsl" },
      { kind: "shader", src: "./shaders/gone.glsl" },
      { kind: "image", src: "./shaders/not-a-shader.png" },
    ]
    const out = await embedShaders(doc, async () => null, assets)
    expect(out.doc).toEqual(doc)
    expect(out.embedded).toBe(0)
    expect(out.missing).toEqual(["./shaders/gone.glsl"])
    expect(assets.puts.length).toBe(0)
  })

  test("a store that rejects the bytes counts as missing; a throwing reader too", async () => {
    const out = await embedShaders(
      [
        { kind: "shader", src: "a.glsl" },
        { kind: "shader", src: "b.glsl" },
      ],
      async (p) => {
        if (p === "b.glsl") throw new Error("denied")
        return GLSL
      },
      { putKey: async () => null },
    )
    expect(out.missing).toEqual(["a.glsl", "b.glsl"])
    expect(out.embedded).toBe(0)
  })

  test("absolute, traversal and URL sources are never read", async () => {
    const reads: string[] = []
    const bad = [
      "/Users/x/.ssh/id_rsa",
      "\\\\server\\share\\a.glsl",
      "C:\\Users\\x\\a.glsl",
      "../../.ssh/id_rsa",
      "./shaders/../../secret",
      "shaders\\..\\..\\secret",
      "file:///etc/passwd",
      "https://example.com/a.glsl",
    ]
    const doc = { fills: bad.map((src) => ({ kind: "shader", src })) }
    const out = await embedShaders(
      doc,
      async (p) => {
        reads.push(p)
        return GLSL
      },
      store(),
    )
    expect(reads).toEqual([])
    expect(out.embedded).toBe(0)
    expect(out.missing).toEqual(bad)
    expect(out.doc).toEqual(doc)
  })
  test("only shader files are read: a key or credential file named by a shader paint is not", async () => {
    const reads: string[] = []
    const odd = ["./keys/id_ed25519", "./notes.txt", "./a.glsl.png", "./shaders/x.GLSL.bak"]
    const doc = { fills: odd.map((src) => ({ kind: "shader", src })) }
    const assets = store()
    const out = await embedShaders(
      doc,
      async (p) => {
        reads.push(p)
        return GLSL
      },
      assets,
    )
    expect(reads).toEqual([])
    expect(out.embedded).toBe(0)
    expect(out.missing).toEqual(odd)
    expect(assets.puts.length).toBe(0)
  })

  test("a shader source over the size cap is not embedded", async () => {
    const assets = store()
    const huge = new Uint8Array(MAX_SHADER_BYTES + 1)
    const out = await embedShaders(
      [{ kind: "shader", src: "./big.glsl" }],
      async () => huge,
      assets,
    )
    expect(out.embedded).toBe(0)
    expect(out.missing).toEqual(["./big.glsl"])
    expect(assets.puts.length).toBe(0)
  })
})
