/**
 * Pen node → DOM selector map for board "02c Components — Systems (M3)" (SD9TU) and the M3
 * composites of boards 13–15, used by measure-gallery.ts against
 * test/fixtures/pen-components-m3.json. Keys are component roots (`[data-pen=<id>]` in
 * GalleryM3); node keys are pen ids (instance descendants as `<instance child>/<id>`); selectors
 * are relative to the root. The fixture holds exactly the mapped nodes
 * (`scripts/m3-fixture.ts` filters the Pencil dump with this map).
 */
import type { NodeMap } from "./measure-map-m2"

export const MAP_M3: NodeMap = {}
const pre = (p: string, nodes: Record<string, string>, base = "") =>
  Object.fromEntries(
    Object.entries(nodes).map(([k, v]) => [
      k.startsWith("=") ? k.slice(1) : `${p}${k}`,
      v === "" ? base || ":scope" : base ? `${base} ${v}` : v,
    ]),
  )

/** Nodes whose DOM element is a flexible input, so its width is not the text's hug width. */
export const FLEX_WIDTH_M3 = new Set<string>()
/** Deliberate deviations: `<root>/<id>:<prop>` → reason. */
export const ACCEPTED_M3: Record<string, string> = {}

// --- Identity -----------------------------------------------------------------------------------
MAP_M3.rqoRv = { nodes: { T0yxdd: ".kimo-override-dot__dot" } }
const lr = (
  id: string,
  [disc, icon, name, spacer]: [string, string, string, string],
  extra: Record<string, string> = {},
) => {
  MAP_M3[id] = {
    nodes: {
      [disc]: ".kimo-layer-row-m3__disclosure",
      [icon]: ".kimo-layer-row-m3__icon",
      [name]: ".kimo-layer-row-m3__name",
      ...(spacer ? { [spacer]: ".kimo-layer-row-m3__spacer" } : {}),
      ...extra,
    },
  }
}
lr("ZcfUj", ["Wl0FR", "AHoeG", "uELcn", "qLqIr"])
lr("x5xNG", ["Wl0FR", "AHoeG", "uELcn", ""], {
  TLTw8: ".kimo-layer-row-m3__origin",
  tBTsQ: ".kimo-layer-row-m3__from",
})
lr("L3PiIW", ["y9BVFD", "F276x7", "Bmx4t", "f701Bk"])
lr("oHsXi", ["QZhVc", "YRv7b", "UDSGK", "SsOcA"])
lr("N3AA7R", ["TlunT", "sA7ew", "e9rrtM", "W7NjAG"])
const slotTag = { Wep46: ".kimo-layer-row-m3__tag", zA2RQ: ".kimo-layer-row-m3__tag-label" }
lr("lAFda", ["i1FN8", "wzJkI", "jfGcC", "JjJBk"], slotTag)
lr("Uh0kH", ["i1FN8", "wzJkI", "jfGcC", "JjJBk"], {
  ...slotTag,
  Zyhqb: ".kimo-override-dot",
  "Zyhqb/T0yxdd": ".kimo-override-dot__dot",
})
lr("nn4zo", ["QZhVc", "YRv7b", "UDSGK", "SsOcA"], {
  V8mIg: ".kimo-override-dot",
  "V8mIg/T0yxdd": ".kimo-override-dot__dot",
})
MAP_M3.kMGG0 = { nodes: { PCa4i: ".kimo-slot-badge__icon", VGs3v: ".kimo-slot-badge__label" } }
MAP_M3.AJSok = {
  nodes: {
    B93PCT: ".kimo-slot-quick-insert__icon",
    BSq4s: ".kimo-slot-quick-insert__glyph",
    x68rp1: ".kimo-slot-quick-insert__label",
  },
}

// --- Assets & props -----------------------------------------------------------------------------
const tile = {
  hwUNY: ".kimo-asset-tile__preview",
  txUC3: ".kimo-gallery__thumb",
  u0sQl3: ".kimo-gallery__thumb-label",
  B0LqDC: ".kimo-asset-tile__name-row",
  fjQ56: ".kimo-asset-tile__glyph",
  eHHvU: ".kimo-asset-tile__name",
}
MAP_M3.Q4zkG = { nodes: tile }
MAP_M3.SGo9R = { nodes: { ...tile, WhNv3: ".kimo-asset-tile__grip" } }
const assetRow = (p = "", base = "") =>
  pre(
    p,
    {
      UlF9Z: ".kimo-asset-row__glyph",
      jEh39: ".kimo-asset-row__name",
      jXkjs: ".kimo-asset-row__spacer",
      N4UyW: ".kimo-asset-row__meta",
      i5kIH: ".kimo-asset-row__check",
    },
    base,
  )
