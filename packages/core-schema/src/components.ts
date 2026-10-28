/**
 * Component helpers (spec §9; M3, ADR 0011). Pure functions over a document and its loaded
 * libraries: locating components by qualified id, following derived components, resolving
 * IdPaths (§9.5), and the declared prop API (§9.6) in declaration order.
 *
 * Shared by the instance expansion (`./expand`), the edit planners (`./edit/*`), layout,
 * renderer and the editor. The validator keeps its own copy of the resolution rules; the
 * tests check that both agree on the fixtures.
 */
import { isObject } from "./json"
import type { Libraries } from "./resolve"
import { splitQualified } from "./resolve"
import type { KimoDocument } from "./schema/document"
import type { PropDef } from "./schema/nodes"
import { compareCodeUnits } from "./tree"

/** Node meta key holding a component's description (board 12 Component section). A string. */
export const COMPONENT_DESCRIPTION_META_KEY = "kimo.component.description"

/** What the component helpers read: the consumer document and its loaded libraries. */
export interface ComponentScope {
  doc: Pick<KimoDocument, "nodes" | "imports">
  libraries?: Libraries
}

/** A node located in the consumer document (`alias` null) or in a loaded library. */
export interface LocatedNode {
  /** Consumer import alias of the library holding the node, or null for the consumer. */
  alias: string | null
  /** Id inside its own document (never qualified). */
  id: string
  node: Readonly<Record<string, unknown>>
}

/** Why a reference could not be followed. */
export type LocateFailure =
  | { reason: "missing"; qid: string }
  | { reason: "alias-unknown"; alias: string }
  | { reason: "library-not-loaded"; alias: string }
  /** A library referencing a library it imports itself: not resolved in 1.0 (§9.5). */
  | { reason: "nested-library"; qid: string }

/** `alias:id`, or the bare id for the consumer. */
export function qualify(alias: string | null, id: string): string {
  return alias === null ? id : `${alias}:${id}`
}

/** The node table of the document a located node lives in. */
export function nodesOf(scope: ComponentScope, alias: string | null): Record<string, unknown> {
  if (alias === null) return scope.doc.nodes as Record<string, unknown>
  return (scope.libraries?.[alias]?.nodes as Record<string, unknown> | undefined) ?? {}
}

/**
 * Locates a qualified id as written inside namespace `from` (null = the consumer). Inside a
 * library, a bare id names a node of that library; `alias:id` is only followed from the
 * consumer (a library's own imports are not followed in 0.1).
 */
export function locate(
  scope: ComponentScope,
  qid: string,
  from: string | null = null,
): LocatedNode | LocateFailure {
  const { alias, name } = splitQualified(qid)
  let target: string | null = from
  if (alias !== null) {
    if (from !== null && alias !== from) return { reason: "nested-library", qid }
    if (from === null) {
      if (!scope.doc.imports || !Object.hasOwn(scope.doc.imports, alias))
        return { reason: "alias-unknown", alias }
      if (!scope.libraries?.[alias]) return { reason: "library-not-loaded", alias }
    }
    target = alias
  }
  const nodes = nodesOf(scope, target)
  const node = Object.hasOwn(nodes, name) ? nodes[name] : undefined
  if (!isObject(node)) return { reason: "missing", qid }
  return { alias: target, id: name, node }
}

/**
 * Writes an IdPath authored inside library `alias` in the consumer's namespace: every bare
 * segment gets the `alias:` prefix (a consumer override key, §11). Null alias: unchanged.
 */
export function qualifyPath(path: string, alias: string | null): string {
  if (alias === null) return path
  return path
    .split("/")
    .map((s) => (s.includes(":") ? s : `${alias}:${s}`))
    .join("/")
}

/** True for a located result (not a failure). */
export function isLocated(r: LocatedNode | LocateFailure | null | undefined): r is LocatedNode {
  return !!r && "node" in r
}

/** True when a node is a component (truthy `component`: a main or a derived component). */
export function isComponentNode(n: unknown): boolean {
  return isObject(n) && Boolean(n.component)
}

/** The component an instance (consumer or library) instantiates. */
export function componentOfInstance(
  scope: ComponentScope,
  inst: LocatedNode,
): LocatedNode | LocateFailure {
  const of = inst.node.of
  if (typeof of !== "string") return { reason: "missing", qid: String(of) }
  return locate(scope, of, inst.alias)
}

