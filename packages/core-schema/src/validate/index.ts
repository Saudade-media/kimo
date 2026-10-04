/**
 * `validate(doc)`: structural checks (compiled TypeBox schemas) plus the semantic rules of
 * teardown 10.6 and the spec's "Validation" section.
 */
import Type from "typebox"
import { isKnownFeature, KNOWN_FEATURES } from "../features"
import { escapePointer, isObject } from "../json"
import {
  effectiveTheme,
  isRef,
  isThemedValue,
  type Libraries,
  resolveVariable,
  splitQualified,
  type Theme,
} from "../resolve"
import { COMPOSITE_VARIABLE_TYPES, KimoDocument, Variable } from "../schema/document"
import {
  CONTAINER_TYPES,
  isNodeType,
  NODE_SCHEMAS,
  nodeKeys,
  PLACEMENT_KEYS,
  VISUAL_KEYS,
} from "../schema/nodes"
import {
  ASSET_REF_PATTERN,
  ID_PATTERN,
  RecordOf,
  VARIABLE_NAME_PATTERN,
} from "../schema/primitives"
import { compareCodeUnits, getOrInit } from "../tree"
import { formatStatus, SCHEMA_URL, SCHEMA_URL_PATTERN } from "../version"
import { IssueSink, type ValidationResult } from "./issues"
import { checkConflicts } from "./merge"
import { schemaIssues } from "./structural"

export * from "./issues"

/** Options for {@link validate}. */
export interface ValidateOptions {
  /**
   * Imported library documents keyed by this document's import alias. References into a
   * library that is not supplied are not checked (one `LIBRARY_NOT_LOADED` warning per alias).
   */
  libraries?: Libraries
  /** File names present in the `assets/` folder; when given, every asset reference must exist. */
  assetFiles?: Iterable<string>
  /** Features this reader supports (default: every feature known to format 0.1). */
  supportedFeatures?: Iterable<string>
  /** Run the lints (warnings) of 10.6. Default true. */
  lints?: boolean
  /**
   * Incremental mode: run only the rules that belong to these node ids, for editors that
   * re-check the nodes an edit touched instead of the whole document. Per-node rules run for
   * the listed nodes; cross-node rules run where a listed node takes part (sibling order ties in
   * its sibling group, parent cycles through it, the fit lint of a listed frame). Document-level
   * checks (header, `features`, `variables`, the components index, prop declarations, instance
   * cycles, unused variables and assets) are skipped.
   *
   * The caller owns the scope: it must list every node whose issues can change (the edited
   * nodes, their old and new parents, their children) and run a full validation instead when
   * the edit changes how components, instances or slot children are put together (type,
   * placement, `component`, `of`, overrides, props, args, slots), a main component itself,
   * variables, themes or header members, whose rules reach across the tree. A theme pin
   * reaches the pinned node's subtree (effective theme of its bindings). Other fields of nodes
   * inside components and instances are checked per node: override and prop checks read a
   * target's type, never its other values. Ids missing from the document are ignored.
   */
  nodes?: Iterable<string>
  /**
   * With `nodes` (incremental mode): variables whose own rules also run — their schema, the
   * composite-type feature flag, the bindings and `when` pins in their values — plus alias
   * cycles over all variables. For a header edit that keeps every variable's name and type and
   * every alias edge (the caller checks that), these and the nodes binding them (in `nodes`)
   * are all the issues it can change.
   */
  variables?: Iterable<string>
}

type Obj = Record<string, unknown>

const HeaderSchema = Type.Object(
  {
    ...KimoDocument.properties,
    variables: Type.Optional(RecordOf(VARIABLE_NAME_PATTERN, Type.Unknown())),
    nodes: RecordOf(ID_PATTERN, Type.Unknown()),
  },
  { additionalProperties: false },
)

const ASSET_REF_RE = new RegExp(ASSET_REF_PATTERN)

/** Keys whose binding must name a variable of one of these types. */
const REF_TYPES: Record<string, readonly string[]> = {}
for (const k of ["fill", "color", "colors", "paint"]) REF_TYPES[k] = ["color"]
for (const k of [
  "opacity",
  "gap",
  "crossGap",
  "pad",
  "radius",
  "width",
  "t",
  "r",
  "b",
  "l",
  "x",
  "y",
  "blur",
  "spread",
  "size",
  "lineHeight",
  "letterSpacing",
  "weight",
  "strokeWidth",
  "w",
  "h",
])
  REF_TYPES[k] = ["number", "dimension"]
for (const k of ["visible", "clip"]) REF_TYPES[k] = ["boolean"]
for (const k of ["content", "icon", "font"]) REF_TYPES[k] = ["string"]
REF_TYPES.effects = ["shadow"]
REF_TYPES.typography = ["typography"]

/** Keys never set by a `set` override: identity and tree position, or nested override maps. */
const SET_FORBIDDEN = new Set(["type", "parent", "at", "order", "component", "overrides"])
/** Keys never set through an instance's `props`. */
const PROPS_FORBIDDEN = new Set([...PLACEMENT_KEYS, "component"])

const ptr = (...tokens: string[]) => tokens.map((t) => `/${escapePointer(t)}`).join("")

/** A node located in the consumer document or in a loaded library. */
interface Located {
  doc: KimoDocument
  /** Consumer alias of the library, or null for the document being validated. */
  alias: string | null
  id: string
  node: Obj
}

type PathResult =
  | { status: "ok"; target: Located }
  | { status: "unresolved"; reason: string }
  | { status: "unchecked"; alias: string }

/**
 * Validates a document. Never throws for any JSON input.
 *
 * Documents whose `format` is not this reader's major.minor are not checked beyond the version
 * (`FORMAT_NEWER` / `FORMAT_OLDER` / `FORMAT_INVALID`); migrate older documents first.
 */
export function validate(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const sink = new IssueSink()
  if (!isObject(input)) {
    sink.add("NOT_AN_OBJECT", "", "A .kimo document must be a JSON object")
    return sink.result()
  }
  const status = formatStatus(input.format)
  if (status === "invalid") {
    sink.add("FORMAT_INVALID", "/format", `Invalid format ${JSON.stringify(input.format)}`)
    return sink.result()
  }
  if (status === "newer") {
    sink.add(
      "FORMAT_NEWER",
      "/format",
      `Format ${input.format} is newer than this reader; open read-only`,
    )
    return sink.result()
  }
  if (status === "older") {
    sink.add("FORMAT_OLDER", "/format", `Format ${input.format} must be migrated before validation`)
    return sink.result()
  }
  new Validation(input, options, sink).run()
  return sink.result()
}