const withoutCheck = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).filter(([k]) => !k.endsWith("i5kIH")))
const withoutMeta = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).filter(([k]) => !k.endsWith("N4UyW")))
MAP_M3.h6gLx = { nodes: withoutCheck(assetRow()) }
MAP_M3.qvO7C = { nodes: withoutCheck(assetRow()) }
MAP_M3.Nugw3 = { nodes: withoutMeta(assetRow()) }
for (const id of ["s5R49", "F55lf", "UFEvs", "EQ2qA", "C3HtXf", "e94wp", "q3b44H"])
  MAP_M3[id] = { nodes: id === "s5R49" ? { OHWJN: ".kimo-type-glyph__icon" } : {} }

const propDef = (defaultId: string) => ({
  ZnnUs: ".kimo-prop-def-row__head",
  KBBi8: ".kimo-prop-def-row__glyph",
  "KBBi8/OHWJN": ".kimo-prop-def-row__glyph .kimo-type-glyph__icon",
  bhiaB: ".kimo-prop-def-row__name-field",
  V2e4tP: ".kimo-prop-def-row__name",
  Y1b1v7: ".kimo-prop-def-row__type .kimo-select__trigger",
  "Y1b1v7/LWF8n": ".kimo-prop-def-row__type .kimo-select__value",
  "Y1b1v7/VLDHF": ".kimo-prop-def-row__type .kimo-select__chevron",
  E7ep1u: ".kimo-prop-def-row__remove",
  "E7ep1u/nd1MZ": ".kimo-prop-def-row__remove .kimo-icon-button__icon",
  pVWiu: ".kimo-prop-def-row__binding",
  Q6ffKn: ".kimo-prop-def-row__target",
  "Q6ffKn/vpMpD": ".kimo-prop-def-row__target .kimo-prop-field__value",
  [defaultId]: ".kimo-prop-def-row__default",
  [`${defaultId}/jXquz`]: ".kimo-prop-def-row__default .kimo-prop-field__prefix",
  [`${defaultId}/vpMpD`]: ".kimo-prop-def-row__default .kimo-prop-field__value",
})
MAP_M3.VqB97 = {
  nodes: { ...propDef("LqiP8"), tqHpY: ".kimo-prop-def-row__target .kimo-prop-field__prefix" },
}
for (const [id, def] of [
  ["hXmP2", "htuet"],
  ["n0ujw4", "LqiP8"],
  ["ieuje", "LqiP8"],
] as const)
  MAP_M3[id] = {
    nodes: {
      ...propDef(def),
      "Q6ffKn/tqHpY": ".kimo-prop-def-row__target .kimo-prop-field__prefix",
    },
  }
for (const id of ["V2e4tP", "LqiP8/vpMpD", "htuet/vpMpD", "l6zACE", "BwYzP", "GktPK/BwYzP"])
  FLEX_WIDTH_M3.add(id)

const swap = (p = "", base = "") =>
  pre(
    p,
    {
      G23zFQ: ".kimo-instance-swap-field__preview",
      nGWUc: ".kimo-instance-swap-field__preview-icon",
      QKKLp: ".kimo-instance-swap-field__value",
      QdhrK: ".kimo-instance-swap-field__spacer",
      y5oFE6: ".kimo-instance-swap-field__glyph",
      H6W9cl: ".kimo-instance-swap-field__chevron",
    },
    base,
  )
MAP_M3.VjO7v = { nodes: swap() }
const labelCell = (cell: string, dot: string, label: string) => ({
  [cell]: ".kimo-instance-prop-row__label-cell",
  [dot]: ".kimo-override-dot",
  [`${dot}/T0yxdd`]: ".kimo-override-dot__dot",
  [label]: ".kimo-instance-prop-row__label",
})
const textRow = {
  ...labelCell("m1rQ5", "iaJm8", "Evsz3"),
  B4lmr: ".kimo-instance-prop-row__field",
  LLDqI: ".kimo-instance-prop-row__field-icon",
  l6zACE: ".kimo-instance-prop-row__value",
}
MAP_M3.iYH5j = { nodes: textRow }
MAP_M3.n2Q1FU = { nodes: textRow }
MAP_M3.YSJLM = {
  nodes: {
    ...labelCell("IVCfD", "sbVz7", "pTXqz"),
    qJEPl: ".kimo-instance-prop-row__spacer",
    VO6IP: ".kimo-toggle",
    "VO6IP/SM9sk": ".kimo-toggle__knob",
  },
}
MAP_M3.ztxNk = {
  nodes: {
    ...labelCell("phsrM", "zQvB9", "IVZTm"),
    JEQRt: ".kimo-select__trigger",
    "JEQRt/LWF8n": ".kimo-select__value",
    "JEQRt/VLDHF": ".kimo-select__chevron",
  },
}
MAP_M3.CpeMN = {
  nodes: {
    ...labelCell("Q3Z8h", "UUlnr", "pSfpg"),
    ZjqcA: ".kimo-instance-swap-field",
    ...swap("ZjqcA/", ".kimo-instance-swap-field"),
  },
}
MAP_M3.ddT4A = {
  nodes: {
    ...labelCell("Ot2EN", "AyuVy", "ywkrS"),
    Pdjps: ".kimo-instance-prop-row__content",
    OfPGY: ".kimo-instance-prop-row__content-icon",
    dcFt3: ".kimo-instance-prop-row__meta",
    bcZy7: ".kimo-instance-prop-row__content .kimo-instance-prop-row__spacer",
    PFIBa: ".kimo-instance-prop-row__select-content",
    "PFIBa/e5j2wK": ".kimo-instance-prop-row__select-content .kimo-button__label",
    zhUx8: ".kimo-instance-prop-row__clear",
    "zhUx8/nd1MZ": ".kimo-instance-prop-row__clear .kimo-icon-button__icon",
  },
}

