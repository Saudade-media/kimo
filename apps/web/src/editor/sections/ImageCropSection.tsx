/**
 * Board 27 §6 (d) "Image crop mode · canvas handles + panel" (VCSml › ud74f › Right Panel ›
 * Section · Image `g9PSe`), shown while crop mode is on for the selected layer:
 *   Section · Image: vertical, gap 8, padding [12, 12, 16, 12], bottom stroke 1 border
 *     Header (EfPFG): Title "Image" sans text-sm normal text-primary
 *     Mode row (d3tFSi, gap 8): Select gP276 fill "Crop"
 *     Crop XY (yraBP, gap 8): PropField A9DDs X · Y        (source px)
 *     Crop WH (lDZum, gap 8): PropField A9DDs W · H
 *     Hint (Q7Lkn): sans text-xs text-tertiary, line-height 1.45,
 *       "Crop in source pixels · image 2400 × 1600"
 *     Actions (PO8y3, gap 6, justify end): Reset = Button/Ghost (sqJv4) h 28 padding [0, 10]
 *       no icon, label text-sm · Apply = Button/Primary (W2lra) h 28 padding [0, 12], text-sm.
 * The fields edit the pending crop (nothing is written until Apply / Enter); picking another
 * mode leaves crop mode and sets that fit (dropping the crop rect).
 */

import { Button, PropField, PropRow, PropSection, Select } from "@kimo/ui"
import { type CropSession, cropPx, cropStore } from "../../canvas/crop"
import { imagePaints, writePaintOps } from "../../canvas/crop-mode"
import { type MessageKey, t } from "../../lib/i18n"
import { usePanel } from "../panel-context"
import "./image-crop.css"

type Mode = "cover" | "contain" | "stretch" | "crop"

const MODE_OPTIONS: readonly { value: Mode; label: MessageKey }[] = [
  { value: "cover", label: "ui.image.fit.cover" },
  { value: "contain", label: "ui.image.fit.contain" },
  { value: "stretch", label: "ui.image.fit.stretch" },
  { value: "crop", label: "ui.image.fit.crop" },
]

export function ImageCropSection({ crop }: { crop: CropSession }) {
  const { session } = usePanel()
  const store = cropStore(session.ui)
  const r = crop.rect
  const set = (patch: Partial<typeof r>) => store.actions?.setRect({ ...r, ...patch })
  const field = (key: "x" | "y" | "w" | "h", prefix: string) => (
    <PropField
      prefix={prefix}
      inputLabel={`Crop ${prefix}`}
      value={cropPx(r[key])}
      step={1}
      min={key === "w" || key === "h" ? 1 : 0}
      onChange={(n) => set({ [key]: n })}
    />
  )
  return (
    <PropSection
      title={t("insp.image")}
      className="image-crop"
      data-pen="g9PSe"
      aria-label={t("insp.imageCrop")}
    >
      <PropRow className="image-crop__row">
        <Select<Mode>
          dense
          label={t("insp.imageMode")}
          className="rp-select-fill"
          options={MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
          value="crop"
          onChange={(m) => {
            if (m === "crop") return
            store.actions?.cancel()
            const node = session.store.getNode(crop.nodeId)
            const p = node && imagePaints(node.fill).find((x) => x.index === crop.paint)?.paint
            if (!node || !p) return
            const { fit: _, crop: __, ...rest } = p
            session.apply(
              writePaintOps(
                crop.nodeId,
                node,
                crop.paint,
                m === "cover" ? rest : { ...rest, fit: m },
              ),
              "Edit fill",
            )
          }}
        />
      </PropRow>
      <PropRow className="image-crop__row">
        {field("x", "X")}
        {field("y", "Y")}
      </PropRow>
      <PropRow className="image-crop__row">
        {field("w", "W")}
        {field("h", "H")}
      </PropRow>
      <p className="image-crop__hint">
        Crop in source pixels · image {crop.imageWidth} × {crop.imageHeight}
      </p>
      <div className="image-crop__actions">
        <Button
          variant="ghost"
          size="sm"
          className="image-crop__reset"
          onClick={() => store.actions?.reset()}
        >
          {t("ui.editor.sections.imagecropsection.1")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="image-crop__apply"
          onClick={() => store.actions?.apply()}
        >
          {t("ui.editor.sections.imagecropsection.2")}
        </Button>
      </div>
    </PropSection>
  )
}
