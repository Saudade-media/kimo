import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type KimoDocument, parse } from "../src/index"

export const FIXTURES = join(import.meta.dir, "..", "fixtures")

/** `.kimo` files of a fixture directory: [file name, text]. */
export function fixtureFiles(dir: string): [string, string][] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith(".kimo"))
    .sort()
    .map((f) => [f, readFileSync(join(FIXTURES, dir, f), "utf8")])
}

export function readFixture(path: string): string {
  return readFileSync(join(FIXTURES, path), "utf8")
}

export function loadFixture(path: string): KimoDocument {
  return parse(readFixture(path))
}

/** The library the 10.5 example imports as `ui`. */
export const uiLibrary = () => loadFixture("valid/libs/kimo-ui.lib.kimo")

export const HEADER = {
  $schema: "https://kimo.design/schema/kimo-0.1.json",
  format: "0.1.0",
} as const

/** Builds a document from a node table (and optional header members). */
export function doc(
  nodes: Record<string, unknown>,
  header: Record<string, unknown> = {},
): KimoDocument {
  return { ...HEADER, ...header, nodes } as unknown as KimoDocument
}

/** Codes of a validation result's errors (or warnings). */
export const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

/** Untyped JSON for tests that edit documents in place. */
// biome-ignore lint/suspicious/noExplicitAny: tests poke at arbitrary JSON structures
export type Loose = any
