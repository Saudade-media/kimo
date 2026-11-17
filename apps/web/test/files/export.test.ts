/**
 * Download: the file an export hands out is the document's canonical text, whether it is a
 * plain .kimo or the .kimo inside a .kimoz package.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type KimoDocument, parse, serialize } from "@kimo/core-schema"
import { YjsDocStore } from "@kimo/editor-state"
import { exportFile } from "../../src/lib/files"
import { readZip } from "../../src/lib/zip"

const FIXTURES = join(import.meta.dir, "../../../../packages/core-schema/fixtures/valid")
/** No bytes for any asset: a package still carries the document. */
const noAssets = { bytes: async () => null, info: async () => null }

describe("export", () => {
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".kimo"))) {
    test(`${file}: the download is the store's document as serialize writes it`, async () => {
      const store = new YjsDocStore()
      store.loadDocument(parse(readFileSync(join(FIXTURES, file), "utf8")), { validate: false })
      const doc = store.toDocument()
      const expected = serialize({ ...doc, meta: { ...doc.meta, name: "Saved" } } as KimoDocument)

      const out = await exportFile(store, "Saved", noAssets as never, (d) => d, false)
      const bytes = new Uint8Array(await out.data.arrayBuffer())
      const text = out.fileName.endsWith(".kimoz")
        ? (await readZip(bytes)).find((e) => e.name === "Saved.kimo")?.data
        : bytes
      expect(new TextDecoder().decode(text)).toBe(expected)
    })
  }
})
