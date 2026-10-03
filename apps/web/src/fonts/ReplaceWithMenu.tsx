/**
 * "Replace with…" (board 19 YgdOz): a plain frame of MenuItem/Dense rows, which is exactly
 * `Menu/Dense` (G7A3Aj) at width 220: column, gap 1, padding 4, bg-overlay, stroke 1 border,
 * radius-lg, shadow 0 8 24 shadow-strong. Rows: available families with Meta `local` / `google`
 * (the current choice checked, bg-hover), Menu/Divider, "Install <family>…", "Choose font file…".
 *
 * {@link FontReplaceSelect} is the row's trigger: the `Select` (gP276) instance at width 148
 * whose value reads "Replace with…" (text-secondary) until a family is chosen (text-primary).
 */
import { MenuDense, MenuDivider, MenuItemDense } from "@kimo/ui"
import { ChevronDown } from "lucide-react"
import { useRef, useState } from "react"

export interface ReplaceChoice {
  family: string
  /** Meta text: `local`, `google`, `cached`, `document`. */
  meta: string
}

export interface ReplaceWithMenuProps {
  /** The missing family ("Install Söhne…"). */
  family: string
  choices: readonly ReplaceChoice[]
  value: string | null
  onChoose: (family: string) => void
  /** "Install <family>…": pick a font file and add it to Kimo's fonts (every document). */
  onInstall?: () => void
  /** "Choose font file…": pick a font file and embed it in this document's assets. */
  onChooseFile?: () => void
  anchor?: HTMLElement | null
  onClose?: () => void
  autoFocus?: boolean
}

export function ReplaceWithMenu({
  family,
  choices,
  value,
  onChoose,
  onInstall,
  onChooseFile,
  anchor,
  onClose,
  autoFocus = false,
}: ReplaceWithMenuProps) {
  return (
    <MenuDense
      width={220}
      label={`Replace ${family} with`}
      className="fonts-replace-menu"
      {...(anchor ? { anchor } : {})}
      {...(onClose ? { onClose } : {})}
      autoFocus={autoFocus}
    >
      {choices.map((c) => (
        <MenuItemDense
          key={c.family}
          label={c.family}
          meta={c.meta}
          checked={c.family === value}
          onSelect={() => onChoose(c.family)}
        />
      ))}
      <MenuDivider />
      <MenuItemDense label={`Install ${family}…`} onSelect={onInstall} disabled={!onInstall} />
      <MenuItemDense label="Choose font file…" onSelect={onChooseFile} disabled={!onChooseFile} />
    </MenuDense>
  )
}

export interface FontReplaceSelectProps
  extends Omit<ReplaceWithMenuProps, "anchor" | "onClose" | "autoFocus"> {
  /** Trigger width: 148 in the Missing fonts dialog (JoOkA). */
  width?: number
}

/** The row's Select (gP276 at width 148) opening {@link ReplaceWithMenu}. */
export function FontReplaceSelect({ width = 148, ...menu }: FontReplaceSelectProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="kimo-select fonts-replace-select" style={{ width }}>
      <button
        ref={trigger}
        type="button"
        className="kimo-select__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Replace ${menu.family} with`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span
          className={`kimo-select__value fonts-replace-select__value${menu.value ? "" : " fonts-replace-select__value--empty"}`}
        >
          {menu.value ?? "Replace with…"}
        </span>
        <span className="kimo-select__chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open && (
        <ReplaceWithMenu
          {...menu}
          anchor={trigger.current}
          autoFocus
          onClose={close}
          onChoose={(f) => {
            menu.onChoose(f)
            close()
          }}
          {...(menu.onInstall
            ? {
                onInstall: () => {
                  close()
                  menu.onInstall?.()
                },
              }
            : {})}
          {...(menu.onChooseFile
            ? {
                onChooseFile: () => {
                  close()
                  menu.onChooseFile?.()
                },
              }
            : {})}
        />
      )}
    </div>
  )
}
