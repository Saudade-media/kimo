/**
 * The editor's failure copy (audit A5): every failed action shows "Couldn't <what>. <cause>."
 * (docs/style/writing.md "Errors say what failed"), never a console line alone.
 */

/** The cause of `e` as one sentence ("Permission denied."); "" when there is none. */
export function causeOf(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : typeof e === "object" &&
            e !== null &&
            typeof (e as { message?: unknown }).message === "string"
          ? (e as { message: string }).message
          : ""
  const text = raw.trim().replace(/^Error:\s*/, "")
  if (!text) return ""
  const first = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.?!…]$/.test(first) ? first : `${first}.`
}

/** "Couldn't add the image. Image is too large (40 MB; the limit is 25 MB)." */
export function failureText(what: string, e?: unknown): string {
  const cause = e === undefined ? "" : causeOf(e)
  return cause ? `Couldn't ${what}. ${cause}` : `Couldn't ${what}.`
}
