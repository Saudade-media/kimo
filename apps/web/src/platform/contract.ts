/**
 * M4 document-session contract (ADR 0012): the states, banners, toasts, dialogs and the
 * conflict-resolution API the editor shows for a file on disk, exactly as designed on boards
 * 02d (components), 16 (desktop shell), 17 (files & recovery), 18 (merge conflicts) and 19
 * (fonts, assets & settings) of `desing.pen`.
 *
 * Builders implement {@link SessionManager} / {@link DocumentSession} in
 * `apps/web/src/platform/session.ts` on top of `@kimo/platform` (host) and `@kimo/sync`'s
 * {@link FileSessionProvider}; the UI renders {@link SessionState} only. Copy strings here are
 * the design's; components are named by their `desing.pen` component (and node id).
 */
import type {
  AppliedState,
  ConflictKind,
  ConflictSide,
  MergeInfo,
  ThreeWayMerge,
} from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import {
  ACTIVITY_LIMIT,
  type ActivityEntry,
  APPROVAL_TIMEOUT_MS,
  type ApprovalOutcome,
  type ApprovalRequest,
  type ClientIdentity,
  type ClientPolicy,
} from "@kimo/mcp-server"
import type { HostStatus as InstallerHostStatus } from "@kimo/mcp-server/installer"
import type {
  FileRef,
  GitOperation,
  GitState,
  HostOS,
  KimoPlatform,
  LeaseHolder,
  McpActivityEntry,
  McpApprovalChoice,
  McpApprovalOutcome,
  McpApprovalRequest,
  McpClientIdentity,
  McpClientPolicy,
  McpConnectionInfo,
  McpHostApi,
  McpHostConfigStatus,
  McpHostId,
  McpServerStatus,
  OpenRequest,
  RecoveryReason as PlatformRecoveryReason,
  RecoveryEntry,
  Unsubscribe,
  UpdateInfo,
} from "@kimo/platform"
import type {
  AtomicFileStore,
  ExternalChangeOutcome,
  FileSessionProvider,
  ReloadUndoToken,
  SaveFailure,
  RecoveryReason as SyncRecoveryReason,
} from "@kimo/sync"

// ===============================================================================================
// Compile-time links between the packages (fail typecheck when they drift)
// ===============================================================================================

type Assert<T extends true> = T
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** `platform.files` plugs into the file provider as its {@link AtomicFileStore}. */
export type FilesAreAtomicStore = Assert<
  KimoPlatform["files"] extends AtomicFileStore ? true : false
>
/** Recovery reasons are the same set in `@kimo/sync` and `@kimo/platform`. */
export type RecoveryReasonsMatch = Assert<Same<SyncRecoveryReason, PlatformRecoveryReason>>
export type RecoveryReason = SyncRecoveryReason

// ===============================================================================================
// Save status (02d "SaveStatus · 7 states"; topbar pill, one state at a time)
// ===============================================================================================

/** "Saving…" is shown only if a write takes longer than this (02d rule). */
export const SAVING_INDICATOR_DELAY_MS = 400

/** Why a document is read-only (SaveStatus/ReadOnly). Edits are blocked, never discarded. */
export type ReadOnlyCause =
  /** `format` newer than this app, or a feature it does not know (spec §16.3). */
  | "newer-format"
  /** Load failed (unreadable / unparsable / invalid): terminal for the window (teardown 9.4). */
  | "failed-load"
  /** The user chose "Open read-only" (lock, migration consent, newer format). */
  | "user-choice"

export type SaveStatus =
  /** Written atomically and read back. Hover: "Saved 10:42:18 · ~/Projects/loom/marketing.kimo". */
  | { kind: "saved"; savedAt: number; ref: FileRef }
  /** A write is in flight since `since`; displayed only after {@link SAVING_INDICATOR_DELAY_MS}. */
  | { kind: "saving"; since: number }
  /**
   * Edits newer than the last write. `autosaveAt` is when the idle timer fires (null when
   * autosave is off). `target: "recovery"` while upgrade consent is pending (spec §16.2), and
   * for an untitled document (`untitled`, board 20 Zvw7e: the pill reads "Not saved").
   */
  | {
      kind: "unsaved"
      dirtySince: number
      autosaveAt: number | null
      target: "file" | "recovery"
      untitled?: boolean
    }
  /** Autosave paused by a git operation (null = only `index.lock` seen) or by open conflicts. */
  | { kind: "paused"; reason: "git"; operation: GitOperation | null }
  | { kind: "paused"; reason: "conflicts"; open: number }
  | { kind: "read-only"; cause: ReadOnlyCause }
  /** Another process holds the per-file lease; clicking the pill opens the lease details. */
  | { kind: "locked"; holder: LeaseHolder }
  /** The write or the read-back failed; paired with a `save-failed` banner. */
  | { kind: "failed"; failure: SaveFailure }

