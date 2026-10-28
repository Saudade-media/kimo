/**
 * Kimo-managed local copies of workspace files that are not on disk (ADR 0019 decision 3): on
 * desktop a `.kimo` file per room in a folder Kimo keeps (`<Kimo home>/workspaces/<workspace>/`),
 * written through the platform's files API. The copy starts as an empty document: once bound, it
 * opens in its room, which fills it (a bound file contributes only what it changed since its last
 * recorded save, and a new copy has none). "Save as" copies it anywhere. On web the copy is the
 * room's replica in the browser, so there is nothing to create.
 */
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import type { KimoPlatform } from "@kimo/platform"
import type { ManagedCopies } from "./workspaces"

/** A file name from a display name: no separators or control characters, at most 80 characters. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
  return cleaned || "Untitled"
}

export function desktopManagedCopies(
  platform: Pick<KimoPlatform, "files" | "kimoHome">,
): ManagedCopies | null {
  const home = platform.kimoHome?.replace(/[\\/]+$/, "")
  if (!home) return null
  return {
    async create(input) {
      const dir = `${home}/workspaces/${safeFileName(input.workspaceId)}`
      // The room id keeps two files of the same name apart; it never changes for a room.
      const path = `${dir}/${safeFileName(input.name)} (${input.room.slice(0, 6)}).kimo`
      const existing = await platform.files.stat(path).catch(() => null)
      if (existing) return path
      const doc = createEmptyDocument(input.name)
      await platform.files.writeTextAtomic(path, serialize(doc), { mkdirs: true })
      return path
    },
  }
}
