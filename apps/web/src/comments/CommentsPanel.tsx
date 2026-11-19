/**
 * Board 51 §5 Comments panel: replaces the Right Card's tabs while comment mode is on. Panel
 * Head (title, Filter, Close), Search, then the thread list (CommentRow), newest first.
 */
import { EmptyState, IconButton, Input, Menu, MenuDivider, MenuItem } from "@kimo/ui"
import { useEffect, useState } from "react"
import { t, tn } from "../lib/i18n"
import { Icon } from "../lib/icons"
import { shortTime } from "./CommentLayer"
import type { CommentPrefs, ThreadRow } from "./model"
import { Avatar } from "./pickers"
import { plainText } from "./text"

export interface CommentsPanelProps {
  rows: readonly ThreadRow[]
  prefs: CommentPrefs
  setPrefs(p: CommentPrefs): void
  query: string
  setQuery(q: string): void
  openId: string | null
  onOpen(row: ThreadRow): void
  onClose(): void
  onMarkAll(): void
  pageName(page: string | null): string | null
  multiPage: boolean
}

export function CommentsPanel(p: CommentsPanelProps) {
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (
        !(e.target as Element | null)?.closest?.(".comments-panel__menu, .comments-panel__filter")
      )
        setMenu(false)
    }
    window.addEventListener("pointerdown", close, true)
    return () => window.removeEventListener("pointerdown", close, true)
  }, [menu])
  const set = (patch: Partial<CommentPrefs>) => p.setPrefs({ ...p.prefs, ...patch })
  const check = (on: boolean) =>
    on ? (
      <Icon name="check" size={14} />
    ) : (
      <span className="comment-menu__blank" aria-hidden="true" />
    )
  return (
    <div className="comments-panel">
      <div className="comments-panel__head">
        <span className="comments-panel__title">{t("comments.panel")}</span>
        <div className="comments-panel__actions">
          <IconButton
            tone="ghost"
            className="comments-panel__filter"
            label={t("comments.filter")}
            icon={<Icon name="list-filter" size={16} />}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          />
          <IconButton
            tone="ghost"
            label={t("comments.close")}
            icon={<Icon name="x" size={16} />}
            onClick={p.onClose}
          />
        </div>
        {menu && (
          <Menu
            className="comment-menu comments-panel__menu"
            label={t("comments.filter")}
            autoFocus
            onClose={() => setMenu(false)}
          >
            <MenuItem icon={check(p.prefs.sort === "date")} onSelect={() => set({ sort: "date" })}>
              {t("comments.sortDate")}
            </MenuItem>
            <MenuItem
              icon={check(p.prefs.sort === "unread")}
              onSelect={() => set({ sort: "unread" })}
            >
              {t("comments.sortUnread")}
            </MenuItem>
            <MenuDivider />
            <MenuItem
              icon={check(p.prefs.scope === "page")}
              onSelect={() => set({ scope: "page" })}
            >
              {t("comments.thisPage")}
            </MenuItem>
            <MenuItem icon={check(p.prefs.scope === "all")} onSelect={() => set({ scope: "all" })}>
              {t("comments.allPages")}
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={check(p.prefs.mine)} onSelect={() => set({ mine: !p.prefs.mine })}>
              {t("comments.onlyMine")}
            </MenuItem>
            <MenuItem
              icon={check(p.prefs.resolved)}
              onSelect={() => set({ resolved: !p.prefs.resolved })}
            >
              {t("comments.showResolved")}
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={check(false)} onSelect={p.onMarkAll}>
              {t("comments.markAllRead")}
            </MenuItem>
            <MenuItem
              icon={check(p.prefs.hidden)}
              shortcut="⇧C"
              onSelect={() => set({ hidden: !p.prefs.hidden })}
            >
              {t("comments.hide")}
            </MenuItem>
          </Menu>
        )}
      </div>
      <div className="comments-panel__search">
        <Input
          icon={<Icon name="search" size={16} />}
          placeholder={t("comments.search")}
          aria-label={t("comments.search")}
          value={p.query}
          onChange={(e) => p.setQuery(e.currentTarget.value)}
        />
      </div>
      {p.rows.length === 0 ? (
        <div className="comments-panel__empty">
          <EmptyState
            icon={<Icon name="message-circle" size={18} />}
            title={t("comments.empty.title")}
            description={t("comments.empty.body")}
          />
        </div>
      ) : (
        <ul className="comments-panel__list">
          {p.rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              open={row.id === p.openId}
              onOpen={() => p.onOpen(row)}
              p={p}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({
  row,
  open,
  onOpen,
  p,
}: {
  row: ThreadRow
  open: boolean
  onOpen(): void
  p: CommentsPanelProps
}) {
  const a = row.first.author
  const last = row.messages[row.messages.length - 1]?.message ?? row.first
  const replies = row.messages.length - 1
  const where = row.nodeName ?? (p.multiPage ? p.pageName(row.page) : null)
  const resolved = row.thread.resolved
  let foot: string
  let tone: "warning" | null = null
  if (resolved) foot = t("comments.resolvedBy", { name: resolved.by.name })
  else if (row.detached) {
    foot = t("comments.detached")
    tone = "warning"
  } else {
    const parts: string[] = []
    if (replies > 0) parts.push(tn("comments.replies.one", "comments.replies", replies))
    else if (row.area) parts.push(t("comments.area"))
    if (where) parts.push(where)
    foot = parts.join(" · ")
  }
  return (
    <li className="comment-row-item">
      <button
        type="button"
        className={open ? "comment-row is-open" : "comment-row"}
        data-thread={row.id}
        onClick={onOpen}
      >
        <span className="comment-row__dot">
          {row.unread && !resolved && <span className="comment-row__unread" />}
        </span>
        <Avatar id={a.id} name={a.name} kind={a.kind} size={24} />
        <span className="comment-row__body">
          <span className="comment-row__meta">
            <span className="comment-row__name">{a.name}</span>
            <span className="comment-row__time">{shortTime(last.at)}</span>
          </span>
          <span className="comment-row__text">{plainText(row.first.text)}</span>
          {foot && (
            <span
              className={
                tone ? `comment-row__foot comment-row__foot--${tone}` : "comment-row__foot"
              }
            >
              {foot}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
