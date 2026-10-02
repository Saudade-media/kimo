/**
 * Image fill popover (board 09 `wM79U` › `Kgfrv`): the `@kimo/ui` ImageFillPopover over an
 * image paint. Replace (dialog or a file dropped on the preview) stores the file in the
 * file's content-addressed asset store and points the paint at the new `./assets/…` ref.
 */
import { ImageFillPopover as ImageFillPopoverUi } from "@kimo/ui"
import { useRef } from "react"
import { IMAGE_ACCEPT } from "../../lib/assets"
import { panelPlacement, useAssetSize, useAssetUrls, usePanel } from "../panel-context"

type Fit = "cover" | "contain" | "stretch" | "tile"

/** Board 09 lists Cover · Contain · Stretch; Tile shows only when the paint already uses it. */
const MODES: readonly Fit[] = ["cover", "contain", "stretch"]

export { IMAGE_ACCEPT } from "../../lib/assets"

export function ImageFillPopover({
  anchor,
  paint,
  onChange,
  onRemove,
  onClose,
}: {
  anchor: HTMLElement
  paint: Record<string, unknown>
  onChange(next: unknown): void
  onRemove(): void
  onClose(): void
}) {
  const { assets } = usePanel()
  // Replace awaits hashing: apply to the paint and write path as they are when it finishes,
  // not as captured when the file was picked (a change made meanwhile would be overwritten).
  const latest = useRef({ paint, onChange })
  latest.current = { paint, onChange }
  const src = typeof paint.src === "string" ? paint.src : null
  const url = useAssetUrls(src ? [src] : [])
  const size = useAssetSize(src)
  const fit = (typeof paint.fit === "string" ? paint.fit : "cover") as Fit
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1
  const href = src ? url(src) : null
  return (
    <ImageFillPopoverUi
      anchor={anchor}
      placement={panelPlacement(anchor)}
      src={href ?? undefined}
      naturalSize={size ?? undefined}
      mode={fit}
      modes={fit === "tile" ? [...MODES, "tile"] : MODES}
      opacity={opacity}
      accept={IMAGE_ACCEPT}
      onModeChange={(m) => {
        const { fit: _, ...rest } = paint
        onChange(m === "cover" ? rest : { ...rest, fit: m })
      }}
      onOpacityChange={(a) => {
        const { opacity: _, ...rest } = paint
        onChange(a >= 1 ? rest : { ...rest, opacity: Math.max(0, a) })
      }}
      onReplace={(file) => {
        if (!assets) return
        assets.put(file).then(
          (info) => latest.current.onChange({ ...latest.current.paint, src: info.src }),
          (e) => console.warn("Kimo: image import failed", e),
        )
      }}
      onRemove={onRemove}
      onClose={onClose}
    />
  )
}
