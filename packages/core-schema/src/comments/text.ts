/**
 * Comment message text (docs/spec/comments.md §3): plain UTF-8 with a small Markdown subset that
 * renders the same in the app and in email. Anything else is literal text. Only http and https
 * links are links.
 */

export type CommentInline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: CommentInline[] }
  | { kind: "link"; href: string; children: CommentInline[] }
  | { kind: "mention"; name: string; id: string }

export type CommentBlock =
  | { kind: "para"; children: CommentInline[] }
  | { kind: "bullets"; items: CommentInline[][] }
  | { kind: "numbers"; start: number; items: CommentInline[][] }

/** A mention found in message text. */
export interface CommentMention {
  name: string
  id: string
}

const MENTION = /@\[([^\]\n]{1,64})\]\(((?:acct|dev|agent):[^\s)]{1,128})\)/y
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/y
const DELIMS: readonly [string, "bold" | "italic" | "strike"][] = [
  ["**", "bold"],
  ["*", "italic"],
  ["~", "strike"],
]

function pushText(out: CommentInline[], text: string) {
  if (!text) return
  const last = out[out.length - 1]
  if (last?.kind === "text") last.text += text
  else out.push({ kind: "text", text })
}

/** Inline tokens of one line (or list item). */
export function parseInline(src: string, depth = 0): CommentInline[] {
  const out: CommentInline[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "@") {
      MENTION.lastIndex = i
      const m = MENTION.exec(src)
      if (m) {
        out.push({ kind: "mention", name: m[1] as string, id: m[2] as string })
        i = MENTION.lastIndex
        continue
      }
    }
    if (ch === "[") {
      LINK.lastIndex = i
      const m = LINK.exec(src)
      if (m) {
        out.push({
          kind: "link",
          href: m[2] as string,
          children: parseInline(m[1] as string, depth + 1),
        })
        i = LINK.lastIndex
        continue
      }
    }
    if (depth < 4 && (ch === "*" || ch === "~")) {
      let matched = false
      for (const [d, kind] of DELIMS) {
        if (!src.startsWith(d, i)) continue
        const end = src.indexOf(d, i + d.length)
        // Content must not be empty or start/end with a space ("2 * 3 * 4" stays literal).
        const inner = end > 0 ? src.slice(i + d.length, end) : ""
        if (end < 0 || !inner || /^\s|\s$/.test(inner)) continue
        if (d === "*" && src[i + 1] === "*") continue
        out.push({ kind, children: parseInline(inner, depth + 1) })
        i = end + d.length
        matched = true
        break
      }
      if (matched) continue
    }
    pushText(out, ch as string)
    i++
  }
  return out
}

/** Blocks of a message: paragraphs (one per line run) and lists. */
export function parseCommentText(text: string): CommentBlock[] {
  const blocks: CommentBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length === 0) return
    const children: CommentInline[] = []
    para.forEach((line, n) => {
      if (n > 0) pushText(children, "\n")
      for (const c of parseInline(line)) {
        if (c.kind === "text") pushText(children, c.text)
        else children.push(c)
      }
    })
    blocks.push({ kind: "para", children })
    para = []
  }
  // The list a new item may join: the last block, while no other line came in between.
  let open: CommentBlock | null = null
  for (const line of text.split("\n")) {
    const bullet = /^[-*] (.*)$/.exec(line)
    const number = /^(\d{1,9})\. (.*)$/.exec(line)
    if (bullet) {
      flush()
      const item = parseInline(bullet[1] as string)
      if (open?.kind === "bullets") open.items.push(item)
      else {
        open = { kind: "bullets", items: [item] }
        blocks.push(open)
      }
    } else if (number) {
      flush()
      const item = parseInline(number[2] as string)
      if (open?.kind === "numbers") open.items.push(item)
      else {
        open = { kind: "numbers", start: Number(number[1]), items: [item] }
        blocks.push(open)
      }
    } else {
      open = null
      if (line === "") flush()
      else para.push(line)
    }
  }
  flush()
  return blocks
}

/** Every mention in `text`, in order (duplicates kept). */
export function commentMentions(text: string): CommentMention[] {
  const out: CommentMention[] = []
  const re = new RegExp(MENTION.source, "g")
  for (const m of text.matchAll(re)) out.push({ name: m[1] as string, id: m[2] as string })
  return out
}

function inlinePlain(list: CommentInline[]): string {
  return list
    .map((c) =>
      c.kind === "text" ? c.text : c.kind === "mention" ? `@${c.name}` : inlinePlain(c.children),
    )
    .join("")
}

/** Text without markup, for previews, toasts and notifications. */
export function commentPlainText(text: string): string {
  return parseCommentText(text)
    .map((b) =>
      b.kind === "para"
        ? inlinePlain(b.children)
        : b.items.map((item) => inlinePlain(item)).join("\n"),
    )
    .join("\n")
}

/** The mention token for an author. Brackets and newlines in names are dropped. */
export function mentionToken(name: string, id: string): string {
  const safe = name.replace(/[[\]\n]/g, "").slice(0, 64) || "someone"
  return `@[${safe}](${id})`
}
