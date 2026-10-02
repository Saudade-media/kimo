import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import { type FileSystem, nodeFileSystem } from "../src/file"

export const VALID_FIXTURES = join(import.meta.dir, "../../core-schema/fixtures/valid")
export const FORWARD_FIXTURES = join(import.meta.dir, "../../core-schema/fixtures/forward")

export const fixtureText = (dir: string, name: string) => readFileSync(join(dir, name), "utf8")

/** `[name, text]` of every valid core-schema fixture. */
export function validFixtures(): [string, string][] {
  return readdirSync(VALID_FIXTURES)
    .filter((f) => f.endsWith(".kimo"))
    .sort()
    .map((f) => [f, fixtureText(VALID_FIXTURES, f)])
}

/** A fresh temporary directory. */
export const tempDir = () => mkdtempSync(join(tmpdir(), "kimo-sync-"))

/** A store over an empty document. */
export function emptyStore(): YjsDocStore {
  const s = new YjsDocStore()
  s.loadDocument(createEmptyDocument("Test"))
  return s
}

/** A node fs that counts durable writes and renames. */
export function countingFs(): FileSystem & { writes: string[]; renames: [string, string][] } {
  const writes: string[] = []
  const renames: [string, string][] = []
  return {
    ...nodeFileSystem,
    writes,
    renames,
    async writeFileDurable(path, data) {
      writes.push(path)
      await nodeFileSystem.writeFileDurable(path, data)
    },
    async rename(from, to) {
      renames.push([from, to])
      await nodeFileSystem.rename(from, to)
    },
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const rect = (name: string) => ({ type: "rect" as const, name, w: 10, h: 10 })
