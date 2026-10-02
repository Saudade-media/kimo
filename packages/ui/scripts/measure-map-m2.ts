/**
 * Pen node → DOM selector map for board "02b Components — Styling (M2)" (mj1CX), used by
 * measure-gallery.ts against test/fixtures/pen-components-m2.json. Keys are the component roots
 * (`[data-pen=<id>]` in GalleryM2); node keys are pen ids (instance descendants as
 * `<instance child>/<id>`), selectors are relative to the root.
 */
export type NodeMap = Record<string, { root?: string; nodes: Record<string, string> }>

export const MAP_M2: NodeMap = {}
const nth = (n: number, sel = "") => `:scope > :nth-child(${n})${sel ? ` ${sel}` : ""}`

MAP_M2.UWiq1 = {
  nodes: {
    Y9KX4: ".kimo-slider__track",
    sBcG4: ".kimo-slider__fill",
    g0Ask: ".kimo-slider__thumb",
  },
}
MAP_M2.weqLa = { nodes: { kakaj: ".kimo-slider__track", I4582f: ".kimo-slider__thumb" } }
MAP_M2.qpmcK = {
  nodes: {
    A62mZE: ".kimo-slider__track",
    rp05o: ".kimo-slider__checker",
    C4KYVj: ".kimo-slider__gradient",
    o6DokA: ".kimo-slider__thumb",
  },
}
const colorArea = (p = "") => ({
  [`${p}P4xJV`]: ".kimo-color-area__saturation",
  [`${p}h99I2`]: ".kimo-color-area__brightness",
  [`${p}phbmP`]: ".kimo-color-area__ring",
})
MAP_M2.H5QKDe = { nodes: colorArea() }
MAP_M2.rbnJS = {
  nodes: {
    i6ppu: ".kimo-gradient-stop-bar__bar",
    a99w5: ".kimo-gradient-stop-bar__checker",
    mvEk6: ".kimo-gradient-stop-bar__gradient",
    ZcnQu: nth(2),
    K4HkL: nth(2, ".kimo-gradient-stop-bar__color"),
    cnamv: nth(3),
    xPDRx: nth(3, ".kimo-gradient-stop-bar__color"),
    gsuaC: nth(4),
    aqhjD: nth(4, ".kimo-gradient-stop-bar__color"),
  },
}
MAP_M2.rg74x = { nodes: { A4ord9: ".kimo-swatch-tile__color" } }
MAP_M2.Jr3U1 = { nodes: { ZYVjQ: ".kimo-swatch-tile__color" } }
MAP_M2.D4Fvc = { nodes: { C2TeV: ".kimo-icon-tile__icon" } }
MAP_M2.Nv0eZ = { nodes: { gDIkb: ".kimo-icon-tile__icon" } }
MAP_M2.cJZRB = { nodes: { WscTp: ".kimo-icon-tile__icon" } }
MAP_M2.J6Reo = {
  nodes: {
    xyvmk: nth(1),
    X35aT5: nth(1, ".kimo-segmented__icon"),
    RzC9v: nth(2),
    P8uCrn: nth(2, ".kimo-segmented__icon"),
  },
}
const fillRow = {
  chrvk: ".kimo-fill-row__field",
  "chrvk/cBpdy": ".kimo-color-field__swatch",
  "chrvk/mEuTa": ".kimo-color-field__value",
  "chrvk/T0lqqG": ".kimo-color-field__spacer",
  "chrvk/nHpYT": ".kimo-color-field__opacity",
  r3MBc: ".kimo-fill-row__eye",
  "r3MBc/nd1MZ": ".kimo-fill-row__eye .kimo-icon-button__icon",
  FFtaO: ".kimo-fill-row__remove",
  "FFtaO/nd1MZ": ".kimo-fill-row__remove .kimo-icon-button__icon",
}
MAP_M2.xYqbE = { nodes: fillRow }
MAP_M2.vBwVv = { nodes: fillRow }
MAP_M2.X5R2J = { nodes: fillRow }
MAP_M2.Q6vwp = {
  nodes: {
    gLR6X: ".kimo-effect-row__field",
    upS17: ".kimo-effect-row__settings",
    bPqpB: ".kimo-effect-row__settings svg",
    q0Vgql: ".kimo-effect-row__type",
    l3oJno: ".kimo-effect-row__spacer",
    Gh1AU: ".kimo-effect-row__chevron",
    nYSHl: ".kimo-effect-row__eye",
    "nYSHl/nd1MZ": ".kimo-effect-row__eye .kimo-icon-button__icon",
    M0titT: ".kimo-effect-row__remove",
    "M0titT/nd1MZ": ".kimo-effect-row__remove .kimo-icon-button__icon",
  },
}
const sides: Record<string, string> = {}
for (const [i, id] of ["g3gRYJ", "Z4v6F", "uQC3c", "O5XDn3"].entries()) {
  sides[id] = nth(i + 1)
  sides[`${id}/jXquz`] = nth(i + 1, ".kimo-prop-field__prefix")
  sides[`${id}/vpMpD`] = nth(i + 1, ".kimo-prop-field__value")
}
MAP_M2.YMKcJ = { nodes: sides }
const popover = {
  Am1eq: ".kimo-popover__header",
  lSGG7: ".kimo-popover__leading",
  cNBKW: ".kimo-popover__title",
  gKfsp: ".kimo-popover__close",
  "gKfsp/nd1MZ": ".kimo-popover__close .kimo-icon-button__icon",
  LjbJY: ".kimo-popover__body",
  CtzSh: ".kimo-color-area",
  "CtzSh/P4xJV": ".kimo-color-area__saturation",
  "CtzSh/h99I2": ".kimo-color-area__brightness",
  "CtzSh/phbmP": ".kimo-color-area__ring",
  HwsHk: ".kimo-slider--hue",
  "HwsHk/kakaj": ".kimo-slider--hue .kimo-slider__track",
  "HwsHk/I4582f": ".kimo-slider--hue .kimo-slider__thumb",
}
MAP_M2.xvOvm = { nodes: popover }
MAP_M2.u0aiz = { nodes: popover }
MAP_M2.u0dQ1 = { nodes: { A8BzSa: ".kimo-tooltip-hint__icon", Zlv3i: ".kimo-tooltip-hint__label" } }
const sizeField = {
  t111tE: ".kimo-size-field__prefix",
  WCAAf: ".kimo-size-field__value",
  jl5qQ: ".kimo-size-field__spacer",
  aC4BS: ".kimo-size-field__mode",
  n908B: ".kimo-size-field__chevron",
}
MAP_M2.G6R6IX = { nodes: sizeField }
MAP_M2.g3qZq7 = { nodes: sizeField }
MAP_M2.QvUEC = { nodes: sizeField }
const grid: Record<string, string> = {}
const rows: [string, [string, string][]][] = [
  [
    "xdx2v",
    [
      ["XKNOk", "tkeBE"],
      ["ubUXM", "L6YI6l"],
      ["C55ujM", "SkE1L"],
    ],
  ],
  [
    "q0HLow",
    [
      ["XU5yX", "YG1KY"],
      ["cfQJF", "YOeF5"],
      ["ip1r2", "okjDg"],
    ],
  ],
  [
    "S6hP0",
    [
      ["xzknN", "SbCaU"],
      ["Jeo1g", "At34O"],
      ["WVB0n", "Qjaar"],
    ],
  ],
]
for (const [r, [rowId, cells]] of rows.entries()) {
  grid[rowId] = nth(r + 1)
  for (const [c, [cellId, markId]] of cells.entries()) {
    const cell = `${nth(r + 1)} > :nth-child(${c + 1})`
    grid[cellId] = cell
    grid[markId] = `${cell} > :first-child`
  }
}
grid.KRJd7 = `${nth(1)} > :nth-child(1) .kimo-alignment-grid__bar:nth-child(1)`
grid.vMM1Q = `${nth(1)} > :nth-child(1) .kimo-alignment-grid__bar:nth-child(2)`
grid.C1o2i = `${nth(1)} > :nth-child(1) .kimo-alignment-grid__bar:nth-child(3)`
MAP_M2.i1pQK = { nodes: grid }
MAP_M2.z1rMhb = {
  nodes: {
    WQLZ0: ".kimo-prop-section__header",
    UB7fP: ".kimo-prop-section__title",
    c3QSj: ".kimo-prop-section__action svg",
  },
}
MAP_M2.L5GCtM = { nodes: { YOaqt: ".kimo-zoom-badge__icon", Jf0P7: ".kimo-zoom-badge__label" } }
const item = (n: number, p: string) => ({
  [p ? `${p}` : "EAGNC"]: `.kimo-menu-dense__items > :nth-child(${n})`,
  [`${p ? `${p}/` : ""}Hl922`]: `.kimo-menu-dense__items > :nth-child(${n}) .kimo-menu-item-dense__check`,
  [`${p ? `${p}/` : ""}BRxvS`]: `.kimo-menu-dense__items > :nth-child(${n}) .kimo-menu-item-dense__label`,
  [`${p ? `${p}/` : ""}g602J`]: `.kimo-menu-dense__items > :nth-child(${n}) .kimo-menu-item-dense__spacer`,
})
MAP_M2.G7A3Aj = {
  nodes: {
    ksc3x: ".kimo-menu-dense__items",
    ...item(1, ""),
    ...item(2, "bkJJG"),
    "bkJJG/RmOTH": ".kimo-menu-dense__items > :nth-child(2) .kimo-menu-item-dense__check svg",
    fYNDQ: ".kimo-menu-dense__items > :nth-child(3)",
    eTfCQ: ".kimo-menu-dense__items > :nth-child(3) .kimo-menu-divider__line",
    ...item(4, "dQw9B"),
    "dQw9B/T4CD1": ".kimo-menu-dense__items > :nth-child(4) .kimo-menu-item-dense__meta",
  },
}

