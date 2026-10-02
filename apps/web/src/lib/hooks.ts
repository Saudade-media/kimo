/**
 * React bindings for the framework-agnostic stores: the DocStore (revision-based snapshots) and
 * the vanilla Zustand UI store (selector snapshots via `useSyncExternalStore`, so the app does
 * not need `zustand/react`).
 */
import type { DocStore, NodeData, UiState } from "@kimo/editor-state"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { UiStore } from "../canvas/contract"

/** Re-renders on every committed change; returns a token that changes with the revision. */
export function useDocRevision(store: DocStore): string {
  const subscribe = useCallback((cb: () => void) => store.onChange(cb), [store])
  return useSyncExternalStore(subscribe, () => `${store.revision.epoch}:${store.revision.seq}`)
}

/** Selects a slice of UI state. `select` must return a stable value for unchanged state. */
export function useUi<T>(ui: UiStore, select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(ui.getState()))
}

/** Undo/redo availability for an origin, kept current. */
export function useHistory(store: DocStore) {
  useDocRevision(store)
  return { canUndo: store.canUndo("user"), canRedo: store.canRedo("user") }
}

/** Current `location.hash` route. */
export function useHash(): string {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return hash
}

/** True while focus is in a text field (single-key shortcuts must not fire). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type
    return !["checkbox", "radio", "button", "color", "range"].includes(type)
  }
  return false
}

// --- Fine-grained document subscriptions ------------------------------------------------------
//
// Panels must not re-render on every document change (5k-node documents, drag steps): rows and
// sections subscribe to the nodes they show, and the layer tree to its structure only.

/** Per-store fan-out of change events to the subscribers of each node id. */
const hubs = new WeakMap<DocStore, Map<string, Set<() => void>>>()

function hubFor(store: DocStore): Map<string, Set<() => void>> {
  let hub = hubs.get(store)
  if (!hub) {
    const byId = new Map<string, Set<() => void>>()
    store.onChange((c) => {
      const ids = c.cause === "load" ? [...byId.keys()] : c.nodes
      for (const id of ids) {
        const set = byId.get(id)
        if (set) for (const cb of [...set]) cb()
      }
    })
    hub = byId
    hubs.set(store, byId)
  }
  return hub
}

function subscribeNodes(store: DocStore, ids: readonly string[], cb: () => void): () => void {
  const hub = hubFor(store)
  for (const id of ids) {
    let set = hub.get(id)
    if (!set) {
      set = new Set()
      hub.set(id, set)
    }
    set.add(cb)
  }
  return () => {
    for (const id of ids) {
      const set = hub.get(id)
      set?.delete(cb)
      if (set?.size === 0) hub.delete(id)
    }
  }
}

/** One node's data (frozen; identity changes only when the node does). */
export function useNode(store: DocStore, id: string): NodeData | undefined {
  const subscribe = useCallback((cb: () => void) => subscribeNodes(store, [id], cb), [store, id])
  return useSyncExternalStore(subscribe, () => store.getNode(id))
}

/** The data of `ids` (missing nodes skipped); re-renders only when one of them changes. */
export function useNodes(store: DocStore, ids: readonly string[]): readonly NodeEntry[] {
  const key = ids.join("\u0000")
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`
  const subscribe = useCallback((cb: () => void) => subscribeNodes(store, ids, cb), [store, key])
  const cache = useRef<readonly NodeEntry[]>([])
  const snapshot = () => {
    const prev = cache.current
    const next: NodeEntry[] = []
    for (const id of ids) {
      const node = store.getNode(id)
      if (node) next.push({ id, node })
    }
    // Same entries → same array (missing ids, e.g. a selection whose node was deleted
    // remotely, must not produce a fresh array per call: React would loop).
    if (
      next.length === prev.length &&
      next.every((e, i) => prev[i]?.id === e.id && prev[i]?.node === e.node)
    )
      return prev
    cache.current = next
    return next
  }
  return useSyncExternalStore(subscribe, snapshot)
}

export interface NodeEntry {
  id: string
  node: NodeData
}

interface TreeHub {
  rev: number
  sigs: Map<string, string>
  listeners: Set<() => void>
}
const treeHubs = new WeakMap<DocStore, TreeHub>()

function treeSig(store: DocStore, id: string): string {
  const n = store.getNode(id)
  if (!n) return ""
  return `${String(n.parent)}\u0000${String(n.order)}\u0000${String(n.at)}\u0000${String(n.name)}`
}

function treeHubFor(store: DocStore): TreeHub {
  let hub = treeHubs.get(store)
  if (!hub) {
    const h: TreeHub = { rev: 0, sigs: new Map(), listeners: new Set() }
    const scan = () => {
      h.sigs.clear()
      for (const id of store.nodeIds()) h.sigs.set(id, treeSig(store, id))
    }
    scan()
    store.onChange((c) => {
      let changed = false
      if (c.cause === "load") {
        scan()
        changed = true
      } else {
        for (const id of c.nodes) {
          const next = treeSig(store, id)
          if (next === (h.sigs.get(id) ?? "")) continue
          changed = true
          if (next) h.sigs.set(id, next)
          else h.sigs.delete(id)
        }
      }
      if (!changed) return
      h.rev++
      for (const cb of [...h.listeners]) cb()
    })
    hub = h
    treeHubs.set(store, h)
  }
  return hub
}

/**
 * A token that changes when the layer tree's shape changes: a node is added or removed, or its
 * parent, order, slot (`at`) or name changes. Field edits (geometry, fills) keep it.
 */
export function useTreeRevision(store: DocStore): number {
  const hub = treeHubFor(store)
  const subscribe = useCallback(
    (cb: () => void) => {
      hub.listeners.add(cb)
      return () => hub.listeners.delete(cb)
    },
    [hub],
  )
  return useSyncExternalStore(subscribe, () => hub.rev)
}

/** A minimal external value (e.g. the latest layout) that components select from. */
export interface Bus<T> {
  get(): T
  set(value: T): void
  subscribe(cb: () => void): () => void
}

export function createBus<T>(initial: T): Bus<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      for (const l of [...listeners]) l()
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

/**
 * Selects a primitive (string/number/boolean) from a bus: the component re-renders only when
 * the selected value changes.
 */
export function useBus<T, R extends string | number | boolean | null>(
  bus: Bus<T>,
  select: (value: T) => R,
): R {
  return useSyncExternalStore(bus.subscribe, () => select(bus.get()))
}
