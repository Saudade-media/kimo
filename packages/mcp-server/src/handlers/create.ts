/** `createToolHandlers`: the 20 handlers plus per-call activity entries. */
import type { ActivityKind } from "../policy"
import type { DocumentHost, HandlerOutput, ToolHandler, ToolHandlers } from "../runtime"
import type { CoreDocumentHost } from "./core-host"
import { createToolHandlerMap, STREAM_ENGINE, type ToolHandlerOptions } from "./tools"

/** Activity kind for a successful call. */
function kindOf(tool: string, input: Record<string, unknown>): ActivityKind {
  switch (tool) {
    case "kimo_apply_ops":
    case "kimo_import":
      return input.dryRun === true ? "dry-run" : "edit"
    case "kimo_history":
      return input.action === "undo" ? "undo" : input.action === "redo" ? "redo" : "read"
    case "kimo_save":
      return "save"
    case "kimo_export":
      return "export"
    case "kimo_render":
      return "render"
    case "kimo_open":
    case "kimo_create":
      return "open"
    case "kimo_close":
      return "close"
    case "kimo_assets":
      return input.action === "import" ? "edit" : "read"
    case "kimo_styles":
      return input.apply === true ? "edit" : "read"
    default:
      return "read"
  }
}

/** Wraps a handler so every call outcome lands in the activity log (ADR 0013 §6). */
function withActivity(tool: string, h: ToolHandler): ToolHandler {
  return async (input, ctx): Promise<HandlerOutput> => {
    const out = await h(input, ctx)
    const r = out.result
    try {
      const base = {
        time: ctx.now(),
        origin: ctx.origin,
        actor: ctx.identity.label,
        tool,
        summary: r.summary,
      }
      const doc = r.ok ? r.doc : undefined
      const docHint = {
        docId: doc?.id ?? (typeof input.docId === "string" ? input.docId : undefined),
        path: doc?.path ?? (typeof input.path === "string" ? input.path : undefined),
      }
      if (r.ok) {
        const entry: Record<string, unknown> = { ...base, kind: kindOf(tool, input), ...docHint }
        if (
          r.revision &&
          (r.revision.before.seq !== r.revision.after.seq ||
            r.revision.before.epoch !== r.revision.after.epoch)
        )
          entry.revision = r.revision.after
        if (r.changed?.length) entry.nodeIds = r.changed.slice(0, 200)
        if (r.undoToken) entry.undoToken = r.undoToken
        if (r.revision && entry.revision) entry.revisionBefore = r.revision.before
        if (Array.isArray(r.ops) && (r.ops.length || out.label)) entry.opCount = r.ops.length
        if (out.label) entry.label = out.label
        ctx.recordActivity(entry as never)
      } else {
        ctx.recordActivity({
          ...base,
          kind: "error",
          code: r.errors[0]?.code ?? "INTERNAL",
          ...docHint,
        } as never)
      }
    } catch {
      // Activity is best effort.
    }
    return out
  }
}

/** All 20 handlers over `host`. */
export function createToolHandlers(
  host: DocumentHost,
  options: ToolHandlerOptions = {},
): ToolHandlers {
  const map = createToolHandlerMap((host as Partial<CoreDocumentHost>).scene, options)
  const out = {} as Record<string, ToolHandler>
  for (const [name, h] of Object.entries(map))
    out[name] = withActivity(name, h)
    // Streamed edits (ADR 0013 §4.7) reach the engine through the handler set.
  ;(out as { [STREAM_ENGINE]?: unknown })[STREAM_ENGINE] = map[STREAM_ENGINE as never]
  return out as ToolHandlers
}
