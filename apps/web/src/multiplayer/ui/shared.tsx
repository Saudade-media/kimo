/**
 * Pieces the board 41 share UI shares: the toast sink (the editor's board 15 toast stack, or a
 * provided one in harnesses), the clipboard, the presence avatar and the self-hosting guide link.
 */
import type { KimoPlatform } from "@kimo/platform"
import { Avatar } from "@kimo/ui"
import { type CSSProperties, createContext, useCallback, useContext } from "react"
import { M3Context, type ToastItem } from "../../editor/m3/controller"
import { Icon } from "../../lib/icons"
import { REPO_URL } from "../../settings/help"
import type { PresenceColor } from "../presence"
import { initialsOf, presenceVar } from "./copy"

type ShareToast = Omit<ToastItem, "id" | "duration"> & { duration?: number }

/** Where share toasts go outside an editor (harnesses, Settings). */
const ShareToastContext = createContext<((t: ShareToast) => void) | null>(null)

/** Toast/Danger for failures, Toast for one-shot actions (board 41 section 3 F, board 37 A5). */
export function useShareToast(): (t: ShareToast) => void {
  const m3 = useContext(M3Context)
  const provided = useContext(ShareToastContext)
  return useCallback(
    (t: ShareToast) => {
      if (provided) provided(t)
      else if (m3) m3.toast(t)
      else console.info(`Kimo: ${t.text}`)
    },
    [m3, provided],
  )
}

/** Copies through the platform clipboard when it has one (desktop), else the browser's. */
export function copyText(platform: Pick<KimoPlatform, "clipboard"> | null, text: string) {
  const clip = platform?.clipboard
  return clip ? clip.writeText(text) : navigator.clipboard.writeText(text)
}

/** The self-hosting guide: apps/server/README.md (running kimo-relay with Docker or a binary). */
export const RELAY_GUIDE_URL = `${REPO_URL}/blob/main/apps/server/README.md`

export function openRelayGuide(platform: Pick<KimoPlatform, "files"> | null) {
  if (platform) return platform.files.openExternalUrl(RELAY_GUIDE_URL)
  window.open(RELAY_GUIDE_URL, "_blank", "noopener")
  return Promise.resolve()
}

/** Avatar (FVhW0) in a person's presence color, initials on-accent (board 41 overrides). */
export function PresenceAvatar({ label, color }: { label: string; color: PresenceColor }) {
  return (
    <Avatar
      name={label}
      initials={initialsOf(label)}
      className="mp-avatar"
      data-color={color}
      style={{ "--mp-color": presenceVar(color) } as CSSProperties}
    />
  )
}

/** The guide link: book-open (popover only) · label · arrow-up-right. */
export function GuideLink({
  label,
  leadingIcon,
  className,
  onOpen,
}: {
  label: string
  leadingIcon: boolean
  className?: string
  onOpen(): void
}) {
  return (
    <button
      type="button"
      className={`mp-guide${className ? ` ${className}` : ""}`}
      onClick={onOpen}
    >
      {leadingIcon && (
        <span className="mp-guide__icon">
          <Icon name="book-open" size={14} />
        </span>
      )}
      <span className="mp-guide__label">{label}</span>
      <span className="mp-guide__external">
        <Icon name="arrow-up-right" size={12} />
      </span>
    </button>
  )
}