/** Input elements (fill the field), so their width is not the design text's hug width. */
export const FLEX_WIDTH_M2 = new Set([
  "WCAAf",
  "g3gRYJ/vpMpD",
  "Z4v6F/vpMpD",
  "uQC3c/vpMpD",
  "O5XDn3/vpMpD",
])

// --- Board 09 composite popovers (roots: the GalleryM2 column carries the popover's id) ------

const P = ".kimo-popover"
MAP_M2.jNAqx = {
  root: P,
  nodes: {
    Am1eq: ".kimo-popover__header",
    YaEK9: ".kimo-color-picker__tabs",
    v9x2cD: ".kimo-color-picker__tabs > :nth-child(1)",
    "v9x2cD/nREvy": ".kimo-color-picker__tabs > :nth-child(1) .kimo-tab__label",
    U9HFie: ".kimo-color-picker__tabs > :nth-child(2)",
    "U9HFie/vznhI": ".kimo-color-picker__tabs > :nth-child(2) .kimo-tab__label",
    U21Ts: ".kimo-popover__actions",
    hcAM8: ".kimo-popover__actions > :nth-child(1)",
    "hcAM8/nd1MZ": ".kimo-popover__actions > :nth-child(1) .kimo-icon-button__icon",
    W3Ijc: ".kimo-popover__actions > :nth-child(2)",
    "W3Ijc/nd1MZ": ".kimo-popover__actions > :nth-child(2) .kimo-icon-button__icon",
    aV4J8: ".kimo-popover__body",
    BEI3g: ".kimo-color-area",
    "BEI3g/phbmP": ".kimo-color-area__ring",
    Lcpbt: ".kimo-color-picker__sliders",
    WBLRZ: ".kimo-slider--hue",
    "WBLRZ/kakaj": ".kimo-slider--hue .kimo-slider__track",
    BVfN2: ".kimo-slider--alpha",
    "BVfN2/A62mZE": ".kimo-slider--alpha .kimo-slider__track",
    "BVfN2/o6DokA": ".kimo-slider--alpha .kimo-slider__thumb",
    v0Mnm: ".kimo-color-picker__value-row",
    xothp: ".kimo-color-picker__format .kimo-select__trigger",
    "xothp/LWF8n": ".kimo-color-picker__format .kimo-select__value",
    "xothp/VLDHF": ".kimo-color-picker__format .kimo-select__chevron",
    AqBJI: ".kimo-color-picker__hex",
    "AqBJI/jXquz": ".kimo-color-picker__hex .kimo-prop-field__prefix",
    "AqBJI/vpMpD": ".kimo-color-picker__hex .kimo-prop-field__value",
    aaHXu: ".kimo-color-picker__opacity",
    "aaHXu/vpMpD": ".kimo-color-picker__opacity .kimo-prop-field__value",
    s28qjJ: ".kimo-color-picker__divider",
    cuPjC: ".kimo-color-picker__document",
    Gf0ES: ".kimo-color-picker__document-header",
    EisL5: ".kimo-color-picker__caption",
    Nmc4H: ".kimo-color-picker__swatches",
    mEOzn: ".kimo-color-picker__swatches > :nth-child(1)",
    "mEOzn/ZYVjQ": ".kimo-color-picker__swatches > :nth-child(1) .kimo-swatch-tile__color",
    pKxJZ: ".kimo-color-picker__swatches > :nth-child(2)",
    ybeyM: ".kimo-color-picker__swatches > :nth-child(8)",
  },
}
const opt = (n: number) => `.kimo-color-picker__list > :nth-child(${n})`
MAP_M2.nim6l = {
  root: P,
  nodes: {
    Am1eq: ".kimo-popover__header",
    h08Kr2: ".kimo-color-picker__tabs",
    CbIED: ".kimo-color-picker__tabs > :nth-child(1)",
    "CbIED/vznhI": ".kimo-color-picker__tabs > :nth-child(1) .kimo-tab__label",
    oWCRc: ".kimo-color-picker__tabs > :nth-child(2)",
    "oWCRc/nREvy": ".kimo-color-picker__tabs > :nth-child(2) .kimo-tab__label",
    NBkDd: ".kimo-popover__actions > :nth-child(1)",
    "NBkDd/nd1MZ": ".kimo-popover__actions > :nth-child(1) .kimo-icon-button__icon",
    gAWcP: ".kimo-popover__body",
    tub8E: ".kimo-input",
    "tub8E/mU4b8": ".kimo-input__icon",
    rYitk: ".kimo-color-picker__list",
    qLcop: opt(1),
    J4cpC: `${opt(1)} > :nth-child(1)`,
    l95N4: `${opt(1)} > :nth-child(3)`,
    P4Q35R: opt(2),
    Hvp8a: `${opt(2)} .kimo-swatch-tile`,
    "Hvp8a/A4ord9": `${opt(2)} .kimo-swatch-tile__color`,
    UMeBX: `${opt(2)} .kimo-color-picker__variable-name`,
    w6mMtw: `${opt(2)} .kimo-color-picker__modes`,
    P4ocE: `${opt(2)} .kimo-color-picker__mode-chip:nth-child(1)`,
    F574kk: `${opt(2)} .kimo-color-picker__mode-chip:nth-child(2)`,
    uRKfB: `${opt(2)} .kimo-color-picker__check`,
    WfQjY: opt(3),
    tWAgH: `${opt(3)} .kimo-color-picker__variable-name`,
    zIByS: `${opt(3)} .kimo-color-picker__check`,
    i92eU: opt(5),
    O8m9E: `${opt(5)} > :nth-child(1)`,
    Uy64L: ".kimo-color-picker__footer",
    VpAK8: ".kimo-color-picker__footer-label",
    DnYCQ: ".kimo-color-picker__footer-modes",
  },
}
const stopRow = (n: number) => `.kimo-gradient-editor__stops > :nth-child(${n + 1})`
MAP_M2.b2Y0pD = {
  root: P,
  nodes: {
    Am1eq: ".kimo-popover__header",
    cNBKW: ".kimo-popover__title",
    zpQWu: ".kimo-popover__body",
    HSLaf: ".kimo-gradient-editor__type-row",
    WpK9W: ".kimo-gradient-editor__type-row .kimo-segmented",
    "WpK9W/FC69Q": ".kimo-gradient-editor__type-row .kimo-segmented > :nth-child(1)",
    KMt1r: ".kimo-gradient-editor__type-row .kimo-segmented > :nth-child(1) .kimo-segmented__label",
    "WpK9W/au7em": ".kimo-gradient-editor__type-row .kimo-segmented > :nth-child(2)",
    FfEto: ".kimo-gradient-editor__type-row .kimo-segmented > :nth-child(2) .kimo-segmented__label",
    hssZQ: ".kimo-gradient-editor__type-row > :nth-child(2)",
    "hssZQ/nd1MZ": ".kimo-gradient-editor__type-row > :nth-child(2) .kimo-icon-button__icon",
    p2vIye: ".kimo-gradient-editor__type-row > :nth-child(3)",
    ELn9I: ".kimo-gradient-stop-bar",
    "ELn9I/cnamv": ".kimo-gradient-stop-bar > :nth-child(3)",
    qZRBZ: ".kimo-gradient-editor__stops",
    Zl90z: ".kimo-gradient-editor__stops-header",
    cbt1r: ".kimo-gradient-editor__caption",
    GsUmc: ".kimo-gradient-editor__add",
    "GsUmc/nd1MZ": ".kimo-gradient-editor__add .kimo-icon-button__icon",
    DnlRf: stopRow(1),
    tuXxG: `${stopRow(1)} .kimo-color-field`,
    "tuXxG/cBpdy": `${stopRow(1)} .kimo-color-field__swatch`,
    "tuXxG/mEuTa": `${stopRow(1)} .kimo-color-field__value`,
    "tuXxG/nHpYT": `${stopRow(1)} .kimo-color-field__opacity`,
    X0q4f5: `${stopRow(1)} .kimo-gradient-editor__position`,
    LyHCN: `${stopRow(1)} > :nth-child(3)`,
    "LyHCN/nd1MZ": `${stopRow(1)} > :nth-child(3) .kimo-icon-button__icon`,
    KaNVU: `${stopRow(2)} .kimo-color-field`,
    Y3VEa: ".kimo-gradient-editor__divider",
    CAjFK: ".kimo-color-area",
    B1jPT: ".kimo-slider--hue",
  },
}
const blend = (n: number) => `.kimo-menu-dense__items > :nth-child(${n})`
MAP_M2.YFOTX = {
  root: ".kimo-menu-dense",
  nodes: {
    QyCHm: ".kimo-menu-dense__items",
    ZL91v: blend(1),
    "ZL91v/BRxvS": `${blend(1)} .kimo-menu-item-dense__label`,
    G4vMXV: blend(2),
    pHL6l: blend(3),
    "pHL6l/eTfCQ": `${blend(3)} .kimo-menu-divider__line`,
    qxBSa: blend(4),
    sdH13: blend(5),
    "sdH13/RmOTH": `${blend(5)} .kimo-menu-item-dense__check svg`,
    "sdH13/BRxvS": `${blend(5)} .kimo-menu-item-dense__label`,
    i0dSl: blend(8),
    F1x1N: blend(24),
  },
}
const recent = (n: number) =>
  `.kimo-icon-picker__section:nth-child(1) .kimo-icon-picker__row > :nth-child(${n})`
