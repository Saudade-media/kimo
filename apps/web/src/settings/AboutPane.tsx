/**
 * Settings › About & licenses — board 25 §7 (a) "Settings Window · About & licenses" (cKZbq),
 * Content Hpfqb (column, padding [0, 32, 24, 32]):
 *
 *   Title Bar (j9qn2) 56, center: Title sans 14 / 600 text-primary.
 *   Identity (urFVA) row, gap 16, padding [8, 0, 20, 0], center, bottom stroke 1 border:
 *     App Icon (mWCUl) 56 radius 14 — the app icon, ink plate #0A0A0A + white KimoLogo (board 26
 *     §4 KlpS9; the mark is 60% of the plate as in the icon masters gTG4w: 308/512, 116/192) ·
 *     Text (kynKB) column gap 3 fill: Name sans 20 / 600 -0.3 · Version mono 11 text-secondary
 *     · Tagline sans 11 text-tertiary ·
 *     Actions (ipXh7) row gap 6: Copy version info (Button/Ghost, h 28, [0, 12], icon copy 14,
 *     label 12 text-primary) · Check for updates… (Button/Secondary, h 28, [0, 12], refresh-cw).
 *   Links (t4H8L) column, padding [8, 0], bottom stroke: rows 36, gap 10, center: icon 16
 *     text-secondary · Label sans 12 / 500 · Meta sans 11 text-tertiary · Spacer · arrow-up-right
 *     14 text-tertiary (book-open / git-branch / scroll-text / shield).
 *   Licenses Header (sdWA6) row gap 8, padding [20, 0, 10, 0], center: Title sans 13 / 600 ·
 *     Count Badge (jrIWa) · Spacer · Filter Input (Zs05d) 180 × 28, icon search 14, text 12.
 *   License List (QmPSy) column, padding [4, 14], bg-subtle, stroke 1 border, radius-lg: rows 34,
 *     gap 10, center, bottom stroke (not the last): Package mono 11 / 500 · Version mono 11
 *     text-tertiary · Spacer · License pill (padding [1, 8], bg-app, stroke 1 border, mono 11
 *     text-secondary) · chevron-right 14 text-tertiary. A row opens its licence text.
 *   Licenses Footer (ILW2H) row gap 6, padding [10, 0, 0, 0], center: file-text 12 · Note sans
 *     11 text-tertiary · Spacer · "Open file" sans 11 / 500 text-primary.
 *
 * Everything is real: the version string ({@link versionInfo}), the links ({@link aboutLinks}),
 * and the licence list generated from the lockfiles ({@link NOTICES}).
 */
import { Badge, Button, Dialog, Input, KimoLogo } from "@kimo/ui"
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  FileText,
  GitBranch,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { aboutLinks } from "./help"
import { useUpdaterStatus } from "./hooks"
import {
  filterNotices,
  NOTICES,
  NOTICES_FILE,
  type Notice,
  noticeCount,
  noticeText,
} from "./notices"
import type { PaneProps } from "./panes"
import { versionInfo, versionLine, versionString } from "./version-info"

const LINK_ICONS = {
  "book-open": BookOpen,
  "git-branch": GitBranch,
  "scroll-text": ScrollText,
  shield: Shield,
} as const

/** "Copied" stays this long on Copy version info. */
const COPIED_MS = 1500

