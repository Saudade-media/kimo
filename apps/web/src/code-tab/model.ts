/**
 * Code tab model (board 25 "v1 Polish" OqLSw › §1 Code tab nkVxr, rules G4uiv8): frameworks,
 * the per-file framework memory, the "Ink" tokenizer, the line source map (selected child →
 * line range), which nodes the tab generates for, the 400-line render cap and the panel copy.
 * Pure (no DOM, no React) so it is unit-tested directly.
 */

import type { InkKind, InkToken } from "@kimo/ui"

// --- Frameworks (rule "Switch": React + Tailwind · HTML + CSS · Tokens (DTCG)) ----------------

export type Framework = "react" | "html" | "tokens"

/** Framework Switch (ebO2s, SegmentedText FC6O7): labels in node order. */
export const FRAMEWORKS: readonly { value: Framework; label: string }[] = [
  { value: "react", label: "React + Tailwind" },
  { value: "html", label: "HTML + CSS" },
  { value: "tokens", label: "Tokens" },
]

export const DEFAULT_FRAMEWORK: Framework = "react"

/** Rule "Truncate": render cap per file (`CODE_TAB_MAX_LINES`). */
export const CODE_TAB_MAX_LINES = 400
/** Rule "Live": regenerate 150 ms after the last edit. */
export const LIVE_DEBOUNCE_MS = 150

const FRAMEWORK_KEY = "kimo.codeTab.framework"

/** Rule "Switch": remembered per file (`codeTab.framework`), default React + Tailwind. */
export function readFramework(
  fileKey: string,
  storage: Pick<Storage, "getItem"> | null,
): Framework {
  try {
    const raw = storage?.getItem(`${FRAMEWORK_KEY}.${fileKey}`)
    return raw === "react" || raw === "html" || raw === "tokens" ? raw : DEFAULT_FRAMEWORK
  } catch {
    return DEFAULT_FRAMEWORK
  }
}

export function writeFramework(
  fileKey: string,
  framework: Framework,
  storage: Pick<Storage, "setItem"> | null,
) {
  try {
    storage?.setItem(`${FRAMEWORK_KEY}.${fileKey}`, framework)
  } catch {}
}

// --- Copy -------------------------------------------------------------------------------------

/** "2,318" (en-US grouping, as on the board). */
export const formatCount = (n: number) => n.toLocaleString("en-US")

/** File Tabs › Meta (x2C0GA): "19 lines". */
export const linesMeta = (n: number) => `${formatCount(n)} ${n === 1 ? "line" : "lines"}`

/** Tokens › Meta (VwNHk): "4 used · 31 total". */
export const tokensMeta = (used: number, total: number) => `${used} used · ${total} total`

/** Truncation Bar › Title (zsmQI): "Showing 400 of 2,318 lines". */
export const truncatedTitle = (total: number) =>
  `Showing ${formatCount(CODE_TAB_MAX_LINES)} of ${formatCount(total)} lines`

/** Truncation Bar › Copy all (SunOY): "Copy all 2,318 lines". */
export const copyAllLabel = (total: number) => `Copy all ${formatCount(total)} lines`

/** Footer › Status (CyKZV / f8uYp). */
export const liveStatus = (paused: boolean) =>
  paused
    ? `Live · paused while > ${formatCount(CODE_TAB_MAX_LINES)} lines`
    : "Live · updates as you edit"

/** Rule "Copy": the toast after the Copy icon. */
export const copiedToast = (path: string) => `Copied ${path}`

/** Notice (xHvmD) title for an unsupported node type ("Prompt nodes have no code"). */
export const unsupportedTitle = (kind: string) => `${kind} nodes have no code`

export const UNSUPPORTED_DESC =
  "Notes, prompts and placeholder tags live only on the canvas — every exporter skips them. Select a frame, shape, text or instance."

/** Node types the exporters skip (`@kimo/exporters` SKIPPED). */
export const UNSUPPORTED_TYPES: ReadonlySet<string> = new Set(["note", "prompt"])

