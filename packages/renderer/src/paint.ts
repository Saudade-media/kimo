/**
 * `.kimo` Paint values (spec §7.1) → CanvasKit paints: solid colors, linear/radial/angular
 * gradients (sRGB or OKLab interpolation), image fills (cover/contain/stretch/tile), mesh
 * gradients (rasterized once per mesh and size) and GLSL shaders (SkSL runtime effects).
 */
import { isObject, isRef } from "@kimo/core-schema"
import type { Matrix, Resolver } from "@kimo/layout"
import type { Blender, BlendMode, CanvasKit, Image, Paint, Shader } from "canvaskit-wasm"
import { oklabToSrgb, parseColor, type RGBA, srgbToOklab, withAlpha } from "./color"
import { invert, multiply, toCk } from "./geometry"
import { uniformValue } from "./glsl"
import { tessellateMesh } from "./mesh"
import type { ShaderCache } from "./shader"
import type { AssetSource } from "./types"

export const BLEND_NAMES = [
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const

/**
 * Spec blend mode → Skia. Skia has no linear-burn mode: {@link applyBlend} draws it with an
 * SkSL blender; this mapping (multiply) is only the fallback when runtime effects are absent.
 */
export function blendMode(ck: CanvasKit, name: unknown): BlendMode {
  const B = ck.BlendMode
  switch (name) {
    case "darken":
      return B.Darken
    case "multiply":
    case "linear-burn":
      return B.Multiply
    case "color-burn":
      return B.ColorBurn
    case "lighten":
      return B.Lighten
    case "screen":
      return B.Screen
    case "color-dodge":
      return B.ColorDodge
    case "linear-dodge":
      return B.Plus
    case "overlay":
      return B.Overlay
    case "soft-light":
      return B.SoftLight
    case "hard-light":
      return B.HardLight
    case "difference":
      return B.Difference
    case "exclusion":
      return B.Exclusion
    case "hue":
      return B.Hue
    case "saturation":
      return B.Saturation
    case "color":
      return B.Color
    case "luminosity":
      return B.Luminosity
    default:
      return B.SrcOver
  }
}

/**
 * Linear burn ("Plus darker") as a premultiplied W3C separable blend:
 * `co = cs·(1−αb) + cb·(1−αs) + max(0, cs·αb + cb·αs − αs·αb)`, `αo = αs + αb − αs·αb`.
 */
const LINEAR_BURN_SKSL = `half4 main(half4 src, half4 dst) {
  half3 c = src.rgb * (1 - dst.a) + dst.rgb * (1 - src.a) +
    max(half3(0), src.rgb * dst.a + dst.rgb * src.a - half3(src.a * dst.a));
  return half4(c, src.a + dst.a - src.a * dst.a);
}`

const linearBurn = new WeakMap<CanvasKit, Blender | null>()
/** Live renderers per CanvasKit instance (the shared blender is freed with the last one). */
const blenderUsers = new WeakMap<CanvasKit, number>()

/** The linear-burn blender (shared per CanvasKit instance), or null without runtime effects. */
export function linearBurnBlender(ck: CanvasKit): Blender | null {
  if (linearBurn.has(ck)) return linearBurn.get(ck) ?? null
  let b: Blender | null = null
  try {
    const fx = ck.RuntimeEffect?.MakeForBlender(LINEAR_BURN_SKSL)
    if (fx) {
      try {
        b = fx.makeBlender([])
      } finally {
        // The blender keeps its own reference to the compiled effect.
        fx.delete()
      }
    }
  } catch {
    b = null
  }
  linearBurn.set(ck, b)
  return b
}

/** A renderer starts using `ck`'s shared blenders (pair with {@link releaseBlenders}). */
export function retainBlenders(ck: CanvasKit): void {
  blenderUsers.set(ck, (blenderUsers.get(ck) ?? 0) + 1)
}

/** A renderer stops using `ck`; the last one frees the shared blenders. */
export function releaseBlenders(ck: CanvasKit): void {
  const n = (blenderUsers.get(ck) ?? 1) - 1
  if (n > 0) {
    blenderUsers.set(ck, n)
    return
  }
  blenderUsers.delete(ck)
  linearBurn.get(ck)?.delete()
  linearBurn.delete(ck)
}

/** True for a blend that differs from source-over (`pass-through` counts as normal). */
export const isNonNormalBlend = (name: unknown): boolean =>
  typeof name === "string" && name !== "normal" && name !== "pass-through"

/** Sets `name`'s blend on `paint` (blender for linear-burn, else a Skia blend mode). */
export function applyBlend(ck: CanvasKit, paint: Paint, name: unknown): void {
  if (!isNonNormalBlend(name)) return
  if (name === "linear-burn") {
    const b = linearBurnBlender(ck)
    if (b) {
      paint.setBlender(b)
      return
    }
  }
  paint.setBlendMode(blendMode(ck, name))
}

const TRANSLATE = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const SCALE = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0]
const ROTATE = (deg: number): Matrix => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}

