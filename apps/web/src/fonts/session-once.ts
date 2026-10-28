/**
 * "The dialog opens once per file per session" (board 19 Fonts section note). Keyed by the file
 * reference (or the browser file id); kept in memory, so a new window/session asks again.
 */
const shown = new Set<string>()

/** True the first time it is called for `fileKey` in this session; false afterwards. */
export function claimMissingFontsDialog(fileKey: string): boolean {
  if (shown.has(fileKey)) return false
  shown.add(fileKey)
  return true
}
