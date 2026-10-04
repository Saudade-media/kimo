/**
 * `@kimo/ai-agent/node`: Node/Bun implementations of the host services the main entry leaves
 * injectable — a {@link CliProcessHost} over `node:child_process` (tests, the `kimo` CLI) and a
 * file-backed {@link SkillSource} for `~/.kimo/skills`. Not browser-safe; never imported by the
 * main entry.
 */
import { spawn as spawnChild } from "node:child_process"
import { existsSync } from "node:fs"
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import type { CliProcess, CliProcessHost } from "./cli/types"
import { type SkillSource, USER_SKILLS_DIR } from "./skills/index"

const expand = (p: string, home: string) => (p.startsWith("~/") ? join(home, p.slice(2)) : p)

export interface NodeCliHostOptions {
  home?: string
  /** PATH to search (default process.env.PATH). */
  path?: string
  env?: Record<string, string | undefined>
  /** Root for session workspaces (default `<home>/.kimo/cli-workspaces`). */
  workspacesRoot?: string
}

export function createNodeCliHost(opts: NodeCliHostOptions = {}): CliProcessHost {
  const home = opts.home ?? homedir()
  const env = opts.env ?? process.env
  const pathVar = opts.path ?? env.PATH ?? ""
  const root = opts.workspacesRoot ?? join(home, ".kimo", "cli-workspaces")
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
  return {
    async which(command, extraDirs) {
      const dirs = [...pathVar.split(delimiter), ...extraDirs.map((d) => expand(d, home))].filter(
        Boolean,
      )
      for (const d of dirs)
        for (const e of exts) {
          const p = join(d, command + e)
          try {
            await access(p)
            return p
          } catch {
            // next
          }
        }
      return null
    },
    exec(path, args, o = {}) {
      return new Promise((resolve) => {
        const child = spawnChild(path, [...args], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...env, ...(o.env ?? {}) } as NodeJS.ProcessEnv,
        })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (d) => {
          stdout += String(d)
        })
        child.stderr.on("data", (d) => {
          stderr += String(d)
        })
        const t = setTimeout(() => child.kill("SIGKILL"), o.timeoutMs ?? 5_000)
        child.on("error", (e) => {
          clearTimeout(t)
          resolve({ code: null, stdout, stderr: stderr || e.message })
        })
        child.on("close", (code) => {
          clearTimeout(t)
          resolve({ code, stdout, stderr })
        })
      })
    },
    async homeFileExists(rel) {
      return existsSync(join(home, rel))
    },
    async hasEnv(name) {
      return Boolean(env[name])
    },
    async prepareWorkspace(session, files) {
      if (!/^[a-z0-9]{1,16}$/.test(session)) throw new Error(`Invalid session id ${session}`)
      const dir = join(root, session)
      await mkdir(dir, { recursive: true })
      for (const f of files) {
        if (f.path.includes("..") || f.path.startsWith("/"))
          throw new Error(`Invalid workspace path ${f.path}`)
        const p = join(dir, f.path)
        await mkdir(dirname(p), { recursive: true })
        await writeFile(p, f.text)
      }
      return dir
    },
    async spawn(spec): Promise<CliProcess> {
      const child = spawnChild(spec.path, spec.args, {
        cwd: spec.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...env, ...(spec.env ?? {}) } as NodeJS.ProcessEnv,
      })
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.on("error", () => resolve({ code: null, signal: "error" }))
        child.on("close", (code, signal) => resolve({ code, signal }))
      })
      const on = (s: NodeJS.ReadableStream, l: (c: string) => void) => {
        const f = (d: Buffer | string) => l(String(d))
        s.on("data", f)
        return () => s.off("data", f)
      }
      return {
        pid: child.pid ?? -1,
        write: (data) =>
          new Promise((res, rej) => child.stdin.write(data, (e) => (e ? rej(e) : res()))),
        closeStdin: async () => {
          child.stdin.end()
        },
        kill: async (signal = "SIGTERM") => {
          if (child.exitCode === null) child.kill(signal)
        },
        onStdout: (l) => on(child.stdout, l),
        onStderr: (l) => on(child.stderr, l),
        exited,
      }
    },
  }
}

/** `~/.kimo/skills/<name>/SKILL.md` files. */
export function createFileSkillSource(home: string = homedir()): SkillSource {
  const root = join(home, USER_SKILLS_DIR)
  return {
    async list() {
      let dirs: string[]
      try {
        dirs = await readdir(root)
      } catch {
        return []
      }
      const out: { path: string; text: string }[] = []
      for (const d of dirs.sort()) {
        const p = join(root, d, "SKILL.md")
        try {
          out.push({ path: p, text: await readFile(p, "utf8") })
        } catch {
          // not a skill folder
        }
      }
      return out
    },
  }
}
