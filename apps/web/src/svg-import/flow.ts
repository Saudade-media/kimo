/**
 * SVG import flow (drop / paste): sanitize → popover (or ⇧: the last choice, no popover) →
 * either vector paths (one undoable insert) or an image asset (`assets/<hash>.svg`, the
 * sanitized SVG re-serialized, placed as an image fill). Never links outside the file's folder:
 * the bytes are always copied into `assets/`.
 */
import type { InsertOp, Op } from "@kimo/editor-state"
import { contentHash } from "../lib/assets"
import {
  analyzeSvg,
  type ConvertContext,
  convertSvg,
  DEFAULT_SVG_OPTIONS,
  describeStats,
  type SvgStats,
  svgSize,
} from "./convert"
import type { SvgImportChoice } from "./SvgImportPopover"
import { type SanitizedSvg, sanitizeSvg, serializeSvg } from "./sanitize"

export interface PreparedSvg {
  fileName: string
  /** File name without `.svg` (root frame name). */
  baseName: string
  svg: SanitizedSvg
  stats: SvgStats
  /** The sanitized SVG to store for the Image option. */
  imageBytes: Uint8Array
  /** `<hash>.svg` of {@link imageBytes}. */
  imageKey: string
  size: { w: number; h: number }
  vectorDescription: string
  imageDescription: string
}

/** Sanitizes and analyzes a dropped/pasted SVG (throws `SvgImportError` for unusable input). */
export async function prepareSvg(
  bytes: Uint8Array | string,
  fileName: string,
): Promise<PreparedSvg> {
  const svg = sanitizeSvg(bytes)
  const stats = analyzeSvg(svg)
  const imageBytes = new TextEncoder().encode(serializeSvg(svg.root))
  const imageKey = `${await contentHash(imageBytes)}.svg`
  const { w, h } = svgSize(svg.root)
  return {
    fileName,
    baseName: fileName.replace(/\.svg$/i, "") || "SVG",
    svg,
    stats,
    imageBytes,
    imageKey,
    size: { w, h },
    vectorDescription: describeStats(stats),
    imageDescription: `Copies the file to assets/${imageKey} and places an image fill.`,
  }
}

const LAST_KEY = "kimo.svgImport.last"

/** The last choice (⇧ while dropping reuses it). Per browser; defaults when unavailable. */
export function lastSvgChoice(): SvgImportChoice {
  try {
    const raw = JSON.parse(
      localStorage.getItem(LAST_KEY) ?? "null",
    ) as Partial<SvgImportChoice> | null
    if (raw && (raw.mode === "vector" || raw.mode === "image"))
      return { mode: raw.mode, options: { ...DEFAULT_SVG_OPTIONS, ...(raw.options ?? {}) } }
  } catch {
    // Storage blocked or bad JSON: defaults.
  }
  return { mode: "vector", options: DEFAULT_SVG_OPTIONS }
}

export function rememberSvgChoice(choice: SvgImportChoice): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(choice))
  } catch {
    // Not remembered this time.
  }
}

export interface SvgImportTarget extends Omit<ConvertContext, "name"> {
  /** Stores bytes as a document asset (`./assets/<key>`); resolves its manifest entry. */
  putAsset: (
    key: string,
    bytes: Uint8Array,
    entry: { mime: string; width: number; height: number; name: string },
  ) => Promise<void>
  /** The document's asset manifest, when it has one (entries are added with the reference). */
  manifest?: Readonly<Record<string, unknown>> | null
}

/** Ops for the chosen import (apply as one undoable edit). */
export async function svgImportOps(
  prepared: PreparedSvg,
  choice: SvgImportChoice,
  target: SvgImportTarget,
): Promise<{ ops: Op[]; rootId: string; stats: SvgStats }> {
  if (choice.mode === "vector") {
    const r = convertSvg(prepared.svg, choice.options, { ...target, name: prepared.baseName })
    return { ops: r.ops, rootId: r.rootId, stats: r.stats }
  }
  const entry = {
    mime: "image/svg+xml",
    width: Math.round(prepared.size.w),
    height: Math.round(prepared.size.h),
    name: prepared.fileName,
  }
  await target.putAsset(prepared.imageKey, prepared.imageBytes, entry)
  const id = target.newId()
  const at = target.at ?? { x: 0, y: 0 }
  const ops: Op[] = [
    {
      op: "insert",
      id,
      parent: target.parent ?? null,
      node: {
        type: "rect",
        name: prepared.baseName,
        x: at.x,
        y: at.y,
        w: prepared.size.w,
        h: prepared.size.h,
        fill: [{ kind: "image", src: `./assets/${prepared.imageKey}`, fit: "contain" }],
      },
    } as InsertOp,
  ]
  if (target.manifest && !Object.hasOwn(target.manifest, prepared.imageKey))
    ops.push({
      op: "setHeader",
      set: { assets: { ...target.manifest, [prepared.imageKey]: entry } },
    })
  return { ops, rootId: id, stats: prepared.stats }
}
