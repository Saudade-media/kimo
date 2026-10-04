/**
 * The open-source licence list (board 25 §7 rule "Licenses"), generated at build time by
 * `apps/web/scripts/gen-notices.ts` from bun.lock + Cargo.lock + the bundled fonts. The texts are
 * a lazy chunk: only a row's sheet loads them.
 */
import list from "./generated/notices.json"

export interface Notice {
  name: string
  version: string
  license: string
  source: "npm" | "cargo" | "font"
  /** Key into the texts; null when the package ships no licence file. */
  text: string | null
}

export const NOTICES: readonly Notice[] = (list as { packages: Notice[] }).packages

/** Count badge (ifabF): "513 packages". */
export function noticeCount(n: number): string {
  return `${n} package${n === 1 ? "" : "s"}`
}

/** Filter packages (sUdQd): matches name, version or licence, case-insensitive. */
export function filterNotices(all: readonly Notice[], query: string): readonly Notice[] {
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter(
    (n) =>
      n.name.toLowerCase().includes(q) ||
      n.license.toLowerCase().includes(q) ||
      n.version.toLowerCase().startsWith(q),
  )
}

let texts: Promise<Record<string, string>> | null = null
/** A package's full licence text (null: the package ships none). */
export async function noticeText(n: Notice): Promise<string | null> {
  if (!n.text) return null
  texts ??= import("./generated/notices-texts.json").then(
    (m) => (m as { default: Record<string, string> }).default,
  )
  return (await texts)[n.text] ?? null
}

/** The shipped THIRD_PARTY_NOTICES.txt (apps/web/public), next to the app's index.html. */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt"
