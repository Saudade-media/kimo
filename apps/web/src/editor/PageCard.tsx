/**
 * Board 44 §2 "Right Card · Page" (0a6xPwPNg3): with nothing selected the Design tab shrinks the
 * right card to 256 wide, height hugging its content. After the Card Header and the tabs:
 *
 * - Page (TSALRA0KWs): top stroke 1, column gap 8, padding 12. Page Header (row, space-between,
 *   center): "Page" text-sm 600 text-primary, the page name text-sm text-tertiary. Background
 *   (cgc88Wl0bR): h 28, radius-sm, bg-muted, row gap 8, padding [0, 8], center; Swatch 14 ×
 *   14 radius-2xs, stroke border-strong; hex mono text-sm text-primary.
 * - Export (r6wbtEA8uy): top stroke 1, row, padding 12, space-between, center; "Export" text-sm
 *   600 text-primary, plus 14 text-tertiary (opens the Export dialog).
 * - Hint (3ihRPUDkhc): top stroke 1, row gap 6, padding [10, 12, 12, 12], center;
 *   mouse-pointer-2 12 and "Select a layer to edit it" text-sm, both text-tertiary.
 *
 * The page background is the canvas background ($bg-canvas): files have no per-page
 * background yet, so the row shows it read-only.
 */
import { useMemo } from "react"
import { Icon } from "../lib/icons"
import { cssToken, useTheme } from "../lib/theme"
import { useActivePageName } from "./pages/PagesStrip"
import type { FileSession } from "./session"

export function PageCard({ session, onExport }: { session: FileSession; onExport?: () => void }) {
  const name = useActivePageName(session)
  const theme = useTheme()
  const hex = useMemo(() => {
    void theme
    return cssToken("--kimo-bg-canvas").replace(/^#/, "").toUpperCase()
  }, [theme])
  return (
    <div className="page-card" data-testid="page-card">
      <div className="page-card__page">
        <div className="page-card__page-header">
          <span className="page-card__title">Page</span>
          <span className="page-card__page-name">{name}</span>
        </div>
        <div className="page-card__background">
          <span className="page-card__swatch" />
          <span className="page-card__hex">{hex}</span>
        </div>
      </div>
      <div className="page-card__export">
        <span className="page-card__title">Export</span>
        {onExport && (
          <button
            type="button"
            className="page-card__add"
            aria-label="Export…"
            onClick={() => onExport()}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      <div className="page-card__hint">
        <span className="page-card__hint-icon">
          <Icon name="mouse-pointer-2" size={12} />
        </span>
        <span className="page-card__hint-label">Select a layer to edit it</span>
      </div>
    </div>
  )
}
