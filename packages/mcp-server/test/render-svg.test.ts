/** `kimo_render format=svg` and the SVG/PDF export kit (measurer + canvas fonts; ADR 0013 §2, 0015). */
import { describe, expect, test } from "bun:test"
import type { DocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  createMemoryDocumentHost,
  createSceneService,
  type SceneServiceOptions,
} from "../src/index"
import { validateInput } from "../src/server"
import { expectOk, testClient } from "./conformance"

const LONG =
  "Kimo lays this paragraph out with the same Paragraph engine and fonts as the canvas, so the export breaks lines where the canvas does."

function setup(scene?: SceneServiceOptions) {
  const platform = createMemoryPlatform({ pid: 3100, files: {} })
  const host = createMemoryDocumentHost({
    platform,
    autosaveMs: 0,
    validate: validateInput,
    ...(scene ? { scene } : {}),
  })
  const h = {
    host,
    handlers: host.runtime.handlers,
    writeFile: async (p: string, t: string) => platform.control.writeExternal(p, t),
    readFile: async (p: string) => platform.control.readFile(p),
    dispose: () => host.dispose(),
  }
  return {
    host,
    c: testClient(h, { policy: { level: "edit+delete", confirmDestructive: false } }),
  }
}

async function docWithParagraph(s: ReturnType<typeof setup>) {
  const path = `/w/${Math.random().toString(36).slice(2)}.kimo`
  const docId = expectOk(
    await s.c.call<{ doc: { id: string } }>("kimo_create", { path, template: "web" }),
  ).data.doc.id
  const r = expectOk(
    await s.c.call<{ created: { key: string; id: string }[] }>("kimo_apply_ops", {
      docId,
      ops: [
        {
          op: "insert",
          key: "p",
          parent: "DesktopFrm1",
          node: {
            type: "text",
            name: "Para",
            content: LONG,
            x: 20,
            y: 20,
            w: 180,
            grow: "fixed-width",
            style: { size: 16 },
          },
        },
      ],
    }),
  )
  const textId = (r as unknown as { created: { key: string; id: string }[] }).created.find(
    (c) => c.key === "p",
  )?.id as string
  const d = s.host.get(docId)
  if (!d.ok) throw new Error("doc not open")
  return { docId, textId, store: d.value.store as DocStore }
}

type SvgImages = { images: { nodeId: string; width: number; height: number; svg?: string }[] }

const lineCount = (svg: string) => (svg.match(/<tspan x=/g) ?? []).length

describe("kimo_render format=svg", () => {
  test("returns standalone SVG markup per node in data (no image content)", async () => {
    const s = setup()
    const { docId } = await docWithParagraph(s)
    const out = await s.c.raw("kimo_render", {
      docId,
      ids: ["DesktopFrm1"],
      format: "svg",
      background: "#ffffff",
    })
    const r = expectOk(out.result as never) as unknown as { data: SvgImages }
    expect(out.images ?? []).toHaveLength(0)
    const img = r.data.images[0]
    expect(img?.nodeId).toBe("DesktopFrm1")
    expect(img?.svg).toStartWith("<svg")
    expect(img?.svg).toContain('fill="#ffffff"')
    expect(img?.width).toBeGreaterThan(0)
    s.host.dispose()
  })

  test("line breaks follow the canvas's Paragraph measurement", async () => {
    const s = setup()
    const { docId, textId, store } = await docWithParagraph(s)
    const r = expectOk(
      await s.c.call<SvgImages>("kimo_render", { docId, ids: [textId], format: "svg" }),
    )
    const svg = r.data.images[0]?.svg as string
    expect(svg).toContain("Inter")
    // The canvas measurement: CanvasKit Paragraph with the bundled fonts.
    const scene = createSceneService()
    const layout = await scene.layout(store)
    scene.dispose()
    const canvasLines = layout?.nodes.get(textId)?.text?.lines ?? 0
    expect(canvasLines).toBeGreaterThan(1)
    expect(lineCount(svg)).toBe(canvasLines)
    s.host.dispose()
  })

  test("without CanvasKit: approximate text, flagged with a warning", async () => {
    const s = setup({
      createRenderer: async () => {
        throw new Error("no wasm here")
      },
    })
    const { docId, textId } = await docWithParagraph(s)
    const r = expectOk(
      await s.c.call<SvgImages>("kimo_render", { docId, ids: [textId], format: "svg" }),
    )
    expect(r.data.images[0]?.svg).toStartWith("<svg")
    expect(r.warnings.some((w) => w.code === "APPROXIMATE_TEXT")).toBe(true)
    s.host.dispose()
  })

  test("unknown node → NODE_NOT_FOUND", async () => {
    const s = setup()
    const { docId } = await docWithParagraph(s)
    const r = await s.c.call("kimo_render", { docId, ids: ["NopeNope12"], format: "svg" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.code).toBe("NODE_NOT_FOUND")
    s.host.dispose()
  })
})

describe("kimo_export svg / pdf with the canvas fonts", () => {
  test("pdf embeds the bundled face Paragraph measured with (no Helvetica fallback)", async () => {
    const s = setup()
    const { docId } = await docWithParagraph(s)
    const pdf = expectOk(
      await s.c.call<{
        files: { contents: string; encoding: string }[]
        issues: { code: string }[]
      }>("kimo_export", { docId, target: "pdf", ids: ["DesktopFrm1"] }),
    )
    expect(pdf.data.issues.some((i) => i.code === "FONT_MISSING")).toBe(false)
    const text = atob(pdf.data.files[0]?.contents ?? "")
    expect(text).toContain("FontFile2")
    expect(text).toContain("Inter")
    s.host.dispose()
  })

  test("svg export breaks lines like the canvas", async () => {
    const s = setup()
    const { docId, textId, store } = await docWithParagraph(s)
    const svg = expectOk(
      await s.c.call<{ files: { contents: string }[] }>("kimo_export", {
        docId,
        target: "svg",
        ids: ["DesktopFrm1"],
      }),
    ).data.files[0]?.contents as string
    const scene = createSceneService()
    const layout = await scene.layout(store)
    scene.dispose()
    const lines = layout?.nodes.get(textId)?.text?.lines ?? 0
    expect(lines).toBeGreaterThan(1)
    // The paragraph's <text> holds exactly the canvas's lines.
    const para = /<text[^>]*>(?:(?!<\/text>).)*?Kimo lays(?:(?!<\/text>).)*<\/text>/s.exec(svg)?.[0]
    expect(para).toBeDefined()
    expect(lineCount(para as string)).toBe(lines)
    s.host.dispose()
  })
})
