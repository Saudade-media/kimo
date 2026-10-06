/**
 * Fernhill: the online shop of a fictional independent home goods store in Asheville, NC.
 * Desktop (1440 wide): Home, Category, Product, Cart, Checkout, Order confirmation.
 * Mobile (390×844): Home, Product, Cart.
 *
 * Direction (references in the brief): quiet editorial commerce in the line of Faire, Hay and
 * Crate & Barrel. A 12 column grid on 64 px margins, light Inter display type with tight tracking,
 * JetBrains Mono for numbers and captions, hairline rules instead of cards, square corners,
 * flat tonal product tiles with a single resting object, one ink-black action color, fern green
 * only for state, and an oxide red for sale prices.
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "ecommerce-store",
  name: "Fernhill home goods store",
  category: "eCommerce",
  description:
    "Nine-screen editorial online store for an independent home goods shop: home, category, product, cart, checkout and confirmation on desktop, plus home, product and cart on mobile.",
  prefix: "fh",
  build,
}

type Tone = "clay" | "sage" | "oat" | "slate" | "rose" | "char"
type Shape =
  | "vase"
  | "mug"
  | "candle"
  | "bowl"
  | "plate"
  | "throw"
  | "pillow"
  | "board"
  | "carafe"
  | "towel"

/** Object geometry per shape at card scale: body, neck (top piece), handle and foot (base). */
const SHAPES: Record<
  Shape,
  {
    body: [number, number, number[]]
    neck?: [number, number, number[]]
    handle?: [number, number]
    foot?: [number, number, number[]]
  }
> = {
  vase: { body: [100, 150, [50, 50, 30, 30]], neck: [38, 40, [6, 6, 0, 0]] },
  mug: { body: [104, 100, [6, 6, 26, 26]], handle: [46, 56] },
  candle: { body: [74, 140, [10, 10, 8, 8]], neck: [6, 18, [3, 3, 0, 0]] },
  bowl: { body: [184, 78, [6, 6, 92, 92]] },
  plate: { body: [236, 20, [10, 10, 10, 10]], foot: [128, 10, [0, 0, 5, 5]] },
  throw: { body: [200, 132, [14, 14, 14, 14]] },
  pillow: { body: [172, 160, [44, 44, 44, 44]] },
  board: { body: [232, 50, [25, 25, 25, 25]] },
  carafe: { body: [110, 130, [28, 28, 52, 52]], neck: [40, 56, [8, 8, 0, 0]] },
  towel: { body: [160, 172, [8, 8, 8, 8]] },
}

/**
 * Body/handle overlap: the handle ring tucks under the body by its outer band only, so its hole
 * (innerRadius 0.55, starting 22.5% in) always stays clear of the body at any scale.
 */
