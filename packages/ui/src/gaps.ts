/** Board 24 "needs design — decided" gap components (one builder); re-exported from index.ts. */
export {
  ClosePrompt,
  type ClosePromptProps,
  closePromptLoss,
} from "./close-prompt/ClosePrompt"
export {
  CONFLICT_MENU_MAX_ROWS,
  CONFLICT_MENU_WIDTH,
  type ConflictMoreItem,
  ConflictMoreMenu,
  type ConflictMoreMenuProps,
  conflictMenuWidth,
  middleTruncatePath,
} from "./conflict-more-menu/ConflictMoreMenu"
export {
  CustomTagField,
  type CustomTagFieldProps,
  isOpenTypeTag,
  parseFeatureValue,
} from "./custom-tag-field/CustomTagField"
export {
  LinkPopover,
  type LinkPopoverProps,
  type LinkUrlCheck,
  parseLinkUrl,
} from "./link-popover/LinkPopover"
export {
  SVG_REJECTION_MAX_ROWS,
  SvgRejectionDetails,
  type SvgRejectionDetailsProps,
  type SvgRejectionItem,
  svgRejectionReport,
} from "./svg-rejection/SvgRejectionDetails"
export {
  MissingWeightTooltip,
  type MissingWeightTooltipProps,
  WarningDot,
} from "./weight-warning/WeightWarning"
