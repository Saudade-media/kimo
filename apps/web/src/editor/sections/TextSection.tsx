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
 */
import type { LayoutResult } from "@kimo/layout"
import { MenuDense, MenuItemDense, PropRow, PropSection, Segmented } from "@kimo/ui"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { FontPicker, useFontPickerEntries } from "../../fonts"
import type { FontSystem } from "../../fonts/font-system"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import { NumberField } from "../fields"
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

export function TextSection({ sel, fonts }: { sel: readonly Sel[]; fonts: FontSystem | null }) {
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

  const [fontOpen, setFontOpen] = useState(false)
  const [weightOpen, setWeightOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const fontTrigger = useRef<HTMLButtonElement>(null)
  const weightTrigger = useRef<HTMLButtonElement>(null)
  const moreAnchor = useRef<HTMLSpanElement>(null)
  useKeepPopoverFocus(fontOpen)

  const laid = (id: string) => {
    const b = (layout.get() as LayoutResult | null)?.nodes.get(id)?.local
    return b ? { w: b.w, h: b.h } : null
  }

  return (
    <PropSection
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
        {/* Family Row (RWKxU) */}
        <PropRow className="rp-row">
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
        </PropRow>
        {/* Weight Size Row (nk7RJ) */}
        <PropRow className="rp-row">
          <button
            ref={weightTrigger}
            type="button"
            className={weightOpen ? "rp-select rp-select--open" : "rp-select"}
            aria-label="Font weight"
            aria-haspopup="menu"
            aria-expanded={weightOpen}
            onClick={() => setWeightOpen((o) => !o)}
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
            <span className="rp-select__chevron" aria-hidden="true">
              <Icon name={weightOpen ? "chevron-up" : "chevron-down"} size={14} />
            </span>
          </button>
          <NumberField
            icon="a-large-small"
            label="Font size"
            className="rp-field--w96"
            value={size}
            editor={editor}
            min={1}
            onNumber={(n) => styleOps(sel, "size", () => Math.max(1, round(n)))}
            relative={() => {
              const base = sel.map((s) => ({ s, v: sizeNumber(s.node) }))
              return (d) =>
                base.flatMap(({ s, v }) => styleOps([s], "size", () => Math.max(1, round(v + d))))
            }}
          />
        </PropRow>
        {/* Spacing Row (NEORl) */}
        <PropRow className="rp-row">
          <NumberField
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
          <NumberField
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
        // Not designed: the header's ellipsis holds the style flag the board's controls leave out.
        <MenuDense
          anchor={moreAnchor.current}
          placement={{ side: "bottom", align: "end" }}
          width={168}
          label="More text options"
          autoFocus
          onClose={() => setMoreOpen(false)}
        >
          <MenuItemDense
            label="Italic"
            checked={italic === true}
            onSelect={() => {
              setMoreOpen(false)
              editor.apply(
                styleOps(sel, "italic", () => (italic === true ? undefined : true)),
                "Set italic",
              )
            }}
          />
        </MenuDense>
      )}
    </PropSection>
  )
}

/** Resizing / Decoration / Case rows (l7RLS1, OhisU, a5p1T9): h 28, gap 8. */
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

/** Weights the family ships (null while unknown: every weight is offered). */
function useShippedWeights(fonts: FontSystem | null, family: string | null): Set<number> | null {
  const [state, setState] = useState<{ family: string; weights: Set<number> | null } | null>(null)
  useEffect(() => {
    if (!fonts || !family || family.startsWith("$")) return
    let live = true
    void Promise.all(
      WEIGHT_NAMES.map(async ([w]) => {
        const a = await fonts
          .availability({ family, weight: w, style: "normal" })
          .catch(() => "missing" as const)
        return [w, a !== "missing"] as const
      }),
    ).then((res) => {
      if (!live) return
      const ok = new Set(res.filter(([, has]) => has).map(([w]) => w))
      // A family nothing provides keeps every weight (the Missing fonts dialog handles it).
      setState({ family, weights: ok.size > 0 ? ok : null })
    })
    return () => {
      live = false
    }
  }, [fonts, family])
  return state?.family === family ? state.weights : null
}
