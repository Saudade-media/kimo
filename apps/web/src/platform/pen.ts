/**
 * Opening a pen.dev `.pen` file (plain JSON, schema 2.x): it is converted once into a `.kimo`
 * next to it (`<name>.kimo`, images stored in `assets/`), and that file is what the editor
 * opens. The `.pen` is never written.
 *
 * The converted file records the `.pen` it came from (`meta["pen.source"]`: file name and
 * SHA-256), so opening the same unchanged `.pen` again reopens the same `.kimo` with its edits.
 * When `<name>.kimo` belongs to something else (another file, or an older version of this
 * `.pen`), the next free name is used (`<name> 2.kimo`, …): an existing file is never replaced.
 */
import {
  importPen,
  isPenDocument,
  type PenImportWarning,
  penImageUrls,
  serialize,
} from "@kimo/core-schema"
import {
  basenameOf,
  dirnameOf,
  type FileRef,
  isAbsolutePath,
  type KimoPlatform,
  resolveRelativeRef,
} from "@kimo/platform"
import { createFolderAssetStore } from "../lib/assets"

/** The `.pen` extension (case-insensitive). */
export function isPenPath(ref: string): boolean {
  return ref.toLowerCase().endsWith(".pen")
}

/** What {@link convertPenFile} did. */
export interface PenConversion {
  /** The `.kimo` to open. */
  ref: FileRef
  /** False when an earlier conversion of the same `.pen` was reopened. */
  created: boolean
  warnings: PenImportWarning[]
}

const SOURCE_KEY = "pen.source"

/** The `pen.source` record of the `.kimo` at `ref`, or null (missing, unreadable, other). */
async function sourceOf(
  platform: KimoPlatform,
  ref: FileRef,
): Promise<{ file?: unknown; sha256?: unknown } | null> {
  try {
    const doc = JSON.parse((await platform.files.readText(ref)).text) as {
      meta?: Record<string, unknown>
    }
    const s = doc.meta?.[SOURCE_KEY]
    return s && typeof s === "object" ? (s as { file?: unknown; sha256?: unknown }) : null
  } catch {
    return null
  }
}

/** The file name an image URL ends in, decoded when it is valid percent-encoding. */
function assetName(url: string): string | undefined {
  const last = url.split(/[?#]/)[0]?.split("/").pop() ?? ""
  try {
    return decodeURIComponent(last) || undefined
  } catch {
    // A stray "%" (e.g. "100%.png") is not an escape: keep the name as written.
    return last || undefined
  }
}

/** Bytes of an image a `.pen` references: relative to the `.pen`, or an http(s) URL. */
async function loadImage(
  platform: KimoPlatform,
  penRef: FileRef,
  url: string,
): Promise<Uint8Array | null> {
  try {
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url)
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || isAbsolutePath(url)) return null
    return await platform.files.readBytes(resolveRelativeRef(penRef, url))
  } catch {
    return null
  }
}

/**
 * Converts the `.pen` at `penRef` into a `.kimo` beside it (or finds the earlier conversion)
 * and returns the `.kimo` to open. Throws when the file is not a readable `.pen` document.
 */
export async function convertPenFile(
  platform: KimoPlatform,
  penRef: FileRef,
): Promise<PenConversion> {
  const { text, hash } = await platform.files.readText(penRef)
  let pen: unknown
  try {
    pen = JSON.parse(text)
  } catch {
    throw new Error(`${basenameOf(penRef)} is not a readable .pen file (it is not plain JSON).`)
  }
  if (!isPenDocument(pen)) throw new Error(`${basenameOf(penRef)} is not a .pen design document.`)
  const file = basenameOf(penRef)
  const dir = dirnameOf(penRef).replace(/[\\/]+$/, "")
  const sep = penRef.includes("\\") && !penRef.includes("/") ? "\\" : "/"
  const stem = file.replace(/\.pen$/i, "")

  let target: FileRef | null = null
  for (let i = 1; target === null; i++) {
    const candidate = `${dir}${sep}${i === 1 ? stem : `${stem} ${i}`}.kimo`
    if (!(await platform.files.stat(candidate))) {
      target = candidate
      break
    }
    const src = await sourceOf(platform, candidate)
    if (src?.file === file && src.sha256 === hash)
      return { ref: candidate, created: false, warnings: [] }
  }

  const assets = createFolderAssetStore(platform, target)
  const images = new Map<string, string>()
  const manifest: Record<string, Record<string, unknown>> = {}
  try {
    for (const url of penImageUrls(pen)) {
      const bytes = await loadImage(platform, penRef, url)
      if (!bytes) continue
      const name = assetName(url)
      try {
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]) as Blob & { name?: string }
        if (name) blob.name = name
        const info = await assets.put(blob)
        images.set(url, info.src)
        const { mime, bytes: size, width, height, name: original, sha256 } = info
        manifest[info.src.replace(/^\.\/assets\//, "")] = JSON.parse(
          JSON.stringify({ mime, bytes: size, width, height, name: original, sha256 }),
        )
      } catch {
        // Unsupported or oversized image: it stays a missing asset (checkerboard).
      }
    }
  } finally {
    assets.dispose()
  }

  const result = importPen(pen, { name: stem, images })
  const doc = result.doc as unknown as Record<string, unknown>
  doc.meta = { ...(doc.meta as object), [SOURCE_KEY]: { file, sha256: hash } }
  // List the stored images, so a manifest added later (a font) never reads them as missing.
  if (Object.keys(manifest).length) doc.assets = { ...(doc.assets as object), ...manifest }
  await platform.files.writeTextAtomic(target, serialize(result.doc))
  return { ref: target, created: true, warnings: result.warnings }
}
