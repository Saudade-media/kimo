/**
 * pen.dev-compatible `shader` paints (spec §7.1, §20 row 33): a WebGL 1.0 (GLSL ES 1.00)
 * fragment shader is transpiled to SkSL so CanvasKit's RuntimeEffect runs it on GPU and CPU
 * surfaces alike. Uniforms are declared with block-comment annotations (`@resolution`, `@time`,
 * `@mouse`, `@color`, `@default`, `@range`/`@min`/`@max`, `@label`; `@sdf` / `@backdrop`
 * samplers are not supported). Pure string work: no CanvasKit here.
 */

/** A shader the transpiler cannot run (unsupported feature or malformed source). */
export class GlslError extends Error {
  override readonly name = "GlslError"
}

export type UniformRole = "resolution" | "time" | "mouse"

/** One `uniform` declaration and its annotations. */
export interface UniformDecl {
  name: string
  /** GLSL type (`float`, `vec3`, `int`, `bool`, `mat2`, …). */
  type: string
  /** Float count of the value. */
  size: number
  role: UniformRole | null
  color: boolean
  /** Parsed `@default` (numbers, a `#hex` color or a boolean), else null. */
  default: number | boolean | string | number[] | null
  min?: number
  max?: number
  label?: string
}

export interface ShaderProgram {
  sksl: string
  uniforms: UniformDecl[]
  /** Some uniform is `@time`: the paint animates. */
  timed: boolean
}

const SIZES: Record<string, number> = {
  float: 1,
  int: 1,
  bool: 1,
  vec2: 2,
  vec3: 3,
  vec4: 4,
  ivec2: 2,
  ivec3: 3,
  ivec4: 4,
  bvec2: 2,
  bvec3: 3,
  bvec4: 4,
  mat2: 4,
  mat3: 9,
  mat4: 16,
}

/** Float carrier of an integer / boolean uniform (RuntimeEffect uniforms are fed as floats). */
const CARRIER: Record<string, string> = {
  int: "float",
  bool: "float",
  ivec2: "vec2",
  ivec3: "vec3",
  ivec4: "vec4",
  bvec2: "vec2",
  bvec3: "vec3",
  bvec4: "vec4",
}

/** GLSL ES / WebGL features SkSL runtime effects do not have. */
const UNSUPPORTED: [RegExp, string][] = [
  [/\bsampler(?:2D|Cube)\b/, "sampler uniforms (@sdf / @backdrop / images)"],
  [/\btexture(?:2D|Cube|Size)\w*\b/, "texture sampling"],
  [/\b(?:varying|attribute)\b/, "varyings"],
  [/\bgl_(?:FragData|FrontFacing|PointCoord)\b/, "fragment built-ins other than gl_FragCoord"],
  [/\b(?:dFdx|dFdy|fwidth)\b/, "derivatives"],
  [/#\s*extension\b/, "extensions"],
]

/** Prefix of every name the transpiler adds. */
const P = "_k_"

// --- Preprocessor ---------------------------------------------------------------------------

interface Macro {
  params: string[] | null
  body: string
}

/** `#if` expression evaluator: integers, `defined`, `! && || == != < > <= >= + - * /`, parens. */
function evalIf(expr: string, defs: Map<string, Macro>): boolean {
  const src = expr
    .replace(/\bdefined\s*\(\s*(\w+)\s*\)|\bdefined\s+(\w+)/g, (_m, a, b) =>
      defs.has(a ?? b) ? "1" : "0",
    )
    .replace(/\b[A-Za-z_]\w*\b/g, (id) => {
      const m = defs.get(id)
      return m && !m.params && /^\s*-?\d+(?:\.\d*)?\s*$/.test(m.body) ? m.body.trim() : "0"
    })
  const toks = src.match(/\d+(?:\.\d*)?|&&|\|\||[=!<>]=|[-+*/()!<>]/g) ?? []
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const primary = (): number => {
    const t = next()
    if (t === "(") {
      const v = or()
      next()
      return v
    }
    if (t === "!") return primary() ? 0 : 1
    if (t === "-") return -primary()
    if (t === "+") return primary()
    const n = Number(t)
    if (!Number.isFinite(n)) throw new GlslError(`unsupported #if expression: ${expr.trim()}`)
    return n
  }
  const bin = (sub: () => number, ops: string[], f: (op: string, a: number, b: number) => number) =>
    function rec(): number {
      let a = sub()
      while (ops.includes(peek() ?? "")) {
        const op = next() as string
        a = f(op, a, sub())
      }
      return a
    }
  const mul = bin(primary, ["*", "/"], (op, a, b) =>
    op === "*" ? a * b : b ? Math.trunc(a / b) : 0,
  )
  const add = bin(mul, ["+", "-"], (op, a, b) => (op === "+" ? a + b : a - b))
  const cmp = bin(add, ["<", ">", "<=", ">="], (op, a, b) =>
    Number(op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b),
  )
  const eq = bin(cmp, ["==", "!="], (op, a, b) => Number(op === "==" ? a === b : a !== b))
  const and = bin(eq, ["&&"], (_op, a, b) => Number(!!a && !!b))
  const or = bin(and, ["||"], (_op, a, b) => Number(!!a || !!b))
  const v = or()
  if (i !== toks.length) throw new GlslError(`unsupported #if expression: ${expr.trim()}`)
  return v !== 0
}

/** Expands object-like and function-like macros in one line of code. */
function expand(line: string, defs: Map<string, Macro>, depth = 0): string {
  if (!defs.size || depth > 16) return line
  let changed = false
  let out = ""
  let i = 0
  const re = /[A-Za-z_]\w*/g
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const name = m[0]
    const mac = defs.get(name)
    if (!mac) continue
    if (!mac.params) {
      out += line.slice(i, m.index) + mac.body
      i = re.lastIndex
      changed = true
      continue
    }
    // Function-like: `NAME ( args )` with balanced parentheses.
    let j = re.lastIndex
    while (line[j] === " " || line[j] === "\t") j++
    if (line[j] !== "(") continue
    const args: string[] = []
    let level = 0
    let start = j + 1
    let k = j
    for (; k < line.length; k++) {
      const c = line[k]
      if (c === "(") level++
      else if (c === ")") {
        level--
        if (level === 0) {
          args.push(line.slice(start, k))
          break
        }
      } else if (c === "," && level === 1) {
        args.push(line.slice(start, k))
        start = k + 1
      }
    }
    if (level !== 0) continue
    const params = mac.params
    const body = mac.body.replace(/[A-Za-z_]\w*/g, (id) => {
      const p = params.indexOf(id)
      return p >= 0 ? `(${(args[p] ?? "").trim()})` : id
    })
    out += `${line.slice(i, m.index)}(${body})`
    i = k + 1
    re.lastIndex = k + 1
    changed = true
  }
  if (!changed) return line
  return expand(out + line.slice(i), defs, depth + 1)
}