// --- Variables & themes -------------------------------------------------------------------------
const alias = (p = "", base = "") =>
  pre(p, { UCO47: ".kimo-alias-chip__icon", HanrP: ".kimo-alias-chip__name" }, base)
MAP_M3.bEYCg = { nodes: alias() }
const cell = (kind: string, p = "", base = "") => {
  const c: Record<string, Record<string, string>> = {
    color: {
      b42Ypk: ".kimo-swatch-tile",
      "b42Ypk/A4ord9": ".kimo-swatch-tile__color",
      NHH8Y: ".kimo-var-cell__value",
    },
    number: { yepLf: ".kimo-var-cell__value" },
    multi: { yepLf: ".kimo-var-cell__value", u9Z1nq: ".kimo-var-cell__multi" },
    string: { zTAYw: ".kimo-var-cell__value" },
    boolean: {
      z9wRGc: ".kimo-toggle",
      "z9wRGc/SM9sk": ".kimo-toggle__knob",
      cn6RE: ".kimo-var-cell__value",
    },
    alias: {
      f7H1e: ".kimo-alias-chip",
      "f7H1e/UCO47": ".kimo-alias-chip__icon",
      "f7H1e/HanrP": ".kimo-alias-chip__name",
    },
    empty: { ql8o6: ".kimo-var-cell__value" },
  }
  return pre(p, c[kind] ?? {}, base)
}
MAP_M3.iCQwv = { nodes: cell("color") }
MAP_M3.U8aZ2J = { nodes: cell("number") }
MAP_M3.MEKrO = { nodes: cell("string") }
MAP_M3.pxZFa = { nodes: cell("boolean") }
MAP_M3.xn5O9 = { nodes: cell("alias") }
MAP_M3.OJlJp = { nodes: cell("empty") }
MAP_M3.b8Koy = { nodes: cell("color") }
const modeHeader = (p = "", base = "", withDefault = true, withMenu = true) =>
  pre(
    p,
    {
      dnWjO: ".kimo-mode-column-header__value",
      ...(withDefault
        ? {
            VhSDT: ".kimo-mode-column-header__default",
            zkToZ: ".kimo-mode-column-header__default-label",
          }
        : {}),
      PY1kN: ".kimo-mode-column-header__spacer",
      ...(withMenu ? { tf2C4: ".kimo-mode-column-header__menu" } : {}),
    },
    base,
  )
MAP_M3.MhpFW = { nodes: modeHeader() }
MAP_M3.ECUOZ = { nodes: modeHeader("", "", false) }
const axisHeader = (p = "", base = "") =>
  pre(
    p,
    {
      h6b7o: ".kimo-axis-group-header__icon",
      VEB5T: ".kimo-axis-group-header__axis",
      a3UcT: ".kimo-axis-group-header__count",
    },
    base,
  )
MAP_M3.E6DjdE = { nodes: axisHeader() }
const pinRow = {
  blp2E: ".kimo-theme-pin-row__axis-cell",
  u4YUnh: ".kimo-theme-pin-row__icon",
  b5SeS: ".kimo-theme-pin-row__axis",
  Rvy1c: ".kimo-theme-pin-row__value .kimo-select__trigger",
  "Rvy1c/LWF8n": ".kimo-theme-pin-row__value .kimo-select__value",
  "Rvy1c/VLDHF": ".kimo-theme-pin-row__value .kimo-select__chevron",
  COjHI: ".kimo-theme-pin-row__reset",
  "COjHI/nd1MZ": ".kimo-theme-pin-row__reset .kimo-icon-button__icon",
}
MAP_M3.Lamcg = { nodes: pinRow }
MAP_M3.fXNbV = { nodes: pinRow }
MAP_M3.EtIA3 = { nodes: pinRow }
const listRow = {
  YvK47: ".kimo-variable-list-row__lead",
  iP6bu: ".kimo-variable-list-row__name",
  psW5H: ".kimo-variable-list-row__spacer",
  WJLUV: ".kimo-variable-list-row__value",
}
MAP_M3.yB4CN = { nodes: { ...listRow, NSFgQ: ".kimo-variable-list-row__swatch" } }
MAP_M3.HLJJg = {
  nodes: {
    ...listRow,
    NSFgQ: ".kimo-variable-list-row__swatch",
    zQn04: ".kimo-variable-list-row__alias",
  },
}
MAP_M3.FGJH5 = { nodes: { ...listRow, z6GTC: ".kimo-variable-list-row__glyph" } }

