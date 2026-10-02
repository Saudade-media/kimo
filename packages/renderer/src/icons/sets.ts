/**
 * The icon sets the renderer knows (spec §5.5 `icon`; ADR 0010 "Icons"), their packages and
 * how a `.kimo` `set` + `weight` maps to one file. Pure data; no I/O.
 *
 * | set | package (license) | file | weight |
 * |---|---|---|---|
 * | `lucide` | lucide-static (ISC) | `icons/<name>.svg` | ignored; `strokeWidth` (24 grid, default 2) |
 * | `feather` | feather-icons (MIT) | `dist/icons/<name>.svg` | ignored; `strokeWidth` (default 2) |
 * | `phosphor` | @phosphor-icons/core (MIT) | `assets/<style>/<name>[-<style>].svg` | nearest of thin 100, light 300, regular 400, bold 700 (ties → heavier) |
 * | `material-{outlined,rounded,sharp}` | @material-symbols/svg-400 (Apache-2.0) | `<style>/<name>.svg` | data is wght 400; other weights are drawn by offsetting the outline (see `materialOffset`) |
 */

export const ICON_SETS = [
  "lucide",
  "feather",
  "phosphor",
  "material-outlined",
  "material-rounded",
  "material-sharp",
] as const
export type IconSetId = (typeof ICON_SETS)[number]

export const isIconSet = (s: string): s is IconSetId => (ICON_SETS as readonly string[]).includes(s)

/** Glyph names are file stems: lowercase letters, digits, `-` and `_` (no path traversal). */
export const ICON_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const PHOSPHOR_WEIGHTS = [
  [100, "thin"],
  [300, "light"],
  [400, "regular"],
  [700, "bold"],
] as const

/** Phosphor style for a requested weight: the nearest of 100/300/400/700; ties go heavier. */
export function phosphorWeight(weight: number | undefined): (typeof PHOSPHOR_WEIGHTS)[number] {
  const w = weight === undefined || !Number.isFinite(weight) ? 400 : weight
  let best: (typeof PHOSPHOR_WEIGHTS)[number] = PHOSPHOR_WEIGHTS[2]
  let bestD = Number.POSITIVE_INFINITY
  for (const e of PHOSPHOR_WEIGHTS) {
    const d = Math.abs(e[0] - w)
    if (d <= bestD) {
      best = e
      bestD = d
    }
  }
  return best
}

/** Material Symbols: weights 100–700 (absent = 400). */
export const materialWeight = (weight: number | undefined): number =>
  weight === undefined || !Number.isFinite(weight) ? 400 : Math.max(100, Math.min(700, weight))

/**
 * Outline offset that approximates Material Symbols `wght` from the 400 data, in the glyph's
 * viewBox units (960 per em). Material's stroke is 80 units (2px of 24) at 400 and ~2.83px at
 * 700, ~1.17px at 100 (≈ linear); each side moves by half the thickness change.
 */
export function materialOffset(weight: number): number {
  const thickness24 = 2 + ((weight - 400) / 300) * 0.83
  return ((thickness24 - 2) / 2) * 40
}

/**
 * The weight a glyph's data is stored at for `(set, weight)` — the cache key's weight part.
 * Material always loads 400 (offset at draw time); phosphor its nearest style; others null.
 */
export function dataWeight(set: string, weight: number | undefined): number | null {
  if (set === "phosphor") return phosphorWeight(weight)[0]
  if (set.startsWith("material-")) return 400
  return null
}

/** Package + relative file of one glyph, or null for an unknown set / invalid name. */
export function glyphFile(
  set: string,
  name: string,
  weight: number | undefined,
): { pkg: string; file: string } | null {
  if (!ICON_NAME.test(name)) return null
  // Material's `-fill` files are the FILL axis, not separate glyphs (not designed yet).
  if (set.startsWith("material-") && name.endsWith("-fill")) return null
  switch (set) {
    case "lucide":
      return { pkg: "lucide-static", file: `icons/${name}.svg` }
    case "feather":
      return { pkg: "feather-icons", file: `dist/icons/${name}.svg` }
    case "phosphor": {
      const style = phosphorWeight(weight)[1]
      const suffix = style === "regular" ? "" : `-${style}`
      return { pkg: "@phosphor-icons/core", file: `assets/${style}/${name}${suffix}.svg` }
    }
    case "material-outlined":
    case "material-rounded":
    case "material-sharp":
      return { pkg: "@material-symbols/svg-400", file: `${set.slice(9)}/${name}.svg` }
  }
  return null
}

/** Pack directory of `(set, weight)` (browser packs, `scripts/build-icon-packs.ts`). */
export function packKey(set: string, weight: number | undefined): string | null {
  if (!isIconSet(set)) return null
  return set === "phosphor" ? `phosphor-${phosphorWeight(weight)[1]}` : set
}

/** Shards per pack (glyphs are spread by {@link shardOf}; ~60–130 glyphs per shard). */
export const PACK_SHARDS: Record<string, number> = {
  lucide: 24,
  feather: 4,
  "phosphor-thin": 16,
  "phosphor-light": 16,
  "phosphor-regular": 16,
  "phosphor-bold": 16,
  "material-outlined": 48,
  "material-rounded": 48,
  "material-sharp": 48,
}

/** FNV-1a shard of a glyph name. */
export function shardOf(name: string, shards: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % shards
}
