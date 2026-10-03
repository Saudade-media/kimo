import {
  Diamond,
  Hash,
  List,
  type LucideIcon,
  Palette,
  SquareDashed,
  ToggleLeft,
  Type,
} from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Prop types (component props) and variable types. */
export type GlyphType =
  | "text"
  | "boolean"
  | "enum"
  | "instance"
  | "slot"
  | "color"
  | "number"
  | "string"

/** Lucide icon per type (02c `etSt8`): string variables share `type` with text props. */
export const TYPE_GLYPH_ICONS: Readonly<Record<GlyphType, LucideIcon>> = {
  text: Type,
  string: Type,
  boolean: ToggleLeft,
  enum: List,
  instance: Diamond,
  slot: SquareDashed,
  color: Palette,
  number: Hash,
}

/** Props for {@link TypeGlyph}. Remaining `<span>` props go to the frame. */
export interface TypeGlyphProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  type: GlyphType
}

/**
 * Type badge. Mirrors `TypeGlyph` (s5R49): 18 × 18, fill bg-muted, radius-xs, center/center;
 * Icon (OHWJN) 12 text-secondary — `type` · `toggle-left` · `list` · `diamond` ·
 * `square-dashed` · `palette` · `hash`.
 */
export function TypeGlyph({ type, className, ...rest }: TypeGlyphProps) {
  const Icon = TYPE_GLYPH_ICONS[type]
  return (
    <span
      role="img"
      aria-label={type}
      {...rest}
      data-type={type}
      className={cx("kimo-type-glyph", className)}
    >
      <Icon className="kimo-type-glyph__icon" aria-hidden="true" />
    </span>
  )
}
