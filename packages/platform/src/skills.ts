/**
 * M6 user skills (ADR 0014 §10): `~/.kimo/skills/<name>/SKILL.md`, listed, read and watched by
 * the host. {@link SkillsApi} is structurally a `@kimo/ai-agent` `SkillSource` (this package
 * depends on nothing), so the agent runtime takes `platform.skills` as is; the agent parses the
 * front matter and refuses a user skill that would shadow a built-in.
 *
 * Desktop: the `kimo_skills_*` commands. Rust only reads `<root>/<dir>/SKILL.md` where `<dir>`
 * is a plain folder name, the canonical path (symlinks resolved) stays under the canonical root,
 * the target is a regular file and at most {@link USER_SKILL_MAX_BYTES}; anything else is skipped
 * (list) or refused (read). Memory: a scripted map. Browser: absent (no user skills folder).
 */
import { PlatformError } from "./errors"
import type { InvokeLike, ListenLike } from "./secrets"
import type { Unsubscribe } from "./types"

/** One user skill file. */
export interface SkillFile {
  /** Absolute path of the SKILL.md. */
  path: string
  text: string
}

export interface SkillsApi {
  /** Absolute skills root (`~/.kimo/skills`), for "Open skills folder". */
  root(): Promise<string>
  /** Every `<root>/<dir>/SKILL.md` with its text, sorted by folder name. */
  list(): Promise<SkillFile[]>
  /** One skill folder's SKILL.md; null when missing. `INVALID` for a name that is not a plain folder name. */
  read(name: string): Promise<SkillFile | null>
  /** Fires (debounced) when anything under the root changes: the agent reloads its catalog. */
  watch(onChange: () => void): Unsubscribe
}

/** Skill folder names the host accepts (no dots, separators or leading dash). */
export const SKILL_DIR_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/

/** Largest SKILL.md the host reads. */
export const USER_SKILL_MAX_BYTES = 256 * 1024

/** Skills root, relative to $HOME. */
export const USER_SKILLS_ROOT = ".kimo/skills"

export interface TauriSkillsCommandMap {
  kimo_skills_root: { args: Record<string, never>; result: string }
  kimo_skills_list: { args: Record<string, never>; result: SkillFile[] }
  kimo_skills_read: { args: { name: string }; result: SkillFile | null }
  kimo_skills_watch: { args: { watchId: string }; result: null }
  kimo_skills_unwatch: { args: { watchId: string }; result: null }
}

/** Kept out of the frozen `TAURI_COMMANDS`, like the other M6 commands. Keep the Rust order. */
export const TAURI_SKILLS_COMMANDS = [
  "kimo_skills_root",
  "kimo_skills_list",
  "kimo_skills_read",
  "kimo_skills_watch",
  "kimo_skills_unwatch",
] as const satisfies readonly (keyof TauriSkillsCommandMap)[]

export interface TauriSkillsEventMap {
  /** To the window that started the watch. */
  "kimo://skills-changed": { watchId: string }
}

export const TAURI_SKILLS_EVENTS = [
  "kimo://skills-changed",
] as const satisfies readonly (keyof TauriSkillsEventMap)[]

let watchSeq = 0

/** Desktop implementation over the commands above. */
export function createTauriSkills(bridge: { invoke: InvokeLike; listen: ListenLike }): SkillsApi {
  const { invoke, listen } = bridge
  return {
    root: async () => (await invoke("kimo_skills_root", {})) as string,
    list: async () => (await invoke("kimo_skills_list", {})) as SkillFile[],
    read: async (name) => (await invoke("kimo_skills_read", { name })) as SkillFile | null,
    watch(onChange) {
      const watchId = `skills-${Date.now().toString(36)}-${++watchSeq}`
      let stopped = false
      let off: (() => void) | null = null
      void (async () => {
        const unlisten = await listen("kimo://skills-changed", (p) => {
          if ((p as { watchId?: string })?.watchId === watchId && !stopped) onChange()
        })
        if (stopped) {
          unlisten()
          return
        }
        off = unlisten
        await invoke("kimo_skills_watch", { watchId }).catch(() => {})
      })()
      return () => {
        if (stopped) return
        stopped = true
        off?.()
        void invoke("kimo_skills_unwatch", { watchId }).catch(() => {})
      }
    },
  }
}

/** Scripted skills for tests and the memory platform. */
export interface MemorySkills extends SkillsApi {
  /** Adds or replaces `<root>/<dir>/SKILL.md` and notifies watchers. */
  set(dir: string, text: string): void
  remove(dir: string): void
}

export function createMemorySkills(
  initial: Record<string, string> = {},
  rootPath = "/home/me/.kimo/skills",
): MemorySkills {
  const files = new Map(Object.entries(initial))
  const watchers = new Set<() => void>()
  const file = (dir: string): SkillFile | null => {
    const text = files.get(dir)
    return text === undefined ? null : { path: `${rootPath}/${dir}/SKILL.md`, text }
  }
  const notify = () => {
    for (const w of [...watchers]) w()
  }
  return {
    root: async () => rootPath,
    list: async () =>
      [...files.keys()]
        .filter((d) => SKILL_DIR_RE.test(d))
        .sort()
        .map((d) => file(d) as SkillFile),
    async read(name) {
      if (!SKILL_DIR_RE.test(name))
        throw new PlatformError("INVALID", `Invalid skill folder name "${name}"`)
      return file(name)
    },
    watch(onChange) {
      watchers.add(onChange)
      return () => watchers.delete(onChange)
    },
    set(dir, text) {
      files.set(dir, text)
      notify()
    },
    remove(dir) {
      if (files.delete(dir)) notify()
    },
  }
}
