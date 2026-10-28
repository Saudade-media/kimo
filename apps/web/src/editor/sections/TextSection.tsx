/**
 * Text section — board 20 "Text section" (YjE2h): `PropSection` "Text" (RuAZI, action
 * `ellipsis`) after Position and before Fill. Body (qgOXF): column, gap 8:
 *   Family Row (RWKxU): Font family Select (nvXM0) → Font Picker (azBUI) left of the panel;
 *     open: bg-hover, 1px border-strong, chevron-up.
 *   Weight Size Row (nk7RJ): Weight Select (XaZS6) · Size PropField w 96 (qPc99, a-large-small).
 *   Spacing Row (NEORl): Line height (iNueq, unfold-vertical) · Letter spacing (F2LMZX,
 *     unfold-horizontal), both fill.
 *   Align Row (Z6F9a9, space-between): Text align Segmented ×4 (RnqeI) · Vertical align ×3
 *     (rVxqw, disabled unless Resizing = Fixed size).
 *   Resizing (l7RLS1) / Decoration (OhisU) / Case (a5p1T9) rows: h 28, gap 8: label sans 12
 *     text-secondary · Spacer · Segmented (AL4la ×3, Y3EBJm ×3, E5X5j7 ×4).
 * Every control is one undo step per gesture (scrubs collapse); a multi-selection shows "Mixed"
 * and no selected segment where the nodes differ.
 *
 * Board 21 "Text section · “…” menu" (N6MWL): the header ellipsis (pressed: 20 × 20 bg-muted,
 * ellipsis text-primary) opens Menu/Dense ndO4D (256, below, right-aligned, flips up): Style
 * (Italic ⌘I, Link… ⌘K), OpenType features (liga / calt checked by default, tnum, zero, smcp,
 * frac, Stylistic sets ss01–20 submenu, Custom tag…), Reset text style. Italic on → an "Italic"
 * row with Toggle/On (G0AWh7); active non-default tags → a "Features" row of removable chips
 * (SE1Ap). Only §8.2 TextStyle fields without a row: italic, href, features.
 *
 * Board 24 gaps: (a) "Link… popover" (NpwJS) opens from ⌘K / "Link…" left of the panel (Enter
 * applies, an empty field + Enter removes; http(s), mailto:, tel: and #frame only); (b) "Custom
 * tag…" (Ehror) expands inline in the menu (tag exactly 4 chars a–z 0–9, value 0–99, default 1;
 * duplicates replace); (k) a 6px $warning dot on the Weight field when the family lacks the
 * weight, with a tooltip naming the weight actually rendered (QfSAK).
 *
 * Board 25 §6: (b) the Link… popover's invalid state (u0adcp) lives in `LinkPopover`; (d) font
 * support (g95jKz): the Custom tag hint says whether the resolved face has the tag ("cv11 is in
 * Inter" / "… isn't in … — it will be saved but has no effect"), and active tags without a row
 * of their own get an OpenTypeFeatureRow (LFdEa) marked "not in font" when the face lacks them —
 * checked against the face's GSUB / GPOS FeatureList (`fonts/font-features.ts`).
 */
import type { LayoutResult } from "@kimo/layout"
import {
  CustomTagField,
  IconButton,
  LinkPopover,
  MenuDense,
  MenuDivider,
  MenuItemDense,
  MissingWeightTooltip,
  OpenTypeFeatureRow,
  PropRow,
  PropSection,
  Segmented,
  Toggle,
  WarningDot,
} from "@kimo/ui"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import "./text-more.css"
import { realId } from "../../canvas/rich-text/panel-bridge"
import type { RichTextSession } from "../../canvas/rich-text/session"
import { FontPicker, missingWeight, useFontPickerEntries } from "../../fonts"
import type { FontSystem } from "../../fonts/font-system"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import { matches } from "../../shortcuts/shortcuts"
import { Bindable, StaticField, useBindRequest } from "../bind"
import { sharedRef } from "../bindings"
import { useFailureToast } from "../failure-toast"
import { NumberField } from "../fields"
import { keyHint } from "../kbd"
import { SectionTitle } from "../m3/overrides"
import { panelPlacement, type Sel, useKeepPopoverFocus, usePanel } from "../panel-context"
import { formatNumber, MIXED, MIXED_LABEL, type Mixed } from "../props"
import {
  alignOf,
  alignValue,
  caseOf,
  caseValue,
  decorationOf,
  decorationValue,
  fontOf,
  growOf,
  growOps,
  letterSpacingText,
  lineHeightText,
  parseLetterSpacing,
  parseLineHeight,
  sharedText,
  sizeNumber,
  sizeOf,
  styleOf,
  styleOps,
  TEXT_DEFAULTS,
  type TextAlign,
  type TextCase,
  type TextDecoration,
  type TextGrow,
  type TextVAlign,
  valignOf,
  valignValue,
  WEIGHT_NAMES,
  weightName,
  weightOf,
} from "../text"

