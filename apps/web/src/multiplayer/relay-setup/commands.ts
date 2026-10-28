/**
 * Board 42 sections 4-6 and rules "Allowed origins", "Fly.io", "Railway", "Relay image": the text
 * Kimo hands out for relays it does not run itself. Each builder takes this device's public key
 * (`KIMO_OWNER_KEY`, ADR 0017: it makes the relay this device's from the start) and a `masked`
 * flag: the screen shows the key shortened, Copy puts the whole value on the clipboard. The key is
 * public, so nothing here is a secret.
 *
 * Environment names are the relay's own (apps/server/src/config.ts): `PORT`, `HOST`,
 * `KIMO_DATA_DIR`, `KIMO_OWNER_KEY`, `KIMO_ALLOWED_ORIGINS`.
 */

/** The published relay image (CI builds apps/server/Dockerfile). */
export const RELAY_IMAGE = "ghcr.io/saudade-media/kimo-relay"

/** The relay's default port. */
export const RELAY_PORT = 8787

/** The Fly config in the repository (copy-paste path) and as shown in the one-click log. */
export const FLY_CONFIG_PATH = "apps/server/deploy/fly.toml"

/** Deploy on Railway: the Kimo Relay template (the published relay image, a volume at /data). */
const RAILWAY_TEMPLATE_URL = "https://railway.com/deploy/Q_WYo8"

/**
 * Whether Railway prefills template variables from the deploy link's query (ADR 0017 point 9: a
 * staff answer says it does, the docs do not). Off until it is tested: then the relay starts
 * unclaimed and the wizard's Test claims it.
 */
export const RAILWAY_PREFILLS_VARIABLES = false

/** The Deploy on Railway link, with `KIMO_OWNER_KEY` prefilled when Railway honours it. */
export function railwayDeployUrl(
  ownerKey: string | null,
  prefill: boolean = RAILWAY_PREFILLS_VARIABLES,
): string {
  if (!prefill || !ownerKey) return RAILWAY_TEMPLATE_URL
  return `${RAILWAY_TEMPLATE_URL}?KIMO_OWNER_KEY=${encodeURIComponent(ownerKey)}`
}

/** The official Bun installer, shown in full before Kimo runs it (and for Install it myself). */
export const BUN_INSTALL_COMMAND = "curl -fsSL https://bun.sh/install | bash"

/** Windows and other install options. */
export const BUN_INSTALL_URL = "https://bun.sh/docs/installation"

/** Origins Kimo adds for you: the page's origin on web, none on desktop. */
export function autoOrigins(platform: "web" | "desktop", pageOrigin: string | null): string[] {
  if (platform === "desktop" || !pageOrigin) return []
  const origin = originOf(pageOrigin)
  return origin ? [origin] : []
}

