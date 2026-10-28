/**
 * Keeps AI-tell phrasing out of UI copy and docs (docs/style/writing.md). Runs `aiTellPhrases`
 * from @kimo/ai-agent over:
 * - string literals and JSX text in the app and the UI kit (comments skipped; the website's
 *   landing page is checked in its own repo, github.com/Saudade-media/kimo-site),
 * - the user-facing markdown: README, the user guide, SECURITY, CONTRIBUTING, CHANGELOG and the
 *   examples README (fenced code skipped).
 * A hit fails with file:line and the phrase. Add an ALLOW entry only when the phrase is right in
 * context (a command name, a placeholder glyph, a separator), never to silence real copy.
 *
 * It also enforces Length (docs/style/writing.md#length) on the same app strings and on the text of
 * design boards in desing.kimo, from FIRST_CHECKED_BOARD on: at most 2 sentences and 20 words.
 * JSX text that wraps over several source lines is checked line by line.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"
import { type AiTell, aiTellPhrases } from "../packages/ai-agent/src/style"

const ROOT = join(import.meta.dir, "..")

const CODE_ROOTS = ["apps/web/src", "packages/ui/src"]
/** Dev-only surfaces: the component gallery, e2e harnesses, test doubles, generated data. */
const CODE_SKIP = /(^|\/)(gallery|harness|generated)\/|\.test\.|(^|\/)testing\.ts$|\.d\.ts$/

const DOCS = [
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "examples/README.md",
  "docs/guide/**/*.md",
]

interface Allow {
  /** Repo-relative path. */
  file: RegExp
  /** The scanned snippet (a string literal, JSX text or a markdown line). */
  text: RegExp
  kind?: AiTell["kind"]
  /** The matched phrase itself, when only some matches in the snippet are fine. */
  match?: RegExp
}

const ALLOW: Allow[] = [
  // The Lock / Unlock command and its labels.
  { file: /./, text: /(\block \/ unlock|\bUnlock layer|\*\*Unlock\*\*)/i, kind: "hype" },
  { file: /./, text: /^Unlock$/, kind: "hype" },
  // Window and tab titles: "file.kimo — Kimo", "Name — folder".
  { file: /platform\/contract\.ts$/, text: /— Kimo|\} — \$\{/, kind: "em-dash" },
  // Mock layer names in the sample document ("Home — Desktop").
  { file: /lib\/sample\.ts$/, text: /^Home — (Desktop|Mobile)$/, kind: "em-dash" },
  // The legend explains the "—" glyph shown in empty variable cells.
  { file: /VariablesDialog\.tsx$/, text: /· — means no entry/, kind: "em-dash" },
  { file: /var-cell\/VarCell\.tsx$/, text: /^—$/, kind: "em-dash" },
  // Arrows and © are typography, not emoji (Extended_Pictographic includes them).
  { file: /./, text: /./, kind: "emoji", match: /^[↔↕↗©]$/ },
  // Markdown table cells that hold the empty-value glyph, and release headings.
  { file: /\.md$/, text: /\|\s*—\s*\|/, kind: "em-dash" },
  { file: /^CHANGELOG\.md$/, text: /^## \[[\d.]+\] - \d{4}-\d{2}-\d{2} — /, kind: "em-dash" },
  // The guide quotes the Code tab's "—" for models without a price.
  { file: /agent-tab\.md$/, text: /show `—`/, kind: "em-dash" },
]

/** Length limits (docs/style/writing.md#length). */
const MAX_WORDS = 20
const MAX_SENTENCES = 2
const MAX_INTRO_WORDS = 40
/** Design boards are checked from this number on; older boards predate the rule. */
const FIRST_CHECKED_BOARD = 46

/**
 * UI strings that were longer than the limit when the rule landed (2026-10-28), by file and
 * opening words. Shorten them and drop the entry; never add one.
 */
const LONG_LEGACY: [RegExp, string][] = []
/** Model prompts are instructions to a model, not UI copy. */
const PROMPTS: [RegExp, string][] = [[/ai-settings\/controller\.ts$/, "You name design files."]]

const words = (t: string) => t.match(/[\p{L}\p{N}$][^\s]*/gu)?.length ?? 0
const sentences = (t: string) => t.trim().match(/[.!?](?=\s|$)/g)?.length ?? 0
/** A sentence-shaped string: a capitalised first word, a space, and no code syntax. */
const isProse = (t: string) =>
  /^[A-Z][a-z']*\s/.test(t) && !/[{}<>=;]|=>|\$\{/.test(t) && words(t) >= 3
const tooLong = (t: string) => words(t) > MAX_WORDS || sentences(t) > MAX_SENTENCES
const listed = (list: [RegExp, string][], file: string, t: string) =>
  list.some(([f, start]) => f.test(file) && t.startsWith(start))

interface Hit {
  where: string
  tell: AiTell
  text: string
}

function allowed(file: string, text: string, tell: AiTell): boolean {
  return ALLOW.some(
    (a) =>
      a.file.test(file) &&
      a.text.test(text) &&
      (a.kind === undefined || a.kind === tell.kind) &&
      (a.match === undefined || a.match.test(tell.match)),
  )
}

function check(file: string, line: number, text: string, out: Hit[]) {
  const t = text.trim()
  if (!t || t === "—") return
  for (const tell of aiTellPhrases(t))
    if (!allowed(file, t, tell)) out.push({ where: `${file}:${line}`, tell, text: t })
}

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g

/**
 * Calls `visit` with the string literals and the leftover (JSX text, code) of every non-comment
 * line.
 */
function scanCode(
  src: string,
  visit: (line: number, text: string, kind: "string" | "code") => void,
) {
  let inBlock = false
  src.split("\n").forEach((raw, i) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf("*/")
      if (end < 0) return
      line = line.slice(end + 2)
      inBlock = false
    }
    // Block comments that open on this line (JSX `{/* … */}` included).
    line = line.replace(/\{?\/\*.*?\*\/\}?/g, " ")
    const open = line.indexOf("/*")
    if (open >= 0) {
      inBlock = true
      line = line.slice(0, open)
    }
    const trimmed = line.trim()
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return
    const rest = line.replace(STRING, (m) => {
      visit(i + 1, m.slice(1, -1), "string")
      return " "
    })
    // Trailing line comment, once strings are out of the way (URLs live in strings).
    visit(i + 1, rest.replace(/\/\/.*$/, ""), "code")
  })
}

