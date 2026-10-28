import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadCanvasKit } from "../src/ck"
import { GlslError, parseUniforms, preprocess, transpileGlsl, uniformValue } from "../src/glsl"

const SHADERS = join(import.meta.dir, "..", "..", "..", "shaders")
const color = (v: unknown) => {
  if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return null
  const n = Number.parseInt(v.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1] as const
}

describe("GLSL → SkSL", () => {
  for (const file of ["agent-liquid.glsl", "agent-liquid-v0-smoke.glsl"])
    test(`${file} transpiles and compiles`, async () => {
      const ck = await loadCanvasKit()
      const p = transpileGlsl(readFileSync(join(SHADERS, file), "utf8"))
      let error = ""
      const fx = ck.RuntimeEffect.Make(p.sksl, (e) => {
        error = e
      })
      expect(error).toBe("")
      expect(fx).toBeTruthy()
      expect(p.timed).toBe(true)
      fx?.delete()
    })

  test("annotations: roles, defaults, ranges, labels, colors", () => {
    const u = parseUniforms(`/** @resolution */
uniform vec2 res;
/** @time */
uniform float t;
/**
 * @label Speed
 * @range 0, 1.5
 * @default 0.12
 */
uniform float speed;
/**
 * @color
 * @default #0B1E3A
 */
uniform vec3 tint;`)
    const by = Object.fromEntries(u.map((x) => [x.name, x]))
    expect(by.res?.role).toBe("resolution")
    expect(by.t?.role).toBe("time")
    expect(by.speed).toMatchObject({ default: 0.12, min: 0, max: 1.5, label: "Speed" })
    expect(by.tint).toMatchObject({ type: "vec3", size: 3, color: true, default: "#0B1E3A" })
  })

  test("a comment block only annotates the uniform right after it", () => {
    const u = parseUniforms(`/** header @time */
float f() { return 1.0; }
/** @label A */
uniform float a;
uniform vec2 b, c;`)
    expect(u.map((x) => [x.name, x.role, x.label ?? null])).toEqual([
      ["a", null, "A"],
      ["b", null, null],
      ["c", null, null],
    ])
  })

  test("preprocessor: GL_ES, defines, function macros, #if", () => {
    const out = preprocess(`#ifdef GL_ES
precision highp float;
#else
garbage
#endif
#define K 2.0
#define SQ(x) ((x) * (x))
#if defined(K) && 1 > 0
float a = SQ(K + 1.0);
#elif 1
float b;
#endif`)
    expect(out).toContain("precision highp float;")
    expect(out).not.toContain("garbage")
    expect(out).toContain("float a = ((((2.0 + 1.0)) * ((2.0 + 1.0))));")
    expect(out).not.toContain("float b")
  })

  test("int and bool uniforms ride float carriers; the result compiles", async () => {
    const ck = await loadCanvasKit()
    const p = transpileGlsl(`uniform int n; uniform bool on; uniform ivec2 cell;
void main() {
  float v = on ? float(n + cell.x) / 10.0 : 0.0;
  if (gl_FragCoord.x < 0.0) return;
  gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
}`)
    const fx = ck.RuntimeEffect.Make(p.sksl)
    expect(fx).toBeTruthy()
    const names: string[] = []
    for (let i = 0; i < (fx?.getUniformCount() ?? 0); i++) names.push(fx?.getUniformName(i) ?? "")
    expect(names).toEqual(["_k_size", "_k_u_n", "_k_u_on", "_k_u_cell"])
    fx?.delete()
  })

  test("unsupported features are reported, never compiled", () => {
    expect(() => transpileGlsl("uniform sampler2D t; void main() {}")).toThrow(GlslError)
    expect(() =>
      transpileGlsl(
        "/** @backdrop */ uniform sampler2D b; void main() { gl_FragColor = vec4(1); }",
      ),
    ).toThrow(/backdrop/)
    expect(() => transpileGlsl("void main() { gl_FragColor = vec4(dFdx(1.0)); }")).toThrow(
      /derivatives/,
    )
    expect(() => transpileGlsl("float f() { return 1.0; }")).toThrow(/main/)
  })
})

describe("uniform values", () => {
  const ctx = { resolution: [40, 20] as const, time: 2.5, color }
  const [u] = parseUniforms("/** @color @default #FF0000 */ uniform vec3 c;")
  const decl = (src: string) => parseUniforms(src)[0] as NonNullable<typeof u>

  test("override > @default > 0", () => {
    if (!u) throw new Error("no uniform")
    expect(uniformValue(u, undefined, ctx)).toEqual([1, 0, 0])
    expect(uniformValue(u, "#0000FF", ctx)).toEqual([0, 0, 1])
    expect(uniformValue(u, [0.5, 0.25, 1, 9], ctx)).toEqual([0.5, 0.25, 1])
    expect(uniformValue(u, 0.5, ctx)).toEqual([0.5, 0.5, 0.5])
    expect(uniformValue(decl("uniform vec4 v;"), "#00FF00", ctx)).toEqual([0, 1, 0, 1])
    expect(uniformValue(decl("uniform float f;"), true, ctx)).toEqual([1])
    expect(uniformValue(decl("uniform vec2 f;"), undefined, ctx)).toEqual([0, 0])
    expect(uniformValue(decl("/** @default 0.25 */ uniform float f;"), "nope", ctx)).toEqual([0.25])
  })

  test("bindings resolve through the resolver", () => {
    if (!u) throw new Error("no uniform")
    const resolve = (v: unknown) =>
      (v as { $ref: string }).$ref === "accent" ? "#00FF00" : undefined
    expect(uniformValue(u, { $ref: "accent" }, { ...ctx, resolve })).toEqual([0, 1, 0])
    // An unresolved binding falls back to the default.
    expect(uniformValue(u, { $ref: "gone" }, { ...ctx, resolve })).toEqual([1, 0, 0])
  })
})
