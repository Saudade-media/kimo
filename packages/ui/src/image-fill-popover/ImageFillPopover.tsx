import { Trash2, Upload } from "lucide-react"
import { type CSSProperties, type DragEvent, useEffect, useRef, useState } from "react"
import { Button } from "../button/Button"
import { parsePercent, percent } from "../color/color"
import { cx } from "../internal/util"
import { Popover } from "../popover/Popover"
import type { PlacementOptions } from "../popover/position"
import type { PopoverAnchor } from "../popover/usePopover"
import { PropTextField } from "../prop-field/PropTextField"
import { Select } from "../select/Select"

/** `.kimo` image fill modes (`ImagePaint.fit`). */
export type ImageFillMode = "cover" | "contain" | "stretch" | "tile" | "crop"

const MODE_LABELS: Record<ImageFillMode, string> = {
  cover: "Cover",
  contain: "Contain",
  stretch: "Stretch",
  tile: "Tile",
  crop: "Crop",
}

/**
 * Modes offered by default: board 09 lists cover · contain · stretch; board 27 §6 (d) adds Crop
 * as the fourth (choosing it enters crop mode on the canvas).
 */
export const IMAGE_FILL_MODES: readonly ImageFillMode[] = ["cover", "contain", "stretch", "crop"]

/** Display label of a mode (`cover` → "Cover"), also used by FillRow ("Image · Cover"). */
export const imageFillModeLabel = (mode: ImageFillMode): string => MODE_LABELS[mode]

/** CSS background drawing an image the way the `.kimo` mode fits it into a box. */
export function imageFillBackground(src: string, mode: ImageFillMode): CSSProperties {
  return {
    backgroundImage: `url(${JSON.stringify(src)})`,
    backgroundPosition: "center",
    backgroundRepeat: mode === "tile" ? "repeat" : "no-repeat",
    backgroundSize:
      mode === "cover"
        ? "cover"
        : mode === "contain"
          ? "contain"
          : mode === "stretch" || mode === "crop"
            ? "100% 100%"
            : "auto",
  }
}

/** Props for {@link ImageFillPopover}. */
export interface ImageFillPopoverProps {
  /** Image URL (object URL of the asset) for the preview; omit while the asset loads. */
  src?: string
  mode: ImageFillMode
  /** Entries of the Mode menu. Default {@link IMAGE_FILL_MODES}; add `"tile"` to offer it. */
  modes?: readonly ImageFillMode[]
  /** Fill opacity 0–1. */
  opacity: number
  /** Natural pixel size for the badge ("2400 × 1600"); measured from `src` when omitted. */
  naturalSize?: { width: number; height: number }
  /** One undo step each. */
  onModeChange?: (mode: ImageFillMode) => void
  onOpacityChange?: (opacity: number) => void
  /** Replace with a file picked in the dialog or dropped onto the preview. */
  onReplace?: (file: File) => void
  /** Removes this fill only. */
  onRemove?: () => void
  /** `accept` of the Replace file dialog. Default `image/*`. */
  accept?: string
  onClose?: () => void
  anchor?: PopoverAnchor
  placement?: PlacementOptions
}

/**
 * Image fill popover (board 09 `wM79U` › `Kgfrv`): Popover 248 "Image". Body (dKBYR, vertical,
 * gap 12, padding 12):
 * Preview (QfW69: fill × 140, clip, #C9B8A6, radius-md, stroke 1 border) → Image (MKJER,
 * 224 × 140, drawn with the fill's mode) + Mode Badge (Ibpeh at 8, 112: padding [2, 8],
 * #0A0A0A99, pill, mono 10 #FFFFFF) · Mode Row (H9VoX: gap 8, center; label 48 sans 12
 * text-secondary + Select fill) · Opacity Row (i155wM: label 48 + prefix-less PropField fill) ·
 * Actions (RhQn8: gap 8, padding-top 4, center; Replace = Button/Secondary fill × 28, centered,
 * `upload` 14 + "Replace" sans 12; Remove = Button/Ghost × 28, `trash-2` 14 + "Remove", danger).
 * Replace opens the file dialog; dropping an image onto the preview also replaces.
 */
export function ImageFillPopover({
  src,
  mode,
  modes = IMAGE_FILL_MODES,
  opacity,
  naturalSize,
  onModeChange,
  onOpacityChange,
  onReplace,
  onRemove,
  accept = "image/*",
  onClose,
  anchor,
  placement,
}: ImageFillPopoverProps) {
  const file = useRef<HTMLInputElement>(null)
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    setMeasured(null)
    if (naturalSize || !src || typeof Image === "undefined") return
    let alive = true
    const img = new Image()
    img.onload = () => alive && setMeasured({ width: img.naturalWidth, height: img.naturalHeight })
    img.src = src
    return () => {
      alive = false
    }
  }, [src, naturalSize])

  const size = naturalSize ?? measured
  const options = (modes.includes(mode) ? modes : [...modes, mode]).map((m) => ({
    value: m,
    label: MODE_LABELS[m],
  }))

  const takeFile = (f: File | undefined | null) => {
    if (f && (accept === "image/*" ? f.type.startsWith("image/") : true)) onReplace?.(f)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDropping(false)
    takeFile(e.dataTransfer.files[0])
  }

  return (
    <Popover
      title="Image"
      onClose={onClose}
      anchor={anchor}
      placement={placement}
      className="kimo-image-fill"
    >
      <div
        className={cx("kimo-image-fill__preview", dropping && "kimo-image-fill__preview--drop")}
        role="img"
        aria-label={
          size ? `Image preview, ${size.width} by ${size.height} pixels` : "Image preview"
        }
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <div
          className="kimo-image-fill__image"
          style={src ? { ...imageFillBackground(src, mode), opacity } : undefined}
        />
        {size && (
          <div className="kimo-image-fill__badge">
            <span className="kimo-image-fill__badge-label">
              {size.width} × {size.height}
            </span>
          </div>
        )}
      </div>
      <div className="kimo-image-fill__row">
        <span className="kimo-image-fill__label">Mode</span>
        <Select
          dense
          className="kimo-image-fill__mode"
          label="Image mode"
          options={options}
          value={mode}
          onChange={(m) => onModeChange?.(m)}
        />
      </div>
      <div className="kimo-image-fill__row">
        <span className="kimo-image-fill__label">Opacity</span>
        <PropTextField
          className="kimo-image-fill__opacity"
          inputLabel="Image opacity"
          value={percent(opacity)}
          onCommit={(text) => {
            const a = parsePercent(text)
            if (a === null) return false
            onOpacityChange?.(a)
            return true
          }}
        />
      </div>
      <div className="kimo-image-fill__actions">
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload />}
          className="kimo-image-fill__replace"
          onClick={() => file.current?.click()}
        >
          Replace
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 />}
          className="kimo-image-fill__remove"
          onClick={onRemove}
        >
          Remove
        </Button>
        <input
          ref={file}
          type="file"
          accept={accept}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            takeFile(e.currentTarget.files?.[0])
            e.currentTarget.value = ""
          }}
        />
      </div>
    </Popover>
  )
}
