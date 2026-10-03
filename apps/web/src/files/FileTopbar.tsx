/**
 * Desktop editor topbar pieces (board 16 f6gZ3 / 02d Topbar/Desktop XDqrb) for a file session:
 * the traffic-light inset driven by `platform.window.trafficLightInset()` (68 / 4 fullscreen /
 * 0 off macOS), the `folder / file.kimo / page` breadcrumb (file weight 500 when the window is
 * unfocused), the branch chip and the Save Status pill. `FileTopbar` composes them with the
 * editor's own trailing controls (Zoom, Theme, Preview, Export).
 */

import { basenameOf, dirnameOf } from "@kimo/platform"
import { BranchChip, DesktopBreadcrumb, DesktopTopbar, TrafficLights } from "@kimo/ui"
import type { MouseEvent, ReactNode } from "react"
import type { FileDocumentSession } from "../platform/session"
import { useSessionState, useWindowChrome } from "./hooks"
import { SaveStatusPill } from "./SaveStatusPill"

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

export interface FileBreadcrumbProps {
  session: FileDocumentSession
  /** Current page name ("Home"); omit to hide the page crumb. */
  page?: string | null
  onFileClick?: (e: MouseEvent<HTMLButtonElement>) => void
}

/** `folder / file.kimo / page` for the session's file. */
export function FileBreadcrumb({ session, page, onFileClick }: FileBreadcrumbProps) {
  const state = useSessionState(session)
  const chrome = useWindowChrome(session.manager.platform)
  return (
    <DesktopBreadcrumb
      folder={basenameOf(dirnameOf(state.ref))}
      folderIsRepo={state.git !== null}
      file={state.fileName}
      page={page ?? null}
      focused={chrome.focused}
      {...(onFileClick ? { onFileClick } : {})}
    />
  )
}

/** Branch chip; nothing outside a repository. */
export function FileBranchChip({ session }: { session: FileDocumentSession }) {
  const { branchLabel } = useSessionState(session)
  return branchLabel ? <BranchChip branch={branchLabel} /> : null
}

export interface FileTopbarProps {
  session: FileDocumentSession
  page?: string | null
  onFileClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Zoom, Theme, Preview, Export from the editor topbar. */
  trailing?: ReactNode
}

/** The whole desktop topbar for a file session. */
export function FileTopbar({ session, page, onFileClick, trailing }: FileTopbarProps) {
  const chrome = useWindowChrome(session.manager.platform)
  return (
    <DesktopTopbar
      inset={chrome.inset}
      focused={chrome.focused}
      drawLights={chrome.drawLights}
      breadcrumb={
        <FileBreadcrumb
          session={session}
          page={page ?? null}
          {...(onFileClick ? { onFileClick } : {})}
        />
      }
      branch={<FileBranchChip session={session} />}
      status={<SaveStatusPill session={session} />}
      trailing={trailing}
    />
  )
}
