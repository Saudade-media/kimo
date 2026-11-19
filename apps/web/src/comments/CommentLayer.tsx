/**
 * Board 51 comment UI on the canvas (docs/spec/comments.md §7): pins, areas and merged group
 * pins over the canvas, the hover preview, the composer for a new pin and the open thread. The
 * state lives in {@link useComments}; this file renders it.
 */
import type { CommentAnchor, CommentAuthor, CommentMessage } from "@kimo/core-schema"
import { CommentError, type CommentStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import { IconButton, Menu, MenuDivider, MenuItem } from "@kimo/ui"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { UiStore } from "../canvas/contract"
import { getLanguage, t, tn } from "../lib/i18n"
import { Icon } from "../lib/icons"
import { Composer } from "./Composer"
import { GuestName, guestNameBus } from "./guest"
import { MessageText } from "./MessageText"
import { anchorWorld, type ThreadRow } from "./model"
import { Avatar, EmojiPicker, type MentionCandidate } from "./pickers"

/** What the comment layer shows open: a new pin's composer, or a thread. */
export type CommentFocus =
  | { kind: "draft"; anchor: CommentAnchor }
  | { kind: "thread"; id: string }
  | null

export interface CommentActions {
  me: CommentAuthor | null
  /** Null when this person may write comments, else why not. */
  readOnly: string | null
  moderator: boolean
  candidates: readonly MentionCandidate[]
  create(anchor: CommentAnchor, text: string): void
  reply(thread: string, text: string): void
  edit(thread: string, message: string, text: string): void
  remove(thread: string, message: string | null): void
  resolve(thread: string, on: boolean): void
  react(thread: string, message: string, emoji: string): void
  markUnread(thread: string): void
  copyLink(thread: string): void
  openLink(href: string): void
  known(id: string): boolean
  canModify(thread: string, message: string): boolean
}

export interface CommentLayerProps {
  rows: readonly ThreadRow[]
  ui: UiStore
  layout: { get(): LayoutResult | null; subscribe(l: () => void): () => void }
  page: string | null
  focus: CommentFocus
  setFocus(f: CommentFocus): void
  draft: { x: number; y: number; w: number; h: number } | null
  showResolved: boolean
  actions: CommentActions
}

const PIN = 32
const MERGE_PX = 32
const GAP = 6

/** "2h", "3d": a short relative time in the UI language. */
export function shortTime(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000))
  const fmt = new Intl.RelativeTimeFormat(getLanguage(), { numeric: "auto", style: "narrow" })
  if (s < 60) return fmt.format(0, "second")
  if (s < 3600) return fmt.format(-Math.floor(s / 60), "minute")
  if (s < 86_400) return fmt.format(-Math.floor(s / 3600), "hour")
  if (s < 30 * 86_400) return fmt.format(-Math.floor(s / 86_400), "day")
  return new Date(at).toLocaleDateString(getLanguage(), { month: "short", day: "numeric" })
}

interface Placed {
  row: ThreadRow
  /** Screen point of the pin's sharp corner (its bottom-left). */
  x: number
  y: number
  area: { x: number; y: number; w: number; h: number } | null
}

interface Group {
  items: Placed[]
  x: number
  y: number
}

function useViewport(ui: UiStore) {
  return useSyncExternalStore(ui.subscribe, () => ui.getState().viewport)
}

/** Pins closer than 32 screen px merge (greedy, in display order). */
function groupPins(list: readonly Placed[], keep: string | null): (Placed | Group)[] {
  const out: (Placed | Group)[] = []
  const groups: Group[] = []
  for (const p of list) {
    if (p.row.id === keep || p.area) {
      out.push(p)
      continue
    }
    const g = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < MERGE_PX)
    if (g) g.items.push(p)
    else {
      const ng: Group = { items: [p], x: p.x, y: p.y }
      groups.push(ng)
    }
  }
  for (const g of groups) out.push(g.items.length === 1 ? (g.items[0] as Placed) : g)
  return out
}

