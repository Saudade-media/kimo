/** Board 19 SVG import: safe parser (malicious inputs), geometry, conversion, flow. */
import { describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, generateId } from "@kimo/editor-state"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  convertSvg,
  DEFAULT_SVG_OPTIONS,
  describeStats,
  parsePath,
  parseSvgColor,
  parseTransform,
  prepareSvg,
  SVG_LIMITS,
  SvgImportError,
  SvgImportPopover,
  SvgRejectedError,
  sanitizeSvg,
  serializeSegments,
  serializeSvg,
  svgImportOps,
  svgRejection,
} from "../src/svg-import"

const svg = (body: string, attrs = 'viewBox="0 0 100 100" width="100" height="100"') =>
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`

describe("sanitizer: malicious inputs", () => {
  test("script elements and event handlers are removed", () => {
    const s = sanitizeSvg(
      svg(
        `<script>alert(1)</script><path d="M0 0L1 1" onclick="alert(1)" onload="x()"/><g onmouseover="y()"><rect width="1" height="1"/></g>`,
      ),
    )
    const out = serializeSvg(s.root)
    expect(out).not.toContain("script")
    expect(out).not.toContain("alert")
    expect(out).not.toMatch(/\son\w+=/)
    expect(s.report.blocked).toEqual(
      expect.arrayContaining(["script", "onclick", "onload", "onmouseover"]),
    )
  })

  test("DOCTYPE / ENTITY (XXE, billion laughs) are rejected outright", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>`
    expect(() => sanitizeSvg(xxe)).toThrow(SvgImportError)
    const lol = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><svg>&lol2;</svg>`
    expect(() => sanitizeSvg(lol)).toThrow(SvgImportError)
    // An undeclared entity is never expanded.
    const s = sanitizeSvg(svg(`<path id="&evil;" d="M0 0"/>`))
    expect(s.root.children[0]?.attrs.id).toBe("&evil;")
  })

  test("external references: href, xlink:href, url(), javascript:, data:", () => {
    const s = sanitizeSvg(
      svg(
        `<use href="https://evil.example/x.svg#a"/><use xlink:href="javascript:alert(1)"/><use href="#ok"/>` +
          `<rect id="ok" width="1" height="1" fill="url(https://evil.example/p.svg#g)"/>` +
          `<rect width="1" height="1" style="fill:url(http://x/y);stroke:red"/>` +
          `<rect width="1" height="1" fill="url(#grad)"/>` +
          `<image href="data:image/png;base64,AAAA"/>` +
          `<a href="javascript:alert(1)"><rect width="1" height="1"/></a>`,
      ),
    )
    const out = serializeSvg(s.root)
    for (const bad of ["evil.example", "javascript:", "data:", "http://x"])
      expect(out).not.toContain(bad)
    expect(out).toContain('href="#ok"')
    expect(out).toContain('fill="url(#grad)"')
    expect(s.report.unsupported).toMatchObject({ image: 1, a: 1 })
  })

  test("foreignObject, iframe, animation and <style> with remote imports are dropped", () => {
    const s = sanitizeSvg(
      svg(
        `<foreignObject><iframe src="https://evil"/></foreignObject><set attributeName="href" to="javascript:alert(1)"/>` +
          `<animate attributeName="onload" to="alert(1)"/><style>@import url(https://evil/x.css); .a{fill:red}</style>` +
          `<style>.b{fill:#00f}</style><rect class="b" width="1" height="1"/>`,
      ),
    )
    const out = serializeSvg(s.root)
    expect(out).not.toContain("foreignObject")
    expect(out).not.toContain("iframe")
    expect(out).not.toContain("animate")
    expect(out).not.toContain("@import")
    expect(out).toContain(".b{fill:#00f}")
    expect(s.report.blocked).toEqual(
      expect.arrayContaining(["foreignObject", "set", "animate", "style"]),
    )
  })

  test("malformed and hostile structure", () => {
    expect(() => sanitizeSvg("<svg><g></svg>")).toThrow(SvgImportError)
    expect(() => sanitizeSvg("<html><body/></html>")).toThrow("Not an SVG file")
    expect(() => sanitizeSvg("not xml")).toThrow(SvgImportError)
    expect(() => sanitizeSvg("<svg x=unquoted></svg>")).toThrow(SvgImportError)
    expect(() => sanitizeSvg(`${svg("")}<svg/>`)).toThrow(SvgImportError)
    const deep = `<svg>${"<g>".repeat(SVG_LIMITS.depth + 2)}${"</g>".repeat(SVG_LIMITS.depth + 2)}</svg>`
    expect(() => sanitizeSvg(deep)).toThrow("Nesting too deep")
    expect(() => sanitizeSvg("x".repeat(SVG_LIMITS.bytes + 1))).toThrow("too large")
    const many = `<svg ${Array.from({ length: 70 }, (_, i) => `a${i}="1"`).join(" ")}></svg>`
    expect(() => sanitizeSvg(many)).toThrow("Too many attributes")
  })

  test("comments, CDATA, PIs and BOM are fine; serialized output re-parses", () => {
    const s = sanitizeSvg(
      `﻿<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 10 10"><![CDATA[x]]><path d="M0 0L10 10" fill="#f00"/></svg>`,
    )
    const again = sanitizeSvg(serializeSvg(s.root))
    expect(again.root.children[0]?.attrs.d).toBe("M0 0L10 10")
  })
})

