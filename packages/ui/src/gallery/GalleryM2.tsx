import { Heart, PenTool, Plus, Sparkles, Star } from "lucide-react"
import { type ReactNode, useState } from "react"
import { AlignmentGrid, type GridAlign, type GridJustify } from "../alignment-grid/AlignmentGrid"
import { BlendModeMenu, type LayerBlendMode } from "../blend-mode-menu/BlendModeMenu"
import { ColorArea } from "../color-area/ColorArea"
import { ColorPicker, type ColorVariableGroup } from "../color-picker/ColorPicker"
import { DirectionControl } from "../direction-control/DirectionControl"
import { type EffectKind, EffectRow } from "../effect-row/EffectRow"
import { FillRow } from "../fill-row/FillRow"
import { GradientEditor, type GradientKind } from "../gradient-editor/GradientEditor"
import { type GradientStop, GradientStopBar } from "../gradient-stop-bar/GradientStopBar"
import { IconPicker } from "../icon-picker/IconPicker"
import { IconTile } from "../icon-tile/IconTile"
import { type ImageFillMode, ImageFillPopover } from "../image-fill-popover/ImageFillPopover"
import { MenuDense, MenuDivider, MenuItemDense } from "../menu-dense/MenuDense"
import { Popover } from "../popover/Popover"
import { PropSection } from "../prop-section/PropSection"
import { SizeField, type SizeMode } from "../size-field/SizeField"
import { AlphaSlider, HueSlider, Slider } from "../slider/Slider"
import { type StrokeSide, StrokeSideFields } from "../stroke-side-fields/StrokeSideFields"
import { SwatchTile } from "../swatch-tile/SwatchTile"
import { TooltipHint } from "../tooltip-hint/TooltipHint"
import { ZoomBadge } from "../zoom-badge/ZoomBadge"
import { DEMO_RECENT, demoIconProvider } from "./demo-icons"

/** Column of board 02b: vertical, gap 12; Caption mono 11 text-tertiary first. */
function Column({
  caption,
  width,
  pen,
  children,
}: {
  caption: string
  width?: number
  pen?: string
  children: ReactNode
}) {
  return (
    <div className="kimo-gallery__m2-column" style={width ? { width } : undefined} data-pen={pen}>
      <span className="kimo-gallery__caption">{caption}</span>
      {children}
    </div>
  )
}

/** Section of board 02b (aIIPP): Section Header (gap 12, align end) with a note. */
function Section({
  title,
  note,
  pen,
  children,
}: {
  title: string
  note?: string
  pen?: string
  children: ReactNode
}) {
  return (
    <section className="kimo-gallery__section" data-pen={pen}>
      <div className="kimo-gallery__section-header kimo-gallery__section-header--note">
        <h2 className="kimo-gallery__section-title">{title}</h2>
        {note && <span className="kimo-gallery__section-note">{note}</span>}
      </div>
      {children}
    </section>
  )
}

const Items = ({ children, pen }: { children: ReactNode; pen?: string }) => (
  <div className="kimo-gallery__items" data-pen={pen}>
    {children}
  </div>
)

const DOC_COLORS = [
  "#F4A261",
  "#E76F51",
  "#6D2E46",
  "#FFF7EE",
  "#2B2118",
  "#0A0A0A",
  "#FFFFFF",
  "#C9B8A6",
]

const VARIABLES: ColorVariableGroup[] = [
  {
    name: "brand",
    variables: [
      {
        id: "brand/primary",
        name: "primary",
        color: "#E76F51",
        modeColors: ["#E76F51", "#F08A6E"],
      },
      { id: "brand/sand", name: "sand", color: "#F4A261", modeColors: ["#F4A261", "#F7B97F"] },
      { id: "brand/plum", name: "plum", color: "#6D2E46", modeColors: ["#6D2E46", "#9A4F6B"] },
    ],
  },
  {
    name: "surface",
    variables: [
      { id: "surface/page", name: "page", color: "#FFF7EE", modeColors: ["#FFF7EE", "#1B1611"] },
      { id: "surface/card", name: "card", color: "#FFFFFF", modeColors: ["#FFFFFF", "#241D17"] },
    ],
  },
  {
    name: "text",
    variables: [
      { id: "text/default", name: "default", color: "#2B2118", modeColors: ["#2B2118", "#F5EDE4"] },
      { id: "text/muted", name: "muted", color: "#7A6A5C", modeColors: ["#7A6A5C", "#B3A394"] },
    ],
  },
]

