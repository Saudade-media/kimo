/**
 * The document header (variables, themes, imports, …) without the node table, kept current
 * from store changes that touch it (`StoreChange.header`), so panels can resolve variable
 * bindings without serializing the whole document per render.
 */
import type { KimoDocument } from "@kimo/core-schema"
import { defaultTheme, resolveVariable, type Theme } from "@kimo/core-schema"
import type { DocStore, Op } from "@kimo/editor-state"
import { useCallback, useSyncExternalStore } from "react"

export type DocHeader = Omit<KimoDocument, "nodes"> & { nodes: Record<string, never> }

interface Hub {
  header: DocHeader
  listeners: Set<() => void>
}
const hubs = new WeakMap<DocStore, Hub>()

function read(store: DocStore): DocHeader {
  const { nodes: _, ...rest } = store.toDocument()
  return { ...rest, nodes: {} } as DocHeader
}

function hubFor(store: DocStore): Hub {
  let hub = hubs.get(store)
  if (!hub) {
    const h: Hub = { header: read(store), listeners: new Set() }
    store.onChange((c) => {
      if (!c.header && c.cause !== "load") return
      h.header = read(store)
      for (const l of [...h.listeners]) l()
    })
    hub = h
    hubs.set(store, h)
  }
  return hub
}

/** The current header (identity changes only when the header does). */
export function useDocHeader(store: DocStore): DocHeader {
  const hub = hubFor(store)
  const subscribe = useCallback(
    (cb: () => void) => {
      hub.listeners.add(cb)
      return () => hub.listeners.delete(cb)
    },
    [hub],
  )
  return useSyncExternalStore(subscribe, () => hub.header)
}

/** The current header outside React (same object {@link useDocHeader} returns). */
export function currentHeader(store: DocStore): DocHeader {
  return hubFor(store).header
}

/**
 * The op that declares `needed` features missing from the document (spec §13: a gated
 * construct and its feature go in the same edit, so put this op in the same `apply`), or none.
 */
export function featureOps(store: DocStore, needed: readonly string[]): Op[] {
  const have = (currentHeader(store).features ?? []) as readonly string[]
  const missing = needed.filter((f) => !have.includes(f))
  if (!missing.length) return []
  return [{ op: "setHeader", set: { features: [...have, ...missing].sort() } }]
}

/** One color variable for the picker's Variables tab. */
export interface ColorVariable {
  /** Full name (`brand/sand`), the `$ref` target. */
  name: string
  /** Group path (`brand`), "" for top-level names. */
  group: string
  /** Last segment (`sand`). */
  label: string
  /** Resolved under the default theme. */
  color: string | null
  /** One resolved color per value of the mode axis (`light`, `dark`). */
  modes: (string | null)[]
}

/** The mode axis (named `mode`, else the first declared axis) and its values. */
export function modeAxis(header: DocHeader): { axis: string; values: string[] } | null {
  const themes = (header.themes ?? {}) as Record<string, unknown>
  const axis = Object.hasOwn(themes, "mode") ? "mode" : Object.keys(themes)[0]
  if (!axis) return null
  const values = themes[axis]
  return Array.isArray(values)
    ? { axis, values: values.filter((v): v is string => typeof v === "string") }
    : null
}

const asColor = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** Resolves a color binding to a CSS color under `theme` (default theme when omitted). */
export function resolveColor(header: DocHeader, name: string, theme?: Theme): string | null {
  const r = resolveVariable(
    header as KimoDocument,
    name,
    theme ?? defaultTheme(header as KimoDocument),
  )
  return r.ok ? asColor(r.value) : null
}

/** Color variables of the document, sorted by name. */
export function colorVariables(header: DocHeader): ColorVariable[] {
  const vars = (header.variables ?? {}) as Record<string, { type?: unknown }>
  const base = defaultTheme(header as KimoDocument)
  const mode = modeAxis(header)
  return Object.keys(vars)
    .filter((k) => vars[k]?.type === "color")
    .sort()
    .map((name) => {
      const i = name.lastIndexOf("/")
      return {
        name,
        group: i < 0 ? "" : name.slice(0, i),
        label: i < 0 ? name : name.slice(i + 1),
        color: resolveColor(header, name, base),
        modes: mode
          ? mode.values.map((v) => resolveColor(header, name, { ...base, [mode.axis]: v }))
          : [],
      }
    })
}
