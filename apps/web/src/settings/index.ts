/** Board 19 Settings: window/dialog, panes bound to platform.settings, route. See INTEGRATION.md. */
export { bindAppearance, resolveAppearance, type ThemeSetter } from "./appearance"
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
export {
  openSettings,
  SettingsDialog,
  type SettingsDialogProps,
  SettingsRoute,
  useSettingsShortcut,
} from "./SettingsDialog"
export { SettingsView, type SettingsViewProps } from "./SettingsView"
