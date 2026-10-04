/**
 * A tiny element model shared by the HTML, React and SVG emitters, with two deterministic
 * serializers: HTML/XML markup and JSX. Formatting is fixed (two-space indent, one element per
 * line, an element whose only child is text on one line), so output is stable without a
 * formatter.
 */

/** A JSX expression (React emitter only): written verbatim inside `{}`. */
export interface Expr {
  expr: string
}

export type AttrValue = string | number | boolean | Expr

export interface El {
  tag: string
  attrs: [string, AttrValue][]
  children: Child[]
}

export type Child =
  | El
  | { text: string }
  | Expr
  /** A conditional/mapped JSX block: `{cond && (` children `)}` (React only). */
  | { block: string; close: string; children: Child[] }

export const isEl = (c: Child): c is El => "tag" in c

export function el(tag: string, attrs: [string, AttrValue][] = [], children: Child[] = []): El {
  return { tag, attrs, children }
}

export const text = (t: string): Child => ({ text: t })

const VOID = new Set(["img", "br", "hr", "input", "meta", "link"])

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escAttr = (s: string) => escHtml(s).replace(/"/g, "&quot;")

/** HTML (`xml` true: self-closing empty elements, for standalone SVG). */
export function toHtml(node: El, indent = 0, xml = false): string {
  const pad = "  ".repeat(indent)
  const attrs = node.attrs
    .map(([k, v]) => {
      if (v === false) return ""
      if (v === true) return xml ? ` ${k}="${k}"` : ` ${k}`
      if (typeof v === "object") throw new Error("expressions are JSX only")
      return ` ${k}="${escAttr(String(v))}"`
    })
    .join("")
  const open = `${pad}<${node.tag}${attrs}`
  if (node.children.length === 0) {
    if (xml) return `${open}/>`
    return VOID.has(node.tag) ? `${open}>` : `${open}></${node.tag}>`
  }
  const only = node.children[0]
  if (node.children.length === 1 && only && "text" in only)
    return `${open}>${escHtml(only.text)}</${node.tag}>`
  // Mixed text runs stay on one line (whitespace is significant in text).
  if (node.children.every((c) => "text" in c || (isEl(c) && c.children.every((x) => "text" in x))))
    return `${open}>${node.children.map((c) => ("text" in c ? escHtml(c.text) : toHtml(c as El, 0, xml))).join("")}</${node.tag}>`
  const kids = node.children.map((c) => {
    if (isEl(c)) return toHtml(c, indent + 1, xml)
    if ("text" in c) return `${pad}  ${escHtml(c.text)}`
    throw new Error("expressions are JSX only")
  })
  return `${open}>\n${kids.join("\n")}\n${pad}</${node.tag}>`
}

// --- JSX ----------------------------------------------------------------------------------

const JSX_ATTR: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  "xlink:href": "xlinkHref",
}

function jsxAttrName(k: string): string {
  if (JSX_ATTR[k]) return JSX_ATTR[k] as string
  if (k.startsWith("data-") || k.startsWith("aria-")) return k
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9 .,!?'·:;()$%#@+*/=-]*$/

function jsxText(t: string): string {
  return SAFE_TEXT.test(t) && !t.endsWith(" ") ? t : `{${JSON.stringify(t)}}`
}

function jsxAttr([k, v]: [string, AttrValue]): string {
  const name = jsxAttrName(k)
  if (v === true) return ` ${name}`
  if (v === false) return ` ${name}={false}`
  if (typeof v === "number") return ` ${name}={${v}}`
  if (typeof v === "object") return ` ${name}={${v.expr}}`
  return /["\\{}]|[\n\r]/.test(v) ? ` ${name}={${JSON.stringify(v)}}` : ` ${name}="${v}"`
}

/** JSX markup at `indent` levels. */
export function toJsx(node: Child, indent = 0): string {
  const pad = "  ".repeat(indent)
  if ("text" in node) return `${pad}${jsxText(node.text)}`
  if ("block" in node)
    return `${pad}${node.block}\n${node.children.map((c) => toJsx(c, indent + 1)).join("\n")}\n${pad}${node.close}`
  if ("expr" in node) return `${pad}{${node.expr}}`
  const open = `${pad}<${node.tag}${node.attrs.map(jsxAttr).join("")}`
  if (node.children.length === 0) return `${open} />`
  const inline = node.children.every((c) => "text" in c || ("expr" in c && !("block" in c)))
  if (inline)
    return `${open}>${node.children.map((c) => ("text" in c ? jsxText(c.text) : `{${(c as Expr).expr}}`)).join("")}</${node.tag}>`
  return `${open}>\n${node.children.map((c) => toJsx(c, indent + 1)).join("\n")}\n${pad}</${node.tag}>`
}
