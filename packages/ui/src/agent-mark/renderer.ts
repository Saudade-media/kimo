/**
 * The shared AgentMark body renderer. Every mark on screen shares ONE WebGL context: a detached
 * canvas renders each animated mark's body with the flat liquid shader (`shaders/agent-liquid.glsl`)
 * at the mark's device-pixel size, and the frame is copied into the mark's own 2D canvas. One
 * requestAnimationFrame loop runs only while at least one animated mark is visible.
 *
 * Static path (board 24 rule "≤12px … No WebGL or prefers-reduced-motion"): the AgentMark/32/Static
 * body (gmdHy), a flat 3 × 3 mesh gradient `u_c4 · $agent · $agent-2 / $agent · $agent · $agent-2 /
 * $agent-2 · $agent-2 · u_c1`, drawn once per size / colors into the mark's 2D canvas, no GPU.
 */
import { DONE_EASE_MS, EDGE_SOFT_PX, type Motion } from "./faces"
import { AGENT_LIQUID_GLSL } from "./shader"

export type Rgb = readonly [number, number, number]

/** u_c1 (ink), u_c2 ($agent-2), u_c3 ($agent), u_c4 (highlight) as 0..1 RGB. */
export interface MarkColors {
  c1: Rgb
  c2: Rgb
  c3: Rgb
  c4: Rgb
}

export interface MarkHandle {
  canvas: HTMLCanvasElement
  /** CSS px. */
  size: number
  /** Resolved colors (re-read on theme change via {@link MarkHandle.resolveColors}). */
  resolveColors(): MarkColors
  /** Current motion target. */
  motion(): Motion
  /** True: never animate (12 px marks, export / snapshot). */
  forceStatic: boolean
}

interface Entry {
  handle: MarkHandle
  colors: MarkColors | null
  phase: number
  speed: number
  rampFrom: number
  rampAt: number
  target: number
  visible: boolean
  staticKey: string
  observer?: IntersectionObserver
}

