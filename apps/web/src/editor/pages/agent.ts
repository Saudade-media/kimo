/**
 * Board 27 §1 / spec §5.6 for the built-in agent: its top-level inserts land on the user's active
 * page by default, like the editor's own (`withActivePage`). Rewrites `kimo_apply_ops` input
 * before dispatch; an explicit `page` from the model is kept.
 */
import type { ToolHost, ToolStream } from "@kimo/ai-agent"
import { PartialJsonObject } from "@kimo/mcp-server"

type Wire = Record<string, unknown> & { op?: unknown }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * The per-op form of {@link withPageDefaults}: each call of the returned function maps one op in
 * order (instance keys it adds count across calls), so a streamed call's ops, mapped one by one
 * as they arrive, equal the whole call mapped at once.
 */
export function pageDefaulter(pageId: string): (raw: unknown) => unknown[] {
  let n = 0
  return (raw) => {
    if (!isObj(raw)) return [raw]
    const op = raw as Wire
    if (op.parent !== "root") return [op]
    switch (op.op) {
      case "insert": {
        const node = isObj(op.node) ? op.node : {}
        return [node.page === undefined ? { ...op, node: { ...node, page: pageId } } : op]
      }
      case "copy": {
        const set = isObj(op.set) ? op.set : {}
        return [set.page === undefined ? { ...op, set: { ...set, page: pageId } } : op]
      }
      case "move":
        return [op, { op: "update", id: op.id, set: { page: pageId } }]
      case "instantiate": {
        // The instance's id is only known through its key: give it one when it has none.
        const key = typeof op.key === "string" ? op.key : `kimo_page_${++n}`
        return [
          { ...op, key },
          { op: "update", id: `@${key}`, set: { page: pageId } },
        ]
      }
      default:
        return [op]
    }
  }
}

/** `kimo_apply_ops` ops with top-level placements on page `pageId`. */
export function withPageDefaults(ops: readonly unknown[], pageId: string): unknown[] {
  const map = pageDefaulter(pageId)
  return ops.flatMap((op) => map(op))
}

/**
 * A streamed kimo_script call on `pageId`: the call gets `page` (below), so its streamed input
 * gets the same field, written first, before the model's own fields.
 */
function scriptOnPage(inner: ToolStream, pageId: string): ToolStream {
  let started = false
  return {
    push(chunk) {
      if (started) return inner.push(chunk)
      const at = chunk.indexOf("{")
      if (at < 0) return inner.push(chunk)
      started = true
      inner.push(`${chunk.slice(0, at + 1)}"page":${JSON.stringify(pageId)},${chunk.slice(at + 1)}`)
    },
    ...(inner.event ? { event: inner.event.bind(inner) } : {}),
    abort: (reason) => inner.abort(reason),
    onProgress: (l) => inner.onProgress(l),
  }
}

/**
 * Wraps a tool host so `kimo_apply_ops` calls default top-level nodes to `page()`. A streamed
 * call (ADR 0013 §4.7) gets the same mapping op by op, so its streamed ops match the call.
 */
export function pageAwareToolHost(host: ToolHost, page: () => string | null): ToolHost {
  return {
    tools: () => host.tools(),
    ...(host.stream
      ? {
          stream(call: { id: string; name: string }): ToolStream | undefined {
            const inner = host.stream?.(call)
            const id = page()
            if (inner && id && call.name === "kimo_script") return scriptOnPage(inner, id)
            if (!inner?.event || !id || call.name !== "kimo_apply_ops") return inner
            const forward = inner.event.bind(inner)
            const parser = new PartialJsonObject("ops")
            const map = pageDefaulter(id)
            let k = 0
            return {
              push(chunk) {
                for (const e of parser.push(chunk)) {
                  if (e.kind !== "item") forward(e)
                  else
                    for (const op of map(e.value)) forward({ kind: "item", index: k++, value: op })
                }
              },
              event: forward,
              abort: (reason) => inner.abort(reason),
              onProgress: (l) => inner.onProgress(l),
            }
          },
        }
      : {}),
    call(call, signal) {
      const id = page()
      if (id && call.name === "kimo_script" && call.input.page === undefined)
        return host.call({ ...call, input: { ...call.input, page: id } }, signal)
      if (id && call.name === "kimo_apply_ops" && Array.isArray(call.input.ops))
        return host.call(
          { ...call, input: { ...call.input, ops: withPageDefaults(call.input.ops, id) } },
          signal,
        )
      return host.call(call, signal)
    },
  }
}
