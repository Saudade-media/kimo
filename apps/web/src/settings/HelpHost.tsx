/**
 * Runs the Help items in this window (board 25 §7 (b) A0qRF): the native macOS Help menu
 * (`platform.help.onMenu`) and File › Help / ⌘/ ({@link runHelpAction}). Mounted once per
 * window (App).
 *
 * - Kimo documentation / What's new → the default browser.
 * - Keyboard shortcuts → the shortcuts sheet (`openShortcutsSheet`).
 * - Report an issue… → a 400 px quick confirm (rule "Confirm width"), then a prefilled GitHub
 *   issue with the diagnostics block (rule RkNqb: never file content or keys).
 * - Copy diagnostics → the same block on the clipboard.
 * - Show logs → `platform.help.showLogs()` (desktop).
 */
import type { KimoPlatform } from "@kimo/platform"
import { Dialog } from "@kimo/ui"
import { Bug } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { openShortcutsSheet } from "../shortcuts/open"
import {
  DOCS_URL,
  diagnosticsBlock,
  type HelpAction,
  onHelpAction,
  releaseNotesUrl,
  rendererLabel,
  reportIssueUrl,
} from "./help"
import { versionInfo } from "./version-info"

export function diagnosticsFor(platform: KimoPlatform): string {
  return diagnosticsBlock(versionInfo(platform), {
    host: platform.kind,
    renderer: rendererLabel(),
    locale: typeof navigator === "undefined" ? "unknown" : navigator.language,
  })
}

export function HelpHost({
  platform,
  writeClipboard = (t) => navigator.clipboard.writeText(t),
}: {
  platform: KimoPlatform
  /** Clipboard writer (tests). */
  writeClipboard?: (text: string) => Promise<void>
}) {
  const [report, setReport] = useState<string | null>(null)
  const latest = useRef({ platform, writeClipboard })
  latest.current = { platform, writeClipboard }

  useEffect(() => {
    const run = (a: HelpAction) => {
      const { platform: p, writeClipboard: write } = latest.current
      const open = (url: string) => void p.files.openExternalUrl(url).catch(() => {})
      switch (a) {
        case "docs":
          return open(DOCS_URL)
        case "whats-new":
          return open(releaseNotesUrl(p.appVersion))
        case "shortcuts":
          return openShortcutsSheet()
        case "copy-diagnostics":
          return void write(diagnosticsFor(p)).catch(() => {})
        case "report-issue":
          return setReport(diagnosticsFor(p))
        case "logs":
          return void p.help?.showLogs().catch(() => {})
      }
    }
    const offBus = onHelpAction(run)
    const offMenu = platform.help?.onMenu(run)
    return () => {
      offBus()
      offMenu?.()
    }
  }, [platform])

  if (report === null) return null
  return (
    <div className="kimo-dialog-scrim">
      <Dialog
        size="sm"
        icon={<Bug size={16} />}
        title="Report an issue on GitHub?"
        description="Opens a new issue in your browser with Kimo's version, OS and renderer filled in. No file content, paths or keys are sent."
        confirmLabel="Open GitHub"
        onCancel={() => setReport(null)}
        onConfirm={() => {
          const url = reportIssueUrl(report)
          setReport(null)
          void platform.files.openExternalUrl(url).catch(() => {})
        }}
        data-testid="report-issue-confirm"
      />
    </div>
  )
}
