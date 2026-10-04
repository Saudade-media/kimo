import { useSyncExternalStore } from "react"
import type { AgentPanelControllerExt, AgentPanelViewState } from "./controller"

/** Subscribes to the panel controller's state. */
export function useAgentPanelState(c: AgentPanelControllerExt): AgentPanelViewState {
  return useSyncExternalStore(
    (l) => c.subscribe(l),
    () => c.state,
    // Server rendering (unit tests' renderToString): the same snapshot.
    () => c.state,
  )
}
