import { type ComponentPropsWithRef, type KeyboardEvent, useId, useState } from "react"
import { Button } from "../button/Button"
import { Input } from "../input/Input"
import { cx } from "../internal/util"

/** Board 24 (b) rule: an OpenType tag is exactly 4 characters a–z / 0–9. */
export const isOpenTypeTag = (tag: string): boolean => /^[a-z0-9]{4}$/.test(tag)

/** Board 24 (b) rule: the value is an integer 0–99 (default 1). Null when invalid. */
export function parseFeatureValue(text: string): number | null {
  const t = text.trim()
  if (t === "") return 1
  if (!/^\d{1,2}$/.test(t)) return null
  return Number(t)
}

/** Props for {@link CustomTagField}. Remaining `<div>` props go to the frame. */
export interface CustomTagFieldProps extends Omit<ComponentPropsWithRef<"div">, "onSubmit"> {
  /** Family named in the hint ("cv11 is in Inter"). */
  family?: string | null
  /**
   * Whether the font has the typed tag: true → "· cv11 is in Inter", false → "· not in font",
   * null/undefined (unknown) → no suffix. Unknown tags are still allowed.
   */
  inFont?: (tag: string) => boolean | null
  /** Add / Enter with a valid tag and value. */
  onAdd: (tag: string, value: number) => void
  /** Escape. */
  onCancel?: () => void
  autoFocus?: boolean
}

/**
 * Board 24 (b) "OpenType · Custom tag…" (Ehror › Custom tag jtxHo), the inline row that
 * "Custom tag…" expands into (no dialog): column, gap 8, padding [10, 0, 0, 0], top stroke 1
 * border.
 *   Label (tQkMh) "Custom tag…" sans 12 / 500 text-primary.
 *   Inputs (oZgHz) row, gap 6, center: Field (Qcbn1) Input 84 × 30 no icon, mono 12 ·
 *     Eq (l6vuGd) "=" mono 11 text-tertiary · Field (pPUw9) Input 48 × 30, mono 12 · Spacer ·
 *     Add (IIbvY) Button/Secondary h 28, padding [0, 10], label 12.
 *   Hint (pqGfb) sans 11 text-tertiary: "4 characters, a–z 0–9 · cv11 is in Inter".
 */
export function CustomTagField({
  family,
  inFont,
  onAdd,
  onCancel,
  autoFocus = false,
  className,
  ...rest
}: CustomTagFieldProps) {
  const [tag, setTag] = useState("")
  const [value, setValue] = useState("1")
  const id = useId()
  const tagOk = isOpenTypeTag(tag)
  const n = parseFeatureValue(value)
  const ok = tagOk && n !== null
  const known = tagOk ? (inFont?.(tag) ?? null) : null
  const suffix =
    known === true && family ? ` · ${tag} is in ${family}` : known === false ? " · not in font" : ""
  const add = () => {
    if (ok) onAdd(tag, n as number)
  }
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === "Enter") {
      e.preventDefault()
      add()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel?.()
    }
  }
  return (
    <div {...rest} className={cx("kimo-custom-tag", className)}>
      <span id={`${id}-label`} className="kimo-custom-tag__label">
        Custom tag…
      </span>
      <div className="kimo-custom-tag__inputs">
        <Input
          aria-label="OpenType tag"
          placeholder="cv11"
          maxLength={4}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          value={tag}
          aria-invalid={(tag !== "" && !tagOk) || undefined}
          aria-describedby={`${id}-hint`}
          frameProps={{ className: "kimo-custom-tag__field kimo-custom-tag__field--tag" }}
          onChange={(e) => setTag(e.target.value.toLowerCase())}
          onKeyDown={keys}
        />
        <span className="kimo-custom-tag__eq" aria-hidden="true">
          =
        </span>
        <Input
          aria-label="Feature value"
          inputMode="numeric"
          maxLength={2}
          autoComplete="off"
          value={value}
          aria-invalid={n === null || undefined}
          frameProps={{ className: "kimo-custom-tag__field kimo-custom-tag__field--value" }}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={keys}
        />
        <span className="kimo-custom-tag__spacer" aria-hidden="true" />
        <Button
          variant="secondary"
          size="sm"
          className="kimo-custom-tag__add"
          disabled={!ok}
          onClick={add}
        >
          Add
        </Button>
      </div>
      <span id={`${id}-hint`} className="kimo-custom-tag__hint">
        4 characters, a–z 0–9{suffix}
      </span>
    </div>
  )
}
