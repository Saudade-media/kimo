/**
 * CLI detection and the default-provider precedence (ADR 0014 §11):
 *
 *   Claude Code CLI installed and signed in → other signed-in CLIs (Codex, Gemini CLI, generic)
 *   → configured API keys (default provider first) → none (first-run card).
 *
 * Detection never prompts: PATH + common install dirs, `--version`, and the CLI's
 * non-interactive auth status (or auth-file / env presence). Web never uses CLIs.
 */
import { DEFAULT_PROVIDER_ID } from "../models"
import type { RuntimePlatform } from "../providers/provider"
import type { ModelSelection } from "../types"
import { BUILTIN_CLI_ADAPTERS } from "./adapters"
import {
  type CliAdapter,
  type CliDetection,
  type CliProcessHost,
  cliIdOf,
  cliProviderId,
  isCliProvider,
} from "./types"

const PROBE_TIMEOUT_MS = 5_000

export async function detectCli(host: CliProcessHost, adapter: CliAdapter): Promise<CliDetection> {
  const d = adapter.def
  const base = { id: d.id, label: d.label }
  try {
    const path = await host.which(d.command, d.searchPaths)
    if (!path) return { ...base, installed: false, signedIn: null, billing: null }
    const v = await host.exec(path, d.probe.versionArgs, { timeoutMs: PROBE_TIMEOUT_MS })
    const version = d.probe.parseVersion(`${v.stdout}\n${v.stderr}`)
    let auth: Pick<CliDetection, "signedIn" | "account" | "authMethod" | "billing" | "plan"> = {
      signedIn: null,
      billing: null,
    }
    if (d.probe.authArgs && d.probe.parseAuth) {
      auth = d.probe.parseAuth(
        await host.exec(path, d.probe.authArgs, { timeoutMs: PROBE_TIMEOUT_MS }),
      )
    } else {
      for (const f of d.probe.authFiles ?? [])
        if (await host.homeFileExists(f.path)) {
          auth = { signedIn: true, authMethod: f.method, billing: f.billing }
          break
        }
      if (auth.signedIn !== true)
        for (const e of d.probe.authEnv ?? [])
          if (await host.hasEnv(e)) {
            auth = { signedIn: true, authMethod: `env:${e}`, billing: "cli-api-key" }
            break
          }
    }
    return { ...base, installed: true, path, ...(version ? { version } : {}), ...auth }
  } catch (e) {
    return {
      ...base,
      installed: false,
      signedIn: null,
      billing: null,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function detectClis(
  host: CliProcessHost,
  adapters: readonly CliAdapter[] = BUILTIN_CLI_ADAPTERS,
): Promise<CliDetection[]> {
  return Promise.all(adapters.map((a) => detectCli(host, a)))
}

/** A usable CLI: installed and signed in (unknown auth counts as not usable for defaults). */
export const cliUsable = (d: CliDetection): boolean => d.installed && d.signedIn === true

/**
 * The default model selection for a new session. `apiProviders`: configured API providers with
 * a key (ids), default provider first. Returns null when nothing is configured (first-run card).
 */
export function pickDefaultSelection(input: {
  platform: RuntimePlatform
  clis: readonly CliDetection[]
  apiProviders: readonly { id: string; agentModel: string }[]
  /** Settings › AI providers "Default": overrides the precedence when set and usable. */
  preferred?: ModelSelection
}): ModelSelection | null {
  const usable = input.platform === "desktop" ? input.clis.filter(cliUsable) : []
  if (input.preferred) {
    const p = input.preferred
    if (
      isCliProvider(p.provider)
        ? usable.some((c) => c.id === cliIdOf(p.provider))
        : input.apiProviders.some((a) => a.id === p.provider)
    )
      return p
  }
  const claude = usable.find((c) => c.id === "claude-code")
  if (claude) return { provider: cliProviderId(claude.id), model: "default" }
  const other = usable[0]
  if (other) return { provider: cliProviderId(other.id), model: "default" }
  const api = input.apiProviders.find((a) => a.id === DEFAULT_PROVIDER_ID) ?? input.apiProviders[0]
  return api ? { provider: api.id, model: api.agentModel } : null
}
