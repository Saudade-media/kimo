import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type KimoDocument, parse } from "@kimo/core-schema"
import { createEmptyDocument, type DocStoreOptions, YjsDocStore } from "../src/index"

/** Directory of core-schema's valid fixtures (read-only). */
export const VALID_FIXTURES = join(import.meta.dir, "../../core-schema/fixtures/valid")

/** `[name, text]` of every valid core-schema fixture. */
export function validFixtures(): [string, string][] {
  return readdirSync(VALID_FIXTURES)
    .filter((f) => f.endsWith(".kimo"))
    .sort()
    .map((f) => [f, readFileSync(join(VALID_FIXTURES, f), "utf8")])
}

/** Parses a valid fixture. */
export function fixture(name: string): KimoDocument {
  return parse(readFileSync(join(VALID_FIXTURES, name), "utf8"))
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 1): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A store over an empty document with deterministic order keys. */
export function emptyStore(options: DocStoreOptions = {}): YjsDocStore {
  const s = new YjsDocStore({ random: rng(7), ...options })
  s.loadDocument(createEmptyDocument("Test"))
  return s
}

/** A frame node body. */
export const frame = (name: string, extra: Record<string, unknown> = {}) => ({
  type: "frame" as const,
  name,
  ...extra,
})

/** A rect node body. */
export const rect = (name: string, extra: Record<string, unknown> = {}) => ({
  type: "rect" as const,
  name,
  w: 10,
  h: 10,
  ...extra,
})

/** Asserts an apply result is ok and returns it narrowed. */
export function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r, null, 1)}`)
  return r as Extract<T, { ok: true }>
}

/** Asserts an apply result failed and returns it narrowed. */
export function failed<T extends { ok: boolean }>(r: T): Extract<T, { ok: false }> {
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r, null, 1)}`)
  return r as Extract<T, { ok: false }>
}

/** Exchanges full state between two stores (both directions). */
export function syncPair(a: YjsDocStore, b: YjsDocStore): void {
  b.applyUpdate(a.encodeStateAsUpdate(b.encodeStateVector()), "remote:a")
  a.applyUpdate(b.encodeStateAsUpdate(a.encodeStateVector()), "remote:b")
}
