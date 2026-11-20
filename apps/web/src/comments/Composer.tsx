/**
 * Board 51 §3 CommentComposer (w300) and the thread's Reply row: a plain-text field with the
 * Markdown subset of docs/spec/comments.md §3. `@` opens the MentionPicker; a picked person shows
 * as "@Name" in selection blue and is sent as `@[Name](id)`.
 */
import { Button, Menu, MenuItem } from "@kimo/ui"
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { t } from "../lib/i18n"
import { Icon } from "../lib/icons"
import { Float } from "./Float"
import { EmojiPicker, type MentionCandidate, MentionPicker } from "./pickers"
import { mentionToken } from "./text"

export interface ComposerProps {
  variant: "new" | "reply" | "edit"
  initial?: string
  candidates: readonly MentionCandidate[]
  onSend(text: string): void
  onCancel?(): void
  autoFocus?: boolean
  disabled?: boolean
  /** Board 51 §3 E: image attachments (absent: the Attach tool is not shown). */
  attachments?: ReactNode
  onAttach?(): void
  onPasteFiles?(files: File[]): void
}

interface Picked {
  name: string
  id: string
}

/** Turns "@Name" for picked mentions into tokens (longest names first). */
export function withMentionTokens(text: string, picked: readonly Picked[]): string {
  let out = text
  const list = [...picked].sort((a, b) => b.name.length - a.name.length)
  for (const p of list) out = out.split(`@${p.name}`).join(mentionToken(p.name, p.id))
  return out
}

/** "@[Name](id)" back to "@Name" for editing, with the picks it held. */
function fromTokens(text: string): { text: string; picked: Picked[] } {
  const picked: Picked[] = []
  const plain = text.replace(
    /@\[([^\]\n]{1,64})\]\(((?:acct|dev|agent):[^\s)]{1,128})\)/g,
    (_, name: string, id: string) => {
      picked.push({ name, id })
      return `@${name}`
    },
  )
  return { text: plain, picked }
}