/** The `desing.pen` component (and node id) rendering each status. */
export const SAVE_STATUS_COMPONENT = {
  saved: { component: "SaveStatus", node: "EdNXU" },
  saving: { component: "SaveStatus/Saving", node: "hbDxo" },
  unsaved: { component: "SaveStatus/Unsaved", node: "O8d1r" },
  paused: { component: "SaveStatus/Paused", node: "LvZiH" },
  "read-only": { component: "SaveStatus/ReadOnly", node: "ChFsm" },
  locked: { component: "SaveStatus/Locked", node: "Nn6l8" },
  failed: { component: "SaveStatus/Failed", node: "qPGUY" },
} as const satisfies Record<SaveStatus["kind"], { component: string; node: string }>

/** The pill label, exactly as designed (boards 02d, 16, 17, 18). */
export function saveStatusLabel(s: SaveStatus): string {
  switch (s.kind) {
    case "saved":
      return "Saved to disk"
    case "saving":
      return "Saving…"
    case "unsaved":
      return s.untitled ? "Not saved" : "Unsaved changes"
    case "paused":
      return s.reason === "git"
        ? `Autosave paused · ${s.operation ?? "git"}`
        : `${s.open} conflict${s.open === 1 ? "" : "s"} · autosave paused`
    case "read-only":
      return s.cause === "failed-load" ? "Read-only · couldn't load" : "Read-only"
    case "locked":
      return "Locked by another app"
    case "failed":
      return "Save failed"
  }
}

/**
 * What the pill shows at `now`: a `saving` status younger than 400 ms keeps showing the
 * previously displayed status, so normal autosave never flickers.
 */
export function displayedSaveStatus(
  actual: SaveStatus,
  previouslyShown: SaveStatus | null,
  now: number,
): SaveStatus {
  if (actual.kind === "saving" && now - actual.since < SAVING_INDICATOR_DELAY_MS && previouslyShown)
    return previouslyShown
  return actual
}

/** Tooltip of the saved pill (board 16 footer: "Saved 10:42:18 · ~/Projects/loom/marketing.kimo"). */
export function savedTooltip(savedAtLabel: string, displayPath: string): string {
  return `Saved ${savedAtLabel} · ${displayPath}`
}

// ===============================================================================================
// Untitled documents and the window title (board 20 "Feedback" V7ey1Q, "Desktop chrome" KcXQz)
// ===============================================================================================

/** The name of a never-saved document (breadcrumb ITncY "Untitled"). */
export const UNTITLED_NAME = "Untitled"
const UNTITLED_PREFIX = "untitled:"

/** The session ref of an untitled document (`untitled:<docId>`; never a path). */
export const untitledRef = (docId: string): FileRef => `${UNTITLED_PREFIX}${docId}`
export const isUntitledRef = (ref: FileRef): boolean => ref.startsWith(UNTITLED_PREFIX)
/** Its recovery entry id (`untitled-<docId>`, ADR 0012 §3 "Recovery store"). */
export const untitledRecoveryId = (ref: FileRef): string =>
  `untitled-${ref.slice(UNTITLED_PREFIX.length)}`

export interface WindowTitleInput {
  os: HostOS
  /** null on Home: the title is "Kimo". */
  fileName: string | null
  /** The repository (or working) folder's name: "loom". */
  folder: string | null
  untitled?: boolean
  /** The in-memory document is ahead of disk (SaveStatus Unsaved / Saving / Failed). */
  edited?: boolean
  readOnly?: boolean
}

/**
 * Board 20 "Window title rule" (G1gEPp): `<file> — <folder>`; untitled "Untitled • not saved";
 * read-only adds " (read-only)"; Home is "Kimo". macOS shows edits with the close-button dot
 * (`setDocumentEdited`); Windows / Linux prefix "● " and add the suffix " - Kimo" (the title is
 * the taskbar label there). The web tab follows macOS (not designed).
 */
export function windowTitle(t: WindowTitleInput): string {
  if (t.fileName === null) return "Kimo"
  let base = t.untitled
    ? `${UNTITLED_NAME} • not saved`
    : t.folder
      ? `${t.fileName} — ${t.folder}`
      : t.fileName
  if (t.readOnly && !t.untitled) base += " (read-only)"
  if (t.os === "windows" || t.os === "linux") return `${t.edited ? "● " : ""}${base} - Kimo`
  return base
}

