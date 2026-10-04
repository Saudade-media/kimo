/**
 * Markdown → docs HTML, mapped onto the board 26 article nodes:
 *
 *   heading (page depth + 1)  "H2 · …" frame (padding-top 20) › H2 24/600 — and a TOC entry
 *   heading (deeper)          H3
 *   paragraph                 "Paragraph" 16/1.65 text-secondary
 *   ``` fence                 "Code · …" block (header: icon, label, Copy; Ink lines)
 *   table                     "Table · …" (desktop) + "Table → stacked rows" (mobile)
 *   > [!NOTE] / [!WARNING] …  "Callout · Note" / "Callout · Warning" / "Callout · Feature flag"
 */
import { existsSync, statSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import { Lexer, Parser, Renderer, type Token, type Tokens } from "marked"
import { REPO_ROOT, type SiteConfig } from "../config"
import { esc, icon } from "../html"
import { highlight, type Lang, langOf } from "./highlight"
import { type DocPage, githubSlug, stripMd } from "./sources"

export interface TocEntry {
  id: string
  text: string
}

export interface Rendered {
  lead: string | null
  html: string
  toc: TocEntry[]
  /** Plain text, for the search index and the read time. */
  plain: string
  headings: TocEntry[]
}

export interface LinkContext {
  cfg: SiteConfig
  /** source path → page */
  bySource: Map<string, DocPage>
  /** "source#anchor" → page url (split files keep their anchors working across pages) */
  anchors: Map<string, string>
  /** "source#anchor" keys that name a whole split page (linked without the anchor). */
  pageAnchors?: Set<string>
}

const RFC_KEYWORDS =
  /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|REQUIRED|RECOMMENDED|NOT RECOMMENDED|MAY|OPTIONAL)\b/g

/** Resolves a markdown link written relative to `source`. */
export function resolveHref(
  href: string,
  source: string,
  ctx: LinkContext,
  page?: DocPage,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href
  const [rawPath, anchor] = href.split("#") as [string, string | undefined]
  if (rawPath === "") {
    // Same file: the anchor may live on another page of a split file.
    const url = anchor ? ctx.anchors.get(`${source}#${anchor}`) : undefined
    if (url && ctx.pageAnchors?.has(`${source}#${anchor}`)) return url
    if (url && page && url !== page.url) return `${url}#${anchor}`
    return `#${anchor ?? ""}`
  }
  const target = normalize(join(dirname(source), decodeURI(rawPath))).replace(/\/$/, "")
  const hit = ctx.bySource.get(target)
  if (hit) {
    if (anchor) {
      const url = ctx.anchors.get(`${target}#${anchor}`)
      if (url && ctx.pageAnchors?.has(`${target}#${anchor}`)) return url
      return `${url ?? hit.url}#${anchor}`
    }
    return hit.url
  }
  const abs = join(REPO_ROOT, target)
  const isDir = existsSync(abs) && statSync(abs).isDirectory()
  const url = isDir ? ctx.cfg.tree(target) : ctx.cfg.blob(target)
  return anchor ? `${url}#${anchor}` : url
}

const LANG_LABEL: Record<Lang, string> = {
  json: "JSON",
  js: "TypeScript",
  css: "CSS",
  sh: "Terminal",
  toml: "TOML",
  text: "Text",
}

/** "Code · …" block in the Ink theme. */
export function codeBlock(code: string, info: string | undefined): string {
  const lang = langOf(info)
  const lines = highlight(code, lang)
  const label =
    lang === "js" && /tsx|jsx|html/.test(info ?? "") ? (info ?? "").toUpperCase() : LANG_LABEL[lang]
  const body = lines
    .map(
      (toks) =>
        `<div class="code__line">${toks.map((t) => `<span class="t t--${t.kind}">${esc(t.text)}</span>`).join("") || " "}</div>`,
    )
    .join("")
  return `<div class="code doc-code" data-node="Code · ${esc(label)}"><div class="code__header" data-node="Header">${
    lang === "sh"
      ? icon("terminal", 14, "code__icon").value
      : icon("file-code", 14, "code__icon").value
  }<span class="code__file" data-node="File name">${esc(label)}</span><span class="code__spacer"></span><button type="button" class="copy copy--label" data-copy data-node="Copy">${icon("copy", 13).value}<span>Copy</span></button></div><pre class="code__lines" data-node="Lines">${body}</pre></div>`
}

type CalloutKind = "note" | "warning" | "flag"

const CALLOUT_MARKERS: Record<string, CalloutKind> = {
  NOTE: "note",
  TIP: "note",
  IMPORTANT: "flag",
  WARNING: "warning",
  CAUTION: "warning",
}

const CALLOUT_ICON: Record<CalloutKind, string> = {
  note: "info",
  warning: "triangle-alert",
  flag: "flag",
}