/** A 2400 × 1600 placeholder image (no network in the gallery). */
const DEMO_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600" viewBox="0 0 24 16"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4A261"/><stop offset=".55" stop-color="#E76F51"/><stop offset="1" stop-color="#6D2E46"/></linearGradient></defs><rect width="24" height="16" fill="url(#g)"/><circle cx="17" cy="5" r="2.5" fill="#FFF7EE" opacity=".8"/></svg>',
)}`

/**
 * Board "02b Components — Styling (M2)" (mj1CX) and the composite popovers of board
 * "09 Popovers (M2)" (h3BVP0). Every design instance carries `data-pen` for the measured pass
 * (`scripts/measure-gallery.ts`).
 */
export function GalleryM2({ theme }: { theme?: "light" | "dark" }) {
  const [slider, setSlider] = useState(127 / 210)
  const [hsva, setHsva] = useState({ h: 24, s: 143 / 224, v: 1 - 19 / 160, a: 196 / 210 })
  const [stops, setStops] = useState<GradientStop[]>([
    { color: "#F4A261", at: 0 },
    { color: "#E76F51", at: 0.55 },
    { color: "#6D2E46", at: 1 },
  ])
  const [stop, setStop] = useState(1)
  const [kind, setKind] = useState<GradientKind>("linear")
  const [dir, setDir] = useState<"row" | "column">("row")
  const [grid, setGrid] = useState<{ justify: GridJustify; align: GridAlign }>({
    justify: "start",
    align: "start",
  })
  const [sizeW, setSizeW] = useState<{ value: string; mode: SizeMode }>({
    value: "640",
    mode: "fill",
  })
  const [sides, setSides] = useState<Record<StrokeSide, number>>({ t: 1, r: 0, b: 1, l: 0 })
  const [fillVisible, setFillVisible] = useState(false)
  const [effect, setEffect] = useState<{ kind: EffectKind; visible: boolean; open: boolean }>({
    kind: "drop-shadow",
    visible: true,
    open: false,
  })
  const [blend, setBlend] = useState<LayerBlendMode>("multiply")
  const [color, setColor] = useState("#F4A261")
  const [bound, setBound] = useState("brand/sand")
  const [icon, setIcon] = useState({ set: "lucide", name: "star" })
  const [weight, setWeight] = useState(400)
  const [image, setImage] = useState<{ mode: ImageFillMode; opacity: number }>({
    mode: "cover",
    opacity: 1,
  })
  const [log, setLog] = useState("")

  return (
    <div className="kimo-gallery kimo-gallery--m2" data-theme={theme} data-pen="mj1CX">
      <header className="kimo-gallery__header" data-pen="zJ2cn">
        <p className="kimo-gallery__eyebrow">KIMO DESIGN SYSTEM · M2</p>
        <h1 className="kimo-gallery__title">Components — Styling</h1>
        <p className="kimo-gallery__intro">
          M2 styling, layout and canvas-overlay primitives. Canvas-only pieces (measure pills, snap
          markers, path anchors, size badges) are drawn by @kimo/renderer.
        </p>
      </header>

      <Section
        title="Styling (M2)"
        note="Fill · stroke · effects · color · icons — built on PropField 28h density"
        pen="aIIPP"
      >
        <Items pen="mzW6m">
          <Column caption="Slider" width={224} pen="n6fus">
            <Slider aria-label="Slider" value={slider} onChange={setSlider} data-pen="UWiq1" />
            <HueSlider
              hue={hsva.h}
              color="#F4A261"
              onChange={(h) => setHsva({ ...hsva, h })}
              data-pen="weqLa"
            />
            <AlphaSlider
              alpha={hsva.a}
              color="#F4A261"
              onChange={(a) => setHsva({ ...hsva, a })}
              data-pen="qpmcK"
            />
          </Column>
          <Column caption="ColorArea" width={224} pen="d4gLGq">
            <ColorArea
              hue={hsva.h}
              saturation={hsva.s}
              value={hsva.v}
              color="#F4A261"
              onChange={({ saturation, value }) => setHsva({ ...hsva, s: saturation, v: value })}
              data-pen="H5QKDe"
            />
          </Column>
          <Column caption="GradientStopBar" width={224} pen="C0cKMY">
            <GradientStopBar
              stops={stops}
              selected={stop}
              onSelect={setStop}
              onMove={(i, at) => setStops(stops.map((s, j) => (j === i ? { ...s, at } : s)))}
              onAdd={(at) => {
                setStops([...stops, { color: "#FFFFFF", at }])
                setStop(stops.length)
              }}
              onRemove={(i) => {
                if (stops.length <= 2) return
                setStops(stops.filter((_, j) => j !== i))
                setStop(Math.max(0, i - 1))
              }}
              data-pen="rbnJS"
            />
          </Column>
          <Column caption="SwatchTile" pen="j0aQSY">
            <div className="kimo-gallery__row" style={{ gap: 8, alignItems: "center" }}>
              <SwatchTile color="#F4A261" aria-label="#F4A261" data-pen="rg74x" />
              <SwatchTile color="#E76F51" selected aria-label="#E76F51" data-pen="Jr3U1" />
            </div>
            <div className="kimo-gallery__row" style={{ gap: 4 }}>
              {["#0A0A0A", "#6B6F75", "#F5F4F2", "#2F6BFF", "#0093A3"].map((c) => (
                <SwatchTile key={c} color={c} aria-label={c} />
              ))}
            </div>
          </Column>
          <Column caption="IconTile" pen="DsBbN">
            <div className="kimo-gallery__row" role="listbox" aria-label="Icons" style={{ gap: 4 }}>
              <IconTile name="star" icon={<Star />} data-pen="D4Fvc" />
              <IconTile name="heart" icon={<Heart />} highlighted data-pen="Nv0eZ" />
              <IconTile name="sparkles" icon={<Sparkles />} selected data-pen="cJZRB" />
            </div>
            <span className="kimo-gallery__note">32 cell · 16 icon</span>
          </Column>
          <Column caption="DirectionControl" pen="x0FO9d">
            <DirectionControl value={dir} onChange={setDir} data-pen="J6Reo" />
          </Column>
        </Items>

        <Items pen="dVVDo">
          <Column caption="Panel rows" width={256} pen="c6fKC">
            <FillRow
              swatch="#F4A261"
              label="F4A261"
              opacity="100%"
              visible
              onToggleVisible={() => setLog("FillRow eye")}
              data-pen="xYqbE"
            />
            <FillRow
              swatch="linear-gradient(to right, #F4A261, #6D2E46)"
              label="Linear"
              labelFont="sans"
              opacity="100%"
              visible
              data-pen="vBwVv"
            />
            <FillRow
              swatch="#F4A261"
              label="F4A261"
              opacity="100%"
              visible={fillVisible}
              onToggleVisible={() => setFillVisible((v) => !v)}
              data-pen="X5R2J"
            />
            <EffectRow
              kind={effect.kind}
              visible={effect.visible}
              open={effect.open}
              onToggleOpen={() => setEffect({ ...effect, open: !effect.open })}
              onToggleVisible={() => setEffect({ ...effect, visible: !effect.visible })}
              onKindChange={(k) => setEffect({ ...effect, kind: k })}
              data-pen="Q6vwp"
            />
            <StrokeSideFields
              value={sides}
              onChange={(side, v) => setSides({ ...sides, [side]: v })}
              data-pen="YMKcJ"
            />
          </Column>
          <Column caption="Popover" width={248} pen="BubwB">
            <Popover title="Fill" initialFocus="none" data-pen="xvOvm">
              <ColorArea hue={hsva.h} saturation={hsva.s} value={hsva.v} color="#F4A261" />
              <HueSlider hue={hsva.h} color="#F4A261" />
            </Popover>
          </Column>
          <Column caption="Tooltip/Hint" pen="OgEcq">
            <TooltipHint icon={<PenTool />} data-pen="u0dQ1">
              Click to add points · Drag to curve · Enter to finish
            </TooltipHint>
          </Column>
        </Items>

        <Items pen="QUAzg">
          <Column caption="Popover/Wide · 296" width={296} pen="YPOzd">
            <Popover title="Icon" wide initialFocus="none" data-pen="u0aiz">
              <ColorArea hue={hsva.h} saturation={hsva.s} value={hsva.v} color="#F4A261" />
              <HueSlider hue={hsva.h} color="#F4A261" />
            </Popover>
          </Column>
          <Column caption="SizeField · AlignmentGrid" width={256} pen="Rcp4U">
            <SizeField
              prefix="W"
              inputLabel="Width"
              value={sizeW.value}
              mode={sizeW.mode}
              onValueCommit={(value) => setSizeW({ ...sizeW, value })}
              onModeChange={(mode) => setSizeW({ ...sizeW, mode })}
              data-pen="G6R6IX"
            />
            <div className="kimo-gallery__row kimo-gallery__row--fill" style={{ gap: 8 }}>
              <SizeField prefix="W" inputLabel="Width" value="640" mode="fill" />
              <SizeField
                prefix="H"
                inputLabel="Height"
                value="220"
                mode="fixed"
                data-pen="g3qZq7"
              />
            </div>
            <div className="kimo-gallery__row kimo-gallery__row--fill" style={{ gap: 8 }}>
              <SizeField prefix="W" inputLabel="Width" value="464" mode="fit" data-pen="QvUEC" />
              <AlignmentGrid
                dir="row"
                justify={grid.justify}
                align={grid.align}
                onChange={setGrid}
                data-pen="i1pQK"
              />
            </div>
          </Column>
          <Column caption="PropSection/Empty · non-frame selection" width={280} pen="c7e8B">
            <PropSection
              title="Auto layout"
              action={{ label: "Add auto layout", icon: <Plus /> }}
              data-pen="z1rMhb"
            />
          </Column>
          <Column caption="SizeBadge/Zoom" pen="Q5RePg">
            <ZoomBadge zoom={8} data-pen="L5GCtM" />
          </Column>
        </Items>

        <Items pen="ASBIL">
          <Column caption="Menu/Dense · MenuItem/Dense" width={208} pen="mY1l5">
            <MenuDense label="Dense menu" data-pen="G7A3Aj">
              <MenuItemDense label="Normal" onSelect={() => setLog("Normal")} />
              <MenuItemDense label="Multiply" checked onSelect={() => setLog("Multiply")} />
              <MenuDivider />
              <MenuItemDense label="RGB" mono meta="244 162 97" onSelect={() => setLog("RGB")} />
            </MenuDense>
          </Column>
        </Items>
      </Section>

      <Section
        title="Popovers (M2)"
        note="Board 09 · composed from the components above"
        pen="h3BVP0"
      >
        <Items>
          <Column caption="Color picker · Custom" width={248} pen="jNAqx">
            <ColorPicker color={color} onChange={setColor} documentColors={DOC_COLORS} eyedropper />
          </Column>
          <Column caption="Color picker · Variables" width={248} pen="nim6l">
            <ColorPicker
              color={color}
              tab="variables"
              variables={VARIABLES}
              modes={["light", "dark"]}
              boundVariable={bound}
              onBindVariable={setBound}
            />
          </Column>
          <Column caption="Gradient" width={248} pen="b2Y0pD">
            <GradientEditor
              kind={kind}
              onKindChange={setKind}
              stops={stops}
              selected={stop}
              onSelect={setStop}
              onStopsChange={(next, sel) => {
                setStops(next)
                setStop(sel)
              }}
            />
          </Column>
          <Column caption="Blend mode" width={208} pen="YFOTX">
            <BlendModeMenu
              value={blend}
              passThrough
              autoFocus={false}
              onPreview={(m) => setLog(m ? `Preview ${m}` : "Preview reverted")}
              onSelect={setBlend}
            />
          </Column>
          <Column caption="Icon picker" width={296} pen="b1gaD">
            <IconPicker
              provider={demoIconProvider}
              set={icon.set}
              name={icon.name}
              recent={DEMO_RECENT}
              onSelect={setIcon}
            />
          </Column>
          <Column caption="Icon picker · empty (Material)" width={296} pen="r6tBTD">
            <IconPicker
              provider={demoIconProvider}
              set="material-rounded"
              name=""
              weight={weight}
              onWeightChange={setWeight}
              initialQuery="xyzzy"
            />
          </Column>
          <Column caption="Image fill" width={248} pen="Kgfrv">
            <ImageFillPopover
              src={DEMO_IMAGE}
              naturalSize={{ width: 2400, height: 1600 }}
              mode={image.mode}
              opacity={image.opacity}
              onModeChange={(mode) => setImage({ ...image, mode })}
              onOpacityChange={(opacity) => setImage({ ...image, opacity })}
              onReplace={(f) => setLog(`Replace ${f.name}`)}
              onRemove={() => setLog("Remove image")}
            />
          </Column>
        </Items>
        <p className="kimo-gallery__m2-log" aria-live="polite">
          {log}
        </p>
      </Section>
    </div>
  )
}
