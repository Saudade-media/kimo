/** Pieces shared by the desktop (yutK2) and mobile (t4GJ6Z) landing frames. */
import { readFileSync } from "node:fs"
import type { Persona } from "../agent-mark"
import type { SiteConfig } from "../config"
import { icon, type Raw } from "../html"
import { iconNode, type Paint } from "../node"

export const ic = (name: string, size: number, color: Paint, node?: string): Raw =>
  iconNode(name, size, color, icon, node)

export interface Links {
  download: string
  app: string
  repo: string
  docs: string
  spec: string
  agents: string
  cli: string
  changelog: string
  releaseNotes: string
  contributing: string
  conduct: string
  security: string
  discussions: string
  roadmap: string
}

export function links(cfg: SiteConfig): Links {
  return {
    download: cfg.releasesUrl,
    app: cfg.appUrl,
    repo: cfg.repoUrl,
    docs: "/docs/",
    spec: "/docs/spec/",
    agents: "/docs/agents/",
    cli: "/docs/cli/",
    changelog: cfg.blob("CHANGELOG.md"),
    releaseNotes: cfg.blob("CHANGELOG.md"),
    contributing: "/docs/contributing/",
    conduct: cfg.blob("CODE_OF_CONDUCT.md"),
    security: cfg.blob("SECURITY.md"),
    discussions: `${cfg.repoUrl}/discussions`,
    roadmap: `${cfg.repoUrl}/milestones`,
  }
}

/** Code-block rows of the "landing.kimo" sample, with the real format version and $schema. */
export type Tok = [string, "k" | "p" | "v" | "ok"]
export const TOKEN_COLOR: Record<Tok[1], Paint> = {
  k: "text-secondary",
  p: "text-tertiary",
  v: "text-primary",
  ok: "success",
}

export function landingKimoLines(cfg: SiteConfig): { hl?: boolean; toks: Tok[] }[] {
  return [
    { toks: [["{", "p"]] },
    {
      toks: [
        ['  "$schema"', "k"],
        [": ", "p"],
        [`"${cfg.schemaUrl}"`, "v"],
        [",", "p"],
      ],
    },
    {
      toks: [
        ['  "format"', "k"],
        [": ", "p"],
        [`"${cfg.formatVersion}"`, "v"],
        [",", "p"],
      ],
    },
    {
      toks: [
        ['  "nodes"', "k"],
        [": {", "p"],
      ],
    },
    {
      hl: true,
      toks: [
        ['    "h3Ro9xQk2a"', "k"],
        [": { ", "p"],
        ['"type"', "k"],
        [": ", "p"],
        ['"frame"', "v"],
        [", ", "p"],
        ['"parent"', "k"],
        [": ", "p"],
        ["null", "v"],
        [", ", "p"],
        ['"name"', "k"],
        [": ", "p"],
        ['"Hero"', "v"],
        [",", "p"],
      ],
    },
    {
      hl: true,
      toks: [
        ['      "layout"', "k"],
        [": { ", "p"],
        ['"dir"', "k"],
        [": ", "p"],
        ['"column"', "v"],
        [", ", "p"],
        ['"gap"', "k"],
        [": ", "p"],
        ["16", "v"],
        [" } },", "p"],
      ],
    },
    {
      toks: [
        ['    "t7Kp2mVw8c"', "k"],
        [": { ", "p"],
        ['"type"', "k"],
        [": ", "p"],
        ['"text"', "v"],
        [", ", "p"],
        ['"parent"', "k"],
        [": ", "p"],
        ['"h3Ro9xQk2a"', "v"],
        [",", "p"],
      ],
    },
    {
      toks: [
        ['      "content"', "k"],
        [": ", "p"],
        ['"Plan less. Ship more together."', "v"],
        [" }", "p"],
      ],
    },
    { toks: [["  }", "p"]] },
    { toks: [["}", "p"]] },
  ]
}

/** Personas row (Agents section): AgentMark persona, name, scope. */
export const PERSONAS: { persona: Persona; name: string; scope: string }[] = [
  { persona: "teal", name: "Kimo", scope: "whole page" },
  { persona: "iris", name: "Iris", scope: "Hero" },
  { persona: "violet", name: "Violet", scope: "Pricing" },
  { persona: "rose", name: "Rose", scope: "Footer" },
  { persona: "ember", name: "Ember", scope: "Tokens" },
  { persona: "moss", name: "Moss", scope: "Mobile" },
]

export interface Contributor {
  login: string
  avatar: string
  url: string
}

/** Contributors from the GitHub API at build time; null (section omitted) when unavailable. */
export async function fetchContributors(cfg: SiteConfig, max = 9): Promise<Contributor[] | null> {
  // Tests pin the list (KIMO_SITE_CONTRIBUTORS_FILE) instead of calling the API.
  const pinned = process.env.KIMO_SITE_CONTRIBUTORS_FILE
  if (pinned) return (JSON.parse(readFileSync(pinned, "utf8")) as Contributor[]).slice(0, max)
  if (cfg.offline) return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repo}/contributors?per_page=${max}`,
      {
        headers: { accept: "application/vnd.github+json", "user-agent": "kimo-site-build" },
        signal: ctrl.signal,
      },
    )
    clearTimeout(t)
    if (!res.ok) return null
    const rows = (await res.json()) as {
      login: string
      avatar_url: string
      html_url: string
      type: string
    }[]
    const people = rows
      .filter((r) => r.type === "User")
      .slice(0, max)
      .map((r) => ({ login: r.login, avatar: `${r.avatar_url}&s=72`, url: r.html_url }))
    return people.length ? people : null
  } catch {
    return null
  }
}
