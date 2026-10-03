/**
 * What a host can do. The UI reads these up front to hide affordances (e.g. no "Reveal in
 * Finder" on the web); calling an unsupported method still rejects with `UNSUPPORTED`.
 */
export interface AppliedCapabilities {
  /**
   * How files are accessed: `native` (desktop paths), `fsa` (File System Access handles,
   * Chromium), `upload-download` (pick via `<input type=file>`, save via download; no
   * in-place save, no watch), `memory` (tests).
   */
  fileAccess: "native" | "fsa" | "upload-download" | "memory"
  /** In-place save of the opened file (desktop, FSA). */
  saveInPlace: boolean
  /** File watching (desktop: notify; FSA: polling `getFile().lastModified`). */
  watch: boolean
  /** Reveal in Finder / open with the default app. */
  reveal: boolean
  /** Per-file leases: `os` = lock files shared with the CLI; `tab` = Web Locks (same browser
   * profile only); `none`. */
  leases: "os" | "tab" | "none"
  /** Recovery store: `disk` (`~/.kimo/recovery`), `indexeddb`, `memory`. */
  recovery: "disk" | "indexeddb" | "memory"
  /** Git state of the repo containing a file. */
  git: boolean
  /** Enumerate and load installed fonts. */
  localFonts: boolean
  /** Remote font fetch (subject to settings). */
  remoteFonts: boolean
  updater: boolean
  /** macOS traffic-light inset in the topbar. */
  trafficLights: boolean
  /** Settings opens as a separate window (desktop) instead of an in-app dialog (web). */
  settingsWindow: boolean
  deepLinks: boolean
  fileAssociation: boolean
  /** Watched folders on Home (needs directory access). */
  watchedFolders: boolean
}
