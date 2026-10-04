/**
 * "Open skills folder" (agent panel Skills menu): desktop reveals `~/.kimo/skills` (created when
 * missing) through `platform.skills.reveal`; the browser has no user skills folder, so the
 * action is absent and the button is hidden.
 */
import type { KimoPlatform } from "@kimo/platform"

export function skillsFolderAction(
  platform: Pick<KimoPlatform, "skills">,
  onError?: (e: unknown) => void,
): (() => void) | undefined {
  const reveal = platform.skills?.reveal
  if (!reveal) return undefined
  return () => {
    void reveal.call(platform.skills).catch((e: unknown) => onError?.(e))
  }
}