/** `scheme://host[:port]` of an http(s) URL, or null. */
export function originOf(text: string): string | null {
  try {
    const url = new URL(text.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * The value of `KIMO_ALLOWED_ORIGINS`: automatic and extra origins, deduplicated, comma-joined.
 * Null when there are none: then Kimo leaves the variable out (the relay allows any origin).
 */
export function originsValue(origins: readonly string[]): string | null {
  const seen: string[] = []
  for (const o of origins) {
    const origin = originOf(o)
    if (origin && !seen.includes(origin)) seen.push(origin)
  }
  return seen.length ? seen.join(",") : null
}

/** A value as one shell word: bare when it is safe, else single-quoted. */
function shellWord(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export interface RelayEnvInput {
  /** This device's public key (base64url), or null while it loads. */
  ownerKey: string | null
  origins: readonly string[]
}

/** Characters of the key the screen shows before the ellipsis. */
const SHOWN_KEY_CHARS = 13

/** The key as shown on screen (`ed25519:Hq7mK2vX9pLw4…`) or, unmasked, as copied. */
function ownerKeyText(key: string, masked: boolean): string {
  return masked ? `ed25519:${key.slice(0, SHOWN_KEY_CHARS)}…` : key
}

/** Section 4: `docker run` for the published image, the owner key and origins filled in. */
export function dockerRunCommand(
  input: RelayEnvInput & { port?: number },
  opts: { masked: boolean },
): string {
  const port = input.port ?? RELAY_PORT
  const lines = [
    "docker run -d --name kimo-relay --restart unless-stopped \\",
    `  -p ${port}:8787 -v kimo-relay:/data \\`,
  ]
  if (input.ownerKey)
    lines.push(`  -e KIMO_OWNER_KEY=${ownerKeyText(input.ownerKey, opts.masked)} \\`)
  const origins = originsValue(input.origins)
  if (origins) lines.push(`  -e KIMO_ALLOWED_ORIGINS=${shellWord(origins)} \\`)
  lines.push(`  ${RELAY_IMAGE}`)
  return lines.join("\n")
}

/** Section 5 C: the Fly.io commands to copy (run from a clone of the repository). */
export function flyManualCommands(
  input: RelayEnvInput,
  opts: { masked: boolean },
): { launch: string; secrets: string; deploy: string } {
  const vars: string[] = []
  if (input.ownerKey) vars.push(`KIMO_OWNER_KEY=${ownerKeyText(input.ownerKey, opts.masked)}`)
  const origins = originsValue(input.origins)
  if (origins) vars.push(`KIMO_ALLOWED_ORIGINS=${shellWord(origins)}`)
  return {
    launch: `fly launch --copy-config -c ${FLY_CONFIG_PATH} --no-deploy`,
    secrets: vars.length ? `fly secrets set ${vars.join(" ")}` : "",
    deploy: `fly deploy -c ${FLY_CONFIG_PATH}`,
  }
}

/** The environment of the relay Kimo runs on this computer (section 3). */
export function localRelayEnv(input: RelayEnvInput & { port: number }): Record<string, string> {
  const env: Record<string, string> = { PORT: String(input.port), HOST: "0.0.0.0" }
  if (input.ownerKey) env.KIMO_OWNER_KEY = input.ownerKey
  const origins = originsValue(input.origins)
  if (origins) env.KIMO_ALLOWED_ORIGINS = origins
  return env
}

// --- Fly.io with flyctl (section 5 A, B) ---------------------------------------------------------

/** Fly app names: lowercase letters, digits and dashes, starting with a letter. */
export function validFlyApp(name: string): boolean {
  return /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name) && !name.includes("--")
}

/** A suggested app name: `kimo-relay-<name>` from the person's display name, else random. */
export function suggestFlyApp(displayName: string, random: () => number = Math.random): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
  if (slug) return `kimo-relay-${slug}`
  return `kimo-relay-${Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(4, "0")}`
}

/** The relay URL of a Fly app. */
export const flyRelayUrl = (app: string) => `wss://${app}.fly.dev`

/** One flyctl step of the deploy log: what the line says, and what runs. */
export interface FlyStep {
  id: "apps" | "secrets" | "volumes" | "deploy" | "health"
  label: string
  /** flyctl arguments; null for the health check (Kimo polls the relay). */
  args: string[] | null
  /** Written to flyctl's stdin (the variables, which `secrets import` reads). */
  stdin?: string
}

/**
 * Section 5 B: apps create, secrets set (`KIMO_OWNER_KEY` and the origins), volumes create, deploy
 * with the Fly config, health check. `config` is the path of the fly.toml Kimo wrote
 * ({@link flyToml}).
 */
export function flyDeploySteps(
  input: RelayEnvInput & { app: string; region: string; config: string },
): FlyStep[] {
  const { app, region, config } = input
  const origins = originsValue(input.origins)
  const vars: string[] = []
  if (input.ownerKey) vars.push(`KIMO_OWNER_KEY=${input.ownerKey}`)
  if (origins) vars.push(`KIMO_ALLOWED_ORIGINS=${origins}`)
  const names = vars.map((v) => v.slice(0, v.indexOf("=")))
  const steps: FlyStep[] = [
    { id: "apps", label: `fly apps create ${app}`, args: ["apps", "create", app] },
  ]
  if (vars.length)
    steps.push({
      id: "secrets",
      label: `fly secrets set ${names.join(" ")}`,
      args: ["secrets", "import", "--app", app, "--stage"],
      stdin: `${vars.join("\n")}\n`,
    })
  steps.push(
    {
      id: "volumes",
      label: "fly volumes create kimo_data --size 1",
      args: [
        "volumes",
        "create",
        "kimo_data",
        "--size",
        "1",
        "--app",
        app,
        "--region",
        region,
        "--yes",
      ],
    },
    {
      id: "deploy",
      label: `fly deploy -c ${FLY_CONFIG_PATH}`,
      args: ["deploy", "--config", config, "--app", app, "--ha=false", "--yes"],
    },
    { id: "health", label: "Wait for health check", args: null },
  )
  return steps
}

/**
 * The fly.toml Kimo writes for a one-click deploy: apps/server/deploy/fly.toml with this app and
 * region (a test keeps the two in step).
 */
export function flyToml(input: { app: string; region: string }): string {
  return `app = "${input.app}"
primary_region = "${input.region}"

[build]
  image = "${RELAY_IMAGE}:latest"

[env]
  HOST = "0.0.0.0"
  PORT = "8787"
  KIMO_DATA_DIR = "/data"
  KIMO_TRUST_PROXY = "1"

[mounts]
  source = "kimo_data"
  destination = "/data"

[http_service]
  internal_port = 8787
  force_https = true
  # WebSockets stay open for hours: never stop the machine on idle.
  auto_stop_machines = "off"
  auto_start_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    timeout = "3s"
    method = "GET"
    path = "/healthz"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
`
}

/** `flyctl auth whoami` prints the account email; the first line that looks like one. */
export function parseFlyWhoami(output: string): string | null {
  const m = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(output)
  return m ? m[0] : null
}
