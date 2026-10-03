/** Board 19 "Clean up assets" (same rules as `kimo gc`). See INTEGRATION.md. */
export {
  CleanUpAssetsDialog,
  type CleanUpAssetsDialogProps,
  CleanUpNothingDialog,
  type CleanUpNothingDialogProps,
} from "./CleanUpAssetsDialog"
export {
  applyAssetGc,
  CleanUpAssetsHost,
  type CleanUpAssetsHostProps,
  planFolderGc,
} from "./CleanUpAssetsHost"
export { type AssetFolder, indexedDbAssetFolder, platformAssetFolder } from "./folders"
export {
  type AssetFile,
  formatBytes,
  GC_NOTHING_TITLE,
  GC_VISIBLE_ROWS,
  type GcPlan,
  gcCommand,
  gcConfirmLabel,
  gcDescription,
  gcMoreLabel,
  gcNothingDescription,
  gcSummary,
  gcTitle,
  isContentAddressed,
  planAssetGc,
  prunedManifest,
  referencedAssets,
  usedFontFamilies,
} from "./logic"
