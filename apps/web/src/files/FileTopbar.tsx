/**
 * The traffic-light inset spacer (board 16 f6gZ3 / 02d Topbar/Desktop XDqrb), driven by
 * `platform.window.trafficLightInset()` (68 / 4 fullscreen / 0 off macOS).
 */

import { TrafficLights } from "@kimo/ui"
import type { FileDocumentSession } from "../platform/session"
import { useWindowChrome } from "./hooks"

/** The traffic-light inset spacer for any topbar (editor or Home sidebar). */
export function TrafficLightInset({
  session,
  platform,
  leading,
}: {
  session?: FileDocumentSession
  platform?: FileDocumentSession["manager"]["platform"]
  leading?: number
}) {
  const p = platform ?? session?.manager.platform
  if (!p) throw new Error("TrafficLightInset needs a session or a platform")
  return <TrafficLightInsetFor platform={p} {...(leading !== undefined ? { leading } : {})} />
}

function TrafficLightInsetFor({
  platform,
  leading,
}: {
  platform: FileDocumentSession["manager"]["platform"]
  leading?: number
}) {
  const chrome = useWindowChrome(platform)
  return (
    <TrafficLights
      inset={chrome.inset}
      focused={chrome.focused}
      drawLights={chrome.drawLights}
      {...(leading !== undefined ? { leading } : {})}
    />
  )
}
