import { t } from "@kimo/i18n"
import { ArrowUp, ChevronDown, Ellipsis, Paperclip, Square } from "lucide-react"
import {
  type ClipboardEventHandler,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"
import { AgentMark } from "../agent-mark/AgentMark"
import type { AgentMarkState } from "../agent-mark/faces"
import { type Persona, personaVar } from "../agent-mark/persona"
import { IconButton } from "../icon-button/IconButton"
import { cx, mergeRefs } from "../internal/util"

/**
 * Board 40 dot on the composer's "…" button: `warning` while auto-approve is on, otherwise
 * `secondary` while web access is off and could be on. Skills and blocked switches add no dot.
 */
export type ComposerMoreDot = "warning" | "secondary" | null

/** Board 40 rule "Dot": which dot the "…" button carries for the session's switches. */
export function composerMoreDot(s: {
  autoApprove: boolean
  /** Web access for this session (false while blocked). */
  webAccessOn: boolean
  /** Web access can't be turned on (No third-party fetch, or the model has no web tools). */
  webAccessBlocked: boolean
}): ComposerMoreDot {
  if (s.autoApprove) return "warning"
  if (!s.webAccessOn && !s.webAccessBlocked) return "secondary"
  return null
}

const MORE_LABEL: Record<"warning" | "secondary" | "none", string> = {
  warning: "More options (auto-approve is on)",
  secondary: "More options (web access is off)",
  none: "More options",
}

/** One run of the composer text: plain text, or an atomic chip that stands for `token`. */
export type ComposerPart =
  | { kind: "text"; text: string }
  | { kind: "chip"; token: string; label: string }

const CHIP_ATTR = "data-chip-token"

/** The string a DOM subtree stands for: its text, with each chip as its token. */
function serialize(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ""
  if (node instanceof HTMLElement) {
    const tok = node.getAttribute(CHIP_ATTR)
    if (tok != null) return tok
    if (node.tagName === "BR") return "\n"
  }
  let out = ""
  for (const c of Array.from(node.childNodes)) out += serialize(c)
  return out
}

function caretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.focusNode)) return null
  const r = document.createRange()
  r.selectNodeContents(root)
  r.setEnd(sel.focusNode as Node, sel.focusOffset)
  return serialize(r.cloneContents()).length
}

function placeCaret(root: HTMLElement, offset: number) {
  const r = document.createRange()
  let acc = 0
  let set = false
  const kids = Array.from(root.childNodes)
  for (let i = 0; i < kids.length && !set; i++) {
    const n = kids[i] as Node
    const len = serialize(n).length
    if (n.nodeType === 3 && offset <= acc + len) {
      r.setStart(n, offset - acc)
      set = true
    } else if (n.nodeType !== 3 && offset <= acc + len) {
      r.setStart(root, offset <= acc ? i : i + 1)
      set = true
    }
    acc += len
  }
  if (!set) r.setStart(root, kids.length)
  r.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(r)
}

function build(root: HTMLElement, parts: readonly ComposerPart[]) {
  root.replaceChildren(
    ...parts.map((p) => {
      if (p.kind === "text") return document.createTextNode(p.text)
      const chip = document.createElement("span")
      chip.className = "kimo-composer-agent__chip"
      chip.contentEditable = "false"
      chip.setAttribute(CHIP_ATTR, p.token)
      chip.textContent = p.label
      return chip
    }),
  )
}

/** Props for {@link ComposerAgent}. Remaining `<div>` props go to the frame. */
export interface ComposerAgentProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange" | "onSubmit"> {
  value: string
  /** `value` split into text and chips (default: all text). */
  parts?: readonly ComposerPart[]
  /** Text changed by typing; `cursor` is the caret offset in `value`. */
  onChange?: (value: string, cursor: number | null) => void
  /** The caret moved (offset in `value`). */
  onCursorChange?: (cursor: number) => void
  /** Move the caret here (and focus) when `value` changes from outside, e.g. after a chip insert. */
  caret?: number
  /** "Ask Kimo to design or edit…" / "Queue a follow-up for when this turn ends". */
  placeholder?: string
  /** Attachment chips / thumbs (row FLTbw). Omitted or empty: the row is not rendered. */
  attachments?: ReactNode
  onAttach?: () => void
  /** The ModeChip (SzC72). Its label shrinks first when the bar is short (board 40). */
  modeChip?: ReactNode
  /**
   * Board 40 "…" button after the mode chip: opens the menu that holds Skills, Auto-approve and
   * Web access. `open` while that menu (or the skills menu it leads to) is up; `dot` from
   * {@link composerMoreDot}. Omitted: not rendered.
   */
  more?: { open?: boolean; dot?: ComposerMoreDot; onClick?: () => void }
  /** Model chip (KnAC9): label, its mark state, persona tint (split), open state. */
  model?: {
    label: string
    markState?: AgentMarkState
    /**
     * Board 39 G: a 12 px provider mark before the name (terminal CLI, cloud API, hard-drive
     * Local), in place of the AgentMark. Omitted: the AgentMark.
     */
    mark?: ReactNode
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
  textareaRef?: Ref<HTMLDivElement>
  onTextareaKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  onTextareaPaste?: ClipboardEventHandler<HTMLDivElement>
  /** Model and "…" buttons' elements (menus treat them as their anchors). */
  modelRef?: Ref<HTMLButtonElement>
  moreRef?: Ref<HTMLButtonElement>
  disabled?: boolean
  onFocusChange?: (focused: boolean) => void
}