describe("geometry", () => {
  test("path parsing: relative, implicit, H/V, S/T, packed arc flags, exponents", () => {
    expect(serializeSegments(parsePath("m10 10 5 0 0 5z"))).toBe("M10 10L15 10L15 15Z")
    expect(serializeSegments(parsePath("M0 0H10V10h-10v-10"))).toBe("M0 0L10 0L10 10L0 10L0 0")
    expect(serializeSegments(parsePath("M0 0C0 10 10 10 10 0S20 -10 20 0"))).toBe(
      "M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0",
    )
    expect(serializeSegments(parsePath("M0 0Q5 5 10 0T20 0"))).toBe("M0 0Q5 5 10 0Q15 -5 20 0")
    expect(serializeSegments(parsePath("M1e1 .5L-.5-1.5e0"))).toBe("M10 0.5L-0.5 -1.5")
    const arc = parsePath("M0 0a5 5 0 1010 0")
    expect(arc.at(-1)).toMatchObject({ c: "C", x: 10, y: 0 })
    expect(arc.length).toBeGreaterThan(2)
  })

  test("bad path data stops at the error (no throw)", () => {
    expect(parsePath("M0 0 L 10 X 20")).toEqual([{ c: "M", x: 0, y: 0 }])
    expect(parsePath("garbage")).toEqual([])
  })

  test("transforms", () => {
    expect(parseTransform("translate(10 20) scale(2)")).toEqual([2, 0, 0, 2, 10, 20])
    const r = parseTransform("rotate(90)")
    expect(r.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, -1, 0, 0, 0])
    expect(parseTransform("matrix(1 0 0 1 NaN 0)")).toEqual([1, 0, 0, 1, 0, 0])
  })

  test("colors", () => {
    expect(parseSvgColor("#f00")).toBe("#FF0000")
    expect(parseSvgColor("red", 0.5)).toBe("#FF000080")
    expect(parseSvgColor("rgb(0, 128, 255)")).toBe("#0080FF")
    expect(parseSvgColor("none")).toBeNull()
    expect(parseSvgColor("url(#x)")).toBeNull()
  })
})

