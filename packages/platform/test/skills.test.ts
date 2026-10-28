import { describe, expect, test } from "bun:test"
import { isPlatformError } from "../src/errors"
import { createMemorySkills, createTauriSkills, SKILL_DIR_RE } from "../src/skills"

const SKILL = "---\nname: brand\ndescription: Brand voice\n---\nBody\n"

function fakeBridge() {
  const calls: { cmd: string; args: Record<string, unknown> }[] = []
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  return {
    calls,
    emit(event: string, payload: unknown) {
      for (const l of listeners.get(event) ?? []) l(payload)
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    bridge: {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args })
        return null
      },
      listen: async (event: string, handler: (p: unknown) => void) => {
        let set = listeners.get(event)
        if (!set) {
          set = new Set()
          listeners.set(event, set)
        }
        set.add(handler)
        return () => set.delete(handler)
      },
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("skills", () => {
  test("only plain folder names are skills; traversal and dotfiles are refused", async () => {
    for (const ok of ["brand", "brand-voice", "my_skill", "A1"])
      expect(SKILL_DIR_RE.test(ok)).toBe(true)
    for (const bad of ["..", ".git", "a/b", "-x", "", "a.b", "x".repeat(65)])
      expect(SKILL_DIR_RE.test(bad)).toBe(false)
    const s = createMemorySkills({ zeta: SKILL, brand: SKILL, ".hidden": SKILL })
    expect((await s.list()).map((f) => f.path)).toEqual([
      "/home/me/.kimo/skills/brand/SKILL.md",
      "/home/me/.kimo/skills/zeta/SKILL.md",
    ])
    const err = await s.read("../x").catch((e: unknown) => e)
    expect(isPlatformError(err) && err.code).toBe("INVALID")
  })

  test("tauri: watch filters by watch id and unwatches", async () => {
    const f = fakeBridge()
    const s = createTauriSkills(f.bridge)
    let n = 0
    const off = s.watch(() => n++)
    await tick()
    const watchId = f.calls.find((c) => c.cmd === "kimo_skills_watch")?.args.watchId as string
    f.emit("kimo://skills-changed", { watchId: "someone-else" })
    f.emit("kimo://skills-changed", { watchId })
    expect(n).toBe(1)
    off()
    expect(f.calls.at(-1)).toEqual({ cmd: "kimo_skills_unwatch", args: { watchId } })
    expect(f.listenerCount("kimo://skills-changed")).toBe(0)
    f.emit("kimo://skills-changed", { watchId })
    expect(n).toBe(1)
  })

  test("tauri: unwatch before the listener is installed never starts the watch", async () => {
    const f = fakeBridge()
    const off = createTauriSkills(f.bridge).watch(() => {})
    off()
    await tick()
    expect(f.calls.some((c) => c.cmd === "kimo_skills_watch")).toBe(false)
    expect(f.listenerCount("kimo://skills-changed")).toBe(0)
  })
})
