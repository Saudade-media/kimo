import type { Ref, RefCallback } from "react"

/** Joins truthy class names. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ")
}

/** Combines refs (object or callback) into one callback ref. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value)
      else if (ref) (ref as { current: T | null }).current = value
    }
  }
}

/** Clamps `n` into `[min, max]` (either bound optional). */
export function clamp(n: number, min?: number, max?: number): number {
  let v = n
  if (min !== undefined && v < min) v = min
  if (max !== undefined && v > max) v = max
  return v
}

/** Index of the next enabled item from `from` in direction `dir`, wrapping; -1 if none. */
export function nextEnabled(
  count: number,
  from: number,
  dir: 1 | -1,
  isDisabled: (i: number) => boolean,
): number {
  for (let step = 1; step <= count; step++) {
    const i = (((from + dir * step) % count) + count) % count
    if (!isDisabled(i)) return i
  }
  return -1
}
