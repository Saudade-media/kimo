/**
 * {@link applyDefaults} and {@link stripDefaults}: driven entirely by the {@link DEFAULTS} table.
 *
 * Defaults are applied or stripped only where the property's meaning does not depend on
 * presence. The top-level keys of an instance's `props` and of a `set` override are never
 * touched (there, `opacity: 1` overrides a component's `0.5`); values nested below them are
 * normalized because each such value replaces the target's value wholesale.
 */
import { DEFAULTS } from "./defaults"
import { isObject, setOwn } from "./json"
import type { KimoDocument } from "./schema/document"
import { isNodeType, type NodeType, nodeKeys } from "./schema/nodes"

type Op = "strip" | "apply"
type Obj = Record<string, unknown>

/** Structural equality for JSON values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    return ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]))
  }
  return false
}

const clone = <T>(v: T): T => structuredClone(v)

function withDefaults(
  obj: Obj,
  defaults: Readonly<Record<string, unknown>>,
  op: Op,
  allowed?: ReadonlySet<string>,
): void {
  for (const [k, def] of Object.entries(defaults)) {
    if (allowed && !allowed.has(k)) continue
    if (op === "strip") {
      if (Object.hasOwn(obj, k) && jsonEqual(obj[k], def)) delete obj[k]
    } else if (!Object.hasOwn(obj, k)) {
      obj[k] = clone(def)
    }
  }
}

function color(v: unknown, op: Op): unknown {
  if (isObject(v) && (v.space === "oklch" || v.space === "display-p3")) {
    const o = { ...v }
    withDefaults(o, DEFAULTS.color, op)
    return o
  }
  return v
}

function paint(v: unknown, op: Op): unknown {
  if (!isObject(v)) return v
  if ("space" in v) return color(v, op)
  const o: Obj = { ...v }
  switch (o.kind) {
    case "solid":
      o.color = color(o.color, op)
      withDefaults(o, DEFAULTS.solid, op)
      break
    case "linear":
    case "radial":
    case "angular":
      if (Array.isArray(o.stops))
        o.stops = o.stops.map((s) => (isObject(s) ? { ...s, color: color(s.color, op) } : s))
      withDefaults(o, DEFAULTS.gradient, op)
      break
    case "image":
      withDefaults(o, DEFAULTS.image, op)
      break
    case "mesh":
      if (Array.isArray(o.colors)) o.colors = o.colors.map((c) => color(c, op))
      break
  }
  return o
}

const paints = (v: unknown, op: Op) =>
  Array.isArray(v) ? v.map((p) => paint(p, op)) : paint(v, op)

function effect(v: unknown, op: Op): unknown {
  if (!isObject(v)) return v
  if (v.kind === "blur" || v.kind === "backdrop-blur") {
    const o: Obj = { ...v }
    withDefaults(o, DEFAULTS.blur, op)
    return o
  }
  if (v.kind !== "shadow") return v
  const o: Obj = { ...v, color: color(v.color, op) }
  withDefaults(o, DEFAULTS.shadow, op)
  return o
}

const effects = (v: unknown, op: Op) =>
  Array.isArray(v) ? v.map((e) => effect(e, op)) : effect(v, op)

function stroke(v: unknown, op: Op): unknown {
  if (!isObject(v)) return v
  const o: Obj = { ...v, paint: paints(v.paint, op) }
  withDefaults(o, DEFAULTS.stroke, op)
  return o
}

function layout(v: unknown, op: Op): unknown {
  if (!isObject(v)) return v
  const o: Obj = { ...v }
  withDefaults(o, DEFAULTS.layout, op)
  return o
}

function size(v: unknown, op: Op): unknown {
  if (!isObject(v) || v.mode !== "fill") return v
  const o: Obj = { ...v }
  withDefaults(o, DEFAULTS.sizeFill, op)
  return o
}

function star(v: unknown, op: Op): unknown {
  if (!isObject(v)) return v
  const o: Obj = { ...v }
  withDefaults(o, DEFAULTS.star, op)
  return o
}

/** Value-level normalizers, keyed by the property that holds the value. */
const FIELD: Record<string, (v: unknown, op: Op) => unknown> = {
  fill: paints,
  stroke,
  effects,
  layout,
  w: size,
  h: size,
  color,
  star,
}

