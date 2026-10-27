/**
 * Builds Figma clipboard data from scratch: a minimal Kiwi encoder, a schema covering what the
 * tests use, and the `text/html` wrapper Figma writes. No real Figma copy is checked in.
 */
import { deflateSync } from "fflate"

class Writer {
  private out: number[] = []
  byte(b: number) {
    this.out.push(b & 255)
  }
  uint(v: number) {
    do {
      let b = v & 127
      v >>>= 7
      if (v) b |= 128
      this.byte(b)
    } while (v)
  }
  int(v: number) {
    this.uint((v << 1) ^ (v >> 31))
  }
  float(f: number) {
    if (f === 0) return this.byte(0)
    const u = new Uint32Array(new Float32Array([f]).buffer)[0] as number
    const bits = ((u >>> 23) | (u << 9)) >>> 0
    this.byte(bits)
    this.byte(bits >>> 8)
    this.byte(bits >>> 16)
    this.byte(bits >>> 24)
  }
  string(s: string) {
    for (const b of new TextEncoder().encode(s)) this.byte(b)
    this.byte(0)
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out)
  }
}

type Kind = "ENUM" | "STRUCT" | "MESSAGE"
interface Field {
  name: string
  type: string
  isArray?: boolean
}
export interface Def {
  name: string
  kind: Kind
  fields: Field[]
}

const BUILTIN = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"]

/** Encodes a binary Kiwi schema; field values are 1-based positions (enums: 0-based). */
export function encodeSchema(defs: Def[]): Uint8Array {
  const w = new Writer()
  const index = new Map(defs.map((d, i) => [d.name, i]))
  w.uint(defs.length)
  for (const d of defs) {
    w.string(d.name)
    w.byte(["ENUM", "STRUCT", "MESSAGE"].indexOf(d.kind))
    w.uint(d.fields.length)
    d.fields.forEach((f, i) => {
      w.string(f.name)
      const b = BUILTIN.indexOf(f.type)
      w.int(b >= 0 ? ~b : (index.get(f.type) as number))
      w.byte(f.isArray ? 1 : 0)
      w.uint(d.kind === "ENUM" ? i : i + 1)
    })
  }
  return w.bytes()
}

/** Encodes `value` as `root` of `defs`. */
export function encodeMessage(defs: Def[], root: string, value: unknown): Uint8Array {
  const w = new Writer()
  const by = new Map(defs.map((d) => [d.name, d]))
  const one = (type: string, v: unknown) => {
    switch (type) {
      case "bool":
        return w.byte(v ? 1 : 0)
      case "byte":
        return w.byte(v as number)
      case "int":
        return w.int(v as number)
      case "uint":
        return w.uint(v as number)
      case "float":
        return w.float(v as number)
      case "string":
        return w.string(v as string)
    }
    const d = by.get(type) as Def
    if (d.kind === "ENUM") return w.uint(d.fields.findIndex((f) => f.name === v))
    const o = v as Record<string, unknown>
    if (d.kind === "STRUCT") {
      for (const f of d.fields) field(f, o[f.name])
      return
    }
    d.fields.forEach((f, i) => {
      if (o[f.name] === undefined) return
      w.uint(i + 1)
      field(f, o[f.name])
    })
    w.uint(0)
  }
  const field = (f: Field, v: unknown) => {
    if (!f.isArray) return one(f.type, v)
    if (f.type === "byte") {
      const b = v as Uint8Array
      w.uint(b.length)
      for (const x of b) w.byte(x)
      return
    }
    const a = v as unknown[]
    w.uint(a.length)
    for (const x of a) one(f.type, x)
  }
  one(root, value)
  return w.bytes()
}

const e = (name: string, values: string[]): Def => ({
  name,
  kind: "ENUM",
  fields: values.map((n) => ({ name: n, type: "uint" })),
})
const m = (name: string, fields: [string, string, boolean?][]): Def => ({
  name,
  kind: "MESSAGE",
  fields: fields.map(([n, type, isArray]) => ({ name: n, type, isArray })),
})
const s = (name: string, fields: [string, string][]): Def => ({
  name,
  kind: "STRUCT",
  fields: fields.map(([n, type]) => ({ name: n, type })),
})

