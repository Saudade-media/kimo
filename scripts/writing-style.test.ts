/**
 * Keeps AI-tell phrasing out of UI copy and docs (docs/style/writing.md). Runs `aiTellPhrases`
 * from @kimo/ai-agent over:
 * - string literals and JSX text in the app and the UI kit (comments skipped; the website's
 *   landing page is checked in its own repo, github.com/Saudade-media/kimo-site),
 * - the user-facing markdown: README, the user guide, SECURITY, CONTRIBUTING, CHANGELOG and the
 *   examples README (fenced code skipped).
 * A hit fails with file:line and the phrase. Add an ALLOW entry only when the phrase is right in
 * context (a command name, a placeholder glyph, a separator), never to silence real copy.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
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

/** String literals and the leftover (JSX text, code) of every non-comment line. */
function scanCode(file: string, src: string, out: Hit[]) {
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
      check(file, i + 1, m.slice(1, -1), out)
      return " "
    })
    // Trailing line comment, once strings are out of the way (URLs live in strings).
    check(file, i + 1, rest.replace(/\/\/.*$/, ""), out)
  })
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
    for (const root of CODE_ROOTS)
      for (const f of files([`${root}/**/*.{ts,tsx}`])) {
        const rel = relative(ROOT, join(ROOT, f))
        if (!CODE_SKIP.test(rel)) scanCode(rel, readFileSync(join(ROOT, f), "utf8"), hits)
      }
    expect(report(hits)).toBe("")
  })

  test("docs have no AI-tell phrasing", () => {
    const hits: Hit[] = []
    for (const f of files(DOCS)) scanDoc(f, readFileSync(join(ROOT, f), "utf8"), hits)
    expect(report(hits)).toBe("")
  })

  test("the scanner catches a tell and respects the allowlist", () => {
    const hits: Hit[] = []
    scanCode("x.tsx", 'const a = "A seamless canvas — for everyone"\n// robust comment', hits)
    expect(hits.map((h) => h.tell.kind)).toEqual(["hype", "em-dash"])
    const ok: Hit[] = []
    scanCode("x.tsx", 'label: "Lock / unlock",\nconst v = "—"', ok)
    expect(ok).toEqual([])
  })
})
