/**
 * Paste from Figma: a Figma copy (`text/html` carrying `(figma)` data) becomes a Kimo clipboard
 * payload, so it pastes like any Kimo copy (placement, one undo step, selection, toast).
 *
 * The copy's images are not on the clipboard: its metadata lists a signed, expiring download
 * URL per image hash. They are downloaded and stored as assets first; one that fails pastes as
 * a missing image and is reported.
 */
import { featuresNeeded } from "@kimo/core-schema"
import { generateId } from "@kimo/editor-state"
import {
  convertFigma,
  type FigmaImportWarning,
  figmaImageHashes,
  isFigmaClipboard,
  parseFigmaClipboard,
} from "@kimo/figma"
import type { AssetStore } from "../../lib/assets"
import type { ClipboardPayload } from "./payload"

export { isFigmaClipboard }

/** Parallel image downloads. */
const CONCURRENCY = 6
const DOWNLOAD_TIMEOUT_MS = 30_000

interface FigmaPaste {
  payload: ClipboardPayload
  warnings: FigmaImportWarning[]
  /** Images that could not be downloaded or stored. */
  missingImages: number
}

async function download(url: string): Promise<Blob | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit" })
    return res.ok ? await res.blob() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Builds the paste payload of a Figma copy, storing its images in `assets` (when there is a
 * store). Returns null when `html` is not a Figma copy; throws when it is one Kimo cannot read.
 */
export async function figmaPaste(
  html: string,
  assets: AssetStore | null,
  onImages?: (count: number) => void,
): Promise<FigmaPaste | null> {
  if (!isFigmaClipboard(html)) return null
  const copy = parseFigmaClipboard(html)
  if (!copy) return null
  if (copy.kind !== "fig-kiwi") throw new Error("FigJam boards can't be pasted into Kimo yet.")
  const urls = copy.meta?.imageHashes ?? {}
  const hashes = figmaImageHashes(copy.message).filter((h) => typeof urls[h] === "string")
  const images = new Map<string, string>()
  const manifest: Record<string, Record<string, unknown>> = {}
  let failed = 0
  if (assets && hashes.length) {
    onImages?.(hashes.length)
    let next = 0
    const worker = async () => {
      while (next < hashes.length) {
        const hash = hashes[next++] as string
        const blob = await download(urls[hash] as string)
        if (!blob) {
          failed++
          continue
        }
        try {
          const info = await assets.put(blob)
          images.set(hash, info.src)
          const { mime, bytes, width, height, sha256 } = info
          manifest[info.src.replace(/^\.\/assets\//, "")] = JSON.parse(
            JSON.stringify({ mime, bytes, width, height, sha256 }),
          )
        } catch {
          failed++
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hashes.length) }, worker))
  }
  const result = convertFigma(copy.message, { newId: generateId, images })
  const features = [...featuresNeeded({ nodes: result.nodes })].sort()
  const payload: ClipboardPayload = {
    kimo: "kimo/nodes+json",
    v: 1,
    id: generateId(),
    source: { doc: `figma:${copy.meta?.fileKey ?? "clipboard"}`, page: null },
    roots: result.roots,
    nodes: result.nodes,
    boxes: result.boxes,
    mains: {},
    ...(features.length ? { features } : {}),
    ...(Object.keys(manifest).length ? { assets: manifest } : {}),
    text: "",
  }
  const missing = result.warnings.find((w) => w.code === "IMAGE_MISSING")
  return { payload, warnings: result.warnings, missingImages: missing ? missing.count : failed }
}

/** One line for the warnings worth telling (images first), or null. */
export function figmaWarningText(r: FigmaPaste): string | null {
  const parts: string[] = []
  if (r.missingImages)
    parts.push(
      r.missingImages === 1
        ? "1 image could not be downloaded from Figma (copy it again, or use Copy as PNG)"
        : `${r.missingImages} images could not be downloaded from Figma (copy them again, or use Copy as PNG)`,
    )
  for (const w of r.warnings)
    if (w.code !== "IMAGE_MISSING")
      parts.push(w.count > 1 ? `${w.message} (${w.count})` : w.message)
  return parts.length ? parts.join(". ") : null
}
