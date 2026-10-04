/**
 * Board 27 §1 / spec §5.6 for the built-in agent: its top-level inserts land on the user's active
 * page by default, like the editor's own (`withActivePage`). Rewrites `kimo_apply_ops` input
 * before dispatch; an explicit `page` from the model is kept.
 */
import type { ToolHost } from "@kimo/ai-agent"

type Wire = Record<string, unknown> & { op?: unknown }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** `kimo_apply_ops` ops with top-level placements on page `pageId`. */
export function withPageDefaults(ops: readonly unknown[], pageId: string): unknown[] {
  const out: unknown[] = []
  let n = 0
  for (const raw of ops) {
    if (!isObj(raw)) {
      out.push(raw)
      continue
    }
    const op = raw as Wire
    const toRoot = op.parent === "root"
    if (!toRoot) {
      out.push(op)
      continue
    }
    switch (op.op) {
      case "insert": {
        const node = isObj(op.node) ? op.node : {}
        out.push(node.page === undefined ? { ...op, node: { ...node, page: pageId } } : op)
        break
      }
      case "copy": {
        const set = isObj(op.set) ? op.set : {}
        out.push(set.page === undefined ? { ...op, set: { ...set, page: pageId } } : op)
        break
      }
      case "move":
        out.push(op, { op: "update", id: op.id, set: { page: pageId } })
        break
      case "instantiate": {
        // The instance's id is only known through its key: give it one when it has none.
        const key = typeof op.key === "string" ? op.key : `kimo_page_${++n}`
        out.push({ ...op, key }, { op: "update", id: `@${key}`, set: { page: pageId } })
        break
      }
      default:
        out.push(op)
    }
  }
  return out
}

/** Wraps a tool host so `kimo_apply_ops` calls default top-level nodes to `page()`. */
export function pageAwareToolHost(host: ToolHost, page: () => string | null): ToolHost {
  return {
    tools: () => host.tools(),
    call(call, signal) {
      const id = page()
      if (id && call.name === "kimo_apply_ops" && Array.isArray(call.input.ops))
        return host.call(
          { ...call, input: { ...call.input, ops: withPageDefaults(call.input.ops, id) } },
          signal,
        )
      return host.call(call, signal)
    },
  }
}
