/**
 * Test result strip (board 25 "v1 Polish" §4 c7lVl; success mXNdJ / TUwHz on board 23).
 *
 *   Test Result (MrP5Y …) row, gap 8, padding [6, 10], center, radius-sm, fill success-soft /
 *     danger-soft / warning-soft › Icon 14 (status colour) · Label sans 11 / 600 (status colour)
 *     · Detail mono 11 text-secondary · Spacer · Action sans 11 / 500 text-primary "Details"
 *   Expanded (FhxWF): column, gap 8, padding [8, 10] › Head (tsAzG, the row above, "Hide
 *     details") · Details (bWSl9) column gap 2, padding [6, 8], bg-app, radius-xs, Lines mono 11
 *     text-secondary · Actions (KTl6a) row gap 6: Retry test (Button/Secondary h 24, padding
 *     [0, 10], rotate-ccw 12, label 11) · Copy details (Button/Ghost, copy 12).
 *
 * A success has no Details (board 23 mXNdJ).
 */
import { CompactButton } from "@kimo/ui"
import {
  CircleCheck,
  CircleX,
  ClockAlert,
  Copy,
  RotateCcw,
  ShieldX,
  TriangleAlert,
  WifiOff,
} from "lucide-react"
import { useContext, useState } from "react"
import { SettingsFailContext } from "../settings/panes"
import { type StoredTest, type TestStrip, testStrip } from "./model"
import "./polish.css"

const ICONS: Record<TestStrip["icon"], typeof CircleX> = {
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  "wifi-off": WifiOff,
  "shield-x": ShieldX,
  "triangle-alert": TriangleAlert,
  "clock-alert": ClockAlert,
}

/** The four Details lines (board 25 bWSl9): request, status + latency, body, auth (masked). */
export function traceLines(t: StoredTest): string[] {
  const tr = t.trace
  if (!tr) return [t.detail]
  return [tr.request, tr.response, tr.body, tr.auth].filter((l) => l.trim() !== "")
}

export interface TestResultProps {
  test: StoredTest
  /** Appended to the CORS detail on the web (the provider matrix "how"). */
  hint?: string
  onRetry?: () => void
  onCopy?: (text: string) => void
  retrying?: boolean
}

export function TestResult({ test, hint, onRetry, onCopy, retrying = false }: TestResultProps) {
  const fail = useContext(SettingsFailContext)
  const [open, setOpen] = useState(false)
  const s = testStrip(test)
  const Icon = ICONS[s.icon]
  const tone = s.tone === "success" ? "ok" : s.tone === "warning" ? "warn" : "fail"
  const canExpand = !test.ok
  const lines = traceLines(test)
  const head = (
    <>
      <Icon className="ai-test__icon" aria-hidden="true" />
      <span className="ai-test__label">{s.label}</span>
      <span className="ai-test__detail">
        {s.detail}
        {hint ? ` · ${hint}` : ""}
      </span>
      {canExpand && (
        <>
          <span className="ai-spacer" aria-hidden="true" />
          <button
            type="button"
            className="ai-test__action"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide details" : "Details"}
          </button>
        </>
      )}
    </>
  )
  if (!open)
    return (
      <div
        className={`ai-test ai-test--${tone}`}
        data-pen={test.ok ? "TUwHz" : "MrP5Y"}
        data-error-kind={test.errorKind}
        role={test.ok ? "status" : "alert"}
      >
        {head}
      </div>
    )
  return (
    <div
      className={`ai-test ai-test--${tone} ai-test--expanded`}
      data-pen="FhxWF"
      data-error-kind={test.errorKind}
      role="alert"
    >
      <div className="ai-test__head" data-pen="tsAzG">
        {head}
      </div>
      <div className="ai-test__details" data-pen="bWSl9">
        {lines.map((l) => (
          <span key={l} className="ai-test__line">
            {l}
          </span>
        ))}
      </div>
      <div className="ai-test__actions" data-pen="KTl6a">
        <CompactButton
          variant="secondary"
          height={24}
          padX={10}
          text="xs"
          className="ai-test__button"
          icon={<RotateCcw />}
          disabled={retrying}
          onClick={onRetry}
        >
          Retry test
        </CompactButton>
        <CompactButton
          variant="ghost"
          height={24}
          padX={10}
          text="xs"
          className="ai-test__button"
          icon={<Copy />}
          onClick={() => {
            const text = lines.join("\n")
            if (onCopy) onCopy(text)
            else if (!navigator.clipboard)
              fail("copy the details", new Error("The clipboard isn't available here"))
            else
              void navigator.clipboard
                .writeText(text)
                .catch((e: unknown) => fail("copy the details", e))
          }}
        >
          Copy details
        </CompactButton>
      </div>
    </div>
  )
}
