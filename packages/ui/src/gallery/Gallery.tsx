import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  Component,
  Copy,
  Diamond,
  Download,
  Ellipsis,
  Eye,
  Frame,
  Group,
  Layers,
  MousePointer2,
  PanelTop,
  PenTool,
  Plus,
  Search,
  Smartphone,
  Square,
  Type,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { AgentStep, Composer, Message } from "../agent/Agent"
import { Avatar } from "../avatar/Avatar"
import { Badge } from "../badge/Badge"
import { Button } from "../button/Button"
import { ColorField } from "../color-field/ColorField"
import { EmptyState } from "../empty-state/EmptyState"
import { FileCard } from "../file-card/FileCard"
import { IconButton } from "../icon-button/IconButton"
import { Input } from "../input/Input"
import { Kbd } from "../kbd/Kbd"
import { LayerRow } from "../layer-row/LayerRow"
import { Menu, MenuItem } from "../menu/Menu"
import { PanelHeader } from "../panel-header/PanelHeader"
import { PropField } from "../prop-field/PropField"
import { PropRow, PropSection } from "../prop-section/PropSection"
import { Segmented } from "../segmented/Segmented"
import { Select } from "../select/Select"
import { Tab, Tabs } from "../tabs/Tabs"
import { Toast } from "../toast/Toast"
import { Toggle } from "../toggle/Toggle"
import { ToolButton } from "../tool-button/ToolButton"
import { Tooltip, TooltipContent } from "../tooltip/Tooltip"

/** Props for {@link Gallery}. */
export interface GalleryProps {
  /** Theme of the gallery subtree. Default: inherit (document theme / OS preference). */
  theme?: "light" | "dark"
}

/** `Section` of the 02 Components board: vertical gap 20; Section Header + Items (gap 32). */
function Section({ title, pen, children }: { title: string; pen?: string; children: ReactNode }) {
  return (
    <section className="kimo-gallery__section" data-pen={pen}>
      <div className="kimo-gallery__section-header">
        <h2 className="kimo-gallery__section-title">{title}</h2>
      </div>
      <div className="kimo-gallery__items">{children}</div>
    </section>
  )
}

const ALIGN_OPTIONS = [
  { value: "start", label: "Align left", icon: <AlignHorizontalJustifyStart /> },
  { value: "center", label: "Align center", icon: <AlignHorizontalJustifyCenter /> },
  { value: "end", label: "Align right", icon: <AlignHorizontalJustifyEnd /> },
] as const