class Validation {
  private readonly doc: KimoDocument
  private readonly nodes: Record<string, Obj> = {}
  private readonly variables: Record<string, Obj> = {}
  private readonly libraries: Libraries
  private readonly features: Set<string>
  private readonly lints: boolean
  private readonly libsNotLoaded = new Set<string>()
  private readonly usedVariables = new Set<string>()
  private readonly usedAssets = new Set<string>()
  private readonly assetFiles: Set<string> | null
  private readonly themeCache = new Map<string, Theme>()
  /** Node ids of an incremental run (see {@link ValidateOptions.nodes}); null = everything. */
  private readonly scope: ReadonlySet<string> | null

  constructor(
    raw: Obj,
    private readonly options: ValidateOptions,
    private readonly sink: IssueSink,
  ) {
    this.doc = raw as unknown as KimoDocument
    if (isObject(raw.nodes)) {
      for (const [id, n] of Object.entries(raw.nodes)) if (isObject(n)) this.nodes[id] = n
    }
    if (isObject(raw.variables)) {
      for (const [name, v] of Object.entries(raw.variables))
        if (isObject(v)) this.variables[name] = v
    }
    this.libraries = options.libraries ?? {}
    this.features = new Set(
      Array.isArray(raw.features)
        ? raw.features.filter((f): f is string => typeof f === "string")
        : [],
    )
    this.lints = options.lints !== false
    this.assetFiles = options.assetFiles ? new Set(options.assetFiles) : null
    this.scope = options.nodes ? new Set(options.nodes) : null
    this.scopeVars = this.scope && options.variables ? new Set(options.variables) : null
  }

  /** Variables re-checked in an incremental run (ValidateOptions `variables`). */
  private readonly scopeVars: ReadonlySet<string> | null

  /** Node entries in scope: every node, or the listed ones in an incremental run. */
  private scoped(): [string, Obj][] {
    if (!this.scope) return Object.entries(this.nodes)
    const out: [string, Obj][] = []
    for (const id of this.scope) {
      const n = Object.hasOwn(this.nodes, id) ? this.nodes[id] : undefined
      if (n) out.push([id, n])
    }
    return out
  }

  /** Variable entries in scope: every variable, the listed ones, or none (incremental). */
  private scopedVariables(): [string, Obj][] {
    if (!this.scope) return Object.entries(this.variables)
    const out: [string, Obj][] = []
    for (const name of this.scopeVars ?? []) {
      const v = Object.hasOwn(this.variables, name) ? this.variables[name] : undefined
      if (v) out.push([name, v])
    }
    return out
  }

  run(): void {
    this.structure()
    this.featureFlags()
    this.tree()
    this.components()
    this.instances()
    this.bindingsAndValues()
    this.variableAliases()
    this.assets()
    if (!this.scope) {
      checkConflicts(this.doc as unknown as Obj, this.sink, this.lints, (feature, path, what) => {
        if (!this.features.has(feature))
          this.sink.add("FEATURE_NOT_DECLARED", path, `${what} needs feature "${feature}"`)
      })
    }
    for (const alias of [...this.libsNotLoaded].sort(compareCodeUnits)) {
      this.sink.add(
        "LIBRARY_NOT_LOADED",
        ptr("imports", alias),
        `Library "${alias}" was not supplied; references into it were not checked`,
      )
    }
    if (this.lints) this.runLints()
  }

  // --- Structure ------------------------------------------------------------------------------

  private structure(): void {
    const raw = this.doc as unknown as Obj
    if (this.scope) {
      const all = isObject(raw.nodes) ? raw.nodes : {}
      for (const id of this.scope) if (Object.hasOwn(all, id)) this.nodeStructure(id, all[id])
      const vars = isObject(raw.variables) ? raw.variables : {}
      for (const name of this.scopeVars ?? [])
        if (Object.hasOwn(vars, name))
          schemaIssues(Variable, vars[name], ptr("variables", name), this.sink)
      return
    }
    const url = raw.$schema
    if (typeof url === "string" && url !== SCHEMA_URL && new RegExp(SCHEMA_URL_PATTERN).test(url)) {
      this.sink.add(
        "SCHEMA_URL_MISMATCH",
        "/$schema",
        `Expected "${SCHEMA_URL}" for format ${raw.format}`,
      )
    }
    schemaIssues(HeaderSchema, raw, "", this.sink)
    for (const [name, v] of Object.entries(isObject(raw.variables) ? raw.variables : {})) {
      schemaIssues(Variable, v, ptr("variables", name), this.sink)
    }
    for (const [id, n] of Object.entries(isObject(raw.nodes) ? raw.nodes : {}))
      this.nodeStructure(id, n)
  }

  private nodeStructure(id: string, n: unknown): void {
    const path = ptr("nodes", id)
    if (!isObject(n)) {
      this.sink.add("SCHEMA", path, "A node must be an object")
      return
    }
    if (!isNodeType(n.type)) {
      this.sink.add(
        "UNKNOWN_NODE_TYPE",
        `${path}/type`,
        typeof n.type === "string" ? `Unknown node type "${n.type}"` : "Missing node type",
      )
      return
    }
    const isInstance = n.type === "instance"
    schemaIssues(NODE_SCHEMAS[n.type], n, path, this.sink, (p, name) => {
      if (!isInstance || !VISUAL_KEYS.has(name)) return false
      this.sink.add("INSTANCE_VISUAL_FIELD", p, `"${name}" is a visual field; put it in "props"`)
      return true
    })
  }

  // --- Features -------------------------------------------------------------------------------

  private featureFlags(): void {
    const supported = new Set(this.options.supportedFeatures ?? KNOWN_FEATURES)
    ;[...this.features].forEach((f, i) => {
      if (this.scope) return
      if (!isKnownFeature(f) || !supported.has(f)) {
        this.sink.add(
          "FEATURE_UNKNOWN",
          `/features/${i}`,
          `Unknown feature "${f}"; the file opens read-only`,
        )
      }
    })
    const need = (feature: string, path: string, what: string) => {
      if (!this.features.has(feature)) {
        this.sink.add("FEATURE_NOT_DECLARED", path, `${what} needs feature "${feature}"`)
      }
    }
    for (const [id, n] of this.scoped()) {
      const base = ptr("nodes", id)
      if (n.type === "script") need("node/script", `${base}/type`, "A script node")
      if (n.type === "browser") need("node/browser", `${base}/type`, "A browser node")
      const gate = (v: unknown, path: string, key: string | null): boolean => {
        // Opaque records (Appendix B) hold data, not paints or text styles.
        if (key === "inputs" || key === "uniforms" || key === "args") return false
        // Enum option values are values of the prop's `field`: gate them as that field.
        if (key === "options") return false
        if (
          isObject(v) &&
          v.type === "enum" &&
          typeof v.field === "string" &&
          isObject(v.options)
        ) {
          for (const [opt, value] of Object.entries(v.options))
            walk(value, `${path}/options/${escapePointer(opt)}`, v.field, gate)
        }
        if (key === "layout" && isObject(v)) {
          // A value equal to its default never needs a feature (applyDefaults must stay valid).
          if ("wrap" in v && v.wrap !== false) need("layout/wrap", `${path}/wrap`, "layout.wrap")
          if ("crossGap" in v && v.crossGap !== 0)
            need("layout/wrap", `${path}/crossGap`, "layout.crossGap")
          if (v.align === "stretch" || v.align === "baseline")
            need("layout/stretch-baseline", `${path}/align`, `layout.align "${v.align}"`)
        }
        if ((key === "w" || key === "h") && isObject(v) && ("min" in v || "max" in v))
          need("size/min-max", path, "Size min/max")
        if (key === "content" && Array.isArray(v)) need("text/runs", path, "Rich-text content")
        if (key === "effects" && isRef(v))
          need("tokens/composite", path, "Effects bound to a variable")
        if (key === "style" && isObject(v) && v.typography !== undefined)
          need("tokens/composite", `${path}/typography`, "style.typography")
        if (isObject(v) && v.kind === "mesh") need("fill/mesh", path, "A mesh paint")
        if (isObject(v) && v.kind === "shader") need("fill/shader", path, "A shader paint")
        return true
      }
      walk(n, base, null, gate)
    }
    for (const [name, v] of this.scopedVariables()) {
      if (COMPOSITE_VARIABLE_TYPES.has(v.type as never))
        need("tokens/composite", ptr("variables", name, "type"), `A "${v.type}" variable`)
    }
  }

