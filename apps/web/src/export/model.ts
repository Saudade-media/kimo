/**
 * Export dialog model (board 07 "Export Dialog" `AsO2h`, ADR 0015): the four formats, their
 * `@kimo/exporters` targets, the code-preview tokenizer (colors of the board's Code frame
 * `t1smNB`), the output-folder display, the no-overwrite write plan and a store-only zip
 * writer for the browser. Pure (no DOM, no React) so it is unit-tested directly.
 */

import type { FileRef, KimoPlatform } from "@kimo/platform"

// --- Formats ---------------------------------------------------------------------------------

export type ExportFormat = "react" | "html" | "tokens" | "assets" | "pdf"

/**
 * Format rows: board 07 (`v0S2cL`, `qsAIn`, `OOS97`, `wPYOJ`) with board 25 § 2 (a) (`NAYlQ`):
 * the tokens / SVG·PNG subs as redrawn there and the 5th row PDF (`D7dje`, icon file-text).
 */
export const EXPORT_FORMATS: readonly {
  id: ExportFormat
  icon: string
  title: string
  sub: string
}[] = [
  { id: "react", icon: "atom", title: "React + Tailwind", sub: "TSX · Tailwind v4" },
  { id: "html", icon: "code-xml", title: "HTML + CSS", sub: "Static markup, CSS variables" },
  { id: "tokens", icon: "braces", title: "Design tokens", sub: "W3C DTCG JSON + CSS" },
  { id: "assets", icon: "image", title: "SVG / PNG", sub: "Vector or raster per frame" },
  { id: "pdf", icon: "file-text", title: "PDF", sub: "Vector · one page per frame" },
]

/** Preview bar Scale switch (`k7fVi5`): 1×, 2×, 3× (rule: default 2×). */
export const PNG_SCALES = [1, 2, 3] as const
export type PngScale = (typeof PNG_SCALES)[number]
export const DEFAULT_PNG_SCALE: PngScale = 2

/** SVG / PNG row: the preview bar's SVG | PNG toggle (`plpsW`) picks what is exported. */
export type ImageKind = "svg" | "png"

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

/** Board 25 rule "PDF row": Embed fonts (on), Include bleed (off). */
export interface PdfToggles {
  embedFonts: boolean
  bleed: boolean
}
export const DEFAULT_PDF_TOGGLES: PdfToggles = { embedFonts: true, bleed: false }
/** "Include bleed": 3 mm on every side, in PDF points. */
export const PDF_BLEED_PT = 8.5

/**
 * React + Tailwind "Tailwind theme" (board 27 §10 (c) f6LWt, rule jmMl8): where the theme goes
 * — `@theme` in tokens.css (v4, default) · tailwind.config.ts (v3) · Don't emit — and "Map
 * variables to theme tokens" (on by default).
 */
export type TailwindThemeOutput = "v4" | "v3" | "none"
export interface TailwindChoices {
  theme: TailwindThemeOutput
  mapTokens: boolean
}
export const DEFAULT_TAILWIND: TailwindChoices = { theme: "v4", mapTokens: true }
/**
 * The Theme output Select's options. The board's v4 label reads "@theme in globals.css (v4)";
 * the React exporter writes the `@theme` block into its `tokens.css` (next to the CSS variables),
 * so the label names the file it really writes.
 */
export const TAILWIND_THEMES: readonly { value: TailwindThemeOutput; label: string }[] = [
  { value: "v4", label: "@theme in tokens.css (v4)" },
  { value: "v3", label: "tailwind.config.ts (v3)" },
  { value: "none", label: "Don't emit" },
]

const STORE = "kimo.export"

/** The dialog's remembered options (`kimo.export.toggles`); the Code tab reads the same. */
export function readExportToggles(storage: Pick<Storage, "getItem"> | null): ExportToggles {
  try {
    const raw = storage?.getItem(`${STORE}.toggles`)
    return raw ? { ...DEFAULT_TOGGLES, ...(JSON.parse(raw) as object) } : DEFAULT_TOGGLES
  } catch {
    return DEFAULT_TOGGLES
  }
}

/**
 * The dialog's Tailwind theme choice (`kimo.export.tailwind`). Board 28 (d): the Code tab has no
 * control of its own and uses this, so its files match what Export writes.
 */
