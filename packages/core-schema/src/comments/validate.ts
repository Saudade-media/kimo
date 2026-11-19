/**
 * Semantic checks of root `comments` (docs/spec/comments.md §1). The structural schema runs with
 * the header; these add the rules JSON Schema cannot say.
 */
import { escapePointer, isObject } from "../json"
import { COMMENT_TEXT_MAX } from "../schema/comments"
import type { IssueSink } from "../validate/issues"
import { parseFormatVersion } from "../version"

type Obj = Record<string, unknown>

const ptr = (...tokens: string[]) => tokens.map((t) => `/${escapePointer(t)}`).join("")

/** Number of Unicode code points in `s`. */
export function codePointLength(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

/** Asset file name (`9f2c41ab03d1e7a2.png`) of an attachment's `./assets/…` path. */
export function attachmentFileName(file: string): string {
  return file.replace(/^\.\/assets\//, "")
}

export function checkComments(
  doc: Obj,
  nodes: Readonly<Record<string, unknown>>,
  assetFiles: ReadonlySet<string> | null,
  sink: IssueSink,
  needFeature: (path: string, what: string) => void,
): void {
  const comments = doc.comments
  if (!isObject(comments) || Object.keys(comments).length === 0) return
  needFeature("/comments", "Comments")
  const v = parseFormatVersion(doc.format)
  if (v && v.major === 1 && v.minor < 1)
    sink.add("SCHEMA", "/format", `Comments need format 1.1, found ${String(doc.format)}`)
  const seen = new Set<string>()
  const claim = (id: string, path: string) => {
    if (Object.hasOwn(nodes, id) || seen.has(id))
      sink.add("COMMENT_ID_COLLISION", path, `Id "${id}" is already used`)
    seen.add(id)
  }
  for (const [tid, thread] of Object.entries(comments)) {
    const base = ptr("comments", tid)
    if (!isObject(thread)) continue
    claim(tid, base)
    const messages = isObject(thread.messages) ? thread.messages : {}
    const first = thread.first
    if (
      Object.keys(messages).length === 0 ||
      typeof first !== "string" ||
      !Object.hasOwn(messages, first)
    )
      sink.add("COMMENT_EMPTY", base, `Thread "${tid}" has no opening message`)
    const anchor = thread.anchor
    if (!isObject(anchor))
      sink.add("COMMENT_ANCHOR_INVALID", `${base}/anchor`, "A thread needs an anchor")
    else if ((anchor.w === undefined) !== (anchor.h === undefined))
      sink.add("COMMENT_ANCHOR_INVALID", `${base}/anchor`, "An area needs both w and h")
    for (const [mid, m] of Object.entries(messages)) {
      const mpath = `${base}/messages/${escapePointer(mid)}`
      claim(mid, mpath)
      if (!isObject(m)) continue
      if (typeof m.text === "string" && codePointLength(m.text) > COMMENT_TEXT_MAX)
        sink.add("SCHEMA", `${mpath}/text`, `Message text is over ${COMMENT_TEXT_MAX} characters`)
      if (!assetFiles || !Array.isArray(m.attachments)) continue
      m.attachments.forEach((a, i) => {
        if (!isObject(a) || typeof a.file !== "string") return
        const name = attachmentFileName(a.file)
        if (!assetFiles.has(name))
          sink.add(
            "COMMENT_ATTACHMENT_MISSING",
            `${mpath}/attachments/${i}`,
            `Attachment "assets/${name}" does not exist`,
          )
      })
    }
  }
}