  // --- Tree -----------------------------------------------------------------------------------

  private tree(): void {
    const groups = new Map<string, Map<string, string[]>>()
    const groupKey = (n: Obj) =>
      typeof n.order === "string" && (n.parent === null || typeof n.parent === "string")
        ? `${n.parent ?? ""}\u0000${typeof n.at === "string" ? n.at : ""}`
        : null
    for (const [id, n] of this.scoped()) {
      const base = ptr("nodes", id)
      const at = n.at
      if (n.parent === null) {
        if (at !== undefined)
          this.sink.add("AT_WITHOUT_INSTANCE", `${base}/at`, "A root node cannot have `at`")
      } else if (typeof n.parent === "string") {
        const p = this.nodes[n.parent]
        if (!p) {
          this.sink.add("PARENT_MISSING", `${base}/parent`, `Parent "${n.parent}" does not exist`)
        } else if (p.type === "instance") {
          if (typeof at !== "string") {
            this.sink.add(
              "INSTANCE_CHILD_WITHOUT_AT",
              `${base}/parent`,
              `Node's parent "${n.parent}" is an instance, so the node needs "at"`,
            )
          } else {
            const ov = isObject(p.overrides) ? p.overrides[at] : undefined
            if (!isObject(ov) || !(ov.slot === true || ov.replace === true)) {
              this.sink.add(
                "AT_WITHOUT_OVERRIDE",
                `${base}/at`,
                `Instance "${n.parent}" has no "slot" or "replace" override at "${at}"`,
              )
            }
          }
        } else {
          if (at !== undefined) {
            this.sink.add(
              "AT_WITHOUT_INSTANCE",
              `${base}/at`,
              `"at" is only allowed when the parent is an instance`,
            )
          }
          if (isNodeType(p.type) && !CONTAINER_TYPES.has(p.type)) {
            this.sink.add(
              "PARENT_NOT_CONTAINER",
              `${base}/parent`,
              `A "${p.type}" node cannot have children`,
            )
          }
        }
      }
    }
    // Sibling groups: all of them, or the groups of the scoped nodes.
    // Incremental: only siblings that share a parent and an order key with a scoped node.
    let wanted: Set<string> | null = null
    let parents: Set<unknown> | null = null
    let orders: Set<unknown> | null = null
    if (this.scope) {
      wanted = new Set()
      parents = new Set()
      orders = new Set()
      for (const [, n] of this.scoped()) {
        const key = groupKey(n)
        if (key === null) continue
        wanted.add(key)
        parents.add(n.parent)
        orders.add(n.order)
      }
    }
    for (const [id, n] of Object.entries(this.nodes)) {
      if (parents && !(orders?.has(n.order) && parents.has(n.parent))) continue
      const key = groupKey(n)
      if (key === null || (wanted && !wanted.has(key))) continue
      getOrInit(
        getOrInit(groups, key, () => new Map<string, string[]>()),
        n.order as string,
        () => [],
      ).push(id)
    }
    for (const byOrder of groups.values()) {
      for (const [order, ids] of byOrder) {
        if (ids.length < 2) continue
        ids.sort(compareCodeUnits)
        for (const id of ids.slice(1)) {
          this.sink.add(
            "ORDER_DUPLICATE",
            ptr("nodes", id, "order"),
            `Sibling "${ids[0]}" has the same order "${order}"; ties sort by id`,
          )
        }
      }
    }
    // Cycles: colour nodes while walking parent links.
    const state = new Map<string, 1 | 2>()
    for (const start of this.scope ?? Object.keys(this.nodes)) {
      const path: string[] = []
      let id: string | undefined = start
      while (id !== undefined && this.nodes[id] && !state.has(id)) {
        state.set(id, 1)
        path.push(id)
        const parent: unknown = this.nodes[id]?.parent
        id = typeof parent === "string" ? parent : undefined
      }
      if (id !== undefined && state.get(id) === 1) {
        const cycle = path.slice(path.indexOf(id))
        for (const c of cycle) {
          this.sink.add(
            "PARENT_CYCLE",
            ptr("nodes", c, "parent"),
            `Parent links form a cycle: ${cycle.join(" → ")}`,
          )
        }
      }
      for (const p of path) state.set(p, 2)
    }
    // Replace overrides: exactly one replacement node.
    for (const [id, n] of this.scoped()) {
      if (n.type !== "instance" || !isObject(n.overrides)) continue
      for (const [key, ov] of Object.entries(n.overrides)) {
        if (!isObject(ov) || ov.replace !== true) continue
        const count = Object.values(this.nodes).filter(
          (c) => c.parent === id && c.at === key,
        ).length
        if (count !== 1) {
          this.sink.add(
            "REPLACE_COUNT",
            ptr("nodes", id, "overrides", key),
            `A "replace" override needs exactly one node with parent "${id}" and at "${key}" (found ${count})`,
          )
        }
      }
    }
  }

  /** Ancestors of a node (nearest first), cycle-safe. */
  private ancestors(id: string): string[] {
    const out: string[] = []
    const seen = new Set([id])
    let p = this.nodes[id]?.parent
    while (typeof p === "string" && this.nodes[p] && !seen.has(p)) {
      seen.add(p)
      out.push(p)
      p = this.nodes[p]?.parent
    }
    return out
  }

  // --- Components -----------------------------------------------------------------------------