// --- Images -------------------------------------------------------------------------------

type ImageState = { status: "loading" } | { status: "ready"; image: Image } | { status: "missing" }

/** Decoded image assets, loaded once per `src`. */
export class ImageCache {
  private readonly images = new Map<string, ImageState>()
  private readonly waiting = new Map<string, Promise<void>>()
  /** Loading when a retry came: asked again if they end missing (the bytes may be newer). */
  private readonly again = new Set<string>()
  private checker: Shader | null = null
  /** Bumped by `clear()`: loads started before it drop their result. */
  private generation = 0

  constructor(
    private readonly ck: CanvasKit,
    private readonly onLoad: (src: string) => void,
  ) {}

  assets: AssetSource | null = null

  get(src: string): ImageState {
    const s = this.images.get(src)
    if (s) return s
    void this.load(src)
    return this.images.get(src) ?? { status: "loading" }
  }

  /**
   * Loads `src`. A `retry` of a missing image keeps the checkerboard while it asks again and
   * calls `onLoad` only when the image loads now.
   */
  load(src: string, retry = false): Promise<void> {
    const w = this.waiting.get(src)
    if (w) return w
    if (this.images.get(src)?.status === "ready") return Promise.resolve()
    if (!retry) this.images.set(src, { status: "loading" })
    const gen = this.generation
    const p = (async () => {
      let state: ImageState = { status: "missing" }
      try {
        const bytes = this.assets ? await this.assets.load(src) : null
        // Cleared (document switch, dispose) while loading: nothing owns this entry any more.
        if (gen !== this.generation) return
        const image = bytes ? this.ck.MakeImageFromEncoded(bytes) : null
        if (image) state = { status: "ready", image }
      } catch {
        // missing → checkerboard
      }
      if (gen !== this.generation) {
        if (state.status === "ready") state.image.delete()
        return
      }
      this.images.set(src, state)
      this.waiting.delete(src)
      if (!retry || state.status === "ready") this.onLoad(src)
      if (this.again.delete(src) && state.status === "missing") void this.load(src, true)
    })()
    this.waiting.set(src, p)
    return p
  }

  /** Asks again for every image drawn as missing (its bytes may have arrived since). */
  retryMissing(): void {
    for (const [src, s] of this.images)
      if (this.waiting.has(src)) this.again.add(src)
      else if (s.status === "missing") void this.load(src, true)
  }

  /** Checkerboard shader for missing assets (spec: drawn as a checkerboard). */
  checkerboard(): Shader {
    if (this.checker) return this.checker
    const ck = this.ck
    const surface = ck.MakeSurface(16, 16)
    if (!surface) return ck.Shader.MakeColor(ck.Color4f(0.85, 0.85, 0.85, 1), ck.ColorSpace.SRGB)
    const c = surface.getCanvas()
    const p = new ck.Paint()
    c.clear(ck.Color4f(1, 1, 1, 1))
    p.setColor(ck.Color4f(0.8, 0.8, 0.8, 1))
    c.drawRect(ck.XYWHRect(0, 0, 8, 8), p)
    c.drawRect(ck.XYWHRect(8, 8, 8, 8), p)
    p.delete()
    const img = surface.makeImageSnapshot()
    surface.delete()
    this.checker = img.makeShaderOptions(
      ck.TileMode.Repeat,
      ck.TileMode.Repeat,
      ck.FilterMode.Nearest,
      ck.MipmapMode.None,
    )
    img.delete()
    return this.checker
  }