/** The subset of Figma's schema the tests use (names and shapes as Figma writes them). */
export const SCHEMA: Def[] = [
  e("NodeType", [
    "NONE",
    "DOCUMENT",
    "CANVAS",
    "FRAME",
    "GROUP",
    "VECTOR",
    "BOOLEAN_OPERATION",
    "STAR",
    "LINE",
    "ELLIPSE",
    "RECTANGLE",
    "REGULAR_POLYGON",
    "ROUNDED_RECTANGLE",
    "TEXT",
    "SLICE",
    "SYMBOL",
    "INSTANCE",
    "STICKY",
    "SECTION",
  ]),
  e("PaintType", [
    "SOLID",
    "GRADIENT_LINEAR",
    "GRADIENT_RADIAL",
    "GRADIENT_ANGULAR",
    "GRADIENT_DIAMOND",
    "IMAGE",
  ]),
  e("StackMode", ["NONE", "HORIZONTAL", "VERTICAL"]),
  e("StackSize", ["FIXED", "RESIZE_TO_FIT", "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE"]),
  e("StackAlign", ["MIN", "CENTER", "MAX", "BASELINE", "SPACE_EVENLY", "SPACE_BETWEEN"]),
  e("StackCounterAlign", ["MIN", "CENTER", "MAX", "STRETCH", "AUTO", "BASELINE"]),
  e("StackPositioning", ["AUTO", "ABSOLUTE"]),
  e("TextAutoResize", ["NONE", "WIDTH_AND_HEIGHT", "HEIGHT"]),
  e("NumberUnits", ["RAW", "PIXELS", "PERCENT"]),
  e("LineType", ["PLAIN", "ORDERED_LIST", "UNORDERED_LIST"]),
  e("ImageScaleMode", ["STRETCH", "FIT", "FILL", "TILE"]),
  e("EffectType", ["INNER_SHADOW", "DROP_SHADOW", "FOREGROUND_BLUR", "BACKGROUND_BLUR"]),
  s("GUID", [
    ["sessionID", "uint"],
    ["localID", "uint"],
  ]),
  s("Color", [
    ["r", "float"],
    ["g", "float"],
    ["b", "float"],
    ["a", "float"],
  ]),
  s("Vector", [
    ["x", "float"],
    ["y", "float"],
  ]),
  s("Matrix", [
    ["m00", "float"],
    ["m01", "float"],
    ["m02", "float"],
    ["m10", "float"],
    ["m11", "float"],
    ["m12", "float"],
  ]),
  m("ParentIndex", [
    ["guid", "GUID"],
    ["position", "string"],
  ]),
  m("ColorStop", [
    ["color", "Color"],
    ["position", "float"],
  ]),
  m("Image", [
    ["hash", "byte", true],
    ["name", "string"],
  ]),
  m("Paint", [
    ["type", "PaintType"],
    ["color", "Color"],
    ["opacity", "float"],
    ["visible", "bool"],
    ["stops", "ColorStop", true],
    ["transform", "Matrix"],
    ["image", "Image"],
    ["imageScaleMode", "ImageScaleMode"],
  ]),
  m("Effect", [
    ["type", "EffectType"],
    ["color", "Color"],
    ["offset", "Vector"],
    ["radius", "float"],
    ["spread", "float"],
    ["visible", "bool"],
  ]),
  m("FontName", [
    ["family", "string"],
    ["style", "string"],
    ["postscript", "string"],
  ]),
  m("Number", [
    ["value", "float"],
    ["units", "NumberUnits"],
  ]),
  m("TextLineData", [
    ["lineType", "LineType"],
    ["indentationLevel", "uint"],
    ["isFirstLineOfList", "bool"],
  ]),
  m("NodeChange", [
    ["guid", "GUID"],
    ["parentIndex", "ParentIndex"],
    ["type", "NodeType"],
    ["name", "string"],
    ["visible", "bool"],
    ["opacity", "float"],
    ["size", "Vector"],
    ["transform", "Matrix"],
    ["fillPaints", "Paint", true],
    ["strokePaints", "Paint", true],
    ["strokeWeight", "float"],
    ["effects", "Effect", true],
    ["cornerRadius", "float"],
    ["frameMaskDisabled", "bool"],
    ["resizeToFit", "bool"],
    ["stackMode", "StackMode"],
    ["stackSpacing", "float"],
    ["stackHorizontalPadding", "float"],
    ["stackVerticalPadding", "float"],
    ["stackPaddingRight", "float"],
    ["stackPaddingBottom", "float"],
    ["stackPrimarySizing", "StackSize"],
    ["stackCounterSizing", "StackSize"],
    ["stackPrimaryAlignItems", "StackAlign"],
    ["stackCounterAlignItems", "StackAlign"],
    ["stackChildPrimaryGrow", "float"],
    ["stackChildAlignSelf", "StackCounterAlign"],
    ["stackPositioning", "StackPositioning"],
    ["fontSize", "float"],
    ["fontName", "FontName"],
    ["lineHeight", "Number"],
    ["letterSpacing", "Number"],
    ["textAutoResize", "TextAutoResize"],
    ["textData", "TextData"],
    ["symbolData", "SymbolData"],
    ["derivedSymbolData", "NodeChange", true],
    ["overrideKey", "GUID"],
    ["componentPropRefs", "ComponentPropRef", true],
    ["componentPropAssignments", "ComponentPropAssignment", true],
    ["vectorData", "VectorData"],
    ["guidPath", "GUIDPath"],
    ["internalOnly", "bool"],
    ["styleID", "uint"],
  ]),
  m("GUIDPath", [["guids", "GUID", true]]),
  m("TextData", [
    ["characters", "string"],
    ["characterStyleIDs", "uint", true],
    ["styleOverrideTable", "NodeChange", true],
    ["lines", "TextLineData", true],
  ]),
  m("SymbolData", [
    ["symbolID", "GUID"],
    ["symbolOverrides", "NodeChange", true],
  ]),
  e("ComponentPropNodeField", ["VISIBLE", "TEXT_DATA", "OVERRIDDEN_SYMBOL_ID"]),
  m("ComponentPropRef", [
    ["defID", "GUID"],
    ["componentPropNodeField", "ComponentPropNodeField"],
  ]),
  m("TextValue", [["characters", "string"]]),
  m("ComponentPropValue", [
    ["boolValue", "bool"],
    ["textValue", "TextValue"],
  ]),
  m("ComponentPropAssignment", [
    ["defID", "GUID"],
    ["value", "ComponentPropValue"],
  ]),
  m("VectorData", [
    ["vectorNetworkBlob", "uint"],
    ["normalizedSize", "Vector"],
  ]),
  m("Blob", [["bytes", "byte", true]]),
  m("Message", [
    ["nodeChanges", "NodeChange", true],
    ["blobs", "Blob", true],
  ]),
]

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

