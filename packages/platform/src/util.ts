/** Small runtime-neutral helpers shared by the implementations. */
import type { Unsubscribe } from "./types"

const enc = new TextEncoder()

/** SHA-256 (hex) of a string's UTF-8 bytes or of raw bytes (WebCrypto: browser, Bun, Node ≥ 19). */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** UTF-8 byte length of a string. */
export const utf8Length = (s: string) => enc.encode(s).byteLength

/** Default watcher coalescing window. */
export const DEFAULT_WATCH_DEBOUNCE_MS = 150

/**
 * Collects items and delivers them as one batch `ms` after the first item of the batch
 * (trailing edge, no starvation: a steady stream still flushes every `ms`).
 */
export function createBatcher<T>(ms: number, deliver: (batch: T[]) => void) {
  let pending: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    push(item: T) {
      pending.push(item)
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          const batch = pending
          pending = []
          if (batch.length > 0) deliver(batch)
        }, ms)
      }
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = []
    },
  }
}

/** A tiny typed listener set. */
export class Emitter<A extends unknown[]> {
  private readonly listeners = new Set<(...args: A) => void>()
  on(listener: (...args: A) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  emit(...args: A): void {
    for (const l of [...this.listeners]) l(...args)
  }
  get size(): number {
    return this.listeners.size
  }
  clear(): void {
    this.listeners.clear()
  }
}