/** A "Callout · …" box; `title` may be empty (the body then stands alone). */
export function callout(kind: CalloutKind, title: string, bodyHtml: string): string {
  return `<aside class="callout callout--${kind}" data-node="Callout · ${kind === "note" ? "Note" : kind === "warning" ? "Warning" : "Feature flag"}">${
    icon(CALLOUT_ICON[kind], 18, "callout__icon").value
  }<div class="callout__text" data-node="Text">${title ? `<div class="callout__title" data-node="Title">${title}</div>` : ""}<div class="callout__body" data-node="Body">${bodyHtml}</div></div></aside>`
}

export function renderMarkdown(md: string, page: DocPage, ctx: LinkContext): Rendered {
  const tokens = new Lexer({ gfm: true }).lex(md)
  const isSpec = page.kind === "spec"
  const toc: TocEntry[] = []
  const headings: TocEntry[] = []
  const used = new Map<string, number>()
  const plain: string[] = []

  const inline = new Renderer()
  inline.link = ({ href, title, tokens: t }: Tokens.Link) => {
    const url = resolveHref(href, page.source, ctx, page)
    const ext = /^https?:/.test(url)
    return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${parser.parseInline(t)}</a>`
  }
  inline.codespan = ({ text }: Tokens.Codespan) => `<code>${text}</code>`
  inline.html = ({ text }) => (/^<!--/.test(text) ? "" : esc(text))
  inline.image = ({ href, text }: Tokens.Image) =>
    `<img src="${esc(resolveHref(href, page.source, ctx, page))}" alt="${esc(text)}" loading="lazy">`
  if (isSpec) {
    const baseText = inline.text.bind(inline)
    inline.text = (t: Tokens.Text | Tokens.Escape) => {
      const out = baseText(t)
      return "tokens" in t && t.tokens
        ? out
        : out.replace(RFC_KEYWORDS, '<span class="kw">$1</span>')
    }
  }
  const parser = new Parser({ renderer: inline, gfm: true })
  inline.parser = parser

  const inl = (t: Token[] | undefined) => parser.parseInline(t ?? [])
  const textOf = (t: Token[] | undefined): string =>
    (t ?? [])
      .map((x) =>
        "tokens" in x && x.tokens ? textOf(x.tokens) : "text" in x ? String(x.text) : "",
      )
      .join("")

  const anchor = (text: string) => {
    const base = githubSlug(text)
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    return n === 0 ? base : `${base}-${n}`
  }

  let lead: string | null = null
  const out: string[] = []
  let firstBlock = true

  const block = (t: Token, nested = false): string => {
    switch (t.type) {
      case "space":
        return ""
      case "heading": {
        const h = t as Tokens.Heading
        const text = stripMd(h.text)
        const id = anchor(text)
        headings.push({ id, text })
        plain.push(text)
        const level = h.depth - page.depth
        if (level <= 1) {
          if (!nested) toc.push({ id, text })
          return `<div class="doc-h2-frame" data-node="H2 · ${esc(text)}"><h2 id="${id}" class="doc-h2" data-node="H2">${inl(h.tokens)}</h2></div>`
        }
        return `<h3 id="${id}" class="doc-h3">${inl(h.tokens)}</h3>`
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph
        plain.push(textOf(p.tokens))
        return `<p class="doc-p" data-node="Paragraph">${inl(p.tokens)}</p>`
      }
      case "text": {
        const x = t as Tokens.Text
        plain.push(x.text)
        return x.tokens ? inl(x.tokens) : esc(x.text)
      }
      case "code": {
        const c = t as Tokens.Code
        plain.push(c.text)
        return codeBlock(c.text, c.lang)
      }
      case "list": {
        const l = t as Tokens.List
        const tag = l.ordered ? "ol" : "ul"
        const start = l.ordered && l.start !== 1 && l.start !== "" ? ` start="${l.start}"` : ""
        const items = l.items
          .map((it) => {
            const inner = it.tokens
              .map((x) => (x.type === "text" ? block(x, true) : block(x, true)))
              .join("")
            const check = it.task
              ? `<input type="checkbox" disabled${it.checked ? " checked" : ""}> `
              : ""
            return `<li>${check}${inner}</li>`
          })
          .join("")
        return `<${tag} class="doc-list"${start}>${items}</${tag}>`
      }
      case "blockquote": {
        const q = t as Tokens.Blockquote
        const first = q.tokens.find((x) => x.type === "paragraph") as Tokens.Paragraph | undefined
        let kind: CalloutKind = "note"
        let title = ""
        let rest = q.tokens
        if (first) {
          const m = /^\[!(\w+)\]\s*\n?/.exec(first.raw)
          if (m && CALLOUT_MARKERS[(m[1] as string).toUpperCase()]) {
            kind = CALLOUT_MARKERS[(m[1] as string).toUpperCase()] as CalloutKind
            const after = first.raw.slice(m[0].length).trim()
            const reLexed = after ? new Lexer({ gfm: true }).lex(after) : []
            rest = [...reLexed, ...q.tokens.slice(q.tokens.indexOf(first) + 1)]
            title = (m[1] as string).charAt(0) + (m[1] as string).slice(1).toLowerCase()
          }
          const p0 = rest.find((x) => x.type === "paragraph") as Tokens.Paragraph | undefined
          const strong = p0?.tokens?.[0]
          if (p0 && strong?.type === "strong") {
            // "> **Title.** body" → the bold run is the callout title.
            title = inl((strong as Tokens.Strong).tokens).replace(/[.:]\s*$/, "")
            const remaining = p0.tokens.slice(1)
            const head = remaining[0]
            if (head && head.type === "text")
              (head as Tokens.Text).text = (head as Tokens.Text).text.replace(/^[.:]?\s*/, "")
            rest = rest.map((x) =>
              x === p0 ? ({ ...p0, tokens: remaining } as Tokens.Paragraph) : x,
            )
            if (
              /^(warning|caution)$/i.test(
                stripMd((strong as Tokens.Strong).text).replace(/[.:]$/, ""),
              )
            )
              kind = "warning"
          }
        }
        const body = rest
          .map((x) =>
            x.type === "paragraph" ? inl((x as Tokens.Paragraph).tokens) : block(x, true),
          )
          .filter(Boolean)
          .join("<br>")
        plain.push(textOf(q.tokens))
        return callout(kind, title, body)
      }
      case "table":
        return table(t as Tokens.Table)
      case "hr":
        return '<hr class="doc-hr">'
      case "html": {
        const x = t as Tokens.HTML
        return /^\s*<!--/.test(x.text) ? "" : `<p class="doc-p">${esc(x.text)}</p>`
      }
      default:
        return "raw" in t ? `<p class="doc-p">${esc(String(t.raw))}</p>` : ""
    }
  }

  const table = (t: Tokens.Table): string => {
    const cell = (c: Tokens.TableCell) => inl(c.tokens)
    const codeOnly = (c: Tokens.TableCell) =>
      c.tokens.length > 0 &&
      c.tokens.every((x) => x.type === "codespan" || (x.type === "text" && !x.raw.trim()))
    const headCells = t.header.map(
      (h, i) => `<th${t.align[i] ? ` style="text-align:${t.align[i]}"` : ""}>${cell(h)}</th>`,
    )
    const hasHead = t.header.some((h) => h.text.trim() !== "")
    const rows = t.rows
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td class="${i === 0 ? "td--key" : ""}${codeOnly(c) ? " td--mono" : ""}"${t.align[i] ? ` style="text-align:${t.align[i]}"` : ""}>${cell(c)}</td>`).join("")}</tr>`,
      )
      .join("")
    const desktop = `<div class="doc-table" data-node="Table"><table>${hasHead ? `<thead><tr>${headCells.join("")}</tr></thead>` : ""}<tbody>${rows}</tbody></table></div>`
    const stacked = `<div class="doc-table-stacked" data-node="Table → stacked rows">${t.rows
      .map(
        (r) =>
          `<div class="stack-row" data-node="Row"><div class="stack-row__key">${cell(r[0] as Tokens.TableCell)}</div>${r
            .slice(1)
            .map(
              (c, i) =>
                `<div class="stack-row__val">${hasHead ? `<span class="stack-row__label">${esc(stripMd(t.header[i + 1]?.text ?? ""))}</span> ` : ""}${cell(c)}</div>`,
            )
            .join("")}</div>`,
      )
      .join("")}</div>`
    plain.push(t.rows.map((r) => r.map((c) => c.text).join(" ")).join(" "))
    return desktop + stacked
  }

  for (const t of tokens) {
    if (t.type === "space") continue
    if (firstBlock && page.kind !== "spec" && t.type === "paragraph") {
      firstBlock = false
      const p = t as Tokens.Paragraph
      plain.push(textOf(p.tokens))
      lead = inl(p.tokens)
      continue
    }
    firstBlock = false
    out.push(block(t))
  }
  return { lead, html: out.join("\n"), toc, plain: plain.join("\n"), headings }
}

/** Heading anchors of a page's markdown, without rendering (for the cross-page anchor index). */
export function headingIds(md: string): string[] {
  const used = new Map<string, number>()
  const ids: string[] = []
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "heading") {
        const base = githubSlug(stripMd((t as Tokens.Heading).text))
        const n = used.get(base) ?? 0
        used.set(base, n + 1)
        ids.push(n === 0 ? base : `${base}-${n}`)
      }
    }
  }
  walk(new Lexer({ gfm: true }).lex(md))
  return ids
}
