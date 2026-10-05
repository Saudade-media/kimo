/**
 * The docs' information architecture: the left-nav groups of board 26 (Docs · Article) filled
 * with the repository's own markdown. A group with no source in the repo is not shown (no
 * placeholder pages). The user guide lives in docs/guide/<group>/ (see GUIDE below). Long single files are split into one page per top-level section:
 *
 *   docs/spec/kimo-format-1.0.md    one page per "## N." section (+ appendices)
 *   packages/cli/README.md          an overview + one page per "## `kimo …`" command
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO_ROOT } from "../config"

export type GroupId =
  | "getting-started"
  | "editor"
  | "components"
  | "agents"
  | "built-in-agent"
  | "export"
  | "spec"
  | "cli"
  | "contributing"
export type PageKind = "article" | "spec" | "cli"

export interface DocPage {
  group: GroupId
  /** URL path, always "/docs/…/" with a trailing slash. */
  url: string
  title: string
  /** Label in the left nav (spec: "6. Sizing and layout"). */
  navLabel: string
  navMono?: boolean
  kind: PageKind
  /** Repo path of the markdown this page renders. */
  source: string
  /** Repo path to edit (the generator's input for generated files). */
  editPath: string
  /** Markdown of this page, without its own heading line. */
  body: string
  /** Heading depth that defines the page (1, or 2 for a split section). */
  depth: number
  /** "§6" on spec section pages. */
  sectionNo?: string
  /** "git merge driver" on CLI command pages. */
  badge?: string
  /** GitHub anchor of the heading a split page starts at ("6-sizing-and-layout"). */
  anchor?: string
  /** `kimo_read_docs {path}` for pages agents read too. */
  readDocsPath?: string
}

export interface Group {
  id: GroupId
  label: string
  icon: string
  pages: DocPage[]
}

const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8")

/** Strips the generator banner and returns `{ title, body, generatedFrom }`. */
export function splitTitle(md: string): { title: string; body: string; generatedFrom?: string } {
  let generatedFrom: string | undefined
  const banner = /^<!--\s*Generated from (\S+)[\s\S]*?-->\s*\n/.exec(md)
  if (banner) {
    generatedFrom = banner[1]
    md = md.slice(banner[0].length)
  }
  const m = /^#\s+(.+)\n/m.exec(md)
  if (!m) return { title: "", body: md, generatedFrom }
  return {
    title: stripMd(m[1] as string),
    body: md.slice(0, m.index) + md.slice(m.index + m[0].length),
    generatedFrom,
  }
}

/** Plain text of a one-line markdown heading (`code`, **bold** markers removed). */
export function stripMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
}

