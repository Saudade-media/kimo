/**
 * Where a document's assets live, behind one interface for Clean up assets:
 * - {@link platformAssetFolder}: `assets/` next to the `.kimo` file (desktop, FSA, memory);
 * - {@link indexedDbAssetFolder}: the browser library's IndexedDB store (`kimo-assets-<fileId>`).
 */
import { dirnameOf, type FileRef, type KimoPlatform } from "@kimo/platform"
import { assetDbName } from "../lib/assets"
import type { AssetFile } from "./logic"

export interface AssetFolder {
  /** Display path for copy (`assets/`). */
  readonly label: string
  list(): Promise<AssetFile[]>
  read(name: string): Promise<Uint8Array | null>
  remove(names: readonly string[]): Promise<void>
}

const join = (dir: string, name: string) => (dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`)

/** `assets/` beside `kimoRef`, through `platform.files`. */
export function platformAssetFolder(platform: KimoPlatform, kimoRef: FileRef): AssetFolder {
  const dir = join(dirnameOf(kimoRef), "assets")
  return {
    label: "assets/",
    async list() {
      const stat = await platform.files.stat(dir)
      if (stat?.kind !== "directory") return []
      const entries = await platform.files.list(dir)
      return entries.filter((e) => e.kind === "file").map((e) => ({ name: e.name, bytes: e.size }))
    },
    read: (name) => platform.files.readBytes(join(dir, name)).catch(() => null),
    async remove(names) {
      for (const n of names) await platform.files.remove(join(dir, n))
    },
  }
}

/** The browser library's asset database of file `fileId`. */
export function indexedDbAssetFolder(fileId: string): AssetFolder {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(assetDbName(fileId), 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("assets"))
          req.result.createObjectStore("assets", { keyPath: "key" })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const run = async <T>(
    mode: IDBTransactionMode,
    f: (s: IDBObjectStore) => IDBRequest<T> | undefined,
  ) => {
    const db = await open()
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction("assets", mode)
        const req = f(t.objectStore("assets"))
        t.oncomplete = () => resolve(req ? req.result : undefined)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
    } finally {
      db.close()
    }
  }
  return {
    label: "assets/",
    async list() {
      const rows =
        (await run<{ key: string; bytes?: number; data?: Blob }[]>("readonly", (s) =>
          s.getAll(),
        )) ?? []
      return rows.map((r) => ({ name: r.key, bytes: r.bytes ?? r.data?.size ?? 0 }))
    },
    async read(name) {
      const row = await run<{ data?: Blob } | undefined>("readonly", (s) => s.get(name))
      return row?.data ? new Uint8Array(await row.data.arrayBuffer()) : null
    },
    async remove(names) {
      await run("readwrite", (s) => {
        for (const n of names) s.delete(n)
        return undefined
      })
    },
  }
}