/**
 * Runs the preprocessor: conditionals (`GL_ES` is defined, as in WebGL), `#define` / `#undef`
 * (expanded in the following lines); drops `#version`, `#pragma`, `precision` lines.
 */
export function preprocess(source: string): string {
  const defs = new Map<string, Macro>([["GL_ES", { params: null, body: "1" }]])
  const lines = source.replace(/\\\r?\n/g, " ").split(/\r?\n/)
  /** Per open conditional: is this branch active, was any branch taken, was the parent active. */
  const stack: { on: boolean; taken: boolean; parent: boolean }[] = []
  const active = () => (stack.length ? (stack[stack.length - 1] as { on: boolean }).on : true)
  const out: string[] = []
  for (const line of lines) {
    const d = /^\s*#\s*(\w+)\s*(.*)$/.exec(line)
    if (!d) {
      out.push(active() ? expand(line, defs) : "")
      continue
    }
    const kw = d[1] as string
    const rest = (d[2] ?? "").replace(/\/\/.*$|\/\*.*?\*\//g, "").trim()
    out.push("")
    switch (kw) {
      case "ifdef":
      case "ifndef":
      case "if": {
        const parent = active()
        const cond =
          kw === "if"
            ? parent && evalIf(rest, defs)
            : parent && defs.has(rest.split(/\s/)[0] ?? "") === (kw === "ifdef")
        stack.push({ on: cond, taken: cond, parent })
        break
      }
      case "elif": {
        const top = stack[stack.length - 1]
        if (!top) throw new GlslError("#elif without #if")
        const cond = top.parent && !top.taken && evalIf(rest, defs)
        top.on = cond
        top.taken ||= cond
        break
      }
      case "else": {
        const top = stack[stack.length - 1]
        if (!top) throw new GlslError("#else without #if")
        top.on = top.parent && !top.taken
        top.taken = true
        break
      }
      case "endif":
        if (!stack.pop()) throw new GlslError("#endif without #if")
        break
      case "define": {
        if (!active()) break
        const m = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(rest)
        if (!m) throw new GlslError(`malformed #define: ${rest}`)
        const params = m[2] !== undefined ? (m[3] ?? "").split(",").map((s) => s.trim()) : null
        defs.set(m[1] as string, {
          params: params?.length === 1 && params[0] === "" ? [] : params,
          body: expand(m[4] ?? "", defs),
        })
        break
      }
      case "undef":
        if (active()) defs.delete(rest)
        break
      case "version":
      case "pragma":
        break
      case "extension":
        if (active()) throw new GlslError("unsupported: extensions")
        break
      case "error":
        if (active()) throw new GlslError(`#error ${rest}`)
        break
      default:
        if (active()) throw new GlslError(`unsupported directive #${kw}`)
    }
  }
  if (stack.length) throw new GlslError("unterminated #if")
  return out.join("\n")
}

// --- Uniform annotations --------------------------------------------------------------------

/** A `@default` text → number(s), `#hex` color or boolean. */
export function parseDefault(text: string): UniformDecl["default"] {
  const t = text.trim()
  if (!t) return null
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return t
  if (t === "true" || t === "false") return t === "true"
  const nums = (
    t.replace(/^[a-z]\w*\s*\(|[()[\]]/gi, " ").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ??
    []
  ).map(Number)
  if (!nums.length) return t
  return nums.length === 1 ? (nums[0] as number) : nums
}

function annotations(comment: string): Omit<UniformDecl, "name" | "type" | "size"> {
  const a: Omit<UniformDecl, "name" | "type" | "size"> = { role: null, color: false, default: null }
  const body = comment.replace(/^\/\*+|\*+\/$/g, "")
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*?\s?/, "")
    for (const m of line.matchAll(/@(\w+)\s*([^@]*)/g)) {
      const tag = (m[1] as string).toLowerCase()
      const v = (m[2] ?? "").trim()
      switch (tag) {
        case "resolution":
        case "time":
        case "mouse":
          a.role = tag
          break
        case "color":
          a.color = true
          break
        case "default":
          a.default = parseDefault(v)
          break
        case "range": {
          const [lo, hi] = v.split(/[\s,]+/).map(Number)
          if (Number.isFinite(lo)) a.min = lo as number
          if (Number.isFinite(hi)) a.max = hi as number
          break
        }
        case "min":
        case "max": {
          const n = Number.parseFloat(v)
          if (Number.isFinite(n)) a[tag] = n
          break
        }
        case "label":
          if (v) a.label = v
          break
        case "sdf":
        case "backdrop":
          throw new GlslError(`unsupported: @${tag} samplers`)
      }
    }
  }
  return a
}

