/**
 * Comment mode for one open file (docs/spec/comments.md §5 to §7, board 51): threads from the
 * store's CommentStore, read state, the panel's choices, and the writes the UI makes. The Editor
 * mounts {@link UseComments.layer} over the canvas and {@link UseComments.panel} in the Right
 * Card while the Comment tool is active.
 */
import { type CommentAnchor, type CommentAuthor, listPages } from "@kimo/core-schema"
import { CommentStore, type DocStore } from "@kimo/editor-state"
import "./comments.css"
import type { LayoutResult } from "@kimo/layout"
import type { KimoPlatform } from "@kimo/platform"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { CommentGesture, UiStore } from "../canvas/contract"
import type { M3Controller } from "../editor/m3/controller"
import { activeRoots } from "../editor/pages/model"
import { t } from "../lib/i18n"
import { deviceKeysFor } from "../multiplayer/device"
import { devicePubOf } from "../multiplayer/device-key"
import {
  type CommentActions,
  type CommentFocus,
  CommentLayer,
  commentErrorText,
} from "./CommentLayer"
import { CommentsPanel } from "./CommentsPanel"
import { guestNameBus } from "./guest"
import {
  anchorAt,
  anchorWorld,
  type CommentPrefs,
  loadPrefs,
  panelRows,
  personAuthor,
  ReadState,
  savePrefs,
  type ThreadRow,
  threadRows,
} from "./model"
import type { MentionCandidate } from "./pickers"

export interface UseCommentsOptions {
  store: DocStore
  ui: UiStore
  layout: { get(): LayoutResult | null; subscribe(l: () => void): () => void }
  /** Room id for a shared file, else the file's id (§6). */
  fileKey: string
  platform: KimoPlatform | null
  m3: M3Controller
  /** Display name from Settings › Multiplayer, "" when unset. */
  displayName: string
  /** The presence label used when there is no name ("Guest 2"). */
  guestLabel: string
  setDisplayName?: (name: string) => Promise<void>
  /** Room id when shared (copy link uses it instead of a link with keys). */
  room: string | null
  /** Desktop: the file's `kimo://open?path=…` link (Copy link adds `comment=`). */
  deepLink?: () => string | null
  /** Header for the Comments panel (the Right Card's Card Header). */
  header: ReactNode
}

export interface UseComments {
  active: boolean
  layer: ReactNode
  panel: ReactNode
  /** Board 51 toolbar badge: unread threads on this page. */
  unread: number
  onComment(g: CommentGesture): void
  onCommentDraft(r: { x: number; y: number; w: number; h: number } | null): void
  /** ⇧C. */
  toggleHidden(): void
}

const NO_ROWS: ThreadRow[] = []