const FONT_OPTIONS = [
  { value: "Inter", label: "Inter" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Geist", label: "Geist" },
  { value: "Fraunces", label: "Fraunces", disabled: true },
] as const

/**
 * Visual-QA gallery: every @kimo/ui component and variant, laid out like desing.pen board
 * "02 Components" (PufcL: vertical, gap 48, padding 64, bg-app). The first six sections mirror
 * the board 1:1 (each instance carries `data-pen="<node id>"` for the measurement script); the
 * last section shows interactive and extra states. Hosted by apps/web at `/#/gallery`.
 */
export function Gallery({ theme }: GalleryProps) {
  const [width, setWidth] = useState<number | string>(1440)
  const [height, setHeight] = useState<number | string>("Hug")
  const [font, setFont] = useState<string>("Inter")
  const [align, setAlign] = useState<string>("start")
  const [on, setOn] = useState(true)
  const [off, setOff] = useState(false)
  const [panelTab, setPanelTab] = useState("design")
  const [hidden, setHidden] = useState(false)
  const [locked, setLocked] = useState(true)
  const [layerName, setLayerName] = useState("Navbar")
  const [expanded, setExpanded] = useState(false)
  const [log, setLog] = useState("")

  return (
    <div className="kimo-gallery" data-theme={theme} data-pen="PufcL">
      <header className="kimo-gallery__header" data-pen="L5Q4E">
        <p className="kimo-gallery__eyebrow">KIMO DESIGN SYSTEM · v0.1</p>
        <h1 className="kimo-gallery__title">Components</h1>
        <p className="kimo-gallery__intro">
          Editor primitives built only from semantic tokens. Default control height is 32 (28 inside
          dense panels).
        </p>
      </header>

      <Section title="Actions" pen="zKqmo">
        <Button variant="primary" icon={<Plus />} data-pen="W2lra">
          Button
        </Button>
        <Button variant="secondary" icon={<Download />} data-pen="kv3Fk">
          Button
        </Button>
        <Button variant="ghost" icon={<Plus />} data-pen="sqJv4">
          Button
        </Button>
        <Button variant="soft" icon={<Plus />} data-pen="vyI3D">
          Button
        </Button>
        <IconButton label="More" icon={<Ellipsis />} data-pen="ZMxjt" />
        <IconButton label="Preview" icon={<Eye />} active data-pen="l44gB" />
        <ToolButton label="Rectangle" icon={<Square />} data-pen="N0cHp" />
        <ToolButton label="Move" icon={<MousePointer2 />} active data-pen="l6HCd" />
      </Section>

      <Section title="Inputs" pen="dRT85">
        <div className="kimo-gallery__column kimo-gallery__column--fields" data-pen="Pxhns">
          <Input
            icon={<Search />}
            placeholder="Search layers"
            aria-label="Search layers"
            frameProps={{ "data-pen": "Zs05d" } as Record<string, string>}
          />
          <PropField
            prefix="W"
            inputLabel="Width"
            value={width}
            min={0}
            onChange={setWidth}
            data-pen="A9DDs"
          />
          <ColorField color="var(--kimo-accent)" value="accent" opacity="100%" data-pen="GOaBx" />
          <Select
            label="Font family"
            options={FONT_OPTIONS}
            value={font}
            onChange={setFont}
            data-pen="gP276"
          />
        </div>
        <div className="kimo-gallery__column" data-pen="xtEIh">
          <Segmented
            label="Horizontal alignment"
            options={ALIGN_OPTIONS}
            value={align}
            onChange={setAlign}
            data-pen="hx0Wg"
          />
          <Toggle label="Clip content" checked={on} onChange={setOn} data-pen="y893S" />
          <Toggle label="Auto layout" checked={off} onChange={setOff} data-pen="CSYQj" />
        </div>
        <div className="kimo-gallery__column" data-pen="X49V2">
          <Badge data-pen="jrIWa">Component</Badge>
          <Kbd data-pen="Eo5JW">⌘K</Kbd>
          <Avatar name="Gui S" initials="GS" data-pen="FVhW0" />
        </div>
      </Section>

      <Section title="Panels & Layers" pen="khbGv">
        <div
          className="kimo-gallery__layer-column"
          role="tree"
          aria-label="Layers"
          data-pen="ga43X"
        >
          <PanelHeader
            title="Layers"
            action={{ label: "Add page", icon: <Plus /> }}
            data-pen="LWjoa"
          />
          <LayerRow name="Navbar" icon={<Frame />} expanded data-pen="GXnBT" />
          <LayerRow name="Hero" icon={<Frame />} expanded selected data-pen="dArBD" />
        </div>
        <div className="kimo-gallery__column" role="tablist" aria-label="Tabs" data-pen="nLJq3">
          <Tab data-pen="GfneW">Design</Tab>
          <Tab active data-pen="P3e7Mp">
            Design
          </Tab>
        </div>
        <PropSection
          title="Layout"
          action={{ label: "Add layout", icon: <Plus /> }}
          className="kimo-gallery__prop-section"
          data-pen="fWrGA"
        >
          <PropRow>
            <PropField prefix="W" inputLabel="Width" value={width} min={0} onChange={setWidth} />
            <PropField
              prefix="H"
              inputLabel="Height"
              value={height}
              min={0}
              scrubFrom={366}
              onChange={setHeight}
            />
          </PropRow>
        </PropSection>
      </Section>

      <Section title="Overlays" pen="Koj3v">
        <TooltipContent shortcut="F" data-pen="xbtkW">
          Frame
        </TooltipContent>
        <Menu label="Layer actions" data-pen="MPsxN">
          <MenuItem icon={<Copy />} shortcut="⌘D" data-pen="JMW2O">
            Duplicate
          </MenuItem>
          <MenuItem icon={<Group />} shortcut="⌘G" highlighted>
            Group selection
          </MenuItem>
          <MenuItem icon={<Component />} shortcut="⌥⌘K">
            Create component
          </MenuItem>
        </Menu>
      </Section>

      <Section title="AI Agent" pen="IWkR9">
        <div className="kimo-gallery__chat-column" data-pen="Vtkpe">
          <Message from="user" data-pen="ROG0x">
            Make the hero warmer and add a waitlist form
          </Message>
          <Message from="agent" data-pen="QqwyN">
            I'll warm up the palette, swap the headline to Inter Display, and insert a two-field
            form under the CTA.
          </Message>
          <AgentStep status="done" data-pen="lNM1U">
            Updated 4 color variables
          </AgentStep>
          <AgentStep status="running" data-pen="jOrxb">
            Inserting Waitlist Form…
          </AgentStep>
        </div>
        <Composer
          context={{ label: "Hero", icon: <Frame /> }}
          model="Claude Sonnet 5.5"
          onSend={(t) => setLog(`Sent: ${t}`)}
          data-pen="JvIbi"
        />
      </Section>

      <Section title="Content" pen="Qv3iW">
        <FileCard name="Marketing site" info="Edited 2 hours ago · 6 frames" data-pen="byua1" />
        <Toast actionLabel="Undo" data-pen="XB33E">
          Exported 3 files to ./src/components
        </Toast>
        <EmptyState
          icon={<Layers />}
          title="No layers yet"
          description="Press F to draw a frame, or ask the agent to start a layout."
          data-pen="lUDi2"
        />
      </Section>

      <Section title="States & interactions">
        <div className="kimo-gallery__column">
          <Tooltip label="Frame" shortcut="F">
            <ToolButton label="Frame" icon={<Frame />} />
          </Tooltip>
          <Tooltip label="Text" shortcut="T" side="right">
            <ToolButton label="Text" icon={<Type />} />
          </Tooltip>
          <ToolButton label="Pen (coming soon)" icon={<PenTool />} disabled />
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="kimo-gallery__layer-column" role="tree" aria-label="Layer states">
          <Tabs
            label="Left panel"
            items={[
              { value: "design", label: "Layers" },
              { value: "assets", label: "Assets" },
              { value: "variables", label: "Variables" },
            ]}
            value={panelTab}
            onChange={setPanelTab}
          />
          <LayerRow
            name="Home — Desktop"
            icon={<Frame />}
            expanded
            emphasized
            onToggleExpanded={() => {}}
          />
          <LayerRow
            name={layerName}
            icon={<PanelTop />}
            depth={1}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((x) => !x)}
            onRename={setLayerName}
            visible={!hidden}
            onToggleVisible={() => setHidden((h) => !h)}
            locked={locked}
            onToggleLocked={() => setLocked((l) => !l)}
            tabIndex={0}
          />
          <LayerRow name="Headline" icon={<Type />} depth={2} onToggleVisible={() => {}} />
          <LayerRow name="Footer" icon={<Component />} depth={1} expanded={false} accentIcon />
          <LayerRow name="Home — Mobile" icon={<Smartphone />} expanded emphasized />
          <LayerRow name="Button / Primary" icon={<Diamond />} emphasized accentIcon />
        </div>
        <div className="kimo-gallery__column kimo-gallery__column--fields">
          <PropField prefix="X" inputLabel="X" value={120} disabled />
          <Select label="Empty select" options={FONT_OPTIONS} value={null} placeholder="Mixed" />
          <Menu label="Autofocus menu" onClose={() => setLog("Menu closed")}>
            <MenuItem icon={<Copy />} shortcut="⌘C" onSelect={() => setLog("Copy")}>
              Copy
            </MenuItem>
            <MenuItem icon={<Group />} shortcut="⌘G" disabled>
              Group selection
            </MenuItem>
            <MenuItem icon={<Component />} shortcut="⌥⌘K" onSelect={() => setLog("Component")}>
              Create component
            </MenuItem>
          </Menu>
          <p className="kimo-gallery__log" aria-live="polite">
            {log}
          </p>
        </div>
      </Section>
    </div>
  )
}
