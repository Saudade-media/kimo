/**
 * Shared helpers for the M4 files/session tests: documents, a small node-level three-way merge
 * (stand-in for core-schema's `ThreeWayMerge` so the session tests do not depend on the merge
 * builder's work in progress), and polling.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type KimoDocument,
  MIGRATIONS,
  parse,
  serialize,
  type ThreeWayMerge,
} from "@kimo/core-schema"
import { createEmptyDocument, type DocStore } from "@kimo/editor-state"
import { createMemoryPlatform, type MemoryPlatform } from "@kimo/platform/memory"
import { createSessionManager, type FileSessionManager } from "../src/platform/session"

export const ROOT = "/Users/me/Projects/loom"
export const FILE = `${ROOT}/marketing.kimo`

export const FIXTURES = join(import.meta.dir, "../../../packages/core-schema/fixtures")
export const fixture = (rel: string) => readFileSync(join(FIXTURES, rel), "utf8")

/** A canonical document with `n` rects. */
export function docText(name = "Marketing", rects: string[] = ["Rect000001"]): string {
  const d = createEmptyDocument(name) as KimoDocument & { nodes: Record<string, unknown> }
  rects.forEach((id, i) => {
    d.nodes[id] = { type: "rect", parent: null, order: `a${i}`, name: id, w: 10, h: 10 }
  })
  return serialize(d)
}

/** `text` with node `id` renamed (an external edit). */
export function renameNode(text: string, id: string, name: string): string {
  const d = parse(text) as KimoDocument & { nodes: Record<string, { name?: string }> }
  const n = d.nodes[id]
  if (n) n.name = name
  return serialize(d)
}

/** `text` plus a new rect (an external edit). */
export function addNode(text: string, id: string): string {
  const d = parse(text) as KimoDocument & { nodes: Record<string, unknown> }
  d.nodes[id] = { type: "rect", parent: null, order: "z0", name: id, w: 5, h: 5 }
  return serialize(d)
}

/** A format 0.1 file: opening it runs the real 0.1 → 1.0 migration (consent flow). */
export const OLD_FORMAT = docText("Checkout")
  .replace('"format": "1.0.0"', '"format": "0.1.0"')
  .replace("kimo-1.0.json", "kimo-0.1.json")
/** The shipped migration registry (explicit so the tests say which chain they exercise). */
export const migrations = MIGRATIONS

/** Inserts a rect as the user. */
export function edit(store: DocStore, id: string): void {
  const r = store.apply(
    { op: "insert", id, node: { type: "rect", name: id, w: 10, h: 10 } },
    { origin: "user" },
  )
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}

/** Renames a node as the user. */
export function rename(store: DocStore, id: string, name: string): void {
  const r = store.apply({ op: "update", id, set: { name } }, { origin: "user" })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}

/** Node-level three-way merge: a node changed on both sides differently is a conflict. */
export const nodeMerge: ThreeWayMerge = ({ base, ours, theirs }) => {
  const b = (base.nodes ?? {}) as Record<string, unknown>
  const o = (ours.nodes ?? {}) as Record<string, unknown>
  const t = (theirs.nodes ?? {}) as Record<string, unknown>
  const nodes: Record<string, never> = {}
  const conflicts: Record<string, unknown> = {}
  let changes = 0
  for (const id of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const [sb, so, st] = [b[id], o[id], t[id]].map((x) => JSON.stringify(x))
    let pick: unknown
    if (so === st) pick = o[id]
    else if (so === sb) {
      pick = t[id]
      changes++
    } else if (st === sb) pick = o[id]
    else {
      pick = o[id]
      conflicts[`Cf${id.slice(0, 8)}`] = {
        kind: "node",
        node: id,
        applied: "ours",
        ours: o[id],
        theirs: t[id],
      }
    }
    if (pick !== undefined) nodes[id] = pick as never
  }
  const doc = { ...ours, nodes } as unknown as KimoDocument & Record<string, unknown>
  if (Object.keys(conflicts).length) {
    doc.conflicts = conflicts as never
    doc.merge = { ours: "main", theirs: "disk", changes }
  }
  return { doc, conflicts: conflicts as never, changes, repairs: [] }
}

export interface Setup {
  platform: MemoryPlatform
  manager: FileSessionManager
}

/** A memory platform with fast autosave/snapshots and a session manager. */
export async function setup(
  files: Record<string, string> = { [FILE]: docText() },
  options: {
    settings?: Record<string, unknown>
    openOptions?: object
    retryMs?: number
    platform?: (p: MemoryPlatform) => MemoryPlatform
  } = {},
): Promise<Setup> {
  let platform = createMemoryPlatform({
    files,
    settings: {
      "files.autosaveIntervalMs": 250,
      "files.recoverySnapshotMs": 250,
      ...options.settings,
    },
  })
  await platform.settings.ready
  if (options.platform) platform = options.platform(platform)
  const manager = createSessionManager({
    platform,
    merge: nodeMerge,
    saveRetryMs: options.retryMs ?? 300,
    ...(options.openOptions ? { openOptions: options.openOptions as never } : {}),
  })
  return { platform, manager }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls `cond` every 10 ms until true (or throws after `ms`). */
export async function waitFor(cond: () => boolean, ms = 2000, what = "condition"): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(10)
  }
}

export const nodeNames = (text: string | null) =>
  text ? Object.keys((parse(text) as KimoDocument).nodes) : []