export function CommentLayer(p: CommentLayerProps) {
  const v = useViewport(p.ui)
  const layout = useSyncExternalStore(p.layout.subscribe, p.layout.get)
  const [hover, setHover] = useState<string | null>(null)
  const asking = useSyncExternalStore(guestNameBus.subscribe, guestNameBus.open)
  const root = useRef<HTMLDivElement | null>(null)
  const openId = p.focus?.kind === "thread" ? p.focus.id : null

  const toScreen = (w: { x: number; y: number }) => ({
    x: (w.x - v.x) * v.zoom,
    y: (w.y - v.y) * v.zoom,
  })

  const placed = useMemo<Placed[]>(
    () =>
      p.rows
        .filter(
          (r) => r.page === p.page && (p.showResolved || !r.thread.resolved || r.id === openId),
        )
        .map((row) => {
          const w = anchorWorld(row.thread.anchor, layout)
          const s = { x: (w.x - v.x) * v.zoom, y: (w.y - v.y) * v.zoom }
          const a = row.thread.anchor
          if (a.w !== undefined && a.h !== undefined) {
            const area = { x: s.x, y: s.y, w: a.w * v.zoom, h: a.h * v.zoom }
            // Board 51 CommentArea: the pin at (w - 14, -18), its sharp corner 14 px in.
            return { row, x: s.x + area.w - 14, y: s.y + 14, area }
          }
          return { row, x: s.x, y: s.y, area: null }
        }),
    [p.rows, p.page, p.showResolved, openId, layout, v],
  )
  const items = groupPins(placed, openId)

  const zoomTo = (g: Group) => {
    const el = root.current
    if (!el) return
    const pts = g.items.map((i) => anchorWorld(i.row.thread.anchor, layout))
    const xs = pts.map((q) => q.x)
    const ys = pts.map((q) => q.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const bw = Math.max(1, Math.max(...xs) - minX)
    const bh = Math.max(1, Math.max(...ys) - minY)
    const W = el.clientWidth
    const H = el.clientHeight
    const zoom = Math.min(4, (W * 0.6) / bw, (H * 0.6) / bh, v.zoom * 8)
    const next = Math.max(zoom, v.zoom * 1.5)
    p.ui.getState().setViewport({
      x: minX + bw / 2 - W / 2 / next,
      y: minY + bh / 2 - H / 2 / next,
      zoom: next,
    })
  }

  const focusPoint = (): { x: number; y: number } | null => {
    if (p.focus?.kind === "draft") {
      const a = p.focus.anchor
      const s = toScreen(anchorWorld(a, layout))
      if (a.w !== undefined && a.h !== undefined) return { x: s.x + a.w * v.zoom - 14, y: s.y + 14 }
      return s
    }
    const f = placed.find((x) => x.row.id === openId)
    return f ? { x: f.x, y: f.y } : null
  }
  const at = focusPoint()
  const box = root.current
  const popStyle = (w: number) => {
    if (!at) return undefined
    const W = box?.clientWidth ?? 1e4
    let left = at.x + PIN + GAP
    if (left + w > W - 8) left = Math.max(8, at.x - GAP - w)
    const top = Math.max(8, at.y - PIN)
    return { left, top }
  }
  const draftAnchor = p.focus?.kind === "draft" ? p.focus.anchor : null
  const draftArea =
    draftAnchor && draftAnchor.w !== undefined && draftAnchor.h !== undefined
      ? (() => {
          const s = toScreen(anchorWorld(draftAnchor, layout))
          return { x: s.x, y: s.y, w: draftAnchor.w * v.zoom, h: (draftAnchor.h ?? 0) * v.zoom }
        })()
      : null
  const open = openId ? p.rows.find((r) => r.id === openId) : undefined

  return (
    <div ref={root} className="comment-layer" data-testid="comment-layer">
      {p.draft && (
        <div
          className="comment-area comment-area--draft"
          style={{
            left: (p.draft.x - v.x) * v.zoom,
            top: (p.draft.y - v.y) * v.zoom,
            width: p.draft.w * v.zoom,
            height: p.draft.h * v.zoom,
          }}
        >
          <div className="comment-area__tint" />
        </div>
      )}
      {placed
        .filter((x) => x.area)
        .map((x) => (
          <div
            key={`area-${x.row.id}`}
            className="comment-area"
            style={{ left: x.area?.x, top: x.area?.y, width: x.area?.w, height: x.area?.h }}
          >
            <div className="comment-area__tint" />
          </div>
        ))}
      {draftArea && (
        <div
          className="comment-area"
          style={{ left: draftArea.x, top: draftArea.y, width: draftArea.w, height: draftArea.h }}
        >
          <div className="comment-area__tint" />
        </div>
      )}
      {items.map((it) =>
        "items" in it ? (
          <button
            key={`g-${it.items[0]?.row.id}`}
            type="button"
            className="comment-pin comment-pin--group"
            style={{ left: it.x, top: it.y - PIN }}
            aria-label={tn("comments.group.one", "comments.group", it.items.length)}
            onClick={() => zoomTo(it)}
          >
            <span className="comment-pin__count">{it.items.length}</span>
          </button>
        ) : (
          <PinOrPreview
            key={it.row.id}
            item={it}
            selected={it.row.id === openId}
            hovered={hover === it.row.id && it.row.id !== openId}
            onHover={(on) => setHover(on ? it.row.id : null)}
            onOpen={() =>
              p.setFocus(openId === it.row.id ? null : { kind: "thread", id: it.row.id })
            }
          />
        ),
      )}
      {draftAnchor && at && p.actions.me && (
        <>
          <div className="comment-pin comment-pin--mine" style={{ left: at.x, top: at.y - PIN }}>
            <Avatar id={p.actions.me.id} name={p.actions.me.name} kind="person" size={26} />
          </div>
          <div className="comment-pop" style={popStyle(300)}>
            {asking && <GuestName />}
            <Composer
              variant="new"
              autoFocus
              candidates={p.actions.candidates}
              onCancel={() => p.setFocus(null)}
              onSend={(text) => p.actions.create(draftAnchor, text)}
            />
          </div>
        </>
      )}
      {open && at && (
        <div className="comment-pop" style={popStyle(320)}>
          {asking && <GuestName />}
          <Thread row={open} actions={p.actions} onClose={() => p.setFocus(null)} />
        </div>
      )}
    </div>
  )
}

function PinOrPreview({
  item,
  selected,
  hovered,
  onHover,
  onOpen,
}: {
  item: Placed
  selected: boolean
  hovered: boolean
  onHover(on: boolean): void
  onOpen(): void
}) {
  const { row } = item
  const a = row.first.author
  const replies = row.messages.length - 1
  const resolved = !!row.thread.resolved
  const cls = [
    "comment-pin",
    replies > 0 && !resolved && !hovered && "comment-pin--replies",
    resolved && "comment-pin--resolved",
    selected && "comment-pin--selected",
    hovered && "comment-pin--preview",
  ]
    .filter(Boolean)
    .join(" ")
  return (
    <button
      type="button"
      className={cls}
      style={{ left: item.x, top: item.y - PIN }}
      data-thread={row.id}
      aria-label={`#${row.number} ${a.name}`}
      aria-expanded={selected}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onClick={onOpen}
    >
      {resolved && !hovered ? (
        <Icon name="check" size={16} />
      ) : (
        <Avatar id={a.id} name={a.name} kind={a.kind} size={26} />
      )}
      {hovered ? (
        <span className="comment-pin__body">
          <span className="comment-pin__meta">
            <span className="comment-pin__name">{a.name}</span>
            <span className="comment-pin__time">{shortTime(row.first.at)}</span>
          </span>
          <span className="comment-pin__preview">{firstLine(row.first.text)}</span>
        </span>
      ) : (
        replies > 0 && !resolved && <span className="comment-pin__count">{replies}</span>
      )}
      {row.unread && !resolved && !hovered && <span className="comment-pin__dot" />}
    </button>
  )
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? ""
  return line.replace(/@\[([^\]]+)\]\([^)]*\)/g, "@$1").replace(/[*~]/g, "")
}

