/**
 * Asset manifest upkeep (spec §12 rule 2): when a document has an `assets` manifest, every
 * asset reference must be listed, so an edit that adds a reference adds its entry in the same
 * `store.apply` (one undo step). Without a manifest nothing is added: the manifest is optional
 * and the export writes one for the saved package.
 */
import type { Op } from "@kimo/editor-state"
import type { ManifestEntry } from "./assets"

const REF = /\.\/assets\/([0-9a-f]{16}\.[a-z0-9]{1,8})/g

/** Asset keys (`<hash>.<ext>`) referenced anywhere in `value` (ops, nodes, documents). */
export function assetRefs(value: unknown, out = new Set<string>()): Set<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (!text?.includes("./assets/")) return out
  for (const m of text.matchAll(REF)) out.add(m[1] as string)
  return out
}

/**
 * The `setHeader` op adding manifest entries for references in `ops` that the manifest lacks,
 * or none (no manifest, nothing missing, or entries unknown to `entryOf`).
 */
export function manifestOps(
  manifest: unknown,
  ops: Op | readonly Op[],
  entryOf: (src: string) => ManifestEntry | null,
): Op[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return []
  const have = manifest as Record<string, unknown>
  const add: Record<string, ManifestEntry> = {}
  for (const key of assetRefs(ops)) {
    if (Object.hasOwn(have, key)) continue
    const e = entryOf(`./assets/${key}`)
    if (e) add[key] = e
  }
  if (!Object.keys(add).length) return []
  return [{ op: "setHeader", set: { assets: { ...have, ...add } } }]
}
