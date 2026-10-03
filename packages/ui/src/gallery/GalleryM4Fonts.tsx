/**
 * Gallery for board 02d "Components — Files (M4)", sections "Fonts" (o5RdO: FontRow and its
 * variants) and "Settings" (oNc2R: SettingRow with its Control slot). Same section / column
 * frames as the M3 gallery (Section Header gap 12 align end + note; Items gap 40; columns
 * gap 12 with a mono caption).
 */
import { Download, Ellipsis } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Button } from "../button/Button"
import { FontRow, fontRowMeta } from "../font-row/FontRow"
import { IconButton } from "../icon-button/IconButton"
import { Select } from "../select/Select"
import { SettingRow } from "../setting-row/SettingRow"
import { Toggle } from "../toggle/Toggle"

function Section({
  title,
  note,
  pen,
  children,
}: {
  title: string
  note: string
  pen: string
  children: ReactNode
}) {
  return (
    <section className="kimo-gallery__section" data-pen={pen}>
      <div className="kimo-gallery__section-header kimo-gallery__section-header--note">
        <h2 className="kimo-gallery__section-title">{title}</h2>
        <span className="kimo-gallery__section-note">{note}</span>
      </div>
      <div className="kimo-gallery__items kimo-gallery__items--m3">{children}</div>
    </section>
  )
}

function Column({
  caption,
  width,
  pen,
  children,
}: {
  caption: string
  width: number
  pen: string
  children: ReactNode
}) {
  return (
    <div className="kimo-gallery__m3-column" style={{ width }} data-pen={pen}>
      <span className="kimo-gallery__caption">{caption}</span>
      {children}
    </div>
  )
}

const more = <IconButton label="More" icon={<Ellipsis />} tone="quiet" />

/** Replace-with trigger as on FontRow/Missing (JoOkA): Select 148, "Replace with…". */
function ReplaceSelect() {
  const [v, setV] = useState<string | null>(null)
  return (
    <Select
      className="kimo-gallery__font-replace"
      style={{ width: 148 }}
      label="Replace Söhne with"
      placeholder="Replace with…"
      options={[
        { value: "Inter", label: "Inter" },
        { value: "IBM Plex Sans", label: "IBM Plex Sans" },
      ]}
      value={v}
      onChange={setV}
    />
  )
}

/** The two 02d sections, for a board that already has its header (the 02d gallery root). */
export function GalleryM4FontsSections() {
  const [autosave, setAutosave] = useState(true)
  const [interval, setInterval] = useState("2000")
  return (
    <>
      <Section
        title="Fonts"
        pen="o5RdO"
        note="specimen renders in the font itself; a missing font renders its specimen in the fallback, tertiary · source and status are separate columns"
      >
        <Column caption="FontRow · /Google · /Offline · /Missing" width={640} pen="BohdJ">
          <FontRow
            data-pen="WVvHj"
            family="Inter"
            meta={`400 · 500 · 600 · 700  ·  used by 212 layers`}
            source="Local"
            status="installed"
            action={more}
          />
          <FontRow
            data-pen="Lbs7z"
            family="Fraunces"
            meta={fontRowMeta([600, 700], 18)}
            source="Google"
            status="cached"
            action={more}
          />
          <FontRow
            data-pen="G92TP9"
            family="Space Grotesk"
            meta={fontRowMeta([500], 4)}
            source="Google"
            status="not-cached"
            action={more}
          />
          <FontRow
            data-pen="mquPe"
            family="Söhne"
            meta={fontRowMeta([400, 600], 23)}
            source="Document"
            status="missing"
            action={<ReplaceSelect />}
          />
          <FontRow
            family="Space Grotesk"
            meta={fontRowMeta([500], 4)}
            source="Google"
            status="not-cached"
            action={
              <Button
                variant="ghost"
                size="sm"
                icon={<Download />}
                className="kimo-gallery__font-fetch"
              >
                Fetch
              </Button>
            }
          />
        </Column>
      </Section>
      <Section
        title="Settings"
        pen="oNc2R"
        note="one row = one setting · label + why, control right-aligned · Control is a slot (Toggle, Select, Segmented, Button)"
      >
        <Column caption="SettingRow · Control slot" width={560} pen="Gfj8i">
          <SettingRow
            data-pen="MuoTX"
            label="Autosave"
            description="Write to disk after you stop editing."
            control={(ids) => (
              <Toggle checked={autosave} onChange={setAutosave} aria-labelledby={ids.labelId} />
            )}
          />
          <SettingRow
            data-pen="w9cW9"
            label="Autosave interval"
            description="Idle time before writing. Recovery snapshots are kept every 30 s regardless."
            control={
              <Select
                dense
                style={{ width: 120 }}
                label="Autosave interval"
                options={[
                  { value: "1000", label: "1 second" },
                  { value: "2000", label: "2 seconds" },
                  { value: "5000", label: "5 seconds" },
                ]}
                value={interval}
                onChange={setInterval}
              />
            }
          />
        </Column>
      </Section>
    </>
  )
}

/** Standalone gallery board for the 02d Fonts + Settings sections. */
export function GalleryM4Fonts({ theme }: { theme?: "light" | "dark" }) {
  return (
    <div className="kimo-gallery kimo-gallery--m3" data-theme={theme} data-pen="uS8Fr">
      <header className="kimo-gallery__header" data-pen="ihu5z">
        <p className="kimo-gallery__eyebrow">KIMO DESIGN SYSTEM · M4</p>
        <h1 className="kimo-gallery__title">Components — Fonts &amp; Settings</h1>
      </header>
      <GalleryM4FontsSections />
    </div>
  )
}
