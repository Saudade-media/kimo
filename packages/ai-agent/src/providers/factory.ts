/**
 * Builds a {@link Provider} from a configured provider row. Cloud platforms (Bedrock, Vertex,
 * Foundry) speak the Anthropic Messages format to the desktop relay, which signs the request in
 * Rust (SigV4 / Google ADC / Entra) — they never run on web.
 */
import { ProviderError } from "../errors"
import { AnthropicProvider } from "./anthropic"
import { GeminiProvider } from "./gemini"
import { OpenAICompatibleProvider } from "./openai"
import type { Provider, ProviderConfig, ProviderRuntime } from "./provider"

/** Relay base URLs the desktop shell maps to the signed cloud endpoints (ADR 0014 §4). */
export const CLOUD_RELAY_BASE: Record<"bedrock" | "vertex" | "foundry", string> = {
  bedrock: "kimo-relay://bedrock",
  vertex: "kimo-relay://vertex",
  foundry: "kimo-relay://foundry",
}

export function createProvider(config: ProviderConfig, runtime: ProviderRuntime): Provider {
  switch (config.kind) {
    case "anthropic":
      return new AnthropicProvider(config, runtime)
    case "openai":
    case "openrouter":
      return new OpenAICompatibleProvider(config, runtime)
    case "gemini":
      return new GeminiProvider(config, runtime)
    case "custom":
      return config.wire === "anthropic"
        ? new AnthropicProvider({ ...config }, runtime)
        : new OpenAICompatibleProvider(config, runtime)
    case "bedrock":
    case "vertex":
    case "foundry":
      if (runtime.platform !== "desktop")
        throw new ProviderError(
          "unsupported_platform",
          "Bedrock, Vertex and Foundry run only in the desktop app (signed credentials go through Rust-side HTTP).",
          { provider: config.id },
        )
      return new AnthropicProvider(
        {
          ...config,
          baseURL: config.baseURL ?? CLOUD_RELAY_BASE[config.kind],
          refusalFallback: false,
        },
        runtime,
      )
  }
}
