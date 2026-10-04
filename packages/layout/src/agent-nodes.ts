/**
 * Note and prompt node chrome (desing.pen board 22 "Note & prompt nodes" cf2sC; NoteNode
 * `afq5v`, PromptNode `poE5B`; format §5.5, ADR 0014 §9). Both are document nodes whose body is
 * their `content` text, wrapped inside fixed card chrome. Layout (box size) and the renderer
 * (card drawing) read the same geometry from here so measure and draw agree.
 *
 * Sizing (spec §5.5: `w`, `h` absent = fit content): an absent `w` is the design width (note
 * 220, prompt 300) and the body wraps inside it; an absent `h` fits the chrome plus the wrapped
 * body. `w: {mode:"fit"}` sizes to the unwrapped body plus the chrome.
 */
import { type ResolvedTextStyle, TEXT_STYLE_DEFAULTS } from "./types"

export type AgentNodeType = "note" | "prompt"

export interface AgentNodeChrome {
  /** Design width used when `w` is absent (NoteNode 220, PromptNode 300). */
  defaultWidth: number
  /** Body text box inset from the card edges, `[top, right, bottom, left]`. */
  body: readonly [number, number, number, number]
  /** Body text style defaults (the node's `style` applies on top). */
  text: ResolvedTextStyle
}

/**
 * NoteNode `afq5v`: padding [12, 14, 14, 14], gap 8, Head `jGQuc` 13 tall (icon 12 + Author
 * 11/500), Body `utO8L` at y 33 = 12 + 13 + 8: Inter 12 (`text-sm`), line height 1.45.
 */
export const NOTE_CHROME = {
  defaultWidth: 220,
  padding: [12, 14, 14, 14] as const,
  gap: 8,
  headHeight: 13,
  iconSize: 12,
  /** Head gap between icon and author (`jGQuc` gap 6). */
  headGap: 6,
  /** Author label: `text-xs` 11 / 500. */
  labelSize: 11,
  labelWeight: 500,
  radius: 4,
  strokeWidth: 1,
  /** `effect` shadow 0 / 2 / blur 6 `$shadow`. */
  shadow: { x: 0, y: 2, blur: 6 },
  bodySize: 12,
  bodyLineHeight: 1.45,
} as const

/**
 * PromptNode `poE5B` (300 wide, clip, radius 16, stroke 1 `border-strong`, shadow 0/2/8):
 * Head `QD66N` 38 tall (padding [8, 8, 8, 12], gap 6, bottom border 1 `border`): sparkles 12
 * `agent`, Kind "Prompt" 11/600 `agent`, spacer, Model pill `ZlYtg` (22 tall, `bg-muted`,
 * pill radius, padding [0, 6, 0, 8], gap 4, label 11/500 `text-secondary`, chevron-down 12
 * `text-tertiary`). Body `sEIbQ` padding [10, 12]: Prompt text 12 line height 1.5
 * `text-primary`. Footer `pFCri` 42 tall (padding [8, 8, 8, 12], `bg-subtle`, top border 1
 * `border`): status + Run (DOM overlay, run state is app data).
 */
export const PROMPT_CHROME = {
  defaultWidth: 300,
  headHeight: 38,
  headPadding: [8, 8, 8, 12] as const,
  headGap: 6,
  iconSize: 12,
  labelSize: 11,
  kindWeight: 600,
  model: { height: 22, padding: [0, 6, 0, 8] as const, gap: 4, chevron: 12, weight: 500 },
  bodyPadding: [10, 12] as const,
  footerHeight: 42,
  footerPadding: [8, 8, 8, 12] as const,
  radius: 16,
  strokeWidth: 1,
  /** Running (board 22 `VFi4q`): stroke 1.5 `agent`. */
  runningStrokeWidth: 1.5,
  shadow: { x: 0, y: 2, blur: 8 },
  bodySize: 12,
  bodyLineHeight: 1.5,
  /** Footer Run pill `O8jlu`: 26 tall, 8 from the right, padding [0, 10, 0, 8], gap 4. */
  run: { height: 26, padding: [0, 10, 0, 8] as const, gap: 4 },
} as const

const textStyle = (size: number, lineHeight: number): ResolvedTextStyle => ({
  ...TEXT_STYLE_DEFAULTS,
  fontSize: size,
  lineHeight: { multiplier: lineHeight },
})

const CHROME: Record<AgentNodeType, AgentNodeChrome> = {
  note: {
    defaultWidth: NOTE_CHROME.defaultWidth,
    body: [
      NOTE_CHROME.padding[0] + NOTE_CHROME.headHeight + NOTE_CHROME.gap,
      NOTE_CHROME.padding[1],
      NOTE_CHROME.padding[2],
      NOTE_CHROME.padding[3],
    ],
    text: textStyle(NOTE_CHROME.bodySize, NOTE_CHROME.bodyLineHeight),
  },
  prompt: {
    defaultWidth: PROMPT_CHROME.defaultWidth,
    body: [
      PROMPT_CHROME.headHeight + PROMPT_CHROME.bodyPadding[0],
      PROMPT_CHROME.bodyPadding[1],
      PROMPT_CHROME.bodyPadding[0] + PROMPT_CHROME.footerHeight,
      PROMPT_CHROME.bodyPadding[1],
    ],
    text: textStyle(PROMPT_CHROME.bodySize, PROMPT_CHROME.bodyLineHeight),
  },
}

/** Chrome of a note/prompt node type, or null for any other type. */
export function agentNodeChrome(type: unknown): AgentNodeChrome | null {
  return type === "note" || type === "prompt" ? CHROME[type] : null
}

/** The body text box of a note/prompt card of size `w`×`h` (card-local coordinates). */
export function agentNodeBodyBox(
  type: AgentNodeType,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const [t, r, b, l] = CHROME[type].body
  return { x: l, y: t, w: Math.max(0, w - l - r), h: Math.max(0, h - t - b) }
}
