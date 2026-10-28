/**
 * Clean up assets (board 19 `Vqeu7`, "Clean up assets · same as kimo gc"): a Dialog (bDVhS)
 * instance at width 520. Icon Wrap danger-soft, icon `trash-2` danger; "Remove 7 unused
 * assets?"; Body (Q0AE8): column, padding [4, 12], bg-subtle, radius-md; rows (tsd5P …) 36 tall,
 * bottom stroke 1 border, gap 10, center: Thumb 24 bg-muted radius-xs (icon 12 `image` /
 * `pen-tool` text-tertiary) · Path mono 11 text-secondary · Spacer · Size sans 11 text-tertiary;
 * More (SxKZ0) 32 tall: "+ 3 more · 4.3 MB" sans 11 text-tertiary. Footer: Footnote
 * `kimo gc ./marketing.kimo` · Cancel · Remove 7 files.
 */

import { Dialog } from "@kimo/ui"
import { CircleCheck, ImageIcon, Images, PenTool, Trash2, Type } from "lucide-react"
import {
  type AssetFile,
  formatBytes,
  GC_NOTHING_TITLE,
  GC_VISIBLE_ROWS,
  gcCommand,
  gcConfirmLabel,
  gcDescription,
  gcMoreLabel,
  gcNothingDescription,
  gcSummary,
  gcTitle,
} from "./logic"
import "./assets-gc.css"

interface CleanUpAssetsDialogProps {
  fileName: string
  unused: readonly AssetFile[]
  onCancel: () => void
  onConfirm: () => void
  /** Removal in progress (Confirm disabled). */
  busy?: boolean
  inline?: boolean
}

function thumbIcon(name: string) {
  if (/\.svg$/i.test(name)) return <PenTool />
  if (/\.(ttf|otf|woff2?)$/i.test(name)) return <Type />
  return <ImageIcon />
}

export function CleanUpAssetsDialog({
  fileName,
  unused,
  onCancel,
  onConfirm,
  busy = false,
  inline = false,
}: CleanUpAssetsDialogProps) {
  const total = unused.reduce((s, f) => s + f.bytes, 0)
  const shown = unused.slice(0, GC_VISIBLE_ROWS)
  const rest = unused.slice(GC_VISIBLE_ROWS)
  return (
    <Dialog
      width={520}
      tone="danger"
      inline={inline}
      icon={<Trash2 />}
      title={gcTitle(unused.length)}
      description={gcDescription(fileName, total)}
      footnote={gcCommand(fileName)}
      confirmLabel={gcConfirmLabel(unused.length)}
      confirmDisabled={busy || unused.length === 0}
      onCancel={onCancel}
      onConfirm={onConfirm}
      data-pen="Vqeu7"
    >
      <ul className="gc-body" aria-label="Unused assets">
        {shown.map((f) => (
          <li key={f.name} className="gc-row">
            <span className="gc-row__thumb" aria-hidden="true">
              {thumbIcon(f.name)}
            </span>
            <span className="gc-row__path">{`assets/${f.name}`}</span>
            <span className="gc-row__spacer" aria-hidden="true" />
            <span className="gc-row__size">{formatBytes(f.bytes)}</span>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="gc-more">
            <span className="gc-more__label">{gcMoreLabel(rest)}</span>
          </li>
        )}
      </ul>
    </Dialog>
  )
}

interface CleanUpNothingDialogProps {
  fileName: string
  /** Files in `assets/` and their total size (Summary "12 assets · 31.4 MB"). */
  count: number
  bytes: number
  onDone: () => void
  inline?: boolean
}

/**
 * Board 20 "Clean up assets · nothing to remove" (nsxuR): the same Dialog at width 520 with a
 * success Icon Wrap (success-soft, `circle-check` success), "Nothing to clean up", Body (n3opt):
 * row h 36, bg-subtle, radius-md, gap 10, padding [0, 12], center: `images` 14 text-tertiary ·
 * Summary sans 11 text-secondary · Spacer · State "all referenced" sans 11 text-tertiary.
 * Footer: Footnote `kimo gc ./marketing.kimo`, a single "Done" (Cancel hidden); Enter / Esc close.
 */
export function CleanUpNothingDialog({
  fileName,
  count,
  bytes,
  onDone,
  inline = false,
}: CleanUpNothingDialogProps) {
  return (
    <Dialog
      width={520}
      tone="success"
      inline={inline}
      icon={<CircleCheck />}
      title={GC_NOTHING_TITLE}
      description={gcNothingDescription(fileName)}
      footnote={gcCommand(fileName)}
      cancelLabel={null}
      confirmLabel="Done"
      onCancel={onDone}
      onConfirm={onDone}
      data-pen="nsxuR"
    >
      <div className="gc-nothing">
        <Images className="gc-nothing__icon" aria-hidden="true" />
        <span className="gc-nothing__summary">{gcSummary(count, bytes)}</span>
        <span className="gc-row__spacer" aria-hidden="true" />
        <span className="gc-nothing__state">all referenced</span>
      </div>
    </Dialog>
  )
}
