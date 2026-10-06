/**
 * `createTauriPlatform()`: the desktop {@link KimoPlatform} over the Tauri command surface
 * (`./tauri.ts`, ADR 0012 §5). It imports nothing from Tauri: the desktop app passes
 * `@tauri-apps/api`'s `invoke` and a window-scoped `listen` as a {@link TauriBridge}, so the
 * whole mapping is testable in Bun with a mocked bridge.
 *
 * - Rejections (`PlatformErrorPayload`) are rethrown as `PlatformError` with their code/errno.
 * - Binary results arrive as `ArrayBuffer` and binary arguments travel as base64.
 * - Each `kimo://` event has one listener, registered before the platform resolves; watches are
 *   routed by `watchId`.
 */
import type { AppliedCapabilities } from "./capabilities"
import { PlatformError, type PlatformErrorCode } from "./errors"
import { basenameOf } from "./links"
import type { InvokeLike, ListenLike } from "./secrets"
import { isSettingKey, type SettingKey } from "./settings"
import { createSettingsStore } from "./settings-store"
import { createTauriSkills } from "./skills"
import type {
  TauriCommand,
  TauriCommandMap,
  TauriEvent,
  TauriEventMap,
  TypedInvoke,
  TypedListen,
  WindowState,
} from "./tauri"
import { createFileThumbnails, type ThumbnailsApi } from "./thumbnails"
import {
  type EditorMenuAction,
  type FileRef,
  type GitChange,
  type GitState,
  type HelpMenuAction,
  type KimoPlatform,
  type LeaseHolder,
  MACOS_CHROME,
  type OpenRequest,
  RECOVERY_RETENTION_MS,
  type Unsubscribe,
  type UpdaterStatus,
  type WatchEvent,
} from "./types"
import { DEFAULT_WATCH_DEBOUNCE_MS, Emitter } from "./util"

/** What the desktop app hands in: `invoke` from `@tauri-apps/api/core` and `listen` from the
 * current webview window (so events targeted at other windows are not received). */
export interface TauriBridge {
  invoke: TypedInvoke
  listen: TypedListen
}

const CODES: readonly PlatformErrorCode[] = [
  "UNSUPPORTED",
  "CANCELLED",
  "NOT_FOUND",
  "EXISTS",
  "PERMISSION",
  "DISK_FULL",
  "READ_BACK_MISMATCH",
  "LOCKED",
  "BLOCKED",
  "INVALID",
  "IO",
]

/** Maps an invoke rejection (a `PlatformErrorPayload`, or a Tauri string error) to a
 * {@link PlatformError}. */
export function toPlatformError(e: unknown): PlatformError {
  if (e instanceof PlatformError) return e
  if (e && typeof e === "object" && "code" in e) {
    const p = e as { code: unknown; message?: unknown; errno?: unknown }
    const code = CODES.includes(p.code as PlatformErrorCode) ? (p.code as PlatformErrorCode) : "IO"
    const errno = typeof p.errno === "string" ? p.errno : undefined
    return new PlatformError(code, typeof p.message === "string" ? p.message : String(p.code), {
      errno,
      cause: e,
    })
  }
  const message = typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
  // Tauri's own refusals ("… not allowed …") are permission problems.
  const code: PlatformErrorCode = /not allowed|denied/i.test(message) ? "PERMISSION" : "IO"
  return new PlatformError(code, message, { cause: e })
}

/** Base64 of bytes (chunked: no call-stack limit on large files). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

const toBytes = (b: ArrayBuffer | Uint8Array | number[]): Uint8Array =>
  b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b)

const newWatchId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `w${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/**
 * Width the topbar reserves for the lights. The native lights are measured (macOS 26 draws
 * 14 pt buttons: 76; older systems 12 pt: 68), so the inset is the reported right edge of the
 * zoom button; 68 until the first measurement arrives. Fullscreen hides them.
 */
export function trafficLightInsetOf(s: WindowState): number {
  if (s.trafficLightPosition === null) return 0
  if (s.fullscreen) return MACOS_CHROME.fullscreenInset
  const right = s.trafficLightsRight
  return typeof right === "number" && Number.isFinite(right) && right > 0
    ? Math.ceil(right)
    : MACOS_CHROME.inset
}

