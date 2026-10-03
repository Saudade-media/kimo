/**
 * Instance expansion for layout and renderer (spec §9, §9.8; M3, ADR 0011).
 *
 * The expansion itself is `@kimo/core-schema` `createExpandedView` — one implementation for
 * layout, renderer, hit testing, the layers panel and the edit planners (same composite ids
 * `<instance>/<IdPath>`, same precedence, same library namespacing). This module adds what a
 * live canvas needs on top of it: **per-instance invalidation**.
 *
 * {@link createInstanceView} routes every id to the expansion of its *outermost* top-level
 * instance (a real instance, or the real instance whose `at` content holds the node) and keeps
 * one core view per such instance. {@link InstanceView.invalidateInstances} drops only the
 * named expansions, so an edit that touches one instance (or nothing instance-related) keeps
 * every other instance's node objects — the renderer's per-root pictures stay valid and a
 * frame never re-expands 1k untouched instances. Which instances an edit affects is decided by
 * the layout engine's dependency index (it knows the previous expansion of every instance);
 * a host that only calls `invalidate()` stays correct, just slower.
 *
 * Plain real nodes (outside every instance) are read straight from `base`.
 */
import {
  createExpandedView,
  defaultTheme,
  type ExpandedView,
  type ExpandedViewOptions,
  type ExpansionIssue,
  isObject,
  type KimoDocument,
  type Libraries,
  type NodeLookup,
  type NodeOrigin,
  type NodeRecord,
  parseVirtualId,
  type Theme,
  type ViewLocation,
} from "@kimo/core-schema"
import type { NodeSource } from "./types"

/** Options for {@link createInstanceView} / {@link expandInstances}. */
export interface ExpandOptions {
  /** Imported libraries by alias (for `alias:id` components). */
  libraries?: Libraries
  /** Header for theme defaults and alias checks (read on every call). */
  header?: () => Pick<KimoDocument, "themes" | "imports">
  /** Called for each expansion issue (also kept per instance in `issues(id)`). */
  onIssue?: (issue: ExpansionIssue) => void
}

/** An {@link ExpandedView} with per-instance invalidation. */
export interface InstanceView extends ExpandedView {
  /**
   * Drops the cached expansions that contain these top-level instances (real ids; an instance
   * nested in another instance's slot content drops its outermost owner) and every routing
   * cache. Call with the instances an edit affects — `[]` is valid and still refreshes routing
   * (a node may have moved into or out of an instance's slot content). With `changed` (the
   * real ids the edit inserted, updated, moved or deleted) only the routes of those nodes and
   * their descendants are recomputed (perf: other routes stay cached); without it every route
   * is dropped.
   */
  invalidateInstances(instances: Iterable<string>, changed?: Iterable<string>): void
  /** The real ids whose expansions are currently cached (outermost top-level instances). */
  cachedInstances(): readonly string[]
  /**
   * Generation of the expansion that holds `id` (verified first when suspect): unchanged while
   * that expansion is kept, so a reader can tell that nothing under it was re-expanded. −1 for
   * ids outside every instance.
   */
  stamp(id: string): number
}

/**
 * Compatibility shape of the M1/M2 `expandInstances` result: an {@link InstanceView} plus
 * `isSynthetic` (= `isVirtual`).
 * @deprecated M3: use {@link createInstanceView} (or `createExpandedView`) and `isVirtual`.
 */
export interface ExpandedNodeSource extends InstanceView {
  isSynthetic(id: string): boolean
}

/** True when `v` is an {@link InstanceView}. */
export function isInstanceView(v: unknown): v is InstanceView {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as InstanceView).invalidateInstances === "function" &&
    typeof (v as InstanceView).origin === "function"
  )
}

/** True when `v` is any core-schema {@link ExpandedView} (duck-typed). */
export function isExpandedView(v: unknown): v is ExpandedView {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ExpandedView).origin === "function" &&
    typeof (v as ExpandedView).locate === "function" &&
    typeof (v as ExpandedView).isVirtual === "function"
  )
}

/**
 * Same own keys with identical (===) values: a re-expanded node equal to its previous object
 * is returned as that object, so readers comparing node identity (renderer pictures, layout
 * diffing) see no change for content an edit did not touch.
 */
function sameRecord(a: NodeRecord, b: NodeRecord): boolean {
  if (a === b) return true
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k] || !Object.hasOwn(b, k)) return false
  return true
}

/** The real id part of a view id (`<instance>/<IdPath>` → `<instance>`), without allocating. */
const realPart = (id: string): string => {
  const i = id.indexOf("/")
  return i < 0 ? id : id.slice(0, i)
}

