/**
 * Board 42 leaf pieces shared by the relay setup wizard, Settings › Multiplayer and the Share
 * popover: allowed origins, code blocks with Copy, check rows, log lines, fields, radio cards and
 * the progress track.
 */
import { Badge, Button, IconButton, Input, StatusPill } from "@kimo/ui"
import { type ReactNode, useId, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { originOf } from "../relay-setup/commands"
import type { RelayCheck } from "../relay-setup/relay-test"
import "./relay-wizard.css"

// --- Small pieces -------------------------------------------------------------------------------

export function Spacer() {
  return <span className="rw-spacer" aria-hidden="true" />
}

/** IconButton 24, transparent, 14 icon (Copy, Show, Close). */
export function SmallIconButton({
  icon,
  label,
  onClick,
  className,
}: {
  icon: string
  label: string
  onClick(): void
  className?: string
}) {
  return (
    <IconButton
      className={`rw-icon-btn${className ? ` ${className}` : ""}`}
      label={label}
      icon={<Icon name={icon} size={14} />}
      size="sm"
      tone="ghost"
      onClick={onClick}
    />
  )
}

/** Check (RP1lp): icon 14 · label · spacer · mono meta. */
export function CheckRow({
  status,
  label,
  meta,
  icon,
  check,
}: {
  status: "pending" | "running" | "ok" | "failed" | "warning"
  label: string
  meta?: string | null
  icon?: string
  check?: string
}) {
  const name =
    icon ??
    {
      pending: "circle-dashed",
      running: "loader-circle",
      ok: "circle-check",
      failed: "circle-x",
      warning: "circle-alert",
    }[status]
  return (
    <div className="rw-check" data-status={status} data-check={check}>
      <span
        className={`rw-check__icon${status === "running" ? " rw-spin" : ""}`}
        aria-hidden="true"
      >
        <Icon name={name} size={14} />
      </span>
      <span className="rw-check__label">{label}</span>
      {meta ? (
        <>
          <Spacer />
          <span className="rw-mono">{meta}</span>
        </>
      ) : null}
    </div>
  )
}

const CHECK_LABEL: Record<RelayCheck["id"], string> = {
  reach: "Reached the relay",
  handshake: "Kimo handshake",
  protocol: "Protocol",
  ownership: "Ownership",
}

export function RelayCheckRow({ check, server }: { check: RelayCheck; server?: boolean }) {
  return (
    <CheckRow
      check={check.id}
      status={check.status}
      label={check.id === "reach" && server ? "Reached the server" : CHECK_LABEL[check.id]}
      meta={check.meta}
    />
  )
}

/** Log line (N8hMC): icon 12 · mono text · spacer · mono meta. */
export function LogLine({
  status,
  text,
  meta,
}: {
  status: "pending" | "running" | "done" | "failed"
  text: string
  meta?: string | null
}) {
  const name = {
    pending: "circle-dashed",
    running: "loader-circle",
    done: "circle-check",
    failed: "circle-x",
  }[status]
  return (
    <li className="rw-line" data-status={status}>
      <span className={`rw-line__icon${status === "running" ? " rw-spin" : ""}`} aria-hidden="true">
        <Icon name={name} size={12} />
      </span>
      <span className="rw-line__text">{text}</span>
      {meta ? (
        <>
          <Spacer />
          <span className="rw-mono">{meta}</span>
        </>
      ) : null}
    </li>
  )
}

/** Track (i00iF) › Bar: `value` 0..1. */
export function Track({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className="rw-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <div className="rw-track__bar" style={{ width: `${v * 100}%` }} />
    </div>
  )
}

/** StatusPill in a board 42 tone: success (Running, Ready), muted (in progress), danger, warning. */
export function Pill({
  tone,
  label,
}: {
  tone: "success" | "muted" | "danger" | "warning"
  label: string
}) {
  const status = tone === "danger" ? "missing" : tone === "warning" ? "changed" : "linked"
  return (
    <StatusPill
      status={status}
      label={label}
      className={tone === "muted" ? "rw-pill--muted" : undefined}
      data-tone={tone}
    />
  )
}

/** Note (UMwDK / Brdqo / LzwSt / CeGmj): icon 14 · text. */
export function Note({
  icon,
  tone,
  children,
}: {
  icon: string
  tone?: "warning"
  children: ReactNode
}) {
  return (
    <div className={`rw-note${tone === "warning" ? " rw-note--warning" : ""}`}>
      <span className="rw-note__icon" aria-hidden="true">
        <Icon name={icon} size={14} />
      </span>
      <p className="rw-desc">{children}</p>
    </div>
  )
}

/** Code block (ak2oz): mono text (masked on screen) and Copy (the real value). */
export function CodeBlock({
  text,
  label,
  onCopy,
}: {
  text: string
  label: string
  onCopy(): void
}) {
  return (
    <div className="rw-box rw-box--code" data-code={label}>
      <pre className="rw-code">{text}</pre>
      <SmallIconButton icon="copy" label={`Copy ${label}`} onClick={onCopy} />
    </div>
  )
}

/** Field (Hk33f): Label Row · Input Row · Help. */
export function Field({
  label,
  help,
  tag,
  children,
  id,
}: {
  label: string
  help?: ReactNode
  tag?: string
  children: (id: string) => ReactNode
  id?: string
}) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <div className="rw-field">
      <div className="rw-label-row">
        <label className="rw-label" htmlFor={fieldId}>
          {label}
        </label>
        {tag && <span className="rw-tag">{tag}</span>}
      </div>
      <div className="rw-input-row">{children(fieldId)}</div>
      {help && <p className="rw-desc rw-desc--tertiary">{help}</p>}
    </div>
  )
}