function Thread({
  row,
  actions,
  onClose,
}: {
  row: ThreadRow
  actions: CommentActions
  onClose(): void
}) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const me = actions.me
  const writable = actions.readOnly === null && !!me
  const resolved = !!row.thread.resolved
  const first = row.messages[0]?.id as string
  const canEditFirst = writable && actions.canModify(row.id, first)
  const canDelete = writable && (canEditFirst || actions.moderator)
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".comment-thread__menu")) setMenu(false)
    }
    window.addEventListener("pointerdown", close, true)
    return () => window.removeEventListener("pointerdown", close, true)
  }, [menu])
  return (
    <div className="comment-thread" role="dialog" aria-label={t("comments.title")}>
      <div className="comment-thread__header">
        <span className="comment-thread__title">{t("comments.title")}</span>
        <div className="comment-thread__actions">
          <IconButton
            tone="ghost"
            label={t("comments.more")}
            icon={<Icon name="ellipsis" size={16} />}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          />
          <IconButton
            tone="ghost"
            label={resolved ? t("comments.reopen") : t("comments.resolve")}
            icon={<Icon name="circle-check" size={16} />}
            active={resolved || undefined}
            disabled={!writable}
            onClick={() => actions.resolve(row.id, !resolved)}
          />
          <IconButton
            tone="ghost"
            label={t("comments.close")}
            icon={<Icon name="x" size={16} />}
            onClick={onClose}
          />
        </div>
        {menu && (
          <Menu
            className="comment-menu comment-thread__menu"
            label={t("comments.more")}
            autoFocus
            onClose={() => setMenu(false)}
          >
            {canEditFirst && (
              <MenuItem icon={<Icon name="pencil" size={14} />} onSelect={() => setEditing(first)}>
                {t("comments.edit")}
              </MenuItem>
            )}
            <MenuItem
              icon={<Icon name="mail" size={14} />}
              onSelect={() => {
                actions.markUnread(row.id)
                onClose()
              }}
            >
              {t("comments.markUnread")}
            </MenuItem>
            <MenuItem
              icon={<Icon name="link" size={14} />}
              onSelect={() => actions.copyLink(row.id)}
            >
              {t("comments.copyLink")}
            </MenuItem>
            {canDelete && <MenuDivider />}
            {canDelete && (
              <MenuItem
                className="comment-menu__danger"
                icon={<Icon name="trash-2" size={14} />}
                onSelect={() => actions.remove(row.id, null)}
              >
                {t("comments.delete")}
              </MenuItem>
            )}
          </Menu>
        )}
      </div>
      <div className="comment-thread__messages">
        {row.messages.map(({ id, message }) => (
          <Message
            key={id}
            thread={row.id}
            id={id}
            message={message}
            first={id === first}
            editing={editing === id}
            setEditing={setEditing}
            actions={actions}
            writable={writable}
          />
        ))}
      </div>
      {writable && !resolved && (
        <Composer
          variant="reply"
          candidates={actions.candidates}
          onSend={(text) => actions.reply(row.id, text)}
        />
      )}
    </div>
  )
}

