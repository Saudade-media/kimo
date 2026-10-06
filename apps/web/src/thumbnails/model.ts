/**
 * Board 37 §9 "File previews": what a file's preview shows, when it is rendered and when a
 * render is skipped. Pure (no DOM, no React); the editor hook (`./writer.ts`) wires it to the
 * canvas and the stores.
 *
 * Rules (desing.pen H7PHrz › 9 · File previews):
 * - source: the first page's first top-level frame, else the union of that page's roots;
 * - 520 × 328 (2× of the 260 × 164 card thumbnail), cover fit;
 * - rendered after a save while the editor is idle, never on the typing / save path;
 *   skipped when the content hash matches the stored preview's; a render that runs past
 *   {@link THUMBNAIL_TIMEOUT_MS} or a page above {@link THUMBNAIL_MAX_NODES} keeps the old one.
 */
import { listPages, pageOfRoot } from "@kimo/core-schema"

/** Preview size in pixels (2× of FileCard › Thumbnail 260 × 164). */
export const THUMBNAIL_WIDTH = 520
export const THUMBNAIL_HEIGHT = 328
/** Wait after the last save / edit before rendering. */
export const THUMBNAIL_DELAY_MS = 1500
/** At least this long between two renders of one file. */
export const THUMBNAIL_MIN_INTERVAL_MS = 4000
/** A render (fonts, images, raster) that takes longer is dropped; the old preview stays. */
export const THUMBNAIL_TIMEOUT_MS = 5000
/** Pages with more nodes than this are not previewed (the old preview stays). */
export const THUMBNAIL_MAX_NODES = 20_000

/** The slice of a DocStore the target picker reads. */
export interface ThumbnailDoc {
  toHeader(): { pages?: unknown }
  children(parent: string | null): readonly string[]
  getNode(id: string): { type?: unknown; page?: unknown } | undefined
}

/**
 * The nodes a preview shows: `[firstFrame]` of the first page, else every root of that page
 * (their union), else nothing (an empty document keeps the placeholder).
 */
export function thumbnailTargets(doc: ThumbnailDoc): string[] {
  const header = doc.toHeader() as { pages?: unknown }
  const first = listPages(header)[0]?.id ?? null
  const roots = doc
    .children(null)
    .filter((id) => pageOfRoot(header, doc.getNode(id) as never) === first)
  const frame = roots.find((id) => doc.getNode(id)?.type === "frame")
  return frame ? [frame] : roots
}

/** Nodes in the subtrees of `roots` (stops counting past `cap`). */
export function subtreeSize(
  doc: Pick<ThumbnailDoc, "children">,
  roots: readonly string[],
  cap = Number.POSITIVE_INFINITY,
): number {
  let n = 0
  const stack = [...roots]
  while (stack.length && n <= cap) {
    const id = stack.pop() as string
    n++
    for (const c of doc.children(id)) stack.push(c)
  }
  return n
}

/** A short hex content hash (SHA-256, first 16 bytes). */
export async function contentHash(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** The hash a template's cover is stored under (never equal to a content hash). */
export const templateHash = (slug: string) => `template:${slug}`
/** True for a seeded template cover. */
export const isTemplateHash = (hash: string) => hash.startsWith("template:")

export type RefreshResult =
  | "unchanged"
  | "no-target"
  | "too-large"
  | "timeout"
  | "failed"
  | "written"

/** What {@link refreshThumbnail} needs; every step may fail (the old preview then stays). */
export interface RefreshDeps {
  /** The current content hash (null: nothing to preview, e.g. an unsaved document). */
  hash(): Promise<string | null> | string | null
  /** The hash of the stored preview, or null. */
  storedHash(): Promise<string | null>
  /**
   * Renders the preview. Null: nothing to render (empty page, or the page is not laid out);
   * `"too-large"`: above the node cap.
   */
  render(): Promise<Uint8Array | null | "too-large">
  write(hash: string, png: Uint8Array): Promise<void>
  /** True keeps the stored preview whatever the hash (a template cover before the first save). */
  keep?(storedHash: string): boolean
  timeoutMs?: number
}

/** One preview refresh: skip when unchanged, render with a timeout, store. Never rejects. */
export async function refreshThumbnail(deps: RefreshDeps): Promise<RefreshResult> {
  try {
    const hash = await deps.hash()
    if (!hash) return "no-target"
    const stored = await deps.storedHash()
    if (stored === hash || (stored !== null && deps.keep?.(stored))) return "unchanged"
    const timeout = deps.timeoutMs ?? THUMBNAIL_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const rendered = await Promise.race([
      deps.render(),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeout)
      }),
    ]).finally(() => clearTimeout(timer))
    if (rendered === "timeout") return "timeout"
    if (rendered === "too-large") return "too-large"
    if (!rendered) return "no-target"
    await deps.write(hash, rendered)
    return "written"
  } catch {
    return "failed"
  }
}

