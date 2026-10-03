/**
 * Instance expansion (spec §9; M3, ADR 0011): a read view of a document under which every
 * `instance` reads as its component's root (with derived components, `props`, `args` and
 * `overrides` applied in §9.3 precedence) and has the component's descendants as children.
 * One implementation for layout, renderer, hit testing, the layers panel and the edit
 * planners, so they agree on ids, precedence and provenance.
 *
 * **Ids.** A descendant emitted from component content gets the composite id
 * `<top instance id>/<IdPath>`: the IdPath of the node relative to the top instance's
 * component (one segment per instance boundary, `alias:id` inside a library) — exactly the key
 * an override of that instance uses (§9.5). `inst1/btnLabel` is the node an override
 * `"btnLabel"` of `inst1` targets; `inst1/row/btnLabel` is the label of nested instance `row`.
 * Real ids never contain `/`, so `parseVirtualId` splits at the first `/`. Instance-owned nodes
 * (slot content, replacements, §9.4) of a real instance are real nodes and keep their ids; an
 * owned node that is itself an instance is the top of its own expansion.
 *
 * **Library content** is rewritten into the consumer's namespace on the way out: bindings
 * `{ $ref: "ink" }` become `{ $ref: "ui:ink" }`, theme pin keys `mode` become `ui:mode`, and
 * `of` / `slot.suggested` QIds get the alias, so the consumer's resolver (§10.4 rule 6) and
 * every reader of the view see consumer-qualified values.
 *
 * **Theme.** The expanded root's `theme` is the component root's pins (through the derived
 * chain, base first) overwritten by the instance's own pins (ADR 0011); content nodes keep
 * their pins. {@link ExpandedView.theme} walks the expanded placement path (§10.4 rule 1).
 *
 * Expansion is lazy (first `getNode`/`children` that needs it) and cached until
 * {@link ExpandedView.invalidate}.
 */
import {
  type ComponentScope,
  declaredProps,
  type LocatedNode,
  qualify,
  qualifyPath,
} from "./components"
import { isObject, setOwn } from "./json"
import { defaultTheme, isRef, type Libraries, splitQualified, type Theme } from "./resolve"
import type { KimoDocument } from "./schema/document"
import { compareSiblings } from "./tree"

// --- Node access ----------------------------------------------------------------------------

/** Plain node data (structurally `@kimo/editor-state` `NodeData` and `@kimo/layout` `LayoutNodeData`). */
export type NodeRecord = Readonly<Record<string, unknown>> & {
  readonly type: string
  readonly parent: string | null
  readonly order: string
  readonly at?: string
}

/** Read access to a node table (a `DocStore` satisfies it structurally). */
export interface NodeLookup {
  getNode(id: string): NodeRecord | undefined
  /**
   * Child ids in sibling order; `null` = roots. With `at`: the instance-owned nodes of
   * instance `parent` attached at that IdPath (§9.4).
   */
  children(parent: string | null, at?: string | null): readonly string[]
}

/** A {@link NodeLookup} over a plain document (headless, tests, library documents). */
export function documentLookup(doc: Pick<KimoDocument, "nodes">): NodeLookup {
  const nodes = doc.nodes as Record<string, NodeRecord>
  const groups = new Map<string, { id: string; order: string }[]>()
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n)) continue
    const p = n.parent
    if (p !== null && (typeof p !== "string" || !Object.hasOwn(nodes, p))) continue
    if (p === null && typeof n.at === "string") continue
    const k = `${p ?? ""}\u0000${typeof n.at === "string" ? n.at : ""}`
    let l = groups.get(k)
    if (!l) {
      l = []
      groups.set(k, l)
    }
    l.push({ id, order: typeof n.order === "string" ? n.order : "" })
  }
  // Sibling lists are sorted on first read (planners look up a handful of parents).
  const sorted = new Map<string, string[]>()
  const EMPTY: string[] = []
  return {
    getNode: (id) => (Object.hasOwn(nodes, id) && isObject(nodes[id]) ? nodes[id] : undefined),
    children: (parent, at) => {
      const k = `${parent ?? ""}\u0000${at ?? ""}`
      let l = sorted.get(k)
      if (!l) {
        const g = groups.get(k)
        if (!g) return EMPTY
        l = g.sort(compareSiblings).map((e) => e.id)
        sorted.set(k, l)
      }
      return l
    },
  }
}

// --- Virtual ids ----------------------------------------------------------------------------

/** The composite id of the node at `path` inside top-level instance `instance`. */
export function virtualId(instance: string, path: string): string {
  return path === "" ? instance : `${instance}/${path}`
}

/** Splits a composite id: `{ instance, path }`, or null for a real id (no `/`). */
export function parseVirtualId(id: string): { instance: string; path: string } | null {
  const i = id.indexOf("/")
  return i < 0 ? null : { instance: id.slice(0, i), path: id.slice(i + 1) }
}

// --- Provenance -----------------------------------------------------------------------------

