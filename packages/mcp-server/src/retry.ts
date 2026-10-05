/**
 * Patch-retry for `kimo_apply_ops` (ADR 0013 §4.8): a failed call returns a `retryId`; the
 * agent fixes it with `{retryId, edits: [{find, replace, all?}]}` instead of resending the whole
 * input. The stored input is the failed call as compact JSON; each edit replaces text in it,
 * then the patched input runs as a normal call (validated in full). A retry that fails again
 * returns a new `retryId` for the patched text.
 *
 * Entries are per caller origin, bounded ({@link RETRY_MAX} in all) and expire after
 * {@link RETRY_TTL_MS}. Nothing is stored for successful calls.
 */
import type { ToolError } from "./envelope"

export const RETRY_TTL_MS = 15 * 60_000
export const RETRY_MAX = 64
/** Max size of a stored failed input (a larger call is never stored). */
export const RETRY_MAX_BYTES = 512 * 1024

export interface RetryEdit {
  find: string
  replace: string
  all?: boolean
}

interface Entry {
  origin: string
  text: string
  expires: number
}

export class RetryStore {
  private readonly entries = new Map<string, Entry>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** Stores a failed input; returns its retryId (undefined when too large). */
  put(origin: string, input: Record<string, unknown>): string | undefined {
    const { retryId: _r, edits: _e, ...rest } = input
    const text = JSON.stringify(rest)
    if (text.length > RETRY_MAX_BYTES) return undefined
    this.sweep()
    while (this.entries.size >= RETRY_MAX)
      this.entries.delete(this.entries.keys().next().value as string)
    const id = `r_${(++this.seq).toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`
    this.entries.set(id, { origin, text, expires: this.now() + RETRY_TTL_MS })
    return id
  }

  /**
   * The patched input of a retry, or the error to return. The entry is consumed: a failure of
   * the patched call stores the new text under a new id.
   */
  patch(
    origin: string,
    retryId: string,
    edits: readonly RetryEdit[],
    /** Patch this string field's raw text (kimo_script `code`) instead of the JSON text. */
    field?: string,
  ): { ok: true; input: Record<string, unknown> } | { ok: false; error: ToolError } {
    this.sweep()
    const e = this.entries.get(retryId)
    if (!e || e.origin !== origin)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: `Unknown or expired retryId ${retryId}.`,
          path: "retryId",
          suggestion: "Send the whole call again with ops.",
        },
      }
    let fieldInput: Record<string, unknown> | null = null
    let text = e.text
    if (field) {
      fieldInput = JSON.parse(e.text) as Record<string, unknown>
      text = String(fieldInput[field] ?? "")
    }
    for (let i = 0; i < edits.length; i++) {
      const ed = edits[i] as RetryEdit
      const path = `edits[${i}].find`
      const r = applyEdit(text, ed)
      if (typeof r !== "string")
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message:
              r.count === 0
                ? `edits[${i}].find does not occur in the failed call.`
                : `edits[${i}].find occurs ${r.count} times; add context or set all: true.`,
            path,
            suggestion: "find matches the failed call as compact JSON (no spaces after : or ,).",
          },
        }
      text = r
    }
    if (fieldInput && field) {
      this.entries.delete(retryId)
      return { ok: true, input: { ...fieldInput, [field]: text } }
    }
    let input: Record<string, unknown>
    try {
      const v = JSON.parse(text)
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object")
      input = v as Record<string, unknown>
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: `The edits leave invalid JSON (${err instanceof Error ? err.message : String(err)}).`,
          path: "edits",
        },
      }
    }
    this.entries.delete(retryId)
    return { ok: true, input }
  }

  get size(): number {
    return this.entries.size
  }

  private sweep(): void {
    const t = this.now()
    for (const [id, e] of this.entries) if (e.expires <= t) this.entries.delete(id)
  }
}

/** Compact JSON spacing of a `find` written against pretty-printed JSON. */
function compactSpacing(s: string): string {
  return s.replace(/"\s*:\s*/g, '":').replace(/,\s+(?=["{[\d-]|true|false|null)/g, ",")
}

function applyEdit(text: string, ed: RetryEdit): string | { count: number } {
  for (const find of [ed.find, compactSpacing(ed.find)]) {
    if (!find) continue
    const count = text.split(find).length - 1
    if (count === 0) continue
    if (count > 1 && !ed.all) return { count }
    return ed.all ? text.split(find).join(ed.replace) : text.replace(find, () => ed.replace)
  }
  return { count: 0 }
}
