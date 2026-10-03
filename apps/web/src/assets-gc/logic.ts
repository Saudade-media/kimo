/**
 * Clean up assets (board 19 Vqeu7). The rules are `kimo gc`'s, shared from `@kimo/core-schema`
 * (`src/assets/gc.ts`); this file adds the dialog copy.
 */
import type { AssetFile } from "@kimo/core-schema"

export {
  type AssetFile,
  type AssetGcPlan as GcPlan,
  isContentAddressed,
  planAssetGc,
  prunedManifest,
  referencedAssets,
  usedFontFamilies,
} from "@kimo/core-schema"

// --- Copy (board 19 Vqeu7) ---------------------------------------------------------------------

/** SI sizes as the board shows them: `48 KB`, `6.2 MB`, `18.4 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = bytes / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const s = i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "")
  return `${s} ${units[i]}`
}

export function gcTitle(n: number): string {
  return `Remove ${n} unused asset${n === 1 ? "" : "s"}?`
}

export function gcDescription(fileName: string, bytes: number): string {
  return `No node, fill, component or variable in ${fileName} references these files. Removing them frees ${formatBytes(bytes)} in assets/. Git history keeps old versions.`
}

export function gcConfirmLabel(n: number): string {
  return `Remove ${n} file${n === 1 ? "" : "s"}`
}

/** The CLI equivalent shown as the footnote. */
export function gcCommand(fileName: string): string {
  return `kimo gc ./${fileName}`
}

/** Rows shown before "+ N more · X MB". */
export const GC_VISIBLE_ROWS = 4

export function gcMoreLabel(rest: readonly AssetFile[]): string {
  return `+ ${rest.length} more · ${formatBytes(rest.reduce((s, f) => s + f.bytes, 0))}`
}

// --- Nothing to clean up (board 20 nsxuR) --------------------------------------------------------

export const GC_NOTHING_TITLE = "Nothing to clean up"

/** "Every asset is in use — each file in assets/ is referenced by … in marketing.kimo." (same
 * sentence as `kimo gc`). */
export function gcNothingDescription(fileName: string): string {
  return `Every asset is in use — each file in assets/ is referenced by a node, fill, component or variable in ${fileName}.`
}

/** Body Summary: "12 assets · 31.4 MB". */
export function gcSummary(count: number, bytes: number): string {
  return `${count} asset${count === 1 ? "" : "s"} · ${formatBytes(bytes)}`
}
