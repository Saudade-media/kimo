/**
 * Live text: the characters of the open inline editor (the contenteditable `RichTextEditor`
 * renders) as a {@link TextGeometry}, measured from DOM range rects, in world units. Remote
 * carets in the layer you edit draw from it (the canvas text is hidden under the editor); other
 * layers use the renderer's layout (`Renderer.textGeometry`).
 *
 * Each character's line box is its content area grown to the run's line height around the same
 * center (CSS half-leading), so ranges and carets take the full line height as on the canvas.
 */
import type { TextCharBox, TextGeometry } from "@kimo/renderer"

/** The editor's text nodes in order, with their offset in the text. */
function textNodes(el: HTMLElement): { node: Text; start: number }[] {
  const out: { node: Text; start: number }[] = []
  let at = 0
  const walk = (n: Node) => {
    if (n instanceof Text) {
      out.push({ node: n, start: at })
      at += n.data.length
      return
    }
    for (const c of n.childNodes) walk(c)
  }
  walk(el)
  return out
}

/**
 * The geometry of editor `el` (the `.canvas-host__text-editor` element). `toWorld` maps a
 * client point to world units.
 */
export function editorTextGeometry(
  el: HTMLElement,
  toWorld: (clientX: number, clientY: number) => { x: number; y: number },
): TextGeometry {
  const nodes = textNodes(el)
  const text = nodes.map((n) => n.node.data).join("")
  const range = el.ownerDocument.createRange()
  const cache = new Map<number, TextCharBox | null>()
  const own = getComputedStyle(el)
  const ownSize = Number.parseFloat(own.fontSize) || 16
  const lineHeightOf = (cs: CSSStyleDeclaration, size: number) => {
    const lh = Number.parseFloat(cs.lineHeight)
    return Number.isFinite(lh) && lh > 0 ? lh : size * 1.2
  }
  const ownLine = lineHeightOf(own, ownSize)
  let firstTop: number | null = null

  const measure = (i: number): Omit<TextCharBox, "line"> | null => {
    if (i < 0 || i >= text.length || text[i] === "\n") return null
    const hit = nodes.find((n) => i >= n.start && i < n.start + n.node.data.length)
    if (!hit) return null
    const local = i - hit.start
    // A surrogate pair is one character: measure the pair from either half.
    const code = text.charCodeAt(i)
    const lo = code >= 0xdc00 && code <= 0xdfff && local > 0 ? local - 1 : local
    const hi =
      code >= 0xd800 && code <= 0xdbff && local + 1 < hit.node.data.length ? local + 2 : lo + 1
    range.setStart(hit.node, lo)
    range.setEnd(hit.node, Math.max(hi, lo + 1))
    const r = range.getBoundingClientRect()
    if (!r.width && !r.height) return null
    const span = hit.node.parentElement ?? el
    const cs = getComputedStyle(span)
    const fontSize = Number.parseFloat(cs.fontSize) || ownSize
    const line = lineHeightOf(cs, fontSize)
    const a = toWorld(r.left, r.top)
    const b = toWorld(r.right, r.bottom)
    const mid = (a.y + b.y) / 2
    return { x0: a.x, x1: b.x, top: mid - line / 2, height: line, fontSize }
  }

  const first = (): number => {
    if (firstTop !== null) return firstTop
    for (let i = 0; i < text.length; i++) {
      const m = measure(i)
      if (m) {
        firstTop = m.top
        return firstTop
      }
    }
    const r = el.getBoundingClientRect()
    firstTop = toWorld(r.left, r.top).y
    return firstTop
  }

  return {
    text,
    char(i) {
      if (cache.has(i)) return cache.get(i) ?? null
      const m = measure(i)
      const box = m ? { ...m, line: Math.max(0, Math.round((m.top - first()) / m.height)) } : null
      cache.set(i, box)
      return box
    },
    lineStart(line) {
      const r = el.getBoundingClientRect()
      const left = toWorld(r.left, r.top)
      const right = toWorld(r.right, r.top)
      const align = own.textAlign
      const x = align === "center" ? (left.x + right.x) / 2 : align === "right" ? right.x : left.x
      const top = first() + line * ownLine
      return { x0: x, x1: x, top, height: ownLine, fontSize: ownSize, line }
    },
  }
}
