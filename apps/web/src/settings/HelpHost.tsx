/**
 * Runs the Help items in this window (board 25 §7 (b) A0qRF): the native macOS Help menu
 * (`platform.help.onMenu`) and File › Help / ⌘/ ({@link runHelpAction}). Mounted once per
 * window (App).
 *
 * - Kimo documentation / What's new → the default browser.
 * - Keyboard shortcuts → the shortcuts sheet (`openShortcutsSheet`).
 * - Report an issue… → a 400 px quick confirm (rule "Confirm width"), then a prefilled GitHub
 *   issue with the diagnostics block (rule RkNqb: never file content or keys).
 * - Copy diagnostics → the same block on the clipboard (desktop: through Rust, since a native menu
 *   item is no user gesture for WKWebView; G3), confirmed with a "Copied diagnostics" toast.
 * - A failure shows Toast/Danger "Couldn't …" (board 37 `ra5wy`).
 * - Show logs → `platform.help.showLogs()` (desktop).
 */
import type { KimoPlatform } from "@kimo/platform"
import { Dialog, Toast } from "@kimo/ui"
import { Bug } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { failureText } from "../editor/errors"
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

function diagnosticsFor(platform: KimoPlatform): string {
  return diagnosticsBlock(versionInfo(platform), {
    host: platform.kind,
    renderer: rendererLabel(),
    locale: typeof navigator === "undefined" ? "unknown" : navigator.language,
  })
}

export function HelpHost({
  platform,
  writeClipboard = (t) =>
    platform.clipboard ? platform.clipboard.writeText(t) : navigator.clipboard.writeText(t),
}: {
  platform: KimoPlatform
  /** Clipboard writer (tests). */
  writeClipboard?: (text: string) => Promise<void>
}) {
  const [report, setReport] = useState<string | null>(null)
  const [toast, setToast] = useState<{ tone: "success" | "danger"; text: string } | null>(null)
  const latest = useRef({ platform, writeClipboard })
  latest.current = { platform, writeClipboard }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const fail = (what: string) => (e: unknown) =>
      setToast({ tone: "danger", text: failureText(what, e) })
    const run = (a: HelpAction) => {
      const { platform: p, writeClipboard: write } = latest.current
      const open = (url: string) => void p.files.openExternalUrl(url).catch(fail("open the link"))
      switch (a) {
        case "docs":
          return open(DOCS_URL)
        case "whats-new":
          return open(releaseNotesUrl(p.appVersion))
        case "shortcuts":
          return openShortcutsSheet()
        case "copy-diagnostics":
          return void write(diagnosticsFor(p)).then(
            () => setToast({ tone: "success", text: "Copied diagnostics" }),
            fail("copy diagnostics"),
          )
        case "report-issue":
          return setReport(diagnosticsFor(p))
        case "logs":
          return void p.help?.showLogs().catch(fail("show the logs"))
      }
    }
    const offBus = onHelpAction(run)
    const offMenu = platform.help?.onMenu(run)
    return () => {
      offBus()
      offMenu?.()
    }
  }, [platform])

  const toastView = toast && (
    <div className="updater-toasts" aria-live="polite">
      <Toast tone={toast.tone} data-testid="help-toast">
        {toast.text}
      </Toast>
    </div>
  )
  if (report === null) return toastView
  return (
    <div className="kimo-dialog-scrim">
      {toastView}
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
          void platform.files
            .openExternalUrl(url)
            .catch((e: unknown) =>
              setToast({ tone: "danger", text: failureText("open GitHub", e) }),
            )
        }}
        data-testid="report-issue-confirm"
      />
    </div>
  )
}