/** Where an applied override comes from (§9.3 precedence, low → high). */
export type OverrideLayer = "derived" | "props" | "args" | "overrides"

/** One override contribution applied to an expanded node. */
export interface AppliedOverride {
  layer: OverrideLayer
  /**
   * The instance node holding the override: a real instance id, the composite id of a nested
   * instance, or `alias:id` of a derived component in a library.
   */
  holder: string
  /**
   * The holder's key: the override IdPath (relative to the holder's component, as written),
   * the prop name for `args`, `""` for `props`.
   */
  key: string
  kind: "set" | "slot" | "replace"
  /** Property names the `set` contributes (empty for slot/replace). */
  fields: readonly string[]
}

/** About an expanded instance (a top-level real instance or a nested one). */
export interface InstanceInfo {
  /** `of` in the consumer's namespace (`alias:id` for a library component). */
  of: string
  /** The derived chain in the consumer's namespace: `of`, its base, …, the base root. */
  chain: readonly string[]
  /** True when the instance node itself is a component (a derived component). */
  derived: boolean
  /** False when the component could not be expanded (see {@link ExpandedView.issues}). */
  resolved: boolean
}

/** Provenance of a node in the view. */
export interface NodeOrigin {
  /** True for composite ids that exist only in the expansion. */
  virtual: boolean
  /**
   * The top-level real instance whose expansion emitted the node (an expanded real instance:
   * itself); null for a real node outside every expansion.
   */
  top: string | null
  /** Virtual nodes: IdPath relative to `top`'s component (`""` = the instance root). */
  path: string | null
  /** The authored node it was cloned from (instance roots: the base component root). */
  source: { alias: string | null; id: string } | null
  /** Override contributions applied to this node, low → high precedence. */
  overrides: readonly AppliedOverride[]
  /** Present when the node is an expanded instance. */
  instance?: InstanceInfo
  /** Real instance-owned node: the override it fills (§9.4). */
  owned?: { instance: string; at: string; mode: "slot" | "replace" }
  /** Slot frames: whether an instance replaced the children (and with nothing). */
  slot?: { overridden: boolean; empty: boolean }
}

/** Expansion problem codes. */
export type ExpansionIssueCode =
  | "COMPONENT_MISSING"
  | "NOT_A_COMPONENT"
  | "ALIAS_UNKNOWN"
  | "LIBRARY_NOT_LOADED"
  | "INSTANCE_CYCLE"
  /** The expansion exceeded {@link MAX_EXPANDED_NODES} view nodes and was cut short. */
  | "INSTANCE_TOO_LARGE"
  /** An override key or arg target of the top instance matched no emitted node. */
  | "OVERRIDE_PATH_UNRESOLVED"

/** A problem found while expanding; the instance still reads as a placeholder or partly. */
export interface ExpansionIssue {
  code: ExpansionIssueCode
  /** View id of the instance (top-level or composite). */
  nodeId: string
  /** The override key / prop name concerned, when any. */
  key?: string
  message: string
}

/** Reverse mapping for hit testing, selection and edits. */
export interface ViewLocation {
  /** Real node an edit to this id lands on (the top instance for virtual ids). */
  real: string
  /** For virtual ids: the top-level instance and the IdPath under it (an override key). */
  instance?: string
  path?: string
}

/** A document view with instances expanded. */
export interface ExpandedView extends NodeLookup {
  readonly base: NodeLookup
  /** True for composite ids that exist only in the expansion. */
  isVirtual(id: string): boolean
  /** Provenance of a view node; null for a real node outside every expansion. */
  origin(id: string): NodeOrigin | null
  /** Where an edit of view node `id` lands; null for an unknown id. */
  locate(id: string): ViewLocation | null
  /**
   * Effective theme of a view node (§10.4 rule 1) along the expanded placement path,
   * from the document defaults (plus loaded libraries' axes).
   */
  theme(id: string): Theme
  /** Issues of one instance (view id), or of every expansion so far. */
  issues(id?: string): readonly ExpansionIssue[]
  /**
   * Number of instance expansions performed (top-level and nested) since the view was created
   * or last fully invalidated (a partial {@link invalidate} keeps counting, so the difference
   * measures what a re-expansion redid).
   */
  readonly instanceCount: number
  /**
   * Drops cached expansions after the document changed.
   *
   * - No argument: drops everything (header, imports or a library changed; or unknown).
   * - `changed` (real ids of the base document inserted, updated, moved or deleted): drops only
   *   the expansions that read one of those nodes, or the child list of one of their current
   *   parents. Editing a main component re-expands the instances of that component (and of
   *   components nesting it); every other expansion stays cached. Library and header changes
   *   still need the no-argument form.
   */
  invalidate(changed?: Iterable<string>): void
}

/** Options for {@link createExpandedView}. */
export interface ExpandedViewOptions {
  /** Imported libraries by alias (for `alias:id` components). */
  libraries?: Libraries
  /** Header for {@link ExpandedView.theme} defaults and alias checks. Read on every call. */
  header?: () => Pick<KimoDocument, "themes" | "imports">
  /** Called for each expansion issue (also kept per instance in `issues(id)`). */
  onIssue?: (issue: ExpansionIssue) => void
}

