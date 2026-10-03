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
import { ImageIcon, PenTool, Trash2, Type } from "lucide-react"
import {
  type AssetFile,
  formatBytes,
  GC_VISIBLE_ROWS,
  gcCommand,
  gcConfirmLabel,
  gcDescription,
  gcMoreLabel,
  gcTitle,
} from "./logic"
import "./assets-gc.css"

export interface CleanUpAssetsDialogProps {
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