  clear(): void {
    this.generation++
    for (const s of this.images.values()) if (s.status === "ready") s.image.delete()
    this.images.clear()
    this.waiting.clear()
    this.again.clear()
    this.checker?.delete()
    this.checker = null
  }
}

// --- Paints -------------------------------------------------------------------------------

/** Normalizes `fill` / `stroke.paint` to a list (absent → null, `[]` → []). */
export function paintList(value: unknown): unknown[] | null {
  if (value === undefined || value === null) return null
  return Array.isArray(value) ? value : [value]
}

/** Image srcs referenced by a paint list (for preloading before export). */
export function imageSources(value: unknown): string[] {
  const list = paintList(value) ?? []
  return list.flatMap((p) =>
    isObject(p) && p.kind === "image" && typeof p.src === "string" ? [p.src] : [],
  )
}

/** Shader srcs referenced by a paint list (for preloading before export). */
export function shaderSources(value: unknown): string[] {
  const list = paintList(value) ?? []
  return list.flatMap((p) =>
    isObject(p) && p.kind === "shader" && typeof p.src === "string" ? [p.src] : [],
  )
}

/** Mesh rasters kept (least recently made go first). */
const MESH_MAX = 256
/** Largest mesh raster side (px): mesh gradients are smooth, so they upscale cleanly. */
const MESH_MAX_SIDE = 512

export class PaintFactory {
  constructor(
    private readonly ck: CanvasKit,
    private readonly images: ImageCache,
    private readonly shaders: ShaderCache | null = null,
  ) {}

  /** Seconds on the shader clock (`@time`); 0 for static output (pictures, exports). */
  time = 0
  /**
   * Shader paints made, and those reading `@time` (monotonic: the renderer compares them
   * around a recording to know which roots hold shaders).
   */
  readonly usage = { shaders: 0, timed: 0 }
  /** Mesh rasters by mesh, resolved colors and raster size. */
  private readonly meshes = new Map<string, Image | null>()

  /** Frees the mesh rasters. */
  clear(): void {
    for (const img of this.meshes.values()) img?.delete()
    this.meshes.clear()
  }

  color(c: RGBA): Float32Array {
    return this.ck.Color4f(c[0], c[1], c[2], c[3])
  }

  /** Resolves a Color value (literal or binding) to sRGB. */
  resolveColor(resolve: Resolver, nodeId: string, value: unknown): RGBA | null {
    return parseColor(isRef(value) ? resolve.value(nodeId, value) : value)
  }

  private num(resolve: Resolver, nodeId: string, v: unknown, d: number): number {
    const r = isRef(v) ? resolve.value(nodeId, v) : v
    return typeof r === "number" && Number.isFinite(r) ? r : d
  }

  /** One CanvasKit fill paint per visible paint (in order), or [] for none. Caller deletes. */
  paints(resolve: Resolver, nodeId: string, value: unknown, w: number, h: number): Paint[] {
    const list = paintList(value)
    if (!list) return []
    const out: Paint[] = []
    for (const p of list) {
      const paint = this.one(resolve, nodeId, p, w, h)
      if (paint) out.push(paint)
    }
    return out
  }