function fields(obj: Obj, op: Op): void {
  for (const k of Object.keys(obj)) {
    const f = FIELD[k]
    if (f) obj[k] = f(obj[k], op)
  }
}

const TYPE_DEFAULTS: Partial<Record<NodeType, Readonly<Record<string, unknown>>>> = {
  frame: DEFAULTS.frame,
  rect: DEFAULTS.rect,
  polygon: DEFAULTS.polygon,
  ellipse: DEFAULTS.ellipse,
  path: DEFAULTS.path,
  text: DEFAULTS.text,
  script: DEFAULTS.script,
  browser: DEFAULTS.browser,
}

const keysCache = new Map<NodeType, ReadonlySet<string>>()
const keysOf = (t: NodeType) => {
  let k = keysCache.get(t)
  if (!k) {
    k = nodeKeys(t)
    keysCache.set(t, k)
  }
  return k
}

/** Applies or strips defaults on one node (returns a new object; unknown node types are copied). */
function node(n: unknown, op: Op): unknown {
  if (!isObject(n)) return n
  const o: Obj = { ...n }
  if (!isNodeType(o.type)) return o
  const type = o.type
  if (type === "instance") {
    if (isObject(o.props)) {
      const p = { ...o.props }
      fields(p, op)
      o.props = p
    }
    if (isObject(o.overrides)) {
      const ov: Obj = {}
      for (const [k, v] of Object.entries(o.overrides)) {
        if (isObject(v) && isObject(v.set)) {
          const s = { ...v.set }
          fields(s, op)
          // On a nested instance, `set.props` is a props struct: normalize the values below its
          // top-level keys, never the keys themselves.
          if (isObject(s.props)) {
            const p = { ...s.props }
            fields(p, op)
            s.props = p
          }
          setOwn(ov, k, { ...v, set: s })
        } else setOwn(ov, k, v)
      }
      o.overrides = ov
    }
  } else {
    fields(o, op)
  }
  withDefaults(o, DEFAULTS.node, op, keysOf(type))
  const td = TYPE_DEFAULTS[type]
  if (td) withDefaults(o, td, op)
  return o
}

function variable(v: unknown, op: Op): unknown {
  if (!isObject(v)) return v
  const norm = v.type === "color" ? color : v.type === "shadow" ? effects : null
  if (!norm) return { ...v }
  const value = v.value
  const themed =
    Array.isArray(value) && value.length > 0 && value.every((e) => isObject(e) && "value" in e)
  return {
    ...v,
    value: themed
      ? (value as Obj[]).map((e) => ({ ...e, value: norm(e.value, op) }))
      : norm(value, op),
  }
}

function transform(doc: KimoDocument, op: Op): KimoDocument {
  const d = { ...doc } as Obj
  if (isObject(d.nodes)) {
    const nodes: Obj = {}
    for (const [id, n] of Object.entries(d.nodes)) setOwn(nodes, id, node(n, op))
    d.nodes = nodes
  }
  if (isObject(d.variables)) {
    const vars: Obj = {}
    for (const [name, v] of Object.entries(d.variables)) setOwn(vars, name, variable(v, op))
    d.variables = vars
  }
  return d as KimoDocument
}

/**
 * Returns a copy of `doc` with every property that equals its normative default removed
 * (the form canonical writers emit). Unknown properties are kept untouched.
 */
export function stripDefaults<T extends KimoDocument>(doc: T): T {
  return transform(doc, "strip") as T
}

/** Returns a copy of `doc` with every absent defaulted property filled in from {@link DEFAULTS}. */
export function applyDefaults<T extends KimoDocument>(doc: T): T {
  return transform(doc, "apply") as T
}

/** {@link stripDefaults} for a single node. */
export function stripNodeDefaults<T>(n: T): T {
  return node(n, "strip") as T
}

/** {@link applyDefaults} for a single node. */
export function applyNodeDefaults<T>(n: T): T {
  return node(n, "apply") as T
}
