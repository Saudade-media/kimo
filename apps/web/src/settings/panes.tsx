/**
 * Settings panes (board 19): Files & autosave (XmeDB content), Fonts & privacy (gzQqN), General
 * (W7KFDa), Updates (NxkQV), About & licenses (l3JMJ). Each pane is a Title Bar (56, sans 16 /
 * 600) and a list of SettingRow (MuoTX); the last row drops its stroke. Every control writes
 * `platform.settings` immediately (no Save button).
 */
import {
  type FileRef,
  type KimoPlatform,
  REPO_URL_PLACEHOLDER,
  type SettingKey,
  type Settings,
  type SettingsSchema,
} from "@kimo/platform"
import { Button, Select, SettingRow, Toggle } from "@kimo/ui"
import { cloneElement, isValidElement, type ReactNode } from "react"
import { useAsync, useUpdaterStatus } from "./hooks"
import {
  autosaveDescription,
  type ChoiceKey,
  displayPath,
  extraFoldersDescription,
  fontCacheLabel,
  homeOf,
  mergeDriverDescription,
  parseChoice,
  SELECT_WIDTH,
  selectOptions,
  shortTime,
  updaterDescription,
} from "./model"

export interface PaneProps {
  platform: KimoPlatform
  settings: Settings
  set: <K extends SettingKey>(key: K, value: SettingsSchema[K]) => void
  /** The font cache was cleared (the font system re-reads it). */
  onFontCacheCleared?: () => void
  /** Open-source licenses: how many packages, and where the NOTICE lives. */
  licenses?: { count: number | null; url: string | null }
}

export function PaneTitle({ children }: { children: string }) {
  return (
    <div className="settings-title-bar">
      <h2 className="settings-title">{children}</h2>
    </div>
  )
}

function ChoiceSelect({ k, props, label }: { k: ChoiceKey; props: PaneProps; label: string }) {
  const current = props.settings[k]
  return (
    <Select
      dense
      className="settings-select"
      style={{ width: SELECT_WIDTH[k] }}
      label={label}
      options={selectOptions(k, current)}
      value={String(current)}
      onChange={(raw) => {
        const v = parseChoice(k, raw)
        if (v !== null) props.set(k, v)
      }}
    />
  )
}

function SettingToggle({
  k,
  props,
  labelId,
  descriptionId,
  disabled = false,
  checked,
}: {
  k: SettingKey
  props: PaneProps
  labelId: string
  descriptionId: string
  disabled?: boolean
  checked?: boolean
}) {
  const value = checked ?? (props.settings[k] as boolean)
  return (
    <Toggle
      checked={value}
      disabled={disabled}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onChange={(next) => props.set(k, next as never)}
    />
  )
}

function ValueText({ children }: { children: ReactNode }) {
  return <span className="settings-value">{children}</span>
}