/**
 * The derived chain of a component: `[c, base, base's base, …]`, ending at the first
 * non-instance node (the base root) or where a link fails. Cycles stop the chain.
 */
export function derivedChain(scope: ComponentScope, c: LocatedNode): LocatedNode[] {
  const out: LocatedNode[] = [c]
  const seen = new Set([qualify(c.alias, c.id)])
  let cur = c
  while (cur.node.type === "instance") {
    const next = componentOfInstance(scope, cur)
    if (!isLocated(next)) break
    const key = qualify(next.alias, next.id)
    if (seen.has(key)) break
    seen.add(key)
    out.push(next)
    cur = next
  }
  return out
}

/** The first non-instance component root a (possibly derived) component resolves to. */
export function baseRoot(scope: ComponentScope, c: LocatedNode): LocatedNode | null {
  const chain = derivedChain(scope, c)
  const last = chain[chain.length - 1] as LocatedNode
  return last.node.type === "instance" ? null : last
}

/** True when `id` is a strict descendant of `ancestor` in a node table (cycle-safe). */
export function isDescendant(
  nodes: Readonly<Record<string, unknown>>,
  id: string,
  ancestor: string,
): boolean {
  const seen = new Set<string>()
  let p = (nodes[id] as Record<string, unknown> | undefined)?.parent
  while (typeof p === "string" && !seen.has(p)) {
    if (p === ancestor) return true
    seen.add(p)
    p = (nodes[p] as Record<string, unknown> | undefined)?.parent
  }
  return false
}

/** Result of {@link resolveIdPath}. */
export type PathResolution =
  | {
      ok: true
      /** The target node, in its own namespace. */
      target: LocatedNode
      /**
       * The instance boundaries crossed, outermost first: `[segment 0's instance, …]`. Empty
       * for a single-segment path.
       */
      through: LocatedNode[]
      /** True when the path named the component root itself (prop targets only). */
      root: boolean
    }
  | { ok: false; reason: string; unchecked?: string }

/**
 * Resolves an IdPath relative to component `c` (spec §9.5): each segment is looked up among
 * the descendants of the current component in its namespace (derived components are looked
 * through); every segment but the last must be an instance whose component becomes the next
 * namespace. With `allowRoot` (declared prop targets, ADR 0011), a one-segment path equal to
 * the id of `c` or of any component in its derived chain names the base root.
 */
export function resolveIdPath(
  scope: ComponentScope,
  c: LocatedNode,
  path: string,
  options: {
    allowRoot?: boolean
    /**
     * Component swaps the holding instance applies to nested instances (IdPath prefix →
     * consumer-namespace QId, see {@link instanceSwaps}): a path crossing a swapped nested
     * instance continues in the swapped component (§9.8, last paragraph).
     */
    swaps?: ReadonlyMap<string, string>
  } = {},
): PathResolution {
  const segments = path.split("/")
  if (options.allowRoot && segments.length === 1) {
    const chain = derivedChain(scope, c)
    const { alias, name } = splitQualified(path)
    if (chain.some((l) => l.id === name && l.alias === (alias ?? c.alias))) {
      const root = chain[chain.length - 1] as LocatedNode
      if (root.node.type === "instance")
        return { ok: false, reason: "derived chain is broken", unchecked: root.alias ?? undefined }
      return { ok: true, target: root, through: [], root: true }
    }
  }
  let ctx = c
  const through: LocatedNode[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string
    const { alias, name } = splitQualified(seg)
    let found: LocatedNode | null = null
    const seen = new Set<string>()
    for (;;) {
      const nodes = nodesOf(scope, ctx.alias)
      const node = Object.hasOwn(nodes, name) ? nodes[name] : undefined
      if (alias === ctx.alias && isObject(node) && isDescendant(nodes, name, ctx.id)) {
        found = { alias: ctx.alias, id: name, node }
        break
      }
      if (ctx.node.type !== "instance" || seen.has(ctx.id)) break
      seen.add(ctx.id)
      const next = componentOfInstance(scope, ctx)
      if (!isLocated(next)) {
        if (next.reason === "library-not-loaded" || next.reason === "nested-library")
          return { ok: false, reason: `"${seg}" is not checked`, unchecked: aliasOf(next) }
        break
      }
      ctx = next
    }
    if (!found) {
      if (alias !== ctx.alias)
        return {
          ok: false,
          reason:
            ctx.alias === null
              ? `segment "${seg}" must be a local id (the component is local)`
              : `segment "${seg}" must be written "${ctx.alias}:${name}"`,
        }
      return { ok: false, reason: `"${seg}" is not a descendant of "${ctx.id}"` }
    }
    if (i === segments.length - 1) return { ok: true, target: found, through, root: false }
    if (found.node.type !== "instance")
      return { ok: false, reason: `"${seg}" is not an instance, so the path cannot continue` }
    through.push(found)
    const swapped = options.swaps?.get(segments.slice(0, i + 1).join("/"))
    const next = swapped !== undefined ? locate(scope, swapped) : componentOfInstance(scope, found)
    if (!isLocated(next)) {
      if (next.reason === "library-not-loaded" || next.reason === "nested-library")
        return { ok: false, reason: `"${seg}" is not checked`, unchecked: aliasOf(next) }
      return { ok: false, reason: `"${seg}" is an instance of a missing component` }
    }
    ctx = next
  }
  return { ok: false, reason: "empty path" }
}