function useDevicePub(platform: KimoPlatform | null): string | null {
  const [pub, setPub] = useState<string | null>(null)
  useEffect(() => {
    if (!platform) return
    let live = true
    void deviceKeysFor(platform)
      .get()
      .then(devicePubOf)
      .then((p) => {
        if (live) setPub(p)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [platform])
  return pub
}

export function useComments(o: UseCommentsOptions): UseComments {
  const { store, ui } = o
  const comments = useMemo(() => store.comments ?? inertComments(), [store])
  const tool = useSyncExternalStore(ui.subscribe, () => ui.getState().tool)
  const page = useSyncExternalStore(ui.subscribe, () => ui.getState().page)
  const active = tool === "comment"
  const read = useMemo(() => new ReadState(o.fileKey), [o.fileKey])
  const [prefs, setPrefsState] = useState<CommentPrefs>(() => loadPrefs(o.fileKey))
  useEffect(() => setPrefsState(loadPrefs(o.fileKey)), [o.fileKey])
  const setPrefs = useCallback(
    (p: CommentPrefs) => {
      setPrefsState(p)
      savePrefs(o.fileKey, p)
    },
    [o.fileKey],
  )
  const [query, setQuery] = useState("")
  const [focus, setFocus] = useState<CommentFocus>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const pub = useDevicePub(o.platform)
  const name = o.displayName.trim() || o.guestLabel
  const me: CommentAuthor | null = useMemo(
    () => (pub ? personAuthor(pub, name) : null),
    [pub, name],
  )

  // Rows follow comment changes and read marks.
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const bump = () => setRev((r) => r + 1)
    const offs = [
      comments.onChange(bump),
      read.subscribe(bump),
      store.onChange((c) => {
        if (c.nodes.size || c.header) bump()
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [comments, read, store])
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev re-reads the store
  const rows = useMemo(() => threadRows(store, me?.id ?? null, read), [store, me, read, rev])
  const doc = store.toHeader() as Parameters<typeof listPages>[0]
  const pages = listPages(doc)
  const pageId = page ?? pages[0]?.id ?? null

  // Leaving comment mode closes what was open; entering it clears the layer selection (§7).
  useEffect(() => {
    if (active) {
      if (ui.getState().selection.length) ui.getState().clearSelection()
    } else {
      setFocus(null)
      setDraft(null)
    }
  }, [active, ui])

  // Esc closes what is open, then leaves comment mode (§7). Fields handle their own Esc.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector(".m3-scrim")) return
      e.preventDefault()
      if (focus) setFocus(null)
      else ui.getState().setTool("select")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, focus, ui])

  // Opening a thread marks it read, and keeps it read while it is open.
  const openId = focus?.kind === "thread" ? focus.id : null
  useEffect(() => {
    if (!openId) return
    const row = rows.find((r) => r.id === openId)
    if (row) read.markRead(row.id, row.messages)
    else setFocus(null)
  }, [openId, rows, read])

  const toast = o.m3.toast.bind(o.m3)
  const run = useCallback(
    (fn: () => void): boolean => {
      try {
        fn()
        return true
      } catch (e) {
        toast({ tone: "danger", text: commentErrorText(e) })
        return false
      }
    },
    [toast],
  )

  const readOnly = comments.readOnly
  const moderator = comments.room ? comments.room.moderator : true
  const candidates = useMemo<MentionCandidate[]>(() => {
    const seen = new Map<string, MentionCandidate>()
    for (const r of rows)
      for (const { message } of r.messages) {
        const a = message.author
        if (a.id === me?.id || seen.has(a.id)) continue
        seen.set(a.id, {
          id: a.id,
          name: a.name,
          kind: a.kind,
          sub: a.kind === "agent" ? "agent" : "commented",
        })
      }
    return [...seen.values()]
  }, [rows, me])
  const known = useMemo(() => {
    const ids = new Set(candidates.map((c) => c.id))
    if (me) ids.add(me.id)
    return (id: string) => ids.has(id)
  }, [candidates, me])

  const askedName = useRef(false)
  const withName = useCallback(
    async (fn: (author: CommentAuthor) => void) => {
      if (!me) return
      // §7: a guest is asked for a name once, on their first comment (board 51 GuestName).
      if (!o.displayName.trim() && o.setDisplayName && !askedName.current && !guestAsked()) {
        askedName.current = true
        markGuestAsked()
        const typed = await askName(o.m3)
        if (typed) {
          await o.setDisplayName(typed).catch(() => {})
          fn({ ...me, name: typed.slice(0, 64) })
          return
        }
      }
      fn(me)
    },
    [me, o.displayName, o.setDisplayName, o.m3],
  )

  const linkFor = useCallback(
    (thread: string): string | null => {
      const base = o.deepLink?.()
      if (base) return `${base}&comment=${thread}`
      const url = new URL(location.href)
      const [route = "", q = ""] = url.hash.split("?")
      const params = new URLSearchParams(q)
      params.delete("page")
      params.set("comment", thread)
      // A join route holds the room key: the link names the room only (§7).
      if (/^#\/join\//.test(route) && o.room) url.hash = `#/cloud/${o.room}?${params.toString()}`
      else url.hash = `${route}?${params.toString()}`
      return url.toString()
    },
    [o.deepLink, o.room],
  )

  const actions: CommentActions = {
    me,
    readOnly,
    moderator,
    candidates,
    known,
    canModify: (thread, message) => !!me && comments.canModify(thread, message, me.id),
    create: (anchor, text) =>
      void withName((author) => {
        run(() => {
          const r = comments.createThread({ anchor, message: { author, text } }, "user")
          read.markRead(r.threadId, [{ id: r.messageId }])
          setFocus({ kind: "thread", id: r.threadId })
        })
      }),
    reply: (thread, text) =>
      void withName((author) => {
        run(() => {
          const id = comments.reply(thread, { author, text }, "user")
          const row = rows.find((x) => x.id === thread)
          read.markRead(thread, [...(row?.messages ?? []), { id }])
        })
      }),
    edit: (thread, message, text) => {
      if (me) run(() => comments.editMessage(thread, message, text, me.id, "user"))
    },
    remove: (thread, message) => {
      if (!me) return
      const row = rows.find((x) => x.id === thread)
      const whole = message === null || message === row?.messages[0]?.id
      void o.m3
        .confirm({
          title: whole ? t("comments.deleteTitle") : t("comments.deleteReplyTitle"),
          desc: whole ? t("comments.deleteBody") : t("comments.deleteReplyBody"),
          icon: "trash-2",
          tone: "danger",
          items: [],
          confirm: t("comments.delete"),
        })
        .then((ok) => {
          if (!ok) return
          const mod = {
            moderator: moderator && !comments.canModify(thread, row?.messages[0]?.id ?? "", me.id),
          }
          run(() => {
            if (whole) {
              comments.deleteThread(thread, me.id, "user", mod)
              setFocus(null)
            } else comments.deleteMessage(thread, message as string, me.id, "user", mod)
          })
        })
    },
    resolve: (thread, on) => {
      if (!me) return
      if (run(() => comments.setResolved(thread, on ? me : null, "user")) && on) {
        toast({ tone: "success", icon: "circle-check", text: t("comments.resolved") })
        if (!prefs.resolved) setFocus(null)
      }
    },
    react: (thread, message, emoji) => {
      if (me) run(() => void comments.toggleReaction(thread, message, emoji, me.id, "user"))
    },
    markUnread: (thread) => read.markUnread(thread),
    copyLink: (thread) => {
      const link = linkFor(thread)
      if (!link) return
      const write = o.platform?.clipboard?.writeText
        ? o.platform.clipboard.writeText(link)
        : navigator.clipboard.writeText(link)
      void Promise.resolve(write).then(
        () => toast({ tone: "success", icon: "link", text: t("comments.linkCopied") }),
        () => toast({ tone: "danger", text: t("comments.error.generic") }),
      )
    },
    openLink: (href) => {
      if (o.platform?.files.openExternalUrl)
        void o.platform.files.openExternalUrl(href).catch(() => {})
      else window.open(href, "_blank", "noopener,noreferrer")
    },
  }

  // A link with `comment=<thread>` opens comment mode on that thread (§7 Copy link).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per file, then on hash changes
  useEffect(() => {
    const go = () => {
      const q = location.hash.split("?")[1]
      const id = q ? new URLSearchParams(q).get("comment") : null
      if (!id) return
      const row = threadRows(store, null, read).find((r) => r.id === id)
      if (!row) return
      if (
        row.page &&
        row.page !== (ui.getState().page ?? null) &&
        pages.some((p) => p.id === row.page)
      )
        ui.getState().setPage?.(row.page)
      ui.getState().setTool("comment")
      setFocus({ kind: "thread", id })
      const w = anchorWorld(row.thread.anchor, o.layout.get())
      const v = ui.getState().viewport
      const el = document.querySelector(".editor__canvas") as HTMLElement | null
      const W = el?.clientWidth ?? 800
      const H = el?.clientHeight ?? 600
      ui.getState().setViewport({ x: w.x - W / 2 / v.zoom, y: w.y - H / 2 / v.zoom, zoom: v.zoom })
    }
    const t0 = setTimeout(go, 300)
    window.addEventListener("hashchange", go)
    return () => {
      clearTimeout(t0)
      window.removeEventListener("hashchange", go)
    }
  }, [o.fileKey])

  const onComment = useCallback(
    (g: CommentGesture) => {
      if (focus) {
        // A click while something is open closes it first.
        setFocus(null)
        return
      }
      if (readOnly !== null) {
        toast({ tone: "warning", text: t("comments.error.readOnly") })
        return
      }
      if (!me) return
      const roots = activeRoots(store, page)
      const anchor: CommentAnchor = anchorAt(
        g.world,
        roots,
        store,
        o.layout.get(),
        pages[0]?.id === null ? null : pageId,
      )
      setFocus({ kind: "draft", anchor })
    },
    [focus, readOnly, me, store, page, pageId, pages, o.layout, toast],
  )

  const unread = useMemo(
    () => rows.filter((r) => r.unread && !r.thread.resolved && r.page === pageId).length,
    [rows, pageId],
  )

  const list = active ? panelRows(rows, prefs, pageId, me?.id ?? null, query) : NO_ROWS
  const pageName = (id: string | null) => pages.find((p) => p.id === id)?.name ?? null

  const layer =
    active && !prefs.hidden ? (
      <CommentLayer
        rows={rows}
        ui={ui}
        layout={o.layout}
        page={pageId}
        focus={focus}
        setFocus={setFocus}
        draft={draft}
        showResolved={prefs.resolved}
        actions={actions}
      />
    ) : null

  const panel = active ? (
    <aside
      className="right-panel ws-card ws-card--right right-panel--comments"
      aria-label={t("comments.panel")}
    >
      {o.header}
      <CommentsPanel
        rows={list}
        prefs={prefs}
        setPrefs={setPrefs}
        query={query}
        setQuery={setQuery}
        openId={openId}
        multiPage={pages.length > 1}
        pageName={pageName}
        onClose={() => ui.getState().setTool("select")}
        onMarkAll={() => read.markAll(rows)}
        onOpen={(row) => {
          if (row.page !== pageId && row.page && ui.getState().setPage)
            ui.getState().setPage(row.page)
          if (prefs.hidden) setPrefs({ ...prefs, hidden: false })
          setFocus({ kind: "thread", id: row.id })
          const w = anchorWorld(row.thread.anchor, o.layout.get())
          const v = ui.getState().viewport
          const el = document.querySelector(".editor__canvas") as HTMLElement | null
          const W = el?.clientWidth ?? 800
          const H = el?.clientHeight ?? 600
          const sx = (w.x - v.x) * v.zoom
          const sy = (w.y - v.y) * v.zoom
          // Pan only when the pin is off screen.
          if (sx < 40 || sy < 80 || sx > W - 380 || sy > H - 40)
            ui.getState().setViewport({
              x: w.x - W / 3 / v.zoom,
              y: w.y - H / 3 / v.zoom,
              zoom: v.zoom,
            })
        }}
      />
    </aside>
  ) : null

  return {
    active,
    layer,
    panel,
    unread,
    onComment,
    onCommentDraft: setDraft,
    toggleHidden: () => setPrefs({ ...prefs, hidden: !prefs.hidden }),
  }
}

/** A store that never holds comments (a document store without them). */
function inertComments(): CommentStore {
  const s = new CommentStore()
  s.setReadOnly("Comments are not available here")
  return s
}

const GUEST_ASKED = "kimo.comments.guestAsked"

function guestAsked(): boolean {
  try {
    return globalThis.localStorage?.getItem(GUEST_ASKED) === "1"
  } catch {
    return false
  }
}

function markGuestAsked(): void {
  try {
    globalThis.localStorage?.setItem(GUEST_ASKED, "1")
  } catch {
    // Asked again next session.
  }
}

/** Board 51 GuestName: resolves the typed name, or null for Skip. */
function askName(_m3: M3Controller): Promise<string | null> {
  return guestNameBus.ask()
}
