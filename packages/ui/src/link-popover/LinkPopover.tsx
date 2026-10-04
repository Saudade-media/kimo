import { CircleAlert, ExternalLink, Info, Link, Unlink } from "lucide-react"
import { useState } from "react"
import { Button } from "../button/Button"
import { Input } from "../input/Input"
import { Popover, type PopoverProps } from "../popover/Popover"

/** Result of {@link parseLinkUrl}. */
export type LinkUrlCheck =
  | { kind: "empty" }
  | { kind: "ok"; url: string; scheme: "http" | "mailto" | "tel" | "frame" }
  | { kind: "invalid" }

/**
 * Board 24 (a) "Link… popover" (NpwJS) rule: only `http(s)://`, `mailto:`, `tel:` and `#frame`
 * anchors. Leading/trailing whitespace is ignored; anything else is invalid (Apply disabled).
 */
export function parseLinkUrl(input: string): LinkUrlCheck {
  const v = input.trim()
  if (v === "") return { kind: "empty" }
  if (/^#[^\s#]+$/.test(v)) return { kind: "ok", url: v, scheme: "frame" }
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return { kind: "ok", url: v, scheme: "mailto" }
  if (/^tel:\+?[0-9][0-9 ().-]*$/i.test(v)) return { kind: "ok", url: v, scheme: "tel" }
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v)
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "")
        return { kind: "ok", url: v, scheme: "http" }
    } catch {
      // invalid below
    }
  }
  return { kind: "invalid" }
}

/** Props for {@link LinkPopover}. */
export interface LinkPopoverProps
  extends Omit<PopoverProps, "title" | "children" | "headerLeading" | "onClose"> {
  /** The current href ("" when the text has none). */
  value: string
  /** Enter / Apply with a valid URL. */
  onApply: (url: string) => void
  /** Remove link, or Enter / Apply on an empty field. */
  onRemove: () => void
  /** Open: new tab (web) / default browser (desktop). Not offered for `#frame` anchors. */
  onOpen?: (url: string) => void
  onClose: () => void
}

/**
 * Board 24 (a) "Link… popover" (NpwJS › L3eKN). `Popover` instance, width 300:
 * Header (oqDII, 40, padding [0, 6, 0, 12], bottom stroke): Leading (JTVM6, gap 6) › lucide
 * `link` 14 text-secondary · Title "Link" sans 12 / 500 text-primary; Close IconButton 24 `x` 14
 * text-tertiary. Body (mzMkc): column, gap 10, padding 12:
 *   Field (Oe8Zg): Input h 30, icon `link` 14, text sans 12 text-primary.
 *   Hint (t7NY3J): row, gap 6, center › `info` 12 text-tertiary · sans 11 text-tertiary.
 *   Actions (H1Sutf): row, gap 6, center › Open (Button/Ghost h 28 [0, 10], `external-link` 14,
 *     label 12) · Remove link (Button/Ghost, `unlink` 14, label 12 danger) · Spacer · Apply
 *     (Button/Primary h 28 [0, 10], no icon, label 12).
 * Enter applies; an empty field + Enter removes the link; Escape closes.
 */
export function LinkPopover({
  value,
  onApply,
  onRemove,
  onOpen,
  onClose,
  className,
  ...rest
}: LinkPopoverProps) {
  const [text, setText] = useState(value)
  const check = parseLinkUrl(text)
  const linked = value !== ""
  const invalid = check.kind === "invalid"
  const submit = () => {
    if (check.kind === "ok") onApply(check.url)
    else if (check.kind === "empty") onRemove()
  }
  return (
    <Popover
      {...rest}
      className={["kimo-link-popover", className].filter(Boolean).join(" ")}
      label="Link"
      initialFocus="first"
      onClose={onClose}
      headerLeading={
        <div className="kimo-popover__leading">
          <Link className="kimo-link-popover__title-icon" aria-hidden="true" />
          <span className="kimo-link-popover__title">Link</span>
        </div>
      }
      bodyProps={{ className: "kimo-link-popover__body" }}
    >
      <Input
        icon={<Link />}
        aria-label="Link URL"
        placeholder="https://"
        value={text}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        frameProps={{ className: "kimo-link-popover__field" }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          submit()
        }}
      />
      <div
        className={
          invalid
            ? "kimo-link-popover__hint kimo-link-popover__hint--error"
            : "kimo-link-popover__hint"
        }
        role={invalid ? "alert" : undefined}
      >
        {invalid ? (
          <CircleAlert className="kimo-link-popover__hint-icon" aria-hidden="true" />
        ) : (
          <Info className="kimo-link-popover__hint-icon" aria-hidden="true" />
        )}
        <span className="kimo-link-popover__hint-text">http(s), mailto:, tel: or #frame</span>
      </div>
      <div className="kimo-link-popover__actions">
        {onOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="kimo-link-popover__action"
            icon={<ExternalLink />}
            disabled={check.kind !== "ok" || check.scheme === "frame"}
            onClick={() => check.kind === "ok" && onOpen(check.url)}
          >
            Open
          </Button>
        )}
        {linked && (
          <Button
            variant="ghost"
            size="sm"
            className="kimo-link-popover__action kimo-link-popover__remove"
            icon={<Unlink />}
            onClick={onRemove}
          >
            Remove link
          </Button>
        )}
        <span className="kimo-link-popover__spacer" aria-hidden="true" />
        <Button
          variant="primary"
          size="sm"
          className="kimo-link-popover__action"
          disabled={check.kind === "invalid" || (check.kind === "empty" && !linked)}
          onClick={submit}
        >
          Apply
        </Button>
      </div>
    </Popover>
  )
}
