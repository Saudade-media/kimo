import { Copy, LoaderCircle, RefreshCw } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link MessageMeta}. Remaining `<div>` props go to the row. */
export interface MessageMetaProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** "21.1k new tokens" (board 31 hover meta: fresh input + output). */
  tokens: string
  /** Tooltip of the tokens cell (the split: new input, output, cached input not counted). */
  tokensTitle?: string
  /** "$0.034", "subscription", "est. $0.03", "—". Omitted: hidden (Settings › show cost off). */
  cost?: string
  /** "11.2s". */
  duration?: string
  /** Copy the message text (hover action). */
  onCopy?: () => void
  /** Regenerate (last turn only). Omitted: no button. */
  onRegenerate?: () => void
  /** Streaming meta (board 22 A uZbJj): spinner + "Streaming" in agent, live tokens, no actions. */
  streaming?: boolean
  /**
   * Board 31 "Hover meta": `hover` keeps the row's space but shows it only while the pointer is
   * over the nearest `[data-meta-hover]` ancestor (the agent turn) or focus is inside it.
   */
  reveal?: "always" | "hover"
}

/**
 * Under every finished agent message. Mirrors `MessageMeta` (S0S1S): row fill_container, gap 8,
 * padding [0, 0, 0, 34], center › Tokens (T5Zhsf) · Cost (qJBnf) · Duration (ivzer) mono 11
 * text-tertiary › Spacer › Copy (LyyHd) copy 14 · Regenerate (UUOd4) refresh-cw 14 text-tertiary
 * (shown on hover). Streaming (uZbJj): Spinner loader-circle 12 agent · Label "Streaming" sans
 * 11 / 500 agent · Tokens mono 11 text-tertiary.
 */
export function MessageMeta({
  tokens,
  tokensTitle,
  cost,
  duration,
  onCopy,
  onRegenerate,
  streaming = false,
  reveal = "always",
  className,
  ...rest
}: MessageMetaProps) {
  if (streaming)
    return (
      <div {...rest} className={cx("kimo-msg-meta", "kimo-msg-meta--streaming", className)}>
        <LoaderCircle className="kimo-msg-meta__spinner" aria-hidden="true" />
        <span className="kimo-msg-meta__streaming">Streaming</span>
        <span className="kimo-msg-meta__text">{tokens}</span>
      </div>
    )
  return (
    <div
      {...rest}
      className={cx(
        "kimo-msg-meta",
        reveal === "hover" && "kimo-msg-meta--reveal-hover",
        className,
      )}
    >
      <span className="kimo-msg-meta__text" data-part="tokens" title={tokensTitle}>
        {tokens}
      </span>
      {cost != null && (
        <span className="kimo-msg-meta__text" data-part="cost">
          {cost}
        </span>
      )}
      {duration != null && (
        <span className="kimo-msg-meta__text" data-part="duration">
          {duration}
        </span>
      )}
      <span className="kimo-msg-meta__spacer" aria-hidden="true" />
      {onCopy && (
        <button type="button" className="kimo-msg-meta__action" aria-label="Copy" onClick={onCopy}>
          <Copy aria-hidden="true" />
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          className="kimo-msg-meta__action"
          aria-label="Regenerate"
          onClick={onRegenerate}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