/** Relay URL field: server icon, mono value. */
export function RelayUrlInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "wss://relay.example.com",
  inputRef,
}: {
  id: string
  value: string
  onChange(v: string): void
  onBlur?(v: string): void
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <Input
      id={id}
      ref={inputRef}
      frameProps={{ className: "rw-mono-input" }}
      icon={<Icon name="server" size={16} />}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onBlur={(e) => onBlur?.(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onBlur?.(e.currentTarget.value)
      }}
    />
  )
}

/** Radio card (i2Vair) or reach row (Dq2QR). */
export function RadioRow({
  className,
  checked,
  disabled,
  onSelect,
  onActivate,
  children,
  value,
  tabIndex,
  buttonRef,
}: {
  className: "rw-option" | "rw-reach"
  checked: boolean
  disabled?: boolean
  onSelect(): void
  onActivate?(): void
  children: ReactNode
  value: string
  tabIndex?: number
  buttonRef?: (el: HTMLButtonElement | null) => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio card (i2Vair) with icon, text and badges
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      className={className}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      data-value={value}
      tabIndex={tabIndex ?? (checked ? 0 : -1)}
      onClick={() => {
        if (!disabled) onSelect()
      }}
      onDoubleClick={() => {
        if (!disabled) onActivate?.()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !disabled) {
          e.preventDefault()
          onActivate?.()
        }
      }}
    >
      <span className="rw-radio" aria-hidden="true" />
      {children}
    </button>
  )
}

/** Arrow keys move between the radios of a group (skipping disabled ones). */
export function radioKeys(
  e: React.KeyboardEvent,
  values: readonly { value: string; disabled?: boolean }[],
  current: string,
  select: (v: string) => void,
) {
  const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]
  if (!keys.includes(e.key)) return
  e.preventDefault()
  const enabled = values.filter((v) => !v.disabled)
  const i = enabled.findIndex((v) => v.value === current)
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1
  const next = enabled[(i + step + enabled.length) % enabled.length]
  if (next) {
    select(next.value)
    const group = e.currentTarget as HTMLElement
    requestAnimationFrame(() =>
      group.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus(),
    )
  }
}

export { Badge }

// --- Allowed origins (joY17) ----------------------------------------------------------------------

export function OriginsGroup({
  kind,
  auto,
  extra,
  onChange,
}: {
  kind: "web" | "desktop"
  auto: readonly string[]
  extra: readonly string[]
  onChange(extra: string[]): void
}) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const add = () => {
    const origin = originOf(draft)
    if (!origin) {
      setError("Enter a web origin such as https://kimo.example.org")
      return
    }
    setError(null)
    setDraft("")
    if (!extra.includes(origin) && !auto.includes(origin)) onChange([...extra, origin])
  }
  return (
    <div className="rw-group" data-group="origins">
      <div className="rw-label-row">
        <label className="rw-label" htmlFor={id}>
          Allowed origins
        </label>
        <span className="rw-tag">KIMO_ALLOWED_ORIGINS</span>
      </div>
      <div className="rw-origins-row">
        {kind === "web" ? (
          auto.map((o) => (
            <span key={o} className="rw-chip rw-chip--mono" data-origin="auto">
              <span className="rw-chip__icon" aria-hidden="true">
                <Icon name="lock" size={12} />
              </span>
              {o}
            </span>
          ))
        ) : (
          <span className="rw-chip" data-origin="auto">
            <span className="rw-chip__icon" aria-hidden="true">
              <Icon name="monitor" size={12} />
            </span>
            Desktop app · no origin needed
          </span>
        )}
        {extra.map((o) => (
          <span key={o} className="rw-chip rw-chip--mono" data-origin="extra">
            <span className="rw-chip__icon" aria-hidden="true">
              <Icon name="globe" size={12} />
            </span>
            {o}
            <button
              type="button"
              className="rw-chip__remove"
              aria-label={`Remove ${o}`}
              onClick={() => onChange(extra.filter((x) => x !== o))}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <span className="rw-desc rw-desc--tertiary">
          {kind === "web"
            ? "Added automatically from this page"
            : "The relay always admits the Kimo desktop app"}
        </span>
      </div>
      <div className="rw-add-row">
        <Input
          id={id}
          frameProps={{ className: "rw-input-28" }}
          icon={<Icon name="plus" size={16} />}
          placeholder="Add origin, e.g. https://kimo.example.org"
          spellCheck={false}
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add()
          }}
        />
        <Button variant="secondary" className="rw-btn--28" disabled={!draft.trim()} onClick={add}>
          Add
        </Button>
      </div>
      <p className="rw-desc rw-desc--tertiary" role={error ? "alert" : undefined}>
        {error ??
          "Only for extra web hosts that open Kimo in a browser. Read-only chips are added for you."}
      </p>
    </div>
  )
}

/** Keeps the latest value in a ref (for handlers in effects). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
