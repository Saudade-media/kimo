/**
 * Board 51 §3 pickers: MentionPicker (w240, pad 4, gap 1; rows h32 pad [0,8] gap 8) and
 * EmojiPicker (w240, pad 8, gap 8; Search h30, "Frequently used", rows of 5 at 20px).
 */
import { Input } from "@kimo/ui"
import { useMemo, useState } from "react"
import { t } from "../lib/i18n"
import { Icon } from "../lib/icons"
import { authorColor, initials } from "./model"

export interface MentionCandidate {
  id: string
  name: string
  kind: "person" | "agent"
  sub: "file" | "commented" | "agent"
}

const SUB_KEY = {
  file: "comments.mention.file",
  commented: "comments.mention.commented",
  agent: "comments.mention.agent",
} as const

export function Avatar({
  id,
  name,
  kind,
  size,
}: {
  id: string
  name: string
  kind: "person" | "agent"
  size: 20 | 24 | 26
}) {
  const icon = size === 20 ? 11 : 14
  return (
    <span
      className={`comment-avatar comment-avatar--${size}${kind === "agent" ? " comment-avatar--agent" : ""}`}
      style={kind === "agent" ? undefined : { background: `var(--kimo-${authorColor(id)})` }}
      aria-hidden="true"
    >
      {kind === "agent" ? <Icon name="sparkles" size={icon} /> : initials(name)}
    </span>
  )
}

export function MentionPicker({
  items,
  active,
  onPick,
  onHover,
}: {
  items: readonly MentionCandidate[]
  active: number
  onPick(c: MentionCandidate): void
  onHover(i: number): void
}) {
  if (!items.length) return null
  return (
    <div
      className="comment-popover comment-mentions"
      role="listbox"
      aria-label={t("comments.mention")}
    >
      {items.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={i === active}
          className={i === active ? "comment-mentions__row is-active" : "comment-mentions__row"}
          onPointerDown={(e) => e.preventDefault()}
          onPointerEnter={() => onHover(i)}
          onClick={() => onPick(c)}
        >
          <Avatar id={c.id} name={c.name} kind={c.kind} size={20} />
          <span className="comment-mentions__name">{c.name}</span>
          <span className="comment-mentions__sub">{t(SUB_KEY[c.sub])}</span>
        </button>
      ))}
    </div>
  )
}

/** Board 51 EmojiPicker rows (frequently used), then the searchable set. */
export const FREQUENT_EMOJI = ["👍", "❤️", "🎉", "👀", "✅", "😂", "🙏", "💯", "✨", "🤔"] as const

const NAMED: readonly [string, string][] = [
  ["👍", "thumbs up yes ok"],
  ["❤️", "heart love"],
  ["🎉", "party tada celebrate"],
  ["👀", "eyes look"],
  ["✅", "check done"],
  ["😂", "joy laugh"],
  ["🙏", "thanks please pray"],
  ["💯", "hundred perfect"],
  ["✨", "sparkles"],
  ["🤔", "thinking hmm"],
  ["👎", "thumbs down no"],
  ["🔥", "fire hot"],
  ["🚀", "rocket ship launch"],
  ["😍", "heart eyes"],
  ["😊", "smile happy"],
  ["😅", "sweat smile"],
  ["😮", "wow surprised"],
  ["😢", "sad cry"],
  ["😬", "grimace yikes"],
  ["🙌", "raised hands yay"],
  ["👏", "clap applause"],
  ["💪", "strong muscle"],
  ["👌", "ok perfect"],
  ["🤝", "handshake deal"],
  ["💡", "idea bulb"],
  ["⚠️", "warning"],
  ["❌", "cross no wrong"],
  ["❓", "question"],
  ["📌", "pin"],
  ["🎨", "art palette design"],
]

export function EmojiPicker({ onPick }: { onPick(emoji: string): void }) {
  const [q, setQ] = useState("")
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? NAMED.filter(([, names]) => names.includes(s)).map(([e]) => e) : null
  }, [q])
  const rows = (list: readonly string[]) => {
    const out: string[][] = []
    for (let i = 0; i < list.length; i += 5) out.push(list.slice(i, i + 5))
    return out
  }
  return (
    <div className="comment-popover comment-emoji">
      <Input
        className="comment-emoji__search"
        icon={<Icon name="search" size={16} />}
        placeholder={t("comments.emoji.search")}
        value={q}
        autoFocus
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      {!found && <span className="comment-emoji__label">{t("comments.emoji.frequent")}</span>}
      {rows(found ?? FREQUENT_EMOJI).map((row) => (
        <div key={row.join("")} className="comment-emoji__row">
          {row.map((e) => (
            <button
              key={e}
              type="button"
              className="comment-emoji__item"
              onPointerDown={(ev) => ev.preventDefault()}
              onClick={() => onPick(e)}
            >
              {e}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