describe("conversion", () => {
  const logo = svg(
    `<defs><linearGradient id="g"><stop offset="0" stop-color="#E8590C"/><stop offset="1" stop-color="#0A0A0A"/></linearGradient><filter id="f"/></defs>` +
      `<g id="mark" transform="translate(10 10)"><rect width="20" height="20" fill="url(#g)"/><circle cx="30" cy="10" r="5" fill="#0A0A0A"/></g>` +
      `<g><path d="M0 90L100 90" stroke="#E8590C" stroke-width="2" stroke-linecap="round"/></g>` +
      `<polygon points="50,50 60,60 40,60" fill="#123456" opacity="0.5"/>`,
  )

  test("stats and description", async () => {
    const p = await prepareSvg(logo, "logo-mark.svg")
    expect(p.stats).toMatchObject({ paths: 4, groups: 2, gradients: 1, unsupported: { filter: 1 } })
    expect(p.vectorDescription).toBe(
      "Editable paths in a frame. 4 paths · 2 groups · 1 gradient. Unsupported: 1 filter (dropped).",
    )
    expect(p.imageKey).toMatch(/^[0-9a-f]{16}\.svg$/)
    expect(
      describeStats({
        paths: 1,
        groups: 0,
        gradients: 0,
        unsupported: {},
        blocked: [],
        strokesKept: 0,
      }),
    ).toBe("Editable paths in a frame. 1 path.")
  })

  test("ops apply to a store as one undoable edit; groups as frames; variables matched", () => {
    const s = sanitizeSvg(logo)
    const r = convertSvg(s, DEFAULT_SVG_OPTIONS, {
      name: "logo-mark",
      newId: generateId,
      colorVariables: { ink: "#0A0A0A" },
      at: { x: 40, y: 40 },
    })
    const store = createDocStore(createEmptyDocument("x"))
    const res = store.apply(
      [{ op: "setVariables", set: { ink: { type: "color", value: "#0A0A0A" } } }, ...r.ops],
      { origin: "user", label: "Import logo-mark.svg" },
    )
    expect(res.ok).toBe(true)
    const nodes = Object.values(store.toDocument().nodes) as Record<string, unknown>[]
    const root = nodes.find((n) => n.name === "logo-mark")
    expect(root).toMatchObject({ type: "frame", x: 40, y: 40, w: 100, h: 100 })
    expect(nodes.filter((n) => n.type === "path").length).toBe(4)
    expect(nodes.filter((n) => n.type === "frame").length).toBe(3)
    const circle = nodes.find((n) => n.name === "Circle") as {
      fill: unknown[]
      x: number
      y: number
    }
    expect(circle.fill).toEqual([{ $ref: "ink" }])
    expect([circle.x, circle.y]).toEqual([25, 5]) // relative to the group frame at (10,10)
    const rect = nodes.find((n) => n.name === "Rect") as {
      fill: { kind: string; stops: unknown[] }[]
    }
    expect(rect.fill[0]?.kind).toBe("linear")
    const line = nodes.find((n) => n.name === "Path") as { stroke: Record<string, unknown> }
    expect(line.stroke).toMatchObject({ paint: "#E8590C", width: 2, cap: "round", align: "center" })
    const poly = nodes.find((n) => n.name === "Polygon") as { fill: unknown[] }
    expect(poly.fill).toEqual(["#12345680"])
    store.undo("user")
    expect(Object.keys(store.toDocument().nodes)).toEqual([])
  })

  test("keepGroups off flattens; matchVariables off keeps hex", () => {
    const r = convertSvg(
      sanitizeSvg(logo),
      { keepGroups: false, matchVariables: false, outlineStrokes: false },
      {
        name: "x",
        newId: generateId,
        colorVariables: { ink: "#0A0A0A" },
      },
    )
    const inserts = r.ops.filter((o) => o.op === "insert") as {
      node: Record<string, unknown>
      parent: unknown
    }[]
    expect(inserts.filter((o) => o.node.type === "frame").length).toBe(1)
    expect(inserts.every((o) => o.node.type === "frame" || o.parent === r.rootId)).toBe(true)
    expect(JSON.stringify(r.ops)).not.toContain("$ref")
  })

  test("outline strokes uses the injected outliner; without one strokes are kept and counted", () => {
    const opts = { ...DEFAULT_SVG_OPTIONS, outlineStrokes: true }
    const kept = convertSvg(sanitizeSvg(logo), opts, { name: "x", newId: generateId })
    expect(kept.stats.strokesKept).toBe(1)
    const outlined = convertSvg(sanitizeSvg(logo), opts, {
      name: "x",
      newId: generateId,
      outline: () => "M0 0L1 0L1 1Z",
    })
    expect(JSON.stringify(outlined.ops)).toContain('"name":"Path stroke"')
  })

  test("use → local symbol is expanded; a use cycle terminates", () => {
    const s = sanitizeSvg(
      svg(
        `<defs><symbol id="s"><rect width="4" height="4"/></symbol></defs><use href="#s" x="10"/><use id="u" href="#u"/>`,
      ),
    )
    const r = convertSvg(s, DEFAULT_SVG_OPTIONS, { name: "x", newId: generateId })
    const paths = r.ops.filter(
      (o) => o.op === "insert" && (o.node as { type: string }).type === "path",
    )
    expect(paths.length).toBe(1)
  })

  test("image option stores the sanitized SVG and places an image fill", async () => {
    const p = await prepareSvg(svg(`<iframe/><path d="M0 0L1 1"/>`), "logo.svg")
    const put: { key: string; text: string }[] = []
    const r = await svgImportOps(
      p,
      { mode: "image", options: DEFAULT_SVG_OPTIONS },
      {
        newId: generateId,
        manifest: {},
        putAsset: async (key, bytes) => {
          put.push({ key, text: new TextDecoder().decode(bytes) })
        },
      },
    )
    expect(put[0]?.key).toBe(p.imageKey)
    expect(put[0]?.text).not.toContain("iframe")
    expect(r.ops[0]).toMatchObject({
      op: "insert",
      node: { type: "rect", fill: [{ kind: "image", src: `./assets/${p.imageKey}` }] },
    })
    expect(r.ops[1]).toMatchObject({ op: "setHeader" })
  })

  test("popover renders the designed controls", () => {
    const html = renderToString(
      h(SvgImportPopover, {
        fileName: "logo-mark.svg",
        vectorDescription:
          "Editable paths in a frame. 14 paths · 3 groups · 1 gradient. Unsupported: 1 filter (dropped).",
        imageDescription: "",
        onImport: () => {},
        onCancel: () => {},
        inline: true,
      }),
    )
    for (const t of [
      "Import logo-mark.svg",
      "Vector paths",
      "Image",
      "Keep groups as frames",
      "Match fills to variables",
      "Outline strokes",
      "Cancel",
      "Import",
    ])
      expect(html).toContain(t)
  })
})

