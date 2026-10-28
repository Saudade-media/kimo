/**
 * Draw-side icon cache: wraps any {@link IconProvider}, starts loads on first use, remembers
 * which glyphs turned out missing, and keeps the CanvasKit paths of each glyph (and of each
 * approximated Material weight) until `clear()`.
 */
import type { CanvasKit, Path } from "canvaskit-wasm"
import type { StrokeGeometry } from "../stroke"
import type { IconGlyph, IconProvider } from "../types"
import { dataWeight, materialOffset, materialWeight } from "./sets"

type IconLookup =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; glyph: IconGlyph; paths: readonly Path[] }

export class IconRegistry {
  private readonly missing = new Set<string>()
  private readonly requested = new Set<string>()
  private readonly paths = new Map<string, Path[]>()
  private generation = 0

  constructor(
    private readonly ck: CanvasKit,
    readonly provider: IconProvider,
    private readonly strokes: StrokeGeometry,
  ) {}

  private key(set: string, name: string, weight: number | undefined): string {
    return `${set}\u0000${name}\u0000${dataWeight(set, weight) ?? ""}`
  }

  /** Synchronous lookup for drawing; kicks off a load the first time. */
  lookup(set: string, name: string, weight: number | undefined): IconLookup {
    const k = this.key(set, name, weight)
    if (this.missing.has(k)) return { status: "missing" }
    const glyph = this.provider.get(set, name, weight)
    if (!glyph) {
      if (!this.requested.has(k)) {
        this.requested.add(k)
        const gen = this.generation
        void this.provider
          .load(set, name, weight)
          .catch(() => null)
          .then((g) => {
            if (gen === this.generation && !g && this.isMissing(set, name, weight))
              this.missing.add(k)
          })
      }
      return { status: "loading" }
    }
    const offset = set.startsWith("material-") ? materialOffset(materialWeight(weight)) : 0
    const pk = `${k}\u0000${offset}`
    let paths = this.paths.get(pk)
    if (!paths) {
      paths = []
      for (const p of glyph.paths) {
        const raw = this.ck.Path.MakeFromSVGString(p.d)
        if (!raw) {
          paths.push(new this.ck.Path())
          continue
        }
        raw.setFillType(
          p.fillRule === "evenodd" ? this.ck.FillType.EvenOdd : this.ck.FillType.Winding,
        )
        if (offset !== 0 && p.paint === "fill") {
          const join = set === "material-rounded" ? "round" : "miter"
          paths.push(this.strokes.offset(raw, offset, join))
          raw.delete()
        } else paths.push(raw)
      }
      this.paths.set(pk, paths)
    }
    return { status: "ready", glyph, paths }
  }

  /** Loads every glyph a subtree needs (export). */
  async ensure(list: Iterable<[string, string, number | undefined]>): Promise<void> {
    await Promise.all(
      [...list].map(async ([set, name, weight]) => {
        const g = await this.provider.load(set, name, weight).catch(() => null)
        if (!g && this.isMissing(set, name, weight)) this.missing.add(this.key(set, name, weight))
      }),
    )
  }

  /**
   * A null load is final only when the glyph is not in its set. A failed load (network) stays
   * "loading": the provider retries and its `onIconLoaded` redraws the pictures that skipped it.
   */
  private isMissing(set: string, name: string, weight: number | undefined): boolean {
    const st = this.provider.status?.(set, name, weight)
    return st === undefined || st === "missing"
  }

  clear(): void {
    this.generation++
    for (const list of this.paths.values()) for (const p of list) p.delete()
    this.paths.clear()
    this.missing.clear()
    this.requested.clear()
  }
}
