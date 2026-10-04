/** Board 19 Settings: window/dialog, panes bound to platform.settings, route. See INTEGRATION.md. */
export { bindAppearance, resolveAppearance, type ThemeSetter } from "./appearance"
export { diagnosticsFor, HelpHost } from "./HelpHost"
export {
  aboutLinks,
  DOCS_URL,
  diagnosticsBlock,
  type HelpAction,
  type HelpItem,
  helpItems,
  logsLabel,
  onHelpAction,
  releaseNotesUrl,
  reportIssueUrl,
  runHelpAction,
} from "./help"
export { useSetSetting, useSettings, useUpdaterStatus } from "./hooks"
export {
  autosaveDescription,
  CHOICES,
  type ChoiceKey,
  DEFAULT_PANE,
  displayPath,
  extraFoldersDescription,
  fontCacheLabel,
  formatSize,
  isSettingsPane,
  mergeDriverDescription,
  type PaneInfo,
  parseChoice,
  parseSettingsHash,
  SELECT_WIDTH,
  SETTINGS_PANES,
  selectOptions,
  settingsHash,
  updaterDescription,
} from "./model"
export { type Notice, noticeCount } from "./notices"
export {
  openSettings,
  SettingsDialog,
  type SettingsDialogProps,
  SettingsRoute,
  useSettingsShortcut,
} from "./SettingsDialog"
export { SettingsView, type SettingsViewProps } from "./SettingsView"
export {
  archLabel,
  releaseLine,
  type VersionInfo,
  versionInfo,
  versionLine,
  versionString,
  webOsLabel,
} from "./version-info"
