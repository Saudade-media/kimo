/**
 * Board 33 "Reply formatting" (desing.pen ME2DT): the Markdown subset model replies render with.
 *
 * Blocks: paragraphs, fenced code, bullet and numbered lists (one nested level; deeper levels
 * flatten into it). Headings become bold paragraphs; block quotes, tables and raw HTML stay text.
 * Inlines: **bold** / __bold__, *italic* / _italic_, `code`, [label](url), bare http(s) URLs.
 *
 * The output is a plain data tree. Nothing here produces HTML: the renderer builds React elements
 * from it, so model output can never inject markup. Link targets are limited to http(s) / mailto.
 */

export type MdInline =
  | { t: "text"; v: string }
  | { t: "strong"; c: MdInline[] }
  | { t: "em"; c: MdInline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: MdInline[] }
  | { t: "br" }

export interface MdListItem {
  c: MdInline[]
  sub?: MdList
}

export interface MdList {
  t: "list"
  ordered: boolean
  start: number
  items: MdListItem[]
}

export type MdBlock = { t: "p"; c: MdInline[] } | { t: "code"; v: string } | MdList

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}>[ \t]?/

/** Only these schemes become clickable links. */
export function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, "")
  if (/[\s<>"]/.test(href)) return null
  return /^(https?:\/\/[^/]|mailto:)/i.test(href) ? href : null
}

/** Parses a model reply into blocks. Never throws; unknown syntax stays text. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n")
  const out: MdBlock[] = []
  let para: string[] = []
  let list: MdList | null = null
  // The open nested list of the last top-level item, and the item receiving continuation lines.
  let lastItem: MdListItem | null = null
  let lastText: string[] = []
  let blankInList = false

  const flushItem = () => {
    if (lastItem && lastText.length) lastItem.c = parseInline(lastText.join("\n"))
    lastText = []
  }
  const flushPara = () => {
    if (para.length) out.push({ t: "p", c: parseInline(para.join("\n")) })
    para = []
  }
  const closeList = () => {
    flushItem()
    if (list) out.push(list)
    list = null
    lastItem = null
    blankInList = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    let fence = FENCE.exec(line)
    // Inline code spans like ```x``` on one line are not fences.
    if (fence && fence[1]?.[0] === "`" && (fence[2] as string).includes("`")) fence = null
    if (fence) {
      flushPara()
      closeList()
      const mark = fence[1] as string
      const body: string[] = []
      for (i++; i < lines.length; i++) {
        const l = lines[i] as string
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l)?.[1]
        if (close && close[0] === mark[0] && close.length >= mark.length) break
        body.push(l)
      }
      out.push({ t: "code", v: body.join("\n") })
      continue
    }
    if (!line.trim()) {
      flushPara()
      if (list) blankInList = true
      continue
    }
    const item = ITEM.exec(line)
    if (item && !RULE.test(line)) {
      flushPara()
      const indent = (item[1] as string).length
      const marker = item[2] as string
      const ordered = /\d/.test(marker)
      const text = item[3] as string
      if (list && indent >= 2 && lastItem) {
        // Nested (any depth ≥ 1 flattens into the one nested level).
        flushItem()
        const parent = (list as MdList).items[(list as MdList).items.length - 1] as MdListItem
        parent.sub ??= {
          t: "list",
          ordered,
          start: ordered ? Number.parseInt(marker, 10) : 1,
          items: [],
        }
        const it: MdListItem = { c: [] }
        parent.sub.items.push(it)
        lastItem = it
        lastText = [text]
        blankInList = false
        continue
      }
      if (!list || (list as MdList).ordered !== ordered) {
        closeList()
        list = { t: "list", ordered, start: ordered ? Number.parseInt(marker, 10) : 1, items: [] }
      }
      flushItem()
      const it: MdListItem = { c: [] }
      ;(list as MdList).items.push(it)
      lastItem = it
      lastText = [text]
      blankInList = false
      continue
    }
    if (list) {
      // A continuation line belongs to the item unless a blank line came first and it is not
      // indented (then the list has ended).
      if (!blankInList || /^\s{2,}/.test(line)) {
        lastText.push(line.trim())
        blankInList = false
        continue
      }
      closeList()
    }
    if (RULE.test(line)) {
      flushPara()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushPara()
      out.push({ t: "p", c: [{ t: "strong", c: parseInline(heading[1] as string) }] })
      continue
    }
    para.push((QUOTE.test(line) ? line.replace(QUOTE, "") : line).trim())
  }
  flushPara()
  closeList()
  return out
}

const PUNCT = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u
const URL_RE = /https?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/y

/** Parses inline Markdown (no block syntax). Unmatched marks stay literal. */
export function parseInline(src: string, inLink = false): MdInline[] {
  const out: MdInline[] = []
  let buf = ""
  const text = () => {
    if (buf) out.push({ t: "text", v: buf })
    buf = ""
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === "\\" && i + 1 < src.length && PUNCT.test(src[i + 1] as string)) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === "\n") {
      text()
      out.push({ t: "br" })
      i++
      continue
    }
    if (ch === "`") {
      let n = 1
      while (src[i + n] === "`") n++
      const ticks = "`".repeat(n)
      const end = findTicks(src, i + n, n)
      if (end >= 0) {
        text()
        let v = src.slice(i + n, end).replace(/\n/g, " ")
        if (v.length > 2 && v.startsWith(" ") && v.endsWith(" ")) v = v.slice(1, -1)
        out.push({ t: "code", v })
        i = end + n
        continue
      }
      buf += ticks
      i += n
      continue
    }
    if (ch === "[" && !inLink) {
      const link = matchLink(src, i)
      if (link) {
        text()
        const label = parseInline(link.label, true)
        const href = safeHref(link.href)
        if (href) out.push({ t: "link", href, c: label })
        else out.push(...label)
        i = link.end
        continue
      }
    }
    if ((ch === "h" || ch === "H") && !inLink && !WORD.test(src[i - 1] ?? " ")) {
      URL_RE.lastIndex = i
      const m = URL_RE.exec(src)
      if (m) {
        text()
        out.push({ t: "link", href: m[0], c: [{ t: "text", v: m[0] }] })
        i += m[0].length
        continue
      }
    }
    if (ch === "*" || ch === "_") {
      const double = src[i + 1] === ch
      const n = double ? 2 : 1
      const end = findClose(src, i, ch, n)
      if (end >= 0) {
        text()
        const inner = parseInline(src.slice(i + n, end), inLink)
        out.push(double ? { t: "strong", c: inner } : { t: "em", c: inner })
        i = end + n
        continue
      }
      buf += src.slice(i, i + n)
      i += n
      continue
    }
    buf += ch
    i++
  }
  text()
  return out
}

