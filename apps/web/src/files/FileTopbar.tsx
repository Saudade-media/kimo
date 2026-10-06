/**
 * Desktop editor topbar pieces (board 16 f6gZ3 / 02d Topbar/Desktop XDqrb) for a file session:
 * the traffic-light inset driven by `platform.window.trafficLightInset()` (68 / 4 fullscreen /
 * 0 off macOS), the `folder / file.kimo / page` breadcrumb (file weight 500 when the window is
 * unfocused), the branch chip and the Save Status pill. `FileTopbar` composes them with the
 * editor's own trailing controls (Zoom, Theme, Preview, Export).
 *
 * Board 20: off macOS (no inset: Windows / Linux with native decorations, and the web) the
 * topbar leads with the 28px KimoLogo and takes padding [0, 12] (N1mtd); an untitled document
 * shows no folder, no separator and no branch (Zvw7e); the file name shows pressed while the
 * File menu is open (Nl4Cz).
 */

import { basenameOf, dirnameOf } from "@kimo/platform"
import { BranchChip, DesktopBreadcrumb, DesktopTopbar, KimoLogo, TrafficLights } from "@kimo/ui"
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
  /** The File menu is open (pressed file name, chevron-up). */
  fileOpen?: boolean
  /** Board 37 (E3): the folder crumb opens Home on the file's folder (`dir` = its ref). */
  onFolderClick?: (dir: string) => void
}

/** `folder / file.kimo / page` for the session's file (`Untitled / page` before a first save). */
export function FileBreadcrumb({
  session,
  page,
  onFileClick,
  fileOpen,
  onFolderClick,
}: FileBreadcrumbProps) {
  const state = useSessionState(session)
  const chrome = useWindowChrome(session.manager.platform)
  const dir = dirnameOf(state.ref)
  const folder = session.untitled ? null : basenameOf(dir)
  return (
    <DesktopBreadcrumb
      folder={folder}
      {...(onFolderClick && folder !== null
        ? { onFolderClick: () => onFolderClick(dir), folderTooltip: `Show ${folder} in Home` }
        : {})}
      folderIsRepo={state.git !== null}
      file={state.fileName}
      page={page ?? null}
      focused={chrome.focused}
      fileOpen={fileOpen ?? false}
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
  /** The File menu is open. */
  fileOpen?: boolean
  /** Zoom, Theme, Preview, Export from the editor topbar. */
  trailing?: ReactNode
  /** The logo's action (Home), shown when the window has no traffic-light inset. */
  onHome?: () => void
  /** Board 21 Agent Presence chip (drag region, before Save Status). */
  presence?: ReactNode
  /** Board 37 (E3): the folder crumb opens Home on that folder. */
  onFolderClick?: (dir: string) => void
}

/** The 28px topbar logo: KimoLogo 28 (bm1JR), replacing the old "k" pill (board 26 §4 KlpS9). */
export function TopbarLogo({ onClick }: { onClick?: (() => void) | undefined }) {
  return (
    <button type="button" className="topbar__logo" aria-label="Kimo home" onClick={onClick}>
      <KimoLogo size={28} />
    </button>
  )
}

/** The whole desktop topbar for a file session. */
export function FileTopbar({
  session,
  page,
  onFileClick,
  fileOpen,
  trailing,
  presence,
  onHome,
  onFolderClick,
}: FileTopbarProps) {
  const chrome = useWindowChrome(session.manager.platform)
  // macOS draws the lights (inset 68, 4 in fullscreen); everywhere else the OS (or the browser)
  // owns the window chrome and the topbar leads with the logo (board 20 N1mtd).
  const native = !session.manager.platform.capabilities.trafficLights
  return (
    <DesktopTopbar
      inset={chrome.inset}
      focused={chrome.focused}
      drawLights={chrome.drawLights}
      {...(native ? { logo: <TopbarLogo onClick={onHome} /> } : {})}
      breadcrumb={
        <FileBreadcrumb
          session={session}
          page={page ?? null}
          fileOpen={fileOpen ?? false}
          {...(onFileClick ? { onFileClick } : {})}
          {...(onFolderClick ? { onFolderClick } : {})}
        />
      }
      branch={session.untitled ? null : <FileBranchChip session={session} />}
      status={<SaveStatusPill session={session} />}
      presence={presence}
      trailing={trailing}
    />
  )
}
