import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"
import { KIMO_LOGO_PATH, KIMO_LOGO_SMALL_PATH, KIMO_LOGO_VIEWBOX } from "./paths"

/** Which cut of the mark to draw; `auto` picks `small` at 24 px and below. */
export type KimoLogoVariant = "auto" | "regular" | "small"

/** Props for {@link KimoLogo}. Native `<svg>` props pass through. */
export interface KimoLogoProps extends Omit<ComponentPropsWithRef<"svg">, "children"> {
  /** Rendered width and height in px. Default 32 (the KimoLogo component's own frame). */
  size?: number
  /** Default `auto`: KimoLogo/Small (cGzzf) at ≤ 24 px, KimoLogo (bm1JR) above. */
  variant?: KimoLogoVariant
  /** Accessible name; without it the mark is decorative (`aria-hidden`). */
  title?: string
}

/** The largest size that uses the KimoLogo/Small cut under `variant="auto"`. */
export const KIMO_LOGO_SMALL_MAX = 24

/** Resolves `auto` to the cut drawn at `size`. */
export function kimoLogoVariant(
  size: number,
  variant: KimoLogoVariant = "auto",
): "regular" | "small" {
  if (variant !== "auto") return variant
  return size <= KIMO_LOGO_SMALL_MAX ? "small" : "regular"
}

/**
 * The Kimo mark. Mirrors `KimoLogo` (bm1JR, 32 × 32) and `KimoLogo/Small` (cGzzf, 16 × 16): one
 * even-odd path in a 0–100 viewBox filling the frame, no strokes, fill `currentColor` (the
 * design's `$text-primary`, so it follows the theme through the parent's `color`).
 */
export function KimoLogo({
  size = 32,
  variant = "auto",
  title,
  className,
  ...rest
}: KimoLogoProps) {
  const cut = kimoLogoVariant(size, variant)
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative (aria-hidden) unless `title` is given, which adds role="img" + aria-label + <title>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={KIMO_LOGO_VIEWBOX}
      width={size}
      height={size}
      fill="currentColor"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      focusable="false"
      {...rest}
      className={cx("kimo-logo", `kimo-logo--${cut}`, className)}
    >
      {title ? <title>{title}</title> : null}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={cut === "small" ? KIMO_LOGO_SMALL_PATH : KIMO_LOGO_PATH}
      />
    </svg>
  )
}

/** Props for {@link KimoLockup}. Native `<span>` props pass through. */
export interface KimoLockupProps extends ComponentPropsWithRef<"span"> {
  /** The wordmark; default "Kimo". */
  wordmark?: string
}

/**
 * Mark + wordmark. Mirrors `KimoLogo/Lockup` (HmXpT): row, gap 10, align center; KimoLogo 28
 * (MvKrj) then Wordmark (nEfPM) "Kimo" sans 18 / 600, letter-spacing −0.3, text-primary.
 */
export function KimoLockup({ wordmark = "Kimo", className, ...rest }: KimoLockupProps) {
  return (
    <span {...rest} className={cx("kimo-lockup", className)}>
      <KimoLogo size={28} className="kimo-lockup__mark" />
      <span className="kimo-lockup__wordmark">{wordmark}</span>
    </span>
  )
}
