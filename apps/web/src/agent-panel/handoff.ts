/**
 * Home → Agent tab hand-off (board 22 "Home composer rules"; builder 3's `home/handoff.ts`). When
 * the editor mounts for a file Home just created, the Agent tab takes the stashed hand-off once,
 * activates itself and starts the session: id = the hand-off's sessionId, origin "home", mode
 * Single, scope page, the prompt as the first user message tagged "From Home".
 */
import { useEffect } from "react"
import { peekHomeHandoff, takeHomeHandoff } from "../home/handoff"
import type { AgentPanelControllerExt } from "./controller"

export { peekHomeHandoff }

/** True when a hand-off is waiting for `path` (RightPanel opens the Agent tab first). */
export function hasHomeHandoff(path: string | null | undefined): boolean {
  return !!path && peekHomeHandoff(path) !== null
}

/** Takes the hand-off for `path` once and starts it; `onActivate` switches to the Agent tab. */
export function useHomeHandoff(
  controller: AgentPanelControllerExt | null,
  path: string | null | undefined,
  onActivate?: () => void,
): void {
  useEffect(() => {
    if (!controller || !path) return
    const h = takeHomeHandoff(path)
    if (!h) return
    onActivate?.()
    void controller.startFromHome(h)
  }, [controller, path, onActivate])
}
