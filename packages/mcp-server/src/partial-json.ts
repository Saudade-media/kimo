/**
 * Incremental parser for a streamed tool input (ADR 0013 §4.7 "Streamed edits"). Providers send
 * a tool call's JSON input in fragments while the model writes it (Anthropic
 * `input_json_delta`, OpenAI `function.arguments` deltas, Claude Code's stream-json). This parser
 * takes those fragments in order and reports, as soon as each one closes:
 *
 * - every top-level field of the input object (`docId`, `baseRevision`, `label`, …) except the
 *   streamed array, whole;
 * - every element of the streamed array (`ops` by default), with its index.
 *
 * It scans each character once (string and escape state, nesting depth), keeps the text, and
 * `JSON.parse`s only the slice of a value that just closed, so cost is linear in the input.
 * Fragments may split anywhere (inside strings, escapes, `\u` sequences, numbers, literals).
 * Input that is not a JSON object stops the parser (`failed`); nothing is guessed.
 */

export type PartialEvent =
  | { kind: "field"; key: string; value: unknown }
  | { kind: "item"; index: number; value: unknown }
  /** The streamed array closed (`count` elements). */
  | { kind: "items_end"; count: number }
  /** The top-level object closed. */
  | { kind: "end" }

type Frame = {
  type: "obj" | "arr"
  /** Objects: expecting a key (true) or a value (false). */
  expectKey: boolean
}

export class PartialJsonObject {
  private text = ""
  private pos = 0
  private readonly stack: Frame[] = []
  private inString = false
  private escape = false
  /** Start of the string being scanned (keys at depth 1). */
  private stringStart = -1
  /** Key of the depth-1 value being scanned. */
  private key: string | null = null
  /** Start of the depth-1 value (non-streamed fields). */
  private valueStart = -1
  /** Start of the current streamed element (depth 2 inside the streamed array). */
  private itemStart = -1
  private items = 0
  private inItems = false
  private started = false
  private ended = false
  /** True once the input proved not to be a JSON object (nothing more is reported). */
  failed = false

  constructor(private readonly arrayKey: string = "ops") {}

  /** Number of complete elements of the streamed array so far. */
  get count(): number {
    return this.items
  }

  /** True once the top-level object closed. */
  get done(): boolean {
    return this.ended
  }

  /** Everything received so far. */
  get received(): string {
    return this.text
  }

  push(chunk: string): PartialEvent[] {
    if (this.failed || this.ended || !chunk) return []
    this.text += chunk
    const out: PartialEvent[] = []
    const t = this.text
    for (; this.pos < t.length; this.pos++) {
      const c = t[this.pos] as string
      if (this.inString) {
        if (this.escape) this.escape = false
        else if (c === "\\") this.escape = true
        else if (c === '"') {
          this.inString = false
          if (this.stack.length === 1 && this.top()?.expectKey && this.stringStart >= 0) {
            this.key = this.parse(t.slice(this.stringStart, this.pos + 1)) as string
            this.stringStart = -1
          }
          if (!this.closeScalarIfValue(out)) return out
        }
        continue
      }
      if (c === " " || c === "\n" || c === "\r" || c === "\t") continue
      if (!this.started) {
        if (c !== "{") return this.fail()
        this.started = true
        this.stack.push({ type: "obj", expectKey: true })
        continue
      }
      const depth = this.stack.length
      if (depth === 0) {
        // Trailing text after the object: ignore whitespace only.
        return this.fail()
      }
      const top = this.top() as Frame
      switch (c) {
        case '"':
          this.beginValue(depth, top)
          this.inString = true
          if (depth === 1 && top.expectKey) this.stringStart = this.pos
          break
        case ":":
          if (top.type === "obj") top.expectKey = false
          break
        case ",":
          if (!this.closeScalar(out)) return out
          if (top.type === "obj") top.expectKey = true
          break
        case "{":
        case "[":
          this.beginValue(depth, top)
          if (depth === 1 && this.key === this.arrayKey && c === "[") this.inItems = true
          this.stack.push({ type: c === "{" ? "obj" : "arr", expectKey: c === "{" })
          break
        case "}":
        case "]": {
          if (!this.closeScalar(out)) return out
          const closed = this.stack.pop()
          if (!closed || (closed.type === "obj") !== (c === "}")) return this.fail()
          const d = this.stack.length
          if (d === 0) {
            this.ended = true
            out.push({ kind: "end" })
            return out
          }
          if (d === 1 && this.inItems) {
            // The streamed array itself closed.
            this.inItems = false
            this.valueStart = -1
            out.push({ kind: "items_end", count: this.items })
          } else if (!this.closeContainer(d, out)) return out
          break
        }
        default:
          // A number or literal character.
          this.beginValue(depth, top)
      }
    }
    return out
  }

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1]
  }

  /** Records where a depth-1 value or a streamed element starts. */
  private beginValue(depth: number, top: Frame): void {
    if (depth === 1 && !top.expectKey && this.valueStart < 0) this.valueStart = this.pos
    else if (depth === 2 && this.inItems && this.itemStart < 0) this.itemStart = this.pos
  }

  /** A string just closed: it may be a whole depth-1 value or a whole streamed element. */
  private closeScalarIfValue(out: PartialEvent[]): boolean {
    const depth = this.stack.length
    if (depth === 1 && this.valueStart >= 0) return this.emitField(this.pos + 1, out)
    if (depth === 2 && this.inItems && this.itemStart >= 0) return this.emitItem(this.pos + 1, out)
    return true
  }

  /** `,` `}` `]`: ends a pending number/literal at the current position. */
  private closeScalar(out: PartialEvent[]): boolean {
    const depth = this.stack.length
    if (depth === 1 && this.valueStart >= 0) return this.emitField(this.pos, out)
    if (depth === 2 && this.inItems && this.itemStart >= 0) return this.emitItem(this.pos, out)
    return true
  }

  /** A container closed and the stack is now `d` deep. */
  private closeContainer(d: number, out: PartialEvent[]): boolean {
    if (d === 1 && this.valueStart >= 0) return this.emitField(this.pos + 1, out)
    if (d === 2 && this.inItems && this.itemStart >= 0) return this.emitItem(this.pos + 1, out)
    return true
  }

  private emitField(end: number, out: PartialEvent[]): boolean {
    const slice = this.text.slice(this.valueStart, end).trim()
    this.valueStart = -1
    if (this.key === null) return this.failOut()
    const value = this.parse(slice)
    if (this.failed) return false
    if (this.key !== this.arrayKey) out.push({ kind: "field", key: this.key, value })
    return true
  }

  private emitItem(end: number, out: PartialEvent[]): boolean {
    const slice = this.text.slice(this.itemStart, end).trim()
    this.itemStart = -1
    const value = this.parse(slice)
    if (this.failed) return false
    out.push({ kind: "item", index: this.items++, value })
    return true
  }

  private parse(s: string): unknown {
    try {
      return JSON.parse(s)
    } catch {
      this.failed = true
      return undefined
    }
  }

  private fail(): PartialEvent[] {
    this.failed = true
    return []
  }

  private failOut(): boolean {
    this.failed = true
    return false
  }
}
