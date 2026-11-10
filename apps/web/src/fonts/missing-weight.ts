/**
 * Board 24 (k) "Font missing-weight warning" (QfSAK): when the chosen weight isn't available for
 * the family (an offline / local font lacks it), the weight field shows a 6px `$warning` dot and
 * its tooltip names the weight actually rendered. No synthetic bold.
 */
import { weightName } from "../editor/text"
import { t } from "../lib/i18n"

/**
 * The weight the renderer draws instead of `wanted`: `@kimo/renderer` `nearestFace` picks the
 * smallest weight distance, the first (lightest) face winning a tie.
 */
export function renderedWeight(wanted: number, available: Iterable<number>): number | null {
  let best: number | null = null
  for (const w of [...available].sort((a, b) => a - b))
    if (best === null || Math.abs(w - wanted) < Math.abs(best - wanted)) best = w
  return best
}

interface MissingWeight {
  /** "Inter Bold (700) isn't installed". */
  title: string
  /** "Showing Semibold 600. Install the weight or pick another." */
  body: string
  rendered: number | null
}

/** Tooltip copy for a missing weight, or null when `weight` ships (or nothing is known). */
export function missingWeight(
  family: string,
  weight: number,
  shipped: ReadonlySet<number> | null,
): MissingWeight | null {
  if (!shipped || shipped.size === 0 || shipped.has(weight)) return null
  const rendered = renderedWeight(weight, shipped)
  const name = weightName(weight)
  return {
    title: t("ui.fonts.missingweight.title", { family, name, weight: String(weight) }),
    body:
      rendered === null
        ? t("ui.fonts.missingweight.body")
        : t("ui.fonts.missingweight.bodyShowing", {
            weight: weightName(rendered),
            value: String(rendered),
          }),
    rendered,
  }
}