export function readExportTailwind(storage: Pick<Storage, "getItem"> | null): TailwindChoices {
  try {
    const raw = storage?.getItem(`${STORE}.tailwind`)
    const v = raw ? { ...DEFAULT_TAILWIND, ...(JSON.parse(raw) as object) } : DEFAULT_TAILWIND
    return TAILWIND_THEMES.some((t) => t.value === v.theme) && typeof v.mapTokens === "boolean"
      ? v
      : DEFAULT_TAILWIND
  } catch {
    return DEFAULT_TAILWIND
  }
}

/** Fired on `window` when the Export dialog remembers new options (the Code tab regenerates). */
export const EXPORT_OPTIONS_EVENT = "kimo:export-options"

/** `@kimo/exporters` targets per format (text targets first; PNG / PDF are binary). */
export function targetsOf(
  format: ExportFormat,
  image: ImageKind = "svg",
): {
  text: ("react-tailwind" | "html-css" | "tokens-css" | "tokens-dtcg" | "svg")[]
  png: boolean
  pdf: boolean
} {
  switch (format) {
    case "react":
      return { text: ["react-tailwind"], png: false, pdf: false }
    case "html":
      return { text: ["html-css"], png: false, pdf: false }
    case "tokens":
      return { text: ["tokens-css", "tokens-dtcg"], png: false, pdf: false }
    case "assets":
      return image === "png"
        ? { text: [], png: true, pdf: false }
        : { text: ["svg"], png: false, pdf: false }
    case "pdf":
      return { text: [], png: false, pdf: true }
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

/**
 * Footer note: desktop (`Vg83B`) "3 files · existing files are diffed, never overwritten
 * silently"; web (board 25 `jufHA`) "3 files".
 */
export function footerNote(count: number, desktop: boolean): string {
  return desktop
    ? `${plural(count, "file")} · existing files are diffed, never overwritten silently`
    : plural(count, "file")
}

/** Board 25 (e) header (`cwq8A`): "Untitled 3 · not saved yet · 1 frame". */
export const describeUntitled = (name: string, frames: number) =>
  [name, "not saved yet", plural(frames, "frame")].join(" · ")

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

const joinPath = (dir: string, rel: string) =>
  dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${rel}` : `${dir}/${rel}`

// --- Code preview tokens (board 07 Code `t1smNB`) --------------------------------------------

/**
 * Token kinds and their fills on the board: line number `$text-tertiary`, keyword / tag name
 * `$agent-2`, attribute / property name `$warning`, string `$success`, the rest
 * `$text-primary`.
 */
type TokenKind = "plain" | "keyword" | "attr" | "string"
interface CodeToken {
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

interface PlannedFile {
  path: string
  contents: string | Uint8Array
}

export type PlanStatus = "new" | "same" | "changed"
export interface PlanEntry extends PlannedFile {
  ref: FileRef
  status: PlanStatus
  /** What is on disk now (changed files: the review step diffs it). */
  existing?: Uint8Array
}

const encoder = new TextEncoder()
export const bytesOf = (c: string | Uint8Array) => (typeof c === "string" ? encoder.encode(c) : c)
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
    const same = existing !== null && equalBytes(existing, bytesOf(f.contents))
    out.push({
      ...f,
      ref,
      status: same ? "same" : "changed",
      ...(!same && existing ? { existing } : {}),
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

/** A file-system-safe file name ("Marketing site.zip"). */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "export"
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

/** Board 25 (d) rule: the zip name defaults to `kimo-export-<frame>.zip` ("Hero" → hero). */
export function defaultZipName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `kimo-export-${slug || "export"}.zip`
}

// --- Review step (board 25 § 2 (g) P8d2o, rule "Review") -----------------------------------

type DiffKind = "context" | "add" | "remove"
interface DiffRow {
  kind: DiffKind
  /** New-side number for context / added rows, old-side number for removed rows. */
  number: number
  text: string
}
interface DiffHunk {
  rows: DiffRow[]
}
interface FileDiff {
  hunks: DiffHunk[]
  added: number
  removed: number
}

/** Line edit script (Myers O(ND)): rows in order, before context trimming. */
function editScript(a: readonly string[], b: readonly string[]): DiffRow[] {
  const n = a.length
  const m = b.length
  const max = n + m
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let done = false
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))
          ? (v[off + k + 1] as number)
          : (v[off + k - 1] as number) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        done = true
        break
      }
    }
  }
  // Backtrack.
  const rows: DiffRow[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d] as Int32Array
    const k = x - y
    const prevK =
      k === -d || (k !== d && (vd[off + k - 1] as number) < (vd[off + k + 1] as number))
        ? k + 1
        : k - 1
    const prevX = d === 0 ? 0 : (vd[off + prevK] as number)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      rows.push({ kind: "context", number: y, text: b[y - 1] as string })
      x--
      y--
    }
    if (d === 0) break
    if (x === prevX) rows.push({ kind: "add", number: y, text: b[y - 1] as string })
    else rows.push({ kind: "remove", number: x, text: a[x - 1] as string })
    x = prevX
    y = prevY
  }
  return rows.reverse()
}

/** Unified diff of `before` (on disk) → `after` (export), `context` lines around changes. */
export function unifiedDiff(before: string, after: string, context = 3): FileDiff {
  const rows = editScript(codeLines(before), codeLines(after))
  const changed = rows.map((r) => r.kind !== "context")
  const keep = rows.map((_, i) => {
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++)
      if (changed[j]) return true
    return false
  })
  const hunks: DiffHunk[] = []
  let cur: DiffHunk | null = null
  rows.forEach((r, i) => {
    if (!keep[i]) {
      cur = null
      return
    }
    if (!cur) {
      cur = { rows: [] }
      hunks.push(cur)
    }
    cur.rows.push(r)
  })
  return {
    hunks,
    added: rows.filter((r) => r.kind === "add").length,
    removed: rows.filter((r) => r.kind === "remove").length,
  }
}

/** Diff header Meta (`L4oMS`): "3 hunks". */
export const hunksLabel = (n: number) => plural(n, "hunk")

export type ReviewChoice = "keep" | "overwrite"

/** A hash of a file's bytes as Kimo wrote it (crc32 + length). */
export const contentHash = (c: string | Uint8Array) => {
  const b = bytesOf(c)
  return `${crc32(b).toString(16).padStart(8, "0")}:${b.byteLength}`
}

/** Hashes of the files Kimo wrote last time into a folder (`kimo.export.written.<folder>`). */
type WrittenRecord = Record<string, string>

export function readWritten(
  folder: string,
  storage: Pick<Storage, "getItem"> | null,
): WrittenRecord {
  try {
    const raw = storage?.getItem(`${STORE}.written.${folder}`)
    return raw ? (JSON.parse(raw) as WrittenRecord) : {}
  } catch {
    return {}
  }
}

export function recordWritten(
  folder: string,
  files: readonly PlannedFile[],
  storage: Pick<Storage, "getItem" | "setItem"> | null,
) {
  if (files.length === 0) return
  const rec = readWritten(folder, storage)
  for (const f of files) rec[f.path] = contentHash(f.contents)
  try {
    storage?.setItem(`${STORE}.written.${folder}`, JSON.stringify(rec))
  } catch {}
}

/**
 * Rule "Review": Overwrite for files Kimo wrote last time (the disk still hashes to what it
 * wrote), Keep for files edited by hand since — or never written by Kimo.
 */
export function defaultChoice(
  existing: Uint8Array | undefined,
  last: string | undefined,
): ReviewChoice {
  return existing && last !== undefined && contentHash(existing) === last ? "overwrite" : "keep"
}

/** Review header Desc (`x250y`): "2 of 3 files already exist in ~/loom/src/components". */
export const reviewDesc = (changed: number, total: number, folder: string) =>
  `${changed} of ${plural(total, "file")} already exist${changed === 1 ? "s" : ""} in ${folder}`

/** Review footer Summary (`qQXam`): "1 overwrite · 1 kept · 1 new". */
export function reviewSummary(overwrite: number, kept: number, fresh: number): string {
  return [
    `${overwrite} overwrite${overwrite === 1 ? "" : "s"}`,
    `${kept} kept`,
    `${fresh} new`,
  ].join(" · ")
}

/** Primary (`dUJUL`): "Write 2 files". */
export const writeLabel = (n: number) => `Write ${plural(n, "file")}`

/** Folder for display ("~/loom/src/components"). */
export function shortFolder(folder: string): string {
  const d = folderDisplay(folder)
  return d.prefix === "~/" ? `~/${d.value}`.replace(/\/$/, "") || "~" : folder
}

// --- Progress / error (board 25 § 2 (b) WnLfR, (c) ixYdn) -----------------------------------

/** Progress Label (`h5COWe`): "Writing 2 of 3 · ~/loom/src/components". */
export const progressLabel = (k: number, n: number, folder: string) =>
  `Writing ${k} of ${n} · ${shortFolder(folder)}`

/** Retry (`Wqwu8`): "Retry 2 files". */
export const retryLabel = (n: number) => `Retry ${plural(n, "file")}`

/** The error card's title / description for a failed write (rule "Error"). */
export function describeWriteError(
  error: unknown,
  file: string,
  folder: string,
  written: readonly string[],
  notStarted: readonly string[],
): { title: string; description: string } {
  const e = error as { errno?: string; code?: string; message?: string }
  const errno = e?.errno ?? (e?.code && /^E[A-Z]+$/.test(e.code) ? e.code : undefined)
  const where = shortFolder(folder)
  let reason: string
  switch (errno ?? e?.code) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
    case "PERMISSION":
      reason = `Permission denied (${errno ?? "EACCES"}). ${where} is read-only.`
      break
    case "ENOSPC":
    case "EDQUOT":
    case "DISK_FULL":
      reason = `Disk full (${errno ?? "ENOSPC"}). Not enough space in ${where}.`
      break
    case "EEXIST":
    case "CHANGED":
      reason = `${file} changed while exporting, review again.`
      break
    default:
      reason = e?.message ? `${e.message}.` : "The file could not be written."
  }
  const tail = [
    written.length ? `${list(written)} ${written.length === 1 ? "was" : "were"} written` : "",
    notStarted.length
      ? `${list(notStarted)} ${notStarted.length === 1 ? "was" : "were"} not started`
      : "",
  ]
    .filter(Boolean)
    .join("; ")
  return {
    title: `Couldn't write ${file}`,
    description: tail ? `${reason} ${tail}.` : reason,
  }
}

