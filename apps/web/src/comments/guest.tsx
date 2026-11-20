/**
 * Board 51 §3 F GuestName (w300, pad 14, gap 10): asked once, on a guest's first comment. Skip
 * posts as the presence name ("Guest 2"); a typed name is saved as the display name (§7).
 */
import { Button, Input } from "@kimo/ui"
import { useState } from "react"
import { t } from "../lib/i18n"

export const guestNameBus = (() => {
  let pending: ((name: string | null) => void) | null = null
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of [...listeners]) l()
  }
  return {
    ask(): Promise<string | null> {
      pending?.(null)
      return new Promise((resolve) => {
        pending = (n) => {
          pending = null
          emit()
          resolve(n)
        }
        emit()
      })
    },
    open: () => pending !== null,
    answer(name: string | null) {
      pending?.(name)
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
})()

export function GuestName() {
  const [name, setName] = useState("")
  const post = () => guestNameBus.answer(name.trim() ? name.trim().slice(0, 64) : null)
  return (
    <div
      className="comment-popover comment-guest"
      role="dialog"
      aria-label={t("comments.guest.title")}
    >
      <span className="comment-guest__title">{t("comments.guest.title")}</span>
      <span className="comment-guest__body">{t("comments.guest.body")}</span>
      <Input
        placeholder={t("comments.guest.placeholder")}
        aria-label={t("comments.guest.placeholder")}
        value={name}
        autoFocus
        maxLength={64}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") post()
          if (e.key === "Escape") guestNameBus.answer(null)
        }}
      />
      <div className="comment-guest__actions">
        <Button onClick={() => guestNameBus.answer(null)}>{t("comments.guest.skip")}</Button>
        <Button variant="primary" onClick={post}>
          {t("comments.guest.post")}
        </Button>
      </div>
    </div>
  )
}
