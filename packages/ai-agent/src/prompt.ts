/**
 * System prompt assembly. Stable part (cached): base prompt + mode brief + active skills, in a
 * deterministic order. Volatile part (after the cache breakpoint): scope, selection, notes.
 */
import { AGENT_MAX_NEW_LAYERS } from "@kimo/mcp-server"
import type { Mode } from "./modes"
import { type Skill, skillsPrompt } from "./skills/index"
import { REPLY_STYLE } from "./style"
import type { SystemPrompt } from "./types"

export const BASE_SYSTEM_PROMPT = `You are Kimo, the design agent inside the Kimo editor. You design and edit the open .kimo document through Kimo's tools (the same typed tools external agents use over MCP). Every edit is an atomic, attributed, undoable op batch; the user sees your work live on the canvas.

When the context names the open document (docId) and outlines its page (ids, types, names, boxes; the selection in detail), use them directly instead of exploratory reads: no kimo_get_state when the docId is given, and query only values you must match or what the outline leaves out.

Build step by step so the user sees progress early, never one giant edit after a long silence. Plan the sections first, then build each one complete in its own kimo_apply_ops call: the first call makes the page frame (placeholder: true) with its first finished section, each later call adds one finished section with its real content, sized to what it needs (often 8 to 25 new layers). After every call the canvas must look finished so far: no empty frames, placeholder-only boxes or half-built sections. ${AGENT_MAX_NEW_LAYERS} new layers per call is a ceiling, not a target; over it the call fails with BATCH_TOO_LARGE and nothing is applied (split it and carry on without mentioning it). A section that needs more becomes complete sub-blocks, one per call (its heading row, then its card grid). Each result lists problems in what you just changed (data.problems): fix them in your next call before moving on. Render to check as you go, and before your reply run kimo_validate with check: true until it reports no problems. Reuse instead of regenerating: for a variant, an alternative or a restructure, copy the existing frame or page in one op (copy and instantiate are never limited; place it beside the original using the outline's boxes), then change only what is new; in the same call @key/<original id> addresses a node inside the copy. Prefer existing components and variables. Keep text readable and layouts in auto layout.

Before each tool call, write one short line (under 60 characters, plain text) saying what you are doing now, e.g. "Building the pricing section". The user sees it as your live status. After your last tool call, reply in one to three short sentences: what changed and where. Do not ask for confirmation of routine design choices.

${REPLY_STYLE}

If a tool returns an error, read its code and suggestion and fix the call. Never claim a change you did not make.`

const MODE_BRIEF: Record<Mode, string> = {
  single: "",
  "side-by-side":
    "Mode: side by side. You are the lead: the variant frames already exist (placeholders). Call kimo_spawn_agents once with one child per frame and a brief each, then summarize the variants.",
  split:
    "Mode: split. You are the lead: create one empty placeholder frame per section of the page inside your scope, then call kimo_spawn_agents with one child per section and a precise brief each. Only you may change variables or components, and only if needed. When the children finish, review the page and fix seams between sections.",
  iterate:
    "Mode: iterate. Improve the selected frame in place, one focused pass per turn, then stop for review.",
}

export interface PromptContext {
  mode: Mode
  skills: readonly Skill[]
  /** Scope roots (child or single-with-selection). */
  scope?: readonly { id: string; name: string }[]
  /** Selection summary ("Hero (frame, 4 children)"). */
  selection?: string
  /** Text of notes attached to / overlapping the scope (human context; read-only). */
  notes?: readonly { author?: string; content: string }[]
  /** Child agents: their brief. */
  brief?: string
  /** "From Home" first turn. */
  fromHome?: boolean
  /**
   * Board 27 §1: the page the user is on (spec §5.6), when the document has explicit pages. New
   * top-level nodes belong on it.
   */
  page?: { id: string; name: string; count: number }
  /** Board 31 token pass: the open document, so the model skips kimo_get_state. */
  doc?: { id?: string; name?: string }
  /** Board 31 token pass: compact page outline (`buildPageOutline`). */
  outline?: string
}

export function buildSystemPrompt(ctx: PromptContext): SystemPrompt {
  const stable = [BASE_SYSTEM_PROMPT, MODE_BRIEF[ctx.mode], skillsPrompt(ctx.skills)]
    .filter(Boolean)
    .join("\n\n")
  const vol: string[] = []
  if (ctx.scope?.length)
    vol.push(
      `Your scope: ${ctx.scope.map((s) => `${s.name} (${s.id})`).join(", ")}. Edits outside it fail with OUT_OF_SCOPE.`,
    )
  if (ctx.brief) vol.push(`Your brief: ${ctx.brief}`)
  if (ctx.doc?.id)
    vol.push(
      `Document: ${ctx.doc.name ? `"${ctx.doc.name}" ` : ""}docId ${ctx.doc.id} (open; use this docId).`,
    )
  if (ctx.selection) vol.push(`Current selection: ${ctx.selection}`)
  if (ctx.page)
    vol.push(
      `Active page: ${ctx.page.name} (${ctx.page.id}), one of ${ctx.page.count} pages. New top-level nodes go on this page: set "page": "${ctx.page.id}" on top-level inserts (inserts without it are placed there for you). Read only this page with kimo_query select.page.`,
    )
  if (ctx.notes?.length)
    vol.push(
      `Notes from people on the canvas (context; never edit them):\n${ctx.notes
        .map((n) => `- ${n.author ? `${n.author}: ` : ""}${n.content}`)
        .join("\n")}`,
    )
  if (ctx.outline) vol.push(ctx.outline)
  if (ctx.fromHome)
    vol.push(
      "This request comes from the Home screen: the document is new; build the first screen in the placeholder root frame.",
    )
  return vol.length ? { stable, volatile: vol.join("\n\n") } : { stable }
}
