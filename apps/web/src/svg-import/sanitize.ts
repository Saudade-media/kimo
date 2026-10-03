/**
 * Safe SVG reader for import (board 19 "SVG import options"). SVG files come from anywhere
 * (drops, pastes, downloads), so this never hands them to a browser parser or renderer:
 *
 * - its own XML tokenizer: no DOCTYPE / ENTITY (rejected: no XXE, no entity expansion bombs),
 *   only the five predefined entities and numeric character references are decoded;
 * - an element allowlist: `script`, `foreignObject`, `iframe`, `style`-less HTML, animation
 *   elements (`set`, `animate*`) and everything unknown are dropped;
 * - an attribute allowlist: no `on*` handlers, no `href` other than a local `#id`, no `url()`
 *   other than `url(#id)`, no `javascript:` / `data:` anywhere;
 * - hard limits: input size, depth, element and attribute counts.
 *
 * The result is a plain tree used by the path converter and, for the "Image" option, re-serialized
 * as a clean SVG (so the stored asset carries none of the dropped content).
 */

export class SvgImportError extends Error {
  override readonly name = "SvgImportError"
}

export interface SvgElement {
  name: string
  attrs: Record<string, string>
  children: SvgElement[]
  /** Text content (only kept for `<style>`, used for class rules). */
  text?: string
}

export interface SanitizeReport {
  /** Dangerous constructs removed: `script`, `onload`, `href:https://…`, `foreignObject`, … */
  blocked: string[]
  /** Elements Kimo cannot convert, by name (`filter`: 1). They are dropped. */
  unsupported: Record<string, number>
}

export interface SanitizedSvg {
  root: SvgElement
  report: SanitizeReport
}

export const SVG_LIMITS = {
  bytes: 5 * 1024 * 1024,
  depth: 64,
  elements: 50_000,
  attrsPerElement: 64,
  attrValue: 1_000_000,
} as const

/** Elements kept as-is (geometry, structure, paint servers). */
const KEEP = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "use",
  "symbol",
  "style",
])

/** Elements dropped as unsupported (counted for the popover description). */
const UNSUPPORTED = new Set([
  "filter",
  "mask",
  "clipPath",
  "pattern",
  "image",
  "text",
  "textPath",
  "tspan",
  "marker",
  "switch",
  "a",
])

/** Elements dropped silently (metadata). */
const METADATA = new Set(["title", "desc", "metadata", "sodipodi:namedview"])

/** Attributes kept (presentation + geometry). Everything else is dropped. */
const ATTRS = new Set([
  "id",
  "class",
  "style",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "transform",
  "offset",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "opacity",
  "display",
  "visibility",
  "color",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "href",
  "xlink:href",
])

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    }
    // Unknown named entities are not expanded (no DTD can define them here).
    return ENTITIES[e] ?? m
  })
}

const UNSAFE_VALUE =
  /javascript:|vbscript:|data:|expression\s*\(|@import|-moz-binding|behavior\s*:|<|>/i

/** `url(#id)` only; any other `url(...)` is unsafe. */
function urlsAreLocal(v: string): boolean {
  const re = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi
  for (let m = re.exec(v); m; m = re.exec(v)) if (!/^#[\w.:-]+$/.test(m[2] ?? "")) return false
  return true
}

interface RawEl {
  name: string
  attrs: [string, string][]
  children: RawEl[]
  text: string
}

/** Tokenizes `src` into a raw element tree. Throws {@link SvgImportError} on malformed or
 * forbidden input. */
function parseXml(src: string): RawEl {
  const len = src.length
  let i = 0
  const top: RawEl = { name: "#root", attrs: [], children: [], text: "" }
  const stack: RawEl[] = [top]
  let count = 0
  const fail = (msg: string): never => {
    throw new SvgImportError(msg)
  }
  while (i < len) {
    const lt = src.indexOf("<", i)
    const cur = stack[stack.length - 1] as RawEl
    if (lt < 0) {
      cur.text += src.slice(i)
      break
    }
    if (lt > i) cur.text += src.slice(i, lt)
    i = lt
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4)
      if (end < 0) fail("Unterminated comment")
      i = end + 3
      continue
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9)
      if (end < 0) fail("Unterminated CDATA section")
      cur.text += src.slice(i + 9, end)
      i = end + 3
      continue
    }
    if (src.startsWith("<!", i)) {
      // DOCTYPE / ENTITY / ELEMENT declarations: never processed (XXE, entity expansion).
      fail("SVG files with a DOCTYPE or entity declarations are not imported")
    }
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2)
      if (end < 0) fail("Unterminated processing instruction")
      i = end + 2
      continue
    }
    if (src.startsWith("</", i)) {
      const end = src.indexOf(">", i)
      if (end < 0) fail("Unterminated end tag")
      const name = src.slice(i + 2, end).trim()
      const open = stack.pop()
      if (!open || open === top || open.name !== name) fail(`Mismatched </${name}>`)
      i = end + 1
      continue
    }
    // Start tag.
    const m = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(i, i + 256))
    if (!m) fail("Malformed tag")
    const name = (m as RegExpExecArray)[1] as string
    i += (m as RegExpExecArray)[0].length
    const attrs: [string, string][] = []
    let selfClose = false
    for (;;) {
      while (i < len && /\s/.test(src[i] as string)) i++
      if (i >= len) fail("Unterminated start tag")
      if (src.startsWith("/>", i)) {
        selfClose = true
        i += 2
        break
      }
      if (src[i] === ">") {
        i++
        break
      }
      const am = /^([A-Za-z_][\w:.-]*)\s*=\s*/.exec(src.slice(i, i + 256))
      if (!am) fail(`Malformed attribute in <${name}>`)
      i += (am as RegExpExecArray)[0].length
      const q = src[i]
      if (q !== '"' && q !== "'") fail(`Unquoted attribute in <${name}>`)
      const end = src.indexOf(q as string, i + 1)
      if (end < 0) fail("Unterminated attribute value")
      const raw = src.slice(i + 1, end)
      if (raw.length > SVG_LIMITS.attrValue) fail("Attribute value too long")
      attrs.push([(am as RegExpExecArray)[1] as string, decodeEntities(raw)])
      if (attrs.length > SVG_LIMITS.attrsPerElement) fail("Too many attributes")
      i = end + 1
    }
    if (++count > SVG_LIMITS.elements) fail("Too many elements")
    const el: RawEl = { name, attrs, children: [], text: "" }
    cur.children.push(el)
    if (!selfClose) {
      stack.push(el)
      if (stack.length > SVG_LIMITS.depth + 1) fail("Nesting too deep")
    }
  }
  if (stack.length !== 1) fail("Unclosed elements")
  return top
}