/**
 * The `uniform` declarations of preprocessed source, with the annotations of the block comment
 * right before each (a declaration list `uniform vec3 a, b;` shares it).
 */
export function parseUniforms(source: string): UniformDecl[] {
  const out: UniformDecl[] = []
  const re =
    /(\/\*(?:(?!\*\/)[\s\S])*\*\/\s*)?\buniform\s+(?:(?:highp|mediump|lowp)\s+)?([A-Za-z_]\w*)\s+([^;{}]+);/g
  // Line comments can't hold annotations; drop them so `// uniform …` is not read.
  const src = source.replace(/\/\/[^\n]*/g, "")
  for (const m of src.matchAll(re)) {
    const type = m[2] as string
    const comment = m[1]?.trim() ?? ""
    const a = comment.startsWith("/*") ? annotations(comment) : annotations("")
    for (const decl of (m[3] as string).split(",")) {
      const name = decl.trim()
      if (/\[/.test(name)) throw new GlslError(`unsupported: uniform arrays (${name})`)
      if (!/^[A-Za-z_]\w*$/.test(name)) throw new GlslError(`malformed uniform: ${decl.trim()}`)
      const size = SIZES[type]
      if (size === undefined) throw new GlslError(`unsupported uniform type ${type} (${name})`)
      out.push({ name, type, size, ...a })
    }
  }
  return out
}

// --- Transpiler -----------------------------------------------------------------------------

/**
 * GLSL ES 1.00 fragment shader → SkSL runtime shader. The SkSL `main(float2)` receives node-local
 * coordinates; `gl_FragCoord` is rebuilt from them with a bottom-left origin using the hidden
 * uniform `_k_size` (node box). Like pen.dev, `gl_FragCoord` and `@resolution` are in design px
 * whatever the zoom or export scale (a "px" uniform means design px). The shader's
 * `gl_FragColor` is returned as premultiplied color, as WebGL composites it.
 */
export function transpileGlsl(source: string): ShaderProgram {
  const pre = preprocess(source)
  const uniforms = parseUniforms(pre)
  let code = pre.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "")
  for (const [re, what] of UNSUPPORTED)
    if (re.test(code)) throw new GlslError(`unsupported: ${what}`)
  if (new RegExp(`\\b${P}`).test(code)) throw new GlslError(`identifiers may not start with ${P}`)
  code = code
    .replace(/\bprecision\s+\w+\s+\w+\s*;/g, "")
    .replace(/\b(?:highp|mediump|lowp)\s+/g, "")
    .replace(/\bgl_FragCoord\b/g, `${P}FragCoord`)
    .replace(/\bgl_FragColor\b/g, `${P}FragColor`)
  const inits: string[] = []
  code = code.replace(
    /\buniform\s+([A-Za-z_]\w*)\s+([^;{}]+);/g,
    (_m, type: string, list: string) => {
      const names = list.split(",").map((s) => s.trim())
      const carrier = CARRIER[type]
      if (!carrier) return `uniform ${type} ${names.join(", ")};`
      return names
        .map((n) => {
          inits.push(
            type.startsWith("b")
              ? type === "bool"
                ? `${n} = ${P}u_${n} != 0.0;`
                : `${n} = notEqual(${P}u_${n}, ${carrier}(0.0));`
              : `${n} = ${type}(${P}u_${n});`,
          )
          return `uniform ${carrier} ${P}u_${n}; ${type} ${n};`
        })
        .join("\n")
    },
  )
  const main = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)\s*\{/
  if (!main.test(code)) throw new GlslError("no `void main()`")
  code = code.replace(main, `void ${P}main() {`)
  const sksl = `uniform float2 ${P}size;
float4 ${P}FragCoord;
float4 ${P}FragColor;
${code.trim()}
half4 main(float2 ${P}xy) {
  ${P}FragCoord = float4(${P}xy.x, ${P}size.y - ${P}xy.y, 0.0, 1.0);
  ${P}FragColor = float4(0.0);
  ${inits.join("\n  ")}
  ${P}main();
  return half4(${P}FragColor);
}
`
  return { sksl, uniforms, timed: uniforms.some((u) => u.role === "time") }
}

