import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link FileCard}. Native `<button>` props pass through. */
export interface FileCardProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  name: string
  /** Secondary line (`Edited 2 hours ago · 6 frames`). */
  info?: string
  /** Thumbnail content (e.g. an `<img>`); default is the design's placeholder Mini Frame. */
  thumbnail?: ReactNode
}

/** The placeholder page sketch of `FileCard > Thumbnail > Mini Frame` (fBMds). */
export function FileCardMiniFrame() {
  return (
    <span className="kimo-file-card__mini-frame" aria-hidden="true">
      <span className="kimo-file-card__line kimo-file-card__line--a" />
      <span className="kimo-file-card__line kimo-file-card__line--b" />
      <span className="kimo-file-card__line kimo-file-card__line--c" />
    </span>
  )
}

/**
 * Home-screen file tile. Mirrors `FileCard` (byua1): width 260, vertical, gap 10; Thumbnail
 * fill_container × 164, bg-muted, radius-xl, 1px border stroke, padding 24, centered; Meta
 * vertical gap 2: name sans 13 / 500 text-primary, info sans 12 text-tertiary.
 */
export function FileCard({
  name,
  info,
  thumbnail,
  className,
  type = "button",
  ...rest
}: FileCardProps) {
  return (
    <button {...rest} type={type} className={cx("kimo-file-card", className)}>
      <span className="kimo-file-card__thumbnail">{thumbnail ?? <FileCardMiniFrame />}</span>
      <span className="kimo-file-card__meta">
        <span className="kimo-file-card__name">{name}</span>
        {info != null && <span className="kimo-file-card__info">{info}</span>}
      </span>
    </button>
  )
}
