/**
 * M4 file UI (boards 16, 17): mountable hosts over the session layer
 * (`../platform/session.ts`). See INTEGRATION.md for where each one mounts.
 */
import "./files.css"

export { BannerHost } from "./BannerHost"
export {
  addWatchedFolder,
  LocalFolders,
  RecentFilesGrid,
  RecentFilesHeader,
  RecentFilesList,
  type RecentView,
} from "./DesktopHome"
export { FailedLoadView } from "./FailedLoadView"
export { TrafficLightInset } from "./FileTopbar"
export { useNow, useWebTabTitle, useWindowChrome } from "./hooks"
export { MigrationDialog } from "./MigrationDialog"
export { RecoveryDialog, RestoredToasts } from "./RecoveryDialog"
export { ToastHost } from "./ToastHost"
