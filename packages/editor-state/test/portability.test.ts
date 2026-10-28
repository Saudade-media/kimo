import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * This package must run in Bun, Node, browsers and workers, so its sources may not import
 * platform modules or touch platform globals.
 */
const SRC = join(import.meta.dir, "../src")
const FORBIDDEN: [RegExp, string][] = [
  [/from\s+["'](?:node:|bun:|fs|path|os|crypto|child_process)/, "platform module import"],
  [
    /(?<![.\w])(?:window|document|localStorage|sessionStorage|indexedDB|navigator)\./,
    "browser global",
  ],
  [/(?<![.\w])(?:process|Bun|Deno|require)\s*[.(]/, "runtime global"],
  [/from\s+["']react/, "React import"],
]

test("sources use no platform-specific APIs", () => {
  const hits: string[] = []
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    // Strip comments: prose may mention "the document." etc.
    const text = readFileSync(join(SRC, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    for (const [re, what] of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${what}`)
  }
  expect(hits).toEqual([])
})
