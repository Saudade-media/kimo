/**
 * Shared by the measured pass and its fixture generator: collects every design-named element
 * under a frame root as { path, x, y, w, h } relative to the root. Paths are the chain of node
 * names, with "#k" for the k-th sibling of the same name ("Hero/Download row/Button · Linux").
 *
 * The page function is serialized into the browser, so it must stay self-contained.
 */
export interface Box {
  path: string
  x: number
  y: number
  w: number
  h: number
  /** Computed type of a text node: font-size/weight/line-height/letter-spacing/color. */
  t?: string
  /** Computed fill of a frame (background-color, when not transparent) and its radius. */
  f?: string
}

/**
 * Fixes the Pencil export's per-side strokes for measuring. The export draws a centered stroke
 * as a content-box border plus a negative margin and sizes the box as (node − stroke/2), which
 * both shifts the content by the border and drops the padding from the size. Pencil itself lays
 * a stroke out of flow: the node is its own size and the padding starts at its edge. So: a
 * border-box of the node's size, no border, no margin.
 */
export const fixExportBoxes = (): number => {
  let n = 0
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-pencil-id]"))) {
    // Pencil's "normal" line height is the font's ascent + descent rounded to a whole pixel.
    if (el.style.lineHeight === "normal" && el.style.fontSize) {
      const fs = Number.parseFloat(el.style.fontSize)
      const mono = el.style.fontFamily.includes("Mono")
      el.style.lineHeight = `${Math.round(fs * (mono ? 1.32 : 1.2109375))}px`
    }
    if (el.style.boxSizing !== "content-box") continue
    const st = getComputedStyle(el)
    const b = [
      st.borderTopWidth,
      st.borderRightWidth,
      st.borderBottomWidth,
      st.borderLeftWidth,
    ].map((v) => Number.parseFloat(v) || 0) as [number, number, number, number]
    el.style.boxSizing = "border-box"
    if (el.style.width.endsWith("px"))
      el.style.width = `${Number.parseFloat(el.style.width) + (b[1] + b[3]) / 2}px`
    if (el.style.height.endsWith("px"))
      el.style.height = `${Number.parseFloat(el.style.height) + (b[0] + b[2]) / 2}px`
    el.style.borderWidth = "0"
    el.style.margin = "0"
    n++
  }
  return n
}

export const collectBoxes = (args: { rootSel: string; attr: string }): Box[] => {
  const root = document.querySelector(args.rootSel)
  if (!root) return []
  const r0 = root.getBoundingClientRect()
  const out: {
    path: string
    x: number
    y: number
    w: number
    h: number
    t?: string
    f?: string
  }[] = []
  const hasNamedChild = (el: Element): boolean =>
    Array.from(el.children).some((c) => c.hasAttribute(args.attr) || hasNamedChild(c))
  const walk = (el: Element, prefix: string) => {
    const counts = new Map<string, number>()
    for (const child of Array.from(el.children)) {
      const name = child.getAttribute(args.attr)
      const st = getComputedStyle(child)
      if (st.display === "none") continue
      if (name === null) {
        walk(child, prefix)
        continue
      }
      const n = counts.get(name) ?? 0
      counts.set(name, n + 1)
      const path = `${prefix}${prefix ? "/" : ""}${name}${n ? `#${n}` : ""}`
      const r = child.getBoundingClientRect()
      const box: {
        path: string
        x: number
        y: number
        w: number
        h: number
        t?: string
        f?: string
      } = {
        path,
        x: Math.round((r.left - r0.left) * 2) / 2,
        y: Math.round((r.top - r0.top) * 2) / 2,
        w: Math.round(r.width * 2) / 2,
        h: Math.round(r.height * 2) / 2,
      }
      const isText =
        child.tagName !== "svg" &&
        !hasNamedChild(child) &&
        (child.textContent ?? "").trim() !== "" &&
        child.children.length === 0
      if (isText)
        box.t = [
          st.fontSize,
          st.fontWeight,
          st.lineHeight,
          st.letterSpacing === "normal" ? "0px" : st.letterSpacing,
          st.color,
        ].join(" ")
      else if (st.backgroundColor !== "rgba(0, 0, 0, 0)" && st.backgroundImage === "none")
        box.f = `${st.backgroundColor} r${st.borderTopLeftRadius}`
      out.push(box)
      walk(child, path)
    }
  }
  walk(root, "")
  return out
}
