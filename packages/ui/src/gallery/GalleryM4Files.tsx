/**
 * Gallery for board 02d "Components — Files (M4)", sections "Save status" (t5dln), "Banners &
 * dialogs" (Z8J1t), "Files & recovery" (PJ9zE) and "Window chrome (macOS)" (wV1eg). Same
 * section / column frames as the M3 gallery (Section Header gap 12 align end + note; Items gap
 * 40; columns gap 12 with a mono caption). Every instance carries `data-pen`.
 */
import { FileClock } from "lucide-react"
import type { ReactNode } from "react"
import { Banner } from "../banner/Banner"
import { Button } from "../button/Button"
import { Dialog } from "../dialog/Dialog"
import { FileRow, FileRowHeader } from "../file-row/FileRow"
import { RecoveryItem } from "../recovery-item/RecoveryItem"
import { SaveStatus, type SaveStatusKind } from "../save-status/SaveStatus"
import {
  BranchChip,
  DesktopBreadcrumb,
  DesktopTopbar,
  TrafficLights,
} from "../window-chrome/WindowChrome"

function Section({
  title,
  note,
  pen,
  children,
}: {
  title: string
  note: string
  pen: string
  children: ReactNode
}) {
  return (
    <section className="kimo-gallery__section" data-pen={pen}>
      <div className="kimo-gallery__section-header kimo-gallery__section-header--note">
        <h2 className="kimo-gallery__section-title">{title}</h2>
        <span className="kimo-gallery__section-note">{note}</span>
      </div>
      <div className="kimo-gallery__items kimo-gallery__items--m3">{children}</div>
    </section>
  )
}

function Column({
  caption,
  width,
  pen,
  children,
}: {
  caption: string
  width?: number
  pen: string
  children: ReactNode
}) {
  return (
    <div
      className="kimo-gallery__m3-column"
      style={width ? { width } : { flex: "1 1 0", minWidth: 0 }}
      data-pen={pen}
    >
      <span className="kimo-gallery__caption">{caption}</span>
      {children}
    </div>
  )
}

const STATUSES: [SaveStatusKind, string, string][] = [
  ["saved", "Saved to disk", "EdNXU"],
  ["saving", "Saving…", "hbDxo"],
  ["unsaved", "Unsaved changes", "O8d1r"],
  ["paused", "Autosave paused · rebase", "LvZiH"],
  ["read-only", "Read-only", "ChFsm"],
  ["locked", "Locked by another app", "Nn6l8"],
  ["failed", "Save failed", "qPGUY"],
]

const noop = () => {}

