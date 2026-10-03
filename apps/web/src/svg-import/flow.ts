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
import { type SanitizedSvg, SvgImportError, sanitizeSvg, serializeSvg } from "./sanitize"

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

/** Why a whole SVG is refused (board 20 M4Pij9 / fW1JW). */
export type SvgRejectReason = "script" | "external" | "embedded-html"

/** "it contains a script", "it loads an external file" (board 20 toasts M4Pij9 / fW1JW). */
const REASON_TEXT: Record<SvgRejectReason, string> = {
  script: "contains a script",
  external: "loads an external file",
  // Not drawn on board 20 (the rule lists <foreignObject>; the copy follows the same pattern).
  "embedded-html": "embeds HTML content",
}

/**
 * Board 20 rule (note o9snO): an SVG is rejected whole — never silently stripped — when it has
 * `<script>`, `on*` handlers, `javascript:` URLs, `<foreignObject>`, or `href` / `xlink:href`
 * (or `url()`) outside the file. Nothing is copied to `assets/`.
 */
export class SvgRejectedError extends SvgImportError {
  readonly fileName: string
  readonly reason: SvgRejectReason
  /** The offending constructs with their source lines: `<script> · line 4`. */
  readonly details: string[]
  constructor(fileName: string, reason: SvgRejectReason, details: string[]) {
    super(`Couldn't import ${fileName} — it ${REASON_TEXT[reason]}`)
    this.fileName = fileName
    this.reason = reason
    this.details = details
  }
}

/** 1-based line of the first `needle` in `text` (case-insensitive), or null. */
function lineOf(text: string, needle: string): number | null {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  return i < 0 ? null : text.slice(0, i).split("\n").length
}

/** Classifies the sanitizer's removals; null when nothing requires a rejection. */
export function svgRejection(
  blocked: readonly string[],
  source: string,
): { reason: SvgRejectReason; details: string[] } | null {
  const hits: { reason: SvgRejectReason; label: string; needle: string }[] = []
  for (const b of blocked) {
    const sep = b.indexOf(":")
    const key = sep < 0 ? b : b.slice(0, sep)
    const value = sep < 0 ? "" : b.slice(sep + 1)
    if (b === "script") hits.push({ reason: "script", label: "<script>", needle: "<script" })
    else if (b === "foreignObject")
      hits.push({ reason: "embedded-html", label: "<foreignObject>", needle: "<foreignObject" })
    else if (/^on/i.test(b) && sep < 0)
      hits.push({ reason: "script", label: `${b} handler`, needle: `${b}=` })
    else if (/javascript:/i.test(value))
      hits.push({ reason: "script", label: `${key}="${value}"`, needle: value })
    else if (key === "href")
      hits.push({ reason: "external", label: `href="${value}"`, needle: value })
    else if (sep >= 0 && /url\(/i.test(value))
      hits.push({ reason: "external", label: `${key}="${value}"`, needle: value })
  }
  if (hits.length === 0) return null
  // Scripts first (they are the more serious finding), then embedded HTML, then external files.
  const rank: Record<SvgRejectReason, number> = { script: 0, "embedded-html": 1, external: 2 }
  hits.sort((a, b) => rank[a.reason] - rank[b.reason])
  return {
    reason: (hits[0] as (typeof hits)[number]).reason,
    details: hits.map((h) => {
      const line = lineOf(source, h.needle)
      return line === null ? h.label : `${h.label} · line ${line}`
    }),
  }
}

/** Sanitizes and analyzes a dropped/pasted SVG (throws `SvgImportError` for unusable input and
 * {@link SvgRejectedError} for an unsafe one). */
export async function prepareSvg(
  bytes: Uint8Array | string,
  fileName: string,
): Promise<PreparedSvg> {
  const svg = sanitizeSvg(bytes)
  const source = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)
  const rejected = svgRejection(svg.report.blocked, source)
  if (rejected) throw new SvgRejectedError(fileName, rejected.reason, rejected.details)
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
