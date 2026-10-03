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
// --- M3: Components and tokens (boards 02c, 11–15) ---------------------------------------
export {
  AliasChip,
  type AliasChipProps,
  WhenChip,
  type WhenChipProps,
} from "./alias-chip/AliasChip"
// --- M2: Layout and styling (boards 02b, 09) ---------------------------------------------
export {
  AlignmentGrid,
  type AlignmentGridProps,
  alignmentCell,
  cellAlignment,
  type GridAlign,
  type GridJustify,
} from "./alignment-grid/AlignmentGrid"
export { AssetRow, type AssetRowProps } from "./asset-row/AssetRow"
export { AssetTile, type AssetTileProps } from "./asset-tile/AssetTile"
export { Avatar, type AvatarProps, initialsOf } from "./avatar/Avatar"
export { Badge, type BadgeProps } from "./badge/Badge"
export {
  BLEND_MODE_GROUPS,
  BlendModeMenu,
  type BlendModeMenuProps,
  blendModeLabel,
  type LayerBlendMode,
} from "./blend-mode-menu/BlendModeMenu"
export { Button, type ButtonProps, type ButtonVariant } from "./button/Button"
export * as color from "./color/color"
export {
  COLOR_FORMATS,
  type ColorFormat,
  channels,
  editColor,
  formatColor,
  fromChannels,
  type Hsl,
  type Hsv,
  hexDigits,
  hslToRgb,
  hsvToRgb,
  type Oklch,
  oklchToRgb,
  parseColor,
  parseHex,
  parsePercent,
  percent,
  type Rgba,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  toHex,
} from "./color/color"
export { type Hsva, hexToHsva, hsvaToHex, useHsva } from "./color/useHsva"
export { ColorArea, type ColorAreaProps } from "./color-area/ColorArea"
export { ColorField, type ColorFieldProps } from "./color-field/ColorField"
export {
  ColorPicker,
  type ColorPickerProps,
  type ColorPickerTab,
  type ColorVariable,
  type ColorVariableGroup,
} from "./color-picker/ColorPicker"
export {
  ConfirmDialog,
  type ConfirmDialogProps,
  type ConfirmImpact,
} from "./confirm-dialog/ConfirmDialog"
export {
  DirectionControl,
  type DirectionControlProps,
} from "./direction-control/DirectionControl"
export {
  EFFECT_KINDS,
  type EffectKind,
  EffectRow,
  type EffectRowProps,
} from "./effect-row/EffectRow"
export { EmptyState, type EmptyStateProps } from "./empty-state/EmptyState"
export {
  EntryRow,
  type EntryRowProps,
  moveItem,
  VariableEntries,
  type VariableEntriesProps,
  type VariableEntry,
} from "./entry-row/EntryRow"
export { FileCard, FileCardMiniFrame, type FileCardProps } from "./file-card/FileCard"
export { FillRow, type FillRowProps } from "./fill-row/FillRow"
export {
  colorAt,
  GradientEditor,
  type GradientEditorProps,
  type GradientKind,
} from "./gradient-editor/GradientEditor"
export {
  type GradientStop,
  GradientStopBar,
  type GradientStopBarProps,
  stopsGradient,
} from "./gradient-stop-bar/GradientStopBar"
export { IconButton, type IconButtonProps } from "./icon-button/IconButton"
export {
  filterIcons,
  ICON_GRID,
  ICON_LICENSES,
  IconGlyphSvg,
  type IconIndexProvider,
  type IconLibraryId,
  IconPicker,
  type IconPickerGlyph,
  type IconPickerProps,
  iconSetOf,
  libraryOf,
  type MaterialStyle,
  visibleRows,
} from "./icon-picker/IconPicker"
export { IconTile, type IconTileProps } from "./icon-tile/IconTile"
export {
  IMAGE_FILL_MODES,
  type ImageFillMode,
  ImageFillPopover,
  type ImageFillPopoverProps,
  imageFillBackground,
  imageFillModeLabel,
} from "./image-fill-popover/ImageFillPopover"
export { Input, type InputProps } from "./input/Input"
export {
  InstancePropRow,
  type InstancePropRowProps,
} from "./instance-prop-row/InstancePropRow"
export {
  InstanceSwapField,
  type InstanceSwapFieldProps,
} from "./instance-swap-field/InstanceSwapField"
export { Kbd, type KbdProps } from "./kbd/Kbd"
export {
  LAYER_ROW_INDENT,
  LAYER_ROW_PADDING,
  LayerRow,
  type LayerRowProps,
} from "./layer-row/LayerRow"
export { type LayerKind, LayerRowM3, type LayerRowM3Props } from "./layer-row-m3/LayerRowM3"
export { LibraryManager, type LibraryManagerProps } from "./library-manager/LibraryManager"
export { LibraryRow, type LibraryRowProps } from "./library-row/LibraryRow"
export { Menu, MenuItem, type MenuItemProps, type MenuProps } from "./menu/Menu"
export {
  MenuDense,
  type MenuDenseProps,
  MenuDivider,
  type MenuDividerProps,
  MenuItemDense,
  type MenuItemDenseProps,
} from "./menu-dense/MenuDense"
export { OverrideDot, type OverrideDotProps } from "./override-dot/OverrideDot"
export {
  PanelHeader,
  type PanelHeaderAction,
  type PanelHeaderProps,
} from "./panel-header/PanelHeader"
export { Popover, type PopoverProps } from "./popover/Popover"
export {
  type Align,
  anchoredPosition,
  type Placement,
  type PlacementOptions,
  type Rect,
  type Side,
} from "./popover/position"
export {
  focusables,
  type PopoverAnchor,
  useAnchoredPosition,
  useDismiss,
  useFocusTrap,
} from "./popover/usePopover"
export {
  PROP_TYPE_OPTIONS,
  PropDefRow,
  type PropDefRowProps,
  type PropOption,
  PropOptions,
  type PropOptionsProps,
  type PropType,
} from "./prop-def-row/PropDefRow"
export { PropField, type PropFieldProps } from "./prop-field/PropField"
export { PropTextField, type PropTextFieldProps } from "./prop-field/PropTextField"
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
export { SIZE_MODES, SizeField, type SizeFieldProps, type SizeMode } from "./size-field/SizeField"
export {
  AlphaSlider,
  type AlphaSliderProps,
  type GestureProps,
  HueSlider,
  type HueSliderProps,
  Slider,
  type SliderProps,
} from "./slider/Slider"
export {
  SlotBadge,
  type SlotBadgeProps,
  SlotQuickInsert,
  type SlotQuickInsertProps,
} from "./slot-badge/SlotBadge"
export { type LibraryStatus, StatusPill, type StatusPillProps } from "./status-pill/StatusPill"
export {
  type StrokeSide,
  StrokeSideFields,
  type StrokeSideFieldsProps,
} from "./stroke-side-fields/StrokeSideFields"
export {
  type SwapGroup,
  type SwapItem,
  SwapPopover,
  type SwapPopoverProps,
} from "./swap-popover/SwapPopover"
export { SwatchTile, type SwatchTileProps } from "./swatch-tile/SwatchTile"
export { Tab, type TabProps, Tabs, type TabsItem, type TabsProps } from "./tabs/Tabs"
export { axisIcon, ThemePinRow, type ThemePinRowProps } from "./theme-pin-row/ThemePinRow"
export { Toast, type ToastProps } from "./toast/Toast"
export { Toggle, type ToggleProps } from "./toggle/Toggle"
export { ToolButton, type ToolButtonProps } from "./tool-button/ToolButton"
export {
  Tooltip,
  TooltipContent,
  type TooltipContentProps,
  type TooltipProps,
} from "./tooltip/Tooltip"
export { TooltipHint, type TooltipHintProps } from "./tooltip-hint/TooltipHint"
export {
  type GlyphType,
  TYPE_GLYPH_ICONS,
  TypeGlyph,
  type TypeGlyphProps,
} from "./type-glyph/TypeGlyph"
export {
  AllThemesTag,
  VarCell,
  type VarCellProps,
  type VarCellValue,
} from "./var-cell/VarCell"
export {
  VariableListRow,
  type VariableListRowProps,
} from "./variable-list-row/VariableListRow"
export {
  AxisGroupHeader,
  type AxisGroupHeaderProps,
  ModeColumnHeader,
  type ModeColumnHeaderProps,
  VariableRow,
  type VariableRowProps,
} from "./variable-row/VariableRow"
export {
  type VariablesAxis,
  VariablesDialog,
  type VariablesDialogProps,
  VariablesNavAddButton,
  VariablesNavItem,
  type VariablesNavItemProps,
  VariablesNavSection,
  type VariablesNavSectionProps,
  type VariableTypeFilter,
} from "./variables-dialog/VariablesDialog"
export { ZoomBadge, type ZoomBadgeProps, zoomLabel } from "./zoom-badge/ZoomBadge"