/** "Prompt" / "Note": the kind label of a skipped node. */
export const skippedKind = (type: string) => `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`

/**
 * Rule (e) "Mixed selection": each skipped node leaves a one-line comment in the output
 * (c3YQH: `{/* skipped: Prompt “Pricing brief” *\/}`), in the file's comment syntax. JSON has
 * no comments: nothing is added there.
 */
export function skippedComment(path: string, kind: string, name: string): string | null {
  const body = `skipped: ${kind} “${name}”`
  const lang = langOf(path)
  if (lang === "jsx") return /\.html?$/i.test(path) ? `<!-- ${body} -->` : `{/* ${body} */}`
  if (lang === "css") return `/* ${body} */`
  return null
}

// --- Which nodes the tab generates for -----------------------------------------------------

export interface CodeTarget {
  /** Nodes the code is generated for (the root component first). */
  roots: string[]
  /** Selected nodes inside a root: their line ranges are highlighted. */
  highlight: string[]
}

/**
 * The generated roots for a selection. Selected nodes without a selected ancestor are the roots;
 * the others are highlighted. While every selected node lies inside the current roots
 * (`previous`), the roots stay — selecting a child on the canvas (or clicking a line) highlights
 * its lines instead of replacing the code (rule "Highlight", vignette (a)).
 */
export function resolveTarget(
  selection: readonly string[],
  previous: readonly string[],
  isInside: (id: string, ancestor: string) => boolean,
): CodeTarget {
  if (selection.length === 0) return { roots: [], highlight: [] }
  const within = (id: string, set: readonly string[]) =>
    set.some((a) => a !== id && isInside(id, a))
  if (previous.length > 0 && selection.every((id) => previous.includes(id) || within(id, previous)))
    return { roots: [...previous], highlight: selection.filter((id) => !previous.includes(id)) }
  const roots = selection.filter((id) => !within(id, selection))
  return { roots, highlight: selection.filter((id) => !roots.includes(id)) }
}

/** `isInside` over parent links (`inst/child` view ids also nest by their IdPath prefix). */
export function insideBy(
  parentOf: (id: string) => string | null | undefined,
): (id: string, ancestor: string) => boolean {
  return (id, ancestor) => {
    if (id.startsWith(`${ancestor}/`)) return true
    const seen = new Set<string>()
    let p: string | null | undefined = id
    while (p && !seen.has(p)) {
      seen.add(p)
      const next: string | null | undefined =
        parentOf(p) ?? (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null)
      if (next === ancestor) return true
      p = next
    }
    return false
  }
}

// --- Source map (rule "Highlight": `sourceMap`) ---------------------------------------------

export interface LineRange {
  /** 1-based, inclusive. */
  start: number
  end: number
}

const ID_ATTR = /data-kimo-id=(?:"([^"]*)"|\{"([^"]*)"\})/g
const indentOf = (line: string) => line.length - line.trimStart().length

/**
 * Line ranges per node id, from the same emitter run with `data-kimo-id` attributes. The
 * emitters keep every attribute on the element's opening line, so the id run has the same lines
 * as the shown file; when it does not (line counts differ) there is no map.
 */
export function sourceMapOf(shown: string, withIds: string): Map<string, LineRange> | null {
  const a = shown.split("\n")
  const b = withIds.split("\n")
  if (a.length !== b.length) return null
  const map = new Map<string, LineRange>()
  for (let i = 0; i < b.length; i++) {
    const line = b[i] as string
    const ids = [...line.matchAll(ID_ATTR)].map((m) => m[1] ?? m[2] ?? "")
    if (ids.length === 0) continue
    const first = ids[0] as string
    let end = i
    const trimmed = line.trimEnd()
    const closed = trimmed.endsWith("/>") || /<\/[\w.:-]+>\s*$/.test(trimmed)
    if (!closed) {
      const indent = indentOf(line)
      for (let j = i + 1; j < b.length; j++) {
        const l = b[j] as string
        if (l.trim() === "") continue
        if (indentOf(l) === indent && l.trimStart().startsWith("</")) {
          end = j
          break
        }
        if (indentOf(l) <= indent) break
      }
    }
    if (!map.has(first)) map.set(first, { start: i + 1, end: end + 1 })
    for (const id of ids.slice(1)) if (!map.has(id)) map.set(id, { start: i + 1, end: i + 1 })
  }
  return map
}