/** "Edited" for the window title / close-button dot: not yet on disk (G1gEPp row fPwI0). */
export function isEdited(s: SaveStatus): boolean {
  return s.kind === "unsaved" || s.kind === "saving" || s.kind === "failed"
}

// ===============================================================================================
// Banners (full width under the topbar, never floating; one at a time, highest severity wins)
// ===============================================================================================

export type BannerSeverity = "info" | "warning" | "danger"

/** Banner component per severity (02d). */
export const BANNER_COMPONENT = {
  info: { component: "Banner", node: "R6VHG" },
  warning: { component: "Banner/Warning", node: "KPgcF" },
  danger: { component: "Banner/Danger", node: "Gq3Fs" },
} as const satisfies Record<BannerSeverity, { component: string; node: string }>

/** Detail of a terminal load failure (board 17 "Failed load"). */
export interface FailedLoadDetail {
  /** "This file can't be parsed", "This file isn't valid", "Couldn't read this file". */
  headline: string
  /** E.g. the git-conflict-marker explanation. */
  explanation: string
  /** "SyntaxError · line 214, column 1". */
  error: string | null
  /** Numbered source lines around the error: `{ line: 214, text: "<<<<<<< HEAD" }`. */
  excerpt: { line: number; text: string }[]
  /** The file contains `<<<<<<<` / `>>>>>>>` markers (a merge without the kimo driver). */
  gitConflictMarkers: boolean
}

export type Banner =
  /** Board 17 "Newer format → read-only" (info). */
  | {
      kind: "newer-format"
      severity: "info"
      fileName: string
      /** The file's `format`, e.g. "0.6". */
      fileFormat: string
      /** Unknown features, e.g. ["variable-fonts"]. */
      features: string[]
      /** Newest format this app reads, e.g. "0.4". */
      readerFormat: string
    }
  /** Board 17 "Locked by another process" (warning). */
  | { kind: "locked"; severity: "warning"; fileName: string; holder: LeaseHolder }
  /** Board 17 "Git operation in progress" (warning). */
  | {
      kind: "git-operation"
      severity: "warning"
      operation: GitOperation | null
      unsavedEdits: number
    }
  /** Board 17 "Save failed" (danger): disk full / permission / read-back mismatch. */
  | { kind: "save-failed"; severity: "danger"; fileName: string; failure: SaveFailure }
  /** Board 17 "Failed load · terminal" (danger). */
  | {
      kind: "failed-load"
      severity: "danger"
      fileName: string
      ref: FileRef
      detail: FailedLoadDetail
    }
  /** Board 18 "kimo merge left N conflicts" (warning). */
  | {
      kind: "merge-conflicts"
      severity: "warning"
      info: MergeInfo | null
      open: number
      resolved: number
      total: number
    }
  /** Board 18 "Ready to commit" (info), after Mark resolved & save while git still merges. */
  | { kind: "merge-ready"; severity: "info"; fileName: string }

export type BannerKind = Banner["kind"]

/**
 * Order when several apply: the first present wins. Board 20 "Banner priority" (vgNUe, list
 * oV0OM): 1 save failed / disk errors · 2 stored merge conflicts (`kimo merge`; they replace the
 * generic git merge banner) · 3 git operation in progress · 4 changed on disk / read-only /
 * locked · 5 informational. A failed load is terminal for the window and stays first.
 */
export const BANNER_PRIORITY: readonly BannerKind[] = [
  "failed-load",
  "save-failed",
  "merge-conflicts",
  "git-operation",
  "locked",
  "newer-format",
  "merge-ready",
]

/** Picks the banner to show. */
export function pickBanner(candidates: readonly Banner[]): Banner | null {
  for (const kind of BANNER_PRIORITY) {
    const b = candidates.find((c) => c.kind === kind)
    if (b) return b
  }
  return null
}

export type BannerActionId =
  | "whats-new"
  | "update-kimo"
  | "open-read-only"
  | "retry-lease"
  | "git-discard"
  | "git-stash"
  | "git-keep"
  | "save-as"
  | "retry-save"
  | "show-diff"
  | "reveal"
  | "open-as-text"
  | "previous-conflict"
  | "next-conflict"
  | "copy-commit-command"

export interface BannerAction {
  id: BannerActionId
  label: string
  /** Button component: Ghost / Secondary / Primary as on the board (rightmost = primary). */
  variant: "ghost" | "secondary" | "primary"
}

export interface BannerCopy {
  title: string
  body: string
  actions: BannerAction[]
}

