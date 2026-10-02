import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/** Local modules reachable from an entry file through relative imports. */
function closure(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    const text = readFileSync(file, "utf8")
    const specs = [...text.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)].map(
      (m) => m[1] as string,
    )
    seen.set(file, specs)
    for (const s of specs) if (s.startsWith(".")) visit(resolve(dirname(file), `${s}.ts`))
  }
  visit(entry)
  return seen
}

const SRC = join(import.meta.dir, "../src")

describe("entry points", () => {
  test("@kimo/sync main entry pulls no Node or IndexedDB code", () => {
    const specs = [...closure(join(SRC, "index.ts")).values()].flat()
    expect(
      specs.filter((s) => s.startsWith("node:") || s === "y-indexeddb" || s === "yjs"),
    ).toEqual([])
  })

  test("platform providers are separate entries", async () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8"))
    expect(pkg.exports).toEqual({
      ".": "./src/index.ts",
      "./file": "./src/file.ts",
      "./indexeddb": "./src/indexeddb.ts",
    })
    const file = await import("@kimo/sync/file")
    expect(typeof file.FileProvider).toBe("function")
    const idb = await import("@kimo/sync/indexeddb")
    expect(typeof idb.IndexedDbProvider).toBe("function")
  })
})