  /** A single paint, or null when invisible/unsupported. */
  one(resolve: Resolver, nodeId: string, p: unknown, w: number, h: number): Paint | null {
    const ck = this.ck
    const v = isRef(p) ? resolve.value(nodeId, p) : p
    if (!isObject(v) || !("kind" in v)) {
      const c = parseColor(v)
      if (!c) return null
      const paint = new ck.Paint()
      paint.setAntiAlias(true)
      paint.setColor(this.color(c))
      return paint
    }
    if (v.visible === false) return null
    const paint = new ck.Paint()
    paint.setAntiAlias(true)
    applyBlend(ck, paint, v.blend)
    switch (v.kind) {
      case "solid": {
        const c = this.resolveColor(resolve, nodeId, v.color)
        if (!c) break
        paint.setColor(this.color(c))
        return paint
      }
      case "linear":
      case "radial":
      case "angular": {
        const shader = this.gradient(resolve, nodeId, v, w, h)
        if (!shader) break
        paint.setShader(shader)
        shader.delete()
        return paint
      }
      case "image": {
        const shader = this.image(v, w, h)
        if (!shader) break
        paint.setShader(shader)
        if (shader !== this.images.checkerboard()) shader.delete()
        paint.setAlphaf(Math.max(0, Math.min(1, this.num(resolve, nodeId, v.opacity, 1))))
        return paint
      }
      case "mesh": {
        const shader = this.mesh(resolve, nodeId, v, w, h)
        if (!shader) break
        paint.setShader(shader)
        shader.delete()
        return paint
      }
      case "shader": {
        const shader = this.shader(resolve, nodeId, v, w, h)
        if (!shader) break
        paint.setShader(shader)
        shader.delete()
        return paint
      }
    }
    // Malformed, still loading, or a shader that does not compile: nothing drawn.
    paint.delete()
    return null
  }

  /**
   * A mesh paint as an image shader over the box: the Coons-patch mesh is drawn as colored
   * triangles into a raster of about 2 px per box unit (capped), cached per mesh and size.
   */
  private mesh(
    resolve: Resolver,
    nodeId: string,
    m: Record<string, unknown>,
    w: number,
    h: number,
  ): Shader | null {
    const ck = this.ck
    const cols = typeof m.cols === "number" ? Math.floor(m.cols) : 0
    const rows = typeof m.rows === "number" ? Math.floor(m.rows) : 0
    if (cols < 1 || rows < 1 || w <= 0 || h <= 0 || cols * rows > 4096) return null
    if (!Array.isArray(m.colors) || m.colors.length < cols * rows) return null
    const colors: RGBA[] = []
    for (let i = 0; i < cols * rows; i++)
      colors.push(this.resolveColor(resolve, nodeId, m.colors[i]) ?? [0, 0, 0, 0])
    const points = Array.isArray(m.points) ? m.points : []
    const W = Math.max(4, Math.min(MESH_MAX_SIDE, Math.ceil(w * 2)))
    const H = Math.max(4, Math.min(MESH_MAX_SIDE, Math.ceil(h * 2)))
    const key = JSON.stringify([cols, rows, colors, points, W, H])
    let img = this.meshes.get(key)
    if (img === undefined) {
      img = this.rasterizeMesh(cols, rows, points, colors, W, H)
      if (this.meshes.size >= MESH_MAX) {
        const first = this.meshes.keys().next().value as string
        this.meshes.get(first)?.delete()
        this.meshes.delete(first)
      }
      this.meshes.set(key, img)
    } else {
      // Most recently used last.
      this.meshes.delete(key)
      this.meshes.set(key, img)
    }
    if (!img) return null
    return img.makeShaderOptions(
      ck.TileMode.Clamp,
      ck.TileMode.Clamp,
      ck.FilterMode.Linear,
      ck.MipmapMode.None,
      toCk(SCALE(w / W, h / H)),
    )
  }

  private rasterizeMesh(
    cols: number,
    rows: number,
    points: readonly unknown[],
    colors: RGBA[],
    W: number,
    H: number,
  ): Image | null {
    const ck = this.ck
    const tri = tessellateMesh(cols, rows, points, colors)
    if (tri.positions.length / 2 > 65535) return null
    const pos = new Float32Array(tri.positions.length)
    for (let i = 0; i < pos.length; i += 2) {
      pos[i] = (tri.positions[i] as number) * W
      pos[i + 1] = (tri.positions[i + 1] as number) * H
    }
    const surface = ck.MakeSurface(W, H)
    if (!surface) return null
    const vertices = ck.MakeVertices(
      ck.VertexMode.Triangles,
      pos,
      null,
      tri.colors,
      Array.from(tri.indices),
      false,
    )
    const p = new ck.Paint()
    try {
      const c = surface.getCanvas()
      c.clear(ck.TRANSPARENT)
      // Vertex colors only (the paint has no shader): `Dst` keeps the interpolated colors.
      c.drawVertices(vertices, ck.BlendMode.Dst, p)
      surface.flush()
      return surface.makeImageSnapshot()
    } finally {
      p.delete()
      vertices.delete()
      surface.delete()
    }
  }

