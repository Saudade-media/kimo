/**
 * Edit routing for instances (spec §9.3–9.5, ADR 0011). Panels and
 * the layers tree produce plain ops on the ids they show; ids inside an instance are composite
 * view ids (`<instance>/<IdPath>`) that do not exist in the store. Before an op group reaches
 * `store.apply` it is rewritten here, so every existing section edits instances correctly:
 *
 * - `update` of a composite id → merged into `overrides[path].set` of the top instance;
 * - `update` of an instance root → placement keys stay on the node, everything else goes to
 *   `props` (the root visuals layer);
 * - `delete` of a composite id → hide (`set: { visible: false }`) plus a HIDDEN_INSTEAD notice
 *   (board 15 "Can't delete Features inside an instance — hidden instead");
 * - `insert` / `move` into a composite slot frame → instance-owned content (`at` = path) and a
 *   `{ slot: true }` override; into any other composite parent → refused;
 * - `move` of a composite id → refused.
 *
 * Pure (no store, no React): unit-tested in test/m3-route.test.ts.
 */
import { InstanceNode } from "@kimo/core-schema"
import type { Op } from "@kimo/editor-state"

/** What routing reads (an `ExpandedView` satisfies it). */
interface RouteView {
  getNode(id: string): Readonly<Record<string, unknown>> | undefined
  isVirtual(id: string): boolean
  locate(id: string): { real: string; instance?: string; path?: string } | null
}

/** Real node data (the store). */
type RealLookup = (id: string) => Readonly<Record<string, unknown>> | undefined

interface RouteNotice {
  code: "HIDDEN_INSTEAD"
  /** Display name of the hidden layer. */
  name: string
  id: string
}

type RouteResult =
  | { ok: true; ops: Op[]; notices: RouteNotice[]; routed: boolean }
  | { ok: false; code: "INSTANCE_CONTENT" | "OVERRIDE_KIND"; message: string }

/** Keys an instance node holds itself (placement + identity); the rest are root visuals. */
const INSTANCE_OWN_KEYS: ReadonlySet<string> = new Set(
  Object.keys((InstanceNode as unknown as { properties: Record<string, unknown> }).properties),
)

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

interface Pending {
  props: Rec
  overrides: Rec
  touchedProps: boolean
  touchedOverrides: boolean
}

/** True when `ops` touch a composite id or an instance root (routing needed). */
function needsRouting(view: RouteView, real: RealLookup, ops: readonly Op[]): boolean {
  for (const op of ops) {
    if (op.op === "update" || op.op === "delete" || op.op === "move") {
      if (view.isVirtual(op.id)) return true
      if (op.op === "update" && real(op.id)?.type === "instance") {
        const keys = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])]
        if (keys.some((k) => !INSTANCE_OWN_KEYS.has(k))) return true
      }
    }
    if ((op.op === "insert" || op.op === "move") && typeof op.parent === "string")
      if (view.isVirtual(op.parent)) return true
  }
  return false
}

