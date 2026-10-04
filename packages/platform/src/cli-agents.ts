/**
 * M6 local agent CLIs (ADR 0014 §11): detect the user's installed Claude Code / Codex / Gemini
 * CLI and run them as processes on desktop. Web: every method is `UNSUPPORTED` and the agent
 * falls back to API providers.
 *
 * Security (Rust side): `kimo_cli_spawn` / `kimo_cli_exec` only run a path previously returned
 * by `kimo_cli_which` for an allowed command name (`claude`, `codex`, `gemini`, or a generic CLI
 * the user added in Settings, stored in settings), never an arbitrary path from JS; the working
 * directory must be under `~/.kimo/cli-workspaces/`; `kimo_cli_home_file_exists` only answers
 * for an allow-list of auth-cache paths; env values are never returned.
 *
 * `CliProcessHostLike` mirrors `@kimo/ai-agent`'s `CliProcessHost` (this package depends on
 * nothing); apps/web/src/platform/contract.ts asserts they stay equal.
 */
import type { InvokeLike, ListenLike } from "./secrets"

export interface CliSpawnSpecLike {
  path: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface CliProcessLike {
  pid: number
  write(data: string): Promise<void>
  closeStdin(): Promise<void>
  kill(signal?: "SIGINT" | "SIGTERM" | "SIGKILL"): Promise<void>
  onStdout(listener: (chunk: string) => void): () => void
  onStderr(listener: (chunk: string) => void): () => void
  exited: Promise<{ code: number | null; signal: string | null }>
}

export interface CliProcessHostLike {
  which(command: string, extraDirs: readonly string[]): Promise<string | null>
  exec(
    path: string,
    args: readonly string[],
    opts?: { timeoutMs?: number; env?: Record<string, string> },
  ): Promise<{ code: number | null; stdout: string; stderr: string }>
  homeFileExists(relPath: string): Promise<boolean>
  hasEnv(name: string): Promise<boolean>
  prepareWorkspace(
    session: string,
    files: readonly { path: string; text: string }[],
  ): Promise<string>
  spawn(spec: CliSpawnSpecLike): Promise<CliProcessLike>
}

/** Command names the shell may resolve and run (plus user-added generic CLIs). */
export const ALLOWED_CLI_COMMANDS = ["claude", "codex", "gemini"] as const

/** Auth-cache files `kimo_cli_home_file_exists` may report on (relative to $HOME). */
export const CLI_AUTH_FILES = [".gemini/oauth_creds.json"] as const

/** Session workspaces root, relative to $HOME. */
export const CLI_WORKSPACES_DIR = ".kimo/cli-workspaces"

export interface TauriCliCommandMap {
  kimo_cli_which: { args: { command: string; extraDirs: string[] }; result: string | null }
  kimo_cli_exec: {
    args: { path: string; args: string[]; timeoutMs: number; env?: Record<string, string> }
    result: { code: number | null; stdout: string; stderr: string }
  }
  kimo_cli_home_file_exists: { args: { relPath: string }; result: boolean }
  kimo_cli_has_env: { args: { name: string }; result: boolean }
  kimo_cli_prepare_workspace: {
    args: { session: string; files: { path: string; text: string }[] }
    result: string
  }
  kimo_cli_spawn: {
    args: { path: string; args: string[]; cwd: string; env?: Record<string, string> }
    result: { processId: string; pid: number }
  }
  kimo_cli_write: { args: { processId: string; data: string }; result: null }
  kimo_cli_close_stdin: { args: { processId: string }; result: null }
  kimo_cli_kill: {
    args: { processId: string; signal: "SIGINT" | "SIGTERM" | "SIGKILL" }
    result: null
  }
}

export const TAURI_CLI_COMMANDS = [
  "kimo_cli_which",
  "kimo_cli_exec",
  "kimo_cli_home_file_exists",
  "kimo_cli_has_env",
  "kimo_cli_prepare_workspace",
  "kimo_cli_spawn",
  "kimo_cli_write",
  "kimo_cli_close_stdin",
  "kimo_cli_kill",
] as const satisfies readonly (keyof TauriCliCommandMap)[]

export interface TauriCliEventMap {
  /** UTF-8 text chunks (Rust decodes lossily at chunk boundaries it holds back). */
  "kimo://cli-output": { processId: string; stream: "stdout" | "stderr"; chunk: string }
  "kimo://cli-exit": { processId: string; code: number | null; signal: string | null }
}

export const TAURI_CLI_EVENTS = [
  "kimo://cli-output",
  "kimo://cli-exit",
] as const satisfies readonly (keyof TauriCliEventMap)[]

/** Desktop implementation over the Tauri commands/events above. */
export function createTauriCliHost(bridge: {
  invoke: InvokeLike
  listen: ListenLike
}): CliProcessHostLike {
  const { invoke, listen } = bridge
  return {
    which: async (command, extraDirs) =>
      (await invoke("kimo_cli_which", { command, extraDirs: [...extraDirs] })) as string | null,
    exec: async (path, args, opts = {}) =>
      (await invoke("kimo_cli_exec", {
        path,
        args: [...args],
        timeoutMs: opts.timeoutMs ?? 5_000,
        ...(opts.env ? { env: opts.env } : {}),
      })) as { code: number | null; stdout: string; stderr: string },
    homeFileExists: async (relPath) =>
      (await invoke("kimo_cli_home_file_exists", { relPath })) === true,
    hasEnv: async (name) => (await invoke("kimo_cli_has_env", { name })) === true,
    prepareWorkspace: async (session, files) =>
      (await invoke("kimo_cli_prepare_workspace", { session, files: [...files] })) as string,
    async spawn(spec) {
      const out = new Set<(c: string) => void>()
      const err = new Set<(c: string) => void>()
      let processId = ""
      const early: { stream: "stdout" | "stderr"; chunk: string; processId: string }[] = []
      let resolveExit!: (v: { code: number | null; signal: string | null }) => void
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => {
        resolveExit = r
      })
      const deliver = (p: { stream: "stdout" | "stderr"; chunk: string }) => {
        for (const l of p.stream === "stdout" ? out : err) l(p.chunk)
      }
      const offOut = await listen("kimo://cli-output", (payload) => {
        const p = payload as TauriCliEventMap["kimo://cli-output"]
        if (!processId) early.push(p)
        else if (p.processId === processId) deliver(p)
      })
      const offExit = await listen("kimo://cli-exit", (payload) => {
        const p = payload as TauriCliEventMap["kimo://cli-exit"]
        if (p.processId !== processId) return
        resolveExit({ code: p.code, signal: p.signal })
        void offOut()
        void offExit()
      })
      const r = (await invoke("kimo_cli_spawn", { ...spec })) as { processId: string; pid: number }
      processId = r.processId
      for (const p of early.splice(0)) if (p.processId === processId) deliver(p)
      return {
        pid: r.pid,
        write: async (data) => {
          await invoke("kimo_cli_write", { processId, data })
        },
        closeStdin: async () => {
          await invoke("kimo_cli_close_stdin", { processId })
        },
        kill: async (signal = "SIGTERM") => {
          await invoke("kimo_cli_kill", { processId, signal })
        },
        onStdout: (l) => {
          out.add(l)
          return () => out.delete(l)
        },
        onStderr: (l) => {
          err.add(l)
          return () => err.delete(l)
        },
        exited,
      }
    },
  }
}