  /**
   * A shader paint: the GLSL fragment shader at `src` (once loaded and compiled) as a runtime
   * effect shader over the box, with its uniforms from the paint, `@default`s and the
   * renderer's clock.
   */
  private shader(
    resolve: Resolver,
    nodeId: string,
    v: Record<string, unknown>,
    w: number,
    h: number,
  ): Shader | null {
    if (!this.shaders || typeof v.src !== "string" || w <= 0 || h <= 0) return null
    const state = this.shaders.get(v.src)
    if (state.status !== "ready") return null
    const sh = state.shader
    const overrides = isObject(v.uniforms) ? v.uniforms : {}
    const data = new Float32Array(sh.floats)
    const put = (name: string, vals: readonly number[]) => {
      const slot = sh.slots.get(name)
      if (!slot) return
      for (let i = 0; i < slot.size && i < vals.length; i++) data[slot.slot + i] = vals[i] as number
    }
    put("_k_size", [w, h])
    const ctx = {
      resolution: [w, h] as const,
      time: this.time,
      resolve: (x: unknown) => resolve.value(nodeId, x as never),
      color: (x: unknown) => parseColor(x),
    }
    for (const u of sh.uniforms) put(u.name, uniformValue(u, overrides[u.name], ctx))
    this.usage.shaders++
    if (sh.timed) this.usage.timed++
    return sh.effect.makeShader(data)
  }

  private gradient(
    resolve: Resolver,
    nodeId: string,
    g: Record<string, unknown>,
    w: number,
    h: number,
  ): Shader | null {
    const ck = this.ck
    const opacity = Math.max(0, Math.min(1, this.num(resolve, nodeId, g.opacity, 1)))
    const stops: { at: number; c: RGBA }[] = []
    if (!Array.isArray(g.stops)) return null
    for (const s of g.stops) {
      if (!isObject(s)) continue
      const c = this.resolveColor(resolve, nodeId, s.color)
      const at = typeof s.at === "number" ? Math.max(0, Math.min(1, s.at)) : 0
      if (c) stops.push({ at, c: withAlpha(c, opacity) })
    }
    if (stops.length < 2) return null
    stops.sort((a, b) => a.at - b.at)
    const expanded = g.interpolation === "oklab" ? expandOklab(stops) : stops
    const colors = expanded.map((s) => this.color(s.c))
    const pos = expanded.map((s) => s.at)
    const center = Array.isArray(g.center) ? g.center : [0.5, 0.5]
    const size = Array.isArray(g.size) ? g.size : [1, 1]
    const cx = typeof center[0] === "number" ? center[0] : 0.5
    const cy = typeof center[1] === "number" ? center[1] : 0.5
    const sx = typeof size[0] === "number" ? size[0] : 1
    const sy = typeof size[1] === "number" ? size[1] : 1
    const rot = typeof g.rotation === "number" ? g.rotation : 0
    const box = SCALE(w, h)
    if (g.kind === "linear") {
      // rotation: degrees CCW, 0 = up (stop 0 at the bottom, 1 at the top); length = size[1].
      const r = (rot * Math.PI) / 180
      const dx = -Math.sin(r) * (sy / 2)
      const dy = -Math.cos(r) * (sy / 2)
      return ck.Shader.MakeLinearGradient(
        [cx - dx, cy - dy],
        [cx + dx, cy + dy],
        colors,
        pos,
        ck.TileMode.Clamp,
        toCk(box),
      )
    }
    const local = multiply(
      box,
      multiply(TRANSLATE(cx, cy), multiply(ROTATE(-rot), SCALE(sx / 2, sy / 2))),
    )
    if (g.kind === "radial")
      return ck.Shader.MakeRadialGradient([0, 0], 1, colors, pos, ck.TileMode.Clamp, toCk(local))
    // angular: starts pointing up and sweeps clockwise.
    return ck.Shader.MakeSweepGradient(
      0,
      0,
      colors,
      pos,
      ck.TileMode.Clamp,
      toCk(multiply(local, ROTATE(-90))),
    )
  }