describe("board 20: unsafe SVGs are rejected whole (M4Pij9 / fW1JW)", () => {
  test("a script: Couldn't import logo.svg — it contains a script, with the line", async () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0 0L1 1"/>\n<script>alert(1)</script>\n</svg>`
    const err = await prepareSvg(text, "logo.svg").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SvgRejectedError)
    const r = err as SvgRejectedError
    expect(r.message).toBe("Couldn't import logo.svg — it contains a script")
    expect(r.details).toEqual(["<script> · line 3"])
  })

  test("event handlers and javascript: URLs count as scripts", () => {
    expect(svgRejection(["onload"], `<svg onload="x()">`)?.reason).toBe("script")
    expect(svgRejection(["href:javascript:alert(1)"], "")?.reason).toBe("script")
  })

  test("an external file: it loads an external file", async () => {
    const text = svg(
      `<image href="https://cdn.example/badge.png" width="1" height="1"/><use href="https://evil.example/x.svg#a"/>`,
    )
    const err = (await prepareSvg(text, "badge.svg").catch((e: unknown) => e)) as SvgRejectedError
    expect(err.message).toBe("Couldn't import badge.svg — it loads an external file")
    expect(svgRejection(["fill:url(https://x/y#a)"], "")?.reason).toBe("external")
  })

  test("foreignObject is rejected; unsupported elements are still dropped silently", async () => {
    expect(svgRejection(["foreignObject"], "")?.reason).toBe("embedded-html")
    expect(svgRejection(["iframe", "set", "style"], "")).toBeNull()
    await expect(prepareSvg(svg(`<path d="M0 0L1 1"/>`), "ok.svg")).resolves.toBeTruthy()
  })
})
