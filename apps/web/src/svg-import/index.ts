/** Board 19 SVG import (vector paths vs image asset). See INTEGRATION.md. */
export {
  lastSvgChoice,
  type PreparedSvg,
  prepareSvg,
  rememberSvgChoice,
  SvgRejectedError,
  svgImportOps,
} from "./flow"
export { loadStrokeOutliner } from "./outline-loader"
export { type SvgImportChoice, SvgImportPopover } from "./SvgImportPopover"
export { SvgRejectionToast } from "./SvgRejectionToast"
