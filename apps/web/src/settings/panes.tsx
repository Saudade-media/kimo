/**
 * Settings panes (board 19): Files & autosave (XmeDB content), Fonts & privacy (gzQqN), General
 * (W7KFDa), Updates (NxkQV); About & licenses is board 25 (AboutPane.tsx). Each pane is a
 * Title Bar (56, sans 16 / 600) and a list of SettingRow (MuoTX); the last row drops its stroke.
 * Every control writes
 * `platform.settings` immediately (no Save button).
 */
import type {
  FileRef,
  KimoPlatform,
  SettingKey,
  Settings,
  SettingsSchema,
  UpdateInfo,
  UpdaterStatus,
} from "@kimo/platform"
import { isPlatformError } from "@kimo/platform"
import {
  Banner,
  Button,
  IconButton,
  ProgressTrack,
  Select,
  SettingRow,
  Toggle,
  Tooltip,
} from "@kimo/ui"
import { Folder, X } from "lucide-react"
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { causeOf } from "../editor/errors"
import { fontPackController } from "../fonts/font-pack"
import { announceFontCacheCleared } from "../fonts/font-system"
import { flushAllWindows } from "../updater/restart-broadcast"
import { useAsync, useUpdaterStatus } from "./hooks"
import {
  autosaveDescription,
  type ChoiceKey,
  displayPath,
  extraFoldersDescription,
  fontCacheLabel,
  fontPackDescription,
  fontPackProgressLabel,
  formatSize,
  homeOf,
  mergeDriverDescription,
  parseChoice,
  SELECT_WIDTH,
  selectOptions,
  type UpdateAction,
  updateRowView,
} from "./model"

export interface PaneProps {
  platform: KimoPlatform
  settings: Settings
  /** Writes a setting; resolves false when the host refused it (the banner says why). */
  set: <K extends SettingKey>(key: K, value: SettingsSchema[K]) => Promise<boolean> | undefined
  /** The font cache was cleared (the font system re-reads it). */
  onFontCacheCleared?: () => void
}

/**
 * The pane's error banner (board 37 CT1wv / eEmwX): Banner/Danger right under the Title Bar
 * (index 1), radius-md with a 1 px danger-soft stroke. Null when nothing failed.
 */
export const SettingsBannerContext = createContext<ReactNode>(null)

/** What the pane banner shows: "Couldn't save Canvas zoom" / the cause, Retry when possible. */
export interface SettingsFailure {
  title: string
  body: string
  retry?: () => void
}

/**
 * Reports a failed action in a pane (audit A5): `what` completes "Couldn't …" ("start the MCP
 * server"), `error` gives the cause, `retry` adds Retry. Outside SettingsView it logs.
 */
export type SettingsFail = (what: string, error: unknown, retry?: () => void) => void

export const SettingsFailContext = createContext<SettingsFail>((what, error) =>
  console.warn(`Kimo: couldn't ${what}`, error),
)