function findTicks(src: string, from: number, n: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] !== "`") continue
    let k = 0
    while (src[j + k] === "`") k++
    if (k === n) return j
    j += k - 1
  }
  return -1
}

/** Emphasis close: the opener must be followed by non-space; `_` must not sit inside a word. */
function findClose(src: string, at: number, ch: string, n: number): number {
  const after = src[at + n]
  if (after === undefined || /\s/.test(after) || after === ch) return -1
  if (ch === "_" && WORD.test(src[at - 1] ?? " ")) return -1
  const mark = ch.repeat(n)
  for (let j = at + n + 1; j <= src.length - n; j++) {
    if (src[j] === "`") {
      const k = findTicks(src, j + 1, 1)
      if (k > 0) j = k
      continue
    }
    if (src.startsWith(mark, j) && !/\s/.test(src[j - 1] as string)) {
      // `**a*` style runs: a single mark must not be part of a double one.
      if (n === 1 && src[j + 1] === ch) {
        j++
        continue
      }
      if (ch === "_" && WORD.test(src[j + n] ?? " ")) continue
      return j
    }
  }
  return -1
}

function matchLink(src: string, at: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let j = at
  for (; j < src.length; j++) {
    const c = src[j]
    if (c === "\\") {
      j++
      continue
    }
    if (c === "[") depth++
    else if (c === "]" && --depth === 0) break
    else if (c === "\n") return null
  }
  if (src[j] !== "]" || src[j + 1] !== "(") return null
  let k = j + 2
  let parens = 1
  for (; k < src.length; k++) {
    const c = src[k]
    if (c === "(") parens++
    else if (c === ")" && --parens === 0) break
    else if (c === "\n") return null
  }
  if (src[k] !== ")") return null
  const href = (
    src
      .slice(j + 2, k)
      .trim()
      .split(/\s+/)[0] ?? ""
  ).trim()
  return { label: src.slice(at + 1, j), href, end: k + 1 }
}

/** Plain text of inlines (for the status line, step labels and tooltips). */
export function inlineText(c: MdInline[]): string {
  return c
    .map((x) => (x.t === "text" || x.t === "code" ? x.v : x.t === "br" ? " " : inlineText(x.c)))
    .join("")
}

/**
 * Markdown → one plain line: marks stripped, list markers and fences dropped, whitespace
 * collapsed. Used by the live status line, where a partial reply may still be streaming.
 */
export function stripMarkdown(src: string): string {
  const parts: string[] = []
  const walk = (blocks: MdBlock[]) => {
    for (const b of blocks) {
      if (b.t === "p") parts.push(inlineText(b.c))
      else if (b.t === "code") parts.push(b.v)
      else
        for (const it of b.items) {
          parts.push(inlineText(it.c))
          if (it.sub) walk([it.sub])
        }
    }
  }
  walk(parseMarkdown(src))
  return parts
    .join(" ")
    .replace(/[*_`]{2,}/g, "")
    .replace(/(^|\s)[*_`](?=\S)|(?<=\S)[*_`](?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}
