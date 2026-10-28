/**
 * A Kiwi (github.com/evanw/kiwi) binary-schema decoder. Figma's clipboard carries its schema in
 * every copy, so nothing about Figma's message format is hard-coded here: the schema is read
 * first, then the message is interpreted against it (no code generation, so no `eval`).
 */

/** A Kiwi value: builtins, arrays, `bigint` for 64-bit ints, raw bytes for `byte[]`. */
export type KiwiValue =
  | boolean
  | number
  | string
  | bigint
  | Uint8Array
  | KiwiValue[]
  | { [field: string]: KiwiValue }

export interface KiwiField {
  name: string
  type: string
  isArray: boolean
  value: number
}

export interface KiwiDefinition {
  name: string
  kind: "ENUM" | "STRUCT" | "MESSAGE"
  fields: KiwiField[]
}

const BUILTINS = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"]
const KINDS = ["ENUM", "STRUCT", "MESSAGE"] as const
/** Deepest message nesting accepted (Figma's is far shallower; this only stops runaway input). */
const MAX_DEPTH = 256

const decoder = new TextDecoder()

class Reader {
  private o = 0
  constructor(private readonly b: Uint8Array) {}

  byte(): number {
    if (this.o >= this.b.length) throw new Error("Kiwi: unexpected end of data")
    return this.b[this.o++] as number
  }

  uint(): number {
    let v = 0
    let shift = 0
    let c: number
    do {
      c = this.byte()
      v |= (c & 127) << shift
      shift += 7
    } while (c & 128 && shift < 35)
    return v >>> 0
  }

  int(): number {
    const v = this.uint()
    return v & 1 ? ~(v >>> 1) : v >>> 1
  }

  uint64(): bigint {
    let v = 0n
    let shift = 0n
    let c: number
    do {
      c = this.byte()
      v |= BigInt(c & 127) << shift
      shift += 7n
    } while (c & 128 && shift < 70n)
    return v
  }

  int64(): bigint {
    const v = this.uint64()
    return v & 1n ? ~(v >> 1n) : v >> 1n
  }

  /** Kiwi floats: 0 is one zero byte; otherwise 4 bytes with the exponent rotated to the front. */
  float(): number {
    if (this.b[this.o] === 0) {
      this.o++
      return 0
    }
    if (this.o + 4 > this.b.length) throw new Error("Kiwi: unexpected end of data")
    const b = this.b
    let bits = (b[this.o] as number) | ((b[this.o + 1] as number) << 8)
    bits |= ((b[this.o + 2] as number) << 16) | ((b[this.o + 3] as number) << 24)
    this.o += 4
    bits = (bits << 23) | (bits >>> 9)
    F32_BITS[0] = bits >>> 0
    return F32[0] as number
  }

  string(): string {
    const start = this.o
    while (this.byte() !== 0) {}
    return decoder.decode(this.b.subarray(start, this.o - 1))
  }

  bytes(): Uint8Array {
    const n = this.uint()
    if (this.o + n > this.b.length) throw new Error("Kiwi: unexpected end of data")
    const out = this.b.slice(this.o, this.o + n)
    this.o += n
    return out
  }
}

const F32_BITS = new Uint32Array(1)
const F32 = new Float32Array(F32_BITS.buffer)

/** Decodes a binary Kiwi schema. */
export function decodeSchema(bytes: Uint8Array): KiwiDefinition[] {
  const r = new Reader(bytes)
  const count = r.uint()
  const raw: { name: string; kind: number; fields: (Omit<KiwiField, "type"> & { t: number })[] }[] =
    []
  for (let i = 0; i < count; i++) {
    const name = r.string()
    const kind = r.byte()
    const n = r.uint()
    const fields = []
    for (let j = 0; j < n; j++)
      fields.push({ name: r.string(), t: r.int(), isArray: r.byte() !== 0, value: r.uint() })
    raw.push({ name, kind, fields })
  }
  return raw.map((d) => {
    const kind = KINDS[d.kind]
    if (!kind) throw new Error(`Kiwi: unknown definition kind ${d.kind}`)
    return {
      name: d.name,
      kind,
      fields: d.fields.map(({ t, ...f }) => {
        const type = t < 0 ? BUILTINS[~t] : raw[t]?.name
        if (!type) throw new Error(`Kiwi: unknown type ${t} in ${d.name}.${f.name}`)
        return { ...f, type }
      }),
    }
  })
}

/** Decodes `bytes` as a value of the definition `root` of `schema`. */
export function decodeMessage(
  schema: readonly KiwiDefinition[],
  root: string,
  bytes: Uint8Array,
): KiwiValue {
  const defs = new Map(schema.map((d) => [d.name, d]))
  const byValue = new Map(schema.map((d) => [d.name, new Map(d.fields.map((f) => [f.value, f]))]))
  const r = new Reader(bytes)
  let depth = 0

  const one = (type: string): KiwiValue => {
    switch (type) {
      case "bool":
        return r.byte() !== 0
      case "byte":
        return r.byte()
      case "int":
        return r.int()
      case "uint":
        return r.uint()
      case "float":
        return r.float()
      case "string":
        return r.string()
      case "int64":
        return r.int64()
      case "uint64":
        return r.uint64()
    }
    const def = defs.get(type)
    if (!def) throw new Error(`Kiwi: unknown type ${type}`)
    if (def.kind === "ENUM") {
      const v = r.uint()
      return byValue.get(type)?.get(v)?.name ?? v
    }
    if (++depth > MAX_DEPTH) throw new Error("Kiwi: message nested too deeply")
    const out: Record<string, KiwiValue> = {}
    if (def.kind === "STRUCT") {
      for (const f of def.fields) out[f.name] = field(f)
    } else {
      const fields = byValue.get(type)
      for (;;) {
        const id = r.uint()
        if (id === 0) break
        const f = fields?.get(id)
        if (!f) throw new Error(`Kiwi: unknown field ${id} in ${type}`)
        out[f.name] = field(f)
      }
    }
    depth--
    return out
  }

  const field = (f: KiwiField): KiwiValue => {
    if (!f.isArray) return one(f.type)
    if (f.type === "byte") return r.bytes()
    const n = r.uint()
    const out: KiwiValue[] = []
    for (let i = 0; i < n; i++) out.push(one(f.type))
    return out
  }

  return one(root)
}
