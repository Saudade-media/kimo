/**
 * The `kimo_comments` handler (docs/spec/comments.md §8). Comments live in the store's
 * `CommentStore`, outside the design revision: no op group, no undo, no baseRevision.
 */
import {
  type CommentAnchor,
  type CommentAuthor,
  type CommentMessage,
  type CommentThread,
  listPages,
  numberedThreads,
  pageOfRoot,
  threadMessages,
} from "@kimo/core-schema"
import { CommentError, type CommentStore, type DocStore } from "@kimo/editor-state"
import { failure, success, type ToolError } from "../envelope"
import type { HandlerOutput, HostDocument, ToolContext } from "../runtime"
import { sameRev } from "./util"

const fail = (e: ToolError, d?: HostDocument): HandlerOutput => ({
  result: failure(e, d ? { revision: sameRev(d.store.revision) } : {}),
})

/** The calling agent as a comment author (spec §1: `agent:<origin>`). */
export function agentAuthor(ctx: Pick<ToolContext, "origin" | "identity">): CommentAuthor {
  // MCP clients keep one author across sessions; the built-in agent is its own origin.
  const id = ctx.origin.startsWith("mcp:") ? `agent:mcp:${ctx.identity.client}` : ctx.origin
  const name = (ctx.identity.label || ctx.identity.client || "Agent").slice(0, 64)
  return { id, name, kind: "agent" }
}

const TOP_LEVEL_TYPES = new Set(["frame", "group"])

function messageOut(id: string, m: CommentMessage) {
  const out: Record<string, unknown> = {
    id,
    author: { id: m.author.id, name: m.author.name, kind: m.author.kind },
    at: m.at,
    text: m.text,
  }
  if (m.edited) out.edited = m.edited
  if (m.reactions)
    out.reactions = Object.entries(m.reactions).map(([emoji, who]) => ({
      emoji,
      count: who.length,
    }))
  if (m.attachments?.length) out.images = m.attachments.length
  return out
}

function anchorOut(store: DocStore, a: CommentAnchor) {
  const out: Record<string, unknown> = { x: a.x, y: a.y }
  if (a.page) out.page = a.page
  if (a.node) {
    out.node = a.node
    if (!store.hasNode(a.node)) out.detached = true
  }
  if (a.w !== undefined && a.h !== undefined) {
    out.w = a.w
    out.h = a.h
  }
  return out
}

/** Page coordinates of a top-level node's top-left corner. */
function nodeOrigin(store: DocStore, id: string): { x: number; y: number } {
  const n = store.getNode(id) as Record<string, unknown> | undefined
  const num = (v: unknown) => (typeof v === "number" ? v : 0)
  return { x: num(n?.x), y: num(n?.y) }
}