/** Lines to highlight for the selected children. */
export function highlightedLines(
  map: ReadonlyMap<string, LineRange> | null,
  ids: readonly string[],
): Set<number> {
  const out = new Set<number>()
  if (!map) return out
  for (const id of ids) {
    const r = map.get(id)
    if (r) for (let n = r.start; n <= r.end; n++) out.add(n)
  }
  return out
}

/** Rule "Highlight": "clicking a line selects the layer" — the innermost node on that line. */
export function nodeAtLine(
  map: ReadonlyMap<string, LineRange> | null,
  line: number,
): string | null {
  if (!map) return null
  let best: { id: string; span: number; start: number } | null = null
  for (const [id, r] of map) {
    if (line < r.start || line > r.end) continue
    const span = r.end - r.start
    if (!best || span < best.span || (span === best.span && r.start > best.start))
      best = { id, span, start: r.start }
  }
  return best?.id ?? null
}

// --- Ink tokenizer ("Ink" code theme) -------------------------------------------------------

export type InkLang = "jsx" | "css" | "json" | "text"

export function langOf(path: string): InkLang {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  if (["tsx", "ts", "jsx", "js", "html", "htm", "svg", "xml"].includes(ext)) return "jsx"
  if (ext === "css") return "css"
  if (ext === "json") return "json"
  return "text"
}

const KEYWORDS = new Set([
  "export",
  "default",
  "function",
  "return",
  "import",
  "from",
  "const",
  "let",
  "var",
  "type",
  "interface",
  "extends",
  "as",
  "if",
  "else",
  "new",
  "true",
  "false",
  "null",
  "undefined",
  "readonly",
  "typeof",
  "keyof",
])

function push(out: InkToken[], kind: InkKind, text: string) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ kind, text })
}

/** Block-comment state carried between lines (`/* …` or `<!-- …` left open). */
export type InkState = { comment: null | "*/" | "-->" }

const JSX_RE =
  /(\{\/\*)|(\/\*)|(<!--)|(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?)([A-Za-z][\w.:-]*)|([A-Za-z_][\w:.-]*)(?=\s*=(?!=))|\b([A-Za-z_$][\w$]*)\b|([<>/={}();,[\]])/g
const CSS_RE =
  /(\/\*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[\w-]+)|(--[\w-]+|-?[a-z][a-z-]*)(?=\s*:(?!:))|([{}:;,()])/g
const JSON_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\]:,])/g

/** A JSX/TSX/HTML line whose text is element content, not markup (`Plan less. Ship more.`). */
const isTextContent = (line: string) => !/[<>{}()=;]/.test(line) && line.trim() !== ""

/**
 * Splits one line into Ink tokens: keywords / tag names / object keys `strong`, attribute and
 * property names / `$` keys `attr`, punctuation `punct`, comments `comment`, the rest `plain`.
 * `state` carries block comments across lines.
 */
