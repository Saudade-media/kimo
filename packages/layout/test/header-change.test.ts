/**
 * Header changes that only repaint (perf: a color variable edited in the variables dialog
 * keeps the layout; the host skips the layout pass and re-records bound pictures only).
 */
import { describe, expect, test } from "bun:test"
import {
  createLayoutEngine,
  createResolver,
  type LayoutNodeData,
  nodeSourceFromDocument,
  paintOnlyHeaderChange,
  type ResolveHeader,
} from "../src/index"
import { fakeMeasurer, nodes, snapshot } from "./helpers"

const header = (accent: unknown, extra: Record<string, unknown> = {}): ResolveHeader =>
  ({
    themes: { mode: ["light", "dark"] },
    variables: {
      accent: { type: "color", value: accent },
      pad: {
        type: "number",
        value: [
          { value: 8, when: { mode: "light" } },
          { value: 10, when: { mode: "dark" } },
        ],
      },
      ink: { type: "color", value: { $ref: "accent" } },
      ...extra,
    },
  }) as ResolveHeader

const themed = (light: unknown, dark: unknown = "#A78BFA") => [
  { value: light, when: { mode: "light" } },
  { value: dark, when: { mode: "dark" } },
]

describe("paintOnlyHeaderChange", () => {
  test("a color value edited (same entries, no bindings moved) only repaints", () => {
    expect(paintOnlyHeaderChange(header(themed("#7C3AED")), header(themed("#7C20ED")))).toBe(true)
    expect(paintOnlyHeaderChange(header("#111111"), header("#222222"))).toBe(true)
    expect(paintOnlyHeaderChange(header("#111111"), header("#111111"))).toBe(true)
  })

  test("anything a layout can read is a full change", () => {
    const h = header(themed("#7C3AED"))
    // A number variable.
    const pad = structuredClone(h)
    ;(pad.variables as Record<string, { value: unknown }>).pad = {
      type: "number",
      value: 4,
    } as never
    expect(paintOnlyHeaderChange(h, pad)).toBe(false)
    // Entry structure: a `when` changed, an entry added, plain ⇄ themed.
    expect(
      paintOnlyHeaderChange(
        h,
        header([
          { value: "#000000", when: { mode: "dark" } },
          { value: "#A78BFA", when: { mode: "dark" } },
        ]),
      ),
    ).toBe(false)
    expect(paintOnlyHeaderChange(h, header([...themed("#7C3AED"), { value: "#000000" }]))).toBe(
      false,
    )
    expect(paintOnlyHeaderChange(h, header("#7C3AED"))).toBe(false)
    // A binding added or retargeted.
    expect(paintOnlyHeaderChange(h, header(themed({ $ref: "ink" })))).toBe(false)
    expect(
      paintOnlyHeaderChange(
        header({ $ref: "a" }, { a: { type: "color", value: "#000" } }),
        header({ $ref: "b" }, { a: { type: "color", value: "#000" } }),
      ),
    ).toBe(false)
    // Type changes, variables added or removed, themes or imports changed.
    expect(
      paintOnlyHeaderChange(h, {
        ...h,
        variables: { ...(h.variables as object), accent: { type: "string", value: "x" } },
      } as ResolveHeader),
    ).toBe(false)
    expect(
      paintOnlyHeaderChange(h, {
        ...h,
        variables: { ...(h.variables as object), extra: { type: "color", value: "#000" } },
      } as ResolveHeader),
    ).toBe(false)
    expect(paintOnlyHeaderChange(h, { ...h, themes: { mode: ["dark", "light"] } })).toBe(false)
    expect(paintOnlyHeaderChange(h, { ...h, imports: { ui: "./ui.kimo" } })).toBe(false)
    // A non-color variable aliasing the changed one.
    const alias = (v: unknown) =>
      header(v, { weird: { type: "number", value: { $ref: "accent" } } })
    expect(paintOnlyHeaderChange(alias("#111111"), alias("#222222"))).toBe(false)
  })

  test("the layout of a document bound to both is the same before and after", async () => {
    const table = nodes({
      card: {
        type: "frame",
        parent: null,
        fill: { $ref: "accent" },
        layout: { dir: "column", pad: { $ref: "pad" }, gap: { $ref: "pad" } },
        stroke: { color: { $ref: "ink" }, width: 2 },
      },
      t: { type: "text", parent: "card", content: "Hello", fill: { $ref: "ink" } },
      r: { type: "rect", parent: "card", w: 20, h: 10, fill: { $ref: "accent" } },
    } as unknown as Record<string, LayoutNodeData>)
    const e = createLayoutEngine()
    await e.init()
    const run = (h: ResolveHeader) => {
      const src = nodeSourceFromDocument({ nodes: table as never })
      return snapshot(
        e.compute({ nodes: src, resolve: createResolver(h, src), measureText: fakeMeasurer }),
      )
    }
    const a = header(themed("#7C3AED"))
    const b = header(themed("#000000", "#FFFFFF"))
    expect(paintOnlyHeaderChange(a, b)).toBe(true)
    expect(run(b)).toEqual(run(a))
    e.dispose()
  })
})
