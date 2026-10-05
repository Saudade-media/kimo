/**
 * Board 32 "Dock activity": reports this window's built-in agent turns to the desktop shell, so
 * the macOS Dock tile animates while any agent works (`src-tauri/src/dock_activity.rs`; MCP
 * clients are tracked in Rust from the relay). A turn counts while its composer streams, which
 * covers Single, the modes, Iterate and prompt-node runs; waiting for an approval or paused does
 * not. Web and memory hosts have no `platform.dock`: nothing is reported.
 *
 * Rust drops a source that has been silent for 15 s (reloads, crashes), so a running turn
 * re-sends `working` every {@link DOCK_HEARTBEAT_MS}.
 */
import type { KimoPlatform } from "@kimo/platform"
import { useEffect } from "react"

export const DOCK_HEARTBEAT_MS = 5000

/** The part of an Agent tab controller this needs (`AgentPanelControllerExt`). */
export interface DockAgentSource {
  readonly state: { composer: { state: string } }
  subscribe(listener: (state: { composer: { state: string } }) => void): () => void
}

export interface DockReporter {
  set(working: boolean): void
  dispose(): void
}

let nextSource = 0

/** One reporting source (window-scoped in Rust): sends edges plus a heartbeat while working. */
export function createDockReporter(
  platform: Pick<KimoPlatform, "dock">,
  timers: Pick<typeof globalThis, "setInterval" | "clearInterval"> = globalThis,
): DockReporter {
  const dock = platform.dock
  const source = `agent-${++nextSource}`
  let working = false
  let beat: ReturnType<typeof setInterval> | undefined
  const send = (w: boolean) => void dock?.setAgentWorking(source, w).catch(() => {})
  const set = (w: boolean) => {
    if (!dock || w === working) return
    working = w
    send(w)
    if (w) beat = timers.setInterval(() => send(true), DOCK_HEARTBEAT_MS)
    else if (beat !== undefined) {
      timers.clearInterval(beat)
      beat = undefined
    }
  }
  return { set, dispose: () => set(false) }
}

/** Reports `controller`'s turns until the returned cleanup runs. */
export function bindDockActivity(
  platform: Pick<KimoPlatform, "dock">,
  controller: DockAgentSource,
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">,
): () => void {
  const reporter = createDockReporter(platform, timers)
  const sync = (s: { composer: { state: string } }) =>
    reporter.set(s.composer.state === "streaming")
  sync(controller.state)
  const unsubscribe = controller.subscribe(sync)
  return () => {
    unsubscribe()
    reporter.dispose()
  }
}

/** Reports `controller`'s turns for as long as it lives. */
export function useDockAgentActivity(
  platform: Pick<KimoPlatform, "dock">,
  controller: DockAgentSource | null,
): void {
  useEffect(() => {
    if (!controller || !platform.dock) return
    return bindDockActivity(platform, controller)
  }, [platform, controller])
}