/** Expansion generations, unique across views (see {@link InstanceView.stamp}). */
let stampSeq = 0

/** Creates an {@link InstanceView} over `base` (a `DocStore` or `nodeSourceFromDocument`). */
export function createInstanceView(
  base: NodeSource | NodeLookup,
  options: ExpandOptions = {},
): InstanceView {
  const lookup = base as NodeLookup
  const coreOptions: ExpandedViewOptions = {}
  if (options.libraries) coreOptions.libraries = options.libraries
  if (options.header) coreOptions.header = options.header
  if (options.onIssue) coreOptions.onIssue = options.onIssue

  /** One core view per outermost top-level instance. */
  const views = new Map<string, ExpandedView>()
  /** Real id → outermost instance key (null = plain node outside every instance). */
  let routes = new Map<string, string | null>()
  /**
   * What each core view read from `base` (node objects, child lists) and the imports it was
   * built under. A full `invalidate()` only marks the views suspect: a view whose reads all
   * still hold is kept (perf: a variable or theme change re-expands nothing; a document load
   * or edit re-expands what it touched).
   */
  interface Reads {
    nodes: Map<string, NodeRecord | undefined>
    kids: { parent: string | null; at: string | null; ids: readonly string[] }[]
    imports: string
  }
  const reads = new Map<string, Reads>()
  let suspects = new Set<string>()
  const stamps = new Map<string, number>()
  const importsKey = () => JSON.stringify(options.header?.().imports ?? null)
  let imports = importsKey()
  const recording = (r: Reads): NodeLookup => ({
    getNode(id) {
      // One expansion reads a node once or always gets the same object (synchronous).
      const n = lookup.getNode(id)
      r.nodes.set(id, n)
      return n
    },
    children(parent, at) {
      const ids = lookup.children(parent, at)
      r.kids.push({ parent, at: at ?? null, ids: ids.slice() })
      return ids
    },
  })
  const holds = (r: Reads): boolean => {
    if (r.imports !== imports) return false
    for (const [id, n] of r.nodes) if (lookup.getNode(id) !== n) return false
    for (const { parent, at, ids } of r.kids) {
      const now = lookup.children(parent, at)
      if (now.length !== ids.length) return false
      for (let i = 0; i < ids.length; i++) if (now[i] !== ids[i]) return false
    }
    return true
  }
  /** Forgets the core view of `key` (its node objects stay comparable, see `retire`). */
  const dropView = (key: string) => {
    views.delete(key)
    reads.delete(key)
    stamps.delete(key)
    suspects.delete(key)
    retire(key)
  }
  /**
   * Node objects handed out per instance key since its expansion was (re)built, and those of
   * the previous expansion: a re-expanded node equal to its previous object is returned as
   * the previous object (perf: identity-stable reads across re-expansion).
   */
  const canon = new Map<string, Map<string, [raw: NodeRecord, out: NodeRecord]>>()
  const prevCanon = new Map<string, Map<string, [raw: NodeRecord, out: NodeRecord]>>()

  const viewFor = (key: string): ExpandedView => {
    let v = views.get(key)
    if (v && suspects.has(key)) {
      suspects.delete(key)
      const r = reads.get(key)
      if (!r || !holds(r)) {
        dropView(key)
        v = undefined
      }
    }
    if (!v) {
      const r: Reads = { nodes: new Map(), kids: [], imports }
      reads.set(key, r)
      v = createExpandedView(recording(r), coreOptions)
      views.set(key, v)
      stamps.set(key, ++stampSeq)
    }
    return v
  }
  /** Retires the node objects of `key`'s expansion as the comparison base of the next one. */
  const retire = (key: string) => {
    const c = canon.get(key)
    canon.delete(key)
    if (!lookup.getNode(key)) prevCanon.delete(key)
    else if (c) prevCanon.set(key, c)
  }
  const canonical = (key: string, id: string, n: NodeRecord | undefined) => {
    if (!n) return n
    let c = canon.get(key)
    if (!c) {
      c = new Map()
      canon.set(key, c)
    }
    const had = c.get(id)
    if (had && had[0] === n) return had[1]
    const p = prevCanon.get(key)?.get(id)?.[1]
    const out = p && sameRecord(p, n) ? p : n
    c.set(id, [n, out])
    return out
  }

  /** The outermost real instance whose expansion holds real node `id` (null: none). */
  const routeReal = (id: string): string | null => {
    const cached = routes.get(id)
    if (cached !== undefined) return cached
    let owner: string | null = null
    let self: string | null = null
    const seen = new Set<string>()
    let cur: string | null = id
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      const n: NodeRecord | undefined = lookup.getNode(cur)
      if (!n) break
      if (cur === id && n.type === "instance") self = id
      const p: string | null = typeof n.parent === "string" ? n.parent : null
      if (typeof n.at === "string" && p !== null) owner = p
      cur = p
    }
    // Walking up, the last `at` seen is the outermost owner.
    const key = owner ?? self
    routes.set(id, key)
    return key
  }

  /** View id → route (perf: no slicing / re-hashing per read); cleared when a route changes. */
  let vroutes = new Map<string, string | null>()
  const route = (id: string): string | null => {
    let r = vroutes.get(id)
    if (r === undefined) {
      r = routeReal(realPart(id))
      vroutes.set(id, r)
    }
    return r
  }
  const isVirtualId = (id: string) => id.includes("/")

  const view: InstanceView = {
    base: lookup,
    getNode(id) {
      const key = route(id)
      if (key !== null) return canonical(key, id, viewFor(key).getNode(id))
      return isVirtualId(id) ? undefined : lookup.getNode(id)
    },
    children(parent, at) {
      if (parent === null || at != null) return lookup.children(parent, at)
      const key = route(parent)
      if (key !== null) return viewFor(key).children(parent)
      return isVirtualId(parent) ? [] : lookup.children(parent)
    },
    isVirtual: isVirtualId,
    origin(id): NodeOrigin | null {
      const key = route(id)
      return key === null ? null : viewFor(key).origin(id)
    },
    locate(id): ViewLocation | null {
      const key = route(id)
      if (key !== null) return viewFor(key).locate(id)
      return !isVirtualId(id) && lookup.getNode(id) ? { real: id } : null
    },
    theme(id): Theme {
      // The core view's walk (§10.4 rule 1, ADR 0011): document defaults (and library axes),
      // then the pins along the expanded placement path — read through this view, so no core
      // view records the ancestors it walked as expansion reads.
      const h = options.header?.() ?? {}
      const t = defaultTheme(
        { themes: h.themes, imports: h.imports } as KimoDocument,
        options.libraries ?? {},
      )
      const chain: NodeRecord[] = []
      const seen = new Set<string>()
      let cur: string | null = id
      while (cur !== null && !seen.has(cur)) {
        seen.add(cur)
        const n: NodeRecord | undefined = view.getNode(cur)
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
    },
    issues(id) {
      if (id !== undefined) {
        const key = route(id)
        return key === null ? [] : viewFor(key).issues(id)
      }
      return [...views.values()].flatMap((v) => v.issues())
    },
    get instanceCount() {
      let n = 0
      for (const v of views.values()) n += v.instanceCount
      return n
    },
    invalidate() {
      // Every expansion is suspect; each is verified against what it read on next use.
      suspects = new Set(views.keys())
      imports = importsKey()
      routes = new Map()
      vroutes = new Map()
    },
    invalidateInstances(instances, changed) {
      const keys = new Set<string>()
      const list = [...instances]
      // Old routes first (a node may have left its owner), then the current ones.
      for (const t of list) {
        const old = routes.get(t)
        keys.add(old ?? t)
      }
      if (changed === undefined) {
        routes = new Map()
        vroutes = new Map()
      } else {
        // Only routes below a changed real node can change (its `at`, parent or type).
        const dropped = new Map<string, string | null>()
        const seen = new Set<string>()
        const drop = (id: string) => {
          if (seen.has(id)) return
          seen.add(id)
          const was = routes.get(id)
          if (was !== undefined) dropped.set(id, was)
          routes.delete(id)
          for (const c of lookup.children(id)) drop(c)
        }
        for (const id of changed) if (!isVirtualId(id)) drop(id)
        // View ids cache their route by real id: only a route that moved invalidates them.
        for (const [id, was] of dropped)
          if (routeReal(id) !== was) {
            vroutes = new Map()
            break
          }
      }
      for (const t of list) {
        const k = routeReal(t)
        if (k !== null) keys.add(k)
      }
      if (changed === undefined) {
        routes = new Map()
        vroutes = new Map()
      }
      for (const k of keys) dropView(k)
    },
    cachedInstances: () => [...views.keys()],
    stamp(id) {
      const key = route(id)
      if (key === null) return -1
      viewFor(key)
      return stamps.get(key) ?? -1
    },
  }
  return view
}

/**
 * M1/M2 entry point, now backed by the core-schema expansion through {@link createInstanceView}.
 * @deprecated M3: use {@link createInstanceView}.
 */
export function expandInstances(
  base: NodeSource | NodeLookup,
  options: ExpandOptions = {},
): ExpandedNodeSource {
  const v = createInstanceView(base, options) as ExpandedNodeSource
  v.isSynthetic = (id) => parseVirtualId(id) !== null
  return v
}
