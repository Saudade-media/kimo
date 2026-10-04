/**
 * Board 25 §7 (c): the Keyboard shortcuts sheet (WcWPY), window-wide (editor and Home). Opens on
 * ⌘/ (SHORTCUTS "shortcuts"), Help › Keyboard shortcuts (native menu / File › Help) through
 * {@link openShortcutsSheet}; Esc, Close or a scrim press close it. Renders from the SHORTCUTS
 * table, so the sheet lists exactly the bindings the handlers match.
 */
import { DialogScrim, ShortcutsSheet } from "@kimo/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { isTyping } from "../lib/hooks"
import { onOpenShortcutsSheet } from "./open"
import { currentPlatform, matches, type ShortcutPlatform, sheetGroups } from "./shortcuts"

const PLATFORMS = [
  { value: "mac", label: "macOS" },
  { value: "other", label: "Windows · Linux" },
] as const satisfies readonly { value: ShortcutPlatform; label: string }[]

export function ShortcutsSheetHost() {
  const [open, setOpen] = useState(false)
  const isOpen = useRef(open)
  isOpen.current = open
  useEffect(() => onOpenShortcutsSheet(() => setOpen(true)), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matches("shortcuts", e)) return
      // Outside the sheet, ⌘/ stays out of text fields; inside (the filter), it closes the sheet.
      if (!isOpen.current && isTyping(e.target)) return
      e.preventDefault()
      setOpen((o) => !o)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  if (!open) return null
  return <OpenSheet onClose={() => setOpen(false)} />
}

function OpenSheet({ onClose }: { onClose(): void }) {
  // The platform switch defaults to the current OS (rules GrX3H); the filter starts empty.
  const [platform, setPlatform] = useState<ShortcutPlatform>(() => currentPlatform())
  const [filter, setFilter] = useState("")
  const groups = useMemo(() => sheetGroups(platform, filter), [platform, filter])
  return (
    <DialogScrim
      className="shortcuts-sheet-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <ShortcutsSheet
        data-testid="shortcuts-sheet"
        groups={groups}
        filter={filter}
        onFilterChange={setFilter}
        platforms={PLATFORMS}
        platform={platform}
        onPlatformChange={setPlatform}
        onClose={onClose}
      />
    </DialogScrim>
  )
}
