/**
 * Three-way merge of root `comments` (docs/spec/comments.md §1 "Git merge"). Threads and
 * messages union by id; a deletion on either side wins; a field changed on one side takes that
 * side; changed on both, `text` follows the later `edited`, `resolved` the later `at`, and
 * anything else the value whose canonical JSON sorts higher. Reactions merge as sets. The
 * result never depends on which side is "ours", and comments never produce stored conflicts.
 */
import { isObject } from "../json"

type Obj = Record<string, unknown>

const ABSENT: unique symbol = Symbol("absent")
type Maybe = unknown | typeof ABSENT

/** Own data property, so a `__proto__` key from parsed JSON stays an entry, not a prototype. */
function put(o: Obj, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
}

const get = (o: unknown, k: string): Maybe => (isObject(o) && Object.hasOwn(o, k) ? o[k] : ABSENT)

/** JSON with object keys sorted by code unit. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (isObject(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`
  }
  return JSON.stringify(v) ?? "null"
}

const same = (a: Maybe, b: Maybe) =>
  a === ABSENT || b === ABSENT ? a === b : canonicalJson(a) === canonicalJson(b)

/** Present beats absent; otherwise the higher canonical JSON. Symmetric. */
function higher(o: Maybe, t: Maybe): Maybe {
  if (o === ABSENT) return t
  if (t === ABSENT) return o
  return canonicalJson(o) >= canonicalJson(t) ? o : t
}

/** One side's change wins; both changed: `tie` decides. */
function pick(b: Maybe, o: Maybe, t: Maybe, tie: (o: Maybe, t: Maybe) => Maybe = higher): Maybe {
  if (same(o, t)) return o
  if (same(o, b)) return t
  if (same(t, b)) return o
  return tie(o, t)
}

/** Union by key; an entry deleted on either side is gone. */
function mergeRecord(
  b: unknown,
  o: unknown,
  t: unknown,
  entry: (b: Maybe, o: unknown, t: unknown) => Maybe,
): Obj {
  const out: Obj = {}
  const keys = new Set<string>()
  for (const r of [o, t]) if (isObject(r)) for (const k of Object.keys(r)) keys.add(k)
  for (const k of [...keys].sort()) {
    const bv = get(b, k)
    const ov = get(o, k)
    const tv = get(t, k)
    let v: Maybe
    if (ov === ABSENT) v = bv === ABSENT ? tv : ABSENT
    else if (tv === ABSENT) v = bv === ABSENT ? ov : ABSENT
    else v = entry(bv, ov, tv)
    if (v !== ABSENT) put(out, k, v)
  }
  return out
}

const editedAt = (m: Maybe) => (isObject(m) && typeof m.edited === "string" ? m.edited : "")

function mergeReactions(b: Maybe, o: Maybe, t: Maybe): Maybe {
  const list = (r: Maybe, k: string) => {
    const v = get(r, k)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  }
  const emojis = new Set<string>()
  for (const r of [b, o, t]) if (isObject(r)) for (const k of Object.keys(r)) emojis.add(k)
  const out: Obj = {}
  for (const e of [...emojis].sort()) {
    const base = new Set(list(b, e))
    const os = new Set(list(o, e))
    const ts = new Set(list(t, e))
    const result = new Set<string>()
    for (const id of [...base, ...os, ...ts]) {
      const removed = (base.has(id) && !os.has(id)) || (base.has(id) && !ts.has(id))
      if (!removed) result.add(id)
    }
    if (result.size > 0) put(out, e, [...result].sort())
  }
  return Object.keys(out).length > 0 ? out : ABSENT
}

function mergeMessage(b: Maybe, o: unknown, t: unknown): Maybe {
  if (!isObject(o) || !isObject(t)) return pick(b, o, t)
  const out: Obj = {}
  const keys = new Set([...Object.keys(o), ...Object.keys(t)])
  // `text` and `edited` travel together: the later edit wins as a whole.
  const pair = (m: Maybe) => (isObject(m) ? { text: m.text, edited: m.edited } : ABSENT)
  const text = pick(pair(b), pair(o), pair(t), (x, y) => {
    const ex = editedAt(x)
    const ey = editedAt(y)
    return ex === ey ? higher(x, y) : ex > ey ? x : y
  })
  for (const k of [...keys].sort()) {
    if (k === "text" || k === "edited") continue
    const v =
      k === "reactions"
        ? mergeReactions(get(b, k), get(o, k), get(t, k))
        : pick(get(b, k), get(o, k), get(t, k))
    if (v !== ABSENT) put(out, k, v)
  }
  if (isObject(text)) {
    if (text.text !== undefined) out.text = text.text
    if (text.edited !== undefined) out.edited = text.edited
  }
  return out
}

function mergeThread(b: Maybe, o: unknown, t: unknown): Maybe {
  if (!isObject(o) || !isObject(t)) return pick(b, o, t)
  const out: Obj = {}
  const keys = new Set([...Object.keys(o), ...Object.keys(t)])
  for (const k of [...keys].sort()) {
    let v: Maybe
    if (k === "messages") v = mergeRecord(get(b, k), o.messages, t.messages, mergeMessage)
    else if (k === "resolved")
      v = pick(get(b, k), get(o, k), get(t, k), (x, y) => {
        const ax = isObject(x) && typeof x.at === "string" ? x.at : ""
        const ay = isObject(y) && typeof y.at === "string" ? y.at : ""
        return ax === ay ? higher(x, y) : ax > ay ? x : y
      })
    else v = pick(get(b, k), get(o, k), get(t, k))
    if (v !== ABSENT) put(out, k, v)
  }
  // A thread whose opening message is gone is deleted (deleting the first message deletes it).
  const messages = isObject(out.messages) ? out.messages : {}
  if (typeof out.first !== "string" || !Object.hasOwn(messages, out.first)) return ABSENT
  return out
}

/** Merged `comments`, or undefined when no thread is left. */
export function mergeComments(base: unknown, ours: unknown, theirs: unknown): Obj | undefined {
  if (!isObject(ours) && !isObject(theirs)) return undefined
  const out = mergeRecord(
    isObject(base) ? base : {},
    isObject(ours) ? ours : {},
    isObject(theirs) ? theirs : {},
    (b, o, t) => mergeThread(b, o, t),
  )
  return Object.keys(out).length > 0 ? out : undefined
}
