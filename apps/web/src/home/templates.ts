/**
 * Board 37 §2 Templates (B1): the templates bundled with Kimo (`@kimo/templates`) with their
 * cover images. Picking one copies the file and opens it, no dialog (rules "Templates"):
 * - desktop writes it to Files › New files go to, `landing 2.kimo` on a taken name, and copies an
 *   imported library next to it (the `imports` path is rewritten) so the import still resolves;
 * - web adds it to the browser library under the template name (`Landing page 2` when taken)
 *   and stores the imported library as the file's library snapshot.
 * The documents load lazily (fetched on pick); the covers are asset URLs.
 */
import type { KimoDocument } from "@kimo/core-schema"
import { serialize } from "@kimo/editor-state"
import { type FileRef, KIMO_FILE_FILTER, type KimoPlatform } from "@kimo/platform"
import { getTemplate, listTemplates, loadTemplate } from "@kimo/templates"
import { LibraryManager } from "../editor/m3/libraries"
import { importKimoFile, listFiles, patchFile } from "../lib/files"
import { defaultNewFilesDir } from "../settings/model"
import { joinPath, numberedName } from "./model"

export interface TemplateLibrary {
  alias: string
  /** Example folder and file of the library. */
  dir: string
  file: string
}

export interface Template {
  /** Example folder (`examples/<dir>`). */
  dir: string
  /** The `.kimo` inside it; also the desktop file name. */
  file: string
  /** Card name (QgWel) and the web file name. */
  name: string
  /** Card info (h1X02). */
  info: string
  /** A library the template imports (copied alongside). */
  library?: TemplateLibrary
}

/**
 * The templates bundled with Kimo (`@kimo/templates`, 10 files built by
 * `scripts/build-templates.ts`): each is self-contained, with its own component library and
 * tokens, so none imports a library.
 */
export const TEMPLATES: readonly Template[] = listTemplates().map((t) => ({
  dir: t.slug,
  file: `${t.slug}.kimo`,
  name: t.name,
  info: t.category,
}))

/** The template's cover PNG URL. */
export const previewUrl = (dir: string): string | undefined => getTemplate(dir)?.cover

/** Text of a bundled template (`dir` is its slug). */
export async function loadExample(dir: string, _file: string): Promise<string> {
  return loadTemplate(dir)
}

/** A consumer document with `imports[alias]` pointed at `path`, in canonical form. */
export function relinkImport(text: string, alias: string, path: string): string {
  const doc = JSON.parse(text) as KimoDocument
  doc.imports = { ...(doc.imports ?? {}), [alias]: path }
  return serialize(doc)
}

export type TemplateLoader = (dir: string, file: string) => Promise<string>

/** Names of the `.kimo` files in `dir` (none when the folder doesn't exist yet). */
async function namesIn(platform: KimoPlatform, dir: FileRef): Promise<Set<string>> {
  const list = await platform.files.list(dir).catch((e: unknown) => {
    if ((e as { code?: string })?.code === "NOT_FOUND") return []
    throw e
  })
  return new Set(list.map((s) => s.name))
}

/** Desktop: writes the template into `dir` (the New files folder by default). */
export async function createTemplateOnDisk(
  platform: KimoPlatform,
  t: Template,
  load: TemplateLoader = loadExample,
  dir: FileRef = defaultNewFilesDir(platform),
  /** Save as… picked the exact file. */
  exact?: FileRef,
): Promise<FileRef> {
  const taken = await namesIn(platform, dir)
  let text = await load(t.dir, t.file)
  if (t.library) {
    const libText = await load(t.library.dir, t.library.file)
    // Reuse an identical copy already there; otherwise the next free name.
    let libName = t.library.file
    if (taken.has(libName)) {
      const cur = await platform.files.readText(joinPath(dir, libName)).catch(() => null)
      if (cur?.text !== libText) libName = numberedName(t.library.file, (n) => taken.has(n))
    }
    const libRef = joinPath(dir, libName)
    if (!taken.has(libName)) await platform.files.writeTextAtomic(libRef, libText, { mkdirs: true })
    taken.add(libName)
    text = relinkImport(text, t.library.alias, libName)
  }
  const ref =
    exact ??
    joinPath(
      dir,
      numberedName(t.file, (n) => taken.has(n)),
    )
  await platform.files.writeTextAtomic(ref, text, { mkdirs: true })
  await platform.recents.noteOpened(ref).catch(() => {})
  return ref
}

/** Desktop "Choose folder…" after a failed create: Save as…, then the same write there. */
export async function createTemplateWithSaveAs(
  platform: KimoPlatform,
  t: Template,
  load: TemplateLoader = loadExample,
): Promise<FileRef | null> {
  const target = await platform.dialogs.saveFile({
    title: "Save as",
    suggestedName: t.file,
    filters: [KIMO_FILE_FILTER],
  })
  if (!target) return null
  const dir = target.replace(/[\\/][^\\/]*$/, "")
  return createTemplateOnDisk(platform, t, load, dir, target)
}

/** Web: adds the template to the browser library; resolves to the new file id. */
export async function createTemplateInBrowser(
  t: Template,
  load: TemplateLoader = loadExample,
): Promise<{ id: string; name: string }> {
  const names = new Set((await listFiles()).map((f) => f.name))
  const name = numberedName(t.name, (n) => names.has(n))
  const text = await load(t.dir, t.file)
  const { id } = await importKimoFile(text, t.file)
  await patchFile(id, { name })
  if (t.library) {
    const libText = await load(t.library.dir, t.library.file)
    const path = (JSON.parse(text) as { imports?: Record<string, string> }).imports?.[
      t.library.alias
    ]
    await new LibraryManager(id).put(t.library.alias, path ?? t.library.file, {
      name: t.library.file,
      text: libText,
    })
  }
  return { id, name }
}
