/**
 * Export dialog model (board 07 "Export Dialog" `AsO2h`, ADR 0015): the four formats, their
 * `@kimo/exporters` targets, the code-preview tokenizer (colors of the board's Code frame
 * `t1smNB`), the output-folder display, the no-overwrite write plan and a store-only zip
 * writer for the browser. Pure (no DOM, no React) so it is unit-tested directly.
 */

import type { FileRef, KimoPlatform } from "@kimo/platform"

// --- Formats ---------------------------------------------------------------------------------

export type ExportFormat = "react" | "html" | "tokens" | "assets"

/** Board 07 Format rows (`v0S2cL`, `qsAIn`, `OOS97`, `wPYOJ`): icon, title, sub — in node order. */
export const EXPORT_FORMATS: readonly {
  id: ExportFormat
  icon: string
  title: string
  sub: string
}[] = [
  { id: "react", icon: "atom", title: "React + Tailwind", sub: "TSX · Tailwind v4" },
  { id: "html", icon: "code-xml", title: "HTML + CSS", sub: "Static markup, CSS variables" },
  { id: "tokens", icon: "braces", title: "Design tokens", sub: "CSS vars · W3C JSON" },
  { id: "assets", icon: "image", title: "SVG / PNG", sub: "Assets at 1×, 2×, 3×" },
]

/** "Assets at 1×, 2×, 3×" (`O9inf1`): one PNG per root and scale. */
export const PNG_SCALES = [1, 2, 3] as const

/** Board 07 Settings (`Q6kGEo`): toggle values as drawn (on, on, off). */
export interface ExportToggles {
  /** "Variables as CSS custom properties" (`oYwtp`). */
  variables: boolean
  /** "Split instances into components" (`wFq6I`). */
  components: boolean
  /** "Keep layer names as data attributes" (`J5i73Q`). */
  layerNames: boolean
}
export const DEFAULT_TOGGLES: ExportToggles = {
  variables: true,
  components: true,
  layerNames: false,
}

/** `@kimo/exporters` targets per format (text targets first; PNG is generated on export). */
export function targetsOf(format: ExportFormat): {
  text: ("react-tailwind" | "html-css" | "tokens-css" | "tokens-dtcg" | "svg")[]
  png: boolean
} {
  switch (format) {
    case "react":
      return { text: ["react-tailwind"], png: false }
    case "html":
      return { text: ["html-css"], png: false }
    case "tokens":
      return { text: ["tokens-css", "tokens-dtcg"], png: false }
    case "assets":
      return { text: ["svg"], png: true }
  }
}

// --- Header description ("Hero · 1 frame · 12 layers · 4 variables", `OBcKu`) ---------------

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

export function describeExport(
  name: string,
  counts: { frames: number; layers: number; variables: number },
): string {
  return [
    name,
    plural(counts.frames, "frame"),
    plural(counts.layers, "layer"),
    plural(counts.variables, "variable"),
  ].join(" · ")
}

/** Footer note (`Vg83B`): "3 files · existing files are diffed, never overwritten silently". */
export function footerNote(count: number, desktop: boolean, zipName: string): string {
  return desktop
    ? `${plural(count, "file")} · existing files are diffed, never overwritten silently`
    : // Not designed (web): the board's note is about writing into a folder.
      `${plural(count, "file")} · downloaded as ${zipName}`
}

/** Primary button label (`ZjvC1` "Export 3 files"). */
export const exportLabel = (count: number) => `Export ${plural(count, "file")}`

// --- Output folder (`JcyHA` › Folder: prefix "~/" mono 11, value mono 12) ---------------------

