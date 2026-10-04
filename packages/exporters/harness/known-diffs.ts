/**
 * Differences that are not exporter bugs, each with its reason. Anything else fails.
 * `id` + `kind` (`exact`: pass A, `geometry`/`text`: pass B).
 */
export const KNOWN_DIFFS: { fixture: string; id: string; kind: string; reason: string }[] = [
  {
    fixture: "unicode-and-escapes",
    id: "Txt0000001",
    kind: "text",
    reason: "emoji and tab come from different fallback fonts in CanvasKit Paragraph and Chromium",
  },
]

/** True when `id` of `fixture` is a listed difference of `kind`. */
export function isKnownDiff(fixture: string, kind: string, id: string): boolean {
  return KNOWN_DIFFS.some((k) => k.fixture === fixture && k.kind === kind && k.id === id)
}