/** VariableRow: name cell parts + one entry per value cell (`[id, kind]` in column order). */
const varRow = (
  p: string,
  base: string,
  values: string,
  cells: readonly (readonly [string, string])[],
  extra: Record<string, string> = {},
) => ({
  ...pre(
    p,
    {
      "": "",
      F2PpG: ".kimo-variable-row__name-cell",
      ug3QR: ".kimo-type-glyph",
      "ug3QR/OHWJN": ".kimo-type-glyph__icon",
      PVpHs: ".kimo-variable-row__name",
      viM9y: ".kimo-variable-row__spacer",
      Z2AwH: ".kimo-variable-row__menu",
      ...extra,
    },
    base,
  ),
  [values]: base ? `${base} .kimo-variable-row__values` : ".kimo-variable-row__values",
  ...Object.fromEntries(
    cells.flatMap(([id, kind], i) => {
      const sel = `${base ? `${base} ` : ""}.kimo-variable-row__values > :nth-child(${i + 1})`
      return [[id, sel], ...Object.entries(cell(kind, `${id}/`, sel))]
    }),
  ),
})
const rootRow = (values: string, cells: readonly (readonly [string, string])[]) => {
  const m = varRow("", "", values, cells)
  delete m[""]
  return m
}
MAP_M3.ejBTe = {
  nodes: rootRow("vqZcj", [
    ["kgGUQ", "color"],
    ["TIlKP", "alias"],
    ["X7KpyH", "empty"],
    ["C4u3I", "empty"],
  ]),
}
MAP_M3.Koxnr = {
  nodes: rootRow("zJ03k", [
    ["YWhQx", "empty"],
    ["POS0x", "empty"],
    ["QoMAI", "number"],
    ["abkjs", "number"],
  ]),
}
MAP_M3.FOOJI = {
  nodes: {
    A3Ic6: ".kimo-when-chip__axis",
    n95i7v: ".kimo-when-chip__eq",
    T20Nq: ".kimo-when-chip__value",
  },
}
const when = (p: string, base: string) =>
  pre(
    p,
    {
      "": "",
      A3Ic6: ".kimo-when-chip__axis",
      n95i7v: ".kimo-when-chip__eq",
      T20Nq: ".kimo-when-chip__value",
    },
    base,
  )
const entry = (
  p: string,
  base: string,
  whenId: string,
  chips: readonly string[],
  fallback?: readonly [string, string],
) => ({
  ...pre(
    p,
    {
      x8qPB: ".kimo-entry-row__grip",
      yafcc: ".kimo-entry-row__index",
      hjwZf: ".kimo-var-cell",
      "hjwZf/yepLf": ".kimo-var-cell .kimo-var-cell__value",
      aoiIW: ".kimo-entry-row__spacer",
      bNimB: ".kimo-entry-row__state",
      qyMH0: ".kimo-entry-row__menu",
    },
    base,
  ),
  [whenId]: `${base ? `${base} ` : ""}.kimo-entry-row__when`,
  ...(fallback
    ? {
        [`${p}${fallback[0]}`]: `${base ? `${base} ` : ""}.kimo-entry-row__fallback`,
        [`${p}${fallback[1]}`]: `${base ? `${base} ` : ""}.kimo-entry-row__fallback-label`,
      }
    : {}),
  ...Object.assign(
    {},
    ...chips.map((c, i) =>
      when(`${c}/`, `${base ? `${base} ` : ""}.kimo-entry-row__when > :nth-child(${i + 1})`),
    ),
  ),
})
const fixChipRoots = (m: Record<string, string>) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) out[k.endsWith("/") ? k.slice(0, -1) : k] = v
  return out
}
MAP_M3.Ni5kJ = { nodes: fixChipRoots(entry("", "", "GDzQl", [], ["aKpIg", "nMczj"])) }
MAP_M3.H6Mdtf = { nodes: fixChipRoots(entry("", "", "ZXu86", ["Q1WwN"])) }
MAP_M3.mFjXw = { nodes: fixChipRoots(entry("", "", "TkpGc", ["yVn87", "gBeqn"])) }

// --- Libraries & feedback -----------------------------------------------------------------------
const pill = (p = "", base = "") =>
  pre(p, { dmG7C: ".kimo-status-pill__dot", tJyiu: ".kimo-status-pill__label" }, base)
