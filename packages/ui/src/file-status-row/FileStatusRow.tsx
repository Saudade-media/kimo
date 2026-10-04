import { CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Per-file export status (board 25 §2 b / c). */
export type FileStatus = "written" | "writing" | "queued" | "failed" | "skipped"

/** Props for {@link FileStatusRow}. Remaining `<div>` props go to the row. */
export interface FileStatusRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  status: FileStatus
}

const ICON = {
  written: CircleCheck,
  writing: LoaderCircle,
  queued: CircleDashed,
  failed: CircleX,
  skipped: CircleDashed,
} as const

const LABEL: Record<FileStatus, string> = {
  written: "written",
  writing: "writing…",
  queued: "queued",
  failed: "failed",
  skipped: "skipped",
}

/**
 * One file of the export progress / error list. Mirrors `File · Hero.tsx` (OJUH8): row fill,
 * gap 8, padding [6, 0], center › Icon 14 (circle-check success · loader-circle text-primary ·
 * circle-dashed text-tertiary · circle-x danger) › Name mono 11 / 500 text-primary › Spacer ›
 * Status sans 11 (written / queued / skipped text-tertiary · writing… text-secondary · failed
 * danger).
 */
export function FileStatusRow({ name, status, className, ...rest }: FileStatusRowProps) {
  const Glyph = ICON[status]
  return (
    <div
      {...rest}
      data-status={status}
      className={cx("kimo-file-status", `kimo-file-status--${status}`, className)}
    >
      <Glyph className="kimo-file-status__icon" aria-hidden="true" />
      <span className="kimo-file-status__name">{name}</span>
      <span className="kimo-file-status__spacer" />
      <span className="kimo-file-status__status">{LABEL[status]}</span>
    </div>
  )
}
