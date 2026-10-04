import { ArrowUp, BookOpen, ChevronDown, Paperclip, Square } from "lucide-react"
import {
  type ClipboardEventHandler,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
} from "react"
import { AgentMark } from "../agent-mark/AgentMark"
import type { AgentMarkState } from "../agent-mark/faces"
import { type Persona, personaVar } from "../agent-mark/persona"
import { cx, mergeRefs } from "../internal/util"

/** Props for {@link ComposerAgent}. Remaining `<div>` props go to the frame. */
export interface ComposerAgentProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange" | "onSubmit"> {
  value: string
  onChange?: (value: string) => void
  /** "Ask Kimo to design or edit…" / "Queue a follow-up — sent when this turn ends". */
  placeholder?: string
  /** Attachment chips / thumbs (row FLTbw). Omitted or empty: the row is not rendered. */
  attachments?: ReactNode
  onAttach?: () => void
  /** Enabled skills count (Skills X2Uuj). */
  skillsCount?: number
  /** The "/" menu is open: Skills fill bg-muted, icon + count text-primary (gVw5S oCUeL). */
  skillsOpen?: boolean
  onSkills?: () => void
  /** The ModeChip (SzC72). */
  modeChip?: ReactNode
  /** Model chip (KnAC9): label, its mark state, persona tint (split), open state. */
  model?: {
    label: string
    markState?: AgentMarkState
    persona?: Persona
    open?: boolean
    onClick?: () => void
    disabled?: boolean
  }
  /** `send` (arrow-up) or `stop` (square 12, while streaming). */
  action?: "send" | "stop"
  sendDisabled?: boolean
  onSend?: () => void
  onStop?: () => void
  textareaRef?: Ref<HTMLTextAreaElement>
  onTextareaKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onTextareaPaste?: ClipboardEventHandler<HTMLTextAreaElement>
  /** Model / Mode / Skills / Attach buttons' anchor elements (menus position under them). */
  modelRef?: Ref<HTMLButtonElement>
  skillsRef?: Ref<HTMLButtonElement>
  disabled?: boolean
  onFocusChange?: (focused: boolean) => void
}

/**
 * The agent composer. Mirrors `Composer/Agent` (Bry8p): column fill_container, gap 10, padding
 * [12, 12, 10, 16], fill bg-app, stroke 1 border-strong, radius-xl › Attachments (FLTbw) row gap 6
 * center › Input (Jfb3E) sans 13 (placeholder text-tertiary) › Bar (IYc3u) row gap 4 center:
 * Attach (x4agy) 24 × 24 paperclip 14 text-secondary · Skills (X2Uuj) h 24 gap 4 padding [0, 6]
 * book-open 14 + Count mono 11 text-secondary · Mode (SzC72 ModeChip) · Spacer · Model (KnAC9)
 * gap 4 padding [2, 6]: AgentMark/12 (board 24 P9Dzzb) + Label sans 11 text-tertiary + chevron 12
 * · Send (fh2Ry) 28 pill accent, arrow-up 16 on-accent (square 12 while streaming).
 */
export function ComposerAgent({
  value,
  onChange,
  placeholder = "Ask Kimo to design or edit…",
  attachments,
  onAttach,
  skillsCount = 0,
  skillsOpen = false,
  onSkills,
  modeChip,
  model,
  action = "send",
  sendDisabled = false,
  onSend,
  onStop,
  textareaRef,
  onTextareaKeyDown,
  onTextareaPaste,
  modelRef,
  skillsRef,
  disabled = false,
  onFocusChange,
  className,
  ...rest
}: ComposerAgentProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  // Auto-grow up to 8 lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 8 * 16)}px`
  }, [value])
  const hasAttachments =
    attachments != null && !(Array.isArray(attachments) && attachments.length === 0)
  const persona = model?.persona ?? "teal"
  return (
    <div
      {...rest}
      className={cx("kimo-composer-agent", disabled && "kimo-composer-agent--disabled", className)}
    >
      {hasAttachments && <div className="kimo-composer-agent__attachments">{attachments}</div>}
      <textarea
        ref={mergeRefs(area, textareaRef)}
        className="kimo-composer-agent__input"
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label="Message the agent"
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onTextareaKeyDown}
        onPaste={onTextareaPaste}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
      />
      <div className="kimo-composer-agent__bar">
        <button
          type="button"
          className="kimo-composer-agent__attach"
          aria-label="Attach image"
          onClick={onAttach}
          disabled={disabled}
        >
          <Paperclip aria-hidden="true" />
        </button>
        <button
          ref={skillsRef}
          type="button"
          className={cx(
            "kimo-composer-agent__skills",
            skillsOpen && "kimo-composer-agent__skills--open",
          )}
          aria-label={`Skills (${skillsCount} enabled)`}
          aria-haspopup="menu"
          aria-expanded={skillsOpen}
          onClick={onSkills}
          disabled={disabled}
        >
          <BookOpen aria-hidden="true" />
          <span className="kimo-composer-agent__skills-count">{skillsCount}</span>
        </button>
        {modeChip}
        <span className="kimo-composer-agent__spacer" aria-hidden="true" />
        {model && (
          <button
            ref={modelRef}
            type="button"
            className={cx(
              "kimo-composer-agent__model",
              model.open && "kimo-composer-agent__model--open",
              persona !== "teal" && "kimo-composer-agent__model--persona",
            )}
            style={
              persona !== "teal"
                ? ({
                    "--kimo-model-tint": personaVar(persona),
                    "--kimo-model-soft": personaVar(persona, "soft"),
                  } as CSSProperties)
                : undefined
            }
            aria-haspopup="menu"
            aria-expanded={model.open}
            aria-label={`Model: ${model.label}`}
            onClick={model.onClick}
            disabled={model.disabled}
          >
            <AgentMark size={12} state={model.markState ?? "idle"} persona={persona} />
            <span className="kimo-composer-agent__model-label">{model.label}</span>
            <ChevronDown className="kimo-composer-agent__model-chevron" aria-hidden="true" />
          </button>
        )}
        {action === "stop" ? (
          <button
            type="button"
            className="kimo-composer-agent__send kimo-composer-agent__send--stop"
            aria-label="Stop"
            onClick={onStop}
          >
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="kimo-composer-agent__send"
            aria-label="Send"
            disabled={sendDisabled || disabled}
            onClick={onSend}
          >
            <ArrowUp aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