/** A Figma `text/html` clipboard carrying `message` (and optional figmeta). */
export function figmaHtml(message: unknown, meta?: Record<string, unknown>): string {
  const schema = deflateSync(encodeSchema(SCHEMA))
  const msg = deflateSync(encodeMessage(SCHEMA, "Message", message))
  const head = new TextEncoder().encode("fig-kiwi")
  const out = new Uint8Array(12 + 4 + schema.length + 4 + msg.length)
  const v = new DataView(out.buffer)
  out.set(head, 0)
  v.setUint32(8, 106, true)
  v.setUint32(12, schema.length, true)
  out.set(schema, 16)
  v.setUint32(16 + schema.length, msg.length, true)
  out.set(msg, 20 + schema.length)
  const metaAttr = meta ? `<!--(figmeta)${btoa(JSON.stringify(meta))}(/figmeta)-->` : ""
  return `<meta charset="utf-8"><span data-metadata="${metaAttr}"></span><span data-buffer="<!--(figma)${b64(out)}(/figma)-->"></span>`
}

export const guid = (localID: number, sessionID = 1) => ({ sessionID, localID })
export const identity = (x = 0, y = 0) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y })
export const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a })

/** A message: a document, a page, an internal page, then `nodes` (parents given by the caller). */
export function message(nodes: Record<string, unknown>[], blobs: Uint8Array[] = []) {
  return {
    nodeChanges: [
      { guid: guid(0, 0), type: "DOCUMENT", name: "Document", visible: true },
      {
        guid: guid(1, 0),
        parentIndex: { guid: guid(0, 0), position: "!" },
        type: "CANVAS",
        name: "Page 1",
        visible: true,
      },
      {
        guid: guid(2, 0),
        parentIndex: { guid: guid(0, 0), position: '"' },
        type: "CANVAS",
        name: "Internal Only Canvas",
        visible: false,
        internalOnly: true,
      },
      ...nodes,
    ],
    blobs: blobs.map((bytes) => ({ bytes })),
  }
}

export const onPage = (position: string) => ({ guid: guid(1, 0), position })
export const onInternal = (position: string) => ({ guid: guid(2, 0), position })
export const under = (localID: number, position: string) => ({ guid: guid(localID), position })