export async function createTauriPlatform(bridge: TauriBridge): Promise<KimoPlatform> {
  const call = async <C extends TauriCommand>(
    command: C,
    args: TauriCommandMap[C]["args"],
  ): Promise<TauriCommandMap[C]["result"]> => {
    try {
      return await bridge.invoke(command, args)
    } catch (e) {
      throw toPlatformError(e)
    }
  }
  const none = {} as Record<string, never>

  // --- one listener per event ---
  const fsWatches = new Map<string, (events: WatchEvent[]) => void>()
  const leaseWatches = new Map<string, (holder: LeaseHolder | null) => void>()
  const gitWatches = new Map<string, (state: GitState | null, change: GitChange) => void>()
  const recentsEvents = new Emitter<[]>()
  const updaterEvents = new Emitter<[UpdaterStatus]>()
  const focusEvents = new Emitter<[boolean]>()
  const fullscreenEvents = new Emitter<[boolean]>()
  const insetEvents = new Emitter<[number]>()
  const settingsEvents = new Emitter<[string, unknown]>()
  const openEvents = new Emitter<[OpenRequest]>()
  const helpEvents = new Emitter<[HelpMenuAction]>()
  const menuEvents = new Emitter<[EditorMenuAction]>()
  let closeHandler: ((info: { quitting: boolean }) => Promise<boolean> | boolean) | null = null
  let windowState: WindowState = { focused: true, fullscreen: false, trafficLightPosition: null }
  let updaterStatus: UpdaterStatus = { state: "idle" }

  const onWindowState = (s: WindowState) => {
    const prev = windowState
    windowState = s
    if (prev.focused !== s.focused) focusEvents.emit(s.focused)
    if (prev.fullscreen !== s.fullscreen) fullscreenEvents.emit(s.fullscreen)
    const inset = trafficLightInsetOf(s)
    if (trafficLightInsetOf(prev) !== inset) insetEvents.emit(inset)
  }
  const onCloseRequested = async ({
    requestId,
    quitting,
  }: {
    requestId: string
    quitting?: boolean
  }) => {
    let allow = true
    if (closeHandler) {
      try {
        allow = await closeHandler({ quitting: quitting === true })
      } catch {
        allow = false
      }
    }
    await call("kimo_window_confirm_close", { requestId, allow }).catch(() => {})
  }

  const handlers: { [E in TauriEvent]: (payload: TauriEventMap[E]) => void } = {
    "kimo://fs-watch": ({ watchId, events }) => fsWatches.get(watchId)?.(events),
    "kimo://lease-changed": ({ watchId, holder }) => leaseWatches.get(watchId)?.(holder),
    "kimo://git-changed": ({ watchId, state, change }) => gitWatches.get(watchId)?.(state, change),
    "kimo://recents-changed": () => recentsEvents.emit(),
    "kimo://updater-status": (s) => {
      updaterStatus = s
      updaterEvents.emit(s)
    },
    "kimo://window-state": onWindowState,
    "kimo://close-requested": (p) => void onCloseRequested(p),
    "kimo://settings-changed": ({ key, value }) => settingsEvents.emit(key, value),
    "kimo://open-request": (r) => openEvents.emit(r),
    "kimo://help-menu": ({ action }) => helpEvents.emit(action),
    "kimo://editor-menu": ({ action }) => menuEvents.emit(action),
  }
  const unlisteners = await Promise.all(
    (Object.keys(handlers) as TauriEvent[]).map((e) =>
      bridge.listen(e, handlers[e] as (p: TauriEventMap[typeof e]) => void),
    ),
  )

  const [info, initialWindow, initialUpdater, recoveryDir] = await Promise.all([
    call("kimo_app_info", none),
    call("kimo_window_state", none),
    call("kimo_updater_status", none),
    call("kimo_recovery_dir", none),
  ])
  onWindowState(initialWindow)
  updaterStatus = initialUpdater

  // --- settings (Rust owns settings.json; changes are broadcast to every window) ---
  let settings: ReturnType<typeof createSettingsStore> | null = null
  settings = createSettingsStore({
    load: () => call("kimo_settings_get_all", none),
    persist: (key, value) => call("kimo_settings_set", { key, value }).then(() => undefined),
    subscribe: (onRemote) =>
      settingsEvents.on((key, value) => {
        // Our own writes come back as broadcasts: skip values we already hold.
        if (
          settings &&
          isSettingKey(key) &&
          JSON.stringify(settings.get(key as SettingKey)) === JSON.stringify(value)
        )
          return
        onRemote(key, value)
      }),
  })
  const store = settings

  // --- watches ---
  type ActiveWatch = { stop: () => void }
  const active = new Set<ActiveWatch>()
  function startWatch<T>(
    routes: Map<string, T>,
    route: T,
    start: (watchId: string) => Promise<unknown>,
    stop: (watchId: string) => Promise<unknown>,
  ): Unsubscribe {
    const watchId = newWatchId()
    routes.set(watchId, route)
    let started: Promise<unknown> = start(watchId).catch(() => {
      // A watch that cannot start delivers nothing; the session keeps working without it.
      routes.delete(watchId)
    })
    const w: ActiveWatch = {
      stop: () => {
        if (!routes.delete(watchId)) return
        active.delete(w)
        started = started.then(() => stop(watchId)).catch(() => {})
      },
    }
    active.add(w)
    return () => w.stop()
  }

  const os = info.os
  const capabilities: AppliedCapabilities = {
    fileAccess: "native",
    saveInPlace: true,
    watch: true,
    reveal: true,
    leases: "os",
    recovery: "disk",
    git: true,
    localFonts: true,
    remoteFonts: true,
    updater: true,
    trafficLights: os === "macos",
    settingsWindow: true,
    deepLinks: true,
    fileAssociation: true,
    watchedFolders: true,
  }

  const writeBytesAtomic = (ref: FileRef, bytes: Uint8Array, o?: { mkdirs?: boolean }) =>
    call("kimo_fs_write_bytes_atomic", {
      path: ref,
      base64: bytesToBase64(bytes),
      mkdirs: o?.mkdirs ?? false,
    })

  const dialogs: KimoPlatform["dialogs"] = {
    openFile: (o) =>
      call("kimo_dialog_open_file", {
        title: o?.title ?? null,
        filters: o?.filters ?? [],
        multiple: o?.multiple ?? false,
        defaultDir: o?.defaultDir ?? null,
      }),
    saveFile: (o) =>
      call("kimo_dialog_save_file", {
        title: o.title ?? null,
        suggestedName: o.suggestedName,
        filters: o.filters ?? [],
        defaultDir: o.defaultDir ?? null,
      }),
    pickFolder: (o) =>
      call("kimo_dialog_pick_folder", {
        title: o?.title ?? null,
        defaultDir: o?.defaultDir ?? null,
      }),
  }

  let thumbnails: ThumbnailsApi | null = null
  const platform: KimoPlatform = {
    kind: "desktop",
    os,
    appVersion: info.version,
    arch: info.arch,
    help: {
      onMenu: (l) => helpEvents.on(l),
      showLogs: async () => {
        await call("kimo_help_show_logs", none)
      },
    },
    menu: {
      onAction: (l) => menuEvents.on(l),
      setContext: async (context) => {
        await call("kimo_menu_set_context", { context })
      },
    },
    clipboard: {
      async writeText(text) {
        try {
          await call("kimo_clipboard_write_text", { text })
        } catch (e) {
          // Windows / Linux: no native clipboard command; their webviews allow the page API.
          if (!(e instanceof PlatformError) || e.code !== "BLOCKED") throw e
          await navigator.clipboard.writeText(text)
        }
      },
    },
    dock: {
      setAgentWorking: async (source, working) => {
        await call("kimo_dock_agent_activity", { source, working })
      },
    },
    defaultApp: {
      status: () => call("kimo_default_app_status", none),
      makeDefault: async () => {
        await call("kimo_default_app_set", none)
      },
    },
    capabilities,
    // M6 user skills (ADR 0014 §10): own command list (TAURI_SKILLS_COMMANDS), not TAURI_COMMANDS.
    skills: createTauriSkills({
      invoke: (cmd, args) =>
        (bridge.invoke as unknown as InvokeLike)(cmd, args).catch((e: unknown) => {
          throw toPlatformError(e)
        }),
      listen: bridge.listen as unknown as ListenLike,
    }),
    files: {
      readText: (ref) => call("kimo_fs_read_text", { path: ref }),
      readBytes: async (ref) => toBytes(await call("kimo_fs_read_bytes", { path: ref })),
      writeTextAtomic: (ref, text, o) =>
        call("kimo_fs_write_text_atomic", { path: ref, text, mkdirs: o?.mkdirs ?? false }),
      writeBytesAtomic,
      remove: async (ref) => {
        await call("kimo_fs_remove", { path: ref })
      },
      rename: async (from, to) => {
        await call("kimo_fs_rename", { from, to })
      },
      copy: async (from, to) => {
        await call("kimo_fs_copy", { from, to })
      },
      stat: (ref) => call("kimo_fs_stat", { path: ref }),
      list: (dir, o) => call("kimo_fs_list", { dir, extensions: o?.extensions ?? null }),
      watch: (refs, o, listener) =>
        startWatch(
          fsWatches,
          listener,
          (watchId) =>
            call("kimo_fs_watch", {
              watchId,
              paths: refs,
              debounceMs: o.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
              recursive: o.recursive ?? false,
            }),
          (watchId) => call("kimo_fs_unwatch", { watchId }),
        ),
      reveal: async (ref) => {
        await call("kimo_fs_reveal", { path: ref })
      },
      openWithDefaultApp: async (ref) => {
        await call("kimo_fs_open_default", { path: ref })
      },
      openAsText: async (ref) => {
        await call("kimo_fs_open_as_text", { path: ref })
      },
      openExternalUrl: async (url) => {
        await call("kimo_open_url", { url })
      },
      async download(name, bytes) {
        // Desktop has a real save dialog: "download" = Save as… + atomic write.
        const dot = name.lastIndexOf(".")
        const ext = dot > 0 ? name.slice(dot + 1) : ""
        const target = await dialogs.saveFile({
          suggestedName: basenameOf(name),
          filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
        })
        if (target === null) throw new PlatformError("CANCELLED", "Save cancelled")
        await writeBytesAtomic(target, bytes)
      },
    },
    dialogs,
    recents: {
      listFiles: (o) => call("kimo_recents_list_files", { limit: o?.limit ?? null }),
      noteOpened: async (ref) => {
        await call("kimo_recents_note_opened", { path: ref })
      },
      removeFile: async (ref) => {
        await call("kimo_recents_remove_file", { path: ref })
      },
      clearFiles: async () => {
        await call("kimo_recents_clear", none)
      },
      listFolders: () => call("kimo_recents_list_folders", none),
      addFolder: async (ref) => {
        await call("kimo_recents_add_folder", { path: ref })
      },
      removeFolder: async (ref) => {
        await call("kimo_recents_remove_folder", { path: ref })
      },
      scanFolder: (ref) => call("kimo_recents_scan_folder", { path: ref }),
      onChange: (l) => recentsEvents.on(l),
    },
    // Board 37 §9: previews in `~/.kimo/thumbs` (allowed by the scope: the Kimo home).
    get thumbnails() {
      thumbnails ??= createFileThumbnails(platform.files, `${info.kimoHome}/thumbs`)
      return thumbnails
    },
    trash: {
      move: (ref) => call("kimo_trash_move", { path: ref }),
      list: () => call("kimo_trash_list", none),
      restore: (id, to) => call("kimo_trash_restore", { id, path: to ?? null }),
      remove: async (id) => {
        await call("kimo_trash_remove", { id })
      },
      empty: () => call("kimo_trash_empty", none),
    },
    leases: {
      acquire: (ref, o) =>
        call("kimo_lease_acquire", { path: ref, reclaimStale: o?.reclaimStale ?? true }),
      release: async (lease) => {
        await call("kimo_lease_release", { path: lease.ref, token: lease.token })
      },
      inspect: (ref) => call("kimo_lease_inspect", { path: ref }),
      watch: (ref, listener) =>
        startWatch(
          leaseWatches,
          listener,
          (watchId) => call("kimo_lease_watch", { watchId, path: ref }),
          (watchId) => call("kimo_lease_unwatch", { watchId }),
        ),
    },
    recovery: {
      dir: recoveryDir,
      list: () => call("kimo_recovery_list", none),
      write: (input) => call("kimo_recovery_write", { input }),
      restore: (id) => call("kimo_recovery_read", { id }),
      discard: async (id) => {
        await call("kimo_recovery_discard", { id })
      },
      prune: (maxAgeMs = RECOVERY_RETENTION_MS) => call("kimo_recovery_prune", { maxAgeMs }),
    },
    git: {
      state: (ref) => call("kimo_git_state", { path: ref }),
      watch: (ref, listener) =>
        startWatch(
          gitWatches,
          listener,
          (watchId) => call("kimo_git_watch", { watchId, path: ref }),
          (watchId) => call("kimo_git_unwatch", { watchId }),
        ),
      mergeDriverStatus: (repoRoot) => call("kimo_git_merge_driver_status", { repoRoot }),
      installMergeDriver: async (repoRoot) => {
        await call("kimo_git_install_merge_driver", { repoRoot })
      },
    },
    fonts: {
      listLocal: () =>
        call("kimo_fonts_list_local", { extraFolders: store.get("fonts.extraFolders") }),
      loadLocal: async (postscriptName) =>
        toBytes(await call("kimo_fonts_load_local", { postscriptName })),
      cache: {
        get: async (key) => {
          const b = await call("kimo_fonts_cache_get", { key })
          return b === null ? null : toBytes(b)
        },
        put: (meta, bytes) =>
          call("kimo_fonts_cache_put", {
            meta: {
              family: meta.family,
              weight: meta.weight,
              italic: meta.italic,
              source: meta.source,
            },
            base64: bytesToBase64(bytes),
          }),
        list: () => call("kimo_fonts_cache_list", none),
        stats: () => call("kimo_fonts_cache_stats", none),
        clear: async () => {
          await call("kimo_fonts_cache_clear", none)
        },
      },
      pack: {
        get: async (key) => {
          const b = await call("kimo_fonts_pack_get", { key })
          return b === null ? null : toBytes(b)
        },
        put: (meta, bytes) =>
          call("kimo_fonts_pack_put", {
            meta: {
              family: meta.family,
              weight: meta.weight,
              italic: meta.italic,
              source: meta.source,
            },
            base64: bytesToBase64(bytes),
          }),
        list: () => call("kimo_fonts_pack_list", none),
        stats: () => call("kimo_fonts_pack_stats", none),
        clear: async () => {
          await call("kimo_fonts_pack_clear", none)
        },
      },
      fetchRemote: async (url) => toBytes(await call("kimo_fonts_fetch_remote", { url })),
      openCacheFolder: async () => {
        await call("kimo_fonts_open_cache_folder", none)
      },
    },
    updater: {
      status: () => updaterStatus,
      check: () => call("kimo_updater_check", { channel: store.get("updates.channel") }),
      download: async () => {
        await call("kimo_updater_download", none)
      },
      restart: async () => {
        await call("kimo_updater_restart", none)
      },
      onStatus: (l) => updaterEvents.on(l),
    },
    window: {
      label: info.windowLabel,
      trafficLightPosition: () =>
        windowState.trafficLightPosition ? { ...windowState.trafficLightPosition } : null,
      trafficLightInset: () => trafficLightInsetOf(windowState),
      onTrafficLightInsetChange: (l) => insetEvents.on(l),
      titlebarDoubleClick: async () => {
        await call("kimo_window_titlebar_double_click", none)
      },
      isFocused: () => windowState.focused,
      onFocusChange: (l) => focusEvents.on(l),
      isFullscreen: () => windowState.fullscreen,
      onFullscreenChange: (l) => fullscreenEvents.on(l),
      setTitle: async (title) => {
        await call("kimo_window_set_title", { title })
      },
      setDocumentEdited: async (edited) => {
        await call("kimo_window_set_document_edited", { edited })
      },
      openSettings: async (pane, focus) => {
        await call("kimo_window_open_settings", { pane: pane ?? null, focus: focus ?? null })
        return "window"
      },
      openNewWindow: async () => {
        await call("kimo_window_new", none)
      },
      onCloseRequested(handler) {
        closeHandler = handler
        return () => {
          if (closeHandler === handler) closeHandler = null
        }
      },
      close: async () => {
        await call("kimo_window_close", none)
      },
    },
    settings: store,
    launch: {
      takeInitialRequests: () => call("kimo_launch_take_initial", none),
      onOpenRequest: (l) => openEvents.on(l),
    },
    dispose() {
      for (const w of [...active]) w.stop()
      for (const off of unlisteners) off()
      store.dispose()
      for (const e of [
        recentsEvents,
        updaterEvents,
        focusEvents,
        fullscreenEvents,
        settingsEvents,
        openEvents,
      ])
        e.clear()
      closeHandler = null
    },
  }
  return platform
}