  private image(v: Record<string, unknown>, w: number, h: number): Shader | null {
    const ck = this.ck
    if (typeof v.src !== "string") return null
    const state = this.images.get(v.src)
    if (state.status === "loading") return null
    if (state.status === "missing") return this.images.checkerboard()
    const img = state.image
    const iw = img.width()
    const ih = img.height()
    if (iw <= 0 || ih <= 0 || w <= 0 || h <= 0) return null
    let m: Matrix
    let tile = ck.TileMode.Clamp
    const crop = cropMatrix(v.crop)
    if (crop) {
      // `crop` maps the paint box (normalized) to the image (normalized), like Figma's
      // imageTransform; the shader needs image px → box px: S(w,h)·crop⁻¹·S(1/iw,1/ih).
      const inv = invert(crop)
      if (!inv) return null
      m = multiply(SCALE(w, h), multiply(inv, SCALE(1 / iw, 1 / ih)))
      // Clamp: a crop that ends exactly on the image edge must not fade into transparency.
      return img.makeShaderOptions(
        ck.TileMode.Clamp,
        ck.TileMode.Clamp,
        ck.FilterMode.Linear,
        ck.MipmapMode.Linear,
        toCk(m),
      )
    }
    switch (v.fit) {
      // Board 27 §6 (d): fit "crop" without a `crop` affine = the identity (the whole image).
      case "crop":
      case "stretch":
        m = SCALE(w / iw, h / ih)
        break
      case "contain": {
        const s = Math.min(w / iw, h / ih)
        m = multiply(TRANSLATE((w - iw * s) / 2, (h - ih * s) / 2), SCALE(s, s))
        tile = ck.TileMode.Decal
        break
      }
      case "tile":
        m = [1, 0, 0, 1, 0, 0]
        tile = ck.TileMode.Repeat
        break
      default: {
        const s = Math.max(w / iw, h / ih)
        m = multiply(TRANSLATE((w - iw * s) / 2, (h - ih * s) / 2), SCALE(s, s))
      }
    }
    return img.makeShaderOptions(tile, tile, ck.FilterMode.Linear, ck.MipmapMode.Linear, toCk(m))
  }
}

/** A valid `crop` affine `[a, b, c, d, tx, ty]`, or null. */
function cropMatrix(v: unknown): Matrix | null {
  if (!Array.isArray(v) || v.length !== 6) return null
  if (!v.every((x) => typeof x === "number" && Number.isFinite(x))) return null
  return v as unknown as Matrix
}

/** Inserts intermediate stops so Skia's sRGB interpolation approximates OKLab. */
function expandOklab(stops: { at: number; c: RGBA }[]): { at: number; c: RGBA }[] {
  const out: { at: number; c: RGBA }[] = []
  const N = 8
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i] as { at: number; c: RGBA }
    const b = stops[i + 1] as { at: number; c: RGBA }
    const la = srgbToOklab(a.c)
    const lb = srgbToOklab(b.c)
    for (let k = 0; k < N; k++) {
      const t = k / N
      const [r, g, bl] = oklabToSrgb(
        la[0] + (lb[0] - la[0]) * t,
        la[1] + (lb[1] - la[1]) * t,
        la[2] + (lb[2] - la[2]) * t,
      )
      out.push({ at: a.at + (b.at - a.at) * t, c: [r, g, bl, a.c[3] + (b.c[3] - a.c[3]) * t] })
    }
  }
  out.push(stops[stops.length - 1] as { at: number; c: RGBA })
  return out
}
