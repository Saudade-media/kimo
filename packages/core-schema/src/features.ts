/**
 * Feature flags (teardown 10.2 rule 7, 10.3). A document lists in `features` every gated
 * construct it uses. A reader that does not know a listed feature opens the file read-only.
 */

/** Every feature defined by format 0.1, with the construct it unlocks. */
export const FEATURES = {
  "layout/wrap": "Frame `layout.wrap` and `layout.crossGap`.",
  "layout/stretch-baseline": 'Frame `layout.align` values "stretch" and "baseline".',
  "size/min-max": "`min` / `max` on structured `fit` and `fill` sizes.",
  "text/runs": "Rich text: `content` as an array of text spans.",
  "tokens/composite":
    'Composite variable types ("typography", "shadow", "dimension"), `style.typography`, and `effects` bound to a shadow variable.',
  "fill/mesh": 'Mesh-gradient paints (`kind: "mesh"`).',
  "fill/shader": 'Shader paints (`kind: "shader"`).',
  "node/script": 'Script nodes (`type: "script"`).',
  "node/browser": 'Browser nodes (`type: "browser"`).',
} as const

/** A feature flag known to format 0.1. */
export type Feature = keyof typeof FEATURES

/** All known feature flags, sorted. */
export const KNOWN_FEATURES: readonly Feature[] = (Object.keys(FEATURES) as Feature[]).sort()

/** Pattern of a feature flag: `area/name`, lower-case kebab segments. */
export const FEATURE_PATTERN = "^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$"

/** True when `name` is a feature flag defined by this format version. */
export function isKnownFeature(name: string): name is Feature {
  return Object.hasOwn(FEATURES, name)
}