export function PaneTitle({ children, banner }: { children: string; banner?: ReactNode }) {
  const shared = useContext(SettingsBannerContext)
  return (
    <>
      <div className="settings-title-bar" data-tauri-drag-region="deep">
        <h2 className="settings-title">{children}</h2>
      </div>
      {banner ?? shared}
    </>
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
  variant?: "secondary" | "ghost" | "primary"
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
  const fail = useContext(SettingsFailContext)
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
                try {
                  const dir = await platform.dialogs.pickFolder({ title: "New files go to" })
                  if (dir) await set("files.newFilesDir", dir)
                } catch (e) {
                  if (!isPlatformError(e, "CANCELLED")) fail("choose a folder", e)
                }
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
            onClick={async function setUp() {
              try {
                for (const r of repos.value ?? [])
                  if (!r.ok) await platform.git.installMergeDriver(r.root)
              } catch (e) {
                fail("set up the git merge driver", e, () => void setUp())
              }
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
  const fail = useContext(SettingsFailContext)
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
    <FontPackRow
      key="pack"
      platform={platform}
      blocked={blocked}
      googleOn={settings["fonts.google"]}
      home={home}
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
            onClick={async function clear() {
              try {
                await platform.fonts.cache.clear()
                announceFontCacheCleared()
                props.onFontCacheCleared?.()
              } catch (e) {
                fail("clear the font cache", e, () => void clear())
              }
              cache.reload()
            }}
          >
            Clear
          </RowButton>
        </>
      }
    />,
  ]
  if (native(platform) && platform.capabilities.localFonts) {
    const folders = settings["fonts.extraFolders"]
    // Board 37 D16 (GQGHQ): the row drops its stroke and the Folder List (YXF40) follows it.
    rows.push(
      <SettingRow
        key="folders"
        label="Extra font folders"
        description={extraFoldersDescription(platform.os, [], home)}
        last={folders.length > 0}
        control={
          <RowButton
            onClick={async () => {
              try {
                const dir = await platform.dialogs.pickFolder({ title: "Add font folder" })
                if (dir && !folders.includes(dir))
                  await set("fonts.extraFolders", [...folders, dir])
              } catch (e) {
                if (!isPlatformError(e, "CANCELLED")) fail("add the font folder", e)
              }
            }}
          >
            Add folder…
          </RowButton>
        }
      />,
    )
    if (folders.length)
      rows.push(
        <div key="folder-list" className="settings-folder-list" data-pen="YXF40">
          {folders.map((dir) => (
            <div key={dir} className="settings-folder" data-folder={dir}>
              <Folder className="settings-folder__icon" aria-hidden="true" />
              <span className="settings-folder__path">{displayPath(dir, home)}</span>
              <span className="settings-folder__spacer" />
              <Tooltip label="Remove folder" side="top">
                <IconButton
                  size="sm"
                  tone="quiet"
                  className="settings-folder__remove"
                  label={`Remove ${displayPath(dir, home)}`}
                  icon={<X />}
                  // The font system rescans when `fonts.extraFolders` changes.
                  onClick={() =>
                    void set(
                      "fonts.extraFolders",
                      folders.filter((f) => f !== dir),
                    )
                  }
                />
              </Tooltip>
            </div>
          ))}
        </div>,
      )
  }
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

/**
 * Board 28 "Offline font pack" (xW7Mh; states rCcF5 downloading, TEciq downloaded, UN6YR
 * blocked): Value + Download · Progress 160 + Cancel · size + Remove · dimmed 45 %.
 */
function FontPackRow({
  platform,
  blocked,
  googleOn,
  home,
}: {
  platform: KimoPlatform
  blocked: boolean
  googleOn: boolean
  home: string | null
}) {
  const fail = useContext(SettingsFailContext)
  const pack = fontPackController(platform)
  const state = useSyncExternalStore(pack.subscribe, pack.state, pack.state)
  const off = blocked ? "ntpf" : googleOn ? null : "google-off"
  const description = fontPackDescription(state, off, (d) => displayPath(d, home))
  const estimate = pack.estimate()
  let control: ReactNode
  if (state.status === "downloading")
    control = (
      <>
        <ProgressTrack
          className="settings-pack-progress"
          value={state.total ? state.done / state.total : 0}
          label={fontPackProgressLabel(state.bytes, estimate)}
        />
        <RowButton variant="ghost" onClick={() => pack.cancel()}>
          Cancel
        </RowButton>
      </>
    )
  else if (state.status === "ready")
    control = (
      <>
        <ValueText>{formatSize(state.bytes)}</ValueText>
        <RowButton
          variant="ghost"
          onClick={() =>
            void pack.remove().catch((e: unknown) => fail("remove the offline font pack", e))
          }
        >
          Remove
        </RowButton>
      </>
    )
  else
    control = (
      <>
        <ValueText>{formatSize(estimate)}</ValueText>
        <RowButton
          disabled={
            off !== null || state.status === "loading" || !platform.capabilities.remoteFonts
          }
          onClick={() => void pack.download()}
        >
          Download
        </RowButton>
      </>
    )
  return (
    <SettingRow
      label="Offline font pack"
      description={description}
      dimmed={off !== null && state.status !== "ready" && state.status !== "downloading"}
      control={control}
      data-setting="font-pack"
    />
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
        // The web app has no quit: the open file stays in the tab's URL.
        native(props.platform) && (
          <SettingRow
            key="launch"
            label="On launch"
            description="Reopen the files that were open when you quit."
            control={
              <ChoiceSelect k="general.onLaunch" props={props} label={LABEL["general.onLaunch"]} />
            }
          />
        ),
        <SettingRow
          key="zoom"
          label="Canvas zoom"
          description={
            props.settings["general.canvasZoom"] === "mouse"
              ? "Scroll to zoom; ⇧ + scroll pans."
              : "Pinch and ⌘ + scroll."
          }
          control={
            <ChoiceSelect
              k="general.canvasZoom"
              props={props}
              label={LABEL["general.canvasZoom"]}
            />
          }
        />,
        <SettingRow
          key="duplicateMain"
          label="Duplicating a main component"
          description="⌘D, ⌥-drag and Edit › Duplicate on a main."
          control={
            <ChoiceSelect
              k="general.duplicateMain"
              props={props}
              label={LABEL["general.duplicateMain"]}
            />
          }
        />,
      ])}
    </>
  )
}

// --- Canvas (board 27 §4 Lwg6P) -----------------------------------------------------------------

/**
 * Settings › Canvas (board 27 Lwg6P "Pane · Canvas" xg9X8): Title Bar "Canvas", then SettingRow
 * MuoTX × 5 — Snap to objects, Snap to pixel grid, Pixel grid (toggles, on), Rulers (toggle,
 * off) and Nudge (Select gP276 136). App preferences (not file data): the View menu writes the
 * same keys.
 */