  /** Finds the node a qualified id names, from the consumer's namespace. */
  private lookup(qid: string, path: string): Located | "missing" | "unchecked" {
    const { alias, name } = splitQualified(qid)
    if (alias === null) {
      const node = this.nodes[name]
      return node ? { doc: this.doc, alias: null, id: name, node } : "missing"
    }
    if (!this.doc.imports || !Object.hasOwn(this.doc.imports, alias)) {
      this.sink.add("ALIAS_UNKNOWN", path, `Alias "${alias}" is not declared in "imports"`)
      return "unchecked"
    }
    const lib = this.libraries[alias]
    if (!lib) {
      this.libsNotLoaded.add(alias)
      return "unchecked"
    }
    const node = (lib.nodes as Record<string, unknown>)[name]
    return isObject(node) ? { doc: lib, alias, id: name, node } : "missing"
  }

  /** Resolves a component reference (`of`, instance prop default, `set.of`). */
  private component(qid: unknown, path: string): Located | null {
    if (typeof qid !== "string") return null
    const found = this.lookup(qid, path)
    if (found === "unchecked") return null
    if (found === "missing") {
      this.sink.add("REF_MISSING", path, `"${qid}" does not exist`)
      return null
    }
    if (!found.node.component) {
      this.sink.add("REF_NOT_COMPONENT", path, `"${qid}" is not a component`)
      return null
    }
    return found
  }

  /** True when `id` is a strict descendant of `ancestor` in `doc`. */
  private static descends(doc: KimoDocument, id: string, ancestor: string): boolean {
    const nodes = doc.nodes as Record<string, unknown>
    const seen = new Set<string>()
    let p = (nodes[id] as Obj | undefined)?.parent
    while (typeof p === "string" && !seen.has(p)) {
      if (p === ancestor) return true
      seen.add(p)
      p = (nodes[p] as Obj | undefined)?.parent
    }
    return false
  }

