/**
 * Skills (board 22 "Skills", teardown 3.4, ADR 0014 §10): Built-in (MIT, shipped) + Yours
 * (`~/.kimo/skills/<name>/SKILL.md`, hot-reloaded by the host). "/" in the composer opens the
 * menu; toggling enables a skill for new turns; inserting `/name` forces it for one turn. The
 * enabled skills' bodies are appended to the stable (cached) system prompt in name order.
 */
import { BUILTIN_SKILL_SOURCES } from "./builtin"

export interface Skill {
  name: string
  description: string
  body: string
  source: "builtin" | "user"
  /** user: absolute path of the SKILL.md. */
  path?: string
}

export interface SkillParseError {
  path?: string
  message: string
}

/** Names: lowercase letters, digits, dashes (≤ 64), like folder names. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** User skills root, relative to the home directory. */
export const USER_SKILLS_DIR = ".kimo/skills"

/**
 * Parses a SKILL.md: `---` YAML front matter with at least `name` and `description` (scalar
 * strings, optionally quoted; `>`/`|` block scalars supported), then the Markdown body.
 */
export function parseSkill(
  text: string,
  source: Skill["source"],
  path?: string,
): { ok: true; skill: Skill } | { ok: false; error: SkillParseError } {
  const err = (message: string) => ({
    ok: false as const,
    error: { message, ...(path ? { path } : {}) },
  })
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) return err("SKILL.md must start with --- front matter.")
  const end = normalized.indexOf("\n---", 4)
  if (end < 0) return err("Front matter is not closed with ---.")
  const fm = parseFrontMatter(normalized.slice(4, end))
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1).trim()
  const name = fm.name?.trim()
  const description = fm.description?.trim()
  if (!name) return err("Front matter needs a name.")
  if (!SKILL_NAME_RE.test(name))
    return err(`Invalid skill name "${name}" (lowercase letters, digits, dashes).`)
  if (!description) return err("Front matter needs a description.")
  return { ok: true, skill: { name, description, body, source, ...(path ? { path } : {}) } }
}

function parseFrontMatter(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] as string)
    if (!m) continue
    const key = m[1] as string
    let value = (m[2] as string).trim()
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1] as string))
        block.push((lines[++i] as string).trim())
      value = value.startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n").trim()
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
      if (m[2]?.trim().startsWith('"')) value = value.replace(/\\"/g, '"').replace(/\\n/g, "\n")
    }
    out[key] = value
  }
  return out
}

let builtinCache: Skill[] | undefined

/** The shipped skills (kimo-design, kimo-layout, kimo-tokens). */
function builtinSkills(): Skill[] {
  builtinCache ??= BUILTIN_SKILL_SOURCES.map((t) => {
    const r = parseSkill(t, "builtin")
    if (!r.ok) throw new Error(`Built-in skill invalid: ${r.error.message}`)
    return r.skill
  })
  return builtinCache
}

/** Where user skills come from (desktop: platform fs + watch; web: none or IndexedDB import). */
export interface SkillSource {
  /** Every `<root>/<dir>/SKILL.md` with its text. */
  list(): Promise<{ path: string; text: string }[]>
  /** Fires when any SKILL.md changes (hot reload). */
  watch?(onChange: () => void): () => void
}

export interface SkillCatalog {
  builtin: Skill[]
  user: Skill[]
  errors: SkillParseError[]
}

/** Loads the catalog. A user skill named like a built-in is reported and skipped (no shadowing). */
export async function loadSkills(source?: SkillSource): Promise<SkillCatalog> {
  const builtin = builtinSkills()
  const user: Skill[] = []
  const errors: SkillParseError[] = []
  const taken = new Set(builtin.map((s) => s.name))
  for (const f of (await source?.list()) ?? []) {
    const r = parseSkill(f.text, "user", f.path)
    if (!r.ok) {
      errors.push(r.error)
      continue
    }
    if (taken.has(r.skill.name)) {
      errors.push({ path: f.path, message: `A skill named "${r.skill.name}" already exists.` })
      continue
    }
    taken.add(r.skill.name)
    user.push(r.skill)
  }
  user.sort((a, b) => a.name.localeCompare(b.name))
  return { builtin, user, errors }
}

/** Leading `/name` tokens force skills for one turn: "/brand-voice rewrite…" → ["brand-voice"]. */
export function parseSlash(
  text: string,
  known: ReadonlySet<string>,
): { forced: string[]; text: string } {
  const forced: string[] = []
  let rest = text.trimStart()
  for (;;) {
    const m = /^\/([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/.exec(rest)
    if (!m || !known.has(m[1] as string)) break
    forced.push(m[1] as string)
    rest = rest.slice(m[0].length).trimStart()
  }
  return { forced, text: rest }
}

/** Skills active for a turn: enabled ∪ forced, in name order (stable prompt prefix). */
export function activeSkills(
  catalog: SkillCatalog,
  enabled: readonly string[],
  forced: readonly string[],
): Skill[] {
  const want = new Set([...enabled, ...forced])
  return [...catalog.builtin, ...catalog.user]
    .filter((s) => want.has(s.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The skills block of the stable system prompt. */
export function skillsPrompt(skills: readonly Skill[]): string {
  return skills.map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n\n")
}