/** The "@query" the caret is in, or null. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]{0,32})$/.exec(before)
  if (!m) return null
  return { start: caret - (m[2] as string).length - 1, query: (m[2] as string).toLowerCase() }
}

const WRAP: Record<string, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~", "~"],
}

export function Composer(p: ComposerProps) {
  const start = useMemo(() => fromTokens(p.initial ?? ""), [p.initial])
  const [text, setText] = useState(start.text)
  const [picked, setPicked] = useState<Picked[]>(start.picked)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [pop, setPop] = useState<"emoji" | "format" | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [fieldBox, setFieldBox] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!p.autoFocus) return
    const el = field.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [p.autoFocus])

  // The field grows with its text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const mq = dismissed === caret ? null : mentionQuery(text, caret)
  const matches = mq
    ? p.candidates.filter((c) => c.name.toLowerCase().includes(mq.query)).slice(0, 6)
    : []
  const empty = text.trim() === ""

  const replace = (from: number, to: number, insert: string, select?: [number, number]) => {
    const next = text.slice(0, from) + insert + text.slice(to)
    setText(next)
    const [a, b] = select ?? [from + insert.length, from + insert.length]
    requestAnimationFrame(() => {
      const el = field.current
      if (!el) return
      el.focus()
      el.setSelectionRange(a, b)
      setCaret(b)
    })
  }

  const pick = (c: MentionCandidate) => {
    if (!mq) return
    replace(mq.start, caret, `@${c.name} `)
    setPicked((list) =>
      list.some((x) => x.id === c.id) ? list : [...list, { name: c.name, id: c.id }],
    )
    setActive(0)
  }

  const wrap = (kind: keyof typeof WRAP | "link" | "bullet" | "number") => {
    const el = field.current
    const a = el?.selectionStart ?? text.length
    const b = el?.selectionEnd ?? a
    const sel = text.slice(a, b)
    if (kind === "link") {
      const label = sel || "link"
      const ins = `[${label}](https://)`
      replace(a, b, ins, [a + label.length + 3, a + ins.length - 1])
      return
    }
    if (kind === "bullet" || kind === "number") {
      const lineStart = text.lastIndexOf("\n", a - 1) + 1
      const mark = kind === "bullet" ? "- " : "1. "
      replace(lineStart, lineStart, mark)
      return
    }
    const [l, r] = WRAP[kind] as [string, string]
    replace(a, b, l + sel + r, [a + l.length, a + l.length + sel.length])
  }

  const send = () => {
    if (empty || p.disabled) return
    p.onSend(withMentionTokens(text.trim(), picked))
    setText("")
    setPicked([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const n = matches.length
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        pick(matches[Math.min(active, matches.length - 1)] as MentionCandidate)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setDismissed(caret)
        return
      }
    }
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const format: Parameters<typeof wrap>[0] | null = !mod
      ? null
      : !e.shiftKey && k === "b"
        ? "bold"
        : !e.shiftKey && k === "i"
          ? "italic"
          : e.shiftKey && k === "x"
            ? "strike"
            : !e.shiftKey && k === "k"
              ? "link"
              : e.shiftKey && e.code === "Digit8"
                ? "bullet"
                : e.shiftKey && e.code === "Digit7"
                  ? "number"
                  : null
    if (format) {
      e.preventDefault()
      wrap(format)
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
      return
    }
    if (e.key === "Enter" && e.shiftKey) {
      // A new line continues a list.
      const a = field.current?.selectionStart ?? text.length
      const line = text.slice(text.lastIndexOf("\n", a - 1) + 1, a)
      const bullet = /^- /.test(line)
      const num = /^(\d{1,4})\. /.exec(line)
      if (bullet || num) {
        e.preventDefault()
        replace(
          a,
          field.current?.selectionEnd ?? a,
          `\n${bullet ? "- " : `${Number(num?.[1]) + 1}. `}`,
        )
      }
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      if (pop) setPop(null)
      else p.onCancel?.()
    }
  }

  const fieldEl = (
    <div className="comment-field" ref={setFieldBox}>
      <Mirror text={text} picked={picked} />
      <textarea
        ref={field}
        className="comment-field__input"
        rows={1}
        value={text}
        disabled={p.disabled}
        placeholder={
          p.variant === "new"
            ? t("comments.placeholder")
            : p.variant === "reply"
              ? t("comments.reply")
              : ""
        }
        aria-label={p.variant === "reply" ? t("comments.reply") : t("comments.placeholder")}
        onChange={(e) => {
          setText(e.currentTarget.value)
          setCaret(e.currentTarget.selectionStart)
          setDismissed(null)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length && p.onPasteFiles) {
            e.preventDefault()
            p.onPasteFiles(files)
          }
        }}
      />
      {matches.length > 0 && (
        <Float anchor={fieldBox} className="comment-float--mentions">
          <MentionPicker
            items={matches}
            active={Math.min(active, matches.length - 1)}
            onPick={pick}
            onHover={setActive}
          />
        </Float>
      )}
    </div>
  )

  const sendBtn = (
    <button
      type="button"
      className={empty ? "comment-send" : "comment-send is-ready"}
      aria-label={t("comments.send")}
      disabled={empty || p.disabled}
      onPointerDown={(e) => e.preventDefault()}
      onClick={send}
    >
      <Icon name="arrow-up" size={16} />
    </button>
  )

  if (p.variant === "edit")
    return (
      <div className="comment-edit">
        {fieldEl}
        <div className="comment-edit__actions">
          <Button size="sm" className="comment-edit__btn" onClick={() => p.onCancel?.()}>
            {t("comments.cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            className="comment-edit__btn"
            disabled={empty}
            onClick={send}
          >
            {t("comments.save")}
          </Button>
        </div>
      </div>
    )

  if (p.variant === "reply")
    return (
      <div className="comment-reply">
        <div className="comment-reply__body">
          {p.attachments}
          {fieldEl}
        </div>
        {sendBtn}
      </div>
    )

  return (
    <div className="comment-composer" ref={setBox}>
      <div className="comment-composer__field">
        {fieldEl}
        {p.attachments}
      </div>
      <div className="comment-composer__toolbar">
        <div className="comment-composer__tools">
          <Tool
            icon="smile"
            label={t("comments.emoji")}
            onClick={() => setPop(pop === "emoji" ? null : "emoji")}
          />
          <Tool
            icon="at-sign"
            label={t("comments.mention")}
            onClick={() => {
              const el = field.current
              const a = el?.selectionStart ?? text.length
              const pre = a > 0 && !/\s/.test(text[a - 1] ?? "") ? " @" : "@"
              replace(a, el?.selectionEnd ?? a, pre)
            }}
          />
          {p.onAttach && <Tool icon="image" label={t("comments.image")} onClick={p.onAttach} />}
          <Tool
            icon="type"
            label={t("comments.format")}
            onClick={() => setPop(pop === "format" ? null : "format")}
          />
        </div>
        {sendBtn}
      </div>
      {pop === "emoji" && (
        <Float anchor={box} onDismiss={() => setPop(null)}>
          <EmojiPicker
            onPick={(e) => {
              const el = field.current
              const a = el?.selectionStart ?? text.length
              replace(a, el?.selectionEnd ?? a, e)
              setPop(null)
            }}
          />
        </Float>
      )}
      {pop === "format" && (
        <Float anchor={box} onDismiss={() => setPop(null)}>
          <Menu
            className="comment-menu"
            label={t("comments.format")}
            autoFocus
            onClose={() => setPop(null)}
          >
            <MenuItem shortcut="⌘B" onSelect={() => wrap("bold")}>
              {t("comments.format.bold")}
            </MenuItem>
            <MenuItem shortcut="⌘I" onSelect={() => wrap("italic")}>
              {t("comments.format.italic")}
            </MenuItem>
            <MenuItem shortcut="⌘⇧X" onSelect={() => wrap("strike")}>
              {t("comments.format.strike")}
            </MenuItem>
            <MenuItem shortcut="⌘K" onSelect={() => wrap("link")}>
              {t("comments.format.link")}
            </MenuItem>
            <MenuItem shortcut="⌘⇧8" onSelect={() => wrap("bullet")}>
              {t("comments.format.bullets")}
            </MenuItem>
            <MenuItem shortcut="⌘⇧7" onSelect={() => wrap("number")}>
              {t("comments.format.numbers")}
            </MenuItem>
          </Menu>
        </Float>
      )}
    </div>
  )
}

function Tool({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      className="comment-tool"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  )
}

/** Mirrors the field's text behind it, with picked mentions in selection blue. */
function Mirror({ text, picked }: { text: string; picked: readonly Picked[] }) {
  const parts: ReactNode[] = []
  const names = [...new Set(picked.map((x) => x.name))].sort((a, b) => b.length - a.length)
  if (!names.length) parts.push(text)
  else {
    const esc = names.map((n) => `@${n}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const re = new RegExp(`(${esc.join("|")})`, "g")
    const split = text.split(re)
    for (let i = 0; i < split.length; i++) {
      const s = split[i] as string
      parts.push(
        i % 2 === 1 ? (
          <span key={i} className="comment-mention">
            {s}
          </span>
        ) : (
          s
        ),
      )
    }
  }
  // A trailing newline needs a character to take its height.
  return (
    <div className="comment-field__mirror" aria-hidden="true">
      {parts}{" "}
    </div>
  )
}
