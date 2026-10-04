/**
 * A small highlighter for the "Ink" code theme (board 25 › Code tab; board 26 code blocks):
 * monochrome by role, never by hue. Kinds and their paint:
 *
 *   plain    text-primary          values, commands, identifiers
 *   strong   text-primary 600      keywords, tag names, headings in TOML
 *   attr     text-secondary        JSON keys, attributes, flags' arguments, strings in shell
 *   punct    text-tertiary         punctuation, prompts, optional [args]
 *   comment  text-tertiary italic  comments
 *   ok       success               "✓ …" result lines in transcripts
 */
export type Kind = "plain" | "strong" | "attr" | "punct" | "comment" | "ok"
export interface Tok {
  kind: Kind
  text: string
}

export type Lang = "json" | "js" | "css" | "sh" | "toml" | "text"

export function langOf(info: string | undefined): Lang {
  const l = (info ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  if (["json", "jsonc", "json5"].includes(l)) return "json"
  if (["ts", "tsx", "js", "jsx", "javascript", "typescript", "html", "xml", "svg"].includes(l))
    return "js"
  if (l === "css") return "css"
  if (["sh", "bash", "zsh", "shell", "console", "shellsession"].includes(l)) return "sh"
  if (l === "toml") return "toml"
  return "text"
}

const KEYWORDS = new Set(
  "export default function return import from const let var type interface extends as if else new true false null undefined readonly typeof keyof await async for of in while class implements".split(
    " ",
  ),
)

function push(out: Tok[], kind: Kind, text: string) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ kind, text })
}

const JSON_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(\/\/.*$)|([{}[\]:,])/g
const JS_RE =
  /(\/\/.*$)|(\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?)([A-Za-z][\w.:-]*)|([A-Za-z_][\w:.-]*)(?=\s*=(?!=))|\b([A-Za-z_$][\w$]*)\b|([<>/={}();,[\]:.])/g
const CSS_RE =
  /(\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[\w-]+)|(--[\w-]+|-?[a-z][a-z-]*)(?=\s*:(?!:))|([{}:;,()])/g
const TOML_RE = /(#.*$)|^(\s*\[[^\]]*\])|("(?:[^"\\]|\\.)*")|^(\s*[\w.-]+)(?=\s*=)|([=[\],{}])/g
const SH_RE =
  /(^\s*\$ )|(\s#.*$|^#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(<[^>\s]+>)|(\[[^\]]*\])|(\s--?[\w-]+)|([|&;>]+)/g

/** Splits one line into tokens. */
export function tokenizeLine(line: string, lang: Lang): Tok[] {
  const out: Tok[] = []
  if (lang === "text") {
    push(out, /^\s*✓/.test(line) ? "ok" : "plain", line)
    return out
  }
  if (lang === "sh" && /^\s*✓/.test(line)) {
    push(out, "ok", line)
    return out
  }
  const re = { json: JSON_RE, js: JS_RE, css: CSS_RE, toml: TOML_RE, sh: SH_RE }[lang]
  re.lastIndex = 0
  let at = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[0] === "") {
      re.lastIndex++
      continue
    }
    push(out, "plain", line.slice(at, m.index))
    at = m.index + m[0].length
    if (lang === "json") {
      if (m[1]) {
        if (m[2]) {
          push(out, "attr", m[1])
          push(out, "punct", m[2])
        } else push(out, "plain", m[1])
      } else if (m[3]) push(out, "comment", m[3])
      else if (m[4]) push(out, "punct", m[4])
    } else if (lang === "js") {
      if (m[1] || m[2]) push(out, "comment", (m[1] ?? m[2]) as string)
      else if (m[3]) push(out, "attr", m[3])
      else if (m[4] && m[5]) {
        push(out, "punct", m[4])
        push(out, "strong", m[5])
      } else if (m[6]) push(out, "attr", m[6])
      else if (m[7]) push(out, KEYWORDS.has(m[7]) ? "strong" : "plain", m[7])
      else if (m[8]) push(out, "punct", m[8])
    } else if (lang === "css") {
      if (m[1]) push(out, "comment", m[1])
      else if (m[2]) push(out, "attr", m[2])
      else if (m[3]) push(out, "strong", m[3])
      else if (m[4]) push(out, "attr", m[4])
      else if (m[5]) push(out, "punct", m[5])
    } else if (lang === "toml") {
      if (m[1]) push(out, "comment", m[1])
      else if (m[2]) push(out, "strong", m[2])
      else if (m[3]) push(out, "plain", m[3])
      else if (m[4]) push(out, "attr", m[4])
      else if (m[5]) push(out, "punct", m[5])
    } else {
      // sh
      if (m[1]) push(out, "punct", m[1])
      else if (m[2]) push(out, "comment", m[2])
      else if (m[3]) push(out, "attr", m[3])
      else if (m[4]) push(out, "attr", m[4])
      else if (m[5]) push(out, "punct", m[5])
      else if (m[6]) push(out, "attr", m[6])
      else if (m[7]) push(out, "punct", m[7])
    }
  }
  push(out, "plain", line.slice(at))
  return out
}

export function highlight(code: string, lang: Lang): Tok[][] {
  const lines = code.replace(/\n$/, "").split("\n")
  // Multi-line block comments in JS/CSS: carry the state across lines.
  let inComment = false
  return lines.map((line) => {
    if ((lang === "js" || lang === "css") && (inComment || /\/\*(?!.*\*\/)/.test(line))) {
      if (inComment) {
        const close = line.indexOf("*/")
        if (close < 0) return [{ kind: "comment" as const, text: line }]
        inComment = false
        return [
          { kind: "comment" as const, text: line.slice(0, close + 2) },
          ...tokenizeLine(line.slice(close + 2), lang),
        ]
      }
      const open = line.search(/\/\*(?!.*\*\/)/)
      inComment = true
      return [
        ...tokenizeLine(line.slice(0, open), lang),
        { kind: "comment" as const, text: line.slice(open) },
      ]
    }
    return tokenizeLine(line, lang)
  })
}