const all = ".kimo-icon-picker__section:nth-child(2)"
MAP_M2.b1gaD = {
  root: P,
  nodes: {
    Am1eq: ".kimo-popover__header",
    cNBKW: ".kimo-popover__title",
    gKfsp: ".kimo-popover__close",
    NfvcI: ".kimo-popover__body",
    SrSfb: ".kimo-input",
    "SrSfb/mU4b8": ".kimo-input__icon",
    CSNC1: ".kimo-popover__body > .kimo-segmented",
    ZKCsg: ".kimo-popover__body > .kimo-segmented > :nth-child(1)",
    Bw2HW: ".kimo-popover__body > .kimo-segmented > :nth-child(1) .kimo-segmented__label",
    HIGJ9: ".kimo-popover__body > .kimo-segmented > :nth-child(2)",
    NcCay: ".kimo-popover__body > .kimo-segmented > :nth-child(4)",
    wiMy8: ".kimo-icon-picker__grid",
    Jnqwo: ".kimo-icon-picker__section:nth-child(1)",
    HdtiO: ".kimo-icon-picker__section:nth-child(1) .kimo-icon-picker__label",
    JweM3: ".kimo-icon-picker__section:nth-child(1) .kimo-icon-picker__row",
    q73bVb: recent(1),
    "q73bVb/WscTp": `${recent(1)} .kimo-icon-tile__icon`,
    V3gg7: recent(3),
    V6wUp: recent(8),
    K1fpj: all,
    QFgn2: `${all} .kimo-icon-picker__label`,
    R2f2N: `${all} .kimo-icon-picker__rows > :nth-child(1)`,
    trVIN: `${all} .kimo-icon-picker__rows > :nth-child(1) > :nth-child(1)`,
    "trVIN/C2TeV": `${all} .kimo-icon-picker__rows > :nth-child(1) > :nth-child(1) .kimo-icon-tile__icon`,
    xTjEJ: `${all} .kimo-icon-picker__rows > :nth-child(1) > :nth-child(8)`,
    YYPzZ: `${all} .kimo-icon-picker__rows > :nth-child(4)`,
    LD9gw: `${all} .kimo-icon-picker__rows > :nth-child(4) > :nth-child(8)`,
    UJ0xj: ".kimo-icon-picker__footer",
    cD0BM: ".kimo-icon-picker__name",
    axW82: ".kimo-icon-picker__license",
  },
}
MAP_M2.r6tBTD = {
  root: P,
  nodes: {
    ubF4u: ".kimo-popover__body",
    jOl4f: ".kimo-input",
    "jOl4f/BwYzP": ".kimo-input__field",
    KeBqU: ".kimo-popover__body > .kimo-segmented:nth-of-type(1)",
    q6Y2gW: ".kimo-popover__body > .kimo-segmented:nth-of-type(1) > :nth-child(3)",
    w5XAy: ".kimo-popover__body > .kimo-segmented:nth-of-type(2)",
    bsQha: ".kimo-popover__body > .kimo-segmented:nth-of-type(2) > :nth-child(1)",
    ZKch3: ".kimo-popover__body > .kimo-segmented:nth-of-type(2) > :nth-child(2)",
    byL5l: ".kimo-icon-picker__weight-row",
    zmSfL: ".kimo-icon-picker__weight-label",
    g6yTx: ".kimo-icon-picker__weight-row .kimo-slider",
    "g6yTx/g0Ask": ".kimo-icon-picker__weight-row .kimo-slider__thumb",
    BmLk7: ".kimo-icon-picker__empty",
    pR2yf: ".kimo-icon-picker__empty-icon",
    wiJRe: ".kimo-icon-picker__empty-title",
    TNBMi: ".kimo-icon-picker__empty-hint",
    ibzGa: ".kimo-icon-picker__empty .kimo-button",
    "ibzGa/zAVGx": ".kimo-icon-picker__empty .kimo-button__icon",
    "ibzGa/e5j2wK": ".kimo-icon-picker__empty .kimo-button__label",
  },
}
MAP_M2.Kgfrv = {
  root: P,
  nodes: {
    Am1eq: ".kimo-popover__header",
    cNBKW: ".kimo-popover__title",
    gKfsp: ".kimo-popover__close",
    dKBYR: ".kimo-popover__body",
    QfW69: ".kimo-image-fill__preview",
    MKJER: ".kimo-image-fill__image",
    Ibpeh: ".kimo-image-fill__badge",
    PNcxg: ".kimo-image-fill__badge-label",
    H9VoX: ".kimo-image-fill__row:nth-child(2)",
    yQWU4: ".kimo-image-fill__row:nth-child(2) .kimo-image-fill__label",
    dnSC6: ".kimo-image-fill__mode .kimo-select__trigger",
    "dnSC6/LWF8n": ".kimo-image-fill__mode .kimo-select__value",
    "dnSC6/VLDHF": ".kimo-image-fill__mode .kimo-select__chevron",
    i155wM: ".kimo-image-fill__row:nth-child(3)",
    Vmzip: ".kimo-image-fill__row:nth-child(3) .kimo-image-fill__label",
    OVyIC: ".kimo-image-fill__opacity",
    "OVyIC/vpMpD": ".kimo-image-fill__opacity .kimo-prop-field__value",
    RhQn8: ".kimo-image-fill__actions",
    MByca: ".kimo-image-fill__replace",
    "MByca/hfife": ".kimo-image-fill__replace .kimo-button__icon",
    "MByca/D5Dhjk": ".kimo-image-fill__replace .kimo-button__label",
    R4Aey: ".kimo-image-fill__remove",
    "R4Aey/zAVGx": ".kimo-image-fill__remove .kimo-button__icon",
    "R4Aey/e5j2wK": ".kimo-image-fill__remove .kimo-button__label",
  },
}
for (const id of ["AqBJI/vpMpD", "aaHXu/vpMpD", "OVyIC/vpMpD", "jOl4f/BwYzP"]) FLEX_WIDTH_M2.add(id)
