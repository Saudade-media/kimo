/**
 * @kimo/ui: editor-chrome components built 1:1 from desing.pen (02 Components).
 *
 * Styling uses only `--kimo-*` custom properties. Load, once per app:
 *   import "@kimo/design-tokens/editor.css"
 *   import "@kimo/ui/styles.css"
 */
export {
  AgentStep,
  type AgentStepProps,
  Composer,
  type ComposerProps,
  Message,
  type MessageProps,
} from "./agent/Agent"
export { Avatar, type AvatarProps, initialsOf } from "./avatar/Avatar"
export { Badge, type BadgeProps } from "./badge/Badge"
export { Button, type ButtonProps, type ButtonVariant } from "./button/Button"
export { ColorField, type ColorFieldProps } from "./color-field/ColorField"
export { EmptyState, type EmptyStateProps } from "./empty-state/EmptyState"
export { FileCard, FileCardMiniFrame, type FileCardProps } from "./file-card/FileCard"
export { Gallery, type GalleryProps } from "./gallery/Gallery"
export { IconButton, type IconButtonProps } from "./icon-button/IconButton"
export { Input, type InputProps } from "./input/Input"
export { Kbd, type KbdProps } from "./kbd/Kbd"
export {
  LAYER_ROW_INDENT,
  LAYER_ROW_PADDING,
  LayerRow,
  type LayerRowProps,
} from "./layer-row/LayerRow"
export { Menu, MenuItem, type MenuItemProps, type MenuProps } from "./menu/Menu"
export {
  PanelHeader,
  type PanelHeaderAction,
  type PanelHeaderProps,
} from "./panel-header/PanelHeader"
export { PropField, type PropFieldProps } from "./prop-field/PropField"
export {
  PropRow,
  type PropRowProps,
  PropSection,
  type PropSectionAction,
  type PropSectionProps,
} from "./prop-section/PropSection"
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./segmented/Segmented"
export { Select, type SelectOption, type SelectProps } from "./select/Select"
export { Tab, type TabProps, Tabs, type TabsItem, type TabsProps } from "./tabs/Tabs"
export { Toast, type ToastProps } from "./toast/Toast"
export { Toggle, type ToggleProps } from "./toggle/Toggle"
export { ToolButton, type ToolButtonProps } from "./tool-button/ToolButton"
export {
  Tooltip,
  TooltipContent,
  type TooltipContentProps,
  type TooltipProps,
} from "./tooltip/Tooltip"
