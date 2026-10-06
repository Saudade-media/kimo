/**
 * Board 37 "Home & gaps" leaf pieces: sidebar NavRow (one active style, fiCwk), the toast stack,
 * the danger confirm (Dialog bDVhS), the empty-state area (x9W17Q), TemplateCard (MeoEq),
 * TrashRow/Header (Vm6RF, LVJiO), the inline rename field (zucQA) and the Menu/Dense menus
 * (oRMVN, FgXgs, InPFe, NRPdz).
 */
import {
  Banner,
  Button,
  Dialog,
  DialogScrim,
  EmptyState,
  MenuDense,
  MenuDivider,
  MenuItemDense,
  Toast,
} from "@kimo/ui"
import {
  ArrowUpRight,
  CircleMinus,
  Copy,
  Download,
  File,
  FolderMinus,
  FolderSearch,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react"
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { causeOf, stemOf } from "./model"
import { previewUrl, type Template } from "./templates"

// --- Sidebar row -------------------------------------------------------------------------------

export interface NavRowProps {
  href: string
  icon: ReactNode
  label: string
  count?: number | null
  active: boolean
}

/** A sidebar row (board 37 fiCwk: one active style for every row, `aria-current=page`). */
export function NavRow({ href, icon, label, count, active }: NavRowProps) {
  return (
    <a
      className={`home-nav${active ? " home-nav--active" : ""}`}
      href={href}
      {...(active ? { "aria-current": "page" as const } : {})}
    >
      <span className="home-nav__icon">{icon}</span>
      <span className="home-nav__label">{label}</span>
      {count != null && (
        <>
          <span className="home-nav__spacer" />
          <span className="home-nav__count">{count}</span>
        </>
      )}
    </a>
  )
}

// --- Toasts ------------------------------------------------------------------------------------

export interface HomeToast {
  id: number
  tone: "success" | "danger" | "warning"
  text: string
  action?: { label: string; run: () => void }
  /** Stable hook for tests (`data-toast`). */
  kind: string
}

/** Home's toast stack: the newest toast replaces older ones of the same kind. */
export function useHomeToasts() {
  const [toasts, setToasts] = useState<HomeToast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])
  const show = useCallback(
    (t: Omit<HomeToast, "id">) => {
      const id = ++seq.current
      setToasts((list) => [...list.filter((x) => x.kind !== t.kind), { ...t, id }].slice(-3))
      setTimeout(() => dismiss(id), t.tone === "success" ? 6000 : 10_000)
    },
    [dismiss],
  )
  return { toasts, show, dismiss }
}

export function HomeToasts({
  toasts,
  onDismiss,
}: {
  toasts: readonly HomeToast[]
  onDismiss: (id: number) => void
}) {
  if (!toasts.length) return null
  return (
    <div className="home-toasts" aria-live="polite">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          data-toast={t.kind}
          {...(t.action
            ? {
                actionLabel: t.action.label,
                onAction: () => {
                  onDismiss(t.id)
                  t.action?.run()
                },
              }
            : {})}
        >
          {t.text}
        </Toast>
      ))}
    </div>
  )
}

// --- Danger confirm (Dialog bDVhS, board 37 Qsf1N / wFYXe) -------------------------------------

export interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  /** Banner title when the call fails ("Couldn't empty the Trash"). */
  failTitle: string
  run: () => Promise<void>
}

/** Delete forever / Empty trash: danger Confirm, Esc = Cancel; stays open until the call settles. */
export function DangerConfirm({
  state,
  onClose,
}: {
  state: ConfirmState | null
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (state) {
      setBusy(false)
      setError(null)
    }
  }, [state])
  if (!state) return null
  return (
    <DialogScrim>
      <Dialog
        icon={<Trash2 />}
        tone="danger"
        width={480}
        title={state.title}
        description={state.description}
        confirmLabel={busy ? `${state.confirmLabel}…` : error ? "Try again" : state.confirmLabel}
        confirmTone="danger"
        confirmDisabled={busy}
        onCancel={() => !busy && onClose()}
        onConfirm={() => {
          setBusy(true)
          state.run().then(onClose, (e: unknown) => {
            setBusy(false)
            setError(causeOf(e))
          })
        }}
      >
        {error ? (
          <Banner
            tone="danger"
            className="home-dialog-banner"
            title={state.failTitle}
            body={error}
          />
        ) : undefined}
      </Dialog>
    </DialogScrim>
  )
}