/** Parses and sanitizes SVG text. Throws {@link SvgImportError} when it is not a usable SVG. */
export function sanitizeSvg(input: string | Uint8Array): SanitizedSvg {
  const bytes = typeof input === "string" ? input.length : input.byteLength
  if (bytes > SVG_LIMITS.bytes) throw new SvgImportError("SVG is too large to import")
  const text = (typeof input === "string" ? input : new TextDecoder().decode(input)).replace(
    /^﻿/,
    "",
  )
  const raw = parseXml(text)
  const svgRoots = raw.children.filter((c) => c.name === "svg" || c.name.endsWith(":svg"))
  const rootRaw = svgRoots[0]
  if (!rootRaw || raw.children.length !== 1) throw new SvgImportError("Not an SVG file")
  const report: SanitizeReport = { blocked: [], unsupported: {} }
  const clean = (el: RawEl): SvgElement | null => {
    const name = el.name.replace(/^svg:/, "")
    if (!KEEP.has(name)) {
      if (UNSUPPORTED.has(name)) report.unsupported[name] = (report.unsupported[name] ?? 0) + 1
      else if (!METADATA.has(name) && !name.includes(":")) report.blocked.push(name)
      return null
    }
    const attrs: Record<string, string> = {}
    for (const [k, v] of el.attrs) {
      if (/^on/i.test(k)) {
        report.blocked.push(k)
        continue
      }
      if (k === "href" || k === "xlink:href") {
        if (/^#[\w.:-]+$/.test(v.trim())) attrs.href = v.trim()
        else report.blocked.push(`href:${v.slice(0, 64)}`)
        continue
      }
      if (!ATTRS.has(k)) continue
      if (UNSAFE_VALUE.test(v) || !urlsAreLocal(v)) {
        report.blocked.push(`${k}:${v.slice(0, 64)}`)
        continue
      }
      attrs[k] = v
    }
    const out: SvgElement = { name, attrs, children: [] }
    if (name === "style") {
      const css = el.text
      if (UNSAFE_VALUE.test(css.replace(/[<>]/g, "")) || !urlsAreLocal(css)) {
        report.blocked.push("style")
        return null
      }
      out.text = css
      return out
    }
    for (const c of el.children) {
      const k = clean(c)
      if (k) out.children.push(k)
    }
    return out
  }
  const root = clean(rootRaw)
  if (!root) throw new SvgImportError("Not an SVG file")
  return { root, report }
}

const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Serializes a sanitized tree as standalone SVG text (the "Image" option's stored asset). */
export function serializeSvg(root: SvgElement): string {
  const out: string[] = []
  const emit = (el: SvgElement, isRoot = false) => {
    const attrs = Object.entries(el.attrs)
      .map(([k, v]) => ` ${k === "href" ? "href" : k}="${escAttr(v)}"`)
      .join("")
    const ns = isRoot ? ' xmlns="http://www.w3.org/2000/svg"' : ""
    if (el.name === "style") {
      out.push(`<style>${(el.text ?? "").replace(/</g, "")}</style>`)
      return
    }
    if (!el.children.length) {
      out.push(`<${el.name}${ns}${attrs}/>`)
      return
    }
    out.push(`<${el.name}${ns}${attrs}>`)
    for (const c of el.children) emit(c)
    out.push(`</${el.name}>`)
  }
  emit(root, true)
  return out.join("")
}
