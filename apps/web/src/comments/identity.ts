/** Who comments from this window: the display name and presence label (docs/spec/comments.md §7). */
import { useCallback, useSyncExternalStore } from "react"
import { useMultiplayer } from "../multiplayer/hooks"

const NOOP = () => () => {}

export function useCommentIdentity(key: string | null): {
  displayName: string
  guestLabel: string
  setDisplayName?: (name: string) => Promise<void>
} {
  const model = useMultiplayer()
  const doc = model && key ? model.document(key) : null
  const settings = model?.settings ?? null
  const subSettings = useCallback(
    (l: () => void) => (settings ? settings.subscribe(l) : NOOP()),
    [settings],
  )
  const displayName = useSyncExternalStore(
    subSettings,
    () => settings?.getState().displayName ?? "",
  )
  const subDoc = useCallback((l: () => void) => (doc ? doc.subscribe(l) : NOOP()), [doc])
  const guestLabel = useSyncExternalStore(
    subDoc,
    () => doc?.getState().people.find((p) => p.isYou)?.label ?? "Guest",
  )
  return settings
    ? { displayName, guestLabel, setDisplayName: (n) => settings.setDisplayName(n) }
    : { displayName, guestLabel }
}