/**
 * The agent composer. Mirrors `Composer/Agent` (Bry8p): column fill_container, gap 10, padding
 * [12, 12, 10, 16], fill bg-app, stroke 1 border-strong, radius-xl › Attachments (FLTbw) row gap 6
 * center › Input (Jfb3E) sans 13 (placeholder text-tertiary) › Bar (board 40 zxfJw) row gap 4
 * center: Attach (n2MGl) 24 × 24 paperclip 14 text-secondary · Mode (k2blfg ModeChip) · More
 * (PPCXx) IconButton sm 24 ellipsis 14 + Dot 6 at (16, 2) · Spacer · Model (bI3Qx) gap 4 padding
 * [2, 6]: provider mark 12 or AgentMark/12 + Label sans 11 text-tertiary + chevron 12 · Send
 * (f4Gp1) 28 pill accent, arrow-up 16 on-accent (square 12 while streaming).
 */
export function ComposerAgent({
  value,
  parts,
  onChange,
  onCursorChange,
  caret,
  placeholder = t("ui.pkg.composer.agent.composeragent.ask-kimo-to-design-or-edit"),
  attachments,
  onAttach,
  modeChip,
  more,
  model,
  action = "send",
  sendDisabled = false,
  onSend,
  onStop,
  textareaRef,
  onTextareaKeyDown,
  onTextareaPaste,
  modelRef,
  moreRef,
  disabled = false,
  onFocusChange,
  className,
  ...rest
}: ComposerAgentProps) {
  const area = useRef<HTMLDivElement>(null)
  const synced = useRef<string | null>(null)
  const onCursor = useRef(onCursorChange)
  onCursor.current = onCursorChange
  // Render the text and chips; a value that didn't come from typing rebuilds the field.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `parts` is derived from `value`.
  useLayoutEffect(() => {
    const el = area.current
    if (!el || synced.current === value) return
    synced.current = value
    build(el, parts ?? [{ kind: "text", text: value }])
    if (caret != null) {
      el.focus()
      placeCaret(el, caret)
    }
  }, [value, caret])
  useEffect(() => {
    const on = () => {
      const el = area.current
      const at = el ? caretOffset(el) : null
      if (at != null) onCursor.current?.(at)
    }
    document.addEventListener("selectionchange", on)
    return () => document.removeEventListener("selectionchange", on)
  }, [])
  const hasAttachments =
    attachments != null && !(Array.isArray(attachments) && attachments.length === 0)
  const persona = model?.persona ?? "teal"
  return (
    <div
      {...rest}
      className={cx("kimo-composer-agent", disabled && "kimo-composer-agent--disabled", className)}
    >
      {hasAttachments && <div className="kimo-composer-agent__attachments">{attachments}</div>}
      {/* biome-ignore lint/a11y/useSemanticElements: a text box with inline chips needs contenteditable. */}
      <div
        ref={mergeRefs(area, textareaRef)}
        className="kimo-composer-agent__input"
        role="textbox"
        aria-multiline="true"
        tabIndex={disabled ? -1 : 0}
        contentEditable={disabled ? false : "plaintext-only"}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-empty={value === "" ? "true" : undefined}
        aria-label={t("ui.pkg.composer.agent.composeragent.message-the-agent")}
        aria-disabled={disabled || undefined}
        spellCheck
        onInput={(e) => {
          const next = serialize(e.currentTarget)
          synced.current = next
          onChange?.(next, caretOffset(e.currentTarget))
        }}
        onKeyDown={onTextareaKeyDown}
        onPaste={onTextareaPaste}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
      />
      <div className="kimo-composer-agent__bar">
        <button
          type="button"
          className="kimo-composer-agent__attach"
          aria-label={t("ui.pkg.composer.agent.composeragent.attach-image")}
          onClick={onAttach}
          disabled={disabled}
        >
          <Paperclip aria-hidden="true" />
        </button>
        {modeChip}
        {more && (
          <span className="kimo-composer-agent__more">
            <IconButton
              ref={moreRef}
              size="sm"
              tone="ghost"
              label={MORE_LABEL[more.dot ?? "none"]}
              title={t("ui.pkg.composer.agent.composeragent.more-options")}
              icon={<Ellipsis />}
              className={cx(
                "kimo-composer-agent__more-button",
                more.open && "kimo-composer-agent__more-button--open",
              )}
              aria-haspopup="menu"
              aria-expanded={!!more.open}
              data-testid="agent-more"
              onClick={more.onClick}
              disabled={disabled}
            />
            {more.dot && (
              <span
                className={`kimo-composer-agent__more-dot kimo-composer-agent__more-dot--${more.dot}`}
                data-testid="agent-more-dot"
                data-dot={more.dot}
                aria-hidden="true"
              />
            )}
          </span>
        )}
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
            title={model.label}
            onClick={model.onClick}
            disabled={model.disabled}
          >
            {model.mark != null ? (
              <span className="kimo-composer-agent__model-mark" aria-hidden="true">
                {model.mark}
              </span>
            ) : (
              <AgentMark size={12} state={model.markState ?? "idle"} persona={persona} />
            )}
            <span className="kimo-composer-agent__model-label">{model.label}</span>
            <ChevronDown className="kimo-composer-agent__model-chevron" aria-hidden="true" />
          </button>
        )}
        {action === "stop" ? (
          <button
            type="button"
            className="kimo-composer-agent__send kimo-composer-agent__send--stop"
            aria-label={t("ui.pkg.composer.agent.composeragent.stop")}
            onClick={onStop}
          >
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="kimo-composer-agent__send"
            aria-label={t("ui.pkg.composer.agent.composeragent.send")}
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
