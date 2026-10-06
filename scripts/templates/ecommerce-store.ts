/**
 * Fernhill: the online shop of a fictional independent home goods store in Asheville, NC.
 * Desktop (1440 wide): Home, Category, Product, Cart, Checkout, Order confirmation.
 * Mobile (390×844): Home, Product, Cart.
 */
import { FILL, fill, p, type Template, type TemplateBuilder } from "./lib"

export const template: Template = {
  slug: "ecommerce-store",
  name: "Fernhill home goods store",
  category: "eCommerce",
  description:
    "Nine-screen online store for an independent home goods shop: home, category, product, cart, checkout and confirmation on desktop, plus home, product and cart on mobile.",
  prefix: "fh",
  build,
}

type Tone = "clay" | "sage" | "oat" | "slate" | "rose" | "char"
type Shape = "vase" | "mug" | "candle" | "bowl" | "throw" | "pillow" | "board" | "carafe" | "towel"

/** Object geometry per shape at card scale: body, neck (top piece) and handle. */
const SHAPES: Record<
  Shape,
  {
    body: [number, number, number[]]
    neck?: [number, number, number[]]
    handle?: [number, number]
  }
> = {
  vase: { body: [100, 150, [50, 50, 30, 30]], neck: [38, 40, [6, 6, 0, 0]] },
  mug: { body: [104, 100, [6, 6, 26, 26]], handle: [46, 56] },
  candle: { body: [74, 140, [10, 10, 8, 8]], neck: [6, 18, [3, 3, 0, 0]] },
  bowl: { body: [184, 78, [6, 6, 92, 92]] },
  throw: { body: [200, 132, [14, 14, 14, 14]] },
  pillow: { body: [172, 160, [44, 44, 44, 44]] },
  board: { body: [232, 50, [25, 25, 25, 25]] },
  carafe: { body: [110, 130, [28, 28, 52, 52]], neck: [40, 56, [8, 8, 0, 0]] },
  towel: { body: [160, 172, [8, 8, 8, 8]] },
}

