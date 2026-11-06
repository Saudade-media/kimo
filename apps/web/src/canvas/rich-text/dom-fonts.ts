/**
 * The inline text editor is DOM text: it only sees fonts the browser knows. Faces the canvas
 * loaded itself (web, pack, cache, local files) are added to `document.fonts` from the same
 * bytes, so text keeps its font while it is edited.
 */
import type { FontProvider } from "@kimo/renderer"

const added = new Set<string>()

export function mirrorFontFace(
  fonts: FontProvider,
  family: string,
  weight: number,
  italic: boolean,
): void {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return
  const style = italic ? "italic" : "normal"
  const key = `${family.toLowerCase()}|${weight}|${style}`
  if (added.has(key)) return
  const bytes = fonts.faceBytes?.(family, weight, style)
  if (!bytes) return
  added.add(key)
  const face = new FontFace(family, bytes.slice().buffer, { weight: String(weight), style })
  document.fonts.add(face)
  face.load().catch(() => {
    document.fonts.delete(face)
    added.delete(key)
  })
}
