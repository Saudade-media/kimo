/**
 * Where Kimo Cloud's API lives (kimo-cloud docs/api.md §1.1): an origin, never hard-coded in the
 * logic. The build's `VITE_KIMO_CLOUD_API_URL` picks it (unset: the default below; set but empty:
 * Kimo Cloud is hidden); the `multiplayer.cloudApiUrl` setting overrides it for development
 * (`http://localhost:8790`). The relay URL is never configured: `GET /v1/relay` answers it.
 */

const DEFAULT_CLOUD_API_URL = "https://cloud.getkimo.design"

/** `https://cloud.getkimo.design/` → `https://cloud.getkimo.design`; null when not http(s). */
function cloudOrigin(raw: string | null | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  try {
    const url = new URL(text)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

/** The build's choice: undefined uses the default, an empty value hides Kimo Cloud. */
function buildCloudApiUrl(env: string | undefined = readEnv()): string | null {
  if (env === undefined) return DEFAULT_CLOUD_API_URL
  return cloudOrigin(env)
}

/** The setting (development) wins over the build. Null: Kimo Cloud is hidden. */
export function resolveCloudApiUrl(
  setting: string | null | undefined,
  build: string | null = buildCloudApiUrl(),
): string | null {
  return cloudOrigin(setting) ?? build
}

function readEnv(): string | undefined {
  try {
    // The literal is what Vite replaces at build time.
    const value = import.meta.env.VITE_KIMO_CLOUD_API_URL as string | undefined
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}
