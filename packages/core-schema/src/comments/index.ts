/**
 * Canvas comments helpers shared by the editor, the MCP server and the CLI
 * (docs/spec/comments.md). Comments are never exported and never enter the node tree.
 */
import { isObject } from "../json"
import type { CommentMessage, Comments, CommentThread } from "../schema/comments"
import {
  COMMENTS_FORMAT_VERSION,
  COMMENTS_SCHEMA_URL,
  FORMAT_VERSION,
  parseFormatVersion,
  SCHEMA_URL,
} from "../version"

export { canonicalJson, mergeComments } from "./merge"
export * from "./text"
export { attachmentFileName, checkComments, codePointLength } from "./validate"

/** The feature a document with comments lists. */
export const COMMENTS_FEATURE = "doc/comments"

type Obj = Record<string, unknown>

/** True when `doc` has at least one comment thread. */
export function hasComments(doc: { comments?: unknown }): boolean {
  return isObject(doc.comments) && Object.keys(doc.comments).length > 0
}

/**
 * The header a writer must emit for the document's comments (§1): with threads, format 1.1 and
 * feature "doc/comments"; without, no `comments` member, no feature and format 1.0, so a
 * comment-free file stays editable in older Kimo. Other formats are left alone. Pure.
 */
export function withCommentsHeader<T extends object>(doc: T): T {
  const d = doc as unknown as Obj
  const has = hasComments(d)
  const out: Obj = { ...d }
  const features = new Set(
    Array.isArray(d.features) ? d.features.filter((f): f is string => typeof f === "string") : [],
  )
  const v = parseFormatVersion(d.format)
  if (has) {
    features.add(COMMENTS_FEATURE)
    if (v && v.major === 1 && v.minor < 1) {
      out.format = COMMENTS_FORMAT_VERSION
      out.$schema = COMMENTS_SCHEMA_URL
    }
  } else {
    delete out.comments
    features.delete(COMMENTS_FEATURE)
    if (v && v.major === 1 && v.minor === 1) {
      out.format = FORMAT_VERSION
      out.$schema = SCHEMA_URL
    }
  }
  if (features.size > 0) out.features = [...features].sort()
  else delete out.features
  return out as unknown as T
}

/** A thread with its derived display number (§1: by first message `at`, then id, from 1). */
export interface NumberedThread {
  id: string
  number: number
  thread: CommentThread
}

/** `at` of a thread's opening message ("" when it has none). */
export function threadStart(thread: CommentThread): string {
  const first = Object.hasOwn(thread.messages, thread.first)
    ? thread.messages[thread.first]
    : undefined
  return first?.at ?? ""
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Every thread in display order, numbered. */
export function numberedThreads(comments: Comments | undefined): NumberedThread[] {
  if (!comments) return []
  return Object.entries(comments)
    .map(([id, thread]) => ({ id, thread, start: threadStart(thread) }))
    .sort((a, b) => byCode(a.start, b.start) || byCode(a.id, b.id))
    .map(({ id, thread }, i) => ({ id, thread, number: i + 1 }))
}

/** A thread's messages in display order: the opening message first, then by `at`, then id. */
export function threadMessages(thread: CommentThread): { id: string; message: CommentMessage }[] {
  return Object.entries(thread.messages)
    .map(([id, message]) => ({ id, message }))
    .sort((a, b) => {
      if (a.id === thread.first) return -1
      if (b.id === thread.first) return 1
      return byCode(a.message.at, b.message.at) || byCode(a.id, b.id)
    })
}

/** An RFC 3339 UTC timestamp with milliseconds, as messages store it. */
export function commentTime(date: Date = new Date()): string {
  return date.toISOString()
}
