/** A tiny string-HTML layer: interpolations are escaped unless wrapped in {@link raw}. */
import { ICONS } from "./generated/icons"

/**
 * Trusted HTML. A lazy Raw renders on demand with its parent's flex direction (design nodes size
 * themselves against their parent); interpolated anywhere else it renders as a row child.
 */
export class Raw {
  constructor(
    private readonly html: string,
    readonly lazy?: (parent: "row" | "column" | "none") => string,
  ) {}
  get value(): string {
    return this.lazy ? this.lazy("row") : this.html
  }
  toString() {
    return this.value
  }
}

export const raw = (s: string) => new Raw(s)

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

type Value = string | number | Raw | null | undefined | false | Value[]

function render(v: Value): string {
  if (v === null || v === undefined || v === false) return ""
  if (v instanceof Raw) return v.value
  if (Array.isArray(v)) return v.map(render).join("")
  return esc(String(v))
}

/** Tagged template: `html\`<p>${text}</p>\`` → Raw. */
export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0] ?? ""
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "")
  })
  return new Raw(out)
}

/**
 * An icon node from the design, by its exact design icon name, drawn at the node's size. Color
 * comes from `currentColor` (the node's fill is set on the element by its class).
 */
export function icon(name: string, size: number, cls = ""): Raw {
  const def = ICONS[name]
  if (!def) throw new Error(`icon "${name}" is not in src/generated/icons.ts`)
  usedIcons.add(name)
  return raw(
    `<svg class="i${cls ? ` ${cls}` : ""}" data-icon="${name}" width="${size}" height="${size}" viewBox="${def.viewBox}" aria-hidden="true" focusable="false"><use href="/icons.svg#${name}"/></svg>`,
  )
}

/** Icons referenced so far; the build writes them as one cached sprite, /icons.svg. */
export const usedIcons = new Set<string>()

export function iconSprite(extra = ""): string {
  const symbols = [...usedIcons]
    .sort()
    .map((n) => {
      const d = ICONS[n] as { viewBox: string; body: string }
      return `<symbol id="${n}" viewBox="${d.viewBox}">${d.body}</symbol>`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg">${extra}${symbols}</svg>\n`
}

/** Inline style string from a record, skipping empty values. */
export function style(s: Record<string, string | number | undefined>): string {
  return Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
}