  /**
   * Resolves an id path relative to a component (override keys, `at`, prop targets). Each
   * segment is looked up among the descendants of the current component, in that component's
   * namespace (bare ids locally, `alias:id` inside a library); every segment but the last must
   * be an instance, whose component becomes the next namespace.
   */
  private resolvePath(
    root: Located,
    path: string,
    swaps?: ReadonlyMap<string, string>,
  ): PathResult {
    let ctx = root
    const segments = path.split("/")
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as string
      const { alias, name } = splitQualified(seg)
      // Derived components (an instance marked `component`) are transparent: look through them.
      let found: Located | null = null
      const seen = new Set<string>()
      for (;;) {
        const node = (ctx.doc.nodes as Record<string, unknown>)[name]
        if (alias === ctx.alias && isObject(node) && Validation.descends(ctx.doc, name, ctx.id)) {
          found = { doc: ctx.doc, alias: ctx.alias, id: name, node }
          break
        }
        if (ctx.node.type !== "instance" || seen.has(ctx.id)) break
        seen.add(ctx.id)
        const next = this.componentOf(ctx)
        if (next === null) break
        if (next === "unchecked")
          return { status: "unchecked", alias: String(ctx.node.of).split(":")[0] as string }
        ctx = next
      }
      if (!found) {
        if (alias !== ctx.alias) {
          return {
            status: "unresolved",
            reason:
              ctx.alias === null
                ? `segment "${seg}" must be a local id (the component is local)`
                : `segment "${seg}" must be written "${ctx.alias}:${name}"`,
          }
        }
        return { status: "unresolved", reason: `"${seg}" is not a descendant of "${ctx.id}"` }
      }
      if (i === segments.length - 1) return { status: "ok", target: found }
      if (found.node.type !== "instance") {
        return {
          status: "unresolved",
          reason: `"${seg}" is not an instance, so the path cannot continue`,
        }
      }
      // A swap of this nested instance by the holder (`set.of`, instance-prop arg): the path
      // continues in the swapped component (§9.8, last paragraph).
      const swapped = swaps?.get(segments.slice(0, i + 1).join("/"))
      const via: Located =
        swapped === undefined
          ? found
          : { doc: this.doc, alias: null, id: "", node: { of: swapped } }
      const next = this.componentOf(via)
      if (next === "unchecked")
        return { status: "unchecked", alias: String(via.node.of).split(":")[0] as string }
      if (next === null)
        return { status: "unresolved", reason: `"${seg}" is an instance of a missing component` }
      ctx = next
    }
    return { status: "unresolved", reason: "empty path" }
  }

  /**
   * The component an instance (located in the consumer or a library) instantiates. Inside a
   * library, `of` uses the library's own namespace; a library's imports are not followed in 0.1.
   */
  private componentOf(inst: Located): Located | "unchecked" | null {
    if (typeof inst.node.of !== "string") return null
    const of = splitQualified(inst.node.of)
    if (inst.alias === null) {
      if (of.alias === null) {
        const c = this.nodes[of.name]
        return c ? { doc: this.doc, alias: null, id: of.name, node: c } : null
      }
      const lib = this.libraries[of.alias]
      if (!lib) return "unchecked"
      const c = (lib.nodes as Record<string, unknown>)[of.name]
      return isObject(c) ? { doc: lib, alias: of.alias, id: of.name, node: c } : null
    }
    if (of.alias !== null) return "unchecked"
    const c = (inst.doc.nodes as Record<string, unknown>)[of.name]
    return isObject(c) ? { doc: inst.doc, alias: inst.alias, id: of.name, node: c } : null
  }

  /** Follows derived components down to the first non-instance component root. */
  private baseRoot(c: Located): Located | null {
    let cur: Located = c
    const seen = new Set<string>()
    while (cur.node.type === "instance") {
      if (seen.has(cur.id)) return null
      seen.add(cur.id)
      const next = this.componentOf(cur)
      if (next === null || next === "unchecked") return null
      cur = next
    }
    return cur
  }

  /**
   * Component swaps instance `n` (of component `c`) applies to its nested instances: IdPath →
   * consumer QId, from instance-prop args, then `set.of` overrides (which win, §9.3).
   */
  private swapsOf(c: Located, n: Obj): Map<string, string> {
    const out = new Map<string, string>()
    if (isObject(n.args)) {
      const props = this.declaredProps(c)
      for (const [name, value] of Object.entries(n.args)) {
        const prop = Object.hasOwn(props, name) ? props[name] : undefined
        if (prop?.type !== "instance" || typeof prop.target !== "string") continue
        if (typeof value !== "string") continue
        const target =
          c.alias === null
            ? prop.target
            : prop.target
                .split("/")
                .map((seg) => (seg.includes(":") ? seg : `${c.alias}:${seg}`))
                .join("/")
        out.set(target, value)
      }
    }
    if (isObject(n.overrides))
      for (const [k, ov] of Object.entries(n.overrides))
        if (isObject(ov) && isObject(ov.set) && typeof ov.set.of === "string") out.set(k, ov.set.of)
    return out
  }

  /**
   * Local components holding the node at `path` of an instance of `c`: `c`'s derived chain
   * and the (possibly swapped) component of every instance the path crosses.
   */
  private holders(c: Located, path: string, swaps: ReadonlyMap<string, string>): string[] {
    const out: string[] = []
    const chain = (l: Located | null | "unchecked") => {
      const seen = new Set<string>()
      let cur = l
      while (cur && cur !== "unchecked" && cur.alias === null && !seen.has(cur.id)) {
        seen.add(cur.id)
        out.push(cur.id)
        if (cur.node.type !== "instance") break
        cur = this.componentOf(cur)
      }
    }
    chain(c)
    const segs = path.split("/")
    for (let i = 1; i < segs.length; i++) {
      const prefix = segs.slice(0, i).join("/")
      const r = this.resolvePath(c, prefix, swaps)
      if (r.status !== "ok") break
      const sw = swaps.get(prefix)
      chain(
        this.componentOf(
          sw === undefined ? r.target : { doc: this.doc, alias: null, id: "", node: { of: sw } },
        ),
      )
    }
    return out
  }

  private resolveOrReport(
    root: Located,
    path: string,
    at: string,
    swaps?: ReadonlyMap<string, string>,
  ): Located | null {
    for (const seg of path.split("/")) {
      const { alias } = splitQualified(seg)
      if (alias !== null && !(this.doc.imports && Object.hasOwn(this.doc.imports, alias))) {
        this.sink.add("ALIAS_UNKNOWN", at, `Alias "${alias}" is not declared in "imports"`)
        return null
      }
    }
    const r = this.resolvePath(root, path, swaps)
    if (r.status === "ok") return r.target
    if (r.status === "unchecked") {
      const imported = this.doc.imports && Object.hasOwn(this.doc.imports, r.alias)
      if (imported && !this.libraries[r.alias]) this.libsNotLoaded.add(r.alias)
      return null
    }
    this.sink.add("OVERRIDE_PATH_UNRESOLVED", at, `Path "${path}" does not resolve: ${r.reason}`)
    return null
  }

  /**
   * Checks that applying `patch` to `target` keeps it valid: unknown or invalid properties are
   * reported as OVERRIDE_INVALID under `base`.
   */
  private checkPatch(target: Obj, patch: Obj, base: string, forbidden: ReadonlySet<string>): void {
    const type = target.type
    if (!isNodeType(type)) return
    for (const key of Object.keys(patch)) {
      if (forbidden.has(key)) {
        this.sink.add(
          "OVERRIDE_INVALID",
          ptr(...pointerTokens(base), key),
          `"${key}" cannot be overridden`,
        )
      }
    }
    const merged: Obj = { ...target }
    for (const [k, v] of Object.entries(patch)) if (!forbidden.has(k)) merged[k] = v
    const tmp = new IssueSink()
    schemaIssues(NODE_SCHEMAS[type], merged, "", tmp)
    for (const issue of tmp.errors) {
      const first = pointerTokens(issue.path)[0]
      if (first === undefined || !Object.hasOwn(patch, first) || forbidden.has(first)) continue
      const message =
        issue.code === "UNKNOWN_PROPERTY"
          ? `A "${type}" node has no property "${first}"${type === "instance" && VISUAL_KEYS.has(first) ? ' (set it inside "props")' : ""}`
          : issue.message
      this.sink.add("OVERRIDE_INVALID", base + issue.path, message)
    }
  }

  private components(): void {
    if (this.scope) {
      this.slotSuggestions()
      return
    }
    // Component prop declarations.
    for (const [id, n] of Object.entries(this.nodes)) {
      const def = n.component
      if (!isObject(def) || !isObject(def.props)) continue
      const self: Located = { doc: this.doc, alias: null, id, node: n }
      for (const [name, prop] of Object.entries(def.props)) {
        if (!isObject(prop) || typeof prop.target !== "string") continue
        const base = ptr("nodes", id, "component", "props", name)
        // M3 (ADR 0011, spec §9.6): a target equal to the declaring component's own id names
        // the component root (through derived components, the base root).
        const t =
          prop.target === id
            ? this.baseRoot(self)
            : this.resolveOrReport(self, prop.target, `${base}/target`)
        if (!t) continue
        const tt = t.node.type
        const bad = (msg: string) => this.sink.add("PROP_TARGET_INVALID", `${base}/target`, msg)
        switch (prop.type) {
          case "text":
            if (tt !== "text") bad(`A text prop must target a text node (found "${tt}")`)
            break
          case "boolean":
            if (tt === "instance")
              bad(`A boolean prop cannot target an instance (use a wrapper frame)`)
            break
          case "instance":
            if (tt !== "instance") bad(`An instance prop must target an instance (found "${tt}")`)
            if (prop.default !== undefined) this.component(prop.default, `${base}/default`)
            break
          case "slot":
            if (tt !== "frame" || !isObject(t.node.slot)) {
              this.sink.add(
                "SLOT_TARGET_INVALID",
                `${base}/target`,
                `A slot prop must target a frame with "slot"`,
              )
            }
            break
          case "enum": {
            const field = String(prop.field)
            if (!isNodeType(tt) || !nodeKeys(tt).has(field) || SET_FORBIDDEN.has(field)) {
              bad(`A "${tt}" node has no overridable property "${field}"`)
              break
            }
            if (isObject(prop.options)) {
              for (const [opt, value] of Object.entries(prop.options)) {
                this.checkPatch(
                  t.node,
                  { [field]: value },
                  ptr("nodes", id, "component", "props", name, "options", opt),
                  SET_FORBIDDEN,
                )
              }
            }
            break
          }
        }
      }
    }
    // The optional components index.
    const index = (this.doc as unknown as Obj).components
    if (Array.isArray(index)) {
      index.forEach((cid, i) => {
        const n = typeof cid === "string" ? this.nodes[cid] : undefined
        if (!n?.component) {
          this.sink.add(
            "COMPONENTS_INDEX_INVALID",
            `/components/${i}`,
            `"${String(cid)}" is not a component node`,
          )
        }
      })
    }
    this.instanceCycles()
    this.slotSuggestions()
  }

  /** Slot suggestions must name components (aliases declared, local ids existing). */
  private slotSuggestions(): void {
    for (const [id, n] of this.scoped()) {
      if (n.type !== "frame" || !isObject(n.slot) || !Array.isArray(n.slot.suggested)) continue
      n.slot.suggested.forEach((qid, i) => {
        this.component(qid, ptr("nodes", id, "slot", "suggested", String(i)))
      })
    }
  }

  /**
   * INSTANCE_CYCLE among local components. Every place that puts a component inside another
   * counts: an instance's `of`, a `set.of` override (nested-instance swap), an `args` value of
   * an instance-type prop, and an instance prop's `default`. Each such site adds an edge from
   * every enclosing component to the component it names.
   */
  private instanceCycles(): void {
    interface Site {
      from: string[]
      to: string
      path: string
    }
    const sites: Site[] = []
    const enclosing = (id: string) =>
      [id, ...this.ancestors(id)].filter((a) => Boolean(this.nodes[a]?.component))
    const add = (from: string[], to: unknown, path: string) => {
      if (typeof to !== "string" || to.includes(":") || !this.nodes[to]) return
      if (from.length > 0) sites.push({ from, to, path })
    }
    // An instance-prop arg places a component at the prop's target, inside the components
    // that hold that target (the declaring chain and the instances the path crosses).
    const instanceArgs = (
      c: Located | null,
      args: unknown,
      base: string,
      from: string[],
      swaps: ReadonlyMap<string, string>,
    ) => {
      if (!c || !isObject(args)) return
      const props = this.declaredProps(c)
      for (const [name, value] of Object.entries(args)) {
        const prop = Object.hasOwn(props, name) ? props[name] : undefined
        if (prop?.type !== "instance") continue
        const target = typeof prop.target === "string" ? prop.target : ""
        add(
          [...new Set([...from, ...this.holders(c, target, swaps)])],
          value,
          `${base}/${escapePointer(name)}`,
        )
      }
    }
    const local = (qid: unknown): Located | null => {
      if (typeof qid !== "string" || qid.includes(":")) return null
      const node = this.nodes[qid]
      return node ? { doc: this.doc, alias: null, id: qid, node } : null
    }
    for (const [id, n] of Object.entries(this.nodes)) {
      const def = n.component
      if (isObject(def) && isObject(def.props)) {
        for (const [name, prop] of Object.entries(def.props)) {
          if (isObject(prop) && prop.type === "instance")
            add(
              enclosing(id),
              prop.default,
              ptr("nodes", id, "component", "props", name, "default"),
            )
        }
      }
      if (n.type !== "instance") continue
      const from = enclosing(id)
      add(from, n.of, ptr("nodes", id, "of"))
      const c = local(n.of)
      if (!c) continue
      const swaps = this.swapsOf(c, n)
      instanceArgs(c, n.args, ptr("nodes", id, "args"), from, swaps)
      if (!isObject(n.overrides)) continue
      for (const [key, ov] of Object.entries(n.overrides)) {
        if (!isObject(ov) || !isObject(ov.set)) continue
        const at = ptr("nodes", id, "overrides", key)
        // The nested instance at `key` sits inside the components holding it (§9.1).
        const holders = [...new Set([...from, ...this.holders(c, key, swaps)])]
        add(holders, ov.set.of, `${at}/set/of`)
        const r = this.resolvePath(c, key, swaps)
        if (r.status !== "ok" || r.target.node.type !== "instance") continue
        const swapped = "of" in ov.set ? local(ov.set.of) : this.componentOf(r.target)
        const sc = swapped === "unchecked" ? null : swapped
        instanceArgs(
          sc,
          ov.set.args,
          `${at}/set/args`,
          sc ? [...holders, sc.id] : holders,
          new Map(),
        )
      }
    }
    const edges = new Map<string, Set<string>>()
    for (const site of sites)
      for (const a of site.from) getOrInit(edges, a, () => new Set<string>()).add(site.to)
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set<string>()
      const stack = [from]
      while (stack.length > 0) {
        const c = stack.pop() as string
        if (c === to) return true
        if (seen.has(c)) continue
        seen.add(c)
        for (const nx of edges.get(c) ?? []) stack.push(nx)
      }
      return false
    }
    for (const site of sites) {
      const owner = site.from.find((a) => reaches(site.to, a))
      if (owner !== undefined) {
        this.sink.add(
          "INSTANCE_CYCLE",
          site.path,
          `"${site.to}" inside component "${owner}" makes the component contain itself`,
        )
      }
    }
  }

  // --- Instances ------------------------------------------------------------------------------

  private instances(): void {
    for (const [id, n] of this.scoped()) {
      if (n.type !== "instance") continue
      const base = ptr("nodes", id)
      const c = this.component(n.of, `${base}/of`)
      if (!c) continue
      const root = this.baseRoot(c)
      if (root && isObject(n.props))
        this.checkPatch(root.node, n.props, `${base}/props`, PROPS_FORBIDDEN)
      if (isObject(n.args)) this.checkArgs(c, n.args, `${base}/args`, id)
      if (!isObject(n.overrides)) continue
      const swaps = this.swapsOf(c, n)
      for (const [key, ov] of Object.entries(n.overrides)) {
        if (!isObject(ov)) continue
        const at = ptr("nodes", id, "overrides", key)
        const t = this.resolveOrReport(c, key, at, swaps)
        if (!t) continue
        if (isObject(ov.set)) {
          this.checkPatch(t.node, ov.set, `${at}/set`, SET_FORBIDDEN)
          if (t.node.type === "instance") this.checkNestedSet(t, ov.set, at, id)
        } else if (ov.slot === true && (t.node.type !== "frame" || !isObject(t.node.slot))) {
          this.sink.add(
            "SLOT_TARGET_INVALID",
            at,
            `"${key}" is not a slot frame (a frame with "slot")`,
          )
        }
      }
    }
  }

  /**
   * A `set` override on a nested instance: `set.of` must name a component, and `set.props` /
   * `set.args` are checked against the effective component (the swapped one, if any) exactly
   * like an instance's own `props` / `args`.
   */
  private checkNestedSet(target: Located, set: Obj, at: string, owner: string): void {
    let c: Located | null
    if ("of" in set) c = this.component(set.of, `${at}/set/of`)
    else {
      const r = this.componentOf(target)
      c = r === "unchecked" ? null : r
    }
    if (!c) return
    const root = this.baseRoot(c)
    if (root && isObject(set.props))
      this.checkPatch(root.node, set.props, `${at}/set/props`, PROPS_FORBIDDEN)
    if (isObject(set.args)) this.checkArgs(c, set.args, `${at}/set/args`, owner)
  }

  /**
   * The declared props of a component. A derived component (an instance marked `component`)
   * inherits the props of the component it instantiates; its own declarations win (§9.6).
   */
  private declaredProps(c: Located): Record<string, Obj> {
    const chain: Located[] = []
    const seen = new Set<string>()
    let cur: Located | null = c
    while (cur && !seen.has(`${cur.alias ?? ""}:${cur.id}`)) {
      seen.add(`${cur.alias ?? ""}:${cur.id}`)
      chain.push(cur)
      if (cur.node.type !== "instance") break
      const next = this.componentOf(cur)
      cur = next === "unchecked" ? null : next
    }
    const out: Record<string, Obj> = {}
    for (const link of chain.reverse()) {
      const def = link.node.component
      if (!isObject(def) || !isObject(def.props)) continue
      for (const [name, prop] of Object.entries(def.props)) if (isObject(prop)) out[name] = prop
    }
    return out
  }

  private checkArgs(c: Located, args: Obj, base: string, owner: string): void {
    const props = this.declaredProps(c)
    for (const [name, value] of Object.entries(args)) {
      const at = `${base}/${escapePointer(name)}`
      const prop = Object.hasOwn(props, name) ? props[name] : undefined
      if (!prop) {
        this.sink.add("ARG_UNKNOWN", at, `Component "${c.id}" declares no prop "${name}"`)
        continue
      }
      const bad = (msg: string) => this.sink.add("ARG_INVALID", at, msg)
      switch (prop.type) {
        case "text":
          if (isRef(value)) this.binding(value.$ref, at, ["string"], owner)
          else if (typeof value !== "string") bad("A text prop takes a string or a binding")
          break
        case "boolean":
          if (isRef(value)) this.binding(value.$ref, at, ["boolean"], owner)
          else if (typeof value !== "boolean") bad("A boolean prop takes a boolean or a binding")
          break
        case "instance":
          if (typeof value !== "string") bad("An instance prop takes a component id")
          else if (c.alias === null) this.component(value, at)
          break
        case "enum":
          if (
            typeof value !== "string" ||
            !isObject(prop.options) ||
            !Object.hasOwn(prop.options, value)
          ) {
            bad(
              `Expected one of: ${isObject(prop.options) ? Object.keys(prop.options).join(", ") : ""}`,
            )
          }
          break
        case "slot":
          bad("Slot content is given by nodes with `at`, not by `args`")
          break
      }
    }
  }

  // --- Bindings, theme pins, values -----------------------------------------------------------

  private bindingsAndValues(): void {
    const visit = (owner: string | null) => (v: unknown, path: string, key: string | null) => {
      if (isRef(v)) {
        this.binding(v.$ref, path, key === null ? null : (REF_TYPES[key] ?? null), owner)
        return false
      }
      if ((key === "theme" || key === "when") && isObject(v)) {
        this.pins(v, path)
        return false
      }
      if (key === "args" || key === "options" || key === "inputs" || key === "uniforms") {
        walk(v, path, null, (iv, ip) => {
          if (isRef(iv)) this.binding(iv.$ref, ip, null, owner)
          return true
        })
        return false
      }
      if (isObject(v) && v.kind === "image" && typeof v.src === "string")
        this.assetRef(v.src, `${path}/src`)
      if (
        isObject(v) &&
        v.kind === "mesh" &&
        typeof v.cols === "number" &&
        typeof v.rows === "number"
      ) {
        const n = v.cols * v.rows
        for (const k of ["colors", "points"]) {
          const list = v[k]
          if (Array.isArray(list) && list.length !== n)
            this.sink.add(
              "MESH_SIZE",
              `${path}/${k}`,
              `Expected ${n} ${k} (cols × rows), found ${list.length}`,
            )
        }
      }
      return true
    }
    for (const [id, n] of this.scoped()) walk(n, ptr("nodes", id), null, visit(id))
    for (const [name, v] of this.scopedVariables()) {
      const base = ptr("variables", name)
      const value = v.value
      const own = typeof v.type === "string" ? [v.type] : null
      const plain = (val: unknown, path: string) => {
        if (isRef(val)) this.binding(val.$ref, path, own, null, name)
        else walk(val, path, null, visit(null))
      }
      if (isThemedValue(value)) {
        value.forEach((e, i) => {
          plain(e.value, `${base}/value/${i}/value`)
          if (isObject(e.when)) this.pins(e.when, `${base}/value/${i}/when`)
        })
      } else plain(value, `${base}/value`)
    }
  }

  /** Checks one binding: target exists and its type fits `expected` (null = any). */
  private binding(
    target: string,
    path: string,
    expected: readonly string[] | null,
    owner: string | null,
    fromVariable?: string,
  ): void {
    const { alias, name } = splitQualified(target)
    let variable: Obj | undefined
    if (alias === null) {
      this.usedVariables.add(name)
      variable = this.variables[name]
      if (!variable) {
        this.sink.add("VARIABLE_MISSING", path, `Variable "${name}" does not exist`)
        return
      }
    } else {
      if (!this.doc.imports || !Object.hasOwn(this.doc.imports, alias)) {
        this.sink.add("ALIAS_UNKNOWN", path, `Alias "${alias}" is not declared in "imports"`)
        return
      }
      const lib = this.libraries[alias]
      if (!lib) {
        this.libsNotLoaded.add(alias)
        return
      }
      const lv = (lib.variables as Record<string, unknown> | undefined)?.[name]
      if (!isObject(lv)) {
        this.sink.add("VARIABLE_MISSING", path, `Library "${alias}" has no variable "${name}"`)
        return
      }
      variable = lv
    }
    const type = String(variable.type)
    if (expected && !expected.includes(type)) {
      const what = fromVariable ? `Alias in "${fromVariable}"` : "Binding"
      this.sink.add(
        "VARIABLE_TYPE_MISMATCH",
        path,
        `${what} expects ${expected.join(" or ")} but "${target}" is ${type}`,
      )
    }
    if (owner !== null && this.lints) this.themeMatch(target, path, owner)
  }

  private themeMatch(target: string, path: string, owner: string): void {
    let theme = this.themeCache.get(owner)
    if (!theme) {
      theme = effectiveTheme(this.doc, owner, this.libraries)
      this.themeCache.set(owner, theme)
    }
    const r = resolveVariable(this.doc, target, theme, this.libraries)
    if (r.ok && !r.matched) {
      const t = Object.entries(theme)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
      this.sink.add(
        "THEME_NO_MATCH",
        path,
        `"${target}" has no entry for the effective theme {${t}}`,
      )
    }
  }

  /** Theme pins and `when` conditions: axes and values must be declared. */
  private pins(pins: Obj, path: string): void {
    for (const [key, value] of Object.entries(pins)) {
      const at = `${path}/${escapePointer(key)}`
      const { alias, name } = splitQualified(key)
      let axes: Record<string, unknown> | undefined
      if (alias === null) axes = this.doc.themes as Record<string, unknown> | undefined
      else {
        if (!this.doc.imports || !Object.hasOwn(this.doc.imports, alias)) {
          this.sink.add("ALIAS_UNKNOWN", at, `Alias "${alias}" is not declared in "imports"`)
          continue
        }
        const lib = this.libraries[alias]
        if (!lib) {
          this.libsNotLoaded.add(alias)
          continue
        }
        axes = lib.themes as Record<string, unknown> | undefined
      }
      const values = axes && Object.hasOwn(axes, name) ? axes[name] : undefined
      if (!Array.isArray(values)) {
        this.sink.add("THEME_AXIS_UNKNOWN", at, `Theme axis "${key}" is not declared`)
      } else if (!values.includes(value)) {
        this.sink.add(
          "THEME_VALUE_UNKNOWN",
          at,
          `Axis "${key}" has no value ${JSON.stringify(value)}`,
        )
      }
    }
  }

  /** Local alias cycles (10.4 rule 5): reported on every variable of the cycle. */
  private variableAliases(): void {
    if (this.scope && !this.scopeVars) return
    const targets = (name: string): string[] => {
      const v = this.variables[name]
      if (!v) return []
      return (isThemedValue(v.value) ? v.value.map((e) => e.value) : [v.value])
        .filter(isRef)
        .map((r) => r.$ref)
        .filter((t) => !t.includes(":") && Object.hasOwn(this.variables, t))
    }
    const state = new Map<string, 1 | 2>()
    const stack: string[] = []
    const reported = new Set<string>()
    const dfs = (name: string): void => {
      state.set(name, 1)
      stack.push(name)
      for (const t of targets(name)) {
        if (state.get(t) === 1) {
          const cycle = stack.slice(stack.indexOf(t))
          for (const c of cycle) {
            if (reported.has(c)) continue
            reported.add(c)
            this.sink.add(
              "VARIABLE_CYCLE",
              ptr("variables", c, "value"),
              `Variable aliases form a cycle: ${[...cycle, t].join(" → ")}`,
            )
          }
        } else if (!state.has(t)) dfs(t)
      }
      stack.pop()
      state.set(name, 2)
    }
    for (const name of Object.keys(this.variables)) if (!state.has(name)) dfs(name)
  }

  // --- Assets ---------------------------------------------------------------------------------

  private assetRef(src: string, path: string): void {
    if (!ASSET_REF_RE.test(src)) return // reported structurally
    const file = src.slice("./assets/".length)
    this.usedAssets.add(file)
    const manifest = (this.doc as unknown as Obj).assets
    if (isObject(manifest) && !Object.hasOwn(manifest, file)) {
      this.sink.add("ASSET_MISSING", path, `Asset "${file}" is not in the asset manifest`)
    }
    if (this.assetFiles && !this.assetFiles.has(file)) {
      this.sink.add("ASSET_MISSING", path, `Asset file "assets/${file}" does not exist`)
    }
  }

  private assets(): void {
    const manifest = (this.doc as unknown as Obj).assets
    if (!this.lints || this.scope || !isObject(manifest)) return
    for (const file of Object.keys(manifest)) {
      if (!this.usedAssets.has(file))
        this.sink.add("ASSET_UNUSED", ptr("assets", file), `Asset "${file}" is not referenced`)
    }
  }

  // --- Lints ----------------------------------------------------------------------------------

  /**
   * A visual property of a node as rendered: for an instance, its `props` value, else the
   * component root's value (through derived components); for other nodes, the node's own.
   */
  private visual(n: Obj, key: string): unknown {
    if (n.type !== "instance") return n[key]
    if (isObject(n.props) && Object.hasOwn(n.props, key)) return n.props[key]
    const c = typeof n.of === "string" ? this.lookupQuiet(n.of) : null
    const root = c ? this.baseRoot(c) : null
    return root?.node[key]
  }

  /** {@link lookup} without reporting: a node a qualified id names, or null. */
  private lookupQuiet(qid: string): Located | null {
    const { alias, name } = splitQualified(qid)
    if (alias === null) {
      const node = this.nodes[name]
      return node ? { doc: this.doc, alias: null, id: name, node } : null
    }
    const node = (this.libraries[alias]?.nodes as Record<string, unknown> | undefined)?.[name]
    return isObject(node)
      ? { doc: this.libraries[alias] as KimoDocument, alias, id: name, node }
      : null
  }

  private runLints(): void {
    const isLibrary = isObject(this.doc.meta) && this.doc.meta.library === true
    if (!isLibrary && !this.scope) {
      for (const name of Object.keys(this.variables)) {
        if (!this.usedVariables.has(name)) {
          this.sink.add(
            "VARIABLE_UNUSED",
            ptr("variables", name),
            `Variable "${name}" is not referenced`,
          )
        }
      }
    }
    const kids = new Map<string, Obj[]>()
    for (const n of Object.values(this.nodes)) {
      if (typeof n.parent !== "string" || n.at !== undefined) continue
      if (this.scope && !this.scope.has(n.parent)) continue
      const list = kids.get(n.parent) ?? []
      list.push(n)
      kids.set(n.parent, list)
    }
    for (const [id, n] of this.scoped()) {
      if (n.type === "text" && "fill" in n) {
        const f = n.fill
        const list = Array.isArray(f) ? f : [f]
        if (list.every((p) => isObject(p) && p.visible === false)) {
          this.sink.add(
            "TEXT_INVISIBLE",
            ptr("nodes", id, "fill"),
            "The text's fill paints nothing; the text is invisible",
          )
        }
      }
      if (n.type === "prompt" && typeof n.target === "string") {
        const t = this.nodes[n.target]
        if (!isObject(t) || t.type !== "frame") {
          this.sink.add(
            "PROMPT_TARGET_MISSING",
            ptr("nodes", id, "target"),
            `"${n.target}" is not a frame of this document; a run creates a new frame instead`,
          )
        }
      }
      if (n.type === "frame" && isObject(n.layout)) {
        const flow = (kids.get(id) ?? []).filter(
          (c) => c.position !== "absolute" && this.visual(c, "visible") !== false,
        )
        if (flow.length === 0) continue
        for (const axis of ["w", "h"] as const) {
          const own = n[axis]
          const fit = own === undefined || (isObject(own) && own.mode === "fit")
          const fills = (c: Obj) => {
            const size = this.visual(c, axis)
            return isObject(size) && size.mode === "fill"
          }
          if (fit && flow.every(fills)) {
            this.sink.add(
              "FIT_ALL_FILL",
              ptr("nodes", id, axis),
              `"${axis}" fits its children, but every child fills it: the size is circular`,
            )
          }
        }
      }
    }
  }
}

/**
 * Depth-first walk over a JSON value. `visit(value, path, key)` returns false to skip the
 * children; `key` is the nearest enclosing property name (array indices are skipped over).
 * `meta` subtrees are never visited.
 */
function walk(
  value: unknown,
  path: string,
  key: string | null,
  visit: (v: unknown, path: string, key: string | null) => boolean,
): void {
  if (!visit(value, path, key)) return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walk(value[i], `${path}/${i}`, key, visit)
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "meta") continue
      walk(v, `${path}/${escapePointer(k)}`, k, visit)
    }
  }
}

function pointerTokens(p: string): string[] {
  return p === ""
    ? []
    : p
        .slice(1)
        .split("/")
        .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
}