/** The app's UI source files, repo-relative. */
function codeFiles(): string[] {
  return CODE_ROOTS.flatMap((root) => files([`${root}/**/*.{ts,tsx}`])).filter(
    (f) => !CODE_SKIP.test(f),
  )
}

/** Over-long prose in one source file: string literals, JSX text between tags, wrapped JSX text. */
function scanLength(file: string, src: string, out: string[]) {
  scanCode(src, (line, text, kind) => {
    const pieces =
      kind === "string"
        ? [text]
        : [...text.matchAll(/>([^<>{}]+)</g)].map((m) => m[1] ?? "").concat(text)
    for (const raw of pieces) {
      const t = raw.trim()
      if (!isProse(t) || !tooLong(t)) continue
      if (listed(LONG_LEGACY, file, t) || listed(PROMPTS, file, t)) continue
      out.push(`${file}:${line}  ${words(t)} words, ${sentences(t)} sentences: ${t.slice(0, 120)}`)
    }
  })
}

interface DesignNode {
  type?: string
  name?: string
  parent?: string
  content?: unknown
  overrides?: Record<string, { set?: { content?: unknown } }>
}

function plain(content: unknown): string | null {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content.map((run) => (run as { text?: unknown }).text ?? "").join("")
  return null
}

/** Long text on the design boards numbered FIRST_CHECKED_BOARD and up, in desing.kimo. */
function scanDesign(out: string[]) {
  const doc = JSON.parse(readFileSync(join(ROOT, "desing.kimo"), "utf8")) as {
    nodes: Record<string, DesignNode>
  }
  const nodes = doc.nodes
  const boardOf = (id: string): string => {
    let at = id
    for (let parent = nodes[at]?.parent; parent; parent = nodes[at]?.parent) at = parent
    return at
  }
  for (const [id, node] of Object.entries(nodes)) {
    const board = boardOf(id)
    const number = Number(/^(\d+)\b/.exec(nodes[board]?.name ?? "")?.[1] ?? Number.NaN)
    if (!(number >= FIRST_CHECKED_BOARD)) continue
    // The board's own intro, in its header frame, may run longer.
    const intro = node.name === "Intro" && nodes[node.parent ?? ""]?.parent === board
    const texts: string[] = []
    if (node.type === "text") texts.push(plain(node.content) ?? "")
    for (const o of Object.values(node.overrides ?? {})) texts.push(plain(o.set?.content) ?? "")
    for (const raw of texts) {
      const t = raw.trim()
      const long = intro ? words(t) > MAX_INTRO_WORDS : tooLong(t)
      if (long)
        out.push(
          `${nodes[board]?.name} › ${node.name ?? id} (${id})  ${words(t)} words, ${sentences(t)} sentences: ${t.slice(0, 120)}`,
        )
    }
  }
}

/** Markdown prose, line by line, skipping fenced code. */
function scanDoc(file: string, src: string, out: Hit[]) {
  let fenced = false
  src.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      return
    }
    if (!fenced) check(file, i + 1, line, out)
  })
}

function files(patterns: string[]): string[] {
  return patterns.flatMap((p) => [...new Glob(p).scanSync({ cwd: ROOT })]).sort()
}

function report(hits: Hit[]): string {
  return hits
    .map((h) => `${h.where}  ${h.tell.kind} "${h.tell.match}"  in: ${h.text.slice(0, 120)}`)
    .join("\n")
}

describe("writing style (docs/style/writing.md)", () => {
  test("UI copy has no AI-tell phrasing", () => {
    const hits: Hit[] = []
    for (const f of codeFiles())
      scanCode(readFileSync(join(ROOT, f), "utf8"), (line, text) => check(f, line, text, hits))
    expect(report(hits)).toBe("")
  })

  test("UI copy is at most 2 sentences and 20 words per string", () => {
    const long: string[] = []
    for (const f of codeFiles()) scanLength(f, readFileSync(join(ROOT, f), "utf8"), long)
    expect(long.join("\n")).toBe("")
  })

  test("design boards keep their text short", () => {
    const long: string[] = []
    scanDesign(long)
    expect(long.join("\n")).toBe("")
  })

  test("docs have no AI-tell phrasing", () => {
    const hits: Hit[] = []
    for (const f of files(DOCS)) scanDoc(f, readFileSync(join(ROOT, f), "utf8"), hits)
    expect(report(hits)).toBe("")
  })
})
