/**
 * Selection → engine. A session's `{provider, model}` names either an API provider (the Kimo
 * loop over a {@link Provider}) or a local CLI (`cli:<id>`, the CLI runs its own loop through
 * Kimo's MCP server). Unknown ids fail loudly in both cases.
 */
import { BUILTIN_CLI_ADAPTERS } from "./cli/adapters"
import { type CliAdapter, type CliDetection, cliIdOf, isCliProvider } from "./cli/types"
import { ProviderError } from "./errors"
import { type ResolvedModel, resolveModel } from "./models"
import type { ProviderConfig } from "./providers/provider"
import type { ModelSelection } from "./types"

export type ResolvedRuntime =
  | { kind: "api"; resolved: ResolvedModel; config: ProviderConfig }
  | { kind: "cli"; adapter: CliAdapter; detection: CliDetection; model: string }

export function resolveRuntime(
  selection: ModelSelection,
  ctx: {
    providers: readonly ProviderConfig[]
    clis: readonly CliDetection[]
    adapters?: readonly CliAdapter[]
    platform: "desktop" | "web" | "node"
  },
): ResolvedRuntime {
  if (isCliProvider(selection.provider)) {
    const id = cliIdOf(selection.provider)
    if (ctx.platform === "web")
      throw new ProviderError(
        "unsupported_platform",
        "Local agent CLIs run only in the desktop app.",
        { provider: selection.provider },
      )
    const adapter = (ctx.adapters ?? BUILTIN_CLI_ADAPTERS).find((a) => a.def.id === id)
    const detection = ctx.clis.find((c) => c.id === id)
    if (!adapter || !detection?.installed)
      throw new ProviderError("unknown_model", `${adapter?.def.label ?? id} is not installed.`, {
        provider: selection.provider,
      })
    return { kind: "cli", adapter, detection, model: selection.model || "default" }
  }
  const resolved = resolveModel(selection, ctx.providers)
  const config = ctx.providers.find((p) => p.id === resolved.provider.id) as ProviderConfig
  return { kind: "api", resolved, config }
}