export async function commentsHandler(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<HandlerOutput> {
  const r = ctx.host.get(String(input.docId))
  if (!r.ok) return { result: failure(r.error) }
  const d = r.value
  const store = d.store
  const comments: CommentStore | undefined = store.comments
  if (!comments)
    return fail({ code: "UNSUPPORTED", message: "This document host has no comments." }, d)
  const action = String(input.action)
  const me = agentAuthor(ctx)
  const extra = { doc: d.ref, revision: sameRev(store.revision) }
  const numbered = numberedThreads(comments.threads())
  const numberOf = new Map(numbered.map((t) => [t.id, t.number]))
  const need = (k: string): ToolError | null =>
    typeof input[k] === "string" && input[k] !== ""
      ? null
      : { code: "INVALID_INPUT", message: `${action} needs ${k}.`, path: k }

  if (action === "list") {
    const page = typeof input.page === "string" ? input.page : null
    const threads = numbered
      .filter(({ thread }) => input.includeResolved === true || !thread.resolved)
      .filter(({ thread }) => page === null || (thread.anchor.page ?? null) === page)
      .filter(({ thread }) => {
        if (input.unreadOnly !== true) return true
        const list = threadMessages(thread)
        return list[list.length - 1]?.message.author.id !== me.id
      })
      .slice(0, 200)
      .map(({ id, number, thread }) => {
        const list = threadMessages(thread)
        const first = list[0] as { id: string; message: CommentMessage }
        const last = list.length > 1 ? list[list.length - 1] : undefined
        return {
          id,
          number,
          anchor: anchorOut(store, thread.anchor),
          resolved: Boolean(thread.resolved),
          messageCount: list.length,
          first: messageOut(first.id, first.message),
          ...(last ? { last: messageOut(last.id, last.message) } : {}),
        }
      })
    return { result: success({ threads }, `${threads.length} comment thread(s).`, extra) }
  }

  if (action === "read") {
    const e = need("threadId")
    if (e) return fail(e, d)
    const id = String(input.threadId)
    const thread = comments.thread(id)
    if (!thread)
      return fail({ code: "INVALID_INPUT", message: `No thread ${id}.`, path: "threadId" }, d)
    return {
      result: success(
        {
          thread: {
            id,
            number: numberOf.get(id) ?? 1,
            anchor: anchorOut(store, thread.anchor),
            resolved: Boolean(thread.resolved),
            messages: threadMessages(thread).map(({ id: mid, message }) =>
              messageOut(mid, message),
            ),
          },
        },
        `Thread #${numberOf.get(id) ?? 1}: ${Object.keys(thread.messages).length} message(s).`,
        extra,
      ),
    }
  }

  // Writes: a view-only room refuses them (spec §8), like a read-only file.
  if (d.shared?.role === "view" || comments.readOnly !== null)
    return fail(
      {
        code: "READ_ONLY",
        message: "Comments are read-only here (a view-only room or a read-only file).",
      },
      d,
    )
  try {
    if (action === "create") {
      const e = need("text")
      if (e) return fail(e, d)
      if (typeof input.x !== "number" || typeof input.y !== "number")
        return fail({ code: "INVALID_INPUT", message: "create needs x and y.", path: "x" }, d)
      const a = input as {
        node?: string
        page?: string
        x: number
        y: number
        w?: number
        h?: number
      }
      const anchor: CommentAnchor = { x: a.x, y: a.y }
      if ((a.w === undefined) !== (a.h === undefined))
        return fail({ code: "INVALID_INPUT", message: "An area needs both w and h.", path: "w" }, d)
      if (a.w !== undefined && a.h !== undefined) {
        anchor.w = a.w
        anchor.h = a.h
      }
      const doc = store.toHeader()
      if (a.node) {
        const n = store.getNode(a.node) as Record<string, unknown> | undefined
        if (!n)
          return fail({ code: "NODE_NOT_FOUND", message: `No node ${a.node}.`, nodeId: a.node }, d)
        if (n.parent !== null || !TOP_LEVEL_TYPES.has(String(n.type)))
          return fail(
            {
              code: "INVALID_INPUT",
              message: "Pins attach to top-level frames, components and groups only.",
              path: "node",
              nodeId: a.node,
              suggestion: "Pin to its top-level frame with an offset, or use page coordinates.",
            },
            d,
          )
        anchor.node = a.node
        const o = nodeOrigin(store, a.node)
        anchor.fallback = { x: o.x + a.x, y: o.y + a.y }
        const page = pageOfRoot(doc as never, n as never)
        if (page) anchor.page = page
      } else {
        const pages = listPages(doc as never)
        const page = a.page ?? pages[0]?.id ?? null
        if (page && !pages.some((p) => p.id === page))
          return fail({ code: "INVALID_INPUT", message: `No page ${page}.`, path: "page" }, d)
        if (page) anchor.page = page
      }
      const { threadId, messageId } = comments.createThread(
        { anchor, message: { author: me, text: String(input.text) } },
        ctx.origin,
      )
      return {
        result: success({ threadId, messageId }, "Started a comment thread.", extra),
        label: "Comment",
      }
    }
    const e = need("threadId")
    if (e) return fail(e, d)
    const threadId = String(input.threadId)
    const thread: CommentThread | undefined = comments.thread(threadId)
    if (!thread)
      return fail({ code: "INVALID_INPUT", message: `No thread ${threadId}.`, path: "threadId" }, d)
    if (action === "reply") {
      const t = need("text")
      if (t) return fail(t, d)
      const messageId = comments.reply(
        threadId,
        { author: me, text: String(input.text) },
        ctx.origin,
      )
      return { result: success({ messageId }, "Replied.", extra), label: "Comment reply" }
    }
    if (action === "resolve" || action === "unresolve") {
      comments.setResolved(threadId, action === "resolve" ? me : null, ctx.origin)
      return {
        result: success(
          {},
          action === "resolve" ? "Resolved the thread." : "Reopened the thread.",
          extra,
        ),
      }
    }
    if (action === "react") {
      const m = need("messageId") ?? need("emoji")
      if (m) return fail(m, d)
      const reacted = comments.toggleReaction(
        threadId,
        String(input.messageId),
        String(input.emoji),
        me.id,
        ctx.origin,
      )
      return { result: success({ reacted }, reacted ? "Reacted." : "Removed the reaction.", extra) }
    }
    return fail({ code: "INVALID_INPUT", message: `Unknown action ${action}.`, path: "action" }, d)
  } catch (err) {
    if (err instanceof CommentError) {
      const code =
        err.code === "RATE_LIMITED"
          ? "RATE_LIMITED"
          : err.code === "READ_ONLY"
            ? "READ_ONLY"
            : "INVALID_INPUT"
      return fail({ code, message: err.message }, d)
    }
    throw err
  }
}