function build(b: TemplateBuilder) {
  b.tokens({
    colors: {
      bg: ["#FAF7F2", "#141210"],
      surface: ["#FFFFFF", "#1C1916"],
      subtle: ["#F3EEE6", "#24201C"],
      ink: ["#231F1A", "#F2EDE5"],
      "ink-2": ["#4A433B", "#CFC7BB"],
      muted: ["#766C60", "#9C9284"],
      border: ["#E6DFD3", "#35302A"],
      accent: ["#9C4A2A", "#E08B66"],
      "accent-soft": ["#F6E6DC", "#3A231A"],
      "on-accent": ["#FFFFFF", "#141210"],
      inverse: ["#2B2621", "#0C0A09"],
      "on-inverse": ["#FAF7F2", "#F2EDE5"],
      "inverse-muted": ["#C4B9AA", "#A39886"],
      success: ["#3F6B3A", "#8CC084"],
      "success-soft": ["#E5EEDF", "#1F2E1C"],
      sale: ["#B42318", "#F97066"],
      "sale-soft": ["#FCE8E6", "#3B1714"],
      star: ["#B7791F", "#E7B24C"],
      shade: ["#2B26211A", "#00000059"],
      "img-light": ["#FBF8F3", "#1F1B18"],
      "clay-bg": ["#EFD9CC", "#3A2A22"],
      clay: ["#C47A57", "#B9714F"],
      "sage-bg": ["#DDE5D6", "#26302A"],
      sage: ["#8BA087", "#7E957A"],
      "oat-bg": ["#EFE6D6", "#332D24"],
      oat: ["#D2BF9C", "#B8A685"],
      "slate-bg": ["#DCE1E5", "#252B31"],
      slate: ["#6F7D8A", "#7C8B98"],
      "rose-bg": ["#F2DEDB", "#3A2627"],
      rose: ["#C98E8A", "#B9827E"],
      "char-bg": ["#E3DFDA", "#2A2725"],
      char: ["#4A4542", "#8D8781"],
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
      "radius/sm": 4,
      "radius/md": 8,
      "radius/lg": 12,
      "radius/xl": 20,
      "radius/pill": 999,
    },
    type: {
      display: { font: "Inter", size: 60, weight: 700, lineHeight: 1.05, letterSpacing: -2 },
      h1: { font: "Inter", size: 40, weight: 700, lineHeight: 1.12, letterSpacing: -1.2 },
      heading: { font: "Inter", size: 28, weight: 600, lineHeight: 1.2, letterSpacing: -0.6 },
      title: { font: "Inter", size: 18, weight: 600, lineHeight: 1.35, letterSpacing: -0.2 },
      "body-lg": { font: "Inter", size: 17, weight: 400, lineHeight: 1.6 },
      body: { font: "Inter", size: 15, weight: 400, lineHeight: 1.55 },
      label: { font: "Inter", size: 14, weight: 600, lineHeight: 1.3 },
      small: { font: "Inter", size: 13, weight: 400, lineHeight: 1.45 },
      price: { font: "Inter", size: 16, weight: 600, lineHeight: 1.3 },
      eyebrow: { font: "Inter", size: 12, weight: 600, lineHeight: 1.3, letterSpacing: 1.2 },
    },
    shadows: {
      card: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#2B26210F" },
        { kind: "shadow", x: 0, y: 8, blur: 24, spread: -8, color: "#2B26211F" },
      ],
      pop: { kind: "shadow", x: 0, y: 20, blur: 48, spread: -12, color: "#2B262133" },
    },
  })

  const c = (n: string) => b.c(n)
  const s = (n: number) => b.n(`space/${n}`)
  const r = (n: string) => b.n(`radius/${n}`)
  const ink = c("ink")
  const muted = c("muted")
  const card = (extra: Record<string, unknown> = {}) => ({
    radius: r("lg"),
    fill: c("surface"),
    stroke: { paint: c("border") },
    ...extra,
  })
  const toneBg = (t: Tone) => ({
    kind: "linear",
    rotation: 180,
    stops: [
      { color: c(`${t}-bg`), at: 0 },
      { color: c("img-light"), at: 1 },
    ],
  })

  // --- Components: basics ----------------------------------------------------------------------

  const button = b.component(
    "Button",
    {
      key: "Btn",
      section: "Actions",
      description: "Primary, secondary, ghost or inverse (on dark bands); md or lg.",
      props: {
        label: p.text("BtnLabel", "Button"),
        icon: p.bool("BtnIcon", false),
        variant: p.variants({
          primary: {
            "root.fill": c("accent"),
            "root.stroke": { paint: c("accent") },
            "BtnLabel.fill": c("on-accent"),
            "BtnIcon.color": c("on-accent"),
          },
          secondary: {
            "root.fill": c("surface"),
            "root.stroke": { paint: c("border") },
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
          md: { "root.layout/pad": [10, 18], "BtnLabel.style/size": 14 },
          lg: { "root.layout/pad": [15, 26], "BtnLabel.style/size": 15 },
        }),
      },
      root: {
        dir: "row",
        gap: 8,
        align: "center",
        justify: "center",
        pad: [10, 18],
        radius: r("pill"),
        fill: c("accent"),
        stroke: { paint: c("accent") },
      },
    },
    (root) => {
      b.text(root, "Button", b.ty("label"), c("on-accent"), { key: "BtnLabel", name: "Label" })
      b.icon(root, "arrow-right", 16, c("on-accent"), { key: "BtnIcon", visible: false })
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
      props: {
        label: p.text("BadgeLbl", "Badge"),
        tone: p.variants({
          neutral: { "root.fill": c("surface"), "BadgeLbl.fill": c("ink-2") },
          accent: { "root.fill": c("accent-soft"), "BadgeLbl.fill": c("accent") },
          sale: { "root.fill": c("sale-soft"), "BadgeLbl.fill": c("sale") },
          success: { "root.fill": c("success-soft"), "BadgeLbl.fill": c("success") },
        }),
      },
      root: { dir: "row", pad: [4, 10], radius: r("pill"), fill: c("surface") },
    },
    (root) =>
      b.text(root, "Badge", b.ty("small", { size: 12, weight: 600 }), c("ink-2"), {
        key: "BadgeLbl",
        name: "Label",
      }),
  )
  const badgeNew = b.derive(badge, "Badge/New", "BdgNew", {
    section: "Actions",
    args: { tone: "accent", label: "New" },
  })
  const badgeSale = b.derive(badge, "Badge/Sale", "BdgSale", {
    section: "Actions",
    args: { tone: "sale", label: "Sale" },
  })

  const rating = b.component(
    "Rating",
    {
      key: "Rating",
      section: "Product",
      props: {
        value: p.text("RtVal", "4.9"),
        count: p.text("RtCnt", "(212 reviews)"),
        showCount: p.bool("RtCnt", true),
      },
      root: { dir: "row", gap: 8, align: "center" },
    },
    (root) => {
      const stars = b.row(root, "Stars", { gap: 2, align: "center" })
      for (let i = 0; i < 5; i++) b.icon(stars, "star", 14, c("star"))
      b.text(root, "4.9", b.ty("label", { size: 13 }), ink, { key: "RtVal", name: "Value" })
      b.text(root, "(212 reviews)", b.ty("small"), muted, { key: "RtCnt", name: "Count" })
    },
  )

  // Product image: a tinted tile with a simple object silhouette (no image files).
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
          "PiShadow.w": Math.round(g.body[0] * 0.92),
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
      },
    ]),
  )
  const productImage = b.component(
    "Product image",
    {
      key: "Pimg",
      section: "Product",
      description:
        "Tinted tile with an object silhouette. Pick a tone and a shape; thumb hides the top row.",
      props: {
        tone: p.variants(toneOpts),
        shape: p.variants(shapeOpts),
        size: p.variants({
          card: { "root.layout/pad": [14, 14, 42, 14], "PiTop.visible": true },
          thumb: { "root.layout/pad": 4, "PiTop.visible": false },
        }),
        badge: p.bool("PiTagWrap", true),
        badgeLabel: p.text("PiTag/BadgeLbl", "New"),
        badgeStyle: p.swap("PiTag", badgeNew),
        favorite: p.bool("PiFav", true),
      },
      root: {
        dir: "column",
        w: 300,
        h: 340,
        pad: [14, 14, 42, 14],
        radius: r("lg"),
        fill: toneBg("clay"),
        clip: true,
      },
    },
    (root) => {
      const top = b.row(root, "Top", {
        key: "PiTop",
        w: FILL,
        h: 30,
        justify: "between",
        align: "center",
      })
      const tagWrap = b.row(top, "Badge", { key: "PiTagWrap" })
      b.use(tagWrap, badgeNew, { key: "PiTag" })
      const fav = b.row(top, "Favorite", {
        key: "PiFav",
        w: 30,
        h: 30,
        radius: r("pill"),
        fill: c("surface"),
        align: "center",
        justify: "center",
      })
      b.icon(fav, "heart", 15, c("ink-2"))
      const item = b.col(root, "Object", {
        w: FILL,
        h: FILL,
        align: "center",
        justify: "center",
      })
      b.rect(item, "Neck", {
        key: "PiNeck",
        w: 38,
        h: 40,
        radius: [6, 6, 0, 0],
        fill: c("clay"),
      })
      const body = b.row(item, "Body row", { gap: -18, align: "center" })
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
      b.ellipse(item, "Shadow", { key: "PiShadow", w: 92, h: 12, fill: c("shade") })
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
      ...(g.handle ? { PiHandle: { w: sc(g.handle[0]), h: sc(g.handle[1]) } } : {}),
      PiShadow: { w: sc(g.body[0] * 0.92), h: sc(12) },
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
          no: { "root.stroke": { paint: c("border"), width: 1 } },
          yes: { "root.stroke": { paint: c("ink"), width: 2 } },
        }),
      },
      root: {
        dir: "row",
        w: 30,
        h: 30,
        align: "center",
        justify: "center",
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border"), width: 1 },
      },
    },
    (root) => b.ellipse(root, "Color", { key: "SwDot", w: 22, h: 22, fill: c("oat") }),
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
      root: { dir: "column", w: 300, gap: 14 },
    },
    (root) => {
      b.use(root, productImage, { key: "PcImg", props: { w: FILL } })
      const text = b.col(root, "Text", { w: FILL, gap: 4 })
      const top = b.row(text, "Name row", { w: FILL, gap: 12, justify: "between", align: "start" })
      b.para(top, "Product name", b.ty("label", { size: 15, weight: 500 }), ink, {
        key: "PcName",
        name: "Name",
      })
      const prices = b.row(top, "Prices", { gap: 6, align: "center" })
      b.text(prices, "$0", b.ty("body", { size: 15, decoration: ["strike"] }), muted, {
        key: "PcWas",
        visible: false,
        name: "Was",
      })
      b.text(prices, "$0", b.ty("label", { size: 15 }), ink, { key: "PcPrice", name: "Price" })
      b.para(text, "Material, size", b.ty("small"), muted, { key: "PcMeta", name: "Meta" })
      const sw = b.row(root, "Swatches", { key: "PcSw", gap: 6, align: "center" })
      for (const [i, t] of (["oat", "clay", "sage"] as Tone[]).entries())
        b.use(sw, swatch, {
          key: `PcSw${i + 1}`,
          props: { w: 20, h: 20 },
          args: { tone: t },
          set: { SwDot: { w: 14, h: 14 } },
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
      root: { dir: "row", gap: 6, align: "center", pad: [8, 8], radius: r("pill") },
    },
    (root) => {
      b.icon(root, "shopping-bag", 20, ink, { key: "IbIcon" })
      const wrap = b.row(root, "Count", {
        key: "IbCntWrap",
        h: 20,
        pad: [0, 7],
        align: "center",
        radius: r("pill"),
        fill: c("accent"),
        visible: false,
      })
      b.text(wrap, "2", b.ty("small", { size: 12, weight: 700 }), c("on-accent"), { key: "IbCnt" })
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
          md: { "root.h": 48, "QtyVal.w": 36 },
          sm: { "root.h": 36, "QtyVal.w": 28 },
        }),
      },
      root: {
        dir: "row",
        h: 48,
        gap: 4,
        pad: [0, 10],
        align: "center",
        radius: r("pill"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      },
    },
    (root) => {
      b.icon(root, "minus", 16, c("ink-2"))
      b.text(root, "1", b.ty("label", { size: 15, align: "center" }), ink, {
        key: "QtyVal",
        w: 36,
        grow: "fixed-width",
        name: "Value",
      })
      b.icon(root, "plus", 16, c("ink-2"))
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
      root: { dir: "column", w: 360, gap: 6 },
    },
    (root) => {
      b.text(root, "Label", b.ty("label", { size: 13 }), c("ink-2"), { key: "InLbl" })
      const field = b.row(root, "Field", {
        w: FILL,
        h: 46,
        pad: [0, 14],
        align: "center",
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border") },
      })
      b.text(field, "Value", b.ty("body"), ink, { key: "InVal", name: "Value" })
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
            "CbBox.fill": c("surface"),
            "CbBox.stroke": { paint: c("border"), width: 1.5 },
            "CbTick.visible": false,
          },
          yes: {
            "CbBox.fill": c("accent"),
            "CbBox.stroke": { paint: c("accent"), width: 1.5 },
            "CbTick.visible": true,
          },
        }),
      },
      root: { dir: "row", w: 240, gap: 10, align: "center" },
    },
    (root) => {
      const box = b.row(root, "Box", {
        key: "CbBox",
        w: 18,
        h: 18,
        radius: r("sm"),
        align: "center",
        justify: "center",
        fill: c("surface"),
        stroke: { paint: c("border"), width: 1.5 },
      })
      b.icon(box, "check", 13, c("on-accent"), { key: "CbTick", visible: false })
      b.text(root, "Option", b.ty("body", { size: 14 }), c("ink-2"), {
        key: "CbLbl",
        w: FILL,
        grow: "fixed-width",
      })
      b.text(root, "0", b.ty("small"), muted, { key: "CbCnt" })
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
            "root.fill": c("surface"),
            "RoRing.stroke": { paint: c("border"), width: 1.5 },
            "RoDot.visible": false,
          },
          yes: {
            "root.stroke": { paint: c("accent"), width: 1.5 },
            "root.fill": c("accent-soft"),
            "RoRing.stroke": { paint: c("accent"), width: 1.5 },
            "RoDot.visible": true,
          },
        }),
      },
      root: {
        dir: "row",
        w: 560,
        gap: 14,
        align: "center",
        pad: [16, 18],
        radius: r("md"),
        fill: c("surface"),
        stroke: { paint: c("border"), width: 1 },
      },
    },
    (root) => {
      const ring = b.row(root, "Radio", {
        key: "RoRing",
        w: 20,
        h: 20,
        radius: r("pill"),
        align: "center",
        justify: "center",
        fill: c("surface"),
        stroke: { paint: c("border"), width: 1.5 },
      })
      b.ellipse(ring, "Dot", { key: "RoDot", w: 10, h: 10, fill: c("accent"), visible: false })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Option", b.ty("label"), ink, { key: "RoTitle" })
      b.text(t, "Detail", b.ty("small"), muted, { key: "RoDesc" })
      b.text(root, "Free", b.ty("label"), ink, { key: "RoPrice" })
    },
  )

  // --- Components: navigation ----------------------------------------------------------------

  function brand(parent: string, size = 22, onInverse = false) {
    const row = b.row(parent, "Brand", { gap: 8, align: "center" })
    b.icon(row, "leaf", size - 2, onInverse ? c("on-inverse") : c("accent"))
    b.text(
      row,
      "Fernhill",
      b.ty("title", { size, weight: 700, letterSpacing: -0.6 }),
      onInverse ? c("on-inverse") : ink,
      { name: "Wordmark" },
    )
    return row
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
        gap: 8,
        justify: "center",
        align: "center",
        pad: [9, 16],
        fill: c("inverse"),
      },
    },
    (root) => {
      b.icon(root, "truck", 14, c("on-inverse"))
      b.text(root, "Message", b.ty("small", { weight: 500 }), c("on-inverse"), { key: "AnText" })
    },
  )

  const navLinks = ["Shop all", "Kitchen", "Living", "Bedroom", "Bath", "Journal"] as const
  const navActive = (i: number) =>
    Object.fromEntries(
      navLinks.flatMap((_, j) => [
        [`HdL${j + 1}.fill`, j === i ? ink : c("ink-2")],
        [`HdL${j + 1}.style/weight`, j === i ? 600 : 500],
      ]),
    )
  const header = b.component(
    "Site header",
    {
      key: "Header",
      section: "Navigation",
      props: {
        active: p.variants({
          none: navActive(-1),
          all: navActive(0),
          kitchen: navActive(1),
          living: navActive(2),
        }),
        bagCount: p.text("HdBag/IbCnt", "3"),
      },
      root: {
        dir: "row",
        w: 1440,
        justify: "between",
        align: "center",
        pad: [16, 64],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const left = b.row(root, "Left", { gap: 48, align: "center" })
      brand(left)
      const links = b.row(left, "Links", { gap: 28, align: "center" })
      for (const [i, l] of navLinks.entries())
        b.text(links, l, b.ty("body", { size: 14, weight: 500 }), c("ink-2"), {
          key: `HdL${i + 1}`,
        })
      const right = b.row(root, "Actions", { gap: 8, align: "center" })
      const search = b.row(right, "Search", {
        w: 240,
        gap: 8,
        align: "center",
        pad: [9, 14],
        radius: r("pill"),
        fill: c("subtle"),
      })
      b.icon(search, "search", 16, muted)
      b.text(search, "Search mugs, linen, candles", b.ty("small"), muted)
      b.use(right, iconButton, { set: { IbIcon: { icon: "user" } } })
      b.use(right, iconButton, { set: { IbIcon: { icon: "heart" } } })
      b.use(right, iconButton, { key: "HdBag", args: { count: "3", showCount: true } })
    },
  )

  const mobileHeader = b.component(
    "Mobile header",
    {
      key: "MHeader",
      section: "Navigation",
      props: { bagCount: p.text("MhBag/IbCnt", "3") },
      root: {
        dir: "row",
        w: 390,
        h: 56,
        justify: "between",
        align: "center",
        pad: [0, 12],
        fill: c("bg"),
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const left = b.row(root, "Left", { w: 92, gap: 0, align: "center" })
      b.use(left, iconButton, { set: { IbIcon: { icon: "menu" } } })
      b.use(left, iconButton, { set: { IbIcon: { icon: "search" } } })
      brand(root, 19)
      const right = b.row(root, "Right", { w: 92, justify: "end", align: "center" })
      b.use(right, iconButton, { key: "MhBag", args: { count: "3", showCount: true } })
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
      root: { dir: "row", gap: 6, align: "center" },
    },
    (root) => {
      b.text(root, "Home", b.ty("small"), muted, { key: "CrA" })
      b.icon(root, "chevron-right", 14, muted)
      b.text(root, "Section", b.ty("small"), muted, { key: "CrB" })
      b.icon(root, "chevron-right", 14, muted)
      b.text(root, "Page", b.ty("small", { weight: 600 }), ink, { key: "CrC" })
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
            "StI2.fill": c("accent"),
            "StN2.fill": c("on-accent"),
            "StL2.fill": ink,
            "StI3.fill": c("subtle"),
            "StN3.fill": muted,
            "StL3.fill": muted,
          },
          done: {
            "StI2.fill": c("success-soft"),
            "StN2.fill": c("success"),
            "StL2.fill": muted,
            "StI3.fill": c("accent"),
            "StN3.fill": c("on-accent"),
            "StL3.fill": ink,
          },
        }),
      },
      root: { dir: "row", gap: 12, align: "center" },
    },
    (root) => {
      const step = (i: number, label: string, done: boolean) => {
        const st = b.row(root, label, { gap: 8, align: "center" })
        const dot = b.row(st, "Marker", {
          key: `StI${i}`,
          w: 22,
          h: 22,
          radius: r("pill"),
          align: "center",
          justify: "center",
          fill: done ? c("success-soft") : i === 2 ? c("accent") : c("subtle"),
        })
        b.text(
          dot,
          String(i),
          b.ty("small", { size: 11, weight: 700 }),
          done ? c("success") : i === 2 ? c("on-accent") : muted,
          { key: `StN${i}` },
        )
        b.text(st, label, b.ty("label", { size: 13 }), done ? muted : i === 2 ? ink : muted, {
          key: `StL${i}`,
        })
      }
      step(1, "Bag", true)
      b.rect(root, "Line", { w: 32, h: 1, fill: c("border") })
      step(2, "Details and payment", false)
      b.rect(root, "Line", { w: 32, h: 1, fill: c("border") })
      step(3, "Confirmation", false)
    },
  )

  const footer = b.component(
    "Footer",
    {
      key: "Footer",
      section: "Navigation",
      root: { dir: "column", w: 1440, gap: 40, pad: [64, 64, 32, 64], fill: c("subtle") },
    },
    (root) => {
      const top = b.row(root, "Top", { w: FILL, gap: 64 })
      const about = b.col(top, "About", { w: 340, gap: 16 })
      brand(about)
      b.para(
        about,
        "Ceramics, linen and pantry goods from 38 small makers. Visit the shop at 412 Haywood Road, Asheville, open Tuesday to Sunday.",
        b.ty("body", { size: 14 }),
        muted,
      )
      for (const [title, items] of [
        [
          "Shop",
          ["New arrivals", "Kitchen and dining", "Living", "Bedroom and bath", "Gift cards"],
        ],
        ["Help", ["Shipping", "Returns and exchanges", "Care guides", "Contact us"]],
        ["Fernhill", ["Our makers", "Journal", "Visit the shop", "Wholesale"]],
      ] as const) {
        const col = b.col(top, title, { w: FILL, gap: 12 })
        b.text(col, title, b.ty("label"), ink)
        for (const it of items) b.text(col, it, b.ty("body", { size: 14 }), muted)
      }
      b.divider(root, c("border"))
      const bottom = b.row(root, "Bottom", { w: FILL, justify: "between", align: "center" })
      b.text(bottom, "Copyright 2026 Fernhill Home, Asheville, NC", b.ty("small"), muted)
      b.text(bottom, "Privacy  ·  Terms  ·  Accessibility", b.ty("small"), muted)
    },
  )

  // --- Components: content -------------------------------------------------------------------

  const categoryTile = b.component(
    "Category tile",
    {
      key: "CatTile",
      section: "Content",
      description: "Set the image's tone and shape through CtImg's args.",
      props: { name: p.text("CtName", "Category"), count: p.text("CtCnt", "0 items") },
      root: { dir: "column", w: 300, gap: 12 },
    },
    (root) => {
      b.use(root, productImage, {
        key: "CtImg",
        props: { w: FILL, h: 260 },
        args: { badge: false, favorite: false },
      })
      const row = b.row(root, "Text", { w: FILL, justify: "between", align: "center" })
      const t = b.col(row, "Names", { gap: 2 })
      b.text(t, "Category", b.ty("title"), ink, { key: "CtName" })
      b.text(t, "0 items", b.ty("small"), muted, { key: "CtCnt" })
      b.icon(row, "arrow-right", 18, ink)
    },
  )

  const benefit = b.component(
    "Benefit",
    {
      key: "Benefit",
      section: "Content",
      props: { title: p.text("BnTitle", "Benefit"), body: p.text("BnBody", "Detail.") },
      root: { dir: "row", w: 300, gap: 14, align: "start" },
    },
    (root) => {
      const tile = b.row(root, "Icon tile", {
        w: 40,
        h: 40,
        radius: r("pill"),
        fill: c("accent-soft"),
        align: "center",
        justify: "center",
      })
      b.icon(tile, "truck", 18, c("accent"), { key: "BnIcon" })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Benefit", b.ty("label"), ink, { key: "BnTitle" })
      b.para(t, "Detail.", b.ty("small"), muted, { key: "BnBody" })
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
      root: { dir: "column", w: 400, gap: 12, pad: 24, ...card() },
    },
    (root) => {
      b.use(root, rating, { args: { value: "5.0", showCount: false } })
      b.text(root, "Title", b.ty("title", { size: 16 }), ink, { key: "RvTitle" })
      b.para(root, "Review.", b.ty("body", { size: 14 }), c("ink-2"), { key: "RvBody" })
      const who = b.row(root, "Reviewer", { gap: 8, align: "center" })
      b.text(who, "Name", b.ty("label", { size: 13 }), ink, { key: "RvName" })
      b.text(who, "Verified buyer", b.ty("small"), muted, { key: "RvMeta" })
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
        gap: 10,
        pad: [16, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      const head = b.row(root, "Header", { w: FILL, justify: "between", align: "center" })
      b.text(head, "Section", b.ty("label", { size: 15 }), ink, { key: "AcTitle" })
      b.icon(head, "plus", 18, c("ink-2"), { key: "AcIcon" })
      b.para(root, "Details.", b.ty("body", { size: 14 }), c("ink-2"), {
        key: "AcBody",
        visible: false,
      })
    },
  )

  // --- Components: cart and checkout ---------------------------------------------------------

  const cartLine = b.component(
    "Cart line",
    {
      key: "CartLine",
      section: "Cart",
      description: "Desktop bag row. Scale the image's object for the 120×140 tile.",
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
        gap: 24,
        align: "start",
        pad: [24, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.use(root, productImage, {
        key: "ClImg",
        props: { w: 120, h: 140 },
        args: { size: "thumb" },
        set: scaled("vase", 0.55),
      })
      const info = b.col(root, "Info", { w: FILL, gap: 4 })
      b.text(info, "Product", b.ty("title", { size: 16 }), ink, { key: "ClName" })
      b.text(info, "Color", b.ty("small"), muted, { key: "ClVar" })
      b.text(info, "$0 each", b.ty("small"), muted, { key: "ClEach" })
      const stock = b.row(info, "Stock", { gap: 6, align: "center", pad: [8, 0, 0, 0] })
      b.icon(stock, "circle-check", 14, c("success"))
      b.text(stock, "In stock, ships in 1 to 2 days", b.ty("small"), c("success"))
      b.use(root, stepper, { key: "ClQty", args: { size: "sm" } })
      const right = b.col(root, "Total", { w: 110, gap: 10, align: "end" })
      b.text(right, "$0", b.ty("price", { align: "right" }), ink, { key: "ClTotal" })
      b.text(right, "Remove", b.ty("small", { weight: 500 }), muted)
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
        gap: 14,
        align: "start",
        pad: [16, 0],
        stroke: { paint: c("border"), width: { b: 1 } },
      },
    },
    (root) => {
      b.use(root, productImage, {
        key: "CmImg",
        props: { w: 88, h: 104 },
        args: { size: "thumb" },
        set: scaled("vase", 0.42),
      })
      const info = b.col(root, "Info", { w: FILL, gap: 4 })
      const top = b.row(info, "Name row", { w: FILL, gap: 8, align: "start" })
      b.para(top, "Product", b.ty("label", { size: 15 }), ink, { key: "CmName" })
      b.icon(top, "x", 16, muted)
      b.text(info, "Color", b.ty("small"), muted, { key: "CmVar" })
      const bottom = b.row(info, "Bottom", {
        w: FILL,
        justify: "between",
        align: "center",
        pad: [10, 0, 0, 0],
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
            "SrVal.style/size": 14,
          },
          total: {
            "SrLbl.fill": ink,
            "SrLbl.style/size": 17,
            "SrLbl.style/weight": 600,
            "SrVal.fill": ink,
            "SrVal.style/size": 18,
          },
          discount: {
            "SrLbl.fill": c("success"),
            "SrLbl.style/size": 14,
            "SrLbl.style/weight": 400,
            "SrVal.fill": c("success"),
            "SrVal.style/size": 14,
          },
        }),
      },
      root: { dir: "row", w: 360, justify: "between", align: "center" },
    },
    (root) => {
      b.text(root, "Label", b.ty("body", { size: 14 }), c("ink-2"), { key: "SrLbl" })
      b.text(root, "$0.00", b.ty("label", { size: 14 }), ink, { key: "SrVal" })
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
      root: { dir: "row", w: 360, gap: 14, align: "center" },
    },
    (root) => {
      b.use(root, productImage, {
        key: "SiImg",
        props: { w: 60, h: 68 },
        args: { size: "thumb", tone: "oat", shape: "mug" },
        set: scaled("mug", 0.28),
      })
      const t = b.col(root, "Text", { w: FILL, gap: 2 })
      b.text(t, "Product", b.ty("label"), ink, { key: "SiName" })
      b.text(t, "Color · Qty 1", b.ty("small"), muted, { key: "SiDet" })
      b.text(root, "$0", b.ty("label"), ink, { key: "SiPrice" })
    },
  )

  const orderSummary = b.component(
    "Order summary",
    {
      key: "OrdSum",
      section: "Cart",
      description: "Items slot for Summary items; Actions slot for promo code and buttons.",
      props: {
        title: p.text("OsTitle", "Order summary"),
        items: p.slot("OsItems"),
        subtotal: p.text("OsSub/SrVal", "$0.00"),
        shipping: p.text("OsShip/SrVal", "Free"),
        tax: p.text("OsTax/SrVal", "$0.00"),
        total: p.text("OsTotal/SrVal", "$0.00"),
        actions: p.slot("OsActs"),
      },
      root: { dir: "column", w: 420, gap: 18, pad: 28, ...card({ radius: r("xl") }) },
    },
    (root) => {
      b.text(root, "Order summary", b.ty("title"), ink, { key: "OsTitle" })
      b.col(root, "Items", { key: "OsItems", w: FILL, gap: 14, slot: { suggested: [summaryItem] } })
      const rows = b.col(root, "Rows", {
        w: FILL,
        gap: 10,
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
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      b.use(tot, summaryRow, {
        key: "OsTotal",
        props: { w: FILL },
        args: { label: "Total", kind: "total" },
      })
      b.col(root, "Actions", { key: "OsActs", w: FILL, gap: 12, slot: { suggested: [button] } })
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
    plate: ["Ridge dinner plate", "Stoneware, 10.5 in", "$32", "clay", "bowl"],
    cup: ["Moss espresso cup", "4 oz, set of 2", "$34", "sage", "mug"],
    apron: ["Linen work apron", "Washed linen, adjustable", "$54", "clay", "towel"],
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
    } = {},
  ) {
    const [name, meta, price, tone, shape] = P[key]
    const sw = opts.swatches
    const badgeArgs =
      opts.badge === "new"
        ? { badge: true, badgeLabel: "New" }
        : opts.badge === "sale"
          ? { badge: true, badgeStyle: badgeSale, badgeLabel: "Sale" }
          : opts.badge === "few"
            ? { badge: true, badgeStyle: badge, badgeLabel: "Only 4 left" }
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
          args: { tone, shape, ...badgeArgs, favorite: true },
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

  function page(name: string, active: "none" | "all" | "kitchen" | "living") {
    const scr = b.screen(desktop, name, { w: 1440, fill: c("bg") })
    b.use(scr, announcement, { args: { message: SHIP } })
    b.use(scr, header, { args: { active } })
    return scr
  }
  function sectionHead(parent: string, title: string, link?: string, sub?: string) {
    const row = b.row(parent, "Section header", { w: FILL, justify: "between", align: "end" })
    const t = b.col(row, "Titles", { gap: 6 })
    b.text(t, title, b.ty("heading"), ink, { name: "Title" })
    if (sub) b.text(t, sub, b.ty("body"), muted, { name: "Subtitle" })
    if (link) {
      const l = b.row(row, "Link", { gap: 6, align: "center" })
      b.text(l, link, b.ty("label"), ink)
      b.icon(l, "arrow-right", 16, ink)
    }
    return row
  }
  function section(parent: string, name: string, props: Record<string, unknown> = {}) {
    return b.col(parent, name, { w: FILL, gap: s(8), pad: [64, 64], ...props })
  }
  const benefits: [string, string, string][] = [
    ["truck", "Free shipping over $100", "Orders ship from Asheville in 1 to 2 business days."],
    ["rotate-ccw", "30-day returns", "Unused pieces come back free with the label in your box."],
    ["package", "Packed without plastic", "Paper wrap, cardboard and recycled pulp only."],
    ["gift", "Gift wrapping for $6", "Linen wrap and a handwritten card, added at checkout."],
  ]

  const thumbK: Record<string, number> = { mug: 0.5, throw: 0.36, candle: 0.5 }

  // --- Cover -----------------------------------------------------------------------------------

  b.cover({
    eyebrow: "eCommerce template",
    title: "Fernhill home goods store",
    description:
      "Home, category, product, cart, checkout and confirmation for desktop, plus home, product and cart on mobile. Built from 29 components with light and dark tokens.",
    preview: (area) => {
      const row = b.row(area, "Products", { w: FILL, gap: 18, align: "start" })
      productCardUse(row, "mug", {
        badge: "new",
        swatches: ["oat", "clay", "sage"],
        imgH: 230,
        w: 212,
        k: 0.75,
      })
      productCardUse(row, "vase", { imgH: 230, w: 212, k: 0.75 })
      productCardUse(row, "board", { badge: "sale", was: "$72", imgH: 230, w: 212, k: 0.75 })
      const bottom = b.row(area, "Bag", { w: FILL, gap: 20, align: "start" })
      const bag = b.col(bottom, "Bag", { w: FILL, gap: 0, pad: [0, 20], ...card() })
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
      b.use(bottom, benefit, {
        props: { w: 230 },
        args: {
          title: (benefits[0] as [string, string, string])[1],
          body: (benefits[0] as [string, string, string])[2],
        },
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
    const hero = b.row(scr, "Hero", { w: FILL, h: 600, gap: 56, pad: [48, 64], align: "stretch" })
    const left = b.col(hero, "Text", { w: 540, gap: s(6), justify: "center" })
    b.text(left, "NEW FOR THE AUTUMN TABLE", b.ty("eyebrow"), c("accent"))
    b.para(left, "Made in small batches, used every day", b.ty("display"), ink)
    b.para(
      left,
      "Stoneware, linen and beeswax from 38 makers in the Blue Ridge and beyond. Each batch is small, so when a glaze sells out it may not come back.",
      b.ty("body-lg"),
      muted,
    )
    const acts = b.row(left, "Actions", { gap: 12, align: "center" })
    b.use(acts, button, { args: { label: "Shop new arrivals", icon: true, size: "lg" } })
    b.use(acts, buttonSecondary, { args: { label: "Meet the makers", size: "lg" } })
    const art = b.row(hero, "Art", { w: FILL, h: FILL, gap: 16 })
    imageUse(art, "clay", "vase", { w: fill(3), h: FILL }, { k: 1.6, badge: "New" })
    const stack = b.col(art, "Stack", { w: fill(2), h: FILL, gap: 16 })
    imageUse(stack, "sage", "mug", { w: FILL, h: FILL }, { k: 0.9 })
    imageUse(stack, "oat", "candle", { w: FILL, h: FILL }, { k: 0.8 })

    const rooms = section(scr, "Shop by room", { pad: [40, 64, 64, 64] })
    sectionHead(rooms, "Shop by room", "All categories")
    const tiles = b.row(rooms, "Tiles", { w: FILL, gap: s(6) })
    for (const [name, count, tone, shape] of [
      ["Kitchen and dining", "142 items", "clay", "bowl"],
      ["Living", "86 items", "sage", "pillow"],
      ["Bedroom", "54 items", "oat", "throw"],
      ["Bath", "38 items", "slate", "towel"],
    ] as const)
      b.use(tiles, categoryTile, {
        props: { w: 310 },
        args: { name, count },
        set: { CtImg: { args: { tone, shape, badge: false, favorite: false } } },
      })

    const fresh = section(scr, "New this week", { fill: c("surface") })
    sectionHead(
      fresh,
      "New this week",
      "Shop all new",
      "14 pieces from 6 makers arrived on Monday.",
    )
    const grid = b.row(fresh, "Products", { w: FILL, gap: s(6), align: "start" })
    productCardUse(grid, "mug", { badge: "new", swatches: ["oat", "clay", "sage"], w: 310 })
    productCardUse(grid, "throw", { badge: "new", swatches: ["sage", "oat", "char"], w: 310 })
    productCardUse(grid, "vase", { badge: "few", w: 310 })
    productCardUse(grid, "board", { badge: "sale", was: "$72", w: 310 })

    const story = b.row(scr, "Makers", { w: FILL, gap: 72, pad: [80, 64], align: "center" })
    imageUse(story, "char", "bowl", { w: 620, h: 440 }, { k: 1.6 })
    const st = b.col(story, "Text", { w: FILL, gap: s(5) })
    b.text(st, "OUR MAKERS", b.ty("eyebrow"), c("accent"))
    b.para(st, "Every piece comes from a studio we have visited", b.ty("h1"), ink)
    b.para(
      st,
      "Lena Ortiz throws the Ridge mugs two hours up the road in Burnsville. The Halden throws are woven in a family mill in Lithuania and washed here before they ship. We pay makers within 14 days of each order.",
      b.ty("body-lg"),
      muted,
    )
    const nums = b.row(st, "Numbers", { w: FILL, gap: s(8), pad: [8, 0] })
    for (const [v, l] of [
      ["38", "Makers we buy from"],
      ["11", "Within 100 miles"],
      ["2014", "Shop opened"],
    ] as const) {
      const n = b.col(nums, l, { w: FILL, gap: 2 })
      b.text(n, v, b.ty("heading", { size: 32, weight: 700 }), ink)
      b.text(n, l, b.ty("small"), muted)
    }
    b.use(st, buttonSecondary, { args: { label: "Read their stories", icon: true } })

    const perks = b.row(scr, "Benefits", {
      w: FILL,
      gap: s(8),
      pad: [40, 64],
      stroke: { paint: c("border"), width: { t: 1, b: 1 } },
    })
    for (const [icon, title, body] of benefits)
      b.use(perks, benefit, { props: { w: 304 }, args: { title, body }, set: { BnIcon: { icon } } })

    const voices = section(scr, "Reviews")
    sectionHead(voices, "What customers write back", undefined, "4.9 average from 3,180 reviews")
    const rv = b.row(voices, "Cards", { w: FILL, gap: 26, align: "stretch" })
    for (const [title, body, name, meta] of [
      [
        "Heavier than it looks, in a good way",
        "The Ridge mug holds heat through a whole slow morning. The oat glaze has small speckles that make each one a little different.",
        "Priya S.",
        "Ridge stoneware mug",
      ],
      [
        "Softer after every wash",
        "I was worried the linen throw would be scratchy. After two washes it drapes over the couch like it has always been there.",
        "Marcus D.",
        "Halden linen throw",
      ],
      [
        "Packed with real care",
        "Four plates arrived in paper and pulp with a handwritten note. Not one chip, and no plastic to throw away.",
        "Hannah K.",
        "Ridge dinner plate",
      ],
    ] as const)
      b.use(rv, review, { props: { w: 420 }, args: { title, body, name, meta } })

    const news = b.col(scr, "Newsletter", { w: FILL, pad: [0, 64, 80, 64] })
    const band = b.row(news, "Band", {
      w: FILL,
      gap: 48,
      align: "center",
      pad: [48, 56],
      radius: r("xl"),
      fill: c("inverse"),
    })
    const nt = b.col(band, "Text", { w: FILL, gap: 10 })
    b.para(nt, "Get first pick of small-batch drops", b.ty("heading"), c("on-inverse"))
    b.para(
      nt,
      "One email a month when new glazes land. Subscribers see each drop a day before it goes live.",
      b.ty("body"),
      c("inverse-muted"),
    )
    const form = b.row(band, "Form", { w: 480, gap: 10, align: "center" })
    b.use(form, input, {
      props: { w: FILL },
      args: { label: "Email", showLabel: false, value: "you@example.com", state: "empty" },
    })
    b.use(form, button, { args: { label: "Subscribe", variant: "inverse", size: "lg" } })
    b.use(scr, footer)
  }

  // --- Desktop: Category -----------------------------------------------------------------------
  {
    const scr = page("Category", "kitchen")
    const head = b.col(scr, "Header", { w: FILL, gap: s(4), pad: [24, 64, 8, 64] })
    b.use(head, breadcrumb, {
      args: { first: "Home", second: "Shop all", current: "Kitchen and dining" },
    })
    const tr = b.row(head, "Title row", { w: FILL, justify: "between", align: "end" })
    const tt = b.col(tr, "Titles", { gap: 6 })
    b.text(tt, "Kitchen and dining", b.ty("h1"), ink)
    b.text(tt, "142 pieces for cooking, serving and the table", b.ty("body"), muted)
    const sort = b.row(tr, "Sort", { gap: 10, align: "center" })
    b.text(sort, "Sort by", b.ty("small"), muted)
    b.use(sort, buttonSecondary, {
      args: { label: "Newest", icon: true },
      set: { BtnIcon: { icon: "chevron-down" } },
    })

    const body = b.row(scr, "Body", { w: FILL, gap: 48, pad: [32, 64, 80, 64], align: "start" })
    const filters = b.col(body, "Filters", { w: 260, gap: 0 })
    const fhead = b.row(filters, "Filters header", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [0, 0, 16, 0],
    })
    b.icon(fhead, "sliders-horizontal", 16, ink)
    b.text(fhead, "Filters", b.ty("label", { size: 15 }), ink)
    const group = (title: string, fn: (into: string) => void) => {
      const g = b.col(filters, title, {
        w: FILL,
        gap: 12,
        pad: [18, 0],
        stroke: { paint: c("border"), width: { t: 1 } },
      })
      const h = b.row(g, "Group header", { w: FILL, justify: "between", align: "center" })
      b.text(h, title, b.ty("label"), ink)
      b.icon(h, "chevron-up", 16, muted)
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
        ["Mugs and cups", "24", false],
        ["Bowls", "22", false],
        ["Plates", "16", false],
        ["Serving", "18", false],
        ["Table linen", "31", false],
        ["Glassware", "14", false],
      ]),
    )
    group("Material", (g) =>
      boxes(g, [
        ["Stoneware", "58", true],
        ["Porcelain", "12", false],
        ["Glass", "14", false],
        ["Wood", "17", false],
        ["Linen", "31", false],
      ]),
    )
    group("Color", (g) => {
      const row = b.row(g, "Swatches", { w: FILL, gap: 8, wrap: true, crossGap: 8 })
      for (const [i, t] of (["oat", "clay", "sage", "slate", "rose", "char"] as Tone[]).entries())
        b.use(row, swatch, { args: { tone: t, selected: i === 0 ? "yes" : "no" } })
    })
    group("Price", (g) =>
      boxes(g, [
        ["Under $25", "19", false],
        ["$25 to $50", "52", true],
        ["$50 to $100", "28", false],
        ["Over $100", "9", false],
      ]),
    )

    const main = b.col(body, "Results", { w: FILL, gap: s(8) })
    const chips = b.row(main, "Active filters", { w: FILL, gap: 8, align: "center" })
    b.text(chips, "42 results", b.ty("label"), ink)
    for (const label of ["Stoneware", "$25 to $50", "Oat"]) {
      const chip = b.row(chips, label, {
        gap: 6,
        align: "center",
        pad: [6, 10, 6, 12],
        radius: r("pill"),
        fill: c("subtle"),
      })
      b.text(chip, label, b.ty("small", { weight: 500 }), c("ink-2"))
      b.icon(chip, "x", 14, c("ink-2"))
    }
    b.text(chips, "Clear all", b.ty("small", { weight: 600 }), c("accent"))
    const rows: [PKey, Parameters<typeof productCardUse>[2]][][] = [
      [
        ["mug", { badge: "new", swatches: ["oat", "clay", "sage"] }],
        ["bowl", {}],
        ["plate", { swatches: ["clay", "oat", "char"] }],
      ],
      [
        ["cup", { badge: "new" }],
        ["board", { badge: "sale", was: "$72" }],
        ["carafe", { badge: "few" }],
      ],
      [
        ["napkins", { swatches: ["sage", "oat", "clay"] }],
        ["apron", {}],
        ["vase", {}],
      ],
    ]
    for (const [i, list] of rows.entries()) {
      const row = b.row(main, `Row ${i + 1}`, { w: FILL, gap: 22, align: "start" })
      for (const [k, o] of list) productCardUse(row, k, { ...o, imgH: 320, w: 320 })
    }
    const more = b.col(main, "Load more", { w: FILL, gap: 14, align: "center", pad: [16, 0, 0, 0] })
    b.text(more, "Showing 9 of 42", b.ty("small"), muted)
    b.use(more, buttonSecondary, { args: { label: "Load 12 more" } })
    b.use(scr, footer)
  }

  // --- Desktop: Product ------------------------------------------------------------------------
  {
    const scr = page("Product detail", "kitchen")
    const crumbs = b.row(scr, "Breadcrumb", { w: FILL, pad: [24, 64, 0, 64] })
    b.use(crumbs, breadcrumb, {
      args: {
        first: "Kitchen and dining",
        second: "Mugs and cups",
        current: "Ridge stoneware mug",
      },
    })
    const main = b.row(scr, "Product", { w: FILL, gap: 64, pad: [24, 64, 72, 64], align: "start" })
    const gallery = b.col(main, "Gallery", { w: 740, gap: 16 })
    imageUse(gallery, "oat", "mug", { w: FILL, h: 620 }, { k: 2.2, badge: "New", fav: true })
    const thumbs = b.row(gallery, "Thumbnails", { w: FILL, gap: 16 })
    for (const [i, [tone, shape, k]] of (
      [
        ["oat", "mug", 0.7],
        ["oat", "bowl", 0.5],
        ["clay", "mug", 0.7],
        ["sage", "mug", 0.7],
      ] as const
    ).entries())
      imageUse(
        thumbs,
        tone,
        shape,
        {
          w: FILL,
          h: 150,
          ...(i === 0 ? { stroke: { paint: c("ink"), width: 2 } } : {}),
        },
        { k, thumb: true },
      )

    const info = b.col(main, "Details", { w: FILL, gap: s(6) })
    const top = b.col(info, "Title", { w: FILL, gap: 10 })
    b.text(top, "LENA ORTIZ POTTERY, BURNSVILLE NC", b.ty("eyebrow"), muted)
    b.text(top, "Ridge stoneware mug", b.ty("h1"), ink)
    b.use(top, rating, { args: { value: "4.9", count: "(212 reviews)" } })
    b.text(info, "$28", b.ty("heading"), ink, { name: "Price" })
    b.para(
      info,
      "A 12 oz mug with a ridged foot and a wide handle that fits three fingers. Wheel-thrown in small batches and fired to cone 6, so it is safe in the dishwasher and microwave.",
      b.ty("body-lg"),
      c("ink-2"),
    )
    const color = b.col(info, "Color", { w: FILL, gap: 12 })
    const cl = b.row(color, "Label", { gap: 6 })
    b.text(cl, "Color:", b.ty("label"), ink)
    b.text(cl, "Oat", b.ty("body", { size: 14 }), c("ink-2"))
    const sw = b.row(color, "Swatches", { gap: 10 })
    for (const [i, t] of (["oat", "clay", "sage", "char"] as Tone[]).entries())
      b.use(sw, swatch, { args: { tone: t, selected: i === 0 ? "yes" : "no" } })
    const buy = b.row(info, "Buy", { w: FILL, gap: 12, align: "center" })
    b.use(buy, stepper, { args: { value: "2" } })
    b.use(buy, button, { props: { w: FILL }, args: { label: "Add to bag  ·  $56", size: "lg" } })
    const save = b.row(buy, "Save", {
      w: 52,
      h: 52,
      align: "center",
      justify: "center",
      radius: r("pill"),
      stroke: { paint: c("border") },
    })
    b.use(save, iconButton, { set: { IbIcon: { icon: "heart" } } })
    const ship = b.col(info, "Shipping", {
      w: FILL,
      gap: 12,
      pad: 18,
      radius: r("lg"),
      fill: c("subtle"),
    })
    for (const [icon, t] of [
      ["truck", "Free shipping on this order. Arrives Oct 13 to Oct 15."],
      ["store", "Pick up today at 412 Haywood Road, Asheville."],
      ["rotate-ccw", "Free returns within 30 days."],
    ] as const) {
      const row = b.row(ship, icon, { w: FILL, gap: 10, align: "center" })
      b.icon(row, icon, 16, c("ink-2"))
      b.text(row, t, b.ty("body", { size: 14 }), c("ink-2"))
    }
    const acc = b.col(info, "Accordion", { w: FILL })
    for (const [title, body, open] of [
      [
        "Details",
        "12 oz (355 ml). 4 in tall, 3.4 in across. Speckled stoneware with a satin oat glaze. Each mug varies slightly in color and size.",
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

    const rv = section(scr, "Reviews", { fill: c("surface") })
    const rvRow = b.row(rv, "Reviews body", { w: FILL, gap: 64, align: "start" })
    const sum = b.col(rvRow, "Summary", { w: 320, gap: 16 })
    b.text(sum, "Reviews", b.ty("heading"), ink)
    const big = b.row(sum, "Average", { gap: 12, align: "end" })
    b.text(big, "4.9", b.ty("display", { size: 52 }), ink)
    b.text(big, "out of 5, 212 reviews", b.ty("small"), muted, { name: "Out of" })
    for (const [stars, n] of [
      ["5", 186],
      ["4", 19],
      ["3", 5],
      ["2", 2],
      ["1", 0],
    ] as const) {
      const row = b.row(sum, `${stars} stars`, { w: FILL, gap: 10, align: "center" })
      b.text(row, stars, b.ty("small", { weight: 600 }), ink, { w: 10, grow: "fixed-width" })
      b.icon(row, "star", 12, c("star"))
      const bar = b.row(row, "Bar", {
        w: FILL,
        h: 6,
        radius: r("pill"),
        fill: c("subtle"),
        clip: true,
      })
      if (n > 0) b.rect(bar, "Done", { w: fill(n), h: 6, fill: c("star") })
      b.rect(bar, "Left", { w: fill(212 - n), h: 6, fill: c("subtle") })
      b.text(row, String(n), b.ty("small", { align: "right" }), muted, {
        w: 28,
        grow: "fixed-width",
      })
    }
    b.use(sum, buttonSecondary, { props: { w: FILL }, args: { label: "Write a review" } })
    const cards = b.col(rvRow, "Cards", { w: FILL, gap: 16 })
    for (const [title, body, name, meta] of [
      [
        "Heavier than it looks, in a good way",
        "Holds heat through a whole slow morning. The oat glaze has small speckles that make each one a little different. I ordered two more for my sister.",
        "Priya S.",
        "Verified buyer · Sep 28, 2026",
      ],
      [
        "The handle is the best part",
        "Wide enough for three fingers, which my old mugs never were. Mine came with a tiny glaze drip on the foot that I have grown to like.",
        "Tom R.",
        "Verified buyer · Sep 12, 2026",
      ],
    ] as const)
      b.use(cards, review, { props: { w: FILL }, args: { title, body, name, meta } })

    const pairs = section(scr, "Pairs well with")
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
    const wrap = b.col(scr, "Bag", { w: FILL, gap: s(8), pad: [48, 64, 72, 64] })
    const head = b.row(wrap, "Title", { w: FILL, gap: 12, align: "end" })
    b.text(head, "Your bag", b.ty("h1"), ink)
    b.text(head, "3 items", b.ty("body"), muted, { name: "Count" })
    const body = b.row(wrap, "Body", { w: FILL, gap: 56, align: "start" })
    const lines = b.col(body, "Lines", { w: FILL, gap: 0 })
    const note = b.row(lines, "Free shipping", {
      w: FILL,
      gap: 10,
      align: "center",
      pad: [14, 16],
      radius: r("md"),
      fill: c("success-soft"),
    })
    b.icon(note, "truck", 16, c("success"))
    b.text(
      note,
      "Your order ships free. Arrives Oct 13 to Oct 15.",
      b.ty("body", { size: 14 }),
      c("success"),
    )
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
    const gift = b.row(lines, "Gift", { w: FILL, gap: 12, align: "center", pad: [24, 0] })
    b.use(gift, checkbox, {
      props: { w: FILL },
      args: { label: "Add gift wrapping and a handwritten card ($6)", count: "" },
      hide: ["CbCnt"],
    })
    b.use(gift, button, {
      args: { label: "Continue shopping", variant: "ghost", icon: true },
      set: { BtnIcon: { icon: "arrow-right" } },
    })
    b.use(body, orderSummary, {
      args: { ...totals },
      hide: ["OsItems"],
      slots: {
        OsActs: (into) => {
          const promo = b.row(into, "Promo", { w: FILL, gap: 8, align: "end" })
          b.use(promo, input, {
            props: { w: FILL },
            args: { label: "Promo code", value: "Enter code", state: "empty" },
          })
          b.use(promo, buttonSecondary, { props: { h: 46 }, args: { label: "Apply" } })
          b.use(into, button, {
            props: { w: FILL },
            args: { label: "Check out", size: "lg", icon: true },
            set: { BtnIcon: { icon: "lock" } },
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

    const recent = section(scr, "Recently viewed", { fill: c("surface") })
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
      pad: [20, 64],
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    brand(top)
    b.use(top, steps, { args: { active: "checkout" } })
    const secure = b.row(top, "Secure", { gap: 6, align: "center" })
    b.icon(secure, "lock", 14, muted)
    b.text(secure, "Secure checkout", b.ty("small", { weight: 500 }), muted)

    const body = b.row(scr, "Body", { w: FILL, gap: 64, pad: [40, 64, 80, 64], align: "start" })
    const form = b.col(body, "Form", { w: FILL, gap: s(10) })
    const block = (n: string, title: string, right?: string) => {
      const sec = b.col(form, title, { w: FILL, gap: 16 })
      const h = b.row(sec, "Header", { w: FILL, gap: 10, align: "center" })
      const num = b.row(h, "Number", {
        w: 26,
        h: 26,
        radius: r("pill"),
        fill: c("inverse"),
        align: "center",
        justify: "center",
      })
      b.text(num, n, b.ty("small", { weight: 700 }), c("on-inverse"))
      b.text(h, title, b.ty("title"), ink, { w: FILL, grow: "fixed-width" })
      if (right) b.text(h, right, b.ty("small", { weight: 600 }), c("accent"))
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
    const contact = block("1", "Contact", "Sign in")
    field(contact, "Email", "nora.whitfield@fastmail.com")
    b.use(contact, checkbox, {
      props: { w: FILL },
      args: { label: "Email me when new batches arrive", checked: "yes" },
      hide: ["CbCnt"],
    })
    const ship = block("2", "Delivery address")
    const r1 = b.row(ship, "Name", { w: FILL, gap: 16 })
    field(r1, "First name", "Nora")
    field(r1, "Last name", "Whitfield")
    field(ship, "Address", "214 Montford Avenue")
    field(ship, "Apartment, suite (optional)", "Apt 3", FILL)
    const r2 = b.row(ship, "City", { w: FILL, gap: 16 })
    field(r2, "City", "Asheville")
    field(r2, "State", "North Carolina")
    field(r2, "ZIP code", "28801", 160)
    const method = block("3", "Shipping method")
    for (const [title, detail, price, on] of [
      ["Standard", "Arrives Oct 13 to Oct 15", "Free", true],
      ["Express", "Arrives Oct 9", "$18.00", false],
      ["Pick up at the shop", "412 Haywood Road, ready in 2 hours", "Free", false],
    ] as const)
      b.use(method, radio, {
        props: { w: FILL },
        args: { title, detail, price, selected: on ? "yes" : "no" },
      })
    const pay = block("4", "Payment")
    const card1 = b.col(pay, "Card", {
      w: FILL,
      gap: 16,
      pad: 20,
      radius: r("lg"),
      fill: c("surface"),
      stroke: { paint: c("border") },
    })
    const ch = b.row(card1, "Header", { w: FILL, gap: 10, align: "center" })
    b.icon(ch, "credit-card", 18, ink)
    b.text(ch, "Credit or debit card", b.ty("label"), ink, { w: FILL, grow: "fixed-width" })
    b.text(ch, "Visa  ·  Mastercard  ·  Amex", b.ty("small"), muted)
    field(card1, "Card number", "4242 4242 4242 4242")
    const r3 = b.row(card1, "Row", { w: FILL, gap: 16 })
    field(r3, "Expiry", "08 / 28")
    field(r3, "Security code", "CVC", FILL, true)
    b.use(pay, checkbox, {
      props: { w: FILL },
      args: { label: "Billing address is the same as delivery", checked: "yes" },
      hide: ["CbCnt"],
    })

    const side = b.col(body, "Summary", { w: 440, gap: 16 })
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
    const help = b.row(side, "Help", { w: FILL, gap: 10, align: "center", pad: [0, 8] })
    b.icon(help, "mail", 16, muted)
    b.para(
      help,
      "Questions? Write to hello@fernhill.shop or call (828) 555-0142.",
      b.ty("small"),
      muted,
    )
  }

  // --- Desktop: Order confirmation ---------------------------------------------------------------
  {
    const scr = page("Order confirmation", "none")
    const wrap = b.col(scr, "Confirmation", {
      w: FILL,
      gap: s(8),
      align: "center",
      pad: [56, 64, 80, 64],
    })
    b.use(wrap, steps, { args: { active: "done" } })
    const head = b.col(wrap, "Header", { w: 760, gap: 14, align: "center" })
    const tick = b.row(head, "Icon", {
      w: 56,
      h: 56,
      radius: r("pill"),
      fill: c("success-soft"),
      align: "center",
      justify: "center",
    })
    b.icon(tick, "check", 28, c("success"))
    b.text(head, "Thanks, Nora. Your order is confirmed.", b.ty("h1", { align: "center" }), ink)
    b.para(
      head,
      "Order FH-20418 was placed on October 6, 2026. A receipt is on its way to nora.whitfield@fastmail.com, and we will email tracking when it ships.",
      b.ty("body-lg", { align: "center" }),
      muted,
    )
    const panel = b.col(wrap, "Order", { w: 760, gap: 0, ...card({ radius: r("xl") }), clip: true })
    const info = b.row(panel, "Info", {
      w: FILL,
      gap: 24,
      pad: 28,
      fill: c("subtle"),
      stroke: { paint: c("border"), width: { b: 1 } },
    })
    for (const [icon, title, lines] of [
      ["calendar", "Arrives", ["Tuesday, Oct 13 to", "Thursday, Oct 15"]],
      ["map-pin", "Ship to", ["Nora Whitfield", "214 Montford Ave, Apt 3", "Asheville, NC 28801"]],
      ["credit-card", "Paid with", ["Visa ending in 4242", "$241.82"]],
    ] as const) {
      const col = b.col(info, title, { w: FILL, gap: 6 })
      const h = b.row(col, "Header", { gap: 6, align: "center" })
      b.icon(h, icon, 14, muted)
      b.text(h, title, b.ty("small", { weight: 600 }), muted)
      for (const l of lines) b.text(col, l, b.ty("body", { size: 14 }), ink)
    }
    const items = b.col(panel, "Items", { w: FILL, gap: 16, pad: [24, 28] })
    summaryItems(items)
    const tot = b.col(panel, "Totals", {
      w: FILL,
      gap: 10,
      pad: [20, 28, 24, 28],
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    for (const [label, value, kind] of [
      ["Subtotal", totals.subtotal, "line"],
      ["Shipping", "Free", "line"],
      ["Tax", totals.tax, "line"],
      ["Total", totals.total, "total"],
    ] as const)
      b.use(tot, summaryRow, { props: { w: FILL }, args: { label, value, kind } })
    const acts = b.row(wrap, "Actions", { gap: 12 })
    b.use(acts, button, { args: { label: "Track your order", size: "lg" } })
    b.use(acts, buttonSecondary, { args: { label: "Continue shopping", size: "lg" } })
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
    const hero = b.col(scr, "Hero", { w: FILL, gap: 14, pad: [16, 16, 8, 16] })
    imageUse(hero, "clay", "vase", { w: FILL, h: 210 }, { k: 0.95, badge: "New" })
    b.text(hero, "NEW FOR THE AUTUMN TABLE", b.ty("eyebrow", { size: 11 }), c("accent"))
    b.para(hero, "Made in small batches, used every day", b.ty("h1", { size: 30 }), ink)
    b.use(hero, button, { props: { w: FILL }, args: { label: "Shop new arrivals", icon: true } })
    const fresh = b.col(scr, "New this week", { w: FILL, gap: 12, pad: [16, 16, 0, 16] })
    const fh = b.row(fresh, "Header", { w: FILL, justify: "between", align: "center" })
    b.text(fh, "New this week", b.ty("title"), ink)
    b.text(fh, "See all", b.ty("label", { size: 13 }), c("accent"))
    const row = b.row(fresh, "Products", { w: FILL, gap: 12, align: "start" })
    for (const k of ["mug", "throw"] as const)
      productCardUse(row, k, { badge: "new", imgH: 170, w: 173, k: 0.55 })
  }
  {
    const scr = mscreen("Product detail")
    b.use(scr, mobileHeader, { props: { w: FILL } })
    const content = b.col(scr, "Content", { w: FILL, h: FILL, gap: 14, pad: [0, 0, 16, 0] })
    imageUse(
      content,
      "oat",
      "mug",
      { w: FILL, h: 360, radius: 0 },
      { k: 1.3, badge: "New", fav: true },
    )
    const dots = b.row(content, "Dots", { w: FILL, gap: 6, justify: "center" })
    for (let i = 0; i < 4; i++)
      b.ellipse(dots, "Dot", { w: 6, h: 6, fill: i === 0 ? ink : c("border") })
    const info = b.col(content, "Info", { w: FILL, gap: 10, pad: [0, 16] })
    b.text(info, "LENA ORTIZ POTTERY", b.ty("eyebrow", { size: 11 }), muted)
    const tr = b.row(info, "Title", { w: FILL, justify: "between", align: "center" })
    b.text(tr, "Ridge stoneware mug", b.ty("heading", { size: 24 }), ink)
    b.text(tr, "$28", b.ty("title", { size: 20 }), ink)
    b.use(info, rating, { args: { value: "4.9", count: "(212)" } })
    b.para(
      info,
      "12 oz, wheel-thrown in Burnsville, NC. Dishwasher and microwave safe.",
      b.ty("body", { size: 14 }),
      c("ink-2"),
    )
    const cl = b.row(info, "Color", { w: FILL, gap: 10, align: "center", pad: [4, 0, 0, 0] })
    b.text(cl, "Oat", b.ty("label"), ink, { w: FILL, grow: "fixed-width" })
    for (const [i, t] of (["oat", "clay", "sage", "char"] as Tone[]).entries())
      b.use(cl, swatch, { args: { tone: t, selected: i === 0 ? "yes" : "no" } })
    const shipM = b.row(info, "Shipping", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [10, 12],
      radius: r("md"),
      fill: c("subtle"),
    })
    b.icon(shipM, "truck", 14, c("ink-2"))
    b.text(shipM, "Free shipping. Arrives Oct 13 to Oct 15.", b.ty("small"), c("ink-2"))
    const accM = b.col(info, "Accordion", { w: FILL })
    b.use(accM, accordion, { props: { w: FILL }, args: { title: "Details and care" } })
    const bar = b.row(scr, "Buy bar", {
      w: FILL,
      gap: 10,
      align: "center",
      pad: [12, 16, 28, 16],
      fill: c("surface"),
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.use(bar, stepper, { args: { value: "1" } })
    b.use(bar, button, { props: { w: FILL, h: 48 }, args: { label: "Add to bag  ·  $28" } })
  }
  {
    const scr = mscreen("Cart")
    b.use(scr, mobileHeader, { props: { w: FILL } })
    const content = b.col(scr, "Content", { w: FILL, h: FILL, gap: 12, pad: [20, 16, 0, 16] })
    const head = b.row(content, "Title", { w: FILL, gap: 8, align: "end" })
    b.text(head, "Your bag", b.ty("heading", { size: 26 }), ink)
    b.text(head, "3 items", b.ty("small"), muted)
    const note = b.row(content, "Free shipping", {
      w: FILL,
      gap: 8,
      align: "center",
      pad: [10, 12],
      radius: r("md"),
      fill: c("success-soft"),
    })
    b.icon(note, "truck", 14, c("success"))
    b.text(note, "Your order ships free.", b.ty("small"), c("success"))
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
    const rows = b.col(content, "Totals", { w: FILL, gap: 8, pad: [4, 0, 0, 0] })
    for (const [label, value, kind] of [
      ["Subtotal", totals.subtotal, "line"],
      ["Shipping", "Free", "line"],
      ["Estimated tax", totals.tax, "line"],
    ] as const)
      b.use(rows, summaryRow, { props: { w: FILL }, args: { label, value, kind } })
    const bar = b.col(scr, "Checkout bar", {
      w: FILL,
      gap: 12,
      pad: [14, 16, 28, 16],
      fill: c("surface"),
      stroke: { paint: c("border"), width: { t: 1 } },
    })
    b.use(bar, summaryRow, {
      props: { w: FILL },
      args: { label: "Total", value: totals.total, kind: "total" },
    })
    b.use(bar, button, {
      props: { w: FILL },
      args: { label: "Check out", size: "lg", icon: true },
      set: { BtnIcon: { icon: "lock" } },
    })
  }
}