const handleGap = (handleW: number) => -Math.max(1, Math.round(handleW * 0.2))

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#F2EEE6", "#151311"],
      surface: ["#FAF8F3", "#1B1815"],
      subtle: ["#E9E4D9", "#221F1B"],
      ink: ["#1B1915", "#F1ECE3"],
      "ink-2": ["#45403A", "#CBC4B8"],
      muted: ["#7A7367", "#9A9285"],
      border: ["#D6CFC0", "#38332C"],
      accent: ["#2F4B3B", "#9BBBA5"],
      "accent-soft": ["#DDE5DB", "#1F2B24"],
      "on-accent": ["#F6F3EC", "#12100E"],
      inverse: ["#1B1915", "#0D0C0A"],
      "on-inverse": ["#F2EEE6", "#F1ECE3"],
      "inverse-muted": ["#B3AB9C", "#A39886"],
      success: ["#2F4B3B", "#9BBBA5"],
      sale: ["#A33F26", "#E5836A"],
      "sale-soft": ["#F1DDD5", "#3B1D16"],
      star: ["#1B1915", "#F1ECE3"],
      "clay-bg": ["#E4D3C4", "#33281F"],
      clay: ["#B5724F", "#A8694A"],
      "sage-bg": ["#D7DCCB", "#262B22"],
      sage: ["#7F8F72", "#75866A"],
      "oat-bg": ["#E6DDC9", "#2E2920"],
      oat: ["#C9B68F", "#AE9C78"],
      "slate-bg": ["#D3D9DB", "#22282B"],
      slate: ["#5E6F78", "#70838D"],
      "rose-bg": ["#E8D6D0", "#35262A"],
      rose: ["#BC8479", "#A87A72"],
      "char-bg": ["#DAD5CD", "#262321"],
      char: ["#3E3A36", "#8A847C"],
    },
    numbers: {
      "space/1": 4,
      "space/2": 8,
      "space/3": 12,
      "space/4": 16,
      "space/5": 20,
      "space/6": 24,
      "space/8": 32,
      "space/10": 40,
      "space/12": 48,
      "space/16": 64,
      "space/20": 80,
      "radius/sm": 1,
      "radius/md": 2,
      "radius/lg": 2,
      "radius/xl": 2,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 80, weight: 300, lineHeight: 1.0, letterSpacing: -3.4 },
      h1: { font: "Inter", size: 46, weight: 300, lineHeight: 1.08, letterSpacing: -1.6 },
      heading: { font: "Inter", size: 30, weight: 300, lineHeight: 1.2, letterSpacing: -0.9 },
      title: { font: "Inter", size: 16, weight: 500, lineHeight: 1.35, letterSpacing: -0.1 },
      "body-lg": { font: "Inter", size: 17, weight: 400, lineHeight: 1.6 },
      body: { font: "Inter", size: 15, weight: 400, lineHeight: 1.55 },
      label: { font: "Inter", size: 13, weight: 500, lineHeight: 1.3, letterSpacing: 0.1 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      price: { font: "Inter", size: 15, weight: 500, lineHeight: 1.3 },
      eyebrow: { font: "JetBrains Mono", size: 11, weight: 500, lineHeight: 1.3, letterSpacing: 1 },
      mono: { font: "JetBrains Mono", size: 12, weight: 400, lineHeight: 1.4 },
    },
  })

  const c = (n: string) => b.c(n)
  /** A filled five-point star (lucide's star icon is outline only). */
  const star = (parent: string, size: number) =>
    b.add(parent, {
      type: "polygon",
      name: "Star",
      w: size,
      h: size,
      sides: 5,
      star: { ratio: 0.48 },
      fill: c("star"),
    })
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const hair = (sides: Record<string, number> = { b: 1 }, paint = c("border")) => ({
    stroke: { paint, width: sides },
  })
  /** Underlined text link: a hugging row with a 1 px ink rule under the text. */
  const link = (parent: string, label: string, props: Record<string, unknown> = {}) => {
    const l = b.row(parent, "Link", { pad: [0, 0, 2, 0], ...hair({ b: 1 }, ink), ...props })
    b.text(l, label, b.ty("label"), ink, { name: "Label" })
    return l
  }
  const toneBg = (t: Tone) => c(`${t}-bg`)

  // --- Components: basics ----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary (ink), secondary (outline), ghost or inverse (on dark); md or lg.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": ink,
            "root.stroke": { paint: ink },
            "BtnLabel.fill": c("bg"),
            "BtnIcon.color": c("bg"),
          },
          secondary: {
            "root.fill": [],
            "root.stroke": { paint: ink },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          ghost: {
            "root.fill": [],
            "root.stroke": { paint: c("border"), width: 0 },
            "BtnLabel.fill": ink,
            "BtnIcon.color": ink,
          },
          inverse: {
            "root.fill": c("on-inverse"),
            "root.stroke": { paint: c("on-inverse") },
            "BtnLabel.fill": c("inverse"),
            "BtnIcon.color": c("inverse"),
          },
        }),
        size: p.variants({
          md: { "root.layout/pad": [11, 20], "BtnLabel.style/size": 13 },
          lg: { "root.layout/pad": [16, 28], "BtnLabel.style/size": 14 },
        }),
      },
      root: {
        dir: "row",
        gap: s(2),
        align: "center",
        justify: "center",
        pad: [11, 20],
        radius: 0,
        fill: ink,
        stroke: { paint: ink },
      },
    },
    (root) => {
      b.text(root, "Button", b.ty("label", { letterSpacing: 0.3 }), c("bg"), {
        key: "BtnLabel",
        name: "Label",
      })
      b.icon(root, "arrow-right", 15, c("bg"), { key: "BtnIcon", visible: false })
    },
  )
  const buttonSecondary = b.derive(button, "Button/Secondary", "BtnSec", {
    section: "Actions",
    args: { variant: "secondary" },
  })

  const badge = b.component(
    "Badge",
    {
      key: "Badge",
      section: "Actions",
      description: "Stamp: outlined mono caps, no fill.",
      props: {
        label: p.text("BadgeLbl", "BADGE"),
        tone: p.variants({
          neutral: { "root.stroke": { paint: c("ink-2") }, "BadgeLbl.fill": c("ink-2") },
          accent: { "root.stroke": { paint: c("accent") }, "BadgeLbl.fill": c("accent") },
          sale: { "root.stroke": { paint: c("sale") }, "BadgeLbl.fill": c("sale") },
          success: { "root.stroke": { paint: c("accent") }, "BadgeLbl.fill": c("accent") },
        }),
      },
      root: { dir: "row", pad: [3, 6], radius: 0, stroke: { paint: c("ink-2") } },
    },
    (root) =>
      b.text(root, "BADGE", b.ty("eyebrow", { size: 10, letterSpacing: 0.8 }), c("ink-2"), {
        key: "BadgeLbl",
        name: "Label",
      }),
  )
  const badgeNew = b.derive(badge, "Badge/New", "BdgNew", {
    section: "Actions",
    args: { tone: "accent", label: "NEW" },
  })
  const badgeSale = b.derive(badge, "Badge/Sale", "BdgSale", {
    section: "Actions",
    args: { tone: "sale", label: "SALE" },
  })

  const rating = b.component(
    "Rating",
    {
      key: "Rating",
      section: "Product",
      props: {
        value: p.text("RtVal", "4.9"),
        count: p.text("RtCnt", "212 reviews"),
        showCount: p.bool("RtCnt", true),
      },
      root: { dir: "row", gap: s(2), align: "center" },
    },
    (root) => {
      const stars = b.row(root, "Stars", { gap: 2, align: "center" })
      for (let i = 0; i < 5; i++) star(stars, 11)
      b.text(root, "4.9", b.ty("mono", { size: 12 }), ink, { key: "RtVal", name: "Value" })
      b.text(root, "212 reviews", b.ty("mono", { size: 12 }), muted, {
        key: "RtCnt",
        name: "Count",
      })
    },
  )

  // Product image: a flat tonal tile with one resting object (no image files).
  const shapeOpts = Object.fromEntries(
    (Object.keys(SHAPES) as Shape[]).map((sh) => {
      const g = SHAPES[sh]
      return [
        sh,
        {
          "PiBody.w": g.body[0],
          "PiBody.h": g.body[1],
          "PiBody.radius": g.body[2],
          "PiNeck.visible": !!g.neck,
          "PiNeck.w": g.neck?.[0] ?? 20,
          "PiNeck.h": g.neck?.[1] ?? 20,
          "PiNeck.radius": g.neck?.[2] ?? [0, 0, 0, 0],
          "PiHandle.visible": !!g.handle,
          "PiHandle.w": g.handle?.[0] ?? 40,
          "PiHandle.h": g.handle?.[1] ?? 40,
          "PiRow.layout/gap": handleGap(g.handle?.[0] ?? 40),
          "PiFoot.visible": !!g.foot,
          "PiFoot.w": g.foot?.[0] ?? 20,
          "PiFoot.h": g.foot?.[1] ?? 6,
          "PiFoot.radius": g.foot?.[2] ?? [0, 0, 0, 0],
        },
      ]
    }),
  )
  const toneOpts = Object.fromEntries(
    (["clay", "sage", "oat", "slate", "rose", "char"] as Tone[]).map((t) => [
      t,
      {
        "root.fill": toneBg(t),
        "PiBody.fill": c(t),
        "PiNeck.fill": c(t),
        "PiHandle.fill": c(t),
        "PiFoot.fill": c(t),
      },
    ]),
  )
  const productImage = b.component(
    "Product image",
    {
      key: "Pimg",
      section: "Product",
      description:
        "Flat tonal tile with one resting object. Pick a tone and a shape; thumb hides the top row.",
      props: {
        tone: p.variants(toneOpts),
        shape: p.variants(shapeOpts),
        size: p.variants({
          card: { "root.layout/pad": [14, 14, 36, 14], "PiTop.visible": true },
          thumb: { "root.layout/pad": 4, "PiTop.visible": false },
        }),
        badge: p.bool("PiTagWrap", true),
        badgeLabel: p.text("PiTag/BadgeLbl", "NEW"),
        badgeStyle: p.swap("PiTag", badgeNew),
        favorite: p.bool("PiFav", true),
      },
      root: {
        dir: "column",
        w: 300,
        h: 380,
        pad: [14, 14, 36, 14],
        radius: 0,
        fill: toneBg("clay"),
        clip: true,
      },
    },
    (root) => {
      const top = b.row(root, "Top", {
        key: "PiTop",
        w: FILL,
        h: 24,
        justify: "between",
        align: "center",
      })
      const tagWrap = b.row(top, "Badge", { key: "PiTagWrap" })
      b.use(tagWrap, badgeNew, { key: "PiTag" })
      const fav = b.row(top, "Favorite", {
        key: "PiFav",
        w: 24,
        h: 24,
        align: "center",
        justify: "center",
      })
      b.icon(fav, "heart", 16, c("ink-2"))
      const item = b.col(root, "Object", {
        w: FILL,
        h: FILL,
        align: "center",
        justify: "end",
      })
      b.rect(item, "Neck", {
        key: "PiNeck",
        w: 38,
        h: 40,
        radius: [6, 6, 0, 0],
        fill: c("clay"),
      })
      const body = b.row(item, "Body row", { key: "PiRow", gap: handleGap(46), align: "center" })
      b.rect(body, "Body", {
        key: "PiBody",
        w: 100,
        h: 150,
        radius: [50, 50, 30, 30],
        fill: c("clay"),
      })
      b.ellipse(body, "Handle", {
        key: "PiHandle",
        w: 46,
        h: 56,
        innerRadius: 0.55,
        fill: c("clay"),
        visible: false,
      })
      b.rect(item, "Foot", {
        key: "PiFoot",
        w: 20,
        h: 6,
        radius: [0, 0, 0, 0],
        fill: c("clay"),
        visible: false,
      })
    },
  )
  /** Overrides that scale a shape's object for a smaller or larger tile. */
  const scaled = (shape: Shape, k: number) => {
    const g = SHAPES[shape]
    const sc = (n: number) => Math.max(1, Math.round(n * k))
    return {
      PiBody: { w: sc(g.body[0]), h: sc(g.body[1]), radius: g.body[2].map(sc) },
      ...(g.neck
        ? { PiNeck: { w: sc(g.neck[0]), h: sc(g.neck[1]), radius: g.neck[2].map(sc) } }
        : {}),
      ...(g.handle
        ? {
            PiHandle: { w: sc(g.handle[0]), h: sc(g.handle[1]) },
            PiRow: {
              layout: { dir: "row", gap: handleGap(sc(g.handle[0])), align: "center" },
            },
          }
        : {}),
      ...(g.foot
        ? { PiFoot: { w: sc(g.foot[0]), h: sc(g.foot[1]), radius: g.foot[2].map(sc) } }
        : {}),
    }
  }

  const swatch = b.component(
    "Color swatch",
    {
      key: "Swatch",
      section: "Product",
      props: {
        tone: p.variants(
          Object.fromEntries(
            (["oat", "clay", "sage", "slate", "rose", "char"] as Tone[]).map((t) => [
              t,
              { "SwDot.fill": c(t) },
            ]),
          ),
        ),
        selected: p.variants({
          no: { "root.stroke": { paint: c("border"), width: 0 } },
          yes: { "root.stroke": { paint: ink, width: 1 } },
        }),
      },
      root: {
        dir: "row",
        w: 28,
        h: 28,
        align: "center",
        justify: "center",
        radius: r("pill"),
        stroke: { paint: c("border"), width: 0 },
      },
    },
    (root) => b.ellipse(root, "Color", { key: "SwDot", w: 18, h: 18, fill: c("oat") }),
  )

  const productCard = b.component(
    "Product card",
    {
      key: "Pcard",
      section: "Product",
      description: "Set the image's tone and shape through PcImg's args.",
      props: {
        name: p.text("PcName", "Product name"),
        meta: p.text("PcMeta", "Material, size"),
        price: p.text("PcPrice", "$0"),
        compare: p.text("PcWas", "$0"),
        onSale: p.bool("PcWas", false),
        swatches: p.bool("PcSw", true),
      },
      root: { dir: "column", w: 300, gap: s(3) },
    },
    (root) => {
      b.use(root, productImage, { key: "PcImg", props: { w: FILL } })
      const text = b.col(root, "Text", { w: FILL, gap: 2 })
      const top = b.row(text, "Name row", {
        w: FILL,
        gap: s(3),
        justify: "between",
        align: "start",
      })
      b.para(top, "Product name", b.ty("title", { size: 14 }), ink, {
        key: "PcName",
        name: "Name",
      })
      const prices = b.row(top, "Prices", { gap: s(2), align: "center" })
      b.text(prices, "$0", b.ty("price", { weight: 400, decoration: ["strike"] }), muted, {
        key: "PcWas",
        visible: false,
        name: "Was",
      })
      b.text(prices, "$0", b.ty("price"), ink, { key: "PcPrice", name: "Price" })
      b.para(text, "Material, size", b.ty("small"), muted, { key: "PcMeta", name: "Meta" })
      const sw = b.row(root, "Swatches", { key: "PcSw", gap: 0, align: "center" })
      for (const [i, t] of (["oat", "clay", "sage"] as Tone[]).entries())
        b.use(sw, swatch, {
          key: `PcSw${i + 1}`,
          props: { w: 18, h: 18 },
          args: { tone: t },
          set: { SwDot: { w: 11, h: 11 } },
        })
    },
  )

  const iconButton = b.component(
    "Icon button",
    {
      key: "IconBtn",
      section: "Actions",
      props: {
        count: p.text("IbCnt", "2"),
        showCount: p.bool("IbCntWrap", false),
      },
      root: { dir: "row", gap: s(1), align: "center", pad: [8, 8] },
    },
    (root) => {
      b.icon(root, "shopping-bag", 20, ink, { key: "IbIcon" })
      const wrap = b.row(root, "Count", { key: "IbCntWrap", visible: false })
      b.text(wrap, "2", b.ty("mono", { size: 11 }), ink, { key: "IbCnt" })
    },
  )

  const stepper = b.component(
    "Quantity stepper",
    {
      key: "Qty",
      section: "Forms",
      props: {
        value: p.text("QtyVal", "1"),
        size: p.variants({
          md: { "root.h": 52, "QtyVal.w": 36 },
          sm: { "root.h": 36, "QtyVal.w": 28 },
        }),
      },
      root: {
        dir: "row",
        h: 52,
        gap: s(1),
        pad: [0, 12],
        align: "center",
        radius: 0,
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.icon(root, "minus", 15, c("ink-2"))
      b.text(root, "1", b.ty("mono", { size: 13, align: "center" }), ink, {
        key: "QtyVal",
        w: 36,
        grow: "fixed-width",
        name: "Value",
      })
      b.icon(root, "plus", 15, c("ink-2"))
    },
  )

  const input = b.component(
    "Input",
    {
      key: "Input",
      section: "Forms",
      props: {
        label: p.text("InLbl", "Label"),
        value: p.text("InVal", "Value"),
        showLabel: p.bool("InLbl", true),
        state: p.variants({
          filled: { "InVal.fill": ink },
          empty: { "InVal.fill": muted },
        }),
      },
      root: { dir: "column", w: 360, gap: s(2) },
    },
    (root) => {
      b.text(root, "Label", b.ty("label", { size: 12, weight: 400 }), muted, { key: "InLbl" })
      const field = b.row(root, "Field", {
        w: FILL,
        h: 46,
        pad: [0, 14],
        align: "center",
        radius: 0,
        stroke: { paint: c("border") },
      })
      b.text(field, "Value", b.ty("body", { size: 14 }), ink, { key: "InVal", name: "Value" })
    },
  )

  const checkbox = b.component(
    "Checkbox",
    {
      key: "Check",
      section: "Forms",
      props: {
        label: p.text("CbLbl", "Option"),
        count: p.text("CbCnt", "0"),
        checked: p.variants({
          no: {
            "CbBox.fill": [],
            "CbBox.stroke": { paint: c("ink-2"), width: 1 },
            "CbTick.visible": false,
          },
          yes: {
            "CbBox.fill": ink,
            "CbBox.stroke": { paint: ink, width: 1 },
            "CbTick.visible": true,
          },
        }),
      },
      root: { dir: "row", w: 240, gap: s(3), align: "center" },
    },
    (root) => {
      const box = b.row(root, "Box", {
        key: "CbBox",
        w: 16,
        h: 16,
        radius: 0,
        align: "center",
        justify: "center",
        stroke: { paint: c("ink-2"), width: 1 },
      })
      b.icon(box, "check", 12, c("bg"), { key: "CbTick", visible: false })
      b.text(root, "Option", b.ty("body", { size: 14 }), c("ink-2"), {
        key: "CbLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "0", b.ty("mono", { size: 11 }), muted, { key: "CbCnt" })
    },
  )

  const radio = b.component(
    "Radio option",
    {
      key: "Radio",
      section: "Forms",
      props: {
        title: p.text("RoTitle", "Option"),
        detail: p.text("RoDesc", "Detail"),
        price: p.text("RoPrice", "Free"),
        selected: p.variants({
          no: {
            "root.stroke": { paint: c("border"), width: 1 },
            "RoRing.stroke": { paint: c("ink-2"), width: 1 },
            "RoDot.visible": false,
          },
          yes: {
            "root.stroke": { paint: ink, width: 1 },
            "RoRing.stroke": { paint: ink, width: 1 },
            "RoDot.visible": true,
          },
        }),
      },
      root: {
        dir: "row",
        w: 560,
        gap: s(4),
        align: "center",
        pad: [18, 20],
        radius: 0,
        stroke: { paint: c("border"), width: 1 },
      },
    },
    (root) => {
      const ring = b.row(root, "Radio", {
        key: "RoRing",
        w: 16,
        h: 16,
        radius: r("pill"),
        align: "center",
        justify: "center",
        stroke: { paint: c("ink-2"), width: 1 },
      })
      b.ellipse(ring, "Dot", { key: "RoDot", w: 8, h: 8, fill: ink, visible: false })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Option", b.ty("label", { size: 14 }), ink, { key: "RoTitle" })
      b.text(t, "Detail", b.ty("small"), muted, { key: "RoDesc" })
      b.text(root, "Free", b.ty("price"), ink, { key: "RoPrice" })
    },
  )

  // --- Components: navigation ----------------------------------------------------------------

  /** The wordmark: tracked capitals, no logo glyph. */
  function brand(parent: string, size = 15, onInverse = false) {
    return b.text(
      parent,
      "FERNHILL",
      b.ty("title", { size, weight: 500, letterSpacing: size * 0.3 }),
      onInverse ? c("on-inverse") : ink,
      { name: "Wordmark" },
    )
  }

  const announcement = b.component(
    "Announcement bar",
    {
      key: "Announce",
      section: "Navigation",
      props: { message: p.text("AnText", "Message") },
      root: {
        dir: "row",
        w: 1440,
        justify: "center",
        align: "center",
        pad: [9, 16],
        fill: c("inverse"),
      },
    },
    (root) => {
      b.text(root, "Message", b.ty("small", { size: 12, letterSpacing: 0.3 }), c("on-inverse"), {
        key: "AnText",
      })
    },
  )

  const navLinks = ["Shop all", "Kitchen", "Living", "Bedroom", "Bath", "Journal"] as const
  const navActive = (i: number) =>
    Object.fromEntries(
      navLinks.flatMap((_, j) => [
        [`HdL${j + 1}.fill`, j === i ? ink : c("ink-2")],
        [`HdL${j + 1}.style/weight`, j === i ? 600 : 400],
      ]),
    )
  const header = b.component(
    "Site header",
    {
      key: "Header",
      section: "Navigation",
      description: "Links left, wordmark centered, utilities right. Equal outer columns.",
      props: {
        active: p.variants({
          none: navActive(-1),
          all: navActive(0),
          kitchen: navActive(1),
          living: navActive(2),
        }),
        bagCount: p.text("HdBag", "Bag (4)"),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [22, 64],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const links = b.row(root, "Links", { w: 480, gap: s(6), align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(links, l, b.ty("label", { weight: 400 }), c("ink-2"), { key: `HdL${i + 1}` })
      brand(root)
      const right = b.row(root, "Utilities", { w: 480, gap: s(6), justify: "end", align: "center" })
      b.text(right, "Search", b.ty("label", { weight: 400 }), c("ink-2"))
      b.text(right, "Account", b.ty("label", { weight: 400 }), c("ink-2"))
      b.text(right, "Bag (4)", b.ty("label"), ink, { key: "HdBag" })
    },
  )

  const mobileHeader = b.component(
    "Mobile header",
    {
      key: "MHeader",
      section: "Navigation",
      props: { bagCount: p.text("MhBag", "Bag (4)") },
      root: {
        dir: "row",
        w: 390,
        h: 56,
        justify: "between",
        align: "center",
        pad: [0, 8, 0, 8],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const left = b.row(root, "Left", { w: 96, gap: 0, align: "center" })
      b.use(left, iconButton, { set: { IbIcon: { icon: "menu" } } })
      b.use(left, iconButton, { set: { IbIcon: { icon: "search" } } })
      brand(root, 13)
      const right = b.row(root, "Right", {
        w: 96,
        justify: "end",
        align: "center",
        pad: [0, 8, 0, 0],
      })
      b.text(right, "Bag (4)", b.ty("label"), ink, { key: "MhBag" })
    },
  )

  const breadcrumb = b.component(
    "Breadcrumb",
    {
      key: "Crumb",
      section: "Navigation",
      props: {
        first: p.text("CrA", "Home"),
        second: p.text("CrB", "Section"),
        current: p.text("CrC", "Page"),
      },
      root: { dir: "row", gap: s(2), align: "center" },
    },
    (root) => {
      b.text(root, "Home", b.ty("mono", { size: 11 }), muted, { key: "CrA" })
      b.text(root, "/", b.ty("mono", { size: 11 }), muted)
      b.text(root, "Section", b.ty("mono", { size: 11 }), muted, { key: "CrB" })
      b.text(root, "/", b.ty("mono", { size: 11 }), muted)
      b.text(root, "Page", b.ty("mono", { size: 11 }), ink, { key: "CrC" })
    },
  )

  const steps = b.component(
    "Checkout steps",
    {
      key: "Steps",
      section: "Navigation",
      props: {
        active: p.variants({
          checkout: {
            "StN1.fill": muted,
            "StL1.fill": muted,
            "StN2.fill": ink,
            "StL2.fill": ink,
            "StN3.fill": muted,
            "StL3.fill": muted,
          },
          done: {
            "StN1.fill": muted,
            "StL1.fill": muted,
            "StN2.fill": muted,
            "StL2.fill": muted,
            "StN3.fill": ink,
            "StL3.fill": ink,
          },
        }),
      },
      root: { dir: "row", gap: s(4), align: "center" },
    },
    (root) => {
      const step = (i: number, label: string) => {
        const st = b.row(root, label, { gap: s(2), align: "baseline" })
        b.text(st, `0${i}`, b.ty("mono", { size: 11 }), i === 2 ? ink : muted, { key: `StN${i}` })
        b.text(st, label, b.ty("label"), i === 2 ? ink : muted, { key: `StL${i}` })
      }
      step(1, "Bag")
      b.rect(root, "Line", { w: 28, h: 1, fill: c("border") })
      step(2, "Details and payment")
      b.rect(root, "Line", { w: 28, h: 1, fill: c("border") })
      step(3, "Confirmation")
    },
  )

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      description: "Four link columns and an oversized wordmark.",
      root: {
        dir: "column",
        w: 1440,
        gap: s(12),
        pad: [64, 64, 32, 64],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { t: 1 } },
      },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, gap: s(6) })
      const about = b.col(top, "About", { w: 400, gap: s(4) })
      b.para(
        about,
        "Ceramics, linen and pantry goods from 38 small makers. The shop is at 412 Haywood Road, Asheville, open Tuesday to Sunday.",
        b.ty("body", { size: 14 }),
        c("ink-2"),
        { w: 320 },
      )
      for (const [title, items] of [
        [
          "Shop",
          ["New arrivals", "Kitchen and dining", "Living", "Bedroom and bath", "Gift cards"],
        ],
        ["Help", ["Shipping", "Returns and exchanges", "Care guides", "Contact us"]],
        ["Fernhill", ["Our makers", "Journal", "Visit the shop", "Wholesale"]],
      ] as const) {
        const col = b.col(top, title, { w: 280, gap: s(3) })
        b.text(col, title.toUpperCase(), b.ty("eyebrow"), muted)
        for (const it of items) b.text(col, it, b.ty("body", { size: 14 }), ink)
      }
      b.text(
        root,
        "Fernhill",
        b.ty("display", { size: 220, letterSpacing: -9, lineHeight: 0.9 }),
        ink,
        { name: "Oversized wordmark" },
      )
      const bottom = b.row(root, "Bottom", {
        w: FILL,
        justify: "between",
        align: "center",
        pad: [16, 0, 0, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.text(bottom, "2026 Fernhill Home, Asheville, NC", b.ty("mono", { size: 11 }), muted)
      b.text(bottom, "Privacy / Terms / Accessibility", b.ty("mono", { size: 11 }), muted)
    },
  )

  // --- Components: content -------------------------------------------------------------------

  const indexRow = b.component(
    "Index row",
    {
      key: "IdxRow",
      section: "Content",
      description: "Large light title with a mono count; used as a category index.",
      props: { name: p.text("IxName", "Category"), count: p.text("IxCnt", "00") },
      root: {
        dir: "row",
        w: 760,
        justify: "between",
        align: "center",
        pad: [26, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "Category", b.ty("h1", { size: 40 }), ink, { key: "IxName" })
      const right = b.row(root, "Right", { gap: s(4), align: "center" })
      b.text(right, "00", b.ty("mono"), muted, { key: "IxCnt" })
      b.icon(right, "arrow-up-right", 20, ink)
    },
  )

  const note = b.component(
    "Service note",
    {
      key: "Benefit",
      section: "Content",
      props: {
        no: p.text("BnNo", "01"),
        title: p.text("BnTitle", "Note"),
        body: p.text("BnBody", "Detail."),
      },
      root: {
        dir: "column",
        w: 304,
        gap: s(3),
        pad: [16, 0, 0, 0],
        stroke: { paint: ink, width: { t: 1 } },
      },
    },
    (root) => {
      b.text(root, "01", b.ty("eyebrow"), muted, { key: "BnNo" })
      const t = b.col(root, "Text", { w: FILL, gap: s(1) })
      b.text(t, "Note", b.ty("title"), ink, { key: "BnTitle" })
      b.para(t, "Detail.", b.ty("small"), c("ink-2"), { key: "BnBody" })
    },
  )

  const review = b.component(
    "Review card",
    {
      key: "Review",
      section: "Content",
      props: {
        title: p.text("RvTitle", "Title"),
        body: p.text("RvBody", "Review."),
        name: p.text("RvName", "Name"),
        meta: p.text("RvMeta", "Verified buyer"),
      },
      root: {
        dir: "column",
        w: 400,
        gap: s(3),
        pad: [18, 0, 0, 0],
        stroke: { paint: ink, width: { t: 1 } },
      },
    },
    (root) => {
      b.use(root, rating, { args: { value: "5.0", showCount: false } })
      b.text(root, "Title", b.ty("title", { size: 17 }), ink, { key: "RvTitle" })
      b.para(root, "Review.", b.ty("body", { size: 14 }), c("ink-2"), { key: "RvBody" })
      const who = b.row(root, "Reviewer", { gap: s(2), align: "center" })
      b.text(who, "Name", b.ty("mono", { size: 11 }), ink, { key: "RvName" })
      b.text(who, "Verified buyer", b.ty("mono", { size: 11 }), muted, { key: "RvMeta" })
    },
  )

  const accordion = b.component(
    "Accordion item",
    {
      key: "Acc",
      section: "Content",
      props: {
        title: p.text("AcTitle", "Section"),
        body: p.text("AcBody", "Details."),
        open: p.bool("AcBody", false),
      },
      root: {
        dir: "column",
        w: 520,
        gap: s(3),
        pad: [18, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, justify: "between", align: "center" })
      b.text(head, "Section", b.ty("label", { size: 14 }), ink, { key: "AcTitle" })
      b.icon(head, "plus", 16, c("ink-2"), { key: "AcIcon" })
      b.para(root, "Details.", b.ty("body", { size: 14 }), c("ink-2"), {
        key: "AcBody",
        visible: false,
      })
    },
  )

  const specRow = b.component(
    "Spec row",
    {
      key: "Spec",
      section: "Content",
      props: { label: p.text("SpLbl", "Label"), value: p.text("SpVal", "Value") },
      root: {
        dir: "row",
        w: 448,
        justify: "between",
        align: "center",
        pad: [10, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.text(root, "Label", b.ty("small"), muted, { key: "SpLbl" })
      b.text(root, "Value", b.ty("mono", { size: 12 }), ink, { key: "SpVal" })
    },
  )

  // --- Components: cart and checkout ---------------------------------------------------------

  const cartLine = b.component(
    "Cart line",
    {
      key: "CartLine",
      section: "Cart",
      description: "Desktop bag row. Scale the image's object for the 120×150 tile.",
      props: {
        name: p.text("ClName", "Product"),
        variant: p.text("ClVar", "Color"),
        each: p.text("ClEach", "$0 each"),
        total: p.text("ClTotal", "$0"),
        quantity: p.text("ClQty/QtyVal", "1"),
      },
      root: {
        dir: "row",
        w: 840,
        gap: s(6),
        align: "start",
        pad: [24, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.use(root, productImage, {
        key: "ClImg",
        props: { w: 120, h: 150 },
        args: { size: "thumb" },
        set: scaled("vase", 0.55),
      })
      const info = b.col(root, "Info", { w: FILL, gap: s(1) })
      b.text(info, "Product", b.ty("title"), ink, { key: "ClName" })
      b.text(info, "Color", b.ty("small"), muted, { key: "ClVar" })
      b.text(info, "$0 each", b.ty("mono", { size: 11 }), muted, { key: "ClEach" })
      b.text(info, "In stock, ships in 1 to 2 days", b.ty("small"), c("success"))
      b.use(root, stepper, { key: "ClQty", args: { size: "sm" } })
      const right = b.col(root, "Total", { w: 110, gap: s(2), align: "end" })
      b.text(right, "$0", b.ty("price", { align: "right" }), ink, { key: "ClTotal" })
      link(right, "Remove")
    },
  )

  const cartLineMobile = b.component(
    "Cart line/Mobile",
    {
      key: "CartLineM",
      section: "Cart",
      props: {
        name: p.text("CmName", "Product"),
        variant: p.text("CmVar", "Color"),
        total: p.text("CmTotal", "$0"),
        quantity: p.text("CmQty/QtyVal", "1"),
      },
      root: {
        dir: "row",
        w: 358,
        gap: s(3),
        align: "start",
        pad: [16, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.use(root, productImage, {
        key: "CmImg",
        props: { w: 88, h: 110 },
        args: { size: "thumb" },
        set: scaled("vase", 0.42),
      })
      const info = b.col(root, "Info", { w: FILL, gap: s(1) })
      const top = b.row(info, "Name row", { w: FILL, gap: s(2), align: "start" })
      b.para(top, "Product", b.ty("title", { size: 14 }), ink, { key: "CmName" })
      b.icon(top, "x", 15, muted)
      b.text(info, "Color", b.ty("small"), muted, { key: "CmVar" })
      const bottom = b.row(info, "Bottom", {
        w: FILL,
        justify: "between",
        align: "center",
        pad: [14, 0, 0, 0],
      })
      b.use(bottom, stepper, { key: "CmQty", args: { size: "sm" } })
      b.text(bottom, "$0", b.ty("price"), ink, { key: "CmTotal" })
    },
  )

  const summaryRow = b.component(
    "Summary row",
    {
      key: "SumRow",
      section: "Cart",
      props: {
        label: p.text("SrLbl", "Label"),
        value: p.text("SrVal", "$0.00"),
        kind: p.variants({
          line: {
            "SrLbl.fill": c("ink-2"),
            "SrLbl.style/size": 14,
            "SrLbl.style/weight": 400,
            "SrVal.fill": ink,
            "SrVal.style/size": 13,
          },
          total: {
            "SrLbl.fill": ink,
            "SrLbl.style/size": 16,
            "SrLbl.style/weight": 500,
            "SrVal.fill": ink,
            "SrVal.style/size": 17,
          },
          discount: {
            "SrLbl.fill": c("success"),
            "SrLbl.style/size": 14,
            "SrLbl.style/weight": 400,
            "SrVal.fill": c("success"),
            "SrVal.style/size": 13,
          },
        }),
      },
      root: { dir: "row", w: 360, justify: "between", align: "center" },
    },
    (root) => {
      b.text(root, "Label", b.ty("body", { size: 14 }), c("ink-2"), { key: "SrLbl" })
      b.text(root, "$0.00", b.ty("mono", { size: 13 }), ink, { key: "SrVal" })
    },
  )

  const summaryItem = b.component(
    "Summary item",
    {
      key: "SumItem",
      section: "Cart",
      props: {
        name: p.text("SiName", "Product"),
        detail: p.text("SiDet", "Color · Qty 1"),
        price: p.text("SiPrice", "$0"),
      },
      root: { dir: "row", w: 360, gap: s(3), align: "center" },
    },
    (root) => {
      b.use(root, productImage, {
        key: "SiImg",
        props: { w: 60, h: 72 },
        args: { size: "thumb", tone: "oat", shape: "mug" },
        set: scaled("mug", 0.28),
      })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Product", b.ty("label", { size: 14 }), ink, { key: "SiName" })
      b.text(t, "Color · Qty 1", b.ty("small"), muted, { key: "SiDet" })
      b.text(root, "$0", b.ty("mono", { size: 13 }), ink, { key: "SiPrice" })
    },
  )

  const orderSummary = b.component(
    "Order summary",
    {
      key: "OrdSum",
      section: "Cart",
      description: "Items slot for Summary items; Actions slot for promo code and buttons.",
      props: {
        title: p.text("OsTitle", "ORDER SUMMARY"),
        items: p.slot("OsItems"),
        subtotal: p.text("OsSub/SrVal", "$0.00"),
        shipping: p.text("OsShip/SrVal", "Free"),
        tax: p.text("OsTax/SrVal", "$0.00"),
        total: p.text("OsTotal/SrVal", "$0.00"),
        actions: p.slot("OsActs"),
      },
      root: { dir: "column", w: 420, gap: s(5), pad: 28, radius: 0, fill: c("subtle") },
    },
    (root) => {
      b.text(root, "ORDER SUMMARY", b.ty("eyebrow"), muted, { key: "OsTitle" })
      b.col(root, "Items", {
        key: "OsItems",
        w: FILL,
        gap: s(4),
        slot: { suggested: [summaryItem] },
      })
      const rows = b.col(root, "Rows", {
        w: FILL,
        gap: s(2),
        pad: [16, 0, 0, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.use(rows, summaryRow, { key: "OsSub", props: { w: FILL }, args: { label: "Subtotal" } })
      b.use(rows, summaryRow, {
        key: "OsShip",
        props: { w: FILL },
        args: { label: "Shipping", value: "Free" },
      })
      b.use(rows, summaryRow, {
        key: "OsTax",
        props: { w: FILL },
        args: { label: "Estimated tax" },
      })
      const tot = b.col(root, "Total", {
        w: FILL,
        pad: [16, 0, 0, 0],
        stroke: { paint: ink, width: { t: 1 } },
      })
      b.use(tot, summaryRow, {
        key: "OsTotal",
        props: { w: FILL },
        args: { label: "Total", kind: "total" },
      })
      b.col(root, "Actions", { key: "OsActs", w: FILL, gap: s(3), slot: { suggested: [button] } })
    },
  )

  // --- Data ------------------------------------------------------------------------------------

  type Product = [name: string, meta: string, price: string, tone: Tone, shape: Shape]
  const P = {
    mug: ["Ridge stoneware mug", "12 oz, oat glaze", "$28", "oat", "mug"],
    throw: ["Halden linen throw", "Stonewashed linen, 50 × 70 in", "$148", "sage", "throw"],
    candle: ["Tallow beeswax pillar", "3 × 6 in, 60 hour burn", "$22", "rose", "candle"],
    vase: ["Coast bud vase", "Hand-thrown, 7 in", "$64", "slate", "vase"],
    bowl: ["Field serving bowl", "Stoneware, 10 in", "$46", "char", "bowl"],
    board: ["Ash serving board", "Oiled ash, 20 in", "$58", "oat", "board"],
    carafe: ["Brook glass carafe", "Mouth-blown, 1 L", "$38", "slate", "carafe"],
    pillow: ["Marlow wool pillow cover", "Undyed wool, 20 × 20 in", "$58", "clay", "pillow"],
    napkins: ["Juniper linen napkins", "Set of 4, 20 × 20 in", "$36", "sage", "towel"],
    plate: ["Ridge dinner plate", "Stoneware, 10.5 in", "$32", "clay", "plate"],
    // Kitchen and dining results for Stoneware, $25 to $50, Oat.
    latte: ["Ridge latte mug", "16 oz, oat glaze", "$32", "oat", "mug"],
    cereal: ["Field cereal bowl", "Stoneware, 6 in", "$32", "oat", "bowl"],
    plateOat: ["Ridge dinner plate", "Stoneware, 10.5 in", "$32", "oat", "plate"],
    espresso: ["Ridge espresso cups", "4 oz, set of 2", "$34", "oat", "mug"],
    pasta: ["Field pasta bowl", "Stoneware, 8.5 in", "$38", "oat", "bowl"],
    pitcher: ["Ridge cream pitcher", "Stoneware, 16 oz", "$44", "oat", "carafe"],
    salad: ["Ridge salad plate", "Stoneware, 8.5 in", "$26", "oat", "plate"],
    serveOat: ["Field serving bowl", "Stoneware, 10 in", "$46", "oat", "bowl"],
    towel: ["Wren waffle bath towel", "Organic cotton, 30 × 56 in", "$34", "char", "towel"],
  } satisfies Record<string, Product>
  type PKey = keyof typeof P

  function productCardUse(
    parent: string,
    key: PKey,
    opts: {
      badge?: "new" | "sale" | "few"
      was?: string
      swatches?: Tone[]
      imgH?: number
      w?: unknown
      k?: number
      meta?: string
    } = {},
  ) {
    const [name, defaultMeta, price, tone, shape] = P[key]
    const meta = opts.meta ?? defaultMeta
    const sw = opts.swatches
    const badgeArgs =
      opts.badge === "new"
        ? { badge: true, badgeLabel: "NEW" }
        : opts.badge === "sale"
          ? { badge: true, badgeStyle: badgeSale, badgeLabel: "SALE" }
          : opts.badge === "few"
            ? { badge: true, badgeStyle: badge, badgeLabel: "ONLY 4 LEFT" }
            : { badge: false }
    return b.use(parent, productCard, {
      props: { w: opts.w ?? FILL },
      args: {
        name,
        meta,
        price,
        ...(opts.was ? { compare: opts.was, onSale: true } : {}),
        swatches: !!sw,
      },
      set: {
        PcImg: {
          args: { tone, shape, ...badgeArgs, favorite: false },
          ...(opts.imgH ? { props: { w: FILL, h: opts.imgH } } : {}),
        },
        ...(opts.was ? { PcPrice: { fill: c("sale") } } : {}),
        ...(opts.k ? prefixed("PcImg", scaled(shape, opts.k)) : {}),
        ...(sw
          ? Object.fromEntries(sw.map((t, i) => [`PcSw${i + 1}`, { args: { tone: t } }]))
          : {}),
      },
    })
  }
  function imageUse(
    parent: string,
    tone: Tone,
    shape: Shape,
    props: Record<string, unknown>,
    opts: { k?: number; thumb?: boolean; badge?: string; fav?: boolean; key?: string } = {},
  ) {
    return b.use(parent, productImage, {
      ...(opts.key ? { key: opts.key } : {}),
      props,
      args: {
        tone,
        shape,
        ...(opts.thumb ? { size: "thumb" } : {}),
        ...(opts.badge ? { badgeLabel: opts.badge } : { badge: false }),
        favorite: !!opts.fav,
      },
      ...(opts.k && opts.k !== 1 ? { set: scaled(shape, opts.k) } : {}),
    })
  }

  // --- Shared sections -------------------------------------------------------------------------

  const desktop = b.page("Desktop")
  const mobile = b.page("Mobile")
  const SHIP = "Free shipping on orders over $100. Returns within 30 days."

  function page(name: string, active: "none" | "all" | "kitchen" | "living", emptyBag = false) {
    const scr = b.screen(desktop, name, { w: 1440, fill: c("bg") })
    b.use(scr, announcement, { args: { message: SHIP } })
    b.use(scr, header, {
      args: { active, ...(emptyBag ? { bagCount: "Bag (0)" } : {}) },
    })
    return scr
  }
  /** Section head: light title, optional mono count, underlined link right. */
  function sectionHead(parent: string, title: string, linkText?: string, count?: string) {
    const row = b.row(parent, "Section header", {
      w: FILL,
      justify: "between",
      align: "end",
      pad: [0, 0, 16, 0],
      stroke: { paint: ink, width: { b: 1 } },
    })
    const t = b.row(row, "Titles", { gap: s(3), align: "baseline" })
    b.text(t, title, b.ty("heading"), ink, { name: "Title" })
    if (count) b.text(t, count, b.ty("mono"), muted, { name: "Count" })
    if (linkText) link(row, linkText)
    return row
  }
  function section(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, gap: s(8), pad: [64, 64], ...props })
  }
  const notes: [string, string, string][] = [
    ["01", "Free shipping over $100", "Orders ship from Asheville in 1 to 2 business days."],
    ["02", "30-day returns", "Unused pieces come back free with the label in your box."],
    ["03", "Packed without plastic", "Paper wrap, cardboard and recycled pulp only."],
    ["04", "Gift wrapping for $6", "Linen wrap and a handwritten card, added at checkout."],
  ]

  const thumbK: Record<string, number> = { mug: 0.5, throw: 0.36, candle: 0.5 }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "eCommerce template",
    title: "Fernhill home goods store",
    description:
      "Home, category, product, cart, checkout and confirmation for desktop, plus home, product and cart on mobile. Built from 30 components with light and dark tokens.",
    preview: (area) => {
      const row = b.row(area, "Products", { w: FILL, gap: s(4), align: "start" })
      productCardUse(row, "mug", {
        badge: "new",
        swatches: ["oat", "clay", "sage"],
        imgH: 250,
        w: 212,
        k: 0.75,
      })
      productCardUse(row, "vase", { imgH: 250, w: 212, k: 0.75 })
      productCardUse(row, "board", { badge: "sale", was: "$72", imgH: 250, w: 212, k: 0.75 })
      const bottom = b.row(area, "Bag", { w: FILL, gap: s(6), align: "start" })
      const bag = b.col(bottom, "Bag", { w: FILL, gap: 0 })
      for (const [k, v, q, t] of [
        ["mug", "Oat", "2", "$56"],
        ["throw", "Sage", "1", "$148"],
      ] as const) {
        const [name, , price, tone, shape] = P[k]
        b.use(bag, cartLineMobile, {
          props: { w: FILL },
          args: { name, variant: `${v} · ${price} each`, total: t, quantity: q },
          set: {
            CmImg: { args: { size: "thumb", tone, shape } },
            ...prefixed("CmImg", scaled(shape, (thumbK[k] ?? 0.5) * 0.75)),
          },
        })
      }
      const n = notes[0] as [string, string, string]
      b.use(bottom, note, {
        props: { w: 200 },
        args: { no: n[0], title: n[1], body: n[2] },
      })
    },
  })

  /** Re-keys `scaled()` overrides under a nested instance key. */
  function prefixed(prefix: string, o: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [`${prefix}/${k}`, v]))
  }

  // --- Desktop: Home -----------------------------------------------------------------------------
  {
    const scr = page("Home", "none")
    // Opening statement: headline across eight columns, the paragraph and action on the right.
    const intro = b.row(scr, "Intro", {
      w: FILL,
      gap: s(16),
      pad: [72, 64, 48, 64],
      justify: "between",
      align: "end",
    })
    const hl = b.col(intro, "Headline", { w: 900, gap: s(5) })
    b.text(hl, "AUTUMN 2026  /  14 NEW PIECES", b.ty("eyebrow"), c("accent"))
    b.para(hl, "Made in small batches, used every day.", b.ty("display"), ink)
    const aside = b.col(intro, "Aside", { w: 320, gap: s(5) })
    b.para(
      aside,
      "Stoneware, linen and beeswax from 38 makers in the Blue Ridge and beyond. Each batch is small, so when a glaze sells out it may not come back.",
      b.ty("body", { size: 14 }),
      c("ink-2"),
    )
    const acts = b.row(aside, "Actions", { gap: s(5), align: "center" })
    b.use(acts, button, { args: { label: "Shop new arrivals", size: "lg" } })
    link(acts, "Meet the makers")

    // Image band on a 7 / 5 split with captions underneath.
    const band = b.row(scr, "Band", { w: FILL, gap: s(6), pad: [0, 64, 0, 64], align: "start" })
    const big = b.col(band, "Plate 01", { w: 760, gap: s(3) })
    imageUse(big, "clay", "vase", { w: FILL, h: 640 }, { k: 2.2, badge: "NEW" })
    const bc = b.row(big, "Caption", { w: FILL, justify: "between" })
    b.text(bc, "PLATE 01", b.ty("eyebrow"), ink)
    b.text(bc, "Coast bud vase, hand-thrown in Marshall, NC", b.ty("small"), muted)
    const stack = b.col(band, "Plates 02 and 03", { w: 528, gap: s(6) })
    const p2 = b.col(stack, "Plate 02", { w: FILL, gap: s(3) })
    imageUse(p2, "sage", "mug", { w: FILL, h: 290 }, { k: 1.2 })
    const c2 = b.row(p2, "Caption", { w: FILL, justify: "between" })
    b.text(c2, "PLATE 02", b.ty("eyebrow"), ink)
    b.text(c2, "Ridge mug, sage glaze", b.ty("small"), muted)
    const p3 = b.col(stack, "Plate 03", { w: FILL, gap: s(3) })
    imageUse(p3, "oat", "candle", { w: FILL, h: 290 }, { k: 1.0 })
    const c3 = b.row(p3, "Caption", { w: FILL, justify: "between" })
    b.text(c3, "PLATE 03", b.ty("eyebrow"), ink)
    b.text(c3, "Tallow beeswax pillar", b.ty("small"), muted)

    const fresh = section(scr, "New this week", { pad: [96, 64, 64, 64] })
    sectionHead(fresh, "New this week", "Shop all new", "(14)")
    const grid = b.row(fresh, "Products", { w: FILL, gap: s(6), align: "start" })
    productCardUse(grid, "mug", { badge: "new", swatches: ["oat", "clay", "sage"], w: 310 })
    productCardUse(grid, "throw", { badge: "new", swatches: ["sage", "oat", "char"], w: 310 })
    productCardUse(grid, "vase", { badge: "few", w: 310 })
    productCardUse(grid, "board", { badge: "sale", was: "$72", w: 310 })

    const rooms = section(scr, "Shop by room", { pad: [64, 64, 96, 64] })
    sectionHead(rooms, "Shop by room", "All categories")
    const rr = b.row(rooms, "Rooms", { w: FILL, gap: s(16), align: "start" })
    const list = b.col(rr, "Index", { w: 760, gap: 0 })
    for (const [name, count] of [
      ["Kitchen and dining", "142"],
      ["Living", "086"],
      ["Bedroom", "054"],
      ["Bath", "038"],
    ] as const)
      b.use(list, indexRow, { args: { name, count } })
    imageUse(rr, "clay", "bowl", { w: 488, h: 428 }, { k: 1.8 })

    const story = b.row(scr, "Makers", {
      w: FILL,
      gap: s(16),
      pad: [80, 64],
      align: "center",
      fill: c("subtle"),
    })
    imageUse(story, "char", "bowl", { w: 620, h: 520 }, { k: 1.9 })
    const st = b.col(story, "Text", { w: FILL, gap: s(5) })
    b.text(st, "OUR MAKERS", b.ty("eyebrow"), c("accent"))
    b.para(st, "Every piece comes from a studio we have visited.", b.ty("h1"), ink)
    b.para(
      st,
      "Lena Ortiz throws the Ridge mugs two hours up the road in Burnsville. The Halden throws are woven in a family mill in Lithuania and washed here before they ship. We pay makers within 14 days of each order.",
      b.ty("body-lg"),
      c("ink-2"),
    )
    const nums = b.row(st, "Numbers", { w: FILL, gap: s(8), pad: [16, 0] })
    // 620 wide text column: three equal 185 px stats with 32 px gaps.
    for (const [v, l] of [
      ["38", "Makers we buy from"],
      ["11", "Within 100 miles"],
      ["2014", "Shop opened"],
    ] as const) {
      const n = b.col(nums, l, { w: 185, gap: 4 })
      b.text(n, v, b.ty("heading", { size: 44, letterSpacing: -1.6 }), ink)
      b.text(n, l, b.ty("small"), muted)
    }
    link(st, "Read their stories")

    const perks = b.row(scr, "Service notes", { w: FILL, gap: s(8), pad: [72, 64] })
    for (const [no, title, body] of notes)
      b.use(perks, note, { props: { w: 304 }, args: { no, title, body } })

    const voices = section(scr, "Reviews", { pad: [24, 64, 80, 64] })
    sectionHead(voices, "What customers write back", undefined, "4.9 from 3,180 reviews")
    const rv = b.row(voices, "Cards", { w: FILL, gap: 26, align: "stretch" })
    for (const [title, body, name, meta] of [
      [
        "Heavier than it looks, in a good way",
        "The Ridge mug holds heat through a whole slow morning. The oat glaze has small speckles that make each one a little different.",
        "PRIYA S.",
        "RIDGE STONEWARE MUG",
      ],
      [
        "Softer after every wash",
        "I was worried the linen throw would be scratchy. After two washes it drapes over the couch like it has always been there.",
        "MARCUS D.",
        "HALDEN LINEN THROW",
      ],
      [
        "Packed with real care",
        "Four plates arrived in paper and pulp with a handwritten note. Not one chip, and no plastic to throw away.",
        "HANNAH K.",
        "RIDGE DINNER PLATE",
      ],
    ] as const)
      b.use(rv, review, { props: { w: 420 }, args: { title, body, name, meta } })

    const news = b.row(scr, "Newsletter", {
      w: FILL,
      gap: s(16),
      pad: [56, 64],
      align: "center",
      justify: "between",
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    const nt = b.col(news, "Text", { w: 640, gap: s(2) })
    b.para(nt, "A letter when new glazes land.", b.ty("heading"), ink)
    b.para(
      nt,
      "One email a month. Subscribers see each drop a day before it goes live.",
      b.ty("body", { size: 14 }),
      muted,
    )
    const form = b.row(news, "Form", { w: 560, gap: s(3), align: "end" })
    b.use(form, input, {
      props: { w: FILL },
      args: { label: "Email", showLabel: false, value: "you@example.com", state: "empty" },
    })
    b.use(form, button, { props: { h: 46 }, args: { label: "Subscribe" } })
    b.use(scr, footer)
  }

  // --- Desktop: Category -----------------------------------------------------------------------
  {
    const scr = page("Category", "kitchen")
    const head = b.col(scr, "Header", { w: FILL, gap: s(6), pad: [28, 64, 8, 64] })
    b.use(head, breadcrumb, {
      args: { first: "Home", second: "Shop all", current: "Kitchen and dining" },
    })
    const tr = b.row(head, "Title row", {
      w: FILL,
      justify: "between",
      align: "end",
      pad: [0, 0, 24, 0],
      stroke: { paint: ink, width: { b: 1 } },
    })
    const tt = b.row(tr, "Titles", { gap: s(4), align: "baseline" })
    b.text(tt, "Kitchen and dining", b.ty("display", { size: 64, letterSpacing: -2.4 }), ink)
    b.text(tt, "142 pieces", b.ty("mono"), muted)
    const sort = b.row(tr, "Sort", { gap: s(2), align: "center", pad: [0, 0, 8, 0] })
    b.text(sort, "Sort", b.ty("mono", { size: 11 }), muted)
    b.text(sort, "Newest", b.ty("label"), ink)
    b.icon(sort, "chevron-down", 15, ink)

    const body = b.row(scr, "Body", { w: FILL, gap: s(16), pad: [32, 64, 96, 64], align: "start" })
    const filters = b.col(body, "Filters", { w: 240, gap: 0 })
    const group = (title: string, fn: (into: string) => void) => {
      const g = b.col(filters, title, {
        w: FILL,
        gap: s(3),
        pad: [16, 0, 20, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      const h = b.row(g, "Group header", { w: FILL, justify: "between", align: "center" })
      b.text(h, title.toUpperCase(), b.ty("eyebrow"), ink)
      b.icon(h, "minus", 14, muted)
      fn(g)
    }
    const boxes = (into: string, items: [string, string, boolean][]) => {
      for (const [label, count, on] of items)
        b.use(into, checkbox, {
          props: { w: FILL },
          args: { label, count, checked: on ? "yes" : "no" },
        })
    }
    group("Category", (g) =>
      boxes(g, [
        ["Mugs and cups", "34", false],
        ["Bowls", "26", false],
        ["Plates", "22", false],
        ["Serving", "24", false],
        ["Table linen", "21", false],
        ["Glassware", "15", false],
      ]),
    )
    group("Material", (g) =>
      boxes(g, [
        ["Stoneware", "58", true],
        ["Porcelain", "14", false],
        ["Glass", "15", false],
        ["Wood", "19", false],
        ["Linen", "21", false],
        ["Cast iron", "15", false],
      ]),
    )
    group("Color", (g) => {
      const row = b.row(g, "Swatches", { w: FILL, gap: s(1), wrap: true, crossGap: 4 })
      for (const [i, t] of (["oat", "clay", "sage", "slate", "rose", "char"] as Tone[]).entries())
        b.use(row, swatch, { args: { tone: t, selected: i === 0 ? "yes" : "no" } })
    })
    group("Price", (g) =>
      boxes(g, [
        ["Under $25", "31", false],
        ["$25 to $50", "64", true],
        ["$50 to $100", "35", false],
        ["Over $100", "12", false],
      ]),
    )

    const main = b.col(body, "Results", { w: FILL, gap: s(8) })
    const chips = b.row(main, "Active filters", { w: FILL, gap: s(4), align: "center" })
    b.text(chips, "42 RESULTS", b.ty("eyebrow"), ink)
    for (const label of ["Stoneware", "$25 to $50", "Oat"]) {
      const chip = b.row(chips, label, { gap: s(1), align: "center" })
      b.text(chip, label, b.ty("small"), c("ink-2"))
      b.icon(chip, "x", 13, muted)
    }
    link(chips, "Clear all")
    // Every result is stoneware, $25 to $50 and comes in Oat, so the grid matches the chips.
    const rows: [PKey, Parameters<typeof productCardUse>[2]][][] = [
      [
        ["mug", { badge: "new", swatches: ["oat", "clay", "sage"] }],
        ["cereal", { k: 0.7 }],
        ["plateOat", { swatches: ["oat", "clay", "char"] }],
      ],
      [
        ["espresso", { badge: "new", k: 0.7, swatches: ["oat", "sage", "char"] }],
        ["pasta", { badge: "sale", was: "$48", k: 0.85 }],
        ["pitcher", { badge: "few", k: 0.9 }],
      ],
      [
        ["salad", { k: 0.8, swatches: ["oat", "clay", "char"] }],
        ["latte", { k: 1.1 }],
        ["serveOat", { swatches: ["oat", "char", "slate"] }],
      ],
    ]
    for (const [i, list] of rows.entries()) {
      const row = b.row(main, `Row ${i + 1}`, { w: FILL, gap: s(6), align: "start" })
      for (const [k, o] of list) productCardUse(row, k, { ...o, imgH: 400, w: 320 })
      if (i === 0) {
        // Editorial interstitial between the first and second row.
        const ed = b.row(main, "Interstitial", {
          w: FILL,
          gap: s(8),
          pad: [40, 0],
          align: "center",
          stroke: { paint: c("border"), width: { t: 1, b: 1 } },
        })
        b.para(
          ed,
          "Lena Ortiz fires every Ridge piece twice, once bare and once glazed, so the oat settles into the clay.",
          b.ty("heading", { size: 26 }),
          ink,
          { w: 560 },
        )
        const meta = b.col(ed, "Meta", { w: FILL, gap: s(2) })
        b.text(meta, "FROM THE STUDIO", b.ty("eyebrow"), c("accent"))
        b.para(
          meta,
          "Burnsville, NC. Cone 6 stoneware, small batches of forty.",
          b.ty("small"),
          muted,
        )
      }
    }
    const more = b.col(main, "Load more", {
      w: FILL,
      gap: s(3),
      align: "center",
      pad: [16, 0, 0, 0],
    })
    b.text(more, "Showing 9 of 42", b.ty("mono", { size: 11 }), muted)
    b.use(more, buttonSecondary, { args: { label: "Load 12 more" } })
    b.use(scr, footer)
  }

  // --- Desktop: Product ------------------------------------------------------------------------
  {
    const scr = page("Product detail", "kitchen")
    const crumbs = b.row(scr, "Breadcrumb", { w: FILL, pad: [28, 64, 0, 64] })
    b.use(crumbs, breadcrumb, {
      args: {
        first: "Home",
        second: "Kitchen and dining",
        current: "Ridge stoneware mug",
      },
    })
    const main = b.row(scr, "Product", {
      w: FILL,
      gap: s(16),
      pad: [28, 64, 96, 64],
      align: "start",
    })
    // Gallery: two columns of colorways, each 388 wide with a 24 px gap (800 total).
    const gallery = b.col(main, "Gallery", { w: 800, gap: s(6) })
    const g1 = b.row(gallery, "Row 1", { w: FILL, gap: s(6) })
    imageUse(g1, "oat", "mug", { w: 388, h: 500 }, { k: 1.8, badge: "NEW" })
    imageUse(g1, "clay", "mug", { w: 388, h: 500 }, { k: 1.8 })
    const g2 = b.row(gallery, "Row 2", { w: FILL, gap: s(6) })
    imageUse(g2, "sage", "mug", { w: 388, h: 500 }, { k: 1.8 })
    imageUse(g2, "char", "mug", { w: 388, h: 500 }, { k: 1.8 })

    const info = b.col(main, "Details", { w: FILL, gap: s(6) })
    const top = b.col(info, "Title", { w: FILL, gap: s(3) })
    b.text(top, "NO. 0142  /  LENA ORTIZ POTTERY, BURNSVILLE NC", b.ty("eyebrow"), muted)
    b.text(top, "Ridge stoneware mug", b.ty("h1"), ink)
    const pr = b.row(top, "Price row", { w: FILL, gap: s(4), align: "baseline" })
    b.text(pr, "$28", b.ty("heading", { size: 26, weight: 400 }), ink, { name: "Price" })
    b.use(pr, rating, { args: { value: "4.9", count: "212 reviews" } })
    b.para(
      info,
      "A 12 oz mug with a ridged foot and a wide handle that fits three fingers. Wheel-thrown in small batches and fired to cone 6, so it is safe in the dishwasher and microwave.",
      b.ty("body", { size: 14 }),
      c("ink-2"),
    )
    const color = b.col(info, "Color", { w: FILL, gap: s(2) })
    const cl = b.row(color, "Label", { gap: s(2), align: "baseline" })
    b.text(cl, "COLOR", b.ty("eyebrow"), muted)
    b.text(cl, "Oat", b.ty("label"), ink)
    const sw = b.row(color, "Swatches", { gap: 0 })
    for (const [i, t] of (["oat", "clay", "sage", "char"] as Tone[]).entries())
      b.use(sw, swatch, { args: { tone: t, selected: i === 0 ? "yes" : "no" } })
    const buy = b.col(info, "Buy", { w: FILL, gap: s(3) })
    const br = b.row(buy, "Quantity and add", { w: FILL, gap: s(3), align: "stretch" })
    b.use(br, stepper, { args: { value: "2" } })
    b.use(br, button, { props: { w: FILL }, args: { label: "Add to bag, $56", size: "lg" } })
    const sv = b.row(buy, "Secondary", { w: FILL, justify: "between", align: "center" })
    link(sv, "Save for later")
    b.text(sv, "Free shipping. Arrives Oct 13 to Oct 15.", b.ty("small"), muted)

    const specs = b.col(info, "Specifications", { w: FILL, gap: 0 })
    for (const [l, v] of [
      ["Capacity", "355 ml / 12 oz"],
      ["Height", "10.2 cm / 4 in"],
      ["Glaze", "Oat, satin"],
      ["Fired", "Cone 6, twice"],
      ["Made in", "Burnsville, NC"],
    ] as const)
      b.use(specs, specRow, { props: { w: FILL }, args: { label: l, value: v } })
    const acc = b.col(info, "Accordion", { w: FILL })
    for (const [title, body, open] of [
      [
        "Details",
        "Speckled stoneware with a satin oat glaze. Each mug varies slightly in color and size, and some carry a small glaze drip on the foot.",
        true,
      ],
      ["Care", "", false],
      ["Shipping and returns", "", false],
    ] as const)
      b.use(acc, accordion, {
        props: { w: FILL },
        args: { title, ...(open ? { body, open: true } : {}) },
        ...(open ? { set: { AcIcon: { icon: "minus" } } } : {}),
      })

    const rv = section(scr, "Reviews", { pad: [72, 64, 80, 64], fill: c("subtle") })
    const rvRow = b.row(rv, "Reviews body", { w: FILL, gap: s(16), align: "start" })
    const sum = b.col(rvRow, "Summary", { w: 320, gap: s(4) })
    b.text(sum, "REVIEWS", b.ty("eyebrow"), muted)
    const big = b.row(sum, "Average", { gap: s(3), align: "baseline" })
    b.text(big, "4.9", b.ty("display", { size: 96, letterSpacing: -4 }), ink)
    b.text(big, "out of 5, 212 reviews", b.ty("small"), muted, { name: "Out of" })
    for (const [stars, n] of [
      ["5", 196],
      ["4", 12],
      ["3", 3],
      ["2", 1],
      ["1", 0],
    ] as const) {
      const row = b.row(sum, `${stars} stars`, { w: FILL, gap: s(3), align: "center" })
      b.text(row, stars, b.ty("mono", { size: 11 }), ink, { w: 10, grow: "fixed-width" })
      const bar = b.row(row, "Bar", { w: FILL, h: 2, fill: c("border"), clip: true })
      if (n > 0) b.rect(bar, "Done", { w: fill(n), h: 2, fill: ink })
      b.rect(bar, "Left", { w: fill(212 - n), h: 2, fill: c("border") })
      b.text(row, String(n), b.ty("mono", { size: 11, align: "right" }), muted, {
        w: 28,
        grow: "fixed-width",
      })
    }
    b.use(sum, buttonSecondary, { props: { w: FILL }, args: { label: "Write a review" } })
    const cards = b.col(rvRow, "Cards", { w: FILL, gap: s(8) })
    for (const [title, body, name, meta] of [
      [
        "Heavier than it looks, in a good way",
        "Holds heat through a whole slow morning. The oat glaze has small speckles that make each one a little different. I ordered two more for my sister.",
        "PRIYA S.",
        "VERIFIED BUYER, SEP 28, 2026",
      ],
      [
        "The handle is the best part",
        "Wide enough for three fingers, which my old mugs never were. Mine came with a tiny glaze drip on the foot that I have grown to like.",
        "TOM R.",
        "VERIFIED BUYER, SEP 12, 2026",
      ],
    ] as const)
      b.use(cards, review, { props: { w: FILL }, args: { title, body, name, meta } })

    const pairs = section(scr, "Pairs well with", { pad: [80, 64, 96, 64] })
    sectionHead(pairs, "Pairs well with")
    const row = b.row(pairs, "Products", { w: FILL, gap: s(6), align: "start" })
    productCardUse(row, "plate", { swatches: ["clay", "oat", "char"], w: 310 })
    productCardUse(row, "bowl", { w: 310 })
    productCardUse(row, "napkins", { swatches: ["sage", "oat", "clay"], w: 310 })
    productCardUse(row, "carafe", { badge: "few", w: 310 })
    b.use(scr, footer)
  }

  // --- Cart data ---------------------------------------------------------------------------------
  const bag: [PKey, string, string, string][] = [
    ["mug", "Color: Oat", "2", "$56.00"],
    ["throw", "Color: Sage", "1", "$148.00"],
    ["candle", "Color: Blush", "1", "$22.00"],
  ]
  const totals = { subtotal: "$226.00", shipping: "Free", tax: "$15.82", total: "$241.82" }
  function summaryItems(into: { inst: string; at: string } | string) {
    for (const [k, v, q] of bag) {
      const [name, , price, tone, shape] = P[k]
      b.use(into, summaryItem, {
        props: { w: FILL },
        args: {
          name,
          detail: `${v.replace("Color: ", "")} · Qty ${q}`,
          price: q === "2" ? "$56" : price,
        },
        set: {
          SiImg: { args: { size: "thumb", tone, shape } },
          ...prefixed("SiImg", scaled(shape, (thumbK[k] ?? 0.5) * 0.52)),
        },
      })
    }
  }

  // --- Desktop: Cart ---------------------------------------------------------------------------
  {
    const scr = page("Cart", "none")
    const wrap = b.col(scr, "Bag", { w: FILL, gap: s(8), pad: [56, 64, 96, 64] })
    const head = b.row(wrap, "Title", {
      w: FILL,
      gap: s(4),
      align: "baseline",
      pad: [0, 0, 24, 0],
      stroke: { paint: ink, width: { b: 1 } },
    })
    b.text(head, "Your bag", b.ty("display", { size: 64, letterSpacing: -2.4 }), ink)
    b.text(head, "4 ITEMS", b.ty("eyebrow"), muted, { name: "Count" })
    const body = b.row(wrap, "Body", { w: FILL, gap: s(12), align: "start" })
    const lines = b.col(body, "Lines", { w: FILL, gap: 0 })
    const meter = b.col(lines, "Free shipping", { w: FILL, gap: s(2), pad: [0, 0, 16, 0] })
    b.text(
      meter,
      "Your order qualifies for free shipping. Arrives Oct 13 to Oct 15.",
      b.ty("small"),
      c("success"),
    )
    b.rect(meter, "Progress", { w: FILL, h: 2, fill: c("success") })
    for (const [k, v, q, t] of bag) {
      const [name, , price, tone, shape] = P[k]
      b.use(lines, cartLine, {
        props: { w: FILL },
        args: { name, variant: v, each: `${price} each`, total: t, quantity: q },
        set: {
          ClImg: { args: { size: "thumb", tone, shape } },
          ...prefixed("ClImg", scaled(shape, thumbK[k] ?? 0.5)),
        },
      })
    }
    const gift = b.row(lines, "Gift", {
      w: FILL,
      gap: s(3),
      align: "center",
      justify: "between",
      pad: [24, 0],
    })
    b.use(gift, checkbox, {
      props: { w: 480 },
      args: { label: "Add gift wrapping and a handwritten card ($6)", count: "" },
      hide: ["CbCnt"],
    })
    link(gift, "Continue shopping")
    b.use(body, orderSummary, {
      args: { ...totals },
      hide: ["OsItems"],
      slots: {
        OsActs: (into) => {
          const promo = b.row(into, "Promo", { w: FILL, gap: s(2), align: "end" })
          b.use(promo, input, {
            props: { w: FILL },
            args: { label: "Promo code", value: "Enter code", state: "empty" },
          })
          b.use(promo, buttonSecondary, { props: { h: 46 }, args: { label: "Apply" } })
          b.use(into, button, {
            props: { w: FILL },
            args: { label: "Check out", size: "lg", icon: true },
          })
          b.para(
            into,
            "Visa, Mastercard, Amex, Apple Pay and Shop Pay. Tax is final at checkout.",
            b.ty("small", { align: "center" }),
            muted,
          )
        },
      },
    })

    const recent = section(scr, "Recently viewed", { pad: [64, 64, 96, 64] })
    sectionHead(recent, "Recently viewed")
    const row = b.row(recent, "Products", { w: FILL, gap: s(6), align: "start" })
    productCardUse(row, "vase", { badge: "few", w: 310 })
    productCardUse(row, "pillow", { swatches: ["clay", "oat", "char"], w: 310 })
    productCardUse(row, "board", { badge: "sale", was: "$72", w: 310 })
    productCardUse(row, "towel", { w: 310 })
    b.use(scr, footer)
  }

  // --- Desktop: Checkout -----------------------------------------------------------------------
  {
    const scr = b.screen(desktop, "Checkout", { w: 1440, fill: c("bg") })
    const top = b.row(scr, "Checkout header", {
      w: FILL,
      justify: "between",
      align: "center",
      pad: [22, 64],
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    const tl = b.row(top, "Brand", { w: 320 })
    brand(tl)
    b.use(top, steps, { args: { active: "checkout" } })
    const secure = b.row(top, "Secure", { w: 320, gap: s(2), align: "center", justify: "end" })
    b.icon(secure, "lock", 13, muted)
    b.text(secure, "Secure checkout", b.ty("small", { size: 12 }), muted)

    const body = b.row(scr, "Body", { w: FILL, gap: s(16), pad: [48, 64, 96, 64], align: "start" })
    const form = b.col(body, "Form", { w: FILL, gap: s(10) })
    const block = (n: string, title: string, right?: string) => {
      const sec = b.col(form, title, { w: FILL, gap: s(5) })
      const h = b.row(sec, "Header", {
        w: FILL,
        gap: s(3),
        align: "baseline",
        pad: [0, 0, 14, 0],
        stroke: { paint: ink, width: { b: 1 } },
      })
      b.text(h, n, b.ty("mono", { size: 12 }), muted)
      b.text(h, title, b.ty("heading", { size: 24 }), ink, { w: FILL, grow: "fixed-width" })
      if (right) link(h, right)
      return sec
    }
    const field = (
      parent: string,
      label: string,
      value: string,
      w: unknown = FILL,
      empty = false,
    ) =>
      b.use(parent, input, {
        props: { w },
        args: { label, value, ...(empty ? { state: "empty" } : {}) },
      })
    // Form column: 1440 - 128 padding - 440 summary - 64 gap = 808.
    const FW = { half: 396, city: 340, state: 276, zip: 160, card: 396 }
    const contact = block("01", "Contact", "Sign in")
    field(contact, "Email", "nora.whitfield@fastmail.com")
    b.use(contact, checkbox, {
      props: { w: FILL },
      args: { label: "Email me when new batches arrive", checked: "yes" },
      hide: ["CbCnt"],
    })
    const ship = block("02", "Delivery address")
    const r1 = b.row(ship, "Name", { w: FILL, gap: s(4) })
    // Explicit widths: fill siblings split by content, so paired fields would come out uneven.
    field(r1, "First name", "Nora", FW.half)
    field(r1, "Last name", "Whitfield", FW.half)
    field(ship, "Address", "214 Montford Avenue")
    field(ship, "Apartment, suite (optional)", "Apt 3", FILL)
    const r2 = b.row(ship, "City", { w: FILL, gap: s(4) })
    field(r2, "City", "Asheville", FW.city)
    field(r2, "State", "North Carolina", FW.state)
    field(r2, "ZIP code", "28801", FW.zip)
    const method = block("03", "Shipping method")
    for (const [title, detail, price, on] of [
      ["Standard", "Arrives Oct 13 to Oct 15", "Free", true],
      ["Express", "Arrives Oct 9", "$18.00", false],
      ["Pick up at the shop", "412 Haywood Road, ready in 2 hours", "Free", false],
    ] as const)
      b.use(method, radio, {
        props: { w: FILL },
        args: { title, detail, price, selected: on ? "yes" : "no" },
      })
    const pay = block("04", "Payment", "Visa, Mastercard, Amex")
    field(pay, "Card number", "4242 4242 4242 4242")
    const r3 = b.row(pay, "Row", { w: FILL, gap: s(4) })
    field(r3, "Expiry", "08 / 28", FW.card)
    field(r3, "Security code", "CVC", FW.card, true)
    b.use(pay, checkbox, {
      props: { w: FILL },
      args: { label: "Billing address is the same as delivery", checked: "yes" },
      hide: ["CbCnt"],
    })

    const side = b.col(body, "Summary", { w: 440, gap: s(4) })
    b.use(side, orderSummary, {
      props: { w: FILL },
      args: { ...totals },
      slots: {
        OsItems: (into) => summaryItems(into),
        OsActs: (into) => {
          b.use(into, button, {
            props: { w: FILL },
            args: { label: "Pay $241.82", size: "lg", icon: true },
            set: { BtnIcon: { icon: "lock" } },
          })
          b.para(
            into,
            "By placing your order you agree to the Terms and the Returns policy.",
            b.ty("small", { align: "center" }),
            muted,
          )
        },
      },
    })
    b.para(
      side,
      "Questions? Write to hello@fernhill.shop or call (828) 555-0142.",
      b.ty("small"),
      muted,
    )
  }

  // --- Desktop: Order confirmation ---------------------------------------------------------------
  {
    const scr = page("Order confirmation", "none", true)
    const wrap = b.col(scr, "Confirmation", {
      w: FILL,
      gap: s(12),
      pad: [56, 64, 96, 64],
    })
    b.use(wrap, steps, { args: { active: "done" } })
    const head = b.col(wrap, "Header", {
      w: FILL,
      gap: s(5),
      pad: [0, 0, 40, 0],
      stroke: { paint: ink, width: { b: 1 } },
    })
    b.text(head, "ORDER FH-20418  /  OCTOBER 6, 2026", b.ty("eyebrow"), c("accent"))
    b.text(head, "Thank you, Nora.", b.ty("display"), ink)
    b.para(
      head,
      "A receipt is on its way to nora.whitfield@fastmail.com, and we will email tracking when your order ships.",
      b.ty("body-lg"),
      c("ink-2"),
      { w: 640 },
    )
    const cols = b.row(wrap, "Order", { w: FILL, gap: s(16), align: "start" })
    const info = b.col(cols, "Info", { w: 520, gap: 0 })
    for (const [title, lines] of [
      ["ARRIVES", ["Tuesday, Oct 13 to Thursday, Oct 15"]],
      ["SHIP TO", ["Nora Whitfield", "214 Montford Ave, Apt 3", "Asheville, NC 28801"]],
      ["PAID WITH", ["Visa ending in 4242", "$241.82"]],
    ] as const) {
      const row = b.row(info, title, {
        w: FILL,
        gap: s(6),
        pad: [20, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      })
      b.text(row, title, b.ty("eyebrow"), muted, { w: 120, grow: "fixed-width" })
      const col = b.col(row, "Lines", { w: FILL, gap: 2 })
      for (const l of lines) b.text(col, l, b.ty("body", { size: 14 }), ink)
    }
    const acts = b.row(info, "Actions", { gap: s(4), align: "center", pad: [32, 0, 0, 0] })
    b.use(acts, button, { args: { label: "Track your order", size: "lg" } })
    b.use(acts, buttonSecondary, { args: { label: "Continue shopping", size: "lg" } })

    const panel = b.col(cols, "Receipt", { w: FILL, gap: s(5), pad: 32, fill: c("subtle") })
    b.text(panel, "YOUR ORDER", b.ty("eyebrow"), muted)
    const items = b.col(panel, "Items", { w: FILL, gap: s(4) })
    summaryItems(items)
    const tot = b.col(panel, "Totals", {
      w: FILL,
      gap: s(2),
      pad: [20, 0, 0, 0],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    for (const [label, value, kind] of [
      ["Subtotal", totals.subtotal, "line"],
      ["Shipping", "Free", "line"],
      ["Tax", totals.tax, "line"],
      ["Total", totals.total, "total"],
    ] as const)
      b.use(tot, summaryRow, { props: { w: FILL }, args: { label, value, kind } })
    b.use(scr, footer)
  }

  // --- Mobile ----------------------------------------------------------------------------------
  function mscreen(name: string) {
    const scr = b.screen(mobile, name, { w: 390, h: 844, fill: c("bg"), clip: true })
    return scr
  }
  {
    const scr = mscreen("Home")
    b.use(scr, announcement, {
      props: { w: FILL },
      args: { message: "Free shipping over $100" },
    })
    b.use(scr, mobileHeader, { props: { w: FILL } })
    const hero = b.col(scr, "Hero", { w: FILL, gap: s(4), pad: [28, 16, 20, 16] })
    b.text(hero, "AUTUMN 2026  /  14 NEW", b.ty("eyebrow"), c("accent"))
    b.para(
      hero,
      "Made in small batches, used every day.",
      b.ty("h1", { size: 36, letterSpacing: -1.3 }),
      ink,
    )
    link(hero, "Shop new arrivals")
    const plate = b.col(scr, "Plate 01", { w: FILL, gap: s(2), pad: [0, 16, 0, 16] })
    imageUse(plate, "clay", "vase", { w: FILL, h: 170 }, { k: 0.55, badge: "NEW" })
    const pc = b.row(plate, "Caption", { w: FILL, justify: "between" })
    b.text(pc, "PLATE 01", b.ty("eyebrow", { size: 10 }), ink)
    b.text(pc, "Coast bud vase", b.ty("small", { size: 12 }), muted)
    const fresh = b.col(scr, "New this week", { w: FILL, gap: s(3), pad: [28, 16, 0, 16] })
    const fh = b.row(fresh, "Header", {
      w: FILL,
      justify: "between",
      align: "baseline",
      pad: [0, 0, 10, 0],
      stroke: { paint: ink, width: { b: 1 } },
    })
    b.text(fh, "New this week", b.ty("heading", { size: 22 }), ink)
    link(fh, "See all")
    const row = b.row(fresh, "Products", { w: FILL, gap: s(3), align: "start" })
    productCardUse(row, "mug", { badge: "new", imgH: 126, w: 173, k: 0.4 })
    productCardUse(row, "throw", {
      badge: "new",
      imgH: 126,
      w: 173,
      k: 0.4,
      meta: "Linen, 50 × 70 in",
    })
  }
  {
    const scr = mscreen("Product detail")
    b.use(scr, mobileHeader, { props: { w: FILL } })
    const content = b.col(scr, "Content", { w: FILL, h: FILL, gap: s(3), pad: [0, 0, 16, 0] })
    imageUse(content, "oat", "mug", { w: FILL, h: 340 }, { k: 1.3, badge: "NEW", fav: true })
    const dots = b.row(content, "Dots", { w: FILL, gap: s(2), justify: "center" })
    for (let i = 0; i < 4; i++)
      b.rect(dots, "Dot", { w: i === 0 ? 18 : 6, h: 2, fill: i === 0 ? ink : c("border") })
    const info = b.col(content, "Info", { w: FILL, gap: s(2), pad: [0, 16] })
    b.text(info, "NO. 0142  /  LENA ORTIZ POTTERY", b.ty("eyebrow", { size: 10 }), muted)
    const tr = b.row(info, "Title", { w: FILL, justify: "between", align: "baseline" })
    b.text(tr, "Ridge stoneware mug", b.ty("heading", { size: 26, letterSpacing: -0.8 }), ink)
    b.text(tr, "$28", b.ty("heading", { size: 22, weight: 400 }), ink)
    b.use(info, rating, { args: { value: "4.9", count: "212" } })
    b.para(
      info,
      "12 oz, wheel-thrown in Burnsville, NC. Dishwasher and microwave safe.",
      b.ty("body", { size: 14 }),
      c("ink-2"),
    )
    const cl = b.row(info, "Color", { w: FILL, gap: s(2), align: "center", pad: [2, 0, 0, 0] })
    b.text(cl, "COLOR", b.ty("eyebrow", { size: 10 }), muted)
    b.text(cl, "Oat", b.ty("label"), ink, { w: FILL, grow: "fixed-width" })
    for (const [i, t] of (["oat", "clay", "sage", "char"] as Tone[]).entries())
      b.use(cl, swatch, { args: { tone: t, selected: i === 0 ? "yes" : "no" } })
    b.text(info, "Free shipping. Arrives Oct 13 to Oct 15.", b.ty("small"), muted)
    const accM = b.col(info, "Accordion", { w: FILL })
    b.use(accM, accordion, { props: { w: FILL }, args: { title: "Details and care" } })
    const bar = b.row(scr, "Buy bar", {
      w: FILL,
      gap: s(2),
      align: "center",
      pad: [12, 16, 28, 16],
      fill: c("surface"),
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.use(bar, stepper, { args: { value: "1" } })
    b.use(bar, button, { props: { w: FILL, h: 52 }, args: { label: "Add to bag, $28" } })
  }
  {
    const scr = mscreen("Cart")
    b.use(scr, mobileHeader, { props: { w: FILL } })
    const content = b.col(scr, "Content", { w: FILL, h: FILL, gap: s(3), pad: [24, 16, 0, 16] })
    const head = b.row(content, "Title", {
      w: FILL,
      gap: s(2),
      align: "baseline",
      pad: [0, 0, 12, 0],
      stroke: { paint: ink, width: { b: 1 } },
    })
    b.text(head, "Your bag", b.ty("heading", { size: 30, letterSpacing: -1 }), ink)
    b.text(head, "4 ITEMS", b.ty("eyebrow", { size: 10 }), muted)
    const meter = b.col(content, "Free shipping", { w: FILL, gap: s(2) })
    b.text(meter, "Your order ships free.", b.ty("small", { size: 12 }), c("success"))
    b.rect(meter, "Progress", { w: FILL, h: 2, fill: c("success") })
    const lines = b.col(content, "Lines", { w: FILL })
    for (const [k, v, q, t] of bag) {
      const [name, , price, tone, shape] = P[k]
      b.use(lines, cartLineMobile, {
        props: { w: FILL },
        args: {
          name,
          variant: `${v.replace("Color: ", "")} · ${price} each`,
          total: t.replace(".00", ""),
          quantity: q,
        },
        set: {
          CmImg: { args: { size: "thumb", tone, shape } },
          ...prefixed("CmImg", scaled(shape, (thumbK[k] ?? 0.5) * 0.75)),
        },
      })
    }
    const rows = b.col(content, "Totals", { w: FILL, gap: s(2), pad: [4, 0, 0, 0] })
    for (const [label, value, kind] of [
      ["Subtotal", totals.subtotal, "line"],
      ["Shipping", "Free", "line"],
      ["Estimated tax", totals.tax, "line"],
    ] as const)
      b.use(rows, summaryRow, { props: { w: FILL }, args: { label, value, kind } })
    const bar = b.col(scr, "Checkout bar", {
      w: FILL,
      gap: s(3),
      pad: [14, 16, 28, 16],
      fill: c("surface"),
      stroke: { paint: ink, width: { t: 1 } },
    })
    b.use(bar, summaryRow, {
      props: { w: FILL },
      args: { label: "Total", value: totals.total, kind: "total" },
    })
    b.use(bar, button, {
      props: { w: FILL },
      args: { label: "Check out", size: "lg", icon: true },
    })
  }
}
