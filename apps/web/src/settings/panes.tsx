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
import { isPlatformError, isValidSetting } from "@kimo/platform"
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
import { LANGUAGES, t } from "../lib/i18n"
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
  SETTING_LABELS,
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

function ChoiceSelect({ k, props }: { k: ChoiceKey; props: PaneProps }) {
  const current = props.settings[k]
  return (
    <Select
      dense
      className="settings-select"
      style={{ width: SELECT_WIDTH[k] }}
      label={t(SETTING_LABELS[k])}
      options={selectOptions(k, current)}
      value={String(current)}
      onChange={(raw) => {
        const v = parseChoice(k, raw)
        if (v !== null) props.set(k, v)
      }}
    />
  )
}

/** General › Language: the options are the packs themselves, shown in their own language. */
function LanguageSelect({ props }: { props: PaneProps }) {
  const current = props.settings["general.language"]
  return (
    <Select
      dense
      className="settings-select"
      style={{ width: LANGUAGE_SELECT_WIDTH }}
      label={t("setting.general.language")}
      options={Object.entries(LANGUAGES).map(([id, pack]) => ({ value: id, label: pack.label }))}
      value={current}
      onChange={(raw) => {
        if (isValidSetting("general.language", raw)) props.set("general.language", raw)
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

/** The language Select's width (the other General rows use 104). */
const LANGUAGE_SELECT_WIDTH = 104

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
  // D15: desktop asks the OS (Launch Services); the installed web app's `file_handlers` make it
  // the handler, so the browser has nothing to check. Hidden where the OS gives no answer.
  const defaultApp = useAsync(
    async () => (platform.defaultApp ? platform.defaultApp.status() : ("default" as const)),
    [platform],
  )
  const showDefaultApp =
    platform.capabilities.fileAssociation &&
    (defaultApp.value === "default" || defaultApp.value === "other")
  const rows: ReactNode[] = [
    <SettingRow
      key="autosave"
      label={t("setting.files.autosave")}
      description={autosaveDescription(settings["files.autosaveIntervalMs"])}
      control={(ids) => <SettingToggle k="files.autosave" props={props} {...ids} />}
    />,
    <SettingRow
      key="interval"
      label={t("setting.files.autosaveIntervalMs")}
      description={t("settings.files.idle")}
      control={<ChoiceSelect k="files.autosaveIntervalMs" props={props} />}
    />,
    <SettingRow
      key="recovery"
      label={t("setting.files.recoverySnapshotMs")}
      description={t("settings.files.recoveryDesc")}
      control={<ChoiceSelect k="files.recoverySnapshotMs" props={props} />}
    />,
    <SettingRow
      key="external"
      label={t("setting.files.onExternalChange")}
      description={t("settings.files.externalDesc")}
      control={<ChoiceSelect k="files.onExternalChange" props={props} />}
    />,
    <SettingRow
      key="git-pause"
      label={t("setting.files.pauseAutosaveDuringGit")}
      description={t("settings.files.gitPauseDesc")}
      control={(ids) => <SettingToggle k="files.pauseAutosaveDuringGit" props={props} {...ids} />}
    />,
  ]
  if (showNewFiles)
    rows.push(
      <SettingRow
        key="new-files"
        label={t("setting.files.newFilesDir")}
        description={t("settings.files.newFilesDesc")}
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
                  const dir = await platform.dialogs.pickFolder({
                    title: t("setting.files.newFilesDir"),
                  })
                  if (dir) await set("files.newFilesDir", dir)
                } catch (e) {
                  if (!isPlatformError(e, "CANCELLED")) fail(t("errors.chooseFolder"), e)
                }
              }}
            >
              {t("settings.files.change")}
            </RowButton>
          </>
        }
      />,
    )
  if (showGit)
    rows.push(
      <SettingRow
        key="merge-driver"
        label={t("settings.files.mergeDriver")}
        description={
          repos.value ? mergeDriverDescription(configured, total) : t("settings.files.checking")
        }
        control={
          <RowButton
            disabled={!repos.value || configured === total}
            onClick={async function setUp() {
              try {
                for (const r of repos.value ?? [])
                  if (!r.ok) await platform.git.installMergeDriver(r.root)
              } catch (e) {
                fail(t("errors.setUpMergeDriver"), e, () => void setUp())
              }
              repos.reload()
            }}
          >
            {t("settings.files.setUp")}
          </RowButton>
        }
      />,
    )
  if (showDefaultApp)
    rows.push(
      <SettingRow
        key="default-app"
        label={t("settings.files.defaultApp")}
        description={t("settings.files.defaultAppDesc", {
          where: t(
            platform.os === "windows"
              ? "settings.files.explorer"
              : platform.os === "linux"
                ? "settings.files.fileManager"
                : "settings.files.finder",
          ),
        })}
        control={
          defaultApp.value === "default" ? (
            <ValueText>{t("ui.settings.panes.t1")}</ValueText>
          ) : (
            <RowButton
              onClick={async function makeDefault() {
                try {
                  await platform.defaultApp?.makeDefault()
                } catch (e) {
                  fail(t("errors.makeDefaultApp"), e, () => void makeDefault())
                }
                defaultApp.reload()
              }}
            >
              {t("settings.files.makeDefault")}
            </RowButton>
          )
        }
      />,
    )
  return (
    <>
      <PaneTitle>{t("settings.nav.files")}</PaneTitle>
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
      label={t("setting.privacy.noThirdPartyFetch")}
      description={t("settings.fonts.noFetchDesc")}
      control={(ids) => <SettingToggle k="privacy.noThirdPartyFetch" props={props} {...ids} />}
    />,
    <SettingRow
      key="google"
      label={t("setting.fonts.google")}
      description={t("settings.fonts.googleDesc")}
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
      label={t("settings.fonts.cache")}
      description={
        cache.value?.dir ? displayPath(cache.value.dir, home) : t("settings.fonts.inBrowser")
      }
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
                fail(t("errors.clearFontCache"), e, () => void clear())
              }
              cache.reload()
            }}
          >
            {t("settings.fonts.clear")}
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
        label={t("setting.fonts.extraFolders")}
        description={extraFoldersDescription(platform.os, [], home)}
        last={folders.length > 0}
        control={
          <RowButton
            onClick={async () => {
              try {
                const dir = await platform.dialogs.pickFolder({
                  title: t("settings.fonts.addFolderTitle"),
                })
                if (dir && !folders.includes(dir))
                  await set("fonts.extraFolders", [...folders, dir])
              } catch (e) {
                if (!isPlatformError(e, "CANCELLED")) fail(t("errors.addFontFolder"), e)
              }
            }}
          >
            {t("settings.fonts.addFolder")}
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
              <Tooltip label={t("settings.fonts.removeFolder")} side="top">
                <IconButton
                  size="sm"
                  tone="quiet"
                  className="settings-folder__remove"
                  label={t("settings.fonts.remove", { path: displayPath(dir, home) })}
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
      label={t("setting.fonts.embedInKimoz")}
      description={t("settings.fonts.embedDesc")}
      control={(ids) => <SettingToggle k="fonts.embedInKimoz" props={props} {...ids} />}
    />,
  )
  return (
    <>
      <PaneTitle>{t("settings.nav.fonts")}</PaneTitle>
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
          {t("settings.fonts.cancel")}
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
            void pack.remove().catch((e: unknown) => fail(t("errors.removeFontPack"), e))
          }
        >
          {t("settings.fonts.removePack")}
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
          {t("settings.fonts.download")}
        </RowButton>
      </>
    )
  return (
    <SettingRow
      label={t("settings.fonts.pack")}
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
  const follows = t(
    os === "windows"
      ? "settings.general.osWindows"
      : os === "linux"
        ? "settings.general.osLinux"
        : os === "web"
          ? "settings.general.osWeb"
          : "settings.general.osMac",
  )
  return (
    <>
      <PaneTitle>{t("settings.nav.general")}</PaneTitle>
      {markLast([
        <SettingRow
          key="appearance"
          label={t("setting.general.appearance")}
          description={t("settings.general.appearanceDesc", { os: follows })}
          control={<ChoiceSelect k="general.appearance" props={props} />}
        />,
        <SettingRow
          key="language"
          label={t("setting.general.language")}
          control={<LanguageSelect props={props} />}
        />,
        // The web app has no quit: the open file stays in the tab's URL.
        native(props.platform) && (
          <SettingRow
            key="launch"
            label={t("setting.general.onLaunch")}
            description={t("settings.general.onLaunchDesc")}
            control={<ChoiceSelect k="general.onLaunch" props={props} />}
          />
        ),
        <SettingRow
          key="zoom"
          label={t("setting.general.canvasZoom")}
          description={
            props.settings["general.canvasZoom"] === "mouse"
              ? t("settings.general.zoomMouse")
              : t("settings.general.zoomTrackpad")
          }
          control={<ChoiceSelect k="general.canvasZoom" props={props} />}
        />,
        <SettingRow
          key="duplicateMain"
          label={t("setting.general.duplicateMain")}
          description={t("settings.general.duplicateDesc")}
          control={<ChoiceSelect k="general.duplicateMain" props={props} />}
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
      <PaneTitle>{t("settings.nav.canvas")}</PaneTitle>
      {markLast([
        <SettingRow
          key="snap-objects"
          label={t("setting.canvas.snapToObjects")}
          description={t("settings.canvas.snapObjectsDesc")}
          control={(ids) => <SettingToggle k="canvas.snapToObjects" props={props} {...ids} />}
        />,
        <SettingRow
          key="snap-pixel"
          label={t("setting.canvas.snapToPixelGrid")}
          description={t("settings.canvas.snapPixelDesc")}
          control={(ids) => <SettingToggle k="canvas.snapToPixelGrid" props={props} {...ids} />}
        />,
        <SettingRow
          key="pixel-grid"
          label={t("setting.canvas.pixelGrid")}
          description={t("settings.canvas.gridDesc")}
          control={(ids) => <SettingToggle k="canvas.pixelGrid" props={props} {...ids} />}
        />,
        <SettingRow
          key="rulers"
          label={t("setting.canvas.rulers")}
          description={t("settings.canvas.rulersDesc")}
          control={(ids) => <SettingToggle k="canvas.rulers" props={props} {...ids} />}
        />,
        <SettingRow
          key="nudge"
          label={t("setting.canvas.nudge")}
          description={t("settings.canvas.nudgeDesc")}
          control={<ChoiceSelect k="canvas.nudge" props={props} />}
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
      fail(t("errors.restartKimo"), e, () => void restart())
    }
  }
  const view = updateRowView(status, platform.appVersion, seen.current)
  const notes = view.info?.notesUrl ?? null
  const openNotes = () =>
    void platform.files
      .openExternalUrl(notes as string)
      .catch((e: unknown) => fail(t("errors.openReleaseNotes"), e))
  const rows: ReactNode[] = []
  if (can)
    rows.push(
      <SettingRow
        key="download"
        label={t("setting.updates.download")}
        description={t("settings.updates.downloadDesc")}
        control={(ids) => <SettingToggle k="updates.download" props={props} {...ids} />}
      />,
      <SettingRow
        key="channel"
        label={t("setting.updates.channel")}
        description={t("settings.updates.channelDesc")}
        control={<ChoiceSelect k="updates.channel" props={props} />}
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
            {t("settings.updates.releaseNotes")}
          </RowButton>
        )}
        <RowButton
          variant="primary"
          onClick={() => (view.kind === "ready" ? void restart() : run("download"))}
        >
          {view.kind === "ready" ? t("settings.updates.restart") : t("settings.fonts.download")}
        </RowButton>
      </>
    )
  else
    control = (
      <RowButton disabled={status.state === "checking"} onClick={() => run("check")}>
        {t("settings.updates.checkNow")}
      </RowButton>
    )
  rows.push(
    <SettingRow
      key="version"
      label={can ? view.label : `Kimo ${platform.appVersion}`}
      description={can ? view.description : t("settings.updates.webDesc")}
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
          view.action === "download"
            ? t("settings.updates.downloadFailed")
            : t("settings.updates.checkFailedTitle")
        }
        {...(causeOf(status.message) ? { body: causeOf(status.message) } : {})}
        actions={[{ id: "retry", label: t("settings.retry"), variant: "primary" }]}
        onAction={() => run(view.action)}
        onDismiss={() => setDismissed(status)}
      />
    ) : null
  return (
    <>
      <PaneTitle banner={banner}>{t("settings.nav.updates")}</PaneTitle>
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