function Message({
  thread,
  id,
  message,
  first,
  editing,
  setEditing,
  actions,
  writable,
}: {
  thread: string
  id: string
  message: CommentMessage
  first: boolean
  editing: boolean
  setEditing(id: string | null): void
  actions: CommentActions
  writable: boolean
}) {
  const [emoji, setEmoji] = useState(false)
  const [menu, setMenu] = useState(false)
  const me = actions.me?.id ?? null
  const own = writable && actions.canModify(thread, id)
  const reactions = Object.entries(message.reactions ?? {})
  const a = message.author
  return (
    <div className="comment-message">
      <Avatar id={a.id} name={a.name} kind={a.kind} size={24} />
      <div className="comment-message__body">
        <div className="comment-message__meta">
          <span className="comment-message__name">{a.name}</span>
          <span className="comment-message__time">{shortTime(message.at)}</span>
          {message.edited && <span className="comment-message__time">{t("comments.edited")}</span>}
          {own && !first && !editing && (
            <span className="comment-message__more">
              <IconButton
                size="sm"
                tone="ghost"
                label={t("comments.more")}
                icon={<Icon name="ellipsis" size={14} />}
                onClick={() => setMenu((m) => !m)}
              />
              {menu && (
                <Menu
                  className="comment-menu"
                  label={t("comments.more")}
                  autoFocus
                  onClose={() => setMenu(false)}
                >
                  <MenuItem
                    icon={<Icon name="pencil" size={14} />}
                    onSelect={() => {
                      setMenu(false)
                      setEditing(id)
                    }}
                  >
                    {t("comments.edit")}
                  </MenuItem>
                  <MenuItem
                    className="comment-menu__danger"
                    icon={<Icon name="trash-2" size={14} />}
                    onSelect={() => {
                      setMenu(false)
                      actions.remove(thread, id)
                    }}
                  >
                    {t("comments.delete")}
                  </MenuItem>
                </Menu>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <Composer
            variant="edit"
            autoFocus
            initial={message.text}
            candidates={actions.candidates}
            onCancel={() => setEditing(null)}
            onSend={(text) => {
              actions.edit(thread, id, text)
              setEditing(null)
            }}
          />
        ) : (
          <MessageText
            className="comment-message__text"
            text={message.text}
            known={actions.known}
            onLink={actions.openLink}
          />
        )}
        {(reactions.length > 0 || writable) && (
          <div
            className={
              reactions.length ? "comment-reactions" : "comment-reactions comment-reactions--idle"
            }
          >
            {reactions.map(([e, who]) => {
              const mine = me !== null && who.includes(me)
              return (
                <button
                  key={e}
                  type="button"
                  className={mine ? "comment-reaction is-mine" : "comment-reaction"}
                  aria-pressed={mine}
                  disabled={!writable}
                  onClick={() => actions.react(thread, id, e)}
                >
                  <span className="comment-reaction__emoji">{e}</span>
                  <span className="comment-reaction__count">{who.length}</span>
                </button>
              )
            })}
            {writable && (
              <span className="comment-reactions__add-wrap">
                <button
                  type="button"
                  className="comment-reaction-add"
                  aria-label={t("comments.addReaction")}
                  onClick={() => setEmoji((x) => !x)}
                >
                  <Icon name="smile-plus" size={13} />
                </button>
                {emoji && (
                  <div className="comment-reactions__picker">
                    <EmojiPicker
                      onPick={(e) => {
                        actions.react(thread, id, e)
                        setEmoji(false)
                      }}
                    />
                  </div>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Board 51 toolbar badge: unread threads on this page, while C is off. */
export function UnreadBadge({ count }: { count: number }): ReactNode {
  if (count <= 0) return null
  return (
    <span
      className="comment-badge"
      role="status"
      aria-label={tn("comments.unread.one", "comments.unread", count)}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

/** A comment store error as one line of UI text. */
export function commentErrorText(e: unknown): string {
  if (e instanceof CommentError) {
    if (e.code === "RATE_LIMITED") return t("comments.error.rate")
    if (e.code === "READ_ONLY") return t("comments.error.readOnly")
    if (e.code === "NOT_AUTHOR") return t("comments.error.notAuthor")
  }
  return t("comments.error.generic")
}

export type { CommentStore }
