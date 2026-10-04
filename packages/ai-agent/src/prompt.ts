/**
 * System prompt assembly. Stable part (cached): base prompt + mode brief + active skills, in a
 * deterministic order. Volatile part (after the cache breakpoint): scope, selection, notes.
 */
import type { Mode } from "./modes"
import { type Skill, skillsPrompt } from "./skills/index"
import type { SystemPrompt } from "./types"

export const BASE_SYSTEM_PROMPT = `You are Kimo, the design agent inside the Kimo editor. You design and edit the open .kimo document through Kimo's tools (the same typed tools external agents use over MCP). Every edit is an atomic, attributed, undoable op batch; the user sees your work live on the canvas.

Work in short loops: read what you need, apply one coherent batch, render to check, refine. Prefer existing components and variables. Keep text readable and layouts in auto layout. When the request is done, stop and summarize the change in one or two sentences; do not ask for confirmation of routine design choices.

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
  if (ctx.fromHome)
    vol.push(
      "This request comes from the Home screen: the document is new; build the first screen in the placeholder root frame.",
    )
  return vol.length ? { stable, volatile: vol.join("\n\n") } : { stable }
}
