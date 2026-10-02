/**
 * Text styling and rich-text runs (teardown 10.3: `TextStyle`, `TextSpan`).
 */
import Type, { type Static } from "typebox"
import { Num, RecordOf, Ref, Strict, StringEnum, StringOrRef } from "./primitives"

const opt = Type.Optional

/** `{ px: n }`: an absolute line height. A bare number is a multiplier of the font size. */
export const LineHeightPx = Strict({ px: Type.Number({ minimum: 0 }) })

const textStyleProps = {
  font: opt(StringOrRef),
  size: opt(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Ref])),
  weight: opt(Type.Union([Type.Number({ minimum: 1, maximum: 1000 }), Ref])),
  italic: opt(Type.Boolean()),
  lineHeight: opt(Type.Union([Type.Number({ minimum: 0 }), Ref, LineHeightPx])),
  letterSpacing: opt(Num),
  align: opt(StringEnum(["left", "center", "right", "justify"] as const)),
  valign: opt(StringEnum(["top", "middle", "bottom"] as const)),
  decoration: opt(Type.Array(StringEnum(["underline", "strike"] as const), { uniqueItems: true })),
  case: opt(StringEnum(["upper", "lower", "title"] as const)),
  features: opt(
    RecordOf("^[A-Za-z0-9]{4}$", Type.Union([Type.Boolean(), Type.Number()]), {
      description: "OpenType feature tags.",
    }),
  ),
  href: opt(Type.String()),
}

/**
 * Text styling. `typography` (feature "tokens/composite") binds a typography variable whose
 * fields apply first; inline fields override them.
 */
export const TextStyle = Strict({ ...textStyleProps, typography: opt(Ref) })
export type TextStyle = Static<typeof TextStyle>

/** The value of a "typography" variable: a text style without a nested `typography`. */
export const TypographyValue = Strict(textStyleProps)

/** A rich-text run (feature "text/runs"). Styles apply on top of the node's `style`. */
export const TextSpan = Strict({
  text: Type.String(),
  style: opt(TextStyle),
  href: opt(Type.String()),
})
export type TextSpan = Static<typeof TextSpan>

/** Text content: a literal string, a binding to a string variable, or (feature "text/runs") spans. */
export const TextContent = Type.Union([Type.String(), Ref, Type.Array(TextSpan)])
export type TextContent = Static<typeof TextContent>
