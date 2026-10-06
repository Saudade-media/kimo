import { type ComponentPropsWithRef, type ReactNode, useState } from "react"
import { cx } from "../internal/util"

/** Props for {@link FileCard}. Native `<button>` props pass through. */
export interface FileCardProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  name: string
  /** Secondary line (`Edited 2 hours ago · 6 frames`), or a row of parts (board 37 missing card). */
  info?: ReactNode
  /**
   * Thumbnail content that replaces everything else (board 37 de22N missing file: `file-x`).
   * Default: {@link FileCardProps.image}, else the design's placeholder Mini Frame.
   */
  thumbnail?: ReactNode
  /**
   * Board 37 §9 "Card · preview" (hVoFQ): the file's preview image URL, cover fit, no padding,
   * Mini Frame hidden. Lazy-loaded; null or a failed load shows the placeholder.
   */
  image?: string | null
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
 * fill_container × 164, bg-muted, radius-xl, 1px border stroke, padding 24, centered (with a
 * preview, board 37 hVoFQ: image fill cover, padding 0, clip, Mini Frame hidden); Meta
 * vertical gap 2: name sans 13 / 500 text-primary, info sans 12 text-tertiary.
 */
export function FileCard({
  name,
  info,
  thumbnail,
  image,
  className,
  type = "button",
  ...rest
}: FileCardProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const preview = thumbnail == null && image && failed !== image ? image : null
  return (
    <button {...rest} type={type} className={cx("kimo-file-card", className)}>
      <span
        className={cx("kimo-file-card__thumbnail", preview && "kimo-file-card__thumbnail--image")}
      >
        {thumbnail ??
          (preview ? (
            <img
              className="kimo-file-card__image"
              src={preview}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(preview)}
            />
          ) : (
            <FileCardMiniFrame />
          ))}
      </span>
      <span className="kimo-file-card__meta">
        <span className="kimo-file-card__name">{name}</span>
        {info != null && <span className="kimo-file-card__info">{info}</span>}
      </span>
    </button>
  )
}