/** The four 02d sections this builder owns. */
export function GalleryM4FilesSections() {
  return (
    <>
      <Section
        title="Save status"
        note="topbar pill · 24px · one state at a time · neutral when healthy, status color only when the user must act"
        pen="t5dln"
      >
        <Column caption="SaveStatus · 7 states" pen="qTrSj">
          {STATUSES.map(([kind, label, pen]) => (
            <span key={kind} style={{ display: "flex" }}>
              <SaveStatus kind={kind} label={label} data-pen={pen} />
            </span>
          ))}
        </Column>
      </Section>
      <Section
        title="Banners & dialogs"
        note="Banner sits full-width directly under the topbar, never floats · one banner at a time, highest severity wins · Dialog = board 15 confirm spec, now a component"
        pen="Z8J1t"
      >
        <Column caption="Banner · info / warning / danger" width={760} pen="zK0f7">
          <Banner
            data-pen="R6VHG"
            title="Opened read-only"
            body="This file uses format 0.3. Update Kimo to edit it."
            actions={[
              { id: "notes", label: "Release notes", variant: "ghost" },
              { id: "check", label: "Check for updates", variant: "primary" },
            ]}
            onDismiss={noop}
          />
          <Banner
            data-pen="KPgcF"
            tone="warning"
            title="Rebase in progress"
            body="Autosave is paused until git finishes. Your edits are kept in memory."
            actions={[
              { id: "discard", label: "Discard", variant: "ghost" },
              { id: "keep", label: "Keep my edits", variant: "primary" },
            ]}
            onDismiss={noop}
          />
          <Banner
            data-pen="Gq3Fs"
            tone="danger"
            title="Couldn't save"
            body="The disk is full (ENOSPC). Edits are safe in a recovery file."
            actions={[
              { id: "save-as", label: "Save as…", variant: "ghost" },
              { id: "retry", label: "Retry", variant: "primary" },
            ]}
            onDismiss={noop}
          />
        </Column>
        <Column caption="Dialog · 480 · radius-xl · shadow-strong" pen="OQmKh">
          <Dialog
            inline
            data-pen="bDVhS"
            icon={<FileClock />}
            title="Dialog title"
            description="One or two sentences that say what happens and what stays safe."
            confirmLabel="Confirm"
            onCancel={noop}
            onConfirm={noop}
          >
            <div
              data-pen="BoSUg"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: 56,
                borderRadius: "var(--kimo-radius-md)",
                background: "var(--kimo-bg-subtle)",
                color: "var(--kimo-text-tertiary)",
                font: "var(--kimo-text-xs)/15px var(--kimo-font-mono)",
              }}
            >
              Body slot
            </div>
          </Dialog>
        </Column>
      </Section>
      <Section
        title="Files & recovery"
        note="FileRow columns are fixed so header and rows align 1:1 · git dot uses status tokens · paths are always mono, middle-truncated"
        pen="PJ9zE"
      >
        <Column
          caption="FileRow/Header · FileRow · /Modified · /Untracked · /Conflict · /Selected"
          width={760}
          pen="GLDTF"
        >
          <div>
            <FileRowHeader data-pen="ZyDkD" />
            {(
              [
                ["K4gLI", "main · clean", "clean", false],
                ["KuHqA", "main · modified", "modified", false],
                ["tOPzo", "main · untracked", "untracked", false],
                ["O3Tio3", "merge · conflict", "conflict", false],
                ["h6Wghb", "main · clean", "clean", true],
              ] as const
            ).map(([pen, git, tone, selected]) => (
              <FileRow
                key={pen}
                data-pen={pen}
                name="home.kimo"
                path="~/Work/kimo-site/design"
                modified="2 min ago"
                gitLabel={git}
                gitTone={tone}
                selected={selected}
              />
            ))}
          </div>
        </Column>
        <Column caption="RecoveryItem" pen="pz7dL">
          <RecoveryItem
            data-pen="arWPH"
            name="home.kimo"
            badge="14 edits"
            path="~/Work/kimo-site/design/home.kimo"
            meta="Last autosave 10:42 · app quit unexpectedly 10:43"
          />
        </Column>
      </Section>
      <Section
        title="Window chrome (macOS)"
        note="Tauri v2 · titleBarStyle Overlay + hiddenTitle · lights are drawn by macOS, shown here only to reserve space — their colors are not tokens"
        pen="wV1eg"
      >
        <Column caption="WindowChrome/TrafficLights · /Inactive" width={251} pen="pRqpE">
          <TrafficLights data-pen="L2zCG" />
          <TrafficLights data-pen="O8MOD" focused={false} />
        </Column>
        <Column caption="Topbar/Desktop · 48 · breadcrumb = folder / file.kimo / page" pen="p7Ytm">
          <DesktopTopbar
            data-pen="XDqrb"
            breadcrumb={<DesktopBreadcrumb folder="kimo-site" file="home.kimo" page="Home" />}
            branch={<BranchChip branch="main" />}
            status={<SaveStatus kind="saved" />}
            trailing={
              <>
                <Button variant="ghost">Preview</Button>
                <Button variant="primary">Export</Button>
              </>
            }
          />
        </Column>
      </Section>
    </>
  )
}

/** Standalone board (with the 02d header) for the gallery page. */
export function GalleryM4Files({ theme }: { theme?: "light" | "dark" }) {
  return (
    <div className="kimo-gallery kimo-gallery--m3" data-theme={theme} data-pen="uS8Fr">
      <header className="kimo-gallery__header" data-pen="ihu5z">
        <p className="kimo-gallery__eyebrow">KIMO DESIGN SYSTEM · M4</p>
        <h1 className="kimo-gallery__title">Components — Files</h1>
      </header>
      <GalleryM4FilesSections />
    </div>
  )
}