MAP_M3.SVobH = { nodes: pill() }
MAP_M3.n20iVc = { nodes: pill() }
MAP_M3.jwQVJ = { nodes: pill() }
const libRow = (p: string, base: string, status: string, action: boolean) => ({
  ...pre(
    p,
    {
      mEJR9: ".kimo-library-row__icon-tile",
      I8gT5S: ".kimo-library-row__icon",
      vPF9q: ".kimo-library-row__info",
      D8bGSX: ".kimo-library-row__title-row",
      LOBcn: ".kimo-library-row__name",
      T3U8v: ".kimo-library-row__alias",
      RpQDi: ".kimo-library-row__alias-label",
      bz08k: ".kimo-library-row__meta-row",
      b2ba4I: ".kimo-library-row__path",
      CBa1E: ".kimo-library-row__sep",
      sU8BA: ".kimo-library-row__count",
      UQ8Ia: ".kimo-library-row__actions",
      PFqdc: ".kimo-library-row__menu",
      "PFqdc/nd1MZ": ".kimo-library-row__menu .kimo-icon-button__icon",
      ...(action
        ? {
            i4W7uB: ".kimo-library-row__action",
            "i4W7uB/e5j2wK": ".kimo-library-row__action .kimo-button__label",
          }
        : {}),
    },
    base,
  ),
  ...pre(
    `${p}${status}/`,
    { dmG7C: ".kimo-status-pill__dot", tJyiu: ".kimo-status-pill__label" },
    `${base ? `${base} ` : ""}.kimo-status-pill`,
  ),
  [`${p}${status}`]: `${base ? `${base} ` : ""}.kimo-status-pill`,
})
MAP_M3.hxry7 = { nodes: libRow("", "", "f5F6r", false) }
MAP_M3.F8YIg = { nodes: libRow("", "", "ex6KL", true) }
MAP_M3.heWrG = { nodes: libRow("", "", "mCdi0", true) }
const toast = {
  d82EN: ".kimo-toast__icon",
  B5hQu: ".kimo-toast__label",
  FTVGD: ".kimo-toast__action",
}
MAP_M3.FVd5q = { nodes: toast }
MAP_M3.qINpv = { nodes: toast }