const ALIGN: { value: TextAlign; label: string; icon: string }[] = [
  { value: "left", label: "Align left", icon: "text-align-start" },
  { value: "center", label: "Align center", icon: "text-align-center" },
  { value: "right", label: "Align right", icon: "text-align-end" },
  { value: "justify", label: "Justify", icon: "text-align-justify" },
]
const VALIGN: { value: TextVAlign; label: string; icon: string }[] = [
  { value: "top", label: "Align top", icon: "arrow-up-to-line" },
  { value: "middle", label: "Align middle", icon: "fold-vertical" },
  { value: "bottom", label: "Align bottom", icon: "arrow-down-to-line" },
]
const GROW: { value: TextGrow; label: string; icon: string }[] = [
  { value: "auto", label: "Auto width", icon: "move-horizontal" },
  { value: "fixed-width", label: "Auto height", icon: "text-wrap" },
  { value: "fixed", label: "Fixed size", icon: "square-dashed" },
]
const DECORATION: { value: TextDecoration; label: string; icon: string }[] = [
  { value: "none", label: "No decoration", icon: "minus" },
  { value: "underline", label: "Underline", icon: "underline" },
  { value: "strike", label: "Strikethrough", icon: "strikethrough" },
]
const CASE: { value: TextCase; label: string; icon: string }[] = [
  { value: "none", label: "As typed", icon: "minus" },
  { value: "upper", label: "Uppercase", icon: "case-upper" },
  { value: "lower", label: "Lowercase", icon: "case-lower" },
  { value: "title", label: "Title case", icon: "case-sensitive" },
]

const options = <V extends string>(
  list: { value: V; label: string; icon: string }[],
  disabled = false,
) =>
  list.map((o) => ({
    value: o.value,
    label: o.label,
    icon: <Icon name={o.icon} size={14} />,
    disabled,
  }))

const one = <T,>(v: T | Mixed): T | null => (v === MIXED ? null : v)
const round = (n: number) => Math.round(n * 100) / 100

