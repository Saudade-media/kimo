/**
 * Board 24 (j) "SVG rejection · details" (nx2kl): the board 20 rejection toast (Toast/Danger
 * "Couldn't import logo.svg — it contains a script" · Details) grows in place into
 * `SvgRejectionDetails` — no modal. Each removed construct is listed with its line; "Import
 * without these" imports the sanitized SVG (explicit consent), "Copy report" copies the list.
 * The collapsed toast dismisses itself after 6 s (board 20); the expanded one stays until the
 * user picks.
 */
import { SvgRejectionDetails, svgRejectionReport, Toast } from "@kimo/ui"
import { CircleX } from "lucide-react"
import { useEffect, useState } from "react"
import type { SvgRejectedError } from "./flow"
import "./svg-import.css"

export interface SvgRejectionToastProps {
  error: SvgRejectedError
  onImport: () => void
  onDismiss: () => void
  /** Collapsed auto-dismiss (ms); 0 = never. Default 6000 (board 20 M4Pij9). */
  autoDismissMs?: number
}

export function SvgRejectionToast({
  error,
  onImport,
  onDismiss,
  autoDismissMs = 6000,
}: SvgRejectionToastProps) {
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState(false)
  useEffect(() => {
    if (expanded || hover || !autoDismissMs) return
    const t = setTimeout(onDismiss, autoDismissMs)
    return () => clearTimeout(t)
  }, [expanded, hover, autoDismissMs, onDismiss])
  return (
    <div
      className="svg-rejection-toast"
      data-testid="svg-rejection-toast"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {expanded ? (
        <SvgRejectionDetails
          fileName={error.fileName}
          items={error.items}
          onHide={() => setExpanded(false)}
          onCopyReport={() =>
            void globalThis.navigator?.clipboard
              ?.writeText(svgRejectionReport(error.fileName, error.items))
              .catch(() => {})
          }
          onCancel={onDismiss}
          onImport={onImport}
        />
      ) : (
        <Toast
          tone="danger"
          icon={<CircleX />}
          data-tone="danger"
          actionLabel={error.items.length > 0 ? "Details" : undefined}
          onAction={() => setExpanded(true)}
        >
          {error.message}
        </Toast>
      )}
    </div>
  )
}
