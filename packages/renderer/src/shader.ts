/**
 * Shader paint sources (spec §7.1 `kind: "shader"`): `src` is a path relative to the `.kimo`
 * file, read through the scene's {@link AssetSource} as UTF-8 text, transpiled from GLSL ES
 * 1.00 to SkSL ({@link transpileGlsl}) and compiled once per source text. A shader that fails
 * to load or compile draws nothing and is reported once (`console.warn`).
 */
import type { CanvasKit, RuntimeEffect } from "canvaskit-wasm"
import { GlslError, transpileGlsl, type UniformDecl } from "./glsl"
import type { AssetSource } from "./types"

/** A compiled shader: its effect and where each uniform lives in the effect's float block. */
export interface CompiledShader {
  effect: RuntimeEffect
  uniforms: UniformDecl[]
  /** Uniform name (the GLSL name; carriers of int/bool uniforms map back) → float slot. */
  slots: Map<string, { slot: number; size: number }>
  floats: number
  timed: boolean
}

export type ShaderState =
  | { status: "loading" }
  | { status: "ready"; shader: CompiledShader }
  | { status: "failed"; reason: string }

/** Shader sources and compiled effects, per renderer. */
export class ShaderCache {
  private readonly states = new Map<string, ShaderState>()
  private readonly waiting = new Map<string, Promise<void>>()
  /** Compiled effects per source text (two paths with the same text share one). */
  private readonly effects = new Map<string, CompiledShader | string>()
  private readonly warned = new Set<string>()
  /** Bumped by `clear()`: loads started before it drop their result. */
  private generation = 0

  constructor(
    private readonly ck: CanvasKit,
    private readonly onLoad: (src: string) => void,
    private readonly warn: (message: string) => void = (m) => console.warn(m),
  ) {}

  assets: AssetSource | null = null

  get(src: string): ShaderState {
    const s = this.states.get(src)
    if (s) return s
    void this.load(src)
    return this.states.get(src) ?? { status: "loading" }
  }

  load(src: string): Promise<void> {
    const w = this.waiting.get(src)
    if (w) return w
    if (this.states.has(src) && this.states.get(src)?.status !== "loading") return Promise.resolve()
    this.states.set(src, { status: "loading" })
    const gen = this.generation
    const p = (async () => {
      let text: string | null = null
      try {
        const bytes = this.assets ? await this.assets.load(src) : null
        if (bytes) text = new TextDecoder().decode(bytes)
      } catch {
        text = null
      }
      if (gen !== this.generation) return
      const state: ShaderState =
        text === null ? { status: "failed", reason: "source not found" } : this.compile(text)
      if (state.status === "failed") this.report(src, state.reason)
      this.states.set(src, state)
      this.waiting.delete(src)
      this.onLoad(src)
    })()
    this.waiting.set(src, p)
    return p
  }

  /** Compiles shader source text (cached per text). */
  compile(text: string): ShaderState {
    const hit = this.effects.get(text)
    if (hit !== undefined)
      return typeof hit === "string"
        ? { status: "failed", reason: hit }
        : { status: "ready", shader: hit }
    let out: CompiledShader | string
    try {
      const program = transpileGlsl(text)
      let error = ""
      const effect = this.ck.RuntimeEffect?.Make(program.sksl, (e) => {
        error = e
      })
      if (!effect) out = error ? `compile error: ${error.trim()}` : "runtime effects unavailable"
      else {
        const carriers = new Map<string, string>()
        for (const u of program.uniforms) carriers.set(`_k_u_${u.name}`, u.name)
        const slots = new Map<string, { slot: number; size: number }>()
        for (let i = 0; i < effect.getUniformCount(); i++) {
          const name = effect.getUniformName(i)
          const u = effect.getUniform(i)
          slots.set(carriers.get(name) ?? name, { slot: u.slot, size: u.columns * u.rows })
        }
        out = {
          effect,
          uniforms: program.uniforms,
          slots,
          floats: effect.getUniformFloatCount(),
          timed: program.timed,
        }
      }
    } catch (e) {
      out = e instanceof GlslError ? e.message : `transpile error: ${String(e)}`
    }
    this.effects.set(text, out)
    return typeof out === "string"
      ? { status: "failed", reason: out }
      : { status: "ready", shader: out }
  }

  private report(src: string, reason: string): void {
    const key = `${src}\n${reason}`
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.warn(`kimo renderer: shader ${src} is not drawn (${reason})`)
  }

  /** Forgets loaded sources (another document: the same relative path may be another file). */
  forgetSources(): void {
    this.generation++
    this.states.clear()
    this.waiting.clear()
  }

  clear(): void {
    this.generation++
    for (const e of this.effects.values()) if (typeof e !== "string") e.effect.delete()
    this.effects.clear()
    this.states.clear()
    this.waiting.clear()
  }
}
