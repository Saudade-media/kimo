import {
  ArrowRight,
  CircleDot,
  Diamond,
  Folder,
  Layers,
  List,
  Lock,
  Rows3,
  SquareDashed,
  SunMoon,
  Unlink,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { AliasChip, WhenChip } from "../alias-chip/AliasChip"
import { AssetRow } from "../asset-row/AssetRow"
import { AssetTile } from "../asset-tile/AssetTile"
import { ConfirmDialog } from "../confirm-dialog/ConfirmDialog"
import { EntryRow, moveItem, VariableEntries, type VariableEntry } from "../entry-row/EntryRow"
import { InstancePropRow } from "../instance-prop-row/InstancePropRow"
import { InstanceSwapField } from "../instance-swap-field/InstanceSwapField"
import { LayerRowM3 } from "../layer-row-m3/LayerRowM3"
import { LibraryManager } from "../library-manager/LibraryManager"
import { LibraryRow } from "../library-row/LibraryRow"
import { OverrideDot } from "../override-dot/OverrideDot"
import { PropDefRow } from "../prop-def-row/PropDefRow"
import { SlotBadge, SlotQuickInsert } from "../slot-badge/SlotBadge"
import { StatusPill } from "../status-pill/StatusPill"
import { SwapPopover } from "../swap-popover/SwapPopover"
import { ThemePinRow } from "../theme-pin-row/ThemePinRow"
import { Toast } from "../toast/Toast"
import { TypeGlyph } from "../type-glyph/TypeGlyph"
import { AllThemesTag, VarCell } from "../var-cell/VarCell"
import { VariableListRow } from "../variable-list-row/VariableListRow"
import { AxisGroupHeader, ModeColumnHeader, VariableRow } from "../variable-row/VariableRow"
import {
  VariablesDialog,
  VariablesNavAddButton,
  VariablesNavItem,
  VariablesNavSection,
  type VariableTypeFilter,
} from "../variables-dialog/VariablesDialog"

/** Column of board 02c: vertical, gap 12; Caption mono 11 text-tertiary first. */
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
    <div className="kimo-gallery__m3-column" style={width ? { width } : undefined} data-pen={pen}>
      <span className="kimo-gallery__caption">{caption}</span>
      {children}
    </div>
  )
}

/** Section of board 02c (tqwgl …): Section Header (gap 12, align end) with a note. */
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
  <div className="kimo-gallery__items kimo-gallery__items--m3" data-pen={pen}>
    {children}
  </div>
)

/** Design placeholder thumbnail (txUC3): a "Get started" pill (document content, not chrome). */
const Thumb = () => (
  <span className="kimo-gallery__thumb">
    <span className="kimo-gallery__thumb-label">Get started</span>
  </span>
)

const noop = () => {}
const empty = { kind: "empty" } as const

/**
 * Board "02c Components — Systems (M3)" (SD9TU) and the M3 composites of boards 13–15
 * (Variables dialog EIkIk, Library manager KBZKl, Swap popover jFlfP, Confirms). Every design
 * instance carries `data-pen` for the measured pass (`scripts/measure-gallery.ts`). Canvas labels
 * and outlines are drawn by @kimo/renderer and are not part of this page.
 */