/** Timers and idle callbacks (injectable for tests). */
export interface SchedulerClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  /** Runs `fn` when the main thread is idle (`requestIdleCallback`); returns a cancel. */
  idle(fn: () => void): () => void
}

export const browserClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  idle(fn) {
    const w = globalThis as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      cancelIdleCallback?: (h: number) => void
    }
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(fn, { timeout: 2000 })
      return () => w.cancelIdleCallback?.(h)
    }
    const h = setTimeout(fn, 0)
    return () => clearTimeout(h)
  },
}

export interface ThumbnailScheduler {
  /** Something was saved (or the editor opened): schedule a refresh. */
  poke(): void
  /**
   * The user is interacting (pointer, wheel, keys): a pending refresh waits another delay, so a
   * render never lands mid-gesture. No-op when nothing is pending.
   */
  defer(): void
  /** True while a refresh is pending or running. */
  readonly busy: boolean
  dispose(): void
}

/**
 * Debounced, idle-time runner of one file's refreshes: `poke` waits {@link THUMBNAIL_DELAY_MS}
 * after the last poke, keeps {@link THUMBNAIL_MIN_INTERVAL_MS} between runs, then runs `task`
 * in an idle callback. One run at a time; a poke during a run schedules one more. A run slower
 * than `budgetMs` doubles the interval (up to a minute), so heavy files render less often.
 */
export function createThumbnailScheduler(
  task: () => Promise<unknown>,
  options: {
    delayMs?: number
    minIntervalMs?: number
    budgetMs?: number
    clock?: SchedulerClock
  } = {},
): ThumbnailScheduler {
  const clock = options.clock ?? browserClock
  const delay = options.delayMs ?? THUMBNAIL_DELAY_MS
  const baseInterval = options.minIntervalMs ?? THUMBNAIL_MIN_INTERVAL_MS
  const budget = options.budgetMs ?? 120
  let interval = baseInterval
  let timer: unknown = null
  let cancelIdle: (() => void) | null = null
  let running = false
  let again = false
  let lastStart = Number.NEGATIVE_INFINITY
  let disposed = false

  const schedule = () => {
    if (disposed) return
    if (timer !== null) clock.clearTimeout(timer)
    cancelIdle?.()
    cancelIdle = null
    const wait = Math.max(delay, lastStart + interval - clock.now())
    timer = clock.setTimeout(() => {
      timer = null
      cancelIdle = clock.idle(() => {
        cancelIdle = null
        void run()
      })
    }, wait)
  }
  const run = async () => {
    if (disposed) return
    if (running) {
      again = true
      return
    }
    running = true
    const start = clock.now()
    lastStart = start
    try {
      await task()
    } finally {
      running = false
      const took = clock.now() - start
      interval = took > budget ? Math.min(60_000, interval * 2) : baseInterval
      if (again) {
        again = false
        schedule()
      }
    }
  }
  return {
    poke() {
      if (running) again = true
      else schedule()
    },
    defer() {
      if (timer !== null || cancelIdle !== null) schedule()
    },
    get busy() {
      return running || timer !== null || cancelIdle !== null
    },
    dispose() {
      disposed = true
      if (timer !== null) clock.clearTimeout(timer)
      cancelIdle?.()
      timer = null
      cancelIdle = null
    },
  }
}
