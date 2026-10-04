/**
 * M7 export UI (board 07 "Export Dialog" `AsO2h`, ADR 0015) with board 25 § 2 additions
 * (`O3Abm`). See INTEGRATION.md.
 */

export {
  COPY_PNG_SCALE,
  type CopyPngResult,
  copySelectionAsPng,
  writePngToClipboard,
} from "./copy-png"
export {
  ExportDialog,
  type ExportDialogProps,
  type ExportOutcome,
  type ExportPreset,
} from "./ExportDialog"
export {
  type ExportChoices,
  type ExportSource,
  type ExportSummary,
  type GeneratedExport,
  generateExport,
  pdfFontsFrom,
  previewRaster,
} from "./generate"
export {
  groupIssues,
  type IssueGroup,
  type IssueLevel,
  type IssueRow,
  issuesReport,
} from "./issues"
export {
  DEFAULT_TAILWIND,
  DEFAULT_TOGGLES,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportToastSpec,
  type ExportToggles,
  exportToastOf,
  planWrite,
  readExportToggles,
  TAILWIND_THEMES,
  type TailwindChoices,
  type WriteResult,
  writePlan,
  zipFiles,
} from "./model"