// --- Empty state area (x9W17Q) -----------------------------------------------------------------

export interface EmptyAction {
  label: string
  variant: "primary" | "secondary" | "ghost"
  icon?: ReactNode
  onClick: () => void
}

/** Main Area: vertical, gap 16, centered; EmptyState 300 wide; Actions row gap 8. */
export function HomeEmpty({
  icon,
  title,
  description,
  actions = [],
  kind,
}: {
  icon: ReactNode
  title: string
  description: string
  actions?: readonly EmptyAction[]
  kind: string
}) {
  return (
    <div className="home-empty-area" data-empty={kind}>
      <EmptyState
        className="home-empty-area__state"
        icon={icon}
        title={title}
        description={description}
      />
      {actions.length > 0 && (
        <div className="home-empty-area__actions">
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.variant}
              size="sm"
              className="home-empty-area__button"
              {...(a.icon ? { icon: a.icon } : {})}
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- TemplateCard (MeoEq) ----------------------------------------------------------------------

export function TemplateCard({
  template,
  busy,
  onUse,
}: {
  template: Template
  busy: boolean
  onUse: () => void
}) {
  const src = previewUrl(template.dir)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the card click is a mouse shortcut; "Use template" is the keyboard path
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    <div
      className="home-template-card"
      data-template={template.dir}
      onClick={() => !busy && onUse()}
    >
      <span className="home-template-card__thumbnail">
        {src && <img className="home-template-card__image" src={src} alt="" draggable={false} />}
      </span>
      <span className="home-template-card__meta">
        <span className="home-template-card__text">
          <span className="home-template-card__name">{template.name}</span>
          <span className="home-template-card__info">{template.info}</span>
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="home-template-card__use"
          disabled={busy}
          aria-label={`Use the ${template.name} template`}
          onClick={(e) => {
            e.stopPropagation()
            onUse()
          }}
        >
          Use template
        </Button>
      </span>
    </div>
  )
}

// --- TrashRow (LVJiO) and header (Vm6RF) -------------------------------------------------------

export function TrashRowHeader({ locationLabel }: { locationLabel: string }) {
  return (
    <div className="home-trash-row home-trash-row--header" aria-hidden="true">
      <span className="home-trash-row__icon-cell" />
      <span className="home-trash-row__name-cell">
        <span className="home-trash-row__label">NAME</span>
      </span>
      <span className="home-trash-row__location-cell">
        <span className="home-trash-row__label">{locationLabel}</span>
      </span>
      <span className="home-trash-row__deleted-cell">
        <span className="home-trash-row__label">DELETED</span>
      </span>
      <span className="home-trash-row__actions-cell" />
    </div>
  )
}

export function TrashRow({
  name,
  location,
  locationSans = false,
  deleted,
  busy,
  onRestore,
  onDelete,
}: {
  name: string
  location: string
  /** Web: "30 days" in sans text-sm text-secondary. */
  locationSans?: boolean
  deleted: string
  busy: boolean
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <div className="home-trash-row" data-trash={name}>
      <span className="home-trash-row__icon-tile" aria-hidden="true">
        <File />
      </span>
      <span className="home-trash-row__name-cell">
        <span className="home-trash-row__name">{name}</span>
      </span>
      <span className="home-trash-row__location-cell" title={location}>
        <span
          className={`home-trash-row__location${locationSans ? " home-trash-row__location--sans" : ""}`}
        >
          {location}
        </span>
      </span>
      <span className="home-trash-row__deleted-cell">
        <span className="home-trash-row__deleted">{deleted}</span>
      </span>
      <span className="home-trash-row__actions-cell">
        <Button
          variant="ghost"
          size="sm"
          className="home-trash-row__restore"
          icon={<Undo2 />}
          disabled={busy}
          aria-label={`Restore ${name}`}
          onClick={onRestore}
        >
          Restore
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="home-trash-row__delete"
          disabled={busy}
          aria-label={`Delete ${name} forever`}
          onClick={onDelete}
        >
          Delete forever
        </Button>
      </span>
    </div>
  )
}

// --- Inline rename (zucQA) ---------------------------------------------------------------------

/** Rename field: 28 high, bg-app, 1px accent, radius-sm, padding [0, 8]; the stem is selected. */
export function RenameField({
  name,
  onCommit,
  onCancel,
}: {
  name: string
  onCommit: (next: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, stemOf(name).length)
  }, [name])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const v = ref.current?.value.trim() ?? ""
    if (commit && v && v !== name) onCommit(v)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      className="home-rename-field"
      aria-label={`Rename ${name}`}
      defaultValue={name}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation()
        if (e.key === "Enter") finish(true)
        if (e.key === "Escape") finish(false)
      }}
      onBlur={() => finish(true)}
    />
  )
}