export function tokenizeInk(line: string, lang: InkLang, state: InkState = { comment: null }) {
  const out: InkToken[] = []
  let at = 0
  // Inside a block comment from a previous line.
  if (state.comment) {
    const close = line.indexOf(state.comment)
    if (close < 0) {
      push(out, "comment", line)
      return out
    }
    push(out, "comment", line.slice(0, close + state.comment.length))
    at = close + state.comment.length
    state.comment = null
  }
  if (lang === "text") {
    push(out, "plain", line.slice(at))
    return out
  }
  if (lang === "jsx" && at === 0 && isTextContent(line)) {
    push(out, "plain", line)
    return out
  }
  const re = lang === "jsx" ? JSX_RE : lang === "css" ? CSS_RE : JSON_RE
  re.lastIndex = at
  for (let m = re.exec(line); m; m = re.exec(line)) {
    push(out, "plain", line.slice(at, m.index))
    at = m.index + m[0].length
    if (lang === "jsx") {
      if (m[1] || m[2] || m[3]) {
        // `{/* … */}`, `/* … */`, `<!-- … -->`: braces are punctuation, the comment italic.
        const open = m[1] ? "/*" : m[2] ? "/*" : "<!--"
        const closer = open === "<!--" ? "-->" : "*/"
        if (m[1]) push(out, "punct", "{")
        const start = m.index + (m[1] ? 1 : 0)
        const close = line.indexOf(closer, start + open.length)
        if (close < 0) {
          push(out, "comment", line.slice(start))
          state.comment = closer
          return out
        }
        push(out, "comment", line.slice(start, close + closer.length))
        at = close + closer.length
        if (m[1] && line[at] === "}") {
          push(out, "punct", "}")
          at += 1
        }
        re.lastIndex = at
      } else if (m[4]) push(out, "comment", m[4])
      else if (m[5]) push(out, "plain", m[5])
      else if (m[6] && m[7]) {
        push(out, "punct", m[6])
        push(out, "strong", m[7])
      } else if (m[8]) push(out, "attr", m[8])
      else if (m[9]) push(out, KEYWORDS.has(m[9]) ? "strong" : "plain", m[9])
      else if (m[10]) push(out, "punct", m[10])
    } else if (lang === "css") {
      if (m[1]) {
        const close = line.indexOf("*/", m.index + 2)
        if (close < 0) {
          push(out, "comment", line.slice(m.index))
          state.comment = "*/"
          return out
        }
        push(out, "comment", line.slice(m.index, close + 2))
        at = close + 2
        re.lastIndex = at
      } else if (m[2]) push(out, "plain", m[2])
      else if (m[3]) push(out, "strong", m[3])
      else if (m[4]) push(out, "attr", m[4])
      else if (m[5]) push(out, "punct", m[5])
    } else {
      // JSON: group keys strong, `$`-keys attributes, values plain, punctuation tertiary.
      if (m[1]) {
        if (m[2]) {
          push(out, m[1].startsWith('"$') ? "attr" : "strong", m[1])
          push(out, "punct", m[2])
        } else push(out, "plain", m[1])
      } else if (m[3]) push(out, "punct", m[3])
    }
  }
  // CSS selectors (`.k-hero {`): the selector reads like a tag name.
  const rest = line.slice(at)
  if (lang === "css" && out.length > 0) {
    // Promote a leading selector (plain text before `{`).
    const first = out[0]
    const brace = out[1]
    if (first?.kind === "plain" && brace?.kind === "punct" && brace.text.startsWith("{")) {
      const lead = first.text.match(/^\s*/)?.[0] ?? ""
      out.splice(0, 1, ...(lead ? [{ kind: "plain" as const, text: lead }] : []), {
        kind: "strong",
        text: first.text.slice(lead.length),
      })
    }
  }
  push(out, "plain", rest)
  return out
}

/** Tokenizes the first `limit` lines of a file (block comments carried across lines). */
export function inkLines(
  lines: readonly string[],
  lang: InkLang,
  limit = lines.length,
): InkToken[][] {
  const state: InkState = { comment: null }
  const out: InkToken[][] = []
  for (let i = 0; i < Math.min(limit, lines.length); i++)
    out.push(tokenizeInk(lines[i] as string, lang, state))
  return out
}

/** Lines of a file (a trailing newline does not add an empty line). */
export function codeLines(contents: string): string[] {
  const lines = contents.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines
}
