import { type ComponentPropsWithRef, useRef, useState } from "react"

/** Props for {@link DraftInput}. Native `<input>` props pass through (not `value`/`onChange`). */
export interface DraftInputProps
  extends Omit<ComponentPropsWithRef<"input">, "value" | "onChange" | "defaultValue"> {
  value: string
  /** Enter / blur with an edited value; Escape reverts. */
  onCommit?: (text: string) => void
}

/**
 * Text input that edits a draft and commits once (Enter or blur), so a gesture becomes one
 * document change (one undo step). Escape reverts and blurs; a second Escape bubbles.
 */
export function DraftInput({
  value,
  onCommit,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: DraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit?.(draft)
  }
  return (
    <input
      type="text"
      spellCheck={false}
      autoComplete="off"
      readOnly={onCommit === undefined}
      {...rest}
      value={draft ?? value}
      onFocus={(e) => {
        onFocus?.(e)
        cancelled.current = false
        setDraft(value)
      }}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={(e) => {
        onBlur?.(e)
        if (!cancelled.current) commit()
        cancelled.current = false
        setDraft(null)
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
          // The blur that follows must not commit a second time.
          cancelled.current = true
          setDraft(null)
          e.currentTarget.blur()
        } else if (e.key === "Escape" && draft !== null && draft !== value) {
          e.preventDefault()
          e.stopPropagation()
          cancelled.current = true
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
