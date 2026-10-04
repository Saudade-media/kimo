import { useEffect, useState, useSyncExternalStore } from "react"
import type { AgentsControllerExt, AgentsViewState } from "./controller"

/** The controller's state, re-rendered on every change. */
export function useAgentsState(controller: AgentsControllerExt): AgentsViewState {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.state,
    () => controller.state,
  )
}

/** `Date.now()` ticking every `ms` while `active` (approval countdown). */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