// --- Implementation -------------------------------------------------------------------------

/** `set` keys never applied (§9.3). */
const FORBIDDEN_SET = new Set(["type", "parent", "at", "order", "component", "overrides"])
/** Placement fields (§5.2): the instance's own, never taken from the component root. */
const PLACEMENT = ["parent", "at", "order", "name", "x", "y", "position", "theme", "locked", "meta"]
/** Nested-instance depth guard (cycles are caught by the stack; this bounds pathological docs). */
const MAX_DEPTH = 64
/**
 * Emitted-node budget of one outermost expansion. Depth alone does not bound fan-out: a few
 * dozen valid components each nesting two instances of the next expand exponentially, so a
 * tiny (possibly untrusted library) document could freeze every reader. Past the budget the
 * rest of the expansion is skipped and `INSTANCE_TOO_LARGE` is reported on the top instance.
 */
export const MAX_EXPANDED_NODES = 50_000

interface Ns {
  alias: string | null
  src: NodeLookup
}

/** One contribution, shared across re-keyed layer maps so consumption can be tracked. */
interface Src extends AppliedOverride {
  used: boolean
}

interface Owner {
  ctx: Ctx
  /** Id of the holder instance in `ctx.ns`. */
  realId: string
  /** The holder's raw override key (its `at` value). */
  rawKey: string
  /** View id of the holder instance (for provenance). */
  viewId: string
}

interface LayerEntry {
  sets: { set: Record<string, unknown>; src: Src }[]
  slot?: { owner: Owner; src: Src }
  replace?: { owner: Owner; src: Src }
}
type Layers = Map<string, LayerEntry>

interface Ctx {
  ns: Ns
  /** null = real ids (page level); else ids become `${prefix}/${key}`. */
  prefix: string | null
  /** Top-level real instance of this expansion (null at page level). */
  top: string | null
  /** Overrides keyed by IdPath relative to the component whose content is emitted. */
  layers: Layers | null
  /** Components being expanded (cycle guard). */
  stack: readonly string[]
}

const entryOf = (layers: Layers, key: string): LayerEntry => {
  let e = layers.get(key)
  if (!e) {
    e = { sets: [] }
    layers.set(key, e)
  }
  return e
}

/**
 * Merges two override layers (`high` wins, §9.3: an outer instance's override of a deep path
 * wins over the nested instance's own). A `slot` or `replace` in `high` clears the other kind
 * from `low`. `set`s of `high` on a path `low` replaced target a node that is no longer there:
 * they are not applied (and stay unused, so the top instance reports them unresolved).
 */
function combine(low: Layers, high: Layers): Layers {
  const out: Layers = new Map()
  for (const [k, e] of low) out.set(k, { sets: [...e.sets], slot: e.slot, replace: e.replace })
  for (const [k, e] of high) {
    const t = entryOf(out, k)
    if (!(t.replace && !e.replace && !e.slot)) t.sets.push(...e.sets)
    if (e.slot) {
      t.slot = e.slot
      t.replace = undefined
    }
    if (e.replace) {
      t.replace = e.replace
      t.slot = undefined
    }
  }
  return out
}

function sublayers(layers: Layers | null, key: string): Layers {
  const out: Layers = new Map()
  if (!layers) return out
  const p = `${key}/`
  for (const [k, e] of layers) if (k.startsWith(p)) out.set(k.slice(p.length), e)
  return out
}

/** Rewrites library-namespace values into the consumer's namespace (see module doc). */
export function qualifyNodeData(data: Record<string, unknown>, alias: string | null) {
  if (alias === null) return data
  const out = qualifyValue(data, alias) as Record<string, unknown>
  if (isObject(data.theme)) out.theme = qualifyPins(data.theme, alias)
  if (typeof data.of === "string" && !data.of.includes(":")) out.of = `${alias}:${data.of}`
  if (isObject(data.slot) && Array.isArray(data.slot.suggested))
    out.slot = {
      ...data.slot,
      suggested: data.slot.suggested.map((q) =>
        typeof q === "string" && !q.includes(":") ? `${alias}:${q}` : q,
      ),
    }
  return out
}

function qualifyPins(pins: Record<string, unknown>, alias: string) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(pins)) setOwn(out, k.includes(":") ? k : `${alias}:${k}`, v)
  return out
}

function qualifyValue(v: unknown, alias: string): unknown {
  if (isRef(v)) return v.$ref.includes(":") ? v : { $ref: `${alias}:${v.$ref}` }
  if (Array.isArray(v)) return v.map((x) => qualifyValue(x, alias))
  if (isObject(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v))
      setOwn(out, k, k === "meta" ? x : qualifyValue(x, alias))
    return out
  }
  return v
}

