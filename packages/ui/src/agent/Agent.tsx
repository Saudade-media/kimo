import { ArrowUp, ChevronDown, CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import {
  type ComponentPropsWithRef,
  type FormEvent,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
  useState,
} from "react"
import { AgentMark } from "../agent-mark/AgentMark"
import type { AgentMarkState } from "../agent-mark/faces"
import type { Persona } from "../agent-mark/persona"
import { cx } from "../internal/util"

// --- Message ------------------------------------------------------------------------------

/** Props for {@link Message}. Remaining `<div>` props go to the row frame. */
export interface MessageProps extends ComponentPropsWithRef<"div"> {
  from: "user" | "agent"
  /** Agent mark state: Working while streaming, Done once the turn completes (board 24 I3H68). */
  markState?: AgentMarkState
  /** Agent persona hue (split mode children). */
  persona?: Persona
  /** Streaming: a caret after the text (board 22 A "then I'll▍"). */
  streaming?: boolean
}

/**
 * Chat message (presentational).
 * `Message/User` (ROG0x): row justifyContent end; Bubble width 260, fill accent, radius-lg,
 * padding [10, 14]; text sans 13 on-accent, line height 1.45.
 * `Message/Agent` (QqwyN): row gap 10; Mark → AgentMark/24 (board 24 I3H68: LAyD7 Done /
 * whSu1 Working, replacing the gradient + sparkles mark); Bubble fill_container, bg-muted,
 * radius-lg, padding [10, 14]; text sans 13 text-primary, line height 1.5.
 */
export function Message({
  from,
  markState = "done",
  persona = "teal",
  streaming = false,
  className,
  children,
  ...rest
}: MessageProps) {
  return (
    <div
      {...rest}
      data-streaming={streaming || undefined}
      className={cx("kimo-message", `kimo-message--${from}`, className)}
    >
      {from === "agent" && (
        <AgentMark size={24} state={markState} persona={persona} className="kimo-message__mark" />
      )}
      <div className="kimo-message__bubble">
        <div className="kimo-message__text">
          {children}
          {streaming && <span className="kimo-message__caret" aria-hidden="true" />}
        </div>
      </div>
    </div>
  )
}

// --- AgentStep ----------------------------------------------------------------------------

/** Props for {@link AgentStep}. Remaining `<div>` props go to the frame. */
export interface AgentStepProps extends ComponentPropsWithRef<"div"> {
  /**
   * `done`: circle-check in success; `running`: spinning loader-circle in agent; `failed` (not
   * drawn on the board): circle-x in danger.
   */
  status: "done" | "running" | "failed"
}

/**
 * One agent tool step (presentational). Mirrors `AgentStep` (lNM1U) / `AgentStep/Running`
 * (jOrxb): fill_container, gap 8, padding-left 34, alignItems center; status icon 14; label
 * sans 12 text-secondary (running: 500 text-primary).
 */
export function AgentStep({ status, className, children, ...rest }: AgentStepProps) {
  return (
    <div
      {...rest}
      aria-busy={status === "running" || undefined}
      className={cx("kimo-agent-step", `kimo-agent-step--${status}`, className)}
    >
      <span className="kimo-agent-step__status" aria-hidden="true">
        {status === "running" ? (
          <LoaderCircle />
        ) : status === "failed" ? (
          <CircleX />
        ) : (
          <CircleCheck />
        )}
      </span>
      <span className="kimo-agent-step__label">{children}</span>
    </div>
  )
}

// --- Composer -----------------------------------------------------------------------------

/** Props for {@link Composer}. Remaining `<form>` props go to the frame. */
export interface ComposerProps extends Omit<ComponentPropsWithRef<"form">, "onSubmit"> {
  /** Controlled text. Omit for an uncontrolled composer. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Enter (without Shift) or the Send button. Uncontrolled composers clear afterwards. */
  onSend?: (text: string) => void
  placeholder?: string
  /** Context chip (the selected layer): label + 12px icon (lucide `frame`). */
  context?: { label: string; icon: ReactNode } | null
  /** Model picker label (`Claude Sonnet 5.5`). */
  model?: string
  onModelClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
}

/**
 * Agent prompt box (presentational + local text state). Mirrors `Composer` (JvIbi): width 340,
 * bg-app, radius-xl, 1px border-strong stroke, vertical, gap 10, padding [12, 12, 10, 16];
 * placeholder sans 13 text-tertiary; Bar (gap 6, center): Context Chip (bg-muted pill, gap 4,
 * padding [2, 8], icon 12 + label 11 / 500 text-secondary), Model (gap 4, padding [2, 6], label
 * 11 text-tertiary + chevron-down 12), spacer, Send 28 × 28 accent pill with arrow-up 16 on-accent.
 */
export function Composer({
  value,
  defaultValue = "",
  onValueChange,
  onSend,
  placeholder = "Ask Kimo to design or edit…",
  context,
  model,
  onModelClick,
  disabled = false,
  className,
  ...rest
}: ComposerProps) {
  const [inner, setInner] = useState(defaultValue)
  const text = value ?? inner
  const setText = (v: string) => {
    if (value === undefined) setInner(v)
    onValueChange?.(v)
  }
  const send = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend?.(t)
    if (value === undefined) setInner("")
  }

  return (
    <form
      {...rest}
      className={cx("kimo-composer", className)}
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        send()
      }}
    >
      <textarea
        className="kimo-composer__input"
        rows={1}
        aria-label="Message the agent"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="kimo-composer__bar">
        {context && (
          <span className="kimo-composer__chip">
            <span className="kimo-composer__chip-icon" aria-hidden="true">
              {context.icon}
            </span>
            <span className="kimo-composer__chip-label">{context.label}</span>
          </span>
        )}
        {model != null && (
          <button type="button" className="kimo-composer__model" onClick={onModelClick}>
            <span className="kimo-composer__model-label">{model}</span>
            <span className="kimo-composer__model-icon" aria-hidden="true">
              <ChevronDown />
            </span>
          </button>
        )}
        <span className="kimo-composer__spacer" aria-hidden="true" />
        <button
          type="submit"
          className="kimo-composer__send"
          aria-label="Send"
          disabled={disabled || text.trim() === ""}
        >
          <span className="kimo-composer__send-icon" aria-hidden="true">
            <ArrowUp />
          </span>
        </button>
      </div>
    </form>
  )
}
