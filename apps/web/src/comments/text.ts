/**
 * Message text (docs/spec/comments.md §3): plain text with a small Markdown subset, parsed into
 * a tree the UI renders as React nodes. Nothing here produces HTML, and links keep only http and
 * https URLs, so a message can never run script or open another scheme.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "mention"; name: string; id: string }

export interface Block {
  kind: "p" | "bullet" | "number"
  /** The item number of a numbered line. */
  n?: number
  inline: Inline[]
}

const MENTION = /@\[([^\]\n]{1,64})\]\(((?:acct|dev|agent):[^\s)]{1,128})\)/y
const LINK = /\[([^\]\n]+)\]\(([^\s)]+)\)/y
const BOLD = /\*\*([^\n]+?)\*\*/y
const ITALIC = /\*([^*\n]+?)\*/y
const STRIKE = /~([^~\n]+?)~/y

/** `url` when it is an absolute http or https URL, else null. */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i
  return re.exec(s)
}

/** Inline formatting of one line. `links` false inside a link label (no nested links). */
export function parseInline(s: string, links = true): Inline[] {
  const out: Inline[] = []
  let text = ""
  const flush = () => {
    if (text) out.push({ kind: "text", text })
    text = ""
  }
  let i = 0
  while (i < s.length) {
    const c = s[i] as string
    let m: RegExpExecArray | null = null
    let node: Inline | null = null
    if (c === "@" && links) {
      m = at(MENTION, s, i)
      if (m) node = { kind: "mention", name: m[1] as string, id: m[2] as string }
    }
    if (!m && c === "[" && links) {
      m = at(LINK, s, i)
      const href = m ? safeHref(m[2] as string) : null
      if (m && href) node = { kind: "link", href, children: parseInline(m[1] as string, false) }
      // Another scheme stays literal text.
      else if (m) text += m[0]
    }
    if (!m && c === "*") {
      m = at(BOLD, s, i)
      if (m) node = { kind: "bold", children: parseInline(m[1] as string, links) }
    }
    if (!m && c === "*") {
      m = at(ITALIC, s, i)
      if (m) node = { kind: "italic", children: parseInline(m[1] as string, links) }
    }
    if (!m && c === "~") {
      m = at(STRIKE, s, i)
      if (m) node = { kind: "strike", children: parseInline(m[1] as string, links) }
    }
    if (m) {
      if (node) {
        flush()
        out.push(node)
      }
      i += m[0].length
      continue
    }
    text += c
    i++
  }
  flush()
  return out
}

/** The blocks of a message: one per line, list items at a line start. */
export function parseMessage(text: string): Block[] {
  return text.split("\n").map((line) => {
    const bullet = /^- (.*)$/.exec(line)
    if (bullet) return { kind: "bullet", inline: parseInline(bullet[1] as string) }
    const num = /^(\d{1,4})\. (.*)$/.exec(line)
    if (num) return { kind: "number", n: Number(num[1]), inline: parseInline(num[2] as string) }
    return { kind: "p", inline: parseInline(line) }
  })
}

/** Author ids a message mentions. */
export function mentionsIn(text: string): string[] {
  const ids = new Set<string>()
  const walk = (list: Inline[]) => {
    for (const x of list) {
      if (x.kind === "mention") ids.add(x.id)
      else if (x.kind !== "text") walk(x.children)
    }
  }
  for (const b of parseMessage(text)) walk(b.inline)
  return [...ids]
}

/** The text without formatting marks (previews, notifications, search). */
export function plainText(text: string): string {
  const flat = (list: Inline[]): string =>
    list
      .map((x) =>
        x.kind === "text" ? x.text : x.kind === "mention" ? `@${x.name}` : flat(x.children),
      )
      .join("")
  return parseMessage(text)
    .map((b) => flat(b.inline))
    .join("\n")
}

/** A mention token for `author` (`@[Name](id)`). */
export function mentionToken(name: string, id: string): string {
  return `@[${name.replace(/[\]\n]/g, "").slice(0, 64)}](${id})`
}
