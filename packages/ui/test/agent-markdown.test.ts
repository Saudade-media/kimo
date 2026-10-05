/** Board 33 "Reply formatting" (ME2DT): the Markdown subset parser and renderer. */
import { describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentMarkdown, parseInline, parseMarkdown, safeHref, stripMarkdown } from "../src/index"

const html = (source: string) => renderToStaticMarkup(h(AgentMarkdown, { source }))

const REPLY = [
  'Added two sections to "Landing — Desktop (Analytics)", above the footer.',
  "",
  "- **Pricing:** your three plans, unchanged.",
  "- **FAQ:** six questions, collapsed.",
  "  - Uses the analytics heading style.",
  "",
  "To move FAQ above Pricing:",
  "",
  "1. Select FAQ in the Layers panel.",
  "2. Press `⌥↑` once.",
  "",
  "```css",
  "font: Inter 15/24",
  "```",
  "",
  "Prices are *placeholders*. Copy from [pricing.md](https://kimo.dev/p).",
].join("\n")

describe("parseMarkdown", () => {
  test("the board 33 reply: paragraph, bullets with one nested level, numbered list, code", () => {
    const b = parseMarkdown(REPLY)
    expect(b.map((x) => x.t)).toEqual(["p", "list", "p", "list", "code", "p"])
    const bullets = b[1] as Extract<(typeof b)[number], { t: "list" }>
    expect(bullets.ordered).toBe(false)
    expect(bullets.items).toHaveLength(2)
    expect(bullets.items[0]?.c[0]).toEqual({ t: "strong", c: [{ t: "text", v: "Pricing:" }] })
    expect(bullets.items[1]?.sub?.items).toHaveLength(1)
    const nums = b[3] as typeof bullets
    expect(nums.ordered).toBe(true)
    expect(nums.items[1]?.c).toContainEqual({ t: "code", v: "⌥↑" })
    expect(b[4]).toEqual({ t: "code", v: "font: Inter 15/24" })
  })

  test("deeper nesting flattens into the one nested level", () => {
    const b = parseMarkdown("- a\n  - b\n    - c\n- d")
    const l = b[0] as Extract<(typeof b)[number], { t: "list" }>
    expect(l.items).toHaveLength(2)
    expect(l.items[0]?.sub?.items.map((x) => x.c)).toEqual([
      [{ t: "text", v: "b" }],
      [{ t: "text", v: "c" }],
    ])
  })

  test("ordered lists keep their start; switching marker type starts a new list", () => {
    const b = parseMarkdown("3. three\n4. four\n- bullet")
    expect(b).toHaveLength(2)
    expect((b[0] as { start: number }).start).toBe(3)
  })

  test("loose lists (blank lines between items) stay one list", () => {
    expect(parseMarkdown("- a\n\n- b\n\n- c")).toHaveLength(1)
  })

  test("headings become bold paragraphs; rules disappear; quotes keep their text", () => {
    expect(parseMarkdown("## Summary\n\n---\n\n> quoted")).toEqual([
      { t: "p", c: [{ t: "strong", c: [{ t: "text", v: "Summary" }] }] },
      { t: "p", c: [{ t: "text", v: "quoted" }] },
    ])
  })

  test("single line breaks inside a paragraph are kept", () => {
    expect(parseMarkdown("one\ntwo")).toEqual([
      { t: "p", c: [{ t: "text", v: "one" }, { t: "br" }, { t: "text", v: "two" }] },
    ])
  })

  test("an unclosed fence runs to the end; tildes work too", () => {
    expect(parseMarkdown("~~~\na\n~~~")).toEqual([{ t: "code", v: "a" }])
    expect(parseMarkdown("```\nx\ny")).toEqual([{ t: "code", v: "x\ny" }])
  })

  test("never throws on junk", () => {
    for (const s of ["", "*", "**", "`", "[", "[a](", "1.", "- ", "```", "_ _", "\\", "[x]()"])
      expect(() => parseMarkdown(s)).not.toThrow()
  })
})