// --- Variables dialog (board 14 EIkIk), representative rows -------------------------------------
const sb = (n: number) => `.kimo-variables-dialog__sidebar > :nth-child(${n})`
const navItem = (n: number, ids: [string, string, string, string, string]) => {
  const [row, icon, label, spacer, count] = ids
  return {
    [row]: sb(n),
    [icon]: `${sb(n)} .kimo-variables-nav-item__icon`,
    [label]: `${sb(n)} .kimo-variables-nav-item__label`,
    [spacer]: `${sb(n)} .kimo-variables-nav-item__spacer`,
    [count]: `${sb(n)} .kimo-variables-nav-item__count`,
  }
}
const seg = (n: number, id: string, label: string) => ({
  [id]: `.kimo-variables-dialog__filter > :nth-child(${n})`,
  [label]: `.kimo-variables-dialog__filter > :nth-child(${n}) .kimo-variables-dialog__seg-label`,
})
const tr = (n: number) => `.kimo-variables-dialog__table > :nth-child(${n})`
const col = (n: number) => `.kimo-variables-dialog__column-row > :nth-child(${n})`
const ax = (n: number) => `.kimo-variables-dialog__axis-row > :nth-child(${n})`
const dialogRow = (
  n: number,
  id: string,
  values: string,
  cells: readonly (readonly [string, string])[],
  extra: Record<string, string> = {},
) => varRow(`${id}/`, tr(n), values, cells, extra)
const fixRowRoot = (m: Record<string, string>, id: string) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) out[k === `${id}/` ? id : k] = v
  return out
}
const entriesBase = tr(9)
const entryRow = (n: number) => `${entriesBase} > :nth-child(${n})`
MAP_M3.EIkIk = {
  nodes: {
    DaqRQ: ".kimo-variables-dialog__header",
    lbarU: ".kimo-variables-dialog__titles",
    kKsDQ: ".kimo-variables-dialog__title",
    JDmQ0: ".kimo-variables-dialog__desc",
    GNzAW: ".kimo-variables-dialog__close",
    "GNzAW/nd1MZ": ".kimo-variables-dialog__close .kimo-icon-button__icon",
    p7LkYF: ".kimo-variables-dialog__body",
    M1fgkY: ".kimo-variables-dialog__sidebar",
    uGSO4: sb(1),
    vcSjd: `${sb(1)} .kimo-variables-nav-section__title`,
    ...navItem(2, ["btGbF", "Bm6ve", "XLacE", "g07tZf", "FICiW"]),
    ...navItem(3, ["uuVsY", "j5SFz", "SKRt0", "ernFz", "eb7ix"]),
    ...navItem(4, ["zmTKI", "izDep", "W1QlR6", "fsgt2", "FJUvN"]),
    UzrRU: sb(7),
    IihDC: `${sb(7)} .kimo-variables-nav-section__title`,
    ...navItem(9, ["eITu6", "LjCZm", "kZRBW", "E9Wv3j", "Euw5m"]),
    G0u7wN: sb(10),
    "G0u7wN/zAVGx": `${sb(10)} .kimo-button__icon`,
    "G0u7wN/e5j2wK": `${sb(10)} .kimo-button__label`,
    kkagf: sb(11),
    ...navItem(14, ["Urjz1", "xsoTx", "Xc46a", "Zxh0U", "aslgK"]),
    Q2yzle: ".kimo-variables-dialog__main",
    zAPZ1: ".kimo-variables-dialog__toolbar",
    Yuehw: ".kimo-variables-dialog__search",
    "Yuehw/mU4b8": ".kimo-variables-dialog__search .kimo-input__icon",
    "Yuehw/BwYzP": ".kimo-variables-dialog__search .kimo-input__field",
    GHEjw: ".kimo-variables-dialog__filter",
    ...seg(1, "jBpMt", "y71wD"),
    ...seg(2, "JhG9c", "X83ZBI"),
    ...seg(3, "eBGZp", "SOsxa"),
    ...seg(5, "WmniH", "j3cux"),
    k2mCY0: ".kimo-variables-dialog__toolbar > .kimo-variables-dialog__spacer",
    jeJl2: ".kimo-variables-dialog__new",
    "jeJl2/r5v5W": ".kimo-variables-dialog__new .kimo-button__icon",
    "jeJl2/bzZjb": ".kimo-variables-dialog__new .kimo-button__label",
    sWH4c: ".kimo-variables-dialog__table",
    fgGA2: ".kimo-variables-dialog__axis-row",
    p0K90o: ".kimo-variables-dialog__pad",
    UYUyr: ax(2),
    ...axisHeader("UYUyr/", ax(2)),
    V7LyrG: ax(3),
    ...axisHeader("V7LyrG/", ax(3)),
    G1NUwB: ".kimo-variables-dialog__column-row",
    S7bhHZ: ".kimo-variables-dialog__name-header",
    z9KfXo: ".kimo-variables-dialog__name-label",
    DFlmt: col(2),
    ...modeHeader("DFlmt/", col(2)),
    MGSVG: col(3),
    ...modeHeader("MGSVG/", col(3), false),
    R1dAf5: col(5),
    ...modeHeader("R1dAf5/", col(5), false),
    ...fixRowRoot(
      dialogRow(3, "teLvL", "GxA7p", [
        ["dDI3X", "color"],
        ["nqzs5", "color"],
        ["PytgZ", "empty"],
        ["QT81f", "empty"],
      ]),
      "teLvL",
    ),
    ...fixRowRoot(
      dialogRow(
        5,
        "jo1zA",
        "Xn6c2",
        [
          ["FLcHW", "empty"],
          ["k5Nck", "alias"],
        ],
        { SqNTB: ".kimo-variable-row__lint" },
      ),
      "jo1zA",
    ),
    ...fixRowRoot(dialogRow(6, "H7v50h", "gPv47", []), "H7v50h"),
    X2mtI: `${tr(6)} .kimo-all-themes-tag`,
    MeBdt: `${tr(6)} .kimo-all-themes-tag__label`,
    ...fixRowRoot(
      dialogRow(
        8,
        "Or4ix",
        "ww6Pz",
        [
          ["aDHM6", "empty"],
          ["ApoQu", "empty"],
          ["t2sKF", "number"],
          ["X2QxuG", "multi"],
        ],
        { esuNz: ".kimo-variable-row__disclosure" },
      ),
      "Or4ix",
    ),
    akJGT: entriesBase,
    E1sgyl: `${entriesBase} .kimo-variable-entries__header`,
    kfcIy: `${entriesBase} .kimo-variable-entries__title`,
    J4BQ3q: `${entriesBase} .kimo-variable-entries__count`,
    u659kX: `${entriesBase} .kimo-variable-entries__spacer`,
    sSnpd: `${entriesBase} .kimo-variable-entries__preview`,
    jNiP1: entryRow(2),
    ...fixChipRoots(entry("jNiP1/", entryRow(2), "jNiP1/GDzQl", [], ["aKpIg", "nMczj"])),
    t6WTAV: entryRow(4),
    ...fixChipRoots(entry("t6WTAV/", entryRow(4), "JM3pt", ["anlDX"])),
    bTPBP: `${entriesBase} .kimo-variable-entries__footer`,
    ujIU9: `${entriesBase} .kimo-variable-entries__footer > :nth-child(1)`,
    "ujIU9/zAVGx": `${entriesBase} .kimo-variable-entries__footer > :nth-child(1) .kimo-button__icon`,
    "ujIU9/e5j2wK": `${entriesBase} .kimo-variable-entries__footer > :nth-child(1) .kimo-button__label`,
    FXUYX: `${entriesBase} .kimo-variable-entries__footer > :nth-child(2)`,
    ...fixRowRoot(dialogRow(11, "rlzdm", "Bmrft", [["fKtd5", "string"]]), "rlzdm"),
    qIont: `${tr(11)} .kimo-all-themes-tag`,
    ...fixRowRoot(dialogRow(12, "y5qzN4", "xiCHs", [["e3x8J", "boolean"]]), "y5qzN4"),
    BVIIs: ".kimo-variables-dialog__footer",
    VdgyD: ".kimo-variables-dialog__info",
    q6tcm: ".kimo-variables-dialog__note",
    EoDRL: ".kimo-variables-dialog__footer > .kimo-variables-dialog__spacer",
    bpnlM: ".kimo-variables-dialog__export",
    "bpnlM/hfife": ".kimo-variables-dialog__export .kimo-button__icon",
    "bpnlM/D5Dhjk": ".kimo-variables-dialog__export .kimo-button__label",
    axe9j: ".kimo-variables-dialog__done",
    "axe9j/bzZjb": ".kimo-variables-dialog__done .kimo-button__label",
  },
}
// The second boolean cell (eFCL1) swaps its Toggle for Toggle/Off (W14g65): mapped separately.
Object.assign(MAP_M3.EIkIk.nodes, {
  eFCL1: `${tr(12)} .kimo-variable-row__values > :nth-child(2)`,
  W14g65: `${tr(12)} .kimo-variable-row__values > :nth-child(2) .kimo-toggle`,
  "W14g65/JaEms": `${tr(12)} .kimo-variable-row__values > :nth-child(2) .kimo-toggle__knob`,
  "eFCL1/cn6RE": `${tr(12)} .kimo-variable-row__values > :nth-child(2) .kimo-var-cell__value`,
})
FLEX_WIDTH_M3.add("Yuehw/BwYzP")

