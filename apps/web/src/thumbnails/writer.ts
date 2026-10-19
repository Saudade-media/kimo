/**
 * Board 37 §9: keeps the open file's preview current. Runs inside the editor (the canvas has
 * the layout and the renderer), off the critical path: after a save (disk) or an autosaved
 * edit (browser library), debounced and in an idle callback (`createThumbnailScheduler`), and
 * skipped when the content hash matches the stored preview's.
 */
import type { KimoPlatform, ThumbnailsApi } from "@kimo/platform"
import { useEffect } from "react"
import type { CanvasHandle } from "../canvas/contract"
import type { FileSession } from "../editor/session"
import {
  contentHash,
  createThumbnailScheduler,
  isTemplateHash,
  type RefreshResult,
  refreshThumbnail,
  subtreeSize,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_NODES,
  THUMBNAIL_WIDTH,
  thumbnailTargets,
} from "./model"
import { diskThumbnails, libraryThumbnails } from "./store"

/** Renders the preview of the canvas's document (null: nothing to show or not laid out). */
export async function renderThumbnail(
  session: Pick<FileSession, "store">,
  canvas: CanvasHandle | null,
): Promise<Uint8Array | null | "too-large"> {
  const renderer = canvas?.renderer
  const layout = canvas?.layout()
  if (!renderer?.exportThumbnail || !layout) return null
  const targets = thumbnailTargets(session.store)
  // The canvas lays out the active page only: on another page the old preview stays.
  if (!targets.length || targets.some((id) => !layout.nodes.has(id))) return null
  if (subtreeSize(session.store, targets, THUMBNAIL_MAX_NODES) > THUMBNAIL_MAX_NODES)
    return "too-large"
  return renderer.exportThumbnail(targets, { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT })
}

/** The store and key of a session's preview (null: an untitled document, or no cache). */
function target(
  session: FileSession,
  platform: KimoPlatform,
): { store: ThumbnailsApi; key: string } | null {
  // A joined room is not a file of this device: no preview.
  if (session.shared) return null
  const doc = session.document
  if (!doc) return { store: libraryThumbnails, key: session.id }
  if (doc.untitled) return null
  const store = diskThumbnails(platform)
  return store ? { store, key: doc.ref } : null
}

/** The content hash of what is saved: the file's text on disk, or the library's CRDT state. */
async function savedHash(session: FileSession): Promise<string | null> {
  const doc = session.document
  if (!doc) return contentHash(session.store.encodeStateVector())
  const text = doc.provider?.diskText
  return text ? contentHash(text) : null
}

/** Keeps `session`'s preview current while the editor is open. */
export function useThumbnailWriter(
  session: FileSession,
  canvas: { readonly current: CanvasHandle | null },
  platform: KimoPlatform,
): void {
  useEffect(() => {
    let written: { key: string; hash: string } | null = null
    // The refresh on open keeps a template's cover; the first save replaces it.
    let saved = false
    const scheduler = createThumbnailScheduler(async () => {
      const t = target(session, platform)
      if (!t) return
      const result: RefreshResult = await refreshThumbnail({
        hash: () => savedHash(session),
        storedHash: async () =>
          written?.key === t.key ? written.hash : ((await t.store.info(t.key))?.hash ?? null),
        render: () => renderThumbnail(session, canvas.current),
        keep: (stored) => !saved && isTemplateHash(stored),
        write: async (hash, png) => {
          await t.store.write(t.key, hash, png)
          written = { key: t.key, hash }
        },
      })
      if (result === "failed" || result === "timeout")
        console.warn(`Kimo: file preview of ${t.key} not updated (${result})`)
    })
    const offs: (() => void)[] = []
    const doc = session.document
    if (doc) {
      // A save: the saved time moves (autosave, ⌘S, Save as).
      const s0 = doc.state().saveStatus
      let savedAt: number | null = s0.kind === "saved" ? s0.savedAt : null
      offs.push(
        doc.subscribe((s) => {
          if (s.saveStatus.kind !== "saved" || s.saveStatus.savedAt === savedAt) return
          saved = true
          savedAt = s.saveStatus.savedAt
          scheduler.poke()
        }),
      )
    } else {
      // The library autosaves every edit (IndexedDB): refresh once the edits settle.
      offs.push(
        session.store.onChange(() => {
          saved = true
          scheduler.poke()
        }),
      )
    }
    // Never render mid-gesture: input pushes a pending refresh back.
    const defer = () => scheduler.defer()
    const inputs = ["pointerdown", "pointermove", "wheel", "keydown"] as const
    for (const e of inputs) window.addEventListener(e, defer, { capture: true, passive: true })
    offs.push(() => {
      for (const e of inputs) window.removeEventListener(e, defer, { capture: true })
    })
    // Opening a file without a current preview (made before previews, or edited elsewhere).
    scheduler.poke()
    return () => {
      for (const off of offs) off()
      scheduler.dispose()
    }
  }, [session, canvas, platform])
}