/** GitHub's heading anchor: lowercase, punctuation dropped, each space a hyphen. */
export function githubSlug(s: string): string {
  return stripMd(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-")
}

/** URL path segment: like {@link githubSlug} but with runs of hyphens collapsed. */
export function slugify(s: string): string {
  return stripMd(s)
    .toLowerCase()
    .replace(/§/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

/** Splits markdown at `## ` headings (outside code fences). */
export function splitH2(md: string): {
  preamble: string
  sections: { heading: string; body: string }[]
} {
  const lines = md.split("\n")
  let fence = false
  let cur: { heading: string; lines: string[] } | null = null
  const pre: string[] = []
  const sections: { heading: string; body: string }[] = []
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = !fence && /^##\s+(.+)$/.exec(line)
    if (h) {
      if (cur) sections.push({ heading: cur.heading, body: cur.lines.join("\n") })
      cur = { heading: h[1] as string, lines: [] }
    } else (cur ? cur.lines : pre).push(line)
  }
  if (cur) sections.push({ heading: cur.heading, body: cur.lines.join("\n") })
  return { preamble: pre.join("\n"), sections }
}

function article(group: GroupId, url: string, source: string, navLabel?: string): DocPage {
  const { title, body, generatedFrom } = splitTitle(read(source))
  const readDocs = /^docs\/agents\/(.+)\.md$/.exec(source)?.[1]
  return {
    group,
    url,
    title,
    navLabel: navLabel ?? title,
    kind: "article",
    source,
    editPath: generatedFrom ?? source,
    body,
    depth: 1,
    readDocsPath: readDocs,
  }
}

/** Agents & MCP: the overview, then the guides in the order docs/agents/index.md lists them. */
function agentsPages(): DocPage[] {
  const index = read("docs/agents/index.md")
  const order = [...index.matchAll(/^\|\s*`([\w/-]+)`\s*\|/gm)].map((m) => m[1] as string)
  const pages = [article("agents", "/docs/agents/", "docs/agents/index.md", "Overview")]
  for (const p of order) {
    pages.push(article("agents", `/docs/agents/${p}/`, `docs/agents/${p}.md`))
  }
  return pages
}

export const SPEC_SOURCE = "docs/spec/kimo-format-1.0.md"

/** The spec's preamble table (Status, Schema, …) as rows of markdown. */
export function specHeader(): [string, string][] {
  const { preamble } = splitH2(splitTitle(read(SPEC_SOURCE)).body)
  return [...preamble.matchAll(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*(.+?)\s*\|\s*$/gm)].map(
    (m) => [m[1] as string, m[2] as string] as [string, string],
  )
}

function specPages(): DocPage[] {
  const { sections } = splitH2(splitTitle(read(SPEC_SOURCE)).body)
  return sections.map((s, i) => {
    const num = /^(\d+)\.\s+(.+)$/.exec(s.heading)
    const app = /^Appendix\s+([A-Z])\s+—\s+(.+)$/.exec(s.heading)
    const title = stripMd(num ? (num[2] as string) : app ? (app[2] as string) : s.heading)
    const slug = num
      ? slugify(title)
      : app
        ? `appendix-${(app[1] as string).toLowerCase()}`
        : slugify(title)
    const cap = title.charAt(0).toUpperCase() + title.slice(1)
    return {
      group: "spec" as const,
      url: i === 0 ? "/docs/spec/" : `/docs/spec/${slug}/`,
      title: cap,
      navLabel: num ? `${num[1]}. ${title}` : `${app?.[1] ?? ""}. ${cap}`.replace(/^\. /, ""),
      kind: "spec" as const,
      source: SPEC_SOURCE,
      editPath: SPEC_SOURCE,
      body: s.body,
      depth: 2,
      anchor: githubSlug(s.heading),
      sectionNo: num ? `§${num[1]}` : app ? `App. ${app[1]}` : undefined,
    }
  })
}

const CLI_SOURCE = "packages/cli/README.md"

function cliPages(): DocPage[] {
  const { title, body } = splitTitle(read(CLI_SOURCE))
  const { preamble, sections } = splitH2(body)
  const overview: DocPage = {
    group: "cli",
    url: "/docs/cli/",
    title: stripMd(title).replace(/^@kimo\/cli\s+—\s+/, "") || "CLI",
    navLabel: "Overview",
    kind: "article",
    source: CLI_SOURCE,
    editPath: CLI_SOURCE,
    body: preamble,
    depth: 1,
  }
  const cmds = sections.map((s) => {
    const m = /^`(kimo[^`]*)`(?::\s*(.+))?$/.exec(s.heading.trim())
    const cmd = m ? (m[1] as string) : stripMd(s.heading)
    const badge = m?.[2] ? stripMd(m[2]).replace(/^the\s+/i, "") : undefined
    return {
      group: "cli" as const,
      url: `/docs/cli/${slugify(cmd.replace(/^kimo\s+/, "")) || "kimo"}/`,
      title: cmd,
      navLabel: cmd,
      navMono: true,
      kind: "cli" as const,
      source: CLI_SOURCE,
      editPath: CLI_SOURCE,
      body: s.body,
      depth: 2,
      anchor: githubSlug(s.heading),
      badge,
    }
  })
  return [overview, ...cmds]
}

type GuideGroup = "getting-started" | "editor" | "components" | "built-in-agent" | "export"

/**
 * The user guide (docs/guide/<group>/<page>.md), in nav order. A group's first page is served at
 * /docs/<group>/, the rest at /docs/<group>/<page>/. `examples/README.md` joins Getting started.
 */
export const GUIDE: Record<GuideGroup, { label: string; icon: string; pages: string[] }> = {
  "getting-started": {
    label: "Getting started",
    icon: "rocket",
    pages: ["install", "first-file", "saving-and-recovery", "troubleshooting", "privacy"],
  },
  editor: {
    label: "Editor",
    icon: "mouse-pointer-2",
    pages: [
      "canvas",
      "selection-and-layers",
      "properties",
      "pen-and-paths",
      "snapping-and-measuring",
      "images-icons-svg",
      "fonts",
      "notes-and-prompts",
      "shortcuts",
    ],
  },
  components: {
    label: "Components & variables",
    icon: "component",
    pages: ["components", "variables-and-themes", "libraries"],
  },
  "built-in-agent": {
    label: "Built-in agent",
    icon: "sparkles",
    pages: ["providers", "agent-tab", "skills", "prompts-and-placeholders"],
  },
  export: {
    label: "Export",
    icon: "code-xml",
    pages: ["export-dialog", "code-tab", "agents"],
  },
}

function guidePages(id: GuideGroup): DocPage[] {
  return GUIDE[id].pages.map((name, i) =>
    article(id, i === 0 ? `/docs/${id}/` : `/docs/${id}/${name}/`, `docs/guide/${id}/${name}.md`),
  )
}

function guideGroup(id: GuideGroup, extra: DocPage[] = []): Group {
  const g = GUIDE[id]
  return { id, label: g.label, icon: g.icon, pages: [...guidePages(id), ...extra] }
}

export function loadGroups(): Group[] {
  const gs = guidePages("getting-started")
  return [
    {
      id: "getting-started",
      label: GUIDE["getting-started"].label,
      icon: GUIDE["getting-started"].icon,
      // Install, first file, saving · Examples · Troubleshooting, Privacy
      pages: [
        ...gs.slice(0, 3),
        article("getting-started", "/docs/examples/", "examples/README.md"),
        ...gs.slice(3),
      ],
    },
    guideGroup("editor"),
    guideGroup("components"),
    { id: "agents", label: "Agents & MCP", icon: "plug", pages: agentsPages() },
    guideGroup("built-in-agent"),
    guideGroup("export"),
    { id: "spec", label: "File format spec", icon: "braces", pages: specPages() },
    { id: "cli", label: "CLI", icon: "terminal", pages: cliPages() },
    {
      id: "contributing",
      label: "Contributing",
      icon: "git-pull-request",
      pages: [article("contributing", "/docs/contributing/", "CONTRIBUTING.md")],
    },
  ]
}

/** Every page in reading order (prev / next follow it across groups). */
export const allPages = (groups: Group[]) => groups.flatMap((g) => g.pages)

/** Maps a repo path (file or dir) to the page that renders it, for link rewriting. */
export function sourceIndex(groups: Group[]): Map<string, DocPage> {
  const m = new Map<string, DocPage>()
  for (const p of allPages(groups)) if (!m.has(p.source)) m.set(p.source, p)
  return m
}
