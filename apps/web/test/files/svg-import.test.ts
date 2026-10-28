/** SVG import: the sanitizer (hostile inputs), path geometry, conversion to layers, and rejection. */
import { describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, generateId } from "@kimo/editor-state"
import { prepareSvg, SvgRejectedError, svgImportOps } from "../../src/svg-import"
import { convertSvg, DEFAULT_SVG_OPTIONS } from "../../src/svg-import/convert"
import { svgRejection } from "../../src/svg-import/flow"
import { parsePath, parseTransform, serializeSegments } from "../../src/svg-import/geometry"
import {
  SVG_LIMITS,
  SvgImportError,
  sanitizeSvg,
  serializeSvg,
} from "../../src/svg-import/sanitize"

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
})

describe("geometry", () => {
  test("path data: relative, implicit, H/V, S/T, packed arc flags, exponents; bad data stops at the error", () => {
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
    expect(parsePath("M0 0 L 10 X 20")).toEqual([{ c: "M", x: 0, y: 0 }])
    expect(parsePath("garbage")).toEqual([])
  })

  test("transforms compose, and a bad matrix is the identity", () => {
    expect(parseTransform("translate(10 20) scale(2)")).toEqual([2, 0, 0, 2, 10, 20])
    expect(parseTransform("matrix(1 0 0 1 NaN 0)")).toEqual([1, 0, 0, 1, 0, 0])
  })
})

describe("conversion", () => {
  const logo = svg(
    `<defs><linearGradient id="g"><stop offset="0" stop-color="#E8590C"/><stop offset="1" stop-color="#0A0A0A"/></linearGradient><filter id="f"/></defs>` +
      `<g id="mark" transform="translate(10 10)"><rect width="20" height="20" fill="url(#g)"/><circle cx="30" cy="10" r="5" fill="#0A0A0A"/></g>` +
      `<g><path d="M0 90L100 90" stroke="#E8590C" stroke-width="2" stroke-linecap="round"/></g>` +
      `<polygon points="50,50 60,60 40,60" fill="#123456" opacity="0.5"/>`,
  )

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

  test("a <use> cycle terminates and a local symbol is expanded once", () => {
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

  test("the image option stores the sanitized SVG and places an image fill", async () => {
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
})

describe("unsafe SVGs are rejected whole", () => {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
    '<path d="M0 0L1 1"/>',
    "<g>",
    "<script>alert(1)</script>",
    "</g>",
    '<use href="https://cdn.example.com/assets/x.svg#a"/>',
    "<foreignObject><div>hi</div></foreignObject>",
    '<rect width="1" height="1" onload="x()"/>',
    "</svg>",
  ].join("\n")

  test("scripts, external refs, foreignObject and event handlers are rejected with their source line", async () => {
    const err = (await prepareSvg(source, "logo.svg").catch((e: unknown) => e)) as SvgRejectedError
    expect(err).toBeInstanceOf(SvgRejectedError)
    expect(err.items.map((i) => [i.line, i.code])).toEqual([
      [4, "<script>"],
      [6, 'href="https://cdn…/x.svg#a"'],
      [7, "<foreignObject>"],
      [8, 'onload="…"'],
    ])
  })

  test("on explicit consent the sanitized SVG imports without them", async () => {
    const p = await prepareSvg(source, "logo.svg", { allowRemoved: true })
    const text = new TextDecoder().decode(p.imageBytes)
    expect(text).not.toContain("script")
    expect(text).not.toContain("onload")
    expect(text).not.toContain("foreignObject")
    expect(text).not.toContain("cdn.example")
    expect(text).toContain("M0 0L1 1")
  })

  test("event handlers, javascript: URLs, external files and foreignObject are refused; other unsupported elements are dropped", async () => {
    expect(svgRejection(["onload"], `<svg onload="x()">`)?.reason).toBe("script")
    expect(svgRejection(["href:javascript:alert(1)"], "")?.reason).toBe("script")
    expect(svgRejection(["fill:url(https://x/y#a)"], "")?.reason).toBe("external")
    expect(svgRejection(["foreignObject"], "")?.reason).toBe("embedded-html")
    expect(svgRejection(["iframe", "set", "style"], "")).toBeNull()
    const external = svg(
      `<image href="https://cdn.example/badge.png" width="1" height="1"/><use href="https://evil.example/x.svg#a"/>`,
    )
    const err = await prepareSvg(external, "badge.svg").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SvgRejectedError)
    await expect(prepareSvg(svg(`<path d="M0 0L1 1"/>`), "ok.svg")).resolves.toBeTruthy()
  })
})