// --- Menus (Menu/Dense G7A3Aj) -----------------------------------------------------------------

export type MenuAnchor = HTMLElement | { x: number; y: number; width: number; height: number }

/** Where a menu opened: from the ⋯ (right edge on it, 4px under the row) or at the cursor. */
export interface MenuAt {
  anchor: MenuAnchor
  align: "start" | "end"
  offset: number
}

/** ⋯ button inside a row: the menu's right edge lines up with the button, 4px below the row. */
export function menuFromButton(button: HTMLElement): MenuAt {
  const row = button.closest<HTMLElement>('[role="row"]') ?? button
  const b = button.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  return { anchor: { x: b.x, y: r.y, width: b.width, height: r.height }, align: "end", offset: 4 }
}

/** Right-click: the menu opens at the cursor. */
export function menuAtCursor(e: MouseEvent): MenuAt {
  return { anchor: { x: e.clientX, y: e.clientY, width: 0, height: 0 }, align: "start", offset: 0 }
}

export interface FileMenuItem {
  id: string
  label: string
  icon: ReactNode
  meta?: string
  danger?: boolean
  run: () => void
}
export type FileMenuEntry = FileMenuItem | "divider"

export function HomeMenu({
  at,
  width,
  label,
  items,
  onClose,
}: {
  at: MenuAt
  width: number
  label: string
  items: readonly FileMenuEntry[]
  onClose: () => void
}) {
  return (
    <MenuDense
      className="home-menu"
      width={width}
      label={label}
      anchor={at.anchor as never}
      placement={{ align: at.align, offset: at.offset }}
      autoFocus
      onClose={onClose}
    >
      {items.map((it, i) =>
        it === "divider" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: dividers are positional
          <MenuDivider key={`d${i}`} />
        ) : (
          <MenuItemDense
            key={it.id}
            data-item={it.id}
            className={it.danger ? "home-menu__item--danger" : undefined}
            label={it.label}
            icon={it.icon}
            {...(it.meta ? { meta: it.meta } : {})}
            onSelect={() => {
              onClose()
              it.run()
            }}
          />
        ),
      )}
    </MenuDense>
  )
}

/** The icon of each menu item (board 37 §5). */
export const MENU_ICONS = {
  open: <ArrowUpRight />,
  reveal: <FolderSearch />,
  rename: <Pencil />,
  duplicate: <Copy />,
  download: <Download />,
  removeRecent: <CircleMinus />,
  trash: <Trash2 />,
  removeFolder: <FolderMinus />,
} as const