export function GalleryM3({ theme }: { theme?: "light" | "dark" }) {
  const [log, setLog] = useState("")
  const [args, setArgs] = useState({ label: "Get started", flag: true, size: "md" })
  const [pin, setPin] = useState<string | null>(null)
  const [filter, setFilter] = useState<VariableTypeFilter>("all")
  const [query, setQuery] = useState("")
  const [entries, setEntries] = useState<VariableEntry[]>([
    {
      key: "fallback",
      when: null,
      value: <VarCell value={{ kind: "number", label: "16" }} />,
      state: "used only if nothing matches",
    },
    {
      key: "compact",
      when: { density: "compact" },
      value: <VarCell value={{ kind: "number", label: "12" }} />,
      state: "",
    },
    {
      key: "comfortable",
      when: { density: "comfortable" },
      value: <VarCell value={{ kind: "number", label: "16" }} />,
      state: "wins in preview",
      winning: true,
    },
    {
      key: "dark-compact",
      when: { mode: "dark", density: "compact" },
      value: <VarCell value={{ kind: "number", label: "10" }} />,
      state: "beats entry 2 under dark + compact",
    },
  ])

  return (
    <div className="kimo-gallery kimo-gallery--m3" data-theme={theme} data-pen="SD9TU">
      <header className="kimo-gallery__header" data-pen="K8DnFV">
        <p className="kimo-gallery__eyebrow">KIMO DESIGN SYSTEM · M3</p>
        <h1 className="kimo-gallery__title">Components — Systems</h1>
        <p className="kimo-gallery__intro">
          M3 primitives for components, instances, props, slots, variables, themes and libraries.
          Same 28px panel density as 02 / 02b. One new hue, component (violet), marks component and
          instance identity only — glyphs, canvas outlines, slot outlines and the override dot.
        </p>
      </header>

      <Section
        title="Identity — layers & canvas"
        note="component glyph = main · diamond = instance · “from …” = derived · dot = overridden · dashed = slot · replace glyph = replaced child"
        pen="tqwgl"
      >
        <Items pen="HcHr6">
          <Column caption="OverrideDot" pen="adLdC">
            <OverrideDot data-pen="rqoRv" />
          </Column>
          <Column caption="LayerRow · component / instance / slot" width={260} pen="k1wie">
            <div role="tree" aria-label="M3 layer rows" className="kimo-gallery__m3-tree">
              <LayerRowM3 kind="component" name="Card" expanded={false} data-pen="ZcfUj" />
              <LayerRowM3
                kind="derived"
                name="Button/Ghost"
                from="Button/Primary"
                expanded={false}
                data-pen="x5xNG"
              />
              <LayerRowM3
                kind="component"
                name="Card"
                expanded={false}
                selected
                data-pen="L3PiIW"
              />
              <LayerRowM3 kind="instance" name="Card" expanded={false} data-pen="oHsXi" />
              <LayerRowM3 kind="instance" name="Card" expanded={false} selected data-pen="N3AA7R" />
              <LayerRowM3 kind="slot" name="Actions" expanded={false} data-pen="lAFda" />
              <LayerRowM3
                kind="replaced"
                name="Price"
                expanded={false}
                onResetOverride={() => setLog("Reset Price")}
                data-pen="Uh0kH"
              />
              <LayerRowM3
                kind="instance"
                name="Card · Pro"
                expanded={false}
                overridden
                onToggleVisible={noop}
                onRename={(n) => setLog(`Renamed ${n}`)}
                tabIndex={0}
                data-pen="nn4zo"
              />
            </div>
          </Column>
          <Column caption="SlotBadge · SlotQuickInsert" pen="E2Rvdr">
            <SlotBadge name="Actions" data-pen="kMGG0" />
            <SlotQuickInsert
              label="Button/Primary"
              onClick={() => setLog("Insert Button/Primary")}
              data-pen="AJSok"
            />
            <SlotQuickInsert label="+1" more />
          </Column>
          <p className="kimo-gallery__note kimo-gallery__m3-renderer-note">
            CanvasLabel and canvas outlines (main 1.5 solid · instance 1 solid · slot 1 dashed 4/3)
            are drawn by @kimo/renderer.
          </p>
        </Items>
      </Section>

      <Section
        title="Assets & props"
        note="AssetTile 112w · AssetRow 28h · PropDefRow / InstancePropRow sized for the 256 panel body"
        pen="PdC0U"
      >
        <Items pen="Jg1tu">
          <Column caption="AssetTile · default / hover" pen="cDhRy">
            <div className="kimo-gallery__row kimo-gallery__m3-tiles" data-pen="m70mue">
              <AssetTile
                name="Button/Primary"
                thumbnail={<Thumb />}
                onSelect={() => setLog("Asset Button/Primary")}
                onDragStart={noop}
                data-pen="Q4zkG"
              />
              <AssetTile name="Button/Primary" thumbnail={<Thumb />} hover data-pen="SGo9R" />
            </div>
          </Column>
          <Column caption="AssetRow" width={232} pen="hVOpn">
            <AssetRow name="Button/Primary" meta="12×" data-pen="h6gLx" />
            <AssetRow name="Card/Pricing" meta="3×" data-active="true" data-pen="qvO7C" />
            <AssetRow name="Button/Primary" meta="12×" selected data-pen="Nugw3" />
          </Column>
          <Column caption="TypeGlyph" pen="hcTqH">
            <div className="kimo-gallery__row kimo-gallery__m3-glyphs" data-pen="abZJQ">
              <TypeGlyph type="text" data-pen="s5R49" />
              <TypeGlyph type="boolean" data-pen="F55lf" />
              <TypeGlyph type="enum" data-pen="UFEvs" />
              <TypeGlyph type="instance" data-pen="EQ2qA" />
              <TypeGlyph type="color" data-pen="C3HtXf" />
              <TypeGlyph type="number" data-pen="e94wp" />
              <TypeGlyph type="slot" data-pen="q3b44H" />
            </div>
            <span className="kimo-gallery__note kimo-gallery__m3-glyph-note">
              text · boolean · enum · instance · color · number · slot
            </span>
          </Column>
          <Column caption="PropDefRow" width={256} pen="M3Km6">
            <PropDefRow
              name="label"
              type="text"
              target="Label · content"
              defaultValue="Get started"
              onRename={(n) => setLog(`Prop ${n}`)}
              onDefaultCommit={(v) => setLog(`Default ${v}`)}
              onRemove={() => setLog("Remove label")}
              data-pen="VqB97"
            />
            <PropDefRow
              name="showIcon"
              type="boolean"
              target="Icon · visible"
              defaultValue="true"
              data-pen="hXmP2"
            />
            <PropDefRow
              name="size"
              type="enum"
              target="Root · pad"
              defaultValue="sm · md · lg"
              data-pen="n0ujw4"
            />
            <PropDefRow
              name="icon"
              type="instance"
              target="Icon"
              defaultValue="Icon/Arrow"
              data-pen="ieuje"
            />
          </Column>
          <Column caption="InstanceSwapField · InstancePropRow" width={256} pen="n3GnC">
            <InstanceSwapField value="Icon/Arrow" preview={<ArrowRight />} data-pen="VjO7v" />
            <InstancePropRow
              prop={{ name: "label", type: "text" }}
              overridden={false}
              value="Get started"
              data-pen="iYH5j"
            />
            <InstancePropRow
              prop={{ name: "label", type: "boolean" }}
              overridden={false}
              value={args.flag}
              onChange={(v) => setArgs({ ...args, flag: v === true })}
              data-pen="YSJLM"
            />
            <InstancePropRow
              prop={{ name: "label", type: "enum" }}
              overridden={false}
              value={args.size}
              options={["sm", "md", "lg"]}
              onChange={(v) => setArgs({ ...args, size: String(v) })}
              data-pen="ztxNk"
            />
            <InstancePropRow
              prop={{ name: "label", type: "instance" }}
              overridden={false}
              value="Icon/Arrow"
              preview={<ArrowRight />}
              data-pen="CpeMN"
            />
            <InstancePropRow
              prop={{ name: "actions", type: "slot" }}
              overridden={false}
              slotCount={2}
              data-pen="ddT4A"
            />
            <span className="kimo-gallery__caption">overridden →</span>
            <InstancePropRow
              prop={{ name: "label", type: "text" }}
              overridden
              value={args.label === "Get started" ? "Start free trial" : args.label}
              mainValue="Get started"
              onChange={(v) => setArgs({ ...args, label: String(v) })}
              onReset={() => setLog("Reset label")}
              data-pen="n2Q1FU"
            />
          </Column>
        </Items>
      </Section>

      <Section
        title="Variables & themes"
        note={
          'cells 150w × 36h · one column per theme-axis value · alias chip for {"$ref"} · — = no entry for that axis (falls back)'
        }
        pen="T49T0O"
      >
        <Items pen="ybtLM">
          <Column caption="VarCell · AliasChip" width={150} pen="fQyGG">
            <AliasChip name="ink-900" data-pen="bEYCg" />
            <VarCell
              value={{ kind: "color", color: "#FFFFFF", label: "FFFFFF" }}
              data-pen="iCQwv"
            />
            <VarCell value={{ kind: "number", label: "16" }} data-pen="U8aZ2J" />
            <VarCell value={{ kind: "string", label: "Inter" }} data-pen="MEKrO" />
            <VarCell value={{ kind: "boolean", value: true }} data-pen="pxZFa" />
            <VarCell value={{ kind: "alias", name: "ink-900" }} data-pen="xn5O9" />
            <VarCell value={empty} data-pen="OJlJp" />
            <VarCell
              value={{ kind: "color", color: "#FFFFFF", label: "FFFFFF" }}
              editing
              data-pen="b8Koy"
            />
          </Column>
          <Column caption="ModeColumnHeader · AxisGroupHeader" width={320} pen="H28SsS">
            <div className="kimo-gallery__row" data-pen="PbE4Y">
              <ModeColumnHeader value="light" isDefault onMenu={noop} data-pen="MhpFW" />
              <ModeColumnHeader value="dark" onMenu={noop} data-pen="ECUOZ" />
            </div>
            <AxisGroupHeader axis="mode" count={2} data-pen="E6DjdE" />
          </Column>
          <Column caption="ThemePinRow · inherit / pinned" width={256} pen="HiB8W">
            <ThemePinRow
              axis="mode"
              values={["light", "dark"]}
              pinned={null}
              inherited="light"
              data-pen="Lamcg"
            />
            <ThemePinRow
              axis="mode"
              values={["light", "dark"]}
              pinned={pin ?? "dark"}
              inherited="light"
              onChange={(v) => setPin(v ?? "dark")}
              data-pen="fXNbV"
            />
            <ThemePinRow
              axis="ui:density"
              values={["comfortable", "compact"]}
              pinned={null}
              data-pen="EtIA3"
            />
          </Column>
          <Column caption="VariableListRow (left panel)" width={240} pen="oudqU">
            <VariableListRow
              name="surface/base"
              type="color"
              value="FFFFFF"
              color="#FFFFFF"
              data-pen="yB4CN"
            />
            <VariableListRow
              name="text/default"
              type="color"
              value="ink-900"
              color="#2A1E14"
              alias
              selected
              data-pen="HLJJg"
            />
            <VariableListRow name="space/panel-pad" type="number" value="12" data-pen="FGJH5" />
          </Column>
        </Items>
        <div className="kimo-gallery__m3-column kimo-gallery__m3-specimen" data-pen="YPYbl">
          <span className="kimo-gallery__caption">
            VariableRow — Name Cell + Values slot (suggested: VarCell/*) · hover shows the row menu
          </span>
          <VariableRow
            name="surface/base"
            type="color"
            values={
              <>
                <VarCell value={{ kind: "color", color: "#FFFFFF", label: "FFFFFF" }} />
                <VarCell value={{ kind: "alias", name: "ink-900" }} />
                <VarCell value={empty} />
                <VarCell value={empty} />
              </>
            }
            onMenu={() => setLog("Row menu surface/base")}
            data-pen="ejBTe"
          />
          <VariableRow
            name="space/panel-pad"
            type="number"
            highlighted
            values={
              <>
                <VarCell value={empty} />
                <VarCell value={empty} />
                <VarCell value={{ kind: "number", label: "12" }} />
                <VarCell value={{ kind: "number", label: "8" }} />
              </>
            }
            data-pen="Koxnr"
          />
          <span className="kimo-gallery__note kimo-gallery__m3-entries-caption">
            Entries — raw themed value in list order (row disclosure ▸). WhenChip = one axis=value;
            several chips = multi-axis entry; Fallback = no when (never a candidate). Drag grip to
            reorder: last matching entry wins.
          </span>
          <div className="kimo-gallery__m3-entries" data-pen="LNWM1">
            <WhenChip axis="density" value="compact" data-pen="FOOJI" />
            <EntryRow
              index={1}
              when={null}
              value={<VarCell value={{ kind: "number", label: "16" }} />}
              state="used only if nothing matches"
              data-pen="Ni5kJ"
            />
            <EntryRow
              index={2}
              when={{ density: "compact" }}
              value={<VarCell value={{ kind: "number", label: "12" }} />}
              data-pen="H6Mdtf"
            />
            <EntryRow
              index={4}
              when={{ mode: "dark", density: "compact" }}
              value={<VarCell value={{ kind: "number", label: "10" }} />}
              state="wins · dark + compact"
              winning
              data-pen="mFjXw"
            />
          </div>
        </div>
      </Section>

      <Section
        title="Libraries & feedback"
        note="imports are read-only links · status uses status tokens only · rejected edits surface as Toast/Danger or Toast/Warning"
        pen="JEmkq"
      >
        <Items pen="qbp5Z">
          <Column caption="StatusPill" pen="XZb6S">
            <StatusPill status="linked" data-pen="SVobH" />
            <StatusPill status="changed" data-pen="n20iVc" />
            <StatusPill status="missing" data-pen="jwQVJ" />
          </Column>
          <Column caption="LibraryRow · linked / changed / missing" width={620} pen="R9mZB">
            <LibraryRow
              name="Kimo UI"
              alias="ui"
              path="../design-system/ui.kimo"
              count="24 components · 86 variables"
              status="linked"
              data-pen="hxry7"
            />
            <LibraryRow
              name="Marketing kit"
              alias="mkt"
              path="../brand/marketing.kimo"
              count="12 components · 3 changed"
              status="changed"
              actionLabel="Review"
              onAction={() => setLog("Review mkt")}
              data-pen="F8YIg"
            />
            <LibraryRow
              name="Icons"
              alias="icons"
              path="../icons/icons.kimo"
              count="file not found · 9 instances use it"
              status="missing"
              actionLabel="Locate…"
              data-pen="heWrG"
            />
          </Column>
          <Column caption="Toast/Danger · Toast/Warning" pen="I59DkV">
            <Toast tone="danger" actionLabel="Reorder" data-pen="FVd5q">
              Can't move a child of an auto layout frame — reorder instead
            </Toast>
            <Toast tone="warning" actionLabel="Review" data-pen="qINpv">
              1 override no longer resolves — Marketing kit changed
            </Toast>
          </Column>
        </Items>
        <p className="kimo-gallery__m3-log" aria-live="polite">
          {log}
        </p>
      </Section>

      <Section
        title="Dialogs & popovers (M3)"
        note="Variables dialog (board 14 EIkIk) · Library manager, Swap popover (board 13) · Confirms (board 15)"
      >
        <VariablesDialog
          inline
          description="Marketing site · 14 variables · 2 theme axes · 3 libraries"
          onClose={() => setLog("Variables closed")}
          query={query}
          onQueryChange={setQuery}
          typeFilter={filter}
          onTypeFilterChange={setFilter}
          onNewVariable={() => setLog("New variable menu")}
          axes={[
            { axis: "mode", values: ["light", "dark"], onValueMenu: noop },
            {
              axis: "density",
              icon: <Rows3 />,
              values: ["comfortable", "compact"],
              onValueMenu: noop,
            },
          ]}
          sidebar={
            <>
              <VariablesNavSection title="Groups" />
              <VariablesNavItem icon={<Layers />} label="All" count={14} mono={false} selected />
              <VariablesNavItem icon={<Folder />} label="color" count={7} emphasized />
              <VariablesNavItem icon={<Folder />} label="space" count={3} />
              <VariablesNavItem icon={<Folder />} label="type" count={2} />
              <VariablesNavItem icon={<Folder />} label="flags" count={2} />
              <VariablesNavSection title="Theme axes" />
              <VariablesNavItem icon={<SunMoon />} label="mode" count={2} />
              <VariablesNavItem icon={<Rows3 />} label="density" count={2} />
              <VariablesNavAddButton onClick={() => setLog("Add axis")} />
              <VariablesNavSection title="Libraries" />
              <VariablesNavItem icon={<Lock />} label="ui" count={86} />
              <VariablesNavItem icon={<Lock />} label="mkt" count={9} />
              <VariablesNavItem icon={<Lock />} label="icons" count="missing" missing />
            </>
          }
          onExport={() => setLog("Export DTCG")}
          data-pen="EIkIk"
        >
          <VariableRow
            name="surface/page"
            type="color"
            nameWidth={216}
            values={
              <>
                <VarCell value={{ kind: "color", color: "#FFF7EE", label: "FFF7EE" }} />
                <VarCell value={{ kind: "color", color: "#1A120C", label: "1A120C" }} />
                <VarCell value={empty} />
                <VarCell value={empty} />
              </>
            }
          />
          <VariableRow
            name="text/default"
            type="color"
            nameWidth={216}
            values={
              <>
                <VarCell value={{ kind: "alias", name: "ink-900" }} />
                <VarCell value={{ kind: "color", color: "#F5EDE4", label: "F5EDE4" }} />
                <VarCell value={empty} />
                <VarCell value={empty} />
              </>
            }
          />
          <VariableRow
            name="surface/card"
            type="color"
            nameWidth={216}
            lint="THEME_NO_MATCH: no entry matches light · comfortable"
            values={
              <>
                <VarCell value={empty} />
                <VarCell value={{ kind: "alias", name: "ink-900" }} />
                <VarCell value={empty} />
                <VarCell value={empty} />
              </>
            }
          />
          <VariableRow
            name="brand/accent"
            type="color"
            nameWidth={216}
            uniform
            valuesWidth={600}
            values={<AllThemesTag />}
          />
          <VariableRow
            name="ink-900"
            type="color"
            nameWidth={216}
            uniform
            valuesWidth={600}
            values={<AllThemesTag />}
          />
          <VariableRow
            name="space/card-pad"
            type="number"
            nameWidth={216}
            expanded
            values={
              <>
                <VarCell value={empty} />
                <VarCell value={empty} />
                <VarCell value={{ kind: "number", label: "16" }} />
                <VarCell value={{ kind: "number", label: "12" }} multi />
              </>
            }
          />
          <VariableEntries
            entries={entries}
            preview="preview: light · comfortable → 16"
            onReorder={(from, to) => setEntries((e) => moveItem(e, from, to))}
          />
          <VariableRow
            name="space/gap"
            type="number"
            nameWidth={216}
            values={
              <>
                <VarCell value={empty} />
                <VarCell value={empty} />
                <VarCell value={{ kind: "number", label: "12" }} />
                <VarCell value={{ kind: "number", label: "8" }} />
              </>
            }
          />
          <VariableRow
            name="font/display"
            type="string"
            nameWidth={216}
            uniform
            valuesWidth={600}
            values={
              <>
                <VarCell value={{ kind: "string", label: "Fraunces" }} />
                <AllThemesTag />
              </>
            }
          />
          <VariableRow
            name="flags/show-promo"
            type="boolean"
            nameWidth={216}
            values={
              <>
                <VarCell value={{ kind: "boolean", value: true }} />
                <VarCell value={{ kind: "boolean", value: false }} />
                <VarCell value={empty} />
                <VarCell value={empty} />
              </>
            }
          />
        </VariablesDialog>

        <div className="kimo-gallery__items kimo-gallery__items--m3">
          <LibraryManager
            onLink={() => setLog("Link library")}
            initialFocus="none"
            data-pen="KBZKl"
          >
            <LibraryRow
              name="Kimo UI"
              alias="ui"
              path="../design-system/ui.kimo"
              count="24 components"
              status="linked"
            />
            <LibraryRow
              name="Marketing kit"
              alias="mkt"
              path="../brand/marketing.kimo"
              count="12 components · 3 changed"
              status="changed"
              actionLabel="Review"
            />
            <LibraryRow
              name="Icons"
              alias="icons"
              path="../icons/icons.kimo"
              count="used by 9 instances"
              status="missing"
              actionLabel="Locate…"
            />
          </LibraryManager>
          <SwapPopover
            groups={[
              {
                title: "This file",
                meta: "Card",
                items: [
                  { id: "card-pricing", name: "Card/Pricing", usage: "3×" },
                  { id: "card-feature", name: "Card/Feature", usage: "4×" },
                  { id: "card-testimonial", name: "Card/Testimonial", usage: "—" },
                ],
              },
              {
                title: "Kimo UI",
                meta: "ui",
                items: [
                  { id: "ui:card-base", name: "ui:Card/Base", usage: "2×" },
                  { id: "ui:card-media", name: "ui:Card/Media", usage: "—" },
                ],
              },
            ]}
            selected="card-pricing"
            onSelect={(id) => setLog(`Swap ${id}`)}
            initialFocus="none"
            data-pen="jFlfP"
          />
        </div>

        <div className="kimo-gallery__m3-confirms">
          <ConfirmDialog
            inline
            tone="component"
            icon={<Unlink />}
            title="Detach Card · Pro?"
            description="It becomes a plain frame and stops receiving changes from Card/Pricing."
            impact={[
              {
                icon: <CircleDot />,
                tone: "component",
                text: "5 overrides become local values (props 1 · args 2 · slot 1 · replace 1)",
              },
              {
                icon: <SquareDashed />,
                text: "Slot actions (2 layers) and the replaced Price stay as regular children",
              },
              {
                icon: <List />,
                text: "Props label, showBadge, size and icon are dropped — values stay",
              },
            ]}
            confirmLabel="Detach"
            dontAskAgain
            onConfirm={({ dontAskAgain }) => setLog(`Detach (don't ask: ${dontAskAgain})`)}
            onCancel={() => setLog("Detach cancelled")}
            data-pen="i8PfIC"
          />
          <ConfirmDialog
            inline
            tone="danger"
            icon={<SquareDashed />}
            title="Turn off slot on Actions?"
            description="3 instances have their own content in this slot. Turning it off deletes that content."
            impact={[
              { icon: <Diamond />, tone: "component", text: "Card · Pro — 2 layers" },
              { icon: <Diamond />, tone: "component", text: "Card · Team — 1 layer" },
              { icon: <Diamond />, tone: "component", text: "Card · Starter — 1 layer" },
            ]}
            cancelLabel="Keep slot"
            confirmLabel="Delete 4 layers"
            onConfirm={() => setLog("Slot off")}
            onCancel={noop}
            data-pen="ysXyK"
          />
          <ConfirmDialog
            inline
            tone="danger"
            icon={<Unlink />}
            title="Unlink the Icons library?"
            description="Removes icons from imports. 9 instances still reference icons: components and would fail validation (ALIAS_UNKNOWN)."
            impact={[
              {
                icon: <CircleDot />,
                tone: "component",
                text: "Detach all: 9 instances become plain layers from the cached preview",
              },
              {
                icon: <SquareDashed />,
                text: "Without a cache (fresh clone) detach is unavailable — locate the file instead",
              },
              { icon: <List />, text: "Undo restores the import and the instances" },
            ]}
            confirmLabel="Detach all & unlink"
            onConfirm={() => setLog("Unlink")}
            onCancel={noop}
            data-pen="fmB2B"
          />
        </div>
      </Section>
    </div>
  )
}
