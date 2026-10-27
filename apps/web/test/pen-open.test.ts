/**
 * Opening a pen.dev `.pen` file on desktop: converted once into a `.kimo` beside it, which is
 * what the session opens; the `.pen` is never written and existing files are never replaced.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { parse, validate } from "@kimo/core-schema"
import { convertPenFile, isPenPath } from "../src/platform/pen"
import { docText, setup } from "./m4-helpers"

const DIR = "/Users/me/Projects/loom"
const PEN = `${DIR}/design.pen`

const penText = (label = "Hello") =>
  JSON.stringify({
    version: "2.20",
    children: [
      {
        type: "frame",
        id: "Scr01",
        name: "Screen",
        width: 200,
        height: 100,
        layout: "vertical",
        children: [{ type: "text", id: "Txt01", content: label, fill: "#000000", fontSize: 14 }],
      },
    ],
  })

describe("opening .pen files", () => {
  test("isPenPath", () => {
    expect(isPenPath("/a/b.pen")).toBe(true)
    expect(isPenPath("C:\\a\\B.PEN")).toBe(true)
    expect(isPenPath("/a/b.kimo")).toBe(false)
  })

  test("the session opens the .kimo converted beside the .pen", async () => {
    const { platform, manager } = await setup({ [PEN]: penText() })
    const session = await manager.open(PEN)
    expect(session.ref).toBe(`${DIR}/design.kimo`)
    expect(manager.get(`${DIR}/design.kimo`)).toBe(session)
    const doc = parse((await platform.files.readText(`${DIR}/design.kimo`)).text) as {
      meta: Record<string, unknown>
      nodes: Record<string, { content?: unknown }>
    }
    expect(doc.meta.name).toBe("design")
    expect(doc.meta["pen.source"]).toMatchObject({ file: "design.pen" })
    expect(Object.values(doc.nodes).some((n) => n.content === "Hello")).toBe(true)
    // The .pen itself is untouched.
    expect((await platform.files.readText(PEN)).text).toBe(penText())
    // Opening it again in the same window reuses the session; lookups by the .pen path find it.
    expect(await manager.open(PEN)).toBe(session)
    expect(manager.get(PEN)).toBe(session)
  })

  test("a launch request for a .pen (Finder, Open With, argv) opens and reports its session", async () => {
    const { platform, manager } = await setup({ [PEN]: penText() })
    const opened: string[] = []
    manager.install((s) => opened.push(s.ref))
    // Cold start: the runtime drains the initial requests, then looks the session up by ref.
    await manager.handleOpenRequest({ source: "file-association", refs: [PEN] })
    expect(manager.get(PEN)?.ref).toBe(`${DIR}/design.kimo`)
    // Warm: an open request event while running.
    platform.control.open({ source: "file-association", refs: [PEN] })
    for (let i = 0; i < 50 && !opened.length; i++) await new Promise((r) => setTimeout(r, 10))
    expect(opened).toEqual([`${DIR}/design.kimo`])
  })

  test("reopening an unchanged .pen finds the earlier conversion", async () => {
    const { platform } = await setup({ [PEN]: penText() })
    const first = await convertPenFile(platform, PEN)
    expect(first).toMatchObject({ ref: `${DIR}/design.kimo`, created: true })
    const again = await convertPenFile(platform, PEN)
    expect(again).toMatchObject({ ref: `${DIR}/design.kimo`, created: false })
  })

  test("a changed .pen or an unrelated design.kimo gets the next free name", async () => {
    const unrelated = docText("Other")
    const { platform } = await setup({ [PEN]: penText(), [`${DIR}/design.kimo`]: unrelated })
    const a = await convertPenFile(platform, PEN)
    expect(a.ref).toBe(`${DIR}/design 2.kimo`)
    expect((await platform.files.readText(`${DIR}/design.kimo`)).text).toBe(unrelated)
    await platform.files.writeTextAtomic(PEN, penText("Changed"))
    const b = await convertPenFile(platform, PEN)
    expect(b.ref).toBe(`${DIR}/design 3.kimo`)
  })

  test("a .pen whose images cannot be read still converts to a valid file", async () => {
    const withImage = JSON.stringify({
      version: "2.20",
      children: [
        {
          type: "rectangle",
          id: "Img01",
          width: 10,
          height: 10,
          fill: { type: "image", url: "./missing.png", mode: "cover" },
        },
      ],
    })
    const { platform, manager } = await setup({ [PEN]: withImage })
    const c = await convertPenFile(platform, PEN)
    expect(c.warnings.map((w) => w.code)).toEqual(["IMAGE_MISSING"])
    expect(validate(parse((await platform.files.readText(c.ref)).text)).errors).toEqual([])
    const session = await manager.open(PEN)
    expect(session.store.readOnly).toBeNull()
  })

  test("an image named with a stray % does not stop the conversion", async () => {
    const withImage = JSON.stringify({
      version: "2.20",
      children: [
        {
          type: "rectangle",
          id: "Img01",
          width: 10,
          height: 10,
          fill: { type: "image", url: "./100%.png", mode: "cover" },
        },
      ],
    })
    const { platform } = await setup({ [PEN]: withImage, [`${DIR}/100%.png`]: "not a png" })
    const c = await convertPenFile(platform, PEN)
    expect(validate(parse((await platform.files.readText(c.ref)).text)).errors).toEqual([])
  })

  describe("image paths", () => {
    // A 1×1 PNG; the test runtime has no image decoder, so createImageBitmap is stubbed.
    const PNG = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    )
    const g = globalThis as { createImageBitmap?: unknown }
    const original = g.createImageBitmap
    beforeAll(() => {
      g.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
    })
    afterAll(() => {
      g.createImageBitmap = original
    })
    const withImage = (url: string) =>
      JSON.stringify({
        version: "2.20",
        children: [
          {
            type: "rectangle",
            id: "Img01",
            width: 10,
            height: 10,
            fill: { type: "image", url, mode: "cover" },
          },
        ],
      })
    const srcOf = (text: string) => /"src":"([^"]+)"/.exec(text)?.[1]

    test("a bare relative image path (images/a b.png, as pen.dev writes it) is stored", async () => {
      const { platform } = await setup({ [PEN]: withImage("images/a%20b.png") })
      await platform.files.writeBytesAtomic(`${DIR}/images/a b.png`, PNG, { mkdirs: true })
      const c = await convertPenFile(platform, PEN)
      expect(c.warnings).toEqual([])
      const src = srcOf((await platform.files.readText(c.ref)).text)
      expect(src).toMatch(/^\.\/assets\/[0-9a-f]{16}\.png$/)
      expect(await platform.files.stat(`${DIR}/${src?.slice(2)}`)).toBeTruthy()
    })

    test("reopening a conversion stores the images it could not load before", async () => {
      const { platform } = await setup({ [PEN]: withImage("images/a.png") })
      const first = await convertPenFile(platform, PEN)
      const before = srcOf((await platform.files.readText(first.ref)).text)
      expect(first.warnings.map((w) => w.code)).toEqual(["IMAGE_MISSING"])
      await platform.files.writeBytesAtomic(`${DIR}/images/a.png`, PNG, { mkdirs: true })
      const again = await convertPenFile(platform, PEN)
      expect(again).toMatchObject({ ref: first.ref, created: false })
      const text = (await platform.files.readText(again.ref)).text
      const after = srcOf(text)
      expect(after).not.toBe(before)
      expect(await platform.files.stat(`${DIR}/${after?.slice(2)}`)).toBeTruthy()
      expect(validate(parse(text)).errors).toEqual([])
    })
  })

  test("reopening a .pen edited on disk in the same window opens its new conversion", async () => {
    const { platform, manager } = await setup({ [PEN]: penText() })
    const first = await manager.open(PEN)
    expect(first.ref).toBe(`${DIR}/design.kimo`)
    await platform.files.writeTextAtomic(PEN, penText("Changed"))
    const second = await manager.open(PEN)
    expect(second.ref).toBe(`${DIR}/design 2.kimo`)
    expect(manager.get(PEN)?.ref).toBe(`${DIR}/design 2.kimo`)
  })

  test("a file that is not a .pen document is refused", async () => {
    const { platform } = await setup({ [PEN]: "not json" })
    await expect(convertPenFile(platform, PEN)).rejects.toThrow("not a readable .pen file")
    const { platform: p2 } = await setup({ [PEN]: JSON.stringify({ hello: 1 }) })
    await expect(convertPenFile(p2, PEN)).rejects.toThrow("not a .pen design document")
  })
})