// --- Popovers (board 13) -----------------------------------------------------------------------
const popHeader = {
  Am1eq: ".kimo-popover__header",
  lSGG7: ".kimo-popover__leading",
  cNBKW: ".kimo-popover__title",
  gKfsp: ".kimo-popover__close",
  "gKfsp/nd1MZ": ".kimo-popover__close .kimo-icon-button__icon",
}
const lm = (n: number) => `.kimo-library-manager__list > :nth-child(${n})`
const lmRow = (n: number, id: string, status: string, action: boolean) => {
  const m = libRow(`${id}/`, lm(n), status, action)
  return { [id]: lm(n), ...m }
}
MAP_M3.KBZKl = {
  nodes: {
    ...popHeader,
    SCB6r: ".kimo-library-manager__body",
    BUKMI: ".kimo-library-manager__intro",
    dbxcv: ".kimo-library-manager__intro-text",
    lKwPW: ".kimo-library-manager__list",
    ...lmRow(1, "X6Kgar", "f5F6r", false),
    ...lmRow(2, "q2GLnB", "ex6KL", true),
    ...lmRow(3, "wAGTc", "mCdi0", true),
    gXVzr: ".kimo-library-manager__footer",
    CUBxW: ".kimo-library-manager__info",
    U68FD: ".kimo-library-manager__hint",
    kLH0f: ".kimo-library-manager__spacer",
    TJ2H2: ".kimo-library-manager__link",
    "TJ2H2/r5v5W": ".kimo-library-manager__link .kimo-button__icon",
    "TJ2H2/bzZjb": ".kimo-library-manager__link .kimo-button__label",
  },
}
const sl = (n: number) => `.kimo-swap-popover__list > :nth-child(${n})`
const swapRow = (n: number, id: string, selected: boolean) => {
  const m = assetRow(`${id}/`, sl(n))
  return { [id]: sl(n), ...(selected ? withoutMeta(m) : withoutCheck(m)) }
}
MAP_M3.jFlfP = {
  nodes: {
    ...popHeader,
    UFzU3: ".kimo-swap-popover__body",
    P4yRG: ".kimo-swap-popover__search",
    GktPK: ".kimo-swap-popover__input",
    "GktPK/mU4b8": ".kimo-swap-popover__input .kimo-input__icon",
    "GktPK/BwYzP": ".kimo-swap-popover__input .kimo-input__field",
    FQCYh: ".kimo-swap-popover__list",
    H8XZH: sl(1),
    Mmtuh: `${sl(1)} .kimo-swap-popover__group-title`,
    I5DMmx: `${sl(1)} .kimo-swap-popover__group-meta`,
    ...swapRow(2, "G4qIP", true),
    ...swapRow(3, "ubhi2", false),
    ...swapRow(4, "IRTo2", false),
    ODBay: sl(5),
    k9BwF: `${sl(5)} .kimo-swap-popover__group-title`,
    lDuor: `${sl(5)} .kimo-swap-popover__group-meta`,
    ...swapRow(6, "Qx8gc", false),
    ...swapRow(7, "IcYdp", false),
    EUTC7: ".kimo-swap-popover__footer",
    LPOgs: ".kimo-swap-popover__info",
    fU0wM: ".kimo-swap-popover__hint",
  },
}