export function CanvasPane(props: PaneProps) {
  return (
    <>
      <PaneTitle>Canvas</PaneTitle>
      {markLast([
        <SettingRow
          key="snap-objects"
          label="Snap to objects"
          description="Edges, centres and equal gaps of nearby layers."
          control={(ids) => <SettingToggle k="canvas.snapToObjects" props={props} {...ids} />}
        />,
        <SettingRow
          key="snap-pixel"
          label="Snap to pixel grid"
          description="Round positions and sizes to whole pixels."
          control={(ids) => <SettingToggle k="canvas.snapToPixelGrid" props={props} {...ids} />}
        />,
        <SettingRow
          key="pixel-grid"
          label="Pixel grid"
          description="Shown at 800 % zoom and above."
          control={(ids) => <SettingToggle k="canvas.pixelGrid" props={props} {...ids} />}
        />,
        <SettingRow
          key="rulers"
          label="Rulers"
          description="Top and left rulers in canvas units."
          control={(ids) => <SettingToggle k="canvas.rulers" props={props} {...ids} />}
        />,
        <SettingRow
          key="nudge"
          label="Nudge"
          description="Arrow keys move by; ⇧ uses the big step."
          control={<ChoiceSelect k="canvas.nudge" props={props} label={LABEL["canvas.nudge"]} />}
        />,
      ])}
    </>
  )
}

// --- Updates ------------------------------------------------------------------------------------

export function UpdatesPane(props: PaneProps) {
  const { platform } = props
  const status = useUpdaterStatus(platform)
  const fail = useContext(SettingsFailContext)
  const can = platform.capabilities.updater
  // The last update seen (an error keeps showing it, board 37 C60dt0), its size once known, and
  // whether the last thing that ran was a download (the banner says which failed).
  const seen = useRef<{ info: UpdateInfo | null; total: number | null; action: UpdateAction }>({
    info: null,
    total: null,
    action: "check",
  })
  if ("info" in status) seen.current.info = status.info
  if (status.state === "downloading" && status.total) seen.current.total = status.total
  const [dismissed, setDismissed] = useState<UpdaterStatus | null>(null)
  const run = (action: UpdateAction) => {
    seen.current.action = action
    setDismissed(null)
    const p =
      action === "download"
        ? platform.updater.download()
        : platform.updater.check().then(() => undefined)
    p.catch((e: unknown) => {
      // The host reports most failures as the `error` status (the banner); anything else here.
      if (platform.updater.status().state !== "error")
        fail(action === "download" ? "download the update" : "check for updates", e, () =>
          run(action),
        )
    })
  }
  const restart = async () => {
    try {
      const unsaved = await flushAllWindows()
      if (unsaved > 0)
        return fail(
          "restart Kimo",
          `${unsaved} ${unsaved === 1 ? "file couldn't" : "files couldn't"} be saved. Save ${unsaved === 1 ? "it" : "them"}, then try again`,
          () => void restart(),
        )
      await platform.updater.restart()
    } catch (e) {
      fail("restart Kimo", e, () => void restart())
    }
  }
  const view = updateRowView(status, platform.appVersion, seen.current)
  const notes = view.info?.notesUrl ?? null
  const openNotes = () =>
    void platform.files
      .openExternalUrl(notes as string)
      .catch((e: unknown) => fail("open the release notes", e))
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
  let control: ReactNode
  if (!can) control = undefined
  else if (view.kind === "downloading")
    control = (
      <>
        <span className="settings-update-progress" data-pen="yTcLk">
          <span
            className="settings-update-progress__bar"
            style={{ width: `${view.percent ?? 0}%` }}
          />
        </span>
        <span className="settings-update-percent">
          {view.percent === null ? "…" : `${view.percent}%`}
        </span>
      </>
    )
  else if (view.kind === "available" || view.kind === "ready")
    control = (
      <>
        {notes && (
          <RowButton variant="ghost" onClick={openNotes}>
            Release notes
          </RowButton>
        )}
        <RowButton
          variant="primary"
          onClick={() => (view.kind === "ready" ? void restart() : run("download"))}
        >
          {view.kind === "ready" ? "Restart to update" : "Download"}
        </RowButton>
      </>
    )
  else
    control = (
      <RowButton disabled={status.state === "checking"} onClick={() => run("check")}>
        Check now
      </RowButton>
    )
  rows.push(
    <SettingRow
      key="version"
      label={can ? view.label : `Kimo ${platform.appVersion}`}
      description={can ? view.description : "The web app updates when you reload."}
      control={control}
      data-update-state={view.kind}
    />,
  )
  // Board 37 eEmwX: Banner/Danger under the Title Bar, "Couldn't download the update" · Retry.
  const banner =
    can && status.state === "error" && dismissed !== status ? (
      <Banner
        tone="danger"
        className="settings-banner"
        data-pen="eEmwX"
        data-testid="settings-update-error"
        title={
          view.action === "download" ? "Couldn't download the update" : "Couldn't check for updates"
        }
        {...(causeOf(status.message) ? { body: causeOf(status.message) } : {})}
        actions={[{ id: "retry", label: "Retry", variant: "primary" }]}
        onAction={() => run(view.action)}
        onDismiss={() => setDismissed(status)}
      />
    ) : null
  return (
    <>
      <PaneTitle banner={banner}>Updates</PaneTitle>
      {markLast(rows)}
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
  "general.duplicateMain": "Duplicating a main component",
  "canvas.nudge": "Nudge",
  "updates.channel": "Channel",
}
