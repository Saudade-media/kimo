import { describe, expect, test } from "bun:test"
import {
  createFontGuard,
  embedShaders,
  fontShareDecision,
  MAX_SHADER_BYTES,
  PACK_FONT_FAMILIES,
  sha256,
  toHex,
  utf8,
} from "../../src/mp"

describe("font policy", () => {
  test("bundled, pack and google families share, case and spacing insensitive", () => {
    expect(fontShareDecision({ family: " jetbrains  mono ", source: "bundled" })).toBe("share")
    for (const family of PACK_FONT_FAMILIES)
      expect(fontShareDecision({ family, source: "pack" })).toBe("share")
    expect(fontShareDecision({ family: "Anybody", source: "google" })).toBe("share")
  })

  test("anything without a known sharable source fails closed to name-only", () => {
    expect(fontShareDecision({ family: "Helvetica Neue", source: "pack" })).toBe("name-only")
    expect(fontShareDecision({ family: "Inter" })).toBe("name-only")
    expect(fontShareDecision({ family: "Roboto", source: "bundled" })).toBe("name-only")
    expect(fontShareDecision({ family: "Inter", source: "user" })).toBe("name-only")
  })

  test("the guard filters and warns once per family", () => {
    const warned: string[][] = []
    const guard = createFontGuard((families) => warned.push(families))
    const faces = [
      { family: "Inter", weight: 400, source: "bundled" as const },
      { family: "Acme Sans", weight: 400 },
      { family: "Acme Sans", weight: 700 },
      { family: "Other Co", weight: 400 },
    ]
    expect(guard.filter(faces).map((f) => f.family)).toEqual(["Inter"])
    expect(warned).toEqual([["Acme Sans", "Other Co"]])
    guard.filter(faces)
    expect(warned.length).toBe(1)
  })
})

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

  test("already embedded sources are left alone; unreadable or throwing ones are reported missing", async () => {
    const doc = [
      { kind: "shader", src: "./assets/0123456789abcdef.glsl" },
      { kind: "shader", src: "./shaders/gone.glsl" },
      { kind: "shader", src: "./shaders/denied.glsl" },
    ]
    const read = async (p: string) => {
      if (p.endsWith("denied.glsl")) throw new Error("denied")
      return p.endsWith("gone.glsl") ? null : GLSL
    }
    const out = await embedShaders(doc, read, store())
    expect(out.embedded).toBe(0)
    expect(out.missing).toEqual(["./shaders/gone.glsl", "./shaders/denied.glsl"])
    expect(out.doc).toEqual(doc)
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
