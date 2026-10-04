/**
 * Minimal Server-Sent Events + JSON-lines readers over a fetch `Response` body (WHATWG streams
 * only, so it runs in browsers, workers, Bun and Node 18+).
 */

export interface SseEvent {
  event?: string
  data: string
}

async function* lines(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const onAbort = () => {
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i = buf.indexOf("\n")
      while (i >= 0) {
        yield buf.slice(0, i).replace(/\r$/, "")
        buf = buf.slice(i + 1)
        i = buf.indexOf("\n")
      }
    }
    buf += decoder.decode()
    if (buf) yield buf.replace(/\r$/, "")
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  } finally {
    signal?.removeEventListener("abort", onAbort)
    reader.releaseLock()
  }
}

/** Parses an SSE stream into events (multi-line `data:` joined with `\n`). */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  let event: string | undefined
  let data: string[] = []
  for await (const line of lines(body, signal)) {
    if (line === "") {
      if (data.length)
        yield event === undefined ? { data: data.join("\n") } : { event, data: data.join("\n") }
      event = undefined
      data = []
      continue
    }
    if (line.startsWith(":")) continue
    const c = line.indexOf(":")
    const field = c < 0 ? line : line.slice(0, c)
    const value = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "")
    if (field === "event") event = value
    else if (field === "data") data.push(value)
  }
  if (data.length)
    yield event === undefined ? { data: data.join("\n") } : { event, data: data.join("\n") }
}

/** Parses newline-delimited JSON (skips blank and unparsable lines, reported via `onBad`). */
export async function* readJsonLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  onBad?: (line: string) => void,
): AsyncGenerator<unknown> {
  for await (const line of lines(body, signal)) {
    const t = line.trim()
    if (!t) continue
    try {
      yield JSON.parse(t)
    } catch {
      onBad?.(t)
    }
  }
}

/** Incremental JSON-lines splitter for process output chunks (CLI adapters). */
export class LineSplitter {
  private buf = ""
  push(chunk: string): string[] {
    this.buf += chunk
    const out: string[] = []
    let i = this.buf.indexOf("\n")
    while (i >= 0) {
      const l = this.buf.slice(0, i).replace(/\r$/, "")
      if (l.trim()) out.push(l)
      this.buf = this.buf.slice(i + 1)
      i = this.buf.indexOf("\n")
    }
    return out
  }
  flush(): string[] {
    const l = this.buf.trim()
    this.buf = ""
    return l ? [l] : []
  }
}
