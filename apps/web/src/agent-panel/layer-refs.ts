/**
 * Inline layer references in the composer text. A chip is stored (and sent to the agent) in place
 * as `[[layer:<id> "<name>"]]`, so its position in the sentence is part of the text itself.
 */

const TOKEN = /\[\[layer:([^\s\]"]+) ("(?:[^"\\]|\\.)*")\]\]/g

export function layerToken(id: string, name: string): string {
  return `[[layer:${id} ${JSON.stringify(name)}]]`
}

export type ComposerSegment =
  | { kind: "text"; text: string }
  | { kind: "layer"; id: string; name: string; token: string }

/** Split composer text into text runs and layer chips, in order. */
export function composerSegments(text: string): ComposerSegment[] {
  const out: ComposerSegment[] = []
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0
    let name: string
    try {
      name = JSON.parse(m[2] as string) as string
    } catch {
      continue
    }
    if (start > at) out.push({ kind: "text", text: text.slice(at, start) })
    out.push({ kind: "layer", id: m[1] as string, name, token: m[0] })
    at = start + m[0].length
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) })
  return out
}

/** The layers a text refers to, in order (duplicates kept out). */
export function layerRefs(text: string): { id: string; name: string }[] {
  const seen = new Set<string>()
  const out: { id: string; name: string }[] = []
  for (const s of composerSegments(text)) {
    if (s.kind !== "layer" || seen.has(s.id)) continue
    seen.add(s.id)
    out.push({ id: s.id, name: s.name })
  }
  return out
}

/** Insert chips for `items` at `cursor` (end when null), returning the new text and caret. */
export function insertLayerRefs(
  text: string,
  cursor: number | null,
  items: readonly { id: string; name: string }[],
): { text: string; caret: number } {
  const at = cursor == null ? text.length : Math.max(0, Math.min(cursor, text.length))
  const ins = items.map((i) => layerToken(i.id, i.name)).join("")
  return { text: text.slice(0, at) + ins + text.slice(at), caret: at + ins.length }
}
