import { describe, expect, test } from "bun:test"
import { isPlatformError } from "../src/errors"
import { createMemoryPlatform } from "../src/memory"
import {
  createMemorySkills,
  createTauriSkills,
  SKILL_DIR_RE,
  TAURI_SKILLS_COMMANDS,
  TAURI_SKILLS_EVENTS,
} from "../src/skills"
import type { TauriBridge } from "../src/tauri-platform"
import { createTauriPlatform } from "../src/tauri-platform"

const SKILL = "---\nname: brand\ndescription: Brand voice\n---\nBody\n"

function fakeBridge(answers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
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
        return answers[cmd]?.(args) ?? null
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

describe("platform.skills (ADR 0014 §10)", () => {
  test("command and event lists", () => {
    expect([...TAURI_SKILLS_COMMANDS]).toEqual([
      "kimo_skills_root",
      "kimo_skills_list",
      "kimo_skills_read",
      "kimo_skills_watch",
      "kimo_skills_unwatch",
      "kimo_skills_reveal",
    ])
    expect([...TAURI_SKILLS_EVENTS]).toEqual(["kimo://skills-changed"])
    for (const ok of ["brand", "brand-voice", "my_skill", "A1"])
      expect(SKILL_DIR_RE.test(ok)).toBe(true)
    for (const bad of ["..", ".git", "a/b", "-x", "", "a.b", "x".repeat(65)])
      expect(SKILL_DIR_RE.test(bad)).toBe(false)
  })

  test("tauri: list / read / root go through the commands", async () => {
    const f = fakeBridge({
      kimo_skills_root: () => "/Users/me/.kimo/skills",
      kimo_skills_list: () => [{ path: "/Users/me/.kimo/skills/brand/SKILL.md", text: SKILL }],
      kimo_skills_read: ({ name }) =>
        name === "brand" ? { path: "/Users/me/.kimo/skills/brand/SKILL.md", text: SKILL } : null,
    })
    const s = createTauriSkills(f.bridge)
    expect(await s.root()).toBe("/Users/me/.kimo/skills")
    expect(await s.list()).toEqual([{ path: "/Users/me/.kimo/skills/brand/SKILL.md", text: SKILL }])
    expect((await s.read("brand"))?.text).toBe(SKILL)
    expect(await s.read("missing")).toBeNull()
    expect(f.calls.map((c) => c.cmd)).toEqual([
      "kimo_skills_root",
      "kimo_skills_list",
      "kimo_skills_read",
      "kimo_skills_read",
    ])
    await s.reveal?.()
    expect(f.calls.at(-1)?.cmd).toBe("kimo_skills_reveal")
  })

  test("tauri: watch filters by watch id and unwatches", async () => {
    const f = fakeBridge()
    const s = createTauriSkills(f.bridge)
    let n = 0
    const off = s.watch(() => n++)
    await tick()
    const watch = f.calls.find((c) => c.cmd === "kimo_skills_watch")
    expect(watch).toBeDefined()
    const watchId = watch?.args.watchId as string
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

  test("the desktop platform exposes skills and maps rejections to PlatformError", async () => {
    const invoke = async (cmd: string) => {
      if (cmd === "kimo_app_info")
        return { version: "1", os: "macos", arch: "aarch64", host: "h", pid: 1, kimoHome: "/k" }
      if (cmd === "kimo_window_state")
        return { focused: true, fullscreen: false, trafficLightPosition: null }
      if (cmd === "kimo_updater_status") return { state: "idle" }
      if (cmd === "kimo_settings_get_all") return {}
      if (cmd === "kimo_skills_read")
        throw { code: "INVALID", message: 'Invalid skill folder name ".."' }
      return null
    }
    const p = await createTauriPlatform({
      invoke: invoke as unknown as TauriBridge["invoke"],
      listen: (async () => () => {}) as unknown as TauriBridge["listen"],
    })
    expect(p.skills).toBeDefined()
    const err = await p.skills?.read("..").catch((e: unknown) => e)
    expect(isPlatformError(err) && err.code).toBe("INVALID")
    p.dispose()
  })

  test("memory: scripted folders, invalid names refused, watchers notified", async () => {
    const s = createMemorySkills({ zeta: SKILL, brand: SKILL, ".hidden": SKILL })
    expect((await s.list()).map((f) => f.path)).toEqual([
      "/home/me/.kimo/skills/brand/SKILL.md",
      "/home/me/.kimo/skills/zeta/SKILL.md",
    ])
    const err = await s.read("../x").catch((e: unknown) => e)
    expect(isPlatformError(err) && err.code).toBe("INVALID")
    let n = 0
    const off = s.watch(() => n++)
    s.set("new-skill", SKILL)
    s.remove("zeta")
    s.remove("nope")
    expect(n).toBe(2)
    off()
    s.set("other", SKILL)
    expect(n).toBe(2)
    expect((await s.read("new-skill"))?.text).toBe(SKILL)
  })

  test("the memory platform has skills", async () => {
    const p = createMemoryPlatform({ skills: { brand: SKILL } })
    expect((await p.skills.list()).length).toBe(1)
  })
})