const VERTEX = `attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

const entries = new Set<Entry>()
let gl: WebGLRenderingContext | null = null
let glCanvas: HTMLCanvasElement | null = null
let glFailed = false
let program: WebGLProgram | null = null
let uniforms: Record<string, WebGLUniformLocation | null> = {}
let raf = 0
let lastTime = 0
let contextsCreated = 0
let framesRendered = 0
let reduceMotion = false
let themeWatch: (() => void) | null = null

function hasDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function watchEnvironment() {
  if (themeWatch || !hasDom()) return
  const rm = window.matchMedia?.("(prefers-reduced-motion: reduce)")
  reduceMotion = !!rm?.matches
  const onRm = () => {
    reduceMotion = !!rm?.matches
    invalidateAll()
  }
  rm?.addEventListener?.("change", onRm)
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)")
  const onTheme = () => invalidateAll()
  dark?.addEventListener?.("change", onTheme)
  const mo =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(onTheme)
      : (null as MutationObserver | null)
  mo?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
    subtree: false,
  })
  const onVis = () => schedule()
  document.addEventListener("visibilitychange", onVis)
  themeWatch = () => {
    rm?.removeEventListener?.("change", onRm)
    dark?.removeEventListener?.("change", onTheme)
    mo?.disconnect()
    document.removeEventListener("visibilitychange", onVis)
  }
}

/** Re-resolves colors (theme change) and redraws static bodies. */
export function invalidateAll(): void {
  for (const e of entries) {
    e.colors = null
    e.staticKey = ""
  }
  for (const e of entries) drawIfStatic(e)
  schedule()
}

function isStatic(e: Entry): boolean {
  return e.handle.forceStatic || reduceMotion || glFailed || !ensureGl()
}

function ensureGl(): boolean {
  if (gl) return true
  if (glFailed || !hasDom()) return false
  try {
    glCanvas = document.createElement("canvas")
    glCanvas.width = 64
    glCanvas.height = 64
    const ctx = glCanvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: false,
      stencil: false,
    })
    if (!ctx) throw new Error("no webgl")
    gl = ctx
    contextsCreated++
    const vs = compile(ctx, ctx.VERTEX_SHADER, VERTEX)
    const fs = compile(ctx, ctx.FRAGMENT_SHADER, AGENT_LIQUID_GLSL)
    const p = ctx.createProgram()
    if (!p) throw new Error("program")
    ctx.attachShader(p, vs)
    ctx.attachShader(p, fs)
    ctx.linkProgram(p)
    if (!ctx.getProgramParameter(p, ctx.LINK_STATUS))
      throw new Error(ctx.getProgramInfoLog(p) ?? "link")
    program = p
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL useProgram, not a React hook.
    ctx.useProgram(p)
    const buf = ctx.createBuffer()
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf)
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      ctx.STATIC_DRAW,
    )
    const loc = ctx.getAttribLocation(p, "a_pos")
    ctx.enableVertexAttribArray(loc)
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0)
    uniforms = {}
    for (const u of [
      "u_resolution",
      "u_time",
      "u_speed",
      "u_turbulence",
      "u_gloss",
      "u_soft",
      "u_c1",
      "u_c2",
      "u_c3",
      "u_c4",
    ])
      uniforms[u] = ctx.getUniformLocation(p, u)
    glCanvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault()
      gl = null
      glFailed = true
      invalidateAll()
    })
    return true
  } catch {
    gl = null
    glFailed = true
    return false
  }
}

function compile(ctx: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = ctx.createShader(type)
  if (!s) throw new Error("shader")
  ctx.shaderSource(s, src)
  ctx.compileShader(s)
  if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS))
    throw new Error(ctx.getShaderInfoLog(s) ?? "compile")
  return s
}

function dpr(): number {
  return hasDom() ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1
}

function sizeCanvas(e: Entry): number {
  const px = Math.max(1, Math.round(e.handle.size * dpr()))
  if (e.handle.canvas.width !== px) e.handle.canvas.width = px
  if (e.handle.canvas.height !== px) e.handle.canvas.height = px
  return px
}

function colorsOf(e: Entry): MarkColors {
  e.colors ??= e.handle.resolveColors()
  return e.colors
}

/** Draws the static mesh body when this mark is static (cached by size + colors). */
function drawIfStatic(e: Entry): boolean {
  if (!isStatic(e)) return false
  const px = sizeCanvas(e)
  const c = colorsOf(e)
  const key = `${px}|${[c.c1, c.c2, c.c3, c.c4].map((v) => v.join(",")).join("|")}`
  if (key === e.staticKey) return true
  e.staticKey = key
  const ctx = e.handle.canvas.getContext("2d")
  if (!ctx) return true
  ctx.putImageData(meshImage(ctx, px, c), 0, 0)
  return true
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/** Bilinear 3 × 3 mesh (points at 0, .5, 1) clipped to a circle with a 0.6 px edge. */
export function meshPixels(px: number, c: MarkColors): Uint8ClampedArray {
  const grid: Rgb[][] = [
    [c.c4, c.c3, c.c2],
    [c.c3, c.c3, c.c2],
    [c.c2, c.c2, c.c1],
  ]
  const out = new Uint8ClampedArray(px * px * 4)
  const soft = Math.max(EDGE_SOFT_PX * dpr(), 0.35)
  for (let y = 0; y < px; y++) {
    const v = ((y + 0.5) / px) * 2
    const j = Math.min(1, Math.floor(v))
    const ty = v - j
    for (let x = 0; x < px; x++) {
      const u = ((x + 0.5) / px) * 2
      const i = Math.min(1, Math.floor(u))
      const tx = u - i
      const row = grid[j] as Rgb[]
      const next = grid[j + 1] as Rgb[]
      const top = mix(row[i] as Rgb, row[i + 1] as Rgb, tx)
      const bottom = mix(next[i] as Rgb, next[i + 1] as Rgb, tx)
      const col = mix(top, bottom, ty)
      const dx = x + 0.5 - px / 2
      const dy = y + 0.5 - px / 2
      const r = Math.sqrt(dx * dx + dy * dy)
      const a = Math.max(0, Math.min(1, (px / 2 - r) / soft))
      const o = (y * px + x) * 4
      out[o] = Math.round(col[0] * 255)
      out[o + 1] = Math.round(col[1] * 255)
      out[o + 2] = Math.round(col[2] * 255)
      out[o + 3] = Math.round(a * 255)
    }
  }
  return out
}

function meshImage(ctx: CanvasRenderingContext2D, px: number, c: MarkColors): ImageData {
  const img = ctx.createImageData(px, px)
  img.data.set(meshPixels(px, c))
  return img
}

function animated(e: Entry): boolean {
  return !isStatic(e) && e.visible
}

function schedule() {
  if (raf || !hasDom()) return
  if (document.visibilityState === "hidden") return
  for (const e of entries)
    if (animated(e)) {
      lastTime = performance.now()
      raf = requestAnimationFrame(frame)
      return
    }
}

function frame(now: number) {
  raf = 0
  const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000))
  lastTime = now
  let any = false
  for (const e of entries) {
    if (drawIfStatic(e)) continue
    if (!e.visible) continue
    any = true
    step(e, now, dt)
    renderBody(e)
  }
  if (any && document.visibilityState !== "hidden") raf = requestAnimationFrame(frame)
}

function step(e: Entry, now: number, dt: number) {
  const m = e.handle.motion()
  if (m.speed !== e.target) {
    e.rampFrom = e.speed
    e.rampAt = now
    e.target = m.speed
  }
  // Freezing (error / paused) is immediate; other changes ease over DONE_EASE_MS.
  if (e.target === 0) e.speed = 0
  else {
    const k = Math.min(1, (now - e.rampAt) / DONE_EASE_MS)
    e.speed = e.rampFrom + (e.target - e.rampFrom) * k
  }
  e.phase += dt * e.speed
}

function renderBody(e: Entry) {
  if (!gl || !glCanvas || !program) return
  const px = sizeCanvas(e)
  if (glCanvas.width < px || glCanvas.height < px) {
    glCanvas.width = Math.max(glCanvas.width, px)
    glCanvas.height = Math.max(glCanvas.height, px)
  }
  const c = colorsOf(e)
  const m = e.handle.motion()
  gl.viewport(0, 0, px, px)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.uniform2f(uniforms.u_resolution ?? null, px, px)
  // Phase is integrated per mark (speed changes never jump): u_time · u_speed = phase.
  gl.uniform1f(uniforms.u_time ?? null, e.phase)
  gl.uniform1f(uniforms.u_speed ?? null, 1)
  gl.uniform1f(uniforms.u_turbulence ?? null, m.turbulence)
  gl.uniform1f(uniforms.u_gloss ?? null, 0)
  gl.uniform1f(uniforms.u_soft ?? null, EDGE_SOFT_PX * dpr())
  gl.uniform3fv(uniforms.u_c1 ?? null, [...c.c1])
  gl.uniform3fv(uniforms.u_c2 ?? null, [...c.c2])
  gl.uniform3fv(uniforms.u_c3 ?? null, [...c.c3])
  gl.uniform3fv(uniforms.u_c4 ?? null, [...c.c4])
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  const ctx = e.handle.canvas.getContext("2d")
  if (!ctx) return
  ctx.clearRect(0, 0, px, px)
  // GL's origin is bottom-left: the tile sits at the bottom of the shared canvas.
  ctx.drawImage(glCanvas, 0, glCanvas.height - px, px, px, 0, 0, px, px)
  framesRendered++
}

/** Registers a mark; returns its unregister function. */
export function registerMark(handle: MarkHandle): { update(): void; dispose(): void } {
  watchEnvironment()
  const e: Entry = {
    handle,
    colors: null,
    phase: 0,
    speed: handle.motion().speed,
    rampFrom: handle.motion().speed,
    rampAt: 0,
    target: handle.motion().speed,
    visible: true,
    staticKey: "",
  }
  entries.add(e)
  if (typeof IntersectionObserver !== "undefined") {
    e.observer = new IntersectionObserver((list) => {
      const last = list[list.length - 1]
      if (!last) return
      e.visible = last.isIntersecting
      schedule()
    })
    e.observer.observe(handle.canvas)
  }
  if (!drawIfStatic(e)) {
    // First frame right away so a new mark never shows an empty body.
    renderBody(e)
    schedule()
  }
  return {
    update() {
      e.colors = null
      e.staticKey = ""
      if (!drawIfStatic(e)) {
        renderBody(e)
        schedule()
      }
    },
    dispose() {
      e.observer?.disconnect()
      entries.delete(e)
      if (entries.size === 0 && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    },
  }
}

/** Renderer facts for tests and the e2e measured pass. */
export function agentMarkRendererStats(): {
  marks: number
  animated: number
  contexts: number
  frames: number
  webgl: boolean
  reducedMotion: boolean
} {
  let n = 0
  for (const e of entries) if (animated(e)) n++
  return {
    marks: entries.size,
    animated: n,
    contexts: contextsCreated,
    frames: framesRendered,
    webgl: !!gl,
    reducedMotion: reduceMotion,
  }
}

/** "#0093A3" / "rgb(0, 147, 163)" → 0..1 RGB (null when unparseable). */
export function parseColor(value: string): Rgb | null {
  const v = value.trim()
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v)
  if (m) {
    const h = m[1] as string
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb
  }
  m = /^#([0-9a-f]{3})$/i.exec(v)
  if (m) {
    const h = m[1] as string
    return [0, 1, 2].map((i) => parseInt(h[i]?.repeat(2) ?? "0", 16) / 255) as unknown as Rgb
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v)
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
  return null
}
