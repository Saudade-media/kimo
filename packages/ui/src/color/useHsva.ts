import { useRef, useState } from "react"
import { type Hsv, hsvToRgb, parseHex, type Rgba, rgbToHsv, toHex } from "./color"

export interface Hsva extends Hsv {
  a: number
}

/** HSVA of a hex, keeping `prevHue` when the color has no hue (grays, black). */
export function hexToHsva(hex: string, prevHue = 0): Hsva {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0, a: 1 }
  const hsv = rgbToHsv(c)
  const hueless = hsv.s === 0 || hsv.v === 0
  return { h: hueless ? prevHue : hsv.h, s: hsv.s, v: hsv.v, a: c.a }
}

export const hsvaToRgba = (c: Hsva): Rgba => hsvToRgb(c, c.a)
export const hsvaToHex = (c: Hsva): string => toHex(hsvaToRgba(c))

/**
 * Picker-local HSVA that follows the controlled `hex`, but keeps hue/saturation the hex cannot
 * carry (dragging to black or white must not reset the hue). Returns the state and a setter
 * that also reports the new hex.
 */
export function useHsva(
  hex: string,
  onChange?: (hex: string) => void,
): [Hsva, (next: Hsva) => void] {
  const [state, setState] = useState<Hsva>(() => hexToHsva(hex))
  const last = useRef(hsvaToHex(state))
  let current = state
  if (hex.toUpperCase() !== last.current.toUpperCase()) {
    // Controlled value changed from outside (undo, another field): re-derive.
    current = hexToHsva(hex, state.h)
    last.current = hex.toUpperCase()
    setState(current)
  }
  const set = (next: Hsva) => {
    setState(next)
    const out = hsvaToHex(next)
    last.current = out
    if (out.toUpperCase() !== hex.toUpperCase()) onChange?.(out)
  }
  return [current, set]
}
