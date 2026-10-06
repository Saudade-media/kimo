/**
 * The templates bundled with Kimo (built by `scripts/build-templates.ts`; do not edit
 * `files/` or `index.json` by hand). Everything is local, so the gallery works offline in the
 * web app and in the desktop app.
 *
 * Asset URLs are `new URL(<relative path>, import.meta.url)`: Vite copies the matched files into
 * the build as hashed assets (and Tauri bundles that build), Bun and Node get `file:` URLs. A
 * document is fetched only when `loadTemplate` asks for it; covers and screen previews are small
 * PNGs the gallery loads as images.
 */
import index from "../index.json"

export interface TemplateScreen {
  /** Frame name ("Home", "Pricing"). */
  name: string
  /** Category page the frame is on ("Screens", "Desktop", "Mobile"). */
  page: string
  /** Preview PNG URL. */
  preview: string
  width: number
  /** 0 when the frame's height fits its content. */
  height: number
}

export interface TemplateInfo {
  slug: string
  name: string
  category: string
  /** One plain sentence. */
  description: string
  /** Category pages in order (Cover, Screens…, Components, Foundations). */
  pages: string[]
  /** Cover PNG URL (720 px wide). */
  cover: string
  screens: TemplateScreen[]
}

interface RawEntry {
  slug: string
  name: string
  category: string
  description: string
  pages: string[]
  file: string
  cover: string
  screens: { name: string; page: string; preview: string; width: number; height: number }[]
}

const entries = index as RawEntry[]

// Spelled with one variable segment per pattern so Vite can glob the folder at build time.
const coverUrl = (slug: string) => new URL(`../files/${slug}/cover.png`, import.meta.url).href
const screenUrl = (slug: string, file: string) =>
  new URL(`../files/${slug}/screens/${file}`, import.meta.url).href
const documentUrl = (slug: string) => new URL(`../files/${slug}/${slug}.kimo`, import.meta.url).href

/** Every bundled template, sorted by slug. */
export function listTemplates(): TemplateInfo[] {
  return entries.map((e) => ({
    slug: e.slug,
    name: e.name,
    category: e.category,
    description: e.description,
    pages: [...e.pages],
    cover: coverUrl(e.slug),
    screens: e.screens.map((s) => ({
      name: s.name,
      page: s.page,
      preview: screenUrl(e.slug, s.preview.slice(s.preview.lastIndexOf("/") + 1)),
      width: s.width,
      height: s.height,
    })),
  }))
}

/** One template's metadata, or null for an unknown slug. */
export function getTemplate(slug: string): TemplateInfo | null {
  return listTemplates().find((t) => t.slug === slug) ?? null
}

/**
 * The `.kimo` text of a template (open it as a new, unsaved document). Throws for an unknown
 * slug or when the file cannot be read.
 */
export async function loadTemplate(slug: string): Promise<string> {
  if (!entries.some((e) => e.slug === slug)) throw new Error(`Unknown template "${slug}"`)
  const url = documentUrl(slug)
  if (url.startsWith("file:")) {
    const spec = "node:fs/promises"
    const fs = (await import(/* @vite-ignore */ spec)) as typeof import("node:fs/promises")
    return await fs.readFile(new URL(url), "utf8")
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load template "${slug}" (${res.status})`)
  return await res.text()
}