describe("parseInline", () => {
  test("bold, italic, code, links", () => {
    expect(parseInline("**b** *i* _j_ __k__ `c`")).toEqual([
      { t: "strong", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "i" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "j" }] },
      { t: "text", v: " " },
      { t: "strong", c: [{ t: "text", v: "k" }] },
      { t: "text", v: " " },
      { t: "code", v: "c" },
    ])
  })

  test("snake_case, 2 * 3 * 4 and lone marks stay literal", () => {
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }])
    expect(parseInline("2 * 3 * 4")).toEqual([{ t: "text", v: "2 * 3 * 4" }])
    expect(parseInline("a ** b")).toEqual([{ t: "text", v: "a ** b" }])
  })

  test("marks inside code are literal; escapes work", () => {
    expect(parseInline("`**x**`")).toEqual([{ t: "code", v: "**x**" }])
    expect(parseInline("\\*not\\*")).toEqual([{ t: "text", v: "*not*" }])
  })

  test("bare URLs link without trailing punctuation", () => {
    expect(parseInline("See https://kimo.dev/docs.")).toEqual([
      { t: "text", v: "See " },
      { t: "link", href: "https://kimo.dev/docs", c: [{ t: "text", v: "https://kimo.dev/docs" }] },
      { t: "text", v: "." },
    ])
  })
})

describe("safety", () => {
  test("only http(s) and mailto hrefs survive", () => {
    expect(safeHref("https://a.b")).toBe("https://a.b")
    expect(safeHref("mailto:x@y.z")).toBe("mailto:x@y.z")
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>",
      "vbscript:x",
      "file:///etc/passwd",
      "//evil.com",
      "/relative",
      'https://a.b" onclick="x',
    ])
      expect(safeHref(bad)).toBeNull()
  })

  test("a javascript: link renders as its label text, no anchor", () => {
    const out = html("[click](javascript:alert(1))")
    expect(out).not.toContain("<a")
    expect(out).not.toContain("javascript")
    expect(out).toContain("click")
  })

  test("raw HTML is shown as text, never parsed", () => {
    const out = html('<img src=x onerror="alert(1)"> <script>alert(2)</script> **ok**')
    expect(out).not.toContain("<img")
    expect(out).not.toContain("<script")
    expect(out).toContain("&lt;img")
    expect(out).toContain("<strong")
  })

  test("HTML inside code is escaped", () => {
    expect(html("`<b>x</b>`")).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html("```\n<iframe></iframe>\n```")).toContain("&lt;iframe&gt;")
  })

  test("links open in a new context without opener", () => {
    const out = html("[docs](https://kimo.dev)")
    expect(out).toContain('href="https://kimo.dev"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('target="_blank"')
  })

  test("quote-breaking hrefs are refused", () => {
    expect(html('[x](https://a.b"onmouseover="alert(1))')).not.toContain("onmouseover=")
  })
})

describe("render", () => {
  test("the board 33 structure: lists, markers, nested list, code block", () => {
    const out = html(REPLY)
    expect(out).toContain('<ul class="kimo-md__list">')
    expect(out).toContain('<ol class="kimo-md__list">')
    expect(out).toContain('class="kimo-md__list kimo-md__list--nested"')
    expect(out).toContain(">•</span>")
    expect(out).toContain(">2.</span>")
    expect(out).toContain('<pre class="kimo-md__pre"><code>font: Inter 15/24</code></pre>')
    expect(out).toContain('<code class="kimo-md__code">⌥↑</code>')
    expect(out).toContain('<em class="kimo-md__em">placeholders</em>')
  })
})

describe("stripMarkdown", () => {
  test("one plain line", () => {
    expect(stripMarkdown("**Adding** the `FAQ`\n\n- one\n- two")).toBe("Adding the FAQ one two")
  })

  test("partial (streaming) marks are dropped", () => {
    expect(stripMarkdown("Adding the **Pric")).toBe("Adding the Pric")
    expect(stripMarkdown("Writing `faq/it")).toBe("Writing faq/it")
  })
})