// --- Confirms (board 15) -----------------------------------------------------------------------
const confirm = (ids: {
  head: string
  wrap: string
  icon: string
  text: string
  title: string
  desc: string
  impact: string
  items: [string, string, string][]
  footer: string
  check?: [string, string]
  spacer: string
  cancel: string
  confirm: string
}) => {
  const it = (n: number) => `.kimo-confirm-dialog__impact > :nth-child(${n})`
  return {
    [ids.head]: ".kimo-confirm-dialog__head",
    [ids.wrap]: ".kimo-confirm-dialog__icon-wrap",
    [ids.icon]: ".kimo-confirm-dialog__icon-wrap > svg",
    [ids.text]: ".kimo-confirm-dialog__text",
    [ids.title]: ".kimo-confirm-dialog__title",
    [ids.desc]: ".kimo-confirm-dialog__desc",
    [ids.impact]: ".kimo-confirm-dialog__impact",
    ...Object.assign(
      {},
      ...ids.items.map(([row, icon, text], i) => ({
        [row]: it(i + 1),
        [icon]: `${it(i + 1)} .kimo-confirm-dialog__item-icon`,
        [text]: `${it(i + 1)} .kimo-confirm-dialog__item-text`,
      })),
    ),
    [ids.footer]: ".kimo-confirm-dialog__footer",
    ...(ids.check
      ? {
          [ids.check[0]]: ".kimo-confirm-dialog__checkbox",
          [ids.check[1]]: ".kimo-confirm-dialog__check-label",
        }
      : {}),
    [ids.spacer]: ".kimo-confirm-dialog__spacer",
    [ids.cancel]: ".kimo-confirm-dialog__cancel",
    [`${ids.cancel}/e5j2wK`]: ".kimo-confirm-dialog__cancel .kimo-button__label",
    [ids.confirm]: ".kimo-confirm-dialog__confirm",
    [`${ids.confirm}/bzZjb`]: ".kimo-confirm-dialog__confirm .kimo-button__label",
  }
}
MAP_M3.i8PfIC = {
  nodes: confirm({
    head: "c79Dd0",
    wrap: "X2tlh",
    icon: "JWjQ4",
    text: "pp7dl",
    title: "hogRh",
    desc: "t3pTI",
    impact: "JRC2E",
    items: [
      ["O3haZ", "wlcAB", "km95z"],
      ["wSWht", "BseLt", "tAxa9"],
      ["F3Sku6", "t3iprY", "IuQuD"],
    ],
    footer: "M4Y1f",
    check: ["VP63n", "K0I8W"],
    spacer: "zdALJ",
    cancel: "Qtob3",
    confirm: "VxMdQ",
  }),
}
MAP_M3.ysXyK = {
  nodes: confirm({
    head: "PfZWY",
    wrap: "QtgbZ",
    icon: "Cj6bE",
    text: "vKBr6",
    title: "r1syT9",
    desc: "eV2UF",
    impact: "fskdm",
    items: [
      ["OkeJS", "C7VQFU", "uqm9M"],
      ["eqKGK", "kOpps", "xk6Hy"],
      ["WxDst", "yN3Cw", "mCNYz"],
    ],
    footer: "r948FK",
    spacer: "zsqFb",
    cancel: "N4YW2",
    confirm: "Zrgbe",
  }),
}
MAP_M3.fmB2B = {
  nodes: confirm({
    head: "w2C9Ir",
    wrap: "blKQe",
    icon: "WwpRQ",
    text: "duAKT",
    title: "jGqmL",
    desc: "C1Mgs",
    impact: "vM0BJ",
    items: [
      ["kaXKY", "csPXF", "IEI2N"],
      ["jaBup", "qUWL3", "N5yuhm"],
      ["yIJ7A", "KxP7W", "DNKkj"],
    ],
    footer: "YQVtA",
    spacer: "izXY6",
    cancel: "kW8s2",
    confirm: "Vjika",
  }),
}

// --- Accepted deviations -------------------------------------------------------------------------
for (const root of ["VqB97", "hXmP2", "n0ujw4", "ieuje"])
  ACCEPTED_M3[`${root}/Q6ffKn/vpMpD:w`] =
    "the design's Target text overflows its 113px PropField (Pencil does not clip); the field ellipsizes"
/**
 * Accumulated text-advance rounding: Pencil ceil-rounds every text box (mono 11 "density" = 46.2
 * → 47), so containers holding several texts (chips, meta rows, the 5-label type filter) and the
 * siblings after them drift by up to ~3px. Same cause as the 2px `text-rounding` class, summed.
 */
const ROUNDING =
  "summed per-text ceil rounding in Pencil (several text boxes in one container), not layout drift"
for (const key of [
  "mFjXw/gBeqn/n95i7v:x",
  "mFjXw/gBeqn/T20Nq:x",
  "hxry7/bz08k:w",
  "heWrG/bz08k:w",
  "EIkIk/GHEjw:w",
  "EIkIk/WmniH:x",
  "EIkIk/j3cux:x",
  "EIkIk/k2mCY0:x",
  "EIkIk/k2mCY0:w",
  "EIkIk/EoDRL:w",
  "KBZKl/X6Kgar/bz08k:w",
  "KBZKl/wAGTc/bz08k:w",
  "jFlfP/fU0wM:w",
])
  ACCEPTED_M3[key] = ROUNDING
