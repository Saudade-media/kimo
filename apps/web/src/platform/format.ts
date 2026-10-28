/**
 * Display formatting for the M4 file UI (boards 16–17): shortened paths (`~/Projects/loom`),
 * clock times ("10:42"), byte sizes ("0 B") and the Home MODIFIED column ("Just now",
 * "12 min ago", "Yesterday", "Mon", "Sep 28").
 */
import type { FileRef } from "@kimo/platform"

/** `/Users/me/Projects/x` → `~/Projects/x`; `fsa:<id>/a/b` → `a/b`; other refs unchanged. */
export function displayPath(ref: FileRef): string {
  if (ref.startsWith("fsa:")) return ref.replace(/^fsa:[^/]*\/?/, "")
  if (ref.startsWith("upload:")) return ref.replace(/^upload:[^/]*\/?/, "")
  return ref
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~")
}

/** The containing folder of `ref`, shortened ({@link displayPath}). */
export function displayDir(ref: FileRef): string {
  const d = displayPath(ref)
  const i = Math.max(d.lastIndexOf("/"), d.lastIndexOf("\\"))
  return i > 0 ? d.slice(0, i) : d
}

/** Last path segment. */
export function fileNameOf(ref: FileRef): string {
  return ref.split(/[/\\]/).pop() || ref
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "10:42" (24 h, local time). */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "10:42:18" (24 h, local time): the saved-pill tooltip. */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** "0 B", "12 KB", "3.4 MB". */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Home MODIFIED column (board 16): "Just now", "12 min ago", "3 h ago", "Yesterday", "Mon", "Sep 28". */
export function modifiedLabel(ms: number, now: number): string {
  const diff = Math.max(0, now - ms)
  if (diff < 60_000) return "Just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  const d = new Date(ms)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ms >= startOfToday) return `${Math.floor(diff / 3_600_000)} h ago`
  if (ms >= startOfToday - 86_400_000) return "Yesterday"
  if (ms >= startOfToday - 6 * 86_400_000) return DAYS[d.getDay()] as string
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** `"0.6.1"` → `"0.6"`. */
export function majorMinor(format: string | null | undefined): string {
  if (!format) return "?"
  const m = /^(\d+)\.(\d+)/.exec(format)
  return m ? `${m[1]}.${m[2]}` : format
}

/** Formatters for `bannerCopy`. */
export function bannerFormatters(os: "macos" | "windows" | "linux" | "web") {
  return { os, formatBytes, formatTime, displayDir }
}