function applySets(
  n: Record<string, unknown>,
  sets: readonly { set: Record<string, unknown> }[] | undefined,
): Record<string, unknown> {
  if (!sets || sets.length === 0) return n
  const out: Record<string, unknown> = { ...n }
  for (const { set } of sets)
    for (const [k, v] of Object.entries(set)) if (!FORBIDDEN_SET.has(k)) setOwn(out, k, v)
  return out
}

/** Creates a view of `base` with instances expanded. */
export function createExpandedView(
  base: NodeLookup,
  options: ExpandedViewOptions = {},
): ExpandedView {
  const libs = options.libraries ?? {}
  /**
   * Incremental invalidation (see {@link ExpandedView.invalidate}): while the outermost real
   * instance `root` expands, every base node read (`getNode`) and every child list read
   * (`children` of a parent) is recorded as a dependency of `root`, and every cached id is
   * recorded as emitted by `root`.
   */
  let root: string | null = null
  /** Dependency (real id of the base) → roots that read it. */
  let depIndex = new Map<string, Set<string>>()
  /** Root → its dependencies and the cache keys it wrote. */
  let rootInfo = new Map<string, { deps: Set<string>; emitted: Set<string> }>()
  const dep = (id: string) => {
    if (root === null) return
    const info = rootInfo.get(root)
    if (!info || info.deps.has(id)) return
    info.deps.add(id)
    const s = depIndex.get(id)
    if (s) s.add(root)
    else depIndex.set(id, new Set([root]))
  }
  const emitted = (id: string) => {
    if (root !== null) rootInfo.get(root)?.emitted.add(id)
  }
  const recording: NodeLookup = {
    getNode(id) {
      dep(id)
      return base.getNode(id)
    },
    children(parent, at) {
      if (parent !== null) dep(parent)
      return base.children(parent, at)
    },
  }
  const local: Ns = { alias: null, src: recording }
  const libNs = new Map<string, Ns | null>()
  let data = new Map<string, NodeRecord>()
  let kids = new Map<string, string[]>()
  let origins = new Map<string, NodeOrigin>()
  let issueMap = new Map<string, ExpansionIssue[]>()
  let settled = new Set<string>()
  /** Own (non-derived) override contributions of each top-level instance. */
  let topSrcs = new Map<string, Src[]>()
  let count = 0
  /** Nodes the current outermost expansion may still emit, and whether it ran out. */
  let budget = MAX_EXPANDED_NODES
  let overBudget = false

  const header = () => options.header?.() ?? {}
  /** A scope over the consumer for the component helpers (nodes read through `base`). */
  const scope: ComponentScope = {
    doc: {
      get nodes() {
        return lookupNodes(recording)
      },
      get imports() {
        return header().imports ?? Object.fromEntries(Object.keys(libs).map((a) => [a, ""]))
      },
    } as unknown as ComponentScope["doc"],
    libraries: libs,
  }

  const report = (nodeId: string, code: ExpansionIssueCode, message: string, key?: string) => {
    const issue: ExpansionIssue = { code, nodeId, message }
    if (key !== undefined) issue.key = key
    emitted(nodeId)
    const list = issueMap.get(nodeId)
    if (list) list.push(issue)
    else issueMap.set(nodeId, [issue])
    options.onIssue?.(issue)
  }

  const library = (alias: string): Ns | null => {
    if (!libNs.has(alias)) {
      const doc = libs[alias]
      libNs.set(alias, doc ? { alias, src: documentLookup(doc) } : null)
    }
    return libNs.get(alias) ?? null
  }

  /** Resolves a component QId written in namespace `ns`. */
  const resolveQId = (
    qid: unknown,
    ns: Ns,
  ): { ns: Ns; id: string; node: NodeRecord } | { code: ExpansionIssueCode; message: string } => {
    if (typeof qid !== "string" || !qid)
      return { code: "COMPONENT_MISSING", message: "instance has no `of`" }
    const { alias, name } = splitQualified(qid)
    let target = ns
    if (alias !== null) {
      if (ns.alias !== null && alias !== ns.alias)
        return {
          code: "LIBRARY_NOT_LOADED",
          message: `${qid} is in a library imported by a library (not resolved in 0.1)`,
        }
      if (ns.alias === null) {
        const imports = header().imports
        if (imports && !Object.hasOwn(imports, alias))
          return { code: "ALIAS_UNKNOWN", message: `alias "${alias}" is not imported` }
      }
      const lib = ns.alias === alias ? ns : library(alias)
      if (!lib) return { code: "LIBRARY_NOT_LOADED", message: `library "${alias}" is not loaded` }
      target = lib
    }
    const node = target.src.getNode(name)
    if (!node) return { code: "COMPONENT_MISSING", message: `component ${qid} not found` }
    return { ns: target, id: name, node }
  }

  const locatedOf = (ns: Ns, id: string, node: NodeRecord): LocatedNode => ({
    alias: ns.alias,
    id,
    node,
  })

  /**
   * An instance's own layers (props → root, args → targets, overrides), lowest first.
   *
   * Values end up in the consumer's namespace. `from.raw`: `inst` is authored data of
   * namespace `instNs` (a top-level instance, or a derived component read from its document),
   * so bindings and pins are qualified here; otherwise `inst` was already emitted through
   * {@link qualifyNodeData} (a nested instance), and only what that leaves bare is qualified:
   * override keys, `of` and pin keys inside override sets, and instance-prop arg values unless
   * the whole `args` came from an outer `set` (`from.argsFromSet`: consumer namespace).
   */
  const ownLayers = (
    inst: NodeRecord,
    instNs: Ns,
    comp: { ns: Ns; id: string; node: NodeRecord },
    owner: Omit<Owner, "rawKey">,
    derived: boolean,
    from: { raw: boolean; argsFromSet: boolean },
  ): Layers => {
    const layers: Layers = new Map()
    const alias = instNs.alias
    const q = <T>(v: T): T => (alias === null || !from.raw ? v : (qualifyValue(v, alias) as T))
    const mk = (layer: OverrideLayer, key: string, kind: Src["kind"], fields: string[]): Src => {
      const src: Src = {
        layer: derived ? "derived" : layer,
        holder: owner.viewId,
        key,
        kind,
        fields,
        used: false,
      }
      if (!derived && owner.viewId.indexOf("/") < 0) {
        const l = topSrcs.get(owner.viewId)
        if (l) l.push(src)
        else topSrcs.set(owner.viewId, [src])
      }
      return src
    }
    if (isObject(inst.props)) {
      const set = q(inst.props) as Record<string, unknown>
      entryOf(layers, "").sets.push({ set, src: mk("props", "", "set", Object.keys(set)) })
    }
    if (isObject(inst.args)) {
      const props = declaredProps(scope, locatedOf(comp.ns, comp.id, comp.node))
      for (const [name, value] of Object.entries(inst.args)) {
        const prop = props.find((p) => p.name === name)
        if (!prop) continue
        const effect = argEffectOf(prop.def as unknown as Record<string, unknown>, q(value))
        if (!effect) continue
        // Instance-prop values are QIds in the holder's namespace.
        if (
          effect.of !== undefined &&
          alias !== null &&
          !from.argsFromSet &&
          !effect.of.includes(":")
        )
          effect.set.of = `${alias}:${effect.of}`
        entryOf(layers, prop.path).sets.push({
          set: effect.set,
          src: mk("args", name, "set", Object.keys(effect.set)),
        })
      }
    }
    if (isObject(inst.overrides))
      for (const [rawKey, ov] of Object.entries(inst.overrides)) {
        if (!isObject(ov)) continue
        const key = qualifyPath(rawKey, alias)
        const e = entryOf(layers, key)
        if (isObject(ov.set)) {
          const set = { ...(q(ov.set) as Record<string, unknown>) }
          if (alias !== null && isObject(ov.set.theme)) set.theme = qualifyPins(ov.set.theme, alias)
          // A swap written inside a library names a component of that library.
          if (alias !== null && typeof set.of === "string" && !set.of.includes(":"))
            set.of = `${alias}:${set.of}`
          e.sets.push({ set, src: mk("overrides", rawKey, "set", Object.keys(set)) })
        } else if (ov.slot === true)
          e.slot = { owner: { ...owner, rawKey }, src: mk("overrides", rawKey, "slot", []) }
        else if (ov.replace === true)
          e.replace = { owner: { ...owner, rawKey }, src: mk("overrides", rawKey, "replace", []) }
      }
    return layers
  }

  const pushKid = (parent: string, id: string) => {
    emitted(parent)
    const l = kids.get(parent)
    if (l) l.push(id)
    else kids.set(parent, [id])
  }

  const srcsOf = (e: LayerEntry | undefined): Src[] => {
    if (!e) return []
    const out = e.sets.map((s) => s.src)
    if (e.slot) out.push(e.slot.src)
    if (e.replace) out.push(e.replace.src)
    for (const s of out) s.used = true
    return out
  }

  const strip = (s: Src): AppliedOverride => ({
    layer: s.layer,
    holder: s.holder,
    key: s.key,
    kind: s.kind,
    fields: s.fields,
  })

  /**
   * Expands instance `inst` (already merged with any override targeting it) at `outId`.
   * `owner` is where the instance itself lives; `outer` holds overrides from enclosing
   * instances (and, for a derived component, the instance's own layers), re-keyed to it.
   */
  const expandInstance = (
    outId: string,
    inst: NodeRecord,
    owner: { ctx: Ctx; realId: string },
    outer: Layers,
    placement: Record<string, unknown>,
    origin: NodeOrigin,
    chain: string[],
    rootThemes: Record<string, unknown>[],
    from: { raw: boolean; ofFromSet: boolean; argsFromSet: boolean },
  ): void => {
    count++
    emitted(outId)
    kids.set(outId, [])
    const info: InstanceInfo = origin.instance as InstanceInfo
    const placeholder = (code: ExpansionIssueCode, why: string) => {
      report(outId, code, why)
      info.resolved = false
      const out: Record<string, unknown> = { ...inst, ...placement }
      data.set(outId, out as NodeRecord)
      origins.set(outId, origin)
    }
    // `of` from an outer `set` (or an instance-prop arg) is a consumer-namespace QId (§11).
    const r = resolveQId(inst.of, from.ofFromSet ? local : owner.ctx.ns)
    if ("code" in r) {
      placeholder(r.code, r.message)
      return
    }
    const compKey = qualify(r.ns.alias, r.id)
    chain.push(compKey)
    if (owner.ctx.stack.includes(compKey) || owner.ctx.stack.length > MAX_DEPTH) {
      placeholder("INSTANCE_CYCLE", `instance cycle through ${compKey}`)
      return
    }
    if (!r.node.component) report(outId, "NOT_A_COMPONENT", `${compKey} is not a component`)
    const derived = origin.instance !== undefined && chain.length > 1
    const layers = combine(
      ownLayers(
        inst,
        owner.ctx.ns,
        r,
        { ctx: owner.ctx, realId: owner.realId, viewId: holderId(owner, outId, derived) },
        derived,
        { raw: from.raw, argsFromSet: from.argsFromSet },
      ),
      outer,
    )
    const stack = [...owner.ctx.stack, compKey]
    const themes = isObject(r.node.theme)
      ? [
          qualifyNodeData({ theme: r.node.theme }, r.ns.alias).theme as Record<string, unknown>,
          ...rootThemes,
        ]
      : rootThemes
    if (r.node.type === "instance") {
      // Derived component: paths resolve through it (§9.5); its own layers sit below ours.
      const ctx: Ctx = { ns: r.ns, prefix: outId, top: owner.ctx.top ?? outId, layers: null, stack }
      expandInstance(
        outId,
        r.node,
        { ctx, realId: r.id },
        layers,
        placement,
        origin,
        chain,
        themes,
        { raw: true, ofFromSet: false, argsFromSet: false },
      )
      return
    }
    info.chain = [...chain]
    const rootEntry = layers.get("")
    const applied = srcsOf(rootEntry)
    const root: Record<string, unknown> = {
      ...applySets(qualifyNodeData({ ...r.node }, r.ns.alias), rootEntry?.sets),
    }
    delete root.component
    for (const k of PLACEMENT) delete root[k]
    const pins: Record<string, unknown> = {}
    for (const t of themes) Object.assign(pins, t)
    const out: Record<string, unknown> = { ...root, ...placement }
    if (typeof r.node.name === "string" && out.name === undefined) out.name = r.node.name
    if (Object.keys(pins).length > 0) out.theme = pins
    else delete out.theme
    data.set(outId, out as NodeRecord)
    origins.set(outId, {
      ...origin,
      source: { alias: r.ns.alias, id: r.id },
      overrides: [...origin.overrides, ...applied.map(strip)],
      ...slotInfo(out, layers.get(""), r.ns, r.id),
    })
    const ctx: Ctx = { ns: r.ns, prefix: outId, top: owner.ctx.top ?? outId, layers, stack }
    emitChildren(outId, r.id, null, ctx)
  }

  /** View id of an override holder. */
  const holderId = (owner: { ctx: Ctx; realId: string }, outId: string, derived: boolean) =>
    derived ? qualify(owner.ctx.ns.alias, owner.realId) : outId

  const slotInfo = (
    n: Record<string, unknown>,
    entry: LayerEntry | undefined,
    ns: Ns,
    srcId: string,
  ): Pick<NodeOrigin, "slot"> => {
    if (n.type !== "frame" || !isObject(n.slot)) return {}
    if (entry?.slot) {
      const s = entry.slot.owner
      const empty = s.ctx.ns.src.children(s.realId, s.rawKey).length === 0
      return { slot: { overridden: true, empty } }
    }
    return { slot: { overridden: false, empty: ns.src.children(srcId).length === 0 } }
  }

  const emitChildren = (outParent: string, srcParent: string, key: string | null, ctx: Ctx) => {
    const slot = key !== null ? ctx.layers?.get(key)?.slot : undefined
    if (slot) {
      const o = slot.owner
      for (const id of o.ctx.ns.src.children(o.realId, o.rawKey))
        emitNode(id, o.ctx, outParent, { instance: o.viewId, at: o.rawKey, mode: "slot" })
      return
    }
    for (const id of ctx.ns.src.children(srcParent)) emitNode(id, ctx, outParent)
  }

  const emitNode = (
    srcId: string,
    ctx: Ctx,
    outParent: string,
    owned?: { instance: string; at: string; mode: "slot" | "replace" },
  ) => {
    const n = ctx.ns.src.getNode(srcId)
    if (!n) return
    if (ctx.prefix !== null && --budget < 0) {
      if (!overBudget && ctx.top !== null) {
        overBudget = true
        report(
          ctx.top,
          "INSTANCE_TOO_LARGE",
          `expansion exceeds ${MAX_EXPANDED_NODES} layers; the rest is not shown`,
        )
      }
      return
    }
    const key = qualify(ctx.ns.alias, srcId)
    const entry = ctx.layers?.get(key)
    if (entry?.replace) {
      const rep = entry.replace
      const applied = srcsOf(entry).map(strip)
      const o = rep.owner
      const first = o.ctx.ns.src.children(o.realId, o.rawKey)[0]
      if (first !== undefined) {
        emitNode(first, o.ctx, outParent, { instance: o.viewId, at: o.rawKey, mode: "replace" })
        const id =
          o.ctx.prefix === null ? first : `${o.ctx.prefix}/${qualify(o.ctx.ns.alias, first)}`
        const og = origins.get(id)
        if (og) origins.set(id, { ...og, overrides: [...applied, ...og.overrides] })
      }
      return
    }
    const outId = ctx.prefix === null ? srcId : `${ctx.prefix}/${key}`
    const virtual = ctx.prefix !== null
    pushKid(outParent, outId)
    const applied = srcsOf(entry)
    const merged = applySets(qualifyNodeData({ ...n }, ctx.ns.alias), entry?.sets)
    const top = ctx.top
    const path = virtual && top !== null ? outId.slice(top.length + 1) : null
    const ownedInfo = owned && !virtual && owned.instance.indexOf("/") < 0 ? owned : undefined
    if (merged.type === "instance") {
      const placement: Record<string, unknown> = { parent: outParent }
      for (const k of PLACEMENT)
        if (k !== "parent" && k !== "at" && merged[k] !== undefined) placement[k] = merged[k]
      const isTop = !virtual
      const subCtx: Ctx = isTop ? { ...ctx, top: outId } : ctx
      const origin: NodeOrigin = {
        virtual,
        top: isTop ? outId : top,
        path: isTop ? "" : path,
        source: { alias: ctx.ns.alias, id: srcId },
        overrides: applied.map(strip),
        instance: {
          of: typeof merged.of === "string" ? merged.of : "",
          chain: [],
          derived: Boolean(n.component),
          resolved: true,
        },
      }
      if (ownedInfo) origin.owned = ownedInfo
      const fromSet = (k: string) => entry?.sets.some((s) => Object.hasOwn(s.set, k)) ?? false
      expandInstance(
        outId,
        merged as NodeRecord,
        { ctx: subCtx, realId: srcId },
        isTop ? new Map() : sublayers(ctx.layers, key),
        placement,
        origin,
        [],
        isObject(merged.theme) ? [merged.theme] : [],
        // Emitted data is already in the consumer's namespace (qualifyNodeData).
        { raw: false, ofFromSet: fromSet("of"), argsFromSet: fromSet("args") },
      )
      if (isTop) finishTop(outId)
      return
    }
    const out: Record<string, unknown> = { ...merged, parent: outParent }
    delete out.at
    emitted(outId)
    data.set(outId, out as NodeRecord)
    const origin: NodeOrigin = {
      virtual,
      top,
      path,
      source: virtual ? { alias: ctx.ns.alias, id: srcId } : null,
      overrides: applied.map(strip),
      ...slotInfo(out, entry, ctx.ns, srcId),
    }
    if (ownedInfo) origin.owned = ownedInfo
    if (virtual || ownedInfo || top !== null) origins.set(outId, origin)
    emitChildren(outId, srcId, key, ctx)
  }

  /** Reports the top instance's own override keys and args that matched nothing. */
  const finishTop = (id: string) => {
    for (const src of topSrcs.get(id) ?? []) {
      if (src.used || src.layer === "props") continue
      const what = src.layer === "args" ? `arg "${src.key}"` : `override "${src.key}"`
      report(id, "OVERRIDE_PATH_UNRESOLVED", `${what} matches no layer`, src.key)
    }
  }

  const expandTop = (id: string, n: NodeRecord) => {
    const ctx: Ctx = { ns: local, prefix: null, top: id, layers: null, stack: [] }
    const placement: Record<string, unknown> = {}
    for (const k of PLACEMENT) if (n[k] !== undefined) placement[k] = n[k]
    const origin: NodeOrigin = {
      virtual: false,
      top: id,
      path: "",
      source: null,
      overrides: [],
      instance: {
        of: typeof n.of === "string" ? n.of : "",
        chain: [],
        derived: Boolean(n.component),
        resolved: true,
      },
    }
    expandInstance(
      id,
      n,
      { ctx, realId: id },
      new Map(),
      placement,
      origin,
      [],
      n.theme && isObject(n.theme) ? [n.theme] : [],
      { raw: true, ofFromSet: false, argsFromSet: false },
    )
    finishTop(id)
  }

  /**
   * Makes sure `id` is in the cache when it belongs to an expansion: the outermost real
   * ancestor attached through `at` decides which instance must be expanded first.
   */
  const ensure = (id: string): void => {
    if (data.has(id) || settled.has(id)) return
    const v = parseVirtualId(id)
    if (v) {
      ensure(v.instance)
      return
    }
    // Walk real parents: the outermost owned ancestor's instance must expand first.
    let outerOwner: string | null = null
    const seen = new Set<string>()
    let cur: string | null = id
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      const n = base.getNode(cur)
      if (!n) break
      if (typeof n.at === "string" && typeof n.parent === "string") outerOwner = n.parent
      cur = typeof n.parent === "string" ? n.parent : null
    }
    if (outerOwner !== null && !data.has(outerOwner)) ensure(outerOwner)
    if (data.has(id)) return
    const n = base.getNode(id)
    if (n?.type === "instance") {
      const outermost = root === null
      if (outermost) {
        root = id
        rootInfo.set(id, { deps: new Set(), emitted: new Set() })
        dep(id)
        budget = MAX_EXPANDED_NODES
        overBudget = false
      }
      try {
        expandTop(id, n)
      } finally {
        if (outermost) root = null
      }
    }
    settled.add(id)
  }

  /** Drops one root's expansion (every cache key it wrote) and its dependency entries. */
  const dropRoot = (r: string) => {
    const info = rootInfo.get(r)
    if (!info) return
    rootInfo.delete(r)
    for (const d of info.deps) {
      const s = depIndex.get(d)
      s?.delete(r)
      if (s && s.size === 0) depIndex.delete(d)
    }
    for (const id of info.emitted) {
      data.delete(id)
      kids.delete(id)
      origins.delete(id)
      issueMap.delete(id)
      topSrcs.delete(id)
    }
  }

  const theme = (id: string): Theme => {
    const h = header()
    const t = defaultTheme({ themes: h.themes, imports: h.imports } as KimoDocument, libs)
    const chain: NodeRecord[] = []
    const seen = new Set<string>()
    let cur: string | null = id
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      const n = view.getNode(cur)
      if (!n) break
      chain.push(n)
      cur = typeof n.parent === "string" ? n.parent : null
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const pins = chain[i]?.theme
      if (isObject(pins))
        for (const [k, v] of Object.entries(pins)) if (typeof v === "string") t[k] = v
    }
    return t
  }

  const view: ExpandedView = {
    base,
    getNode(id) {
      ensure(id)
      return data.get(id) ?? (parseVirtualId(id) ? undefined : base.getNode(id))
    },
    children(parent, at) {
      if (parent !== null && at == null) {
        ensure(parent)
        const k = kids.get(parent)
        if (k) return k
        if (parseVirtualId(parent)) return []
      }
      return base.children(parent, at)
    },
    isVirtual: (id) => parseVirtualId(id) !== null,
    origin(id) {
      ensure(id)
      return origins.get(id) ?? null
    },
    locate(id) {
      const v = parseVirtualId(id)
      if (v) {
        ensure(id)
        if (!data.has(id)) return null
        return { real: v.instance, instance: v.instance, path: v.path }
      }
      return base.getNode(id) ? { real: id } : null
    },
    theme,
    issues(id) {
      if (id !== undefined) {
        ensure(id)
        return issueMap.get(id) ?? []
      }
      return [...issueMap.values()].flat()
    },
    get instanceCount() {
      return count
    },
    invalidate(changed) {
      if (changed !== undefined) {
        const roots = new Set<string>()
        const touch = (id: string) => {
          for (const r of depIndex.get(id) ?? []) roots.add(r)
        }
        for (const id of changed) {
          touch(id)
          // A node inserted or moved under a parent whose child list an expansion read.
          const p = base.getNode(id)?.parent
          if (typeof p === "string") touch(p)
        }
        for (const r of roots) dropRoot(r)
        // "Nothing to expand" answers are cheap; a changed node may now be owned or an instance.
        settled = new Set()
        return
      }
      root = null
      depIndex = new Map()
      rootInfo = new Map()
      data = new Map()
      kids = new Map()
      origins = new Map()
      issueMap = new Map()
      settled = new Set()
      topSrcs = new Map()
      libNs.clear()
      count = 0
    },
  }
  return view
}

/** `args` value → the `set` it contributes (§9.6); `of` is reported for namespacing. */
function argEffectOf(
  def: Record<string, unknown>,
  value: unknown,
): { set: Record<string, unknown>; of?: string } | null {
  switch (def.type) {
    case "text":
      return { set: { content: value } }
    case "boolean":
      return { set: { visible: value } }
    case "instance":
      return typeof value === "string" ? { set: { of: value }, of: value } : null
    case "enum": {
      const options = def.options
      if (typeof value !== "string" || !isObject(options) || !Object.hasOwn(options, value))
        return null
      return { set: { [String(def.field)]: options[value] } }
    }
    default:
      return null
  }
}

/** A live record over a lookup's nodes for the component helpers (read-only, by id). */
function lookupNodes(base: NodeLookup): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_t, k) => (typeof k === "string" ? base.getNode(k) : undefined),
      has: (_t, k) => typeof k === "string" && base.getNode(k) !== undefined,
      getOwnPropertyDescriptor: (_t, k) => {
        const v = typeof k === "string" ? base.getNode(k) : undefined
        return v === undefined
          ? undefined
          : { value: v, enumerable: true, configurable: true, writable: false }
      },
    },
  )
}