export function TextSection({
  sel,
  fonts,
  editing = null,
}: {
  sel: readonly Sel[]
  fonts: FontSystem | null
  /** Board 30: the live text edit of the selected text (values are its selection's). */
  editing?: RichTextSession | null
}) {
  const { editor, layout } = usePanel()
  const nodes = sel.map((s) => s.node)
  const font = sharedText(nodes, fontOf)
  const weight = sharedText(nodes, weightOf)
  const size = sharedText(nodes, sizeOf)
  const lineHeight = sharedText(nodes, lineHeightText)
  const letterSpacing = sharedText(nodes, letterSpacingText)
  const align = sharedText(nodes, alignOf)
  const valign = sharedText(nodes, valignOf)
  const grow = sharedText(nodes, growOf)
  const decoration = sharedText(nodes, decorationOf)
  const textCase = sharedText(nodes, caseOf)
  const italic = sharedText(nodes, (n) => styleOf(n).italic === true)
  const href = sharedText(nodes, (n) =>
    typeof styleOf(n).href === "string" ? (styleOf(n).href as string) : "",
  )
  const features = featuresOf(nodes[0] ?? null)

  const [fontOpen, setFontOpen] = useState(false)
  const [weightOpen, setWeightOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [weightTip, setWeightTip] = useState({ hover: false, focus: false })
  const runtime = useOptionalRuntime()
  const fail = useFailureToast()
  // Link "Open": a new tab on the web, the default app on desktop (web, mail and phone links;
  // G1). A refused link says why.
  const openExternal = async (url: string) => {
    if (runtime)
      await runtime.platform.files
        .openExternalUrl(url)
        .catch((e: unknown) => fail("open the link", e))
    else window.open(url, "_blank", "noopener,noreferrer")
  }
  const family = font === MIXED ? null : font
  // Board 25 §6 (d): the resolved face's OpenType features (null = can't be inspected).
  const fontFeatures = useFontFeatures(
    moreOpen ? fonts : null,
    family,
    typeof weight === "number" ? weight : 400,
    italic === true,
  )
  const shippedWeights = useShippedWeights(fonts, family)
  const weightWarning =
    family && typeof weight === "number" ? missingWeight(family, weight, shippedWeights) : null
  const italicMissing = useItalicMissing(
    fonts,
    font === MIXED ? null : font,
    typeof weight === "number" ? weight : 400,
  )
  const toggleItalic = () =>
    editor.apply(
      styleOps(sel, "italic", () => (italic === true ? undefined : true)),
      italic === true ? "Remove italic" : "Set italic",
    )
  // ⌘I italic, ⌘K link (rules "Italic", "Link…"), outside text fields.
  const keys = useRef({ toggleItalic, openLink: () => setLinkOpen(true) })
  keys.current = { toggleItalic, openLink: () => setLinkOpen(true) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return
      if (matches("italic", e)) {
        e.preventDefault()
        keys.current.toggleItalic()
      } else if (matches("link", e)) {
        e.preventDefault()
        keys.current.openLink()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const fontTrigger = useRef<HTMLButtonElement>(null)
  const weightTrigger = useRef<HTMLButtonElement>(null)
  const moreAnchor = useRef<HTMLSpanElement>(null)
  useKeepPopoverFocus(fontOpen)

  // Board 30: ⌘K while editing opens the Link… popover for the editor's selection.
  useEffect(() => editing?.onLinkRequest(() => setLinkOpen(true)), [editing])

  const laid = (id: string) => {
    const b = (layout.get() as LayoutResult | null)?.nodes.get(realId(id))?.local
    return b ? { w: b.w, h: b.h } : null
  }

  return (
    <PropSection
      className={moreOpen ? "rp-text-section rp-text-section--more-open" : "rp-text-section"}
      title={<SectionTitle label="Text" fields={["style", "grow", "content"]} />}
      action={{
        label: "More text options",
        icon: (
          <span ref={moreAnchor} className="rp-text__more">
            <Icon name="ellipsis" size={14} />
          </span>
        ),
        onClick: () => setMoreOpen((o) => !o),
      }}
      data-testid="text-section"
    >
      <div className="rp-body">
        <ContentRow sel={sel} />
        {/* Family Row (RWKxU) */}
        <PropRow className="rp-row">
          {/* Board 27 §7: font family binds a string variable. */}
          <Bindable
            sel={sel}
            spec={{
              type: "string",
              label: "Font family",
              get: (n) => styleOf(n).font ?? TEXT_DEFAULTS.font,
              put: (s, v) => styleOps([s], "font", () => v),
              current: () => (font === MIXED || font.startsWith("$") ? null : font),
              varBase: "font",
            }}
          >
            {(bind) => (
              <div className={`rp-select-bind ${bind.className}`}>
                <button
                  ref={fontTrigger}
                  type="button"
                  className={fontOpen ? "rp-select rp-select--open" : "rp-select"}
                  aria-label="Font family"
                  aria-haspopup="dialog"
                  aria-expanded={fontOpen}
                  onClick={() => setFontOpen((o) => !o)}
                >
                  <span className="rp-select__value">{font === MIXED ? MIXED_LABEL : font}</span>
                  <span className="rp-select__chevron" aria-hidden="true">
                    <Icon name={fontOpen ? "chevron-up" : "chevron-down"} size={14} />
                  </span>
                </button>
                {bind.trailing}
              </div>
            )}
          </Bindable>
        </PropRow>
        {/* Weight Size Row (nk7RJ) */}
        <PropRow className="rp-row">
          {/* Board 27 §7: font weight binds a number variable. */}
          <Bindable
            sel={sel}
            spec={{
              type: "number",
              label: "Font weight",
              prefix: "Wt",
              get: (n) => styleOf(n).weight ?? TEXT_DEFAULTS.weight,
              put: (s, v) => styleOps([s], "weight", () => v),
              current: () => (typeof weight === "number" ? weight : null),
              varBase: "font/weight",
            }}
          >
            {(bind) => (
              <div className={`rp-select-bind ${bind.className}`}>
                <button
                  ref={weightTrigger}
                  type="button"
                  className={[
                    "rp-select",
                    weightOpen && "rp-select--open",
                    weightWarning && "rp-select--warning",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label="Font weight"
                  aria-haspopup="menu"
                  aria-expanded={weightOpen}
                  aria-description={weightWarning ? weightWarning.title : undefined}
                  onClick={() => setWeightOpen((o) => !o)}
                  onPointerEnter={() => setWeightTip((t) => ({ ...t, hover: true }))}
                  onPointerLeave={() => setWeightTip((t) => ({ ...t, hover: false }))}
                  onFocus={() => setWeightTip((t) => ({ ...t, focus: true }))}
                  onBlur={() => setWeightTip((t) => ({ ...t, focus: false }))}
                  onKeyDown={(e) => {
                    if (!weightOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                      e.preventDefault()
                      setWeightOpen(true)
                    }
                  }}
                >
                  <span className="rp-select__value">
                    {weight === MIXED
                      ? MIXED_LABEL
                      : typeof weight === "number"
                        ? weightName(weight)
                        : weight}
                  </span>
                  {weightWarning && (
                    <>
                      <span className="rp-select__spacer" aria-hidden="true" />
                      <WarningDot className="rp-select__warning" data-testid="weight-warning-dot" />
                    </>
                  )}
                  <span className="rp-select__chevron" aria-hidden="true">
                    <Icon name={weightOpen ? "chevron-up" : "chevron-down"} size={14} />
                  </span>
                </button>
                {bind.trailing}
              </div>
            )}
          </Bindable>
          {/* Board 27 §7: font size binds a number variable, chip prefix "Sz" (cNy0g). */}
          <Bindable
            sel={sel}
            className="rp-bind--w96"
            spec={{
              type: "number",
              label: "Font size",
              prefix: "Sz",
              get: (n) => styleOf(n).size ?? TEXT_DEFAULTS.size,
              put: (s, v) => styleOps([s], "size", () => v),
              current: () => (typeof size === "number" ? size : null),
              varBase: "font/size",
            }}
          >
            {(bind) => (
              <NumberField
                icon="a-large-small"
                label="Font size"
                bind={bind}
                className="rp-field--w96"
                value={size}
                editor={editor}
                min={1}
                onNumber={(n) => styleOps(sel, "size", () => Math.max(1, round(n)))}
                relative={() => {
                  const base = sel.map((s) => ({ s, v: sizeNumber(s.node) }))
                  return (d) =>
                    base.flatMap(({ s, v }) =>
                      styleOps([s], "size", () => Math.max(1, round(v + d))),
                    )
                }}
              />
            )}
          </Bindable>
        </PropRow>
        {/* Spacing Row (NEORl) */}
        <PropRow className="rp-row">
          {/* Board 27 §7: line height binds a number variable (a multiplier), prefix "LH". */}
          <Bindable
            sel={sel}
            spec={{
              type: "number",
              label: "Line height",
              prefix: "LH",
              get: (n) => styleOf(n).lineHeight ?? null,
              put: (s, v) => styleOps([s], "lineHeight", () => v),
              format: (v) => `${formatNumber(Number(v) * 100)}%`,
              current: () => {
                const lhs = sel.map((s) => styleOf(s.node).lineHeight)
                const v0 = lhs[0]
                return typeof v0 === "number" && lhs.every((v) => v === v0) ? v0 : null
              },
              varBase: "font/line-height",
            }}
          >
            {(bind) => (
              <NumberField
                bind={bind}
                icon="unfold-vertical"
                label="Line height"
                value={lineHeight}
                editor={editor}
                min={0}
                onNumber={(n) => styleOps(sel, "lineHeight", () => Math.max(0, round(n) / 100))}
                onText={(t) => {
                  const v = parseLineHeight(t)
                  return v === null ? null : styleOps(sel, "lineHeight", () => v)
                }}
                relative={() => {
                  const base = sel.map((s) => {
                    const lh = styleOf(s.node).lineHeight
                    return { s, v: typeof lh === "number" ? lh * 100 : 120 }
                  })
                  return (d) =>
                    base.flatMap(({ s, v }) =>
                      styleOps([s], "lineHeight", () => Math.max(0, round(v + d)) / 100),
                    )
                }}
              />
            )}
          </Bindable>
          {/* Board 27 §7: letter spacing binds a number variable (px), prefix "LS". */}
          <Bindable
            sel={sel}
            spec={{
              type: "number",
              label: "Letter spacing",
              prefix: "LS",
              get: (n) => styleOf(n).letterSpacing ?? 0,
              put: (s, v) => styleOps([s], "letterSpacing", () => (v === 0 ? undefined : v)),
              format: (v) => `${formatNumber(Number(v))}px`,
              current: () => {
                const ls = sel.map((s) => styleOf(s.node).letterSpacing ?? 0)
                const v0 = ls[0]
                return typeof v0 === "number" && ls.every((v) => v === v0) ? v0 : null
              },
              varBase: "font/tracking",
            }}
          >
            {(bind) => (
              <NumberField
                bind={bind}
                icon="unfold-horizontal"
                label="Letter spacing"
                value={letterSpacing}
                editor={editor}
                step={0.1}
                onNumber={(n) =>
                  styleOps(sel, "letterSpacing", (node) => {
                    const px = round((n * sizeNumber(node)) / 100)
                    return px === 0 ? undefined : px
                  })
                }
                onText={(t) => {
                  const ops = sel.map((s) => {
                    const px = parseLetterSpacing(t, sizeNumber(s.node))
                    return px === null
                      ? null
                      : styleOps([s], "letterSpacing", () => (px === 0 ? undefined : px))
                  })
                  return ops.some((o) => o === null)
                    ? null
                    : (ops.flat() as ReturnType<typeof styleOps>)
                }}
                relative={() => {
                  const base = sel.map((s) => {
                    const ls = styleOf(s.node).letterSpacing
                    const px = typeof ls === "number" ? ls : 0
                    return { s, pct: (px / sizeNumber(s.node)) * 100 }
                  })
                  return (d) =>
                    base.flatMap(({ s, pct }) =>
                      styleOps([s], "letterSpacing", (node) => {
                        const px = round(((pct + d) * sizeNumber(node)) / 100)
                        return px === 0 ? undefined : px
                      }),
                    )
                }}
              />
            )}
          </Bindable>
        </PropRow>
        {/* Align Row (Z6F9a9): space-between */}
        <div className="rp-text__align-row">
          <Segmented
            label="Text align"
            options={options(ALIGN)}
            value={one(align)}
            onChange={(v) =>
              editor.apply(
                styleOps(sel, "align", () => alignValue(v)),
                "Set text align",
              )
            }
          />
          <Segmented
            label="Vertical align"
            options={options(VALIGN, grow !== "fixed")}
            value={one(valign)}
            onChange={(v) =>
              editor.apply(
                styleOps(sel, "valign", () => valignValue(v)),
                "Set vertical align",
              )
            }
          />
        </div>
        <SegmentedRow
          label="Resizing"
          options={options(GROW)}
          value={one(grow)}
          onChange={(v) => editor.apply(growOps(sel, v, laid), "Set text resizing")}
        />
        <SegmentedRow
          label="Decoration"
          options={options(DECORATION)}
          value={decoration === MIXED ? null : decoration}
          onChange={(v) =>
            editor.apply(
              styleOps(sel, "decoration", () => decorationValue(v)),
              "Set decoration",
            )
          }
        />
        <SegmentedRow
          label="Case"
          options={options(CASE)}
          value={one(textCase)}
          onChange={(v) =>
            editor.apply(
              styleOps(sel, "case", () => caseValue(v)),
              "Set text case",
            )
          }
        />
        {/* Italic Row (G0AWh7): only while italic is on */}
        {italic !== false && (
          <div className="rp-toggle-row" data-testid="text-italic-row">
            <span className="rp-toggle-row__label">Italic</span>
            <span className="rp-spacer" />
            <Toggle
              checked={italic === true}
              label="Italic"
              onChange={(on) =>
                editor.apply(
                  styleOps(sel, "italic", () => (on ? true : undefined)),
                  on ? "Set italic" : "Remove italic",
                )
              }
            />
          </div>
        )}
        {/* Features Row (SE1Ap): active non-default tags as removable chips */}
        {activeFeatures(features).length > 0 && (
          <div className="rp-toggle-row" data-testid="text-features-row">
            <span className="rp-toggle-row__label">Features</span>
            <span className="rp-spacer" />
            {activeFeatures(features).map(([tag, v]) => (
              <span key={tag} className="rp-feature-chip" data-tag={tag}>
                <span className="rp-feature-chip__tag">{featureChipLabel(tag, v)}</span>
                <button
                  type="button"
                  className="rp-feature-chip__remove"
                  aria-label={`Remove ${tag}`}
                  onClick={() => editor.apply(featureOps(sel, tag, undefined), `Remove ${tag}`)}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
            <IconButton
              className="rp-feature-add"
              tone="quiet"
              label="Add feature"
              icon={<Icon name="plus" size={12} />}
              onClick={() => setMoreOpen(true)}
            />
          </div>
        )}
      </div>
      {fontOpen && fontTrigger.current && (
        <FontPickerHost
          anchor={fontTrigger.current}
          fonts={fonts}
          value={font === MIXED ? null : font}
          onPick={(family) =>
            editor.apply(
              styleOps(sel, "font", () => family),
              "Set font",
            )
          }
          onClose={() => {
            setFontOpen(false)
            fontTrigger.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {weightWarning && !weightOpen && (weightTip.hover || weightTip.focus) && (
        <MissingWeightTooltip
          anchor={weightTrigger.current}
          title={weightWarning.title}
          body={weightWarning.body}
          data-testid="weight-warning-tooltip"
        />
      )}
      {linkOpen && moreAnchor.current && (
        <LinkPopover
          anchor={moreAnchor.current.closest("button") ?? moreAnchor.current}
          placement={panelPlacement(moreAnchor.current)}
          value={href === MIXED ? "" : href}
          data-testid="text-link-popover"
          onOpen={(url) => void openExternal(url)}
          onApply={(url) => {
            setLinkOpen(false)
            editor.apply(
              styleOps(sel, "href", () => url),
              "Set link",
            )
          }}
          onRemove={() => {
            setLinkOpen(false)
            editor.apply(
              styleOps(sel, "href", () => undefined),
              "Remove link",
            )
          }}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {weightOpen && weightTrigger.current && (
        <WeightMenu
          anchor={weightTrigger.current}
          fonts={fonts}
          family={font === MIXED ? null : font}
          value={typeof weight === "number" ? weight : null}
          onPick={(w) =>
            editor.apply(
              styleOps(sel, "weight", () => (w === 400 ? undefined : w)),
              "Set weight",
            )
          }
          onClose={() => {
            setWeightOpen(false)
            weightTrigger.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {moreOpen && moreAnchor.current && (
        <TextMoreMenu
          anchor={moreAnchor.current.closest("button") ?? moreAnchor.current}
          italic={italic === true}
          italicMissing={italicMissing}
          linked={href !== "" && href !== MIXED}
          features={features}
          family={family}
          fontFeatures={fontFeatures}
          onClose={() => setMoreOpen(false)}
          onItalic={() => {
            setMoreOpen(false)
            toggleItalic()
          }}
          onLink={() => {
            setMoreOpen(false)
            setLinkOpen(true)
          }}
          onFeature={(tag, value) => editor.apply(featureOps(sel, tag, value), `Set ${tag}`)}
          onReset={() => {
            setMoreOpen(false)
            editor.apply(resetStyleOps(sel), "Reset text style")
          }}
        />
      )}
    </PropSection>
  )
}

/** Resizing / Decoration / Case rows (l7RLS1, OhisU, a5p1T9): h 28, gap 8. */
/**
 * Board 27 §7 (c) Content (EYpeL): text content bound to a string variable shows its chip at the
 * top of the Text section (full width, no prefix); also shown for a "Bind text…" request.
 */
function ContentRow({ sel }: { sel: readonly Sel[] }) {
  const [requested, clear] = useBindRequest("content")
  const bound = sharedRef(sel.map((s) => s.node.content)) !== null
  if (!bound && !requested) return null
  const text = sharedText(
    sel.map((s) => s.node),
    (n) => (typeof n.content === "string" ? n.content : null),
  )
  return (
    <Bindable
      sel={sel}
      defaultOpen={requested && !bound}
      onPickerClose={clear}
      spec={{
        type: "string",
        label: "Text",
        get: (n) => n.content,
        put: (s, v) => [{ op: "update", id: s.id, set: { content: v } }],
        format: (v) => `\u201c${String(v)}\u201d`,
        current: () => (typeof text === "string" ? text : null),
        varBase: "copy",
      }}
    >
      {(bind) => (
        <StaticField
          value={text === MIXED ? MIXED_LABEL : text === null ? "Rich text" : text}
          bind={bind}
        />
      )}
    </Bindable>
  )
}

function SegmentedRow<V extends string>({
  label,
  options: opts,
  value,
  onChange,
}: {
  label: string
  options: { value: V; label: string; icon: ReactNode; disabled?: boolean }[]
  value: V | null
  onChange(v: V): void
}) {
  return (
    <div className="rp-toggle-row">
      <span className="rp-toggle-row__label">{label}</span>
      <span className="rp-spacer" />
      <Segmented label={label} options={opts} value={value} onChange={onChange} />
    </div>
  )
}

/** The board 19 Font Picker (azBUI), left of the panel and top-aligned to the row. */
function FontPickerHost({
  anchor,
  fonts,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLElement
  fonts: FontSystem | null
  value: string | null
  onPick(family: string): void
  onClose(): void
}) {
  const runtime = useOptionalRuntime()
  const { session } = usePanel()
  // The document's fonts as of opening (IN THIS DOCUMENT): recomputed per open, not per edit.
  const doc = useMemo(() => session.store.toDocument(), [session])
  if (!runtime || !fonts) return null
  return (
    <FontPickerWithEntries
      anchor={anchor}
      runtime={runtime}
      fonts={fonts}
      doc={doc}
      value={value}
      onPick={onPick}
      onClose={onClose}
    />
  )
}

function FontPickerWithEntries({
  anchor,
  runtime,
  fonts,
  doc,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLElement
  runtime: NonNullable<ReturnType<typeof useOptionalRuntime>>
  fonts: FontSystem
  doc: ReturnType<FileSessionLike["store"]["toDocument"]>
  value: string | null
  onPick(family: string): void
  onClose(): void
}) {
  const { entries, google } = useFontPickerEntries(runtime.platform, fonts, doc)
  return (
    <FontPicker
      anchor={anchor}
      placement={panelPlacement(anchor)}
      value={value}
      entries={entries}
      google={google}
      onPick={(f) => {
        onPick(f)
        onClose()
      }}
      onClose={onClose}
    />
  )
}

type FileSessionLike = ReturnType<typeof usePanel>["session"]

/**
 * The Weight menu (Menu/Dense under the Select): Thin … Black. Board 20 rule L419s: only the
 * weights the resolved font ships; the current weight, when missing, shows in italics with a
 * warning dot.
 */
function WeightMenu({
  anchor,
  fonts,
  family,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLElement
  fonts: FontSystem | null
  family: string | null
  value: number | null
  onPick(w: number): void
  onClose(): void
}) {
  const shipped = useShippedWeights(fonts, family)
  const list = WEIGHT_NAMES.filter(([w]) => shipped === null || shipped.has(w) || w === value)
  return (
    <MenuDense
      anchor={anchor}
      width={anchor.getBoundingClientRect().width}
      label="Font weight"
      autoFocus
      onClose={onClose}
    >
      {list.map(([w, name]) => {
        const missing = shipped !== null && !shipped.has(w)
        return (
          <MenuItemDense
            key={w}
            label={name}
            checked={w === value}
            meta={formatNumber(w)}
            className={missing ? "rp-weight--missing" : undefined}
            title={missing ? `${family ?? "This font"} has no ${name} style` : undefined}
            onSelect={() => {
              onPick(w)
              onClose()
            }}
          />
        )
      })}
    </MenuDense>
  )
}

/**
 * Weights the family ships (null while unknown: every weight is offered). Board 24 (k): exact
 * upright weights from the font system (`availability` matches the nearest face, so it cannot
 * tell a missing weight apart); re-read when fonts change (install, fetch, settings).
 */
function useShippedWeights(fonts: FontSystem | null, family: string | null): Set<number> | null {
  const [state, setState] = useState<{ family: string; weights: Set<number> | null } | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => fonts?.subscribe(() => setVersion((v) => v + 1)), [fonts])
  useEffect(() => {
    if (!fonts || !family || family.startsWith("$")) return
    let live = true
    void version
    void fonts
      .shippedWeights(family)
      .catch(() => null)
      .then((weights) => {
        if (live) setState({ family, weights })
      })
    return () => {
      live = false
    }
  }, [fonts, family, version])
  return state?.family === family ? state.weights : null
}

// --- Board 21 "…" menu (N6MWL) -----------------------------------------------------------------

type FeatureValue = boolean | number
type Features = Readonly<Record<string, FeatureValue>>

/** Font-default features: shown checked when absent; unchecking writes `false`. */
const DEFAULT_ON = new Set(["liga", "calt"])

/** The OpenType rows of the menu (ndO4D), in board order. */
const FEATURE_ITEMS: readonly { tag: string; label: string }[] = [
  { tag: "liga", label: "Standard ligatures" },
  { tag: "calt", label: "Contextual alternates" },
  { tag: "tnum", label: "Tabular numbers" },
  { tag: "zero", label: "Slashed zero" },
  { tag: "smcp", label: "Small caps" },
  { tag: "frac", label: "Fractions" },
]

/** ss01 … ss20. */
const STYLISTIC_SETS = Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, "0")}`)

function featuresOf(node: Sel["node"] | null): Features {
  const f = node ? styleOf(node).features : undefined
  if (!f || typeof f !== "object" || Array.isArray(f)) return {}
  const out: Record<string, FeatureValue> = {}
  for (const [k, v] of Object.entries(f as Record<string, unknown>))
    if (typeof v === "boolean" || typeof v === "number") out[k] = v
  return out
}

/** Checked state of a tag (rule: liga / calt checked by default). */
export function featureOn(features: Features, tag: string): boolean {
  const v = features[tag]
  if (v === undefined) return DEFAULT_ON.has(tag)
  return v !== false && v !== 0
}

/** Tags that differ from the font defaults (Features row chips), in insertion order. */
function activeFeatures(features: Features): [string, FeatureValue][] {
  return Object.entries(features).filter(([tag, v]) => !(DEFAULT_ON.has(tag) && v === true))
}

function featureChipLabel(tag: string, v: FeatureValue): string {
  if (v === false) return `${tag} off`
  if (typeof v === "number") return `${tag} = ${v}`
  return tag
}

/** The value a menu toggle writes: back to the default removes the key. */
export function toggledFeature(features: Features, tag: string): FeatureValue | undefined {
  const on = featureOn(features, tag)
  if (DEFAULT_ON.has(tag)) return on ? false : undefined
  return on ? undefined : true
}

/**
 * Board 25 §6 (d): active tags the menu has no row for (custom tags, stylistic sets that are
 * on), in insertion order — each gets an {@link OpenTypeFeatureRow}.
 */
function customFeatures(features: Features): string[] {
  const rows = new Set(FEATURE_ITEMS.map((f) => f.tag))
  return Object.entries(features)
    .filter(([tag, v]) => !rows.has(tag) && v !== false && v !== 0)
    .map(([tag]) => tag)
}

/** Board 25 §6 (d): the feature tags of the face the canvas renders (family, weight, style). */
function useFontFeatures(
  fonts: FontSystem | null,
  family: string | null,
  weight: number,
  italic: boolean,
): ReadonlySet<string> | null {
  const key = `${family}|${weight}|${italic}`
  const [state, setState] = useState<{ key: string; tags: ReadonlySet<string> | null } | null>(null)
  useEffect(() => {
    if (!fonts || !family || family.startsWith("$")) return
    let live = true
    void fonts
      .features({ family, weight, style: italic ? "italic" : "normal" })
      .catch(() => null)
      .then((tags) => {
        if (live) setState({ key: `${family}|${weight}|${italic}`, tags })
      })
    return () => {
      live = false
    }
  }, [fonts, family, weight, italic])
  return state?.key === key ? state.tags : null
}

/** Board 24 (b): a custom tag's value; 1 (the default) is stored as plain "on". */
function customFeatureValue(value: number): FeatureValue {
  return value === 1 ? true : value
}

function featureOps(sel: readonly Sel[], tag: string, value: FeatureValue | undefined) {
  return styleOps(sel, "features", (node) => {
    const next: Record<string, FeatureValue> = { ...featuresOf(node) }
    if (value === undefined) delete next[tag]
    else next[tag] = value
    return Object.keys(next).length === 0 ? undefined : next
  })
}

/** Rule "Reset text style": drops italic, href, features, decoration and case; keeps the rest. */
const RESET_KEYS = ["italic", "href", "features", "decoration", "case"] as const

export function resetStyleOps(sel: readonly Sel[]) {
  return sel.map(({ id, node }) => {
    const next = { ...styleOf(node) }
    for (const k of RESET_KEYS) delete next[k]
    return Object.keys(next).length === 0
      ? { op: "update" as const, id, unset: ["style"] }
      : { op: "update" as const, id, set: { style: next } }
  })
}

function TextMoreMenu({
  anchor,
  italic,
  italicMissing,
  linked,
  features,
  family,
  fontFeatures,
  onClose,
  onItalic,
  onLink,
  onFeature,
  onReset,
}: {
  anchor: HTMLElement
  italic: boolean
  italicMissing: boolean
  linked: boolean
  features: Features
  family: string | null
  /** Board 25 §6 (d): the resolved face's feature tags; null = unknown (no hint, no mark). */
  fontFeatures: ReadonlySet<string> | null
  onClose(): void
  onItalic(): void
  onLink(): void
  onFeature(tag: string, value: FeatureValue | undefined): void
  onReset(): void
}) {
  const [sets, setSets] = useState<HTMLElement | null>(null)
  const [custom, setCustom] = useState(false)
  // Opens with the first item (Italic) highlighted, as in the vignette (n2stOD), not the first
  // checked feature: wait for the anchored menu to become visible, then focus it.
  useEffect(() => {
    let frames = 0
    let raf = 0
    const tick = () => {
      const first = document.querySelector<HTMLElement>(
        '[data-testid="text-more-menu"] .kimo-menu-item-dense',
      )
      const menu = first?.closest<HTMLElement>(".kimo-menu-dense")
      if (first && menu && getComputedStyle(menu).visibility !== "hidden") first.focus()
      else if (frames++ < 30) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <>
      <MenuDense
        anchor={anchor}
        placement={{ side: "bottom", align: "end" }}
        width={256}
        label="More text options"
        className="rp-text-menu"
        data-testid="text-more-menu"
        onClose={() => {
          if (!sets) onClose()
        }}
      >
        <div className="rp-text-menu__group" role="presentation">
          <span className="rp-text-menu__group-label">Style</span>
        </div>
        <MenuItemDense
          label="Italic"
          checked={italic}
          meta={keyHint("italic", "⌘I")}
          className={
            italicMissing ? "rp-text-menu__item rp-text-menu__item--missing" : "rp-text-menu__item"
          }
          title={italicMissing ? "This family has no italic face: synthetic oblique" : undefined}
          onSelect={onItalic}
        />
        <MenuItemDense
          label="Link…"
          checked={linked}
          meta={keyHint("link", "⌘K")}
          className="rp-text-menu__item"
          onSelect={onLink}
        />
        <MenuDivider />
        <div className="rp-text-menu__group" role="presentation">
          <span className="rp-text-menu__group-label">OpenType features</span>
        </div>
        {FEATURE_ITEMS.map((f) => (
          <MenuItemDense
            key={f.tag}
            label={f.label}
            checked={featureOn(features, f.tag)}
            meta={f.tag}
            data-tag={f.tag}
            className="rp-text-menu__item"
            onSelect={() => onFeature(f.tag, toggledFeature(features, f.tag))}
          />
        ))}
        <MenuItemDense
          label="Stylistic sets"
          checked={STYLISTIC_SETS.some((t) => featureOn(features, t))}
          meta="ss01–20 ›"
          aria-haspopup="menu"
          aria-expanded={!!sets}
          className="rp-text-menu__item"
          onSelect={() => setSets((cur) => (cur ? null : (document.activeElement as HTMLElement)))}
        />
        {customFeatures(features).map((tag) => (
          // Board 25 §6 (d) LFdEa: an active tag without a row of its own, marked "not in
          // font" when the resolved face lacks it (rule v0gB4).
          <OpenTypeFeatureRow
            key={tag}
            tag={tag}
            notInFont={fontFeatures !== null && !fontFeatures.has(tag)}
            className="rp-text-menu__feature-row"
            onRemove={() => onFeature(tag, undefined)}
          />
        ))}
        {custom ? (
          // Board 24 (b) Ehror: the last OpenType row expands inline (no dialog).
          <div className="rp-text-menu__custom" role="presentation">
            <CustomTagField
              autoFocus
              family={family}
              inFont={(tag) => (fontFeatures ? fontFeatures.has(tag) : null)}
              data-testid="text-custom-tag"
              onAdd={(tag, value) => {
                setCustom(false)
                onFeature(tag, customFeatureValue(value))
              }}
              onCancel={() => setCustom(false)}
            />
          </div>
        ) : (
          <MenuItemDense
            label="Custom tag…"
            checked={false}
            meta="tag = n"
            className="rp-text-menu__item"
            onSelect={() => setCustom(true)}
          />
        )}
        <MenuDivider />
        <MenuItemDense
          label="Reset text style"
          checked={false}
          className="rp-text-menu__item"
          onSelect={onReset}
        />
      </MenuDense>
      {sets && (
        <MenuDense
          anchor={sets}
          placement={{ side: "left", align: "start" }}
          width={120}
          label="Stylistic sets"
          className="rp-text-menu"
          data-testid="text-sets-menu"
          autoFocus
          onClose={() => setSets(null)}
        >
          {STYLISTIC_SETS.map((tag) => (
            <MenuItemDense
              key={tag}
              label={tag}
              mono
              checked={featureOn(features, tag)}
              className="rp-text-menu__item"
              onSelect={() => onFeature(tag, toggledFeature(features, tag))}
            />
          ))}
        </MenuDense>
      )}
    </>
  )
}

/** True when the resolved family ships no italic face at this weight (rule "Italic"). */
function useItalicMissing(
  fonts: FontSystem | null,
  family: string | null,
  weight: number,
): boolean {
  const [missing, setMissing] = useState<{ key: string; missing: boolean } | null>(null)
  const key = `${family}|${weight}`
  useEffect(() => {
    if (!fonts || !family || family.startsWith("$")) return
    let live = true
    void fonts
      .availability({ family, weight, style: "italic" })
      .catch(() => "missing" as const)
      .then((a) => {
        if (live) setMissing({ key: `${family}|${weight}`, missing: a === "missing" })
      })
    return () => {
      live = false
    }
  }, [fonts, family, weight])
  return missing?.key === key ? missing.missing : false
}