/**
 * The component swaps instance `inst` (of component `c`) applies to its nested instances:
 * override key / prop path → consumer-namespace QId, from instance-prop `args` and then
 * `set.of` overrides (overrides win, §9.3). Override keys and swaps of an instance read from
 * library `alias` are qualified into the consumer's namespace.
 */
export function instanceSwaps(
  scope: ComponentScope,
  c: LocatedNode,
  inst: Readonly<Record<string, unknown>>,
  alias: string | null = null,
): Map<string, string> {
  const out = new Map<string, string>()
  const q = (v: string) => (alias !== null && !v.includes(":") ? `${alias}:${v}` : v)
  if (isObject(inst.args)) {
    for (const p of declaredProps(scope, c)) {
      const v = inst.args[p.name]
      if (p.def.type === "instance" && p.path !== "" && typeof v === "string") out.set(p.path, q(v))
    }
  }
  if (isObject(inst.overrides))
    for (const [k, ov] of Object.entries(inst.overrides))
      if (isObject(ov) && isObject(ov.set) && typeof ov.set.of === "string")
        out.set(qualifyPath(k, alias), q(ov.set.of))
  return out
}

function aliasOf(f: LocateFailure): string | undefined {
  if ("alias" in f) return f.alias
  return splitQualified(f.qid).alias ?? undefined
}

/** One declared prop of a component, as seen through its derived chain (§9.6). */
export interface DeclaredProp {
  name: string
  def: PropDef
  /** The component whose `component.props` holds the winning declaration. */
  declaredBy: LocatedNode
  /** True when the winning declaration is not on the queried component (read-only in the UI). */
  inherited: boolean
  /** True when the queried derived component redeclares a prop its base also declares. */
  redeclared: boolean
  /** Effective order key (`def.order`, else the base declaration's, else ""). */
  order: string
  /**
   * The IdPath to apply the prop's value at, relative to the queried component: `""` for the
   * root (a target equal to the declaring component's id, ADR 0011), else `def.target`.
   */
  path: string
  /**
   * Enum props (board 27 §8 a): option → its targets, each with the IdPath to apply at (`""` =
   * the root), relative to the queried component like {@link path}. Absent for other props.
   */
  targets?: Record<string, { path: string; field: string; value: unknown }[]>
}

/**
 * The declared props of a component in display order: by (`order`, then name). A derived
 * component inherits its base's props and its own declarations win by name.
 */
export function declaredProps(scope: ComponentScope, c: LocatedNode): DeclaredProp[] {
  const chain = derivedChain(scope, c).reverse()
  const out = new Map<string, DeclaredProp>()
  for (const link of chain) {
    const def = link.node.component
    if (!isObject(def) || !isObject(def.props)) continue
    for (const [name, raw] of Object.entries(def.props)) {
      if (!isObject(raw)) continue
      const multi = raw.type === "enum" && isObject(raw.targets)
      if (typeof raw.target !== "string" && !multi) continue
      const prev = out.get(name)
      const own = typeof raw.order === "string" ? raw.order : undefined
      const pathOf = (t: string) =>
        t === link.id || t === qualify(link.alias, link.id) ? "" : qualifyPath(t, link.alias)
      const p: DeclaredProp = {
        name,
        def: raw as unknown as PropDef,
        declaredBy: link,
        inherited: false,
        redeclared: prev !== undefined,
        order: own ?? prev?.order ?? "",
        path: typeof raw.target === "string" ? pathOf(raw.target) : "",
      }
      if (multi) {
        const targets: NonNullable<DeclaredProp["targets"]> = {}
        for (const [opt, list] of Object.entries(raw.targets as Record<string, unknown>)) {
          if (!Array.isArray(list)) continue
          targets[opt] = list
            .filter(
              (t): t is { target: string; field: string; value: unknown } =>
                isObject(t) && typeof t.target === "string" && typeof t.field === "string",
            )
            .map((t) => ({ path: pathOf(t.target), field: t.field, value: t.value }))
        }
        p.targets = targets
      }
      out.set(name, p)
    }
  }
  const self = qualify(c.alias, c.id)
  return [...out.values()]
    .map((p) => ({ ...p, inherited: qualify(p.declaredBy.alias, p.declaredBy.id) !== self }))
    .sort((a, b) => compareCodeUnits(a.order, b.order) || compareCodeUnits(a.name, b.name))
}

