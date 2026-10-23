/**
 * Font share policy (docs/spec/multiplayer.md §16.5). A face travels as a blob only when its
 * licence is known to allow redistribution: Kimo's bundled faces, the curated offline pack (all
 * OFL) and families fetched from Google Fonts. Any other face is `name-only`: text keeps naming
 * the family and nothing is uploaded.
 */

/** Faces bundled with Kimo (OFL). */
export const BUNDLED_FONT_FAMILIES: readonly string[] = ["Inter", "JetBrains Mono"]

/** The offline pack (mirrors `FONT_PACK_FAMILIES` in apps/web/src/fonts/font-pack.ts; all OFL). */
export const PACK_FONT_FAMILIES: readonly string[] = [
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "IBM Plex Sans",
  "Space Grotesk",
  "Fira Sans",
  "Playfair Display",
  "Lora",
  "Source Serif 4",
  "Roboto Mono",
]

export type FontShareDecision = "share" | "name-only"

/**
 * `bundled`/`pack`/`google`: Kimo shipped or fetched the face from a known source. `user`: a file
 * the user added. A missing `source` is unknown provenance and is never shared.
 */
export interface FontFace {
  family: string
  source?: "bundled" | "pack" | "google" | "user"
}

const BUNDLED = new Set(BUNDLED_FONT_FAMILIES.map(normalize))
const PACK = new Set(PACK_FONT_FAMILIES.map(normalize))

function normalize(family: string): string {
  return family.trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * The Kimo-shipped source a family name refers to, or undefined. For callers that only hold a
 * family name from a document (nothing is uploaded from a name), not for local font files.
 */
export function shippedFontSource(family: string): "bundled" | "pack" | undefined {
  const name = normalize(family)
  if (BUNDLED.has(name)) return "bundled"
  return PACK.has(name) ? "pack" : undefined
}

/** Whether the face's file may be uploaded. Only an explicit known source shares; the name alone never does. */
export function fontShareDecision(face: FontFace): FontShareDecision {
  if (face.source === "google") return "share"
  if (face.source === "pack" && PACK.has(normalize(face.family))) return "share"
  if (face.source === "bundled" && BUNDLED.has(normalize(face.family))) return "share"
  return "name-only"
}

export interface FontGuard {
  /** The faces to upload; fires the warning once per name-only family. */
  filter<T extends FontFace>(faces: readonly T[]): T[]
}

/** A guard whose `onNotShared` fires once per family (spec §16.5: once per family per room). */
export function createFontGuard(onNotShared: (families: string[]) => void): FontGuard {
  const warned = new Set<string>()
  return {
    filter(faces) {
      const shared: (typeof faces)[number][] = []
      const fresh: string[] = []
      for (const face of faces) {
        if (fontShareDecision(face) === "share") shared.push(face)
        else if (!warned.has(normalize(face.family))) {
          warned.add(normalize(face.family))
          fresh.push(face.family)
        }
      }
      if (fresh.length > 0) onNotShared(fresh)
      return shared
    },
  }
}
