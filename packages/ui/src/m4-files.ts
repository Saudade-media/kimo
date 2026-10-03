/** M4 components (m4-files), owned by one builder; re-exported from index.ts. */
export { Banner, type BannerActionItem, type BannerProps, type BannerTone } from "./banner/Banner"
export { Dialog, type DialogProps, DialogScrim } from "./dialog/Dialog"
export {
  FileRow,
  type FileRowGitTone,
  FileRowHeader,
  type FileRowHeaderProps,
  type FileRowProps,
} from "./file-row/FileRow"
export { middleTruncate, useMiddleTruncate } from "./file-row/middle-truncate"
export { RecoveryItem, type RecoveryItemProps } from "./recovery-item/RecoveryItem"
export {
  SAVE_STATUS_LABEL,
  SaveStatus,
  type SaveStatusKind,
  type SaveStatusProps,
} from "./save-status/SaveStatus"
export {
  BranchChip,
  type BranchChipProps,
  DesktopBreadcrumb,
  type DesktopBreadcrumbProps,
  DesktopTopbar,
  type DesktopTopbarProps,
  TrafficLights,
  type TrafficLightsProps,
} from "./window-chrome/WindowChrome"
