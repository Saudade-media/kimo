/** The page outline of the turn context is compact, bounded and puts the selection first and deepest. */
import { describe, expect, test } from "bun:test"
import { buildPageOutline, type OutlineSource } from "../src/index"

type N = Record<string, unknown> & { parent: string | null }

function source(nodes: Record<string, N>, boxes = true): OutlineSource {
  const kids = (p: string | null) =>
    Object.entries(nodes)
      .filter(([, n]) => n.parent === p)
      .map(([id]) => id)
  return {
    roots: () => kids(null),
    children: (id) => kids(id),
    node: (id) => nodes[id],
    ...(boxes ? { box: (id: string) => (nodes[id] ? { x: 0, y: 0, w: 100, h: 20 } : null) } : {}),
  }
}

/** A page with `sections` sections of `per` text rows each, plus another top-level frame. */
function page(sections: number, per: number): Record<string, N> {
  const nodes: Record<string, N> = {
    Page000001: {
      type: "frame",
      name: "Landing",
      parent: null,
      layout: { dir: "column", gap: 0 },
      fill: { $ref: "color/bg" },
    },
    Other00001: { type: "frame", name: "Other", parent: null },
    OtherKid01: { type: "rect", name: "Kid", parent: "Other00001" },
    OtherKid02: { type: "frame", name: "Deep", parent: "OtherKid01" },
  }
  for (let s = 0; s < sections; s++) {
    const sid = `Sect${String(s).padStart(6, "0")}`
    nodes[sid] = { type: "frame", name: `Section ${s}`, parent: "Page000001" }
    for (let r = 0; r < per; r++)
      nodes[`Row${String(s).padStart(3, "0")}${String(r).padStart(4, "0")}`] = {
        type: "text",
        name: `Row ${r}`,
        parent: sid,
        content: `Some copy for row ${r} of section ${s} that is long enough to clip`,
        style: { font: "Inter", size: 16, weight: 400 },
      }
  }
  return nodes
}

describe("page outline", () => {
  test("small pages are outlined whole: the selection deep, other roots shallow (+N)", () => {
    const out = buildPageOutline(source(page(2, 2)), { selection: ["Page000001"] }) as string
    const lines = out.split("\n")
    expect(lines[0]).toStartWith("Page outline")
    expect(lines[1]).toStartWith("Page000001 frame")
    expect(lines).toContain(' Sect000000 frame "Section 0" 0,0 100x20')
    expect(out).toContain("  Row0010001 text")
    // The other root shows one level; its grandchild is elided as +1.
    expect(out).toContain('Other00001 frame "Other" 0,0 100x20')
    expect(out).toContain(' OtherKid01 rect "Kid" 0,0 100x20 +1')
    expect(out).not.toContain("OtherKid02")
    expect(out).not.toContain("outline shortened")
  })

  test("a large page stays within the budget and says what it left out", () => {
    const nodes = page(40, 20) // 800 rows
    for (const maxChars of [2_000, 12_000]) {
      const out = buildPageOutline(source(nodes), {
        selection: ["Page000001"],
        maxChars,
      }) as string
      const [, ...body] = out.split("\n")
      const notes = body.filter((l) => l.startsWith("… outline shortened"))
      expect(notes).toHaveLength(1)
      expect(notes[0]).toContain("kimo_query")
      expect(notes[0]).toContain("Page000001")
      const outlined = body.filter((l) => !l.startsWith("…")).join("\n")
      expect(outlined.length).toBeLessThanOrEqual(maxChars)
      // Shallower but complete levels: every section is listed with its rows elided.
      expect(out).toContain(' Sect000039 frame "Section 39" 0,0 100x20 +20')
    }
    // Default budget ≈ 3k tokens.
    expect(
      (buildPageOutline(source(nodes), { selection: ["Page000001"] }) as string).length,
    ).toBeLessThan(12_400)
  })

  test("a deep selection is outlined first; no boxes without a layout; empty page = null", () => {
    const out = buildPageOutline(source(page(3, 3), false), {
      selection: ["Sect000002"],
    }) as string
    const lines = out.split("\n")
    expect(lines[1]).toBe('Sect000002 frame "Section 2" sel')
    expect(lines[2]).toStartWith(" Row0020000 text")
    expect(buildPageOutline(source({}), {})).toBeNull()
  })
})