/** Splits an absolute folder into the PropField prefix ("~/" under a home dir) and value. */
export function folderDisplay(folder: string | null): { prefix: string; value: string } {
  if (!folder) return { prefix: "~/", value: "" }
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)([/\\]|$)/.exec(folder)
  if (home) return { prefix: "~/", value: folder.slice(home[0].length) }
  return { prefix: "/", value: folder.replace(/^\//, "") }
}

export const joinPath = (dir: string, rel: string) =>
  dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${rel}` : `${dir}/${rel}`

// --- Code preview tokens (board 07 Code `t1smNB`) --------------------------------------------

/**
 * Token kinds and their fills on the board: line number `$text-tertiary`, keyword / tag name
 * `$agent-2`, attribute / property name `$warning`, string `$success`, the rest
 * `$text-primary`.
 */
export type TokenKind = "plain" | "keyword" | "attr" | "string"
export interface CodeToken {
  kind: TokenKind
  text: string
}

/** "1   " … "17  ": the line number padded to 4 columns (wider files: digits + 1). */
export function lineNumber(n: number, total: number): string {
  const width = Math.max(4, String(total).length + 1)
  return String(n).padEnd(width, " ")
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
])

type Lang = "jsx" | "css" | "json" | "text"
export function langOf(path: string): Lang {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  if (ext === "tsx" || ext === "ts" || ext === "jsx" || ext === "js") return "jsx"
  if (ext === "html" || ext === "svg" || ext === "xml") return "jsx"
  if (ext === "css") return "css"
  if (ext === "json") return "json"
  return "text"
}

function push(out: CodeToken[], kind: TokenKind, text: string) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ kind, text })
}

/** Splits one line into colored tokens (adjacent tokens of one kind are merged). */
export function tokenizeLine(line: string, lang: Lang): CodeToken[] {
  const out: CodeToken[] = []
  if (lang === "text") {
    push(out, "plain", line)
    return out
  }
  const re =
    lang === "jsx"
      ? /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?)([A-Za-z][\w.:-]*)|([A-Za-z_][\w:-]*)(?==)|\b([A-Za-z_]\w*)\b/g
      : lang === "css"
        ? /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[\w-]+)|(--[\w-]+|[a-z-]+)(?=\s*:)/g
        : /("(?:[^"\\]|\\.)*")(\s*:)?/g
  let at = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    push(out, "plain", line.slice(at, m.index))
    at = m.index + m[0].length
    if (lang === "jsx") {
      if (m[1]) push(out, "string", m[1])
      else if (m[2] && m[3]) {
        push(out, "plain", m[2])
        push(out, "keyword", m[3])
      } else if (m[4]) push(out, "attr", m[4])
      else if (m[5]) push(out, KEYWORDS.has(m[5]) ? "keyword" : "plain", m[5])
    } else if (lang === "css") {
      if (m[1]) push(out, "string", m[1])
      else if (m[2]) push(out, "keyword", m[2])
      else if (m[3]) push(out, "attr", m[3])
    } else {
      // JSON: keys are attributes, other strings are strings.
      push(out, m[2] ? "attr" : "string", m[1] ?? "")
      if (m[2]) push(out, "plain", m[2])
    }
  }
  push(out, "plain", line.slice(at))
  return out
}

/** Lines of a file for the preview (a trailing newline does not add an empty line). */
export function codeLines(contents: string): string[] {
  const lines = contents.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

// --- Writing on desktop: never overwrite silently ---------------------------------------------

export interface PlannedFile {
  path: string
  contents: string | Uint8Array
}

export type PlanStatus = "new" | "same" | "changed"
export interface PlanEntry extends PlannedFile {
  ref: FileRef
  status: PlanStatus
}

const encoder = new TextEncoder()
const bytesOf = (c: string | Uint8Array) => (typeof c === "string" ? encoder.encode(c) : c)
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

/** Diffs every file against what is already in `folder`: new, unchanged or changed. */
export async function planWrite(
  files: readonly PlannedFile[],
  folder: FileRef,
  platform: Pick<KimoPlatform, "files">,
): Promise<PlanEntry[]> {
  const out: PlanEntry[] = []
  for (const f of files) {
    const ref = joinPath(folder, f.path)
    const stat = await platform.files.stat(ref).catch(() => null)
    if (!stat) {
      out.push({ ...f, ref, status: "new" })
      continue
    }
    const existing = await platform.files.readBytes(ref).catch(() => null)
    out.push({
      ...f,
      ref,
      status: existing && equalBytes(existing, bytesOf(f.contents)) ? "same" : "changed",
    })
  }
  return out
}

export interface WriteResult {
  folder: FileRef
  /** Written (new files, plus changed files the caller allowed to overwrite). */
  written: string[]
  /** Identical files already there: not rewritten. */
  unchanged: string[]
  /** Changed files left untouched (never overwritten silently). */
  kept: string[]
}

/**
 * Writes a plan: new files are created, identical files are skipped and changed files are left
 * untouched unless their path is in `overwrite`.
 */
export async function writePlan(
  plan: readonly PlanEntry[],
  folder: FileRef,
  platform: Pick<KimoPlatform, "files">,
  overwrite: ReadonlySet<string> = new Set(),
): Promise<WriteResult> {
  const result: WriteResult = { folder, written: [], unchanged: [], kept: [] }
  for (const e of plan) {
    if (e.status === "same") {
      result.unchanged.push(e.path)
      continue
    }
    if (e.status === "changed" && !overwrite.has(e.path)) {
      result.kept.push(e.path)
      continue
    }
    if (typeof e.contents === "string")
      await platform.files.writeTextAtomic(e.ref, e.contents, { mkdirs: true })
    else await platform.files.writeBytesAtomic(e.ref, e.contents, { mkdirs: true })
    result.written.push(e.path)
  }
  return result
}

// --- Browser: a store-only zip ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.byteLength; i++)
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * A ZIP archive (no compression, UTF-8 names, fixed 1980-01-01 timestamps so the bytes are
 * deterministic) of `files`.
 */
export function zipFiles(files: readonly PlannedFile[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = encoder.encode(f.path)
    const data = bytesOf(f.contents)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.byteLength)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, 0, true) // time
    lv.setUint16(12, 0x21, true) // date 1980-01-01
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.byteLength, true)
    lv.setUint32(22, data.byteLength, true)
    lv.setUint16(26, name.byteLength, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.byteLength)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.byteLength, true)
    cv.setUint32(24, data.byteLength, true)
    cv.setUint16(28, name.byteLength, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.byteLength + data.byteLength
  }
  const centralSize = centrals.reduce((s, c) => s + c.byteLength, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** A file-system-safe base name for the zip ("Marketing site" → "Marketing site.zip"). */
export function zipNameOf(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "export"
  return `${base}.zip`
}