export function AboutPane({
  platform,
  notices = NOTICES,
  writeClipboard = (t) => navigator.clipboard.writeText(t),
}: Pick<PaneProps, "platform"> & {
  notices?: readonly Notice[]
  writeClipboard?: (text: string) => Promise<void>
}) {
  const info = useMemo(() => versionInfo(platform), [platform])
  const status = useUpdaterStatus(platform)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState("")
  /** The licence sheet: one package, or the whole THIRD_PARTY_NOTICES.txt (desktop "Open file"). */
  const [sheet, setSheet] = useState<Notice | "all" | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(t)
  }, [copied])
  const shown = filterNotices(notices, query)
  const open = (url: string) => void platform.files.openExternalUrl(url).catch(() => {})
  const openFile = () => {
    // Web: the file is served next to index.html; desktop: it is inside the app bundle, so it
    // opens in the same sheet.
    if (platform.kind === "desktop") setSheet("all")
    else window.open(new URL(NOTICES_FILE, location.href).href, "_blank", "noopener,noreferrer")
  }
  return (
    <>
      <div className="settings-title-bar">
        <h2 className="settings-title settings-title--about">About & licenses</h2>
      </div>
      <div className="about-identity" data-pen="urFVA">
        <span className="about-identity__icon" aria-hidden="true">
          <KimoLogo size={34} className="about-identity__mark" />
        </span>
        <div className="about-identity__text">
          <span className="about-identity__name">Kimo</span>
          <span className="about-identity__version" data-testid="about-version">
            {`Version ${versionLine(info)}`}
          </span>
          <span className="about-identity__tagline">
            Local-first design canvas for you and your agents · MIT
          </span>
        </div>
        <div className="about-identity__actions">
          <Button
            variant="ghost"
            size="sm"
            className="about-button about-button--ghost"
            icon={copied ? <Check /> : <Copy />}
            onClick={() =>
              void writeClipboard(versionString(info))
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            {copied ? "Copied" : "Copy version info"}
          </Button>
          {platform.capabilities.updater && (
            <Button
              variant="secondary"
              size="sm"
              className="about-button"
              icon={<RefreshCw />}
              disabled={status.state === "checking" || status.state === "downloading"}
              onClick={() => void platform.updater.check().catch(() => {})}
            >
              Check for updates…
            </Button>
          )}
        </div>
      </div>
      <div className="about-links" data-pen="t4H8L">
        {aboutLinks(info.version, platform).map((l) => {
          const Icon = LINK_ICONS[l.icon]
          return (
            <button
              key={l.id}
              type="button"
              className="about-link"
              data-link={l.id}
              title={l.url}
              onClick={() => open(l.url)}
            >
              <Icon className="about-link__icon" aria-hidden="true" />
              <span className="about-link__label">{l.label}</span>
              <span className="about-link__meta">{l.meta}</span>
              <span className="about-spacer" />
              <ArrowUpRight className="about-link__out" aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <div className="about-licenses-header" data-pen="sdWA6">
        <h3 className="about-licenses-header__title">Open-source licenses</h3>
        <Badge className="about-count" data-testid="about-license-count">
          {noticeCount(notices.length)}
        </Badge>
        <span className="about-spacer" />
        <Input
          dense
          icon={<Search />}
          placeholder="Filter packages"
          aria-label="Filter packages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          frameProps={{ className: "about-filter" }}
        />
      </div>
      <ul className="about-license-list" data-pen="QmPSy" aria-label="Open-source licenses">
        {shown.map((n) => (
          <li key={`${n.source}:${n.name}@${n.version}`} className="about-license-item">
            <button
              type="button"
              className="about-license"
              aria-label={`${n.name} ${n.version}, ${n.license}`}
              onClick={() => setSheet(n)}
            >
              <span className="about-license__name">{n.name}</span>
              <span className="about-license__version">{n.version}</span>
              <span className="about-spacer" />
              <span className="about-license__spdx">{n.license}</span>
              <ChevronRight className="about-license__chevron" aria-hidden="true" />
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="about-license-empty">No packages match.</li>}
      </ul>
      <div className="about-licenses-footer" data-pen="ILW2H">
        <FileText className="about-licenses-footer__icon" aria-hidden="true" />
        <span className="about-licenses-footer__note">
          {`Full texts ship with the app as ${NOTICES_FILE}`}
        </span>
        <span className="about-spacer" />
        <button type="button" className="about-licenses-footer__link" onClick={openFile}>
          Open file
        </button>
      </div>
      {sheet && <LicenseSheet notice={sheet} onClose={() => setSheet(null)} />}
    </>
  )
}

/** A row's licence text (not designed beyond "a row opens the licence text in a sheet"). */
function LicenseSheet({ notice, onClose }: { notice: Notice | "all"; onClose(): void }) {
  const [text, setText] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const load =
      notice === "all"
        ? fetch(new URL(NOTICES_FILE, location.href).href).then((r) => r.text())
        : noticeText(notice)
    void load
      .then((t) => {
        if (live) setText(t)
      })
      .catch(() => {
        if (live) setText(null)
      })
    return () => {
      live = false
    }
  }, [notice])
  const title = notice === "all" ? NOTICES_FILE : `${notice.name} ${notice.version}`
  const description =
    notice === "all"
      ? "Every third-party licence that ships with Kimo."
      : `${notice.license} · ${notice.source === "cargo" ? "Rust crate" : notice.source === "font" ? "Bundled font" : "JavaScript package"}`
  return (
    <div className="kimo-dialog-scrim">
      <Dialog
        width={560}
        icon={<FileText size={16} />}
        title={title}
        description={description}
        cancelLabel={null}
        confirmLabel="Done"
        onCancel={onClose}
        onConfirm={onClose}
        data-testid="license-sheet"
      >
        <pre className="about-license-text" data-testid="license-text">
          {text === undefined
            ? "Loading…"
            : text === null
              ? `This package ships no licence file. It is distributed under ${notice === "all" ? "the licences listed" : notice.license}.`
              : text}
        </pre>
      </Dialog>
    </div>
  )
}