/** Rewrites an op group (see the module comment). Ops that need no routing pass through. */
export function routeOps(view: RouteView, real: RealLookup, ops: readonly Op[]): RouteResult {
  if (!needsRouting(view, real, ops)) return { ok: true, ops: [...ops], notices: [], routed: false }
  const out: Op[] = []
  const notices: RouteNotice[] = []
  const pending = new Map<string, Pending>()
  const pend = (instance: string): Pending => {
    let p = pending.get(instance)
    if (!p) {
      const n = real(instance)
      p = {
        props: isObj(n?.props) ? { ...n.props } : {},
        overrides: isObj(n?.overrides) ? { ...n.overrides } : {},
        touchedProps: false,
        touchedOverrides: false,
      }
      pending.set(instance, p)
    }
    return p
  }
  const setAt = (instance: string, path: string, set: Rec, unset: readonly string[]) => {
    const p = pend(instance)
    p.touchedOverrides = true
    const cur = p.overrides[path]
    if (isObj(cur) && !isObj(cur.set))
      return `"${path}" already has a ${Object.keys(cur)[0]} override. Reset it first`
    const next: Rec = { ...(isObj(cur) && isObj(cur.set) ? cur.set : {}), ...set }
    for (const k of unset) delete next[k]
    if (Object.keys(next).length) p.overrides[path] = { set: next }
    else delete p.overrides[path]
    return null
  }
  const slotTarget = (parent: string) => {
    const loc = view.locate(parent)
    const n = view.getNode(parent)
    if (!loc?.instance || loc.path === undefined || !n) return null
    if (n.type !== "frame" || !isObj(n.slot)) return null
    return { instance: loc.instance, path: loc.path }
  }
  const markSlot = (instance: string, path: string): string | null => {
    const p = pend(instance)
    const cur = p.overrides[path]
    if (isObj(cur) && cur.slot === true) return null
    if (isObj(cur) && cur.replace === true) return `"${path}" is replaced. Reset it first`
    p.overrides[path] = { slot: true }
    p.touchedOverrides = true
    return null
  }

  for (const op of ops) {
    switch (op.op) {
      case "update": {
        if (view.isVirtual(op.id)) {
          const loc = view.locate(op.id)
          if (!loc?.instance || loc.path === undefined)
            return { ok: false, code: "INSTANCE_CONTENT", message: `Unknown layer ${op.id}` }
          const err = setAt(loc.instance, loc.path, { ...(op.set ?? {}) }, op.unset ?? [])
          if (err) return { ok: false, code: "OVERRIDE_KIND", message: err }
          continue
        }
        if (real(op.id)?.type === "instance") {
          const own: Rec = {}
          const visual: Rec = {}
          for (const [k, v] of Object.entries(op.set ?? {}))
            (INSTANCE_OWN_KEYS.has(k) ? own : visual)[k] = v
          const ownUnset = (op.unset ?? []).filter((k) => INSTANCE_OWN_KEYS.has(k))
          const visualUnset = (op.unset ?? []).filter((k) => !INSTANCE_OWN_KEYS.has(k))
          if (Object.keys(own).length || ownUnset.length) {
            const u: Op = { op: "update", id: op.id }
            if (Object.keys(own).length) u.set = own
            if (ownUnset.length) u.unset = ownUnset
            out.push(u)
          }
          if (Object.keys(visual).length || visualUnset.length) {
            const p = pend(op.id)
            p.touchedProps = true
            Object.assign(p.props, visual)
            for (const k of visualUnset) delete p.props[k]
          }
          continue
        }
        out.push(op)
        continue
      }
      case "delete": {
        if (!view.isVirtual(op.id)) {
          out.push(op)
          continue
        }
        const loc = view.locate(op.id)
        if (!loc?.instance || loc.path === undefined)
          return { ok: false, code: "INSTANCE_CONTENT", message: `Unknown layer ${op.id}` }
        const err = setAt(loc.instance, loc.path, { visible: false }, [])
        if (err) return { ok: false, code: "OVERRIDE_KIND", message: err }
        const n = view.getNode(op.id)
        notices.push({
          code: "HIDDEN_INSTEAD",
          id: op.id,
          name: typeof n?.name === "string" && n.name ? n.name : String(n?.type ?? "layer"),
        })
        continue
      }
      case "insert":
      case "move": {
        if (op.op === "move" && view.isVirtual(op.id))
          return {
            ok: false,
            code: "INSTANCE_CONTENT",
            message: "Layers inside an instance can't be moved. Detach it first",
          }
        const parent = op.parent
        if (typeof parent !== "string" || !view.isVirtual(parent)) {
          out.push(op)
          continue
        }
        const slot = slotTarget(parent)
        if (!slot)
          return {
            ok: false,
            code: "INSTANCE_CONTENT",
            message: "Only slots take new layers inside an instance",
          }
        const err = markSlot(slot.instance, slot.path)
        if (err) return { ok: false, code: "OVERRIDE_KIND", message: err }
        const { order: _o, index: _i, ...rest } = op as Op & { order?: string; index?: number }
        out.push({ ...rest, parent: slot.instance, at: slot.path } as Op)
        continue
      }
      default:
        out.push(op)
    }
  }
  const head: Op[] = []
  for (const [id, p] of pending) {
    const set: Rec = {}
    const unset: string[] = []
    if (p.touchedProps) {
      if (Object.keys(p.props).length) set.props = p.props
      else unset.push("props")
    }
    if (p.touchedOverrides) {
      if (Object.keys(p.overrides).length) set.overrides = p.overrides
      else unset.push("overrides")
    }
    const u: Op = { op: "update", id }
    if (Object.keys(set).length) u.set = set
    if (unset.length) u.unset = unset
    if (u.set || u.unset) head.push(u)
  }
  // Override updates go first: slot content inserted at `at` needs `{ slot: true }` in place.
  return { ok: true, ops: [...head, ...out], notices, routed: true }
}