// --- Uniform values -------------------------------------------------------------------------

export interface UniformContext {
  /** Fill size in design px (`@resolution`). */
  resolution: readonly [number, number]
  /** Seconds (`@time`). */
  time: number
  /** Resolves a `{ $ref }` binding of a paint's `uniforms` entry. */
  resolve?: (value: unknown) => unknown
  /** A color value (hex, OKLCH, P3) → sRGB RGBA 0..1, or null. */
  color: (value: unknown) => readonly [number, number, number, number] | null
}

const isRefLike = (v: unknown): boolean =>
  typeof v === "object" && v !== null && typeof (v as { $ref?: unknown }).$ref === "string"

/** One value (override or `@default`) as `size` floats, or null when it does not apply. */
function floatsOf(u: UniformDecl, v: unknown, ctx: UniformContext, depth = 0): number[] | null {
  if (isRefLike(v) && ctx.resolve && depth < 4) return floatsOf(u, ctx.resolve(v), ctx, depth + 1)
  let out: number[] | null = null
  if (typeof v === "number" && Number.isFinite(v)) out = [v]
  else if (typeof v === "boolean") out = [v ? 1 : 0]
  else if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number"))
    out = v as number[]
  else if (v !== null && v !== undefined) {
    const c = ctx.color(v)
    if (c) out = u.size === 3 ? [c[0], c[1], c[2]] : [c[0], c[1], c[2], c[3]]
  }
  if (!out) return null
  // A scalar fills every component (`vec3 = 0.5`); short arrays pad with 0.
  if (out.length === 1 && u.size > 1 && !u.type.startsWith("mat"))
    out = new Array(u.size).fill(out[0])
  const r = new Array<number>(u.size).fill(0)
  for (let i = 0; i < u.size && i < out.length; i++) r[i] = out[i] as number
  return r
}

/**
 * The floats of uniform `u`: its role (`@resolution`, `@time`, `@mouse` = 0), else the paint's
 * override, else `@default`, else zeros.
 */
export function uniformValue(u: UniformDecl, override: unknown, ctx: UniformContext): number[] {
  const zeros = () => new Array<number>(u.size).fill(0)
  if (u.role === "resolution") {
    const r = zeros()
    r[0] = ctx.resolution[0]
    if (u.size > 1) r[1] = ctx.resolution[1]
    return r
  }
  if (u.role === "time") {
    const r = zeros()
    r[0] = ctx.time
    return r
  }
  if (u.role === "mouse") return zeros()
  return floatsOf(u, override, ctx) ?? floatsOf(u, u.default, ctx) ?? zeros()
}
