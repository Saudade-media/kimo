/**
 * M4 file UI (boards 16, 17): mountable hosts over the session layer
 * (`../platform/session.ts`). See INTEGRATION.md for where each one mounts.
 */
import "./files.css"

export { BannerHost, SessionBannerView } from "./BannerHost"
export {
  addWatchedFolder,
  folderLabel,
  gitColumn,
  gridInfo,
  LocalFolders,
  RecentFilesGrid,
  RecentFilesHeader,
  RecentFilesList,
  type RecentView,
} from "./DesktopHome"
export { FailedLoadCard, FailedLoadView } from "./FailedLoadView"
export {
  FileBranchChip,
  FileBreadcrumb,
  FileTopbar,
  TrafficLightInset,
} from "./FileTopbar"
export {
  useNow,
  useRecents,
  useSessionState,
  useSessions,
  useWindowChrome,
  type WindowChromeState,
} from "./hooks"
export { LockDetailsPopover, sinceLabel } from "./LockDetailsPopover"
export { MigrationDialog, MigrationDialogView } from "./MigrationDialog"
export { RecoveryDialog, RecoveryDialogView } from "./RecoveryDialog"
export { SaveStatusPill, statusTooltip } from "./SaveStatusPill"
export { SessionToastView, ToastHost } from "./ToastHost"