/** "Reveal in Finder" per OS (board 17 shows the macOS label). */
export function revealLabel(os: HostOS): string {
  return os === "windows"
    ? "Show in Explorer"
    : os === "linux"
      ? "Show in folder"
      : "Reveal in Finder"
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const OPERATION_TITLE: Record<GitOperation, string> = {
  rebase: "Rebase",
  merge: "Merge",
  "cherry-pick": "Cherry-pick",
  checkout: "Checkout",
}

/**
 * Title, body and actions of a banner, from the designs. `formatBytes` / `formatTime` /
 * `displayDir` are injected so the copy stays locale-aware and paths are shortened (`~/…`).
 */
export function bannerCopy(
  b: Banner,
  fmt: {
    os: HostOS
    formatBytes(n: number): string
    formatTime(ms: number): string
    displayDir(ref: FileRef): string
  },
): BannerCopy {
  switch (b.kind) {
    case "newer-format": {
      const feat =
        b.features.length === 0
          ? ""
          : ` with the feature${b.features.length === 1 ? "" : "s"} ${b.features.map((f) => `"${f}"`).join(", ")}`
      return {
        title: "Read-only — made with a newer Kimo",
        body: `${b.fileName} uses format ${b.fileFormat}${feat}; this app reads up to ${b.readerFormat}. Nothing will be overwritten.`,
        actions: [
          { id: "whats-new", label: "What's new", variant: "ghost" },
          { id: "update-kimo", label: "Update Kimo", variant: "primary" },
        ],
      }
    }
    case "locked": {
      const app = b.holder.appLabel.replace(/\s*\(.*\)$/, "")
      return {
        title: "Locked by another process",
        body: `${app} (pid ${b.holder.pid}) has had ${b.fileName} open for writing since ${fmt.formatTime(Date.parse(b.holder.sinceIso))}.`,
        actions: [
          { id: "open-read-only", label: "Open read-only", variant: "secondary" },
          { id: "retry-lease", label: "Retry", variant: "primary" },
        ],
      }
    }
    case "git-operation":
      return {
        title: `${b.operation ? OPERATION_TITLE[b.operation] : "Git operation"} in progress — autosave paused`,
        body: `Your ${plural(b.unsavedEdits, "unsaved edit")} ${b.unsavedEdits === 1 ? "is" : "are"} kept in memory.`,
        actions: [
          { id: "git-discard", label: "Discard", variant: "ghost" },
          { id: "git-stash", label: "Stash as recovery file", variant: "secondary" },
          { id: "git-keep", label: "Keep my edits", variant: "primary" },
        ],
      }
    case "save-failed": {
      const f = b.failure
      if (f.code === "PERMISSION")
        return {
          title: "Couldn't save — permission denied",
          body: `${fmt.displayDir(f.path)} is read-only for your user (${f.errno ?? "EACCES"}). Save a copy somewhere else.`,
          actions: [{ id: "save-as", label: "Save as…", variant: "primary" }],
        }
      if (f.code === "READ_BACK_MISMATCH")
        return {
          title: "Saved, but the read-back didn't match",
          body: "The file on disk differs from what Kimo wrote (antivirus or sync client?). Your version is in a recovery file.",
          actions: [
            { id: "show-diff", label: "Show diff", variant: "secondary" },
            { id: "save-as", label: "Save as…", variant: "primary" },
          ],
        }
      const free =
        f.freeBytes !== undefined
          ? `, ${fmt.formatBytes(f.freeBytes)} free${f.volume ? ` on ${f.volume}` : ""}`
          : ""
      return {
        title: `Couldn't save ${b.fileName}`,
        body:
          f.code === "DISK_FULL"
            ? `The disk is full (${f.errno ?? "ENOSPC"}${free}). Your edits are safe in a recovery file; retrying every 30 s.`
            : // IO: not drawn on board 17; same layout as disk full (flagged in ADR 0012).
              `${f.message}. Your edits are safe in a recovery file; retrying every 30 s.`,
        actions: [
          { id: "save-as", label: "Save as…", variant: "secondary" },
          { id: "retry-save", label: "Retry", variant: "primary" },
        ],
      }
    }
    case "failed-load":
      return {
        title: `Couldn't open ${b.fileName}`,
        body: "The file is untouched. Kimo won't write to it from this window.",
        actions: [
          { id: "reveal", label: revealLabel(fmt.os), variant: "secondary" },
          { id: "open-as-text", label: "Open as text", variant: "secondary" },
        ],
      }
    case "merge-conflicts": {
      const into =
        b.info?.theirs && b.info.ours ? `Merging ${b.info.theirs} into ${b.info.ours}: ` : ""
      const applied =
        b.info?.changes !== undefined ? `${plural(b.info.changes, "change")} applied, ` : ""
      return {
        title: `kimo merge left ${plural(b.open, "conflict")}`,
        body: `${into}${applied}${b.resolved} of ${b.total} conflicts resolved. Pick a side for the rest, then save.`,
        actions: [
          { id: "previous-conflict", label: "Previous", variant: "ghost" },
          { id: "next-conflict", label: "Next conflict", variant: "primary" },
        ],
      }
    }
    case "merge-ready":
      return {
        title: "Ready to commit",
        body: `git still shows the merge as in progress. Stage ${b.fileName} and commit to finish it.`,
        actions: [{ id: "copy-commit-command", label: "Copy command", variant: "secondary" }],
      }
  }
}

/** Failed-load explanation when git conflict markers are found (board 17). */
export const GIT_MARKERS_EXPLANATION =
  "It still contains git conflict markers from a merge that didn't use the kimo driver. Resolve them in a text editor, or run kimo merge again."

// ===============================================================================================
// Toasts (bottom-center, board 15 placement)
// ===============================================================================================

export type Toast =
  /** Toast: "marketing.kimo changed on disk — reloaded" · Undo. */
  | { kind: "external-reloaded"; fileName: string; undo: ReloadUndoToken }
  /** Toast: "Merged 4 changes from disk with your 6 edits" · Undo. */
  | { kind: "external-merged"; changes: number; localEdits: number; undo: ReloadUndoToken }
  /** Toast/Warning: "Changed on disk while you were editing — 2 conflicts" · Review (→ board 18). */
  | { kind: "external-conflicts"; conflicts: number }
  /** Toast: "Resolved 5 conflicts — saved marketing.kimo" · Undo. */
  | { kind: "merge-saved"; resolved: number; fileName: string }
  /** Toast: "Kimo 0.5 is ready" · Restart (one per session). */
  | { kind: "update-ready"; info: UpdateInfo }
  /** Toast: "Restart after saving 2 files?" · Save & restart (a file could not save). */
  | { kind: "update-save-first"; unsavedFiles: number }

export function toastCopy(t: Toast): { text: string; action: string; component: string } {
  switch (t.kind) {
    case "external-reloaded":
      return {
        text: `${t.fileName} changed on disk — reloaded`,
        action: "Undo",
        component: "Toast",
      }
    case "external-merged":
      return {
        text: `Merged ${plural(t.changes, "change")} from disk with your ${plural(t.localEdits, "edit")}`,
        action: "Undo",
        component: "Toast",
      }
    case "external-conflicts":
      return {
        text: `Changed on disk while you were editing — ${plural(t.conflicts, "conflict")}`,
        action: "Review",
        component: "Toast/Warning",
      }
    case "merge-saved":
      return {
        text: `Resolved ${plural(t.resolved, "conflict")} — saved ${t.fileName}`,
        action: "Undo",
        component: "Toast",
      }
    case "update-ready":
      return { text: `Kimo ${t.info.version} is ready`, action: "Restart", component: "Toast" }
    case "update-save-first":
      return {
        text: `Restart after saving ${plural(t.unsavedFiles, "file")}?`,
        action: "Save & restart",
        component: "Toast",
      }
  }
}

/** Maps a reconcile outcome to its toast (none for unchanged / unreadable / removed). */
export function toastForExternalChange(
  outcome: ExternalChangeOutcome,
  fileName: string,
  undo: ReloadUndoToken | null,
): Toast | null {
  switch (outcome.kind) {
    case "reloaded":
      return undo ? { kind: "external-reloaded", fileName, undo } : null
    case "merged":
      return undo
        ? {
            kind: "external-merged",
            changes: outcome.changes,
            localEdits: outcome.localEdits,
            undo,
          }
        : null
    case "conflicts":
      return { kind: "external-conflicts", conflicts: outcome.conflicts }
    default:
      return null
  }
}

// ===============================================================================================
// Dialogs: launch recovery, migration consent, git choice
// ===============================================================================================

/** Board 17 "Launch recovery · after a crash" (Dialog, RecoveryItem rows). */
export interface RecoveryCandidate {
  entry: RecoveryEntry
  /** Badge: "14 edits" / "3 edits" / "never saved". */
  badge: string
  /** Second line: "~/Projects/loom/marketing.kimo" or "not on disk yet". */
  location: string
  /** Third line: "Last autosave 10:42 · quit unexpectedly 10:43", "Last autosave 10:41 · file
   * unchanged on disk since", "Created 10:12 · 22 layers". */
  detail: string
  /** Untitled offers Discard + Save as… only. */
  choices: RecoveryChoice[]
}

export type RecoveryChoice = "restore" | "save-as" | "discard"

/**
 * Footer of the launch dialog: "Kept for 30 days" · Discard all / Decide later / Restore all.
 * Esc = "Decide later" (non-destructive); entries stay until restored-and-saved or discarded.
 */
export type RecoveryDialogChoice = "discard-all" | "decide-later" | "restore-all"

/** Board 17 "Migration consent · older format". Esc = "Open read-only". ⌘S also counts as consent. */
export interface MigrationConsentRequest {
  fileName: string
  /** "0.2" */
  fromFormat: string
  /** "0.4" */
  toFormat: string
  /** "about 38 lines in git" */
  approxChangedLines: number
  /** Oldest Kimo that still opens the upgraded file ("Kimo older than 0.4 will no longer open it"). */
  minimumReader: string
}

export type MigrationConsentChoice = "upgrade" | "read-only"

/**
 * Board 17 git banner choices:
 * - keep: wait for git to finish, then three-way merge the edits onto the new HEAD version
 *   (the external-change path);
 * - discard: drop the in-memory edits and reload what git leaves on disk (undoable until the
 *   next edit);
 * - stash: write the edits to `~/.kimo/recovery/<hash>.kimo`, reload from disk (listed in the
 *   launch recovery dialog);
 * - later: "Do nothing": the banner stays, autosave stays paused, ⌘S asks which of the three.
 */
export type GitChoice = "keep" | "discard" | "stash" | "later"

// ===============================================================================================
// Merge conflicts (board 18)
// ===============================================================================================

/** One side as shown by ConflictChoice (02d). */
export interface ConflictSideView {
  side: ConflictSide
  /** "ours · main", "theirs · pricing-v2" (the label is shortened to the last path segment). */
  caption: string
  /** Rendered value: "#E8590C", "Plan less. Ship more together.", "12", "Hero › CTA Row",
   * "Edited · 2 props", "Deleted". */
  display: string
  /** A color swatch to draw next to the value (colors only). */
  swatch: string | null
  /** The side is absent (deleted / unset). */
  absent: boolean
}

/** A ConflictRow (02d) and its group header in the Conflicts tab. */
export interface ConflictRowView {
  id: string
  kind: ConflictKind
  /** Node that owns the conflict (selection + ConflictMarker + 1.5px $danger outline); null for
   * variable and header conflicts. */
  nodeId: string | null
  /** Group header: the node's layer name or path ("Hero", "Footer › Legal", "Button / Primary"),
   * "Variables" for variable conflicts, "Document" for header conflicts (board 20). */
  group: string
  /** Property label: "fill", "content", "gap", "label", "node", "parent", "$brand · light". */
  property: string
  /** "both changed" | "deleted vs edited" | "moved twice". */
  kindLabel: "both changed" | "deleted vs edited" | "moved twice"
  ours: ConflictSideView
  theirs: ConflictSideView
  base: ConflictSideView
  applied: AppliedState
  resolved: boolean
  /** ConflictRow/Resolved label: "kept ours · 12", "took theirs", "took theirs · deleted". */
  resolvedLabel: string | null
}

/**
 * The Conflicts tab ("Conflicts 2") and canvas markers. Rows are ordered Document (header
 * conflicts), Variables, then nodes in layer order (board 20). Every pick is an undoable edit applied live on
 * canvas through `editor-state` ops with the same semantics as core-schema
 * `applyConflictSide`. Autosave stays paused while any conflict is open; ⌘S with open
 * conflicts saves them as-is (the file stays loadable) and keeps the banner.
 */
export interface ConflictSession {
  readonly info: MergeInfo | null
  counts(): { total: number; open: number; resolved: number }
  rows(): ConflictRowView[]
  /** Picks a side for one conflict (ConflictChoice click). */
  choose(id: string, side: ConflictSide): void
  /** "Take all ours" / "Take all theirs": unresolved rows only. */
  chooseAll(side: "ours" | "theirs"): void
  /**
   * Board 20 ResolvedRow/Expanded "Reopen": marks a resolved conflict open again (the body keeps
   * the applied side). One undoable edit.
   */
  reopen(id: string): void
  /** Id of the next / previous open conflict after `fromId` (wraps), or null when none. */
  next(fromId?: string): string | null
  previous(fromId?: string): string | null
  /** "Next conflict (⌘')": selects the node, scrolls the canvas to it, focuses its row. */
  focus(id: string): void
  /**
   * "Mark resolved & save": rejects while conflicts are open; otherwise removes `conflicts`,
   * `merge` and the feature (core-schema `finishMerge`), saves, shows the `merge-saved`
   * toast, and the `merge-ready` banner when git still has MERGE_HEAD. The tab disappears.
   */
  markResolvedAndSave(): Promise<void>
  subscribe(listener: () => void): Unsubscribe
}

/** ⌘' — board 18 "Next conflict". */
export const NEXT_CONFLICT_SHORTCUT = "Mod+'"

// ===============================================================================================
// The document session
// ===============================================================================================

export type SessionPhase =
  | "opening"
  /** Older format: waiting for {@link MigrationConsentRequest}; autosave goes to recovery. */
  | "needs-consent"
  | "ready"
  /** Read-only for a {@link ReadOnlyCause} (or locked). */
  | "read-only"
  /** Terminal: no save, no autosave, no recovery writes for the life of the window. */
  | "failed-load"
  | "closed"

export interface SessionState {
  ref: FileRef
  fileName: string
  phase: SessionPhase
  saveStatus: SaveStatus
  /** The single banner shown (see {@link pickBanner}). */
  banner: Banner | null
  toasts: Toast[]
  consent: MigrationConsentRequest | null
  /** Branch shown in the topbar (`main`, `main ← feat/pricing-v2` during a kimo merge). */
  branchLabel: string | null
  git: GitState | null
  /** Open/total conflicts, or null when the file has none (no Conflicts tab). */
  conflicts: { open: number; total: number } | null
  /** Edits newer than the last write (git banner "Your 6 unsaved edits"). */
  unsavedEdits: number
}

/**
 * One open `.kimo` file in one window. Lifecycle (ADR 0012 §4):
 * 1. `leases.acquire` → held elsewhere: phase `read-only`, status `locked`, banner `locked`
 *    (Open read-only / Retry; a dead pid is reclaimed on Retry).
 * 2. read + core-schema `openDocument`: unparsable/invalid → `failed-load` (terminal);
 *    newer/unknown feature → `read-only` + `newer-format`; older → `needs-consent`.
 * 3. stored conflicts → {@link ConflictSession}, status paused(conflicts), banner
 *    `merge-conflicts`.
 * 4. `git.state`: an operation in progress → paused(git) + `git-operation` banner.
 * 5. watch the file, `assets/`, scripts, shaders (`files.watch`) and the repo (`git.watch`);
 *    autosave every `files.autosaveIntervalMs` of idle; recovery snapshot every
 *    `files.recoverySnapshotMs` while dirty (even with autosave off); flush on blur and close.
 */
export interface DocumentSession {
  readonly ref: FileRef
  readonly store: DocStore
  readonly provider: FileSessionProvider | null
  state(): SessionState
  subscribe(listener: (state: SessionState) => void): Unsubscribe
  /** ⌘S. Counts as upgrade consent; with open conflicts saves them as-is; while git-paused asks
   * for a {@link GitChoice} first. */
  save(): Promise<void>
  /** "Save as…": new path, new lease; the session moves to it. */
  saveAs(): Promise<FileRef | null>
  /** Writes pending edits now, ignoring nothing (update restart, quit, window close). */
  flush(): Promise<void>
  respondToConsent(choice: MigrationConsentChoice): Promise<void>
  respondToGit(choice: GitChoice): Promise<void>
  /** Banner and toast actions. */
  runAction(id: BannerActionId): Promise<void>
  undoExternal(token: ReloadUndoToken): Promise<void>
  dismissToast(index: number): void
  /** Present while the file has stored conflicts. */
  readonly conflicts: ConflictSession | null
  /** Flushes, releases the lease, stops watchers. Resolves false when a save failed and the
   * user kept the window open. */
  close(): Promise<boolean>
}

export interface OpenOptions {
  /** Open without taking the lease ("Open read-only"). */
  readOnly?: boolean
  source?: OpenRequest["source"] | "home" | "open-dialog" | "recovery"
  /** Node to select after opening (deep link `node`). */
  node?: string
}

/** Owns every session of the app (one per window on desktop, one per tab on the web). */
export interface SessionManager {
  readonly platform: KimoPlatform
  /** Opens a file, or focuses the window/session that already has it (one writer per file). */
  open(ref: FileRef, options?: OpenOptions): Promise<DocumentSession>
  sessions(): DocumentSession[]
  /** Board 17 launch dialog: entries whose owner process is gone, newest first. */
  recoveryCandidates(): Promise<RecoveryCandidate[]>
  resolveRecovery(id: string, choice: RecoveryChoice): Promise<DocumentSession | null>
  resolveRecoveryDialog(choice: RecoveryDialogChoice): Promise<void>
  /**
   * Before an update restart or quit: flushes every session and waits for "Saved to disk".
   * `failed` lists files that could not be saved (→ `update-save-first` toast, no restart).
   */
  flushAll(): Promise<{ ok: boolean; failed: FileRef[] }>
  /** Handles file association / deep link / argv requests. */
  handleOpenRequest(request: OpenRequest): Promise<void>
}

/** The semantic three-way merge used for external changes and git "Keep my edits"
 * (core-schema; `kimo merge` uses the same function). */
export type SessionMerge = ThreeWayMerge

// ===============================================================================================
// M5 agents (ADR 0013 §11): presence, approvals and the activity log as the editor shows them.
// The document host produces this state from `@kimo/mcp-server`; windows read it through
// `@kimo/platform`'s `McpHostApi`. Visuals come from the M5 boards in `desing.pen` (agent teal
// for anything an agent does; generic host icons, never vendor logos).
// ===============================================================================================

/** The platform mirrors stay identical to the MCP server's types. */
export type McpPolicyMatches = Assert<Same<McpClientPolicy, ClientPolicy>>
export type McpIdentityMatches = Assert<Same<McpClientIdentity, ClientIdentity>>
export type McpApprovalMatches = Assert<Same<McpApprovalRequest, ApprovalRequest>>
export type McpActivityMatches = Assert<Same<McpActivityEntry, ActivityEntry>>
export type McpOutcomeMatches = Assert<Same<McpApprovalOutcome, ApprovalOutcome>>
export type McpHostRowMatches = Assert<Same<McpHostConfigStatus, InstallerHostStatus>>

/** Approval timeout shown as a countdown on the prompt (lead decision: 2 minutes → deny). */
export const AGENT_APPROVAL_TIMEOUT_MS = APPROVAL_TIMEOUT_MS
/** Activity entries kept per file (lead decision). */
export const AGENT_ACTIVITY_LIMIT = ACTIVITY_LIMIT

/** One agent chip in the topbar / Agents panel. */
export interface AgentChip {
  connectionId: string
  origin: string
  /** "Claude Code", "Codex", … */
  label: string
  /** Generic icon by host kind. */
  icon: "terminal" | "editor" | "agent"
  state: McpConnectionInfo["state"]
  /** Nodes to tint with the agent color on the canvas (its last edit / current focus). */
  focus: string[]
  /** Relative "2 min ago" is formatted by the UI from this. */
  lastActivityAt: number
}

/** The approval prompt (one at a time, oldest first; others queue with a count). */
export interface ApprovalPromptView {
  request: McpApprovalRequest
  /** Queue size including this one. */
  queued: number
  /** Buttons in order. "Allow for this session" is absent for file and scope reasons. */
  choices: McpApprovalChoice[]
  /** ms left before it auto-denies. */
  remainingMs: number
}

/** Builds the buttons for a request (lead decision: session allowance never covers files). */
export function approvalChoices(r: McpApprovalRequest): McpApprovalChoice[] {
  return r.reason.kind === "file" || r.reason.kind === "scope"
    ? ["deny", "once"]
    : ["deny", "session", "once"]
}

/** Agents state for one window. */
export interface AgentsState {
  server: McpServerStatus | null
  chips: AgentChip[]
  prompt: ApprovalPromptView | null
  /** Activity of the window's document, newest last (≤ AGENT_ACTIVITY_LIMIT). */
  activity: McpActivityEntry[]
  /** Settings › Agents host rows. */
  hosts: McpHostConfigStatus[]
}

/** What the Agents UI calls. Implemented over `McpHostApi` + the window's `DocumentSession`. */
export interface AgentsController {
  readonly state: AgentsState
  subscribe(listener: (s: AgentsState) => void): Unsubscribe
  answer(id: string, choice: McpApprovalChoice): Promise<void>
  disconnect(connectionId: string): Promise<void>
  /** Undo an agent's op group from the activity log (uses the entry's undoToken; guarded). */
  undoEntry(entry: McpActivityEntry): Promise<{ ok: boolean; stale: boolean }>
  focusEntry(entry: McpActivityEntry): void
  setPolicy(client: string, policy: McpClientPolicy | null): Promise<void>
  installHost(host: McpHostId, scope: "user" | "project"): Promise<McpHostConfigStatus>
  removeHost(host: McpHostId, scope: "user" | "project"): Promise<McpHostConfigStatus>
}

/** Host API the controller needs (re-exported for builders). */
export type AgentsHost = McpHostApi