function RowButton({
  variant = "secondary",
  onClick,
  disabled,
  children,
}: {
  variant?: "secondary" | "ghost"
  onClick: () => void
  disabled?: boolean
  children: string
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      className="settings-button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

const native = (p: KimoPlatform) =>
  p.capabilities.fileAccess === "native" || p.capabilities.fileAccess === "memory"

// --- Files & autosave ---------------------------------------------------------------------------

export function FilesPane(props: PaneProps) {
  const { platform, settings, set } = props
  const home = homeOf(platform.recovery.dir)
  const repos = useAsync(async () => {
    if (!platform.capabilities.git) return null
    const folders = await platform.recents.listFolders()
    const roots = new Set<FileRef>()
    for (const f of folders) {
      const st = await platform.git.state(f.ref).catch(() => null)
      if (st) roots.add(st.repoRoot)
    }
    const status = await Promise.all(
      [...roots].map(async (root) => {
        const s = await platform.git.mergeDriverStatus(root).catch(() => null)
        return { root, ok: !!s && s.gitattributes && s.config }
      }),
    )
    return status
  }, [platform])
  const configured = repos.value?.filter((r) => r.ok).length ?? 0
  const total = repos.value?.length ?? 0
  const showNewFiles = native(platform)
  const showGit = platform.capabilities.git
  const showDefaultApp = platform.capabilities.fileAssociation
  const rows: ReactNode[] = [
    <SettingRow
      key="autosave"
      label="Autosave"
      description={autosaveDescription(settings["files.autosaveIntervalMs"])}
      control={(ids) => <SettingToggle k="files.autosave" props={props} {...ids} />}
    />,
    <SettingRow
      key="interval"
      label="Autosave interval"
      description="Idle time before a write."
      control={
        <ChoiceSelect
          k="files.autosaveIntervalMs"
          props={props}
          label={LABEL["files.autosaveIntervalMs"]}
        />
      }
    />,
    <SettingRow
      key="recovery"
      label="Recovery snapshots"
      description="Kept in ~/.kimo/recovery for 30 days, even when autosave is off."
      control={
        <ChoiceSelect
          k="files.recoverySnapshotMs"
          props={props}
          label={LABEL["files.recoverySnapshotMs"]}
        />
      }
    />,
    <SettingRow
      key="external"
      label="When a file changes on disk"
      description="With no local edits Kimo always reloads; this applies when you have edits."
      control={
        <ChoiceSelect
          k="files.onExternalChange"
          props={props}
          label={LABEL["files.onExternalChange"]}
        />
      }
    />,
    <SettingRow
      key="git-pause"
      label="Pause autosave during git operations"
      description="Detects index.lock, rebase, merge, cherry-pick and branch switches."
      control={(ids) => <SettingToggle k="files.pauseAutosaveDuringGit" props={props} {...ids} />}
    />,
  ]
  if (showNewFiles)
    rows.push(
      <SettingRow
        key="new-files"
        label="New files go to"
        description="Used by New file when no folder is selected on Home."
        control={
          <>
            <ValueText>
              {settings["files.newFilesDir"]
                ? displayPath(settings["files.newFilesDir"], home)
                : "~/Documents/Kimo"}
            </ValueText>
            <RowButton
              onClick={async () => {
                const dir = await platform.dialogs
                  .pickFolder({ title: "New files go to" })
                  .catch(() => null)
                if (dir) set("files.newFilesDir", dir)
              }}
            >
              Change…
            </RowButton>
          </>
        }
      />,
    )
  if (showGit)
    rows.push(
      <SettingRow
        key="merge-driver"
        label="Git merge driver"
        description={repos.value ? mergeDriverDescription(configured, total) : "Checking…"}
        control={
          <RowButton
            disabled={!repos.value || configured === total}
            onClick={async () => {
              for (const r of repos.value ?? [])
                if (!r.ok) await platform.git.installMergeDriver(r.root).catch(() => {})
              repos.reload()
            }}
          >
            Set up…
          </RowButton>
        }
      />,
    )
  if (showDefaultApp)
    rows.push(
      <SettingRow
        key="default-app"
        label="Default app for .kimo and .kimoz"
        description={`Kimo opens these files from ${platform.os === "windows" ? "Explorer" : platform.os === "linux" ? "your file manager" : "Finder"} and kimo:// links.`}
        control={<ValueText>Kimo ✓</ValueText>}
      />,
    )
  return (
    <>
      <PaneTitle>Files & autosave</PaneTitle>
      {markLast(rows)}
    </>
  )
}

// --- Fonts & privacy ----------------------------------------------------------------------------

export function FontsPane(props: PaneProps) {
  const { platform, settings, set } = props
  const home = homeOf(platform.recovery.dir)
  const cache = useAsync(() => platform.fonts.cache.stats(), [platform])
  const blocked = settings["privacy.noThirdPartyFetch"]
  const rows: ReactNode[] = [
    <SettingRow
      key="ntpf"
      label="No third-party fetch"
      description="Kimo has no telemetry. This also blocks Google Fonts and remote image URLs."
      control={(ids) => <SettingToggle k="privacy.noThirdPartyFetch" props={props} {...ids} />}
    />,
    <SettingRow
      key="google"
      label="Google Fonts"
      description="Fetched on first use, then cached by content hash. Off while No third-party fetch is on."
      dimmed={blocked || !platform.capabilities.remoteFonts}
      control={(ids) => (
        <SettingToggle
          k="fonts.google"
          props={props}
          {...ids}
          disabled={blocked || !platform.capabilities.remoteFonts}
          checked={!blocked && settings["fonts.google"]}
        />
      )}
    />,
    <SettingRow
      key="cache"
      label="Font cache"
      description={cache.value?.dir ? displayPath(cache.value.dir, home) : "Stored in this browser"}
      control={
        <>
          <ValueText>
            {cache.value ? fontCacheLabel(cache.value.count, cache.value.bytes) : "—"}
          </ValueText>
          <RowButton
            variant="ghost"
            disabled={!cache.value?.count}
            onClick={async () => {
              await platform.fonts.cache.clear().catch(() => {})
              cache.reload()
              props.onFontCacheCleared?.()
            }}
          >
            Clear
          </RowButton>
        </>
      }
    />,
  ]
  if (native(platform) && platform.capabilities.localFonts)
    rows.push(
      <SettingRow
        key="folders"
        label="Extra font folders"
        description={extraFoldersDescription(platform.os, settings["fonts.extraFolders"], home)}
        control={
          <RowButton
            onClick={async () => {
              const dir = await platform.dialogs
                .pickFolder({ title: "Add font folder" })
                .catch(() => null)
              if (dir && !settings["fonts.extraFolders"].includes(dir))
                set("fonts.extraFolders", [...settings["fonts.extraFolders"], dir])
            }}
          >
            Add folder…
          </RowButton>
        }
      />,
    )
  rows.push(
    <SettingRow
      key="embed"
      label="Embed fonts in .kimoz packages"
      description="Only fonts whose license allows embedding (OS/2 fsType)."
      control={(ids) => <SettingToggle k="fonts.embedInKimoz" props={props} {...ids} />}
    />,
  )
  return (
    <>
      <PaneTitle>Fonts & privacy</PaneTitle>
      {markLast(rows)}
    </>
  )
}

// --- General ------------------------------------------------------------------------------------

export function GeneralPane(props: PaneProps) {
  const os = props.platform.os
  const follows =
    os === "windows"
      ? "Windows"
      : os === "linux"
        ? "your desktop"
        : os === "web"
          ? "your system"
          : "macOS"
  return (
    <>
      <PaneTitle>General</PaneTitle>
      {markLast([
        <SettingRow
          key="appearance"
          label="Appearance"
          description={`Follows ${follows} unless set.`}
          control={
            <ChoiceSelect
              k="general.appearance"
              props={props}
              label={LABEL["general.appearance"]}
            />
          }
        />,
        <SettingRow
          key="launch"
          label="On launch"
          description="Reopen the files that were open when you quit."
          control={
            <ChoiceSelect k="general.onLaunch" props={props} label={LABEL["general.onLaunch"]} />
          }
        />,
        <SettingRow
          key="zoom"
          label="Canvas zoom"
          description="Pinch and ⌘ + scroll."
          control={
            <ChoiceSelect
              k="general.canvasZoom"
              props={props}
              label={LABEL["general.canvasZoom"]}
            />
          }
        />,
      ])}
    </>
  )
}

// --- Updates ------------------------------------------------------------------------------------

export function UpdatesPane(props: PaneProps) {
  const { platform } = props
  const status = useUpdaterStatus(platform)
  const can = platform.capabilities.updater
  const rows: ReactNode[] = []
  if (can)
    rows.push(
      <SettingRow
        key="download"
        label="Download updates"
        description="Signed builds only. Kimo asks before restarting."
        control={(ids) => <SettingToggle k="updates.download" props={props} {...ids} />}
      />,
      <SettingRow
        key="channel"
        label="Channel"
        description="Beta gets builds about a week earlier."
        control={
          <ChoiceSelect k="updates.channel" props={props} label={LABEL["updates.channel"]} />
        }
      />,
    )
  rows.push(
    <SettingRow
      key="version"
      label={`Kimo ${platform.appVersion}`}
      description={
        can ? updaterDescription(status, shortTime) : "The web app updates when you reload."
      }
      control={
        can ? (
          <RowButton
            disabled={status.state === "checking" || status.state === "downloading"}
            onClick={() => void platform.updater.check().catch(() => {})}
          >
            Check now
          </RowButton>
        ) : undefined
      }
    />,
  )
  return (
    <>
      <PaneTitle>Updates</PaneTitle>
      {markLast(rows)}
    </>
  )
}

// --- About & licenses ---------------------------------------------------------------------------

export function AboutPane(props: PaneProps) {
  const { platform } = props
  const count = props.licenses?.count ?? null
  const url = props.licenses?.url ?? `${REPO_URL_PLACEHOLDER}/blob/main/NOTICE`
  return (
    <>
      <PaneTitle>About & licenses</PaneTitle>
      <div className="settings-identity">
        <span className="settings-identity__logo" aria-hidden="true">
          <span className="settings-identity__mark">k</span>
        </span>
        <div className="settings-identity__text">
          <span className="settings-identity__name">Kimo {platform.appVersion}</span>
          <span className="settings-identity__license">MIT License · local-first, no account</span>
        </div>
      </div>
      {markLast([
        <SettingRow
          key="licenses"
          label="Open-source licenses"
          description={
            count === null
              ? "Kimo and the packages it ships with."
              : `Kimo and the ${count} packages it ships with.`
          }
          control={
            <RowButton onClick={() => void platform.files.openExternalUrl(url).catch(() => {})}>
              View
            </RowButton>
          }
        />,
        <SettingRow
          key="source"
          label="Source code"
          description="Report issues and read the .kimo format spec."
          control={
            <RowButton
              onClick={() =>
                void platform.files.openExternalUrl(REPO_URL_PLACEHOLDER).catch(() => {})
              }
            >
              Open repo
            </RowButton>
          }
        />,
      ])}
    </>
  )
}

/** The last SettingRow of a pane overrides its stroke to transparent. */
function markLast(rows: ReactNode[]): ReactNode[] {
  return rows.map((r, i) =>
    i === rows.length - 1 && isValidElement<{ last?: boolean }>(r)
      ? cloneElement(r, { last: true })
      : r,
  )
}

/** Accessible names of the Select controls (their row labels). */
const LABEL: Record<ChoiceKey, string> = {
  "files.autosaveIntervalMs": "Autosave interval",
  "files.recoverySnapshotMs": "Recovery snapshots",
  "files.onExternalChange": "When a file changes on disk",
  "general.appearance": "Appearance",
  "general.onLaunch": "On launch",
  "general.canvasZoom": "Canvas zoom",
  "updates.channel": "Channel",
}
