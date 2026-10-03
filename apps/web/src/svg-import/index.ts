/** Board 19 SVG import (vector paths vs image asset). See INTEGRATION.md. */
export {
  analyzeSvg,
  type ConvertContext,
  type ConvertResult,
  convertSvg,
  DEFAULT_SVG_OPTIONS,
  describeStats,
  importSvgAsVectors,
  parseSvgColor,
  type StrokeOutliner,
  type SvgImportOptions,
  type SvgStats,
  svgSize,
} from "./convert"
export {
  lastSvgChoice,
  type PreparedSvg,
  prepareSvg,
  rememberSvgChoice,
  type SvgImportTarget,
  SvgRejectedError,
  type SvgRejectReason,
  svgImportOps,
  svgRejection,
} from "./flow"
export { parsePath, parseTransform, serializeSegments } from "./geometry"
export {
  type SvgImportChoice,
  type SvgImportMode,
  SvgImportPopover,
  type SvgImportPopoverProps,
} from "./SvgImportPopover"
export {
  type SanitizedSvg,
  type SanitizeReport,
  SVG_LIMITS,
  type SvgElement,
  SvgImportError,
  sanitizeSvg,
  serializeSvg,
} from "./sanitize"
