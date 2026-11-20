/**
 * Canvas comments (format 1.1, feature "doc/comments", docs/spec/comments.md §1–§2). Root
 * `comments` is a record of threads keyed by id; each thread holds an anchor, its opening message
 * id, an optional resolution and a record of messages keyed by id.
 */
import Type, { type Static } from "typebox"
import { ID_PATTERN, Id, RecordOf, Strict, StringEnum } from "./primitives"

const opt = Type.Optional

/** RFC 3339 UTC timestamp with milliseconds (`2026-11-10T09:42:07.120Z`). */
export const COMMENT_TIME_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"

/** Author id: `acct:<id>`, `dev:<key id>` or `agent:<origin>`. */
export const AUTHOR_ID_PATTERN = "^(?:acct|dev|agent):[^\\s]{1,128}$"

/** Longest message text, in code points. */
export const COMMENT_TEXT_MAX = 5000
/** Most attachments on one message. */
export const COMMENT_ATTACHMENTS_MAX = 5
/** Image types an attachment may have. */
export const COMMENT_ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/gif"] as const

export const CommentTime = Type.String({ pattern: COMMENT_TIME_PATTERN })

export const CommentAuthor = Strict({
  id: Type.String({ pattern: AUTHOR_ID_PATTERN }),
  name: Type.String({ minLength: 1, maxLength: 64 }),
  kind: StringEnum(["person", "agent"] as const),
})
export type CommentAuthor = Static<typeof CommentAuthor>

export const CommentAttachment = Strict({
  file: Type.String({
    pattern: "^\\./assets/[0-9a-f]{16}\\.(?:png|jpg|jpeg|gif)$",
    description: "Content-addressed asset path, as in image paints.",
  }),
  mime: StringEnum(COMMENT_ATTACHMENT_MIMES),
  sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  width: opt(Type.Integer({ minimum: 0 })),
  height: opt(Type.Integer({ minimum: 0 })),
})
export type CommentAttachment = Static<typeof CommentAttachment>

export const CommentMessage = Strict({
  author: CommentAuthor,
  at: CommentTime,
  text: Type.String({ minLength: 1 }),
  edited: opt(CommentTime),
  attachments: opt(
    Type.Array(CommentAttachment, { minItems: 1, maxItems: COMMENT_ATTACHMENTS_MAX }),
  ),
  reactions: opt(
    RecordOf(
      "^\\S{1,32}$",
      Type.Array(Type.String({ pattern: AUTHOR_ID_PATTERN }), { minItems: 1, uniqueItems: true }),
    ),
  ),
})
export type CommentMessage = Static<typeof CommentMessage>

export const CommentPoint = Strict({ x: Type.Number(), y: Type.Number() })

export const CommentAnchor = Strict({
  page: opt(Id),
  node: opt(Id),
  x: Type.Number(),
  y: Type.Number(),
  w: opt(Type.Number({ exclusiveMinimum: 0 })),
  h: opt(Type.Number({ exclusiveMinimum: 0 })),
  fallback: opt(CommentPoint),
})
export type CommentAnchor = Static<typeof CommentAnchor>

export const CommentResolution = Strict({ by: CommentAuthor, at: CommentTime })

export const CommentThread = Strict({
  anchor: CommentAnchor,
  first: Id,
  messages: RecordOf(ID_PATTERN, CommentMessage, { minProperties: 1 }),
  resolved: opt(CommentResolution),
})
export type CommentThread = Static<typeof CommentThread>

/** Root `comments`: thread id → thread. */
export const Comments = RecordOf(ID_PATTERN, CommentThread, {
  description: 'Comment threads (feature "doc/comments", format 1.1). Never exported.',
})
export type Comments = Static<typeof Comments>