/**
 * Applies one `set` entry to node data in place: a plain key replaces the property; a
 * `<property>/<key>` key (enum targets, board 27 §8 a) replaces one key of a struct property,
 * keeping its other keys.
 */
export function applySetEntry(out: Record<string, unknown>, key: string, value: unknown): void {
  const i = key.indexOf("/")
  if (i < 0) {
    Object.defineProperty(out, key, { value, enumerable: true, configurable: true, writable: true })
    return
  }
  const top = key.slice(0, i)
  const sub = key.slice(i + 1)
  const cur = out[top]
  const next: Record<string, unknown> = isObject(cur) && !("$ref" in cur) ? { ...cur } : {}
  Object.defineProperty(next, sub, { value, enumerable: true, configurable: true, writable: true })
  Object.defineProperty(out, top, {
    value: next,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

/**
 * What an instance arg does (§9.6): the path it applies at (`""` = the root, through the
 * instance's `props` layer) and the `set` it contributes, or null when the value does not fit
 * (unknown enum option; slot props take no args).
 */
export function argEffect(
  prop: DeclaredProp,
  value: unknown,
): { path: string; set: Record<string, unknown> } | null {
  const def = prop.def as unknown as Record<string, unknown>
  switch (def.type) {
    case "text":
      return { path: prop.path, set: { content: value } }
    case "boolean":
      return { path: prop.path, set: { visible: value } }
    case "instance":
      return { path: prop.path, set: { of: value } }
    case "enum": {
      const options = def.options
      if (typeof value !== "string" || !isObject(options) || !Object.hasOwn(options, value))
        return null
      if (typeof def.field !== "string") return null
      return { path: prop.path, set: { [def.field]: options[value] } }
    }
    default:
      return null
  }
}

/** Ids of the consumer's instances whose `of` names `qid` (a local id or `alias:id`). */
export function instancesOf(doc: Pick<KimoDocument, "nodes">, qid: string): string[] {
  const out: string[] = []
  for (const [id, n] of Object.entries(doc.nodes as Record<string, unknown>))
    if (isObject(n) && n.type === "instance" && n.of === qid) out.push(id)
  return out.sort(compareCodeUnits)
}

/**
 * Ids of the consumer's component nodes (mains and derived), sorted. Library components are
 * listed with {@link libraryComponents}.
 */
export function localComponents(doc: Pick<KimoDocument, "nodes">): string[] {
  const out: string[] = []
  for (const [id, n] of Object.entries(doc.nodes as Record<string, unknown>))
    if (isComponentNode(n)) out.push(id)
  return out.sort(compareCodeUnits)
}

/** Qualified ids (`alias:id`) of a loaded library's components, sorted. */
export function libraryComponents(libraries: Libraries, alias: string): string[] {
  const lib = libraries[alias]
  if (!lib) return []
  return localComponents(lib).map((id) => `${alias}:${id}`)
}

/**
 * The component a node belongs to as content: the nearest ancestor-or-self with a truthy
 * `component`, or null. (Used to tell "inside a main" apart from page content.)
 */
export function enclosingComponent(doc: Pick<KimoDocument, "nodes">, id: string): string | null {
  const nodes = doc.nodes as Record<string, unknown>
  const seen = new Set<string>()
  let cur: unknown = id
  while (typeof cur === "string" && !seen.has(cur)) {
    seen.add(cur)
    const n = nodes[cur]
    if (!isObject(n)) return null
    if (n.component) return cur
    cur = n.parent
  }
  return null
}