const list = (xs: readonly string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`

// --- Toasts (board 25 § 2 (f) pQlt5, rule "Toast") -----------------------------------------

interface ExportToastSpec {
  tone: "success" | "warning"
  /** Lucide icon (`d82EN`): circle-check success · circle-alert warning. */
  icon: "circle-check" | "circle-alert"
  text: string
  /** Desktop only: "Reveal" opens the folder in Finder / Explorer. */
  reveal: string | null
  /** 4 s; cancelled 6 s. */
  duration: number
}

/** The toast after an export ("Exported 3 files to ~/loom/src/components", …). */
export function exportToastOf(
  o:
    | {
        kind: "folder"
        folder: string
        written: readonly string[]
        kept: readonly string[]
        cancelled?: { total: number }
      }
    | { kind: "zip" | "file"; name: string },
): ExportToastSpec {
  if (o.kind !== "folder")
    return {
      tone: "success",
      icon: "circle-check",
      text: `Downloaded ${o.name}`,
      reveal: null,
      duration: 4000,
    }
  if (o.cancelled)
    return {
      tone: "warning",
      icon: "circle-alert",
      text: `Export cancelled · ${o.written.length} of ${o.cancelled.total} written`,
      reveal: o.folder,
      duration: 6000,
    }
  if (o.kept.length > 0)
    return {
      tone: "success",
      icon: "circle-check",
      text: `${o.written.length} written · ${o.kept.length} kept as-is`,
      reveal: o.folder,
      duration: 4000,
    }
  return {
    tone: "success",
    icon: "circle-check",
    text: `Exported ${plural(o.written.length, "file")} to ${shortFolder(o.folder)}`,
    reveal: o.folder,
    duration: 4000,
  }
}

// --- PNG preview (rule "PNG preview": size line) --------------------------------------------

/** "720 × 366 → 1440 × 732 · ≈ 212 KB". */
export function pngSizeLine(w: number, h: number, scale: number, bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1024))
  return `${Math.round(w)} × ${Math.round(h)} → ${Math.round(w * scale)} × ${Math.round(h * scale)} · ≈ ${kb} KB`
}

/** PDF preview meta: "3 pages". */
export const pagesLabel = (n: number) => plural(n, "page")
