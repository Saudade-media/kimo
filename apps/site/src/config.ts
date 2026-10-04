/**
 * Site configuration. Everything a deploy may need to change comes from the environment, with
 * defaults read from the repository itself (never hardcoded release facts).
 *
 *   KIMO_SITE_REPO      GitHub "owner/name" (default: the slug in the desktop updater endpoint)
 *   KIMO_SITE_APP_URL   where "Open in browser" points (default: <site>/app/)
 *   KIMO_SITE_URL       canonical origin of the site (default: https://kimo.design)
 *   KIMO_SITE_OFFLINE   "1" skips the GitHub contributors request (the section is then omitted)
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FORMAT_VERSION, SCHEMA_URL } from "@kimo/core-schema"

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..")

function repoSlugFromUpdater(): string {
  const conf = JSON.parse(
    readFileSync(join(REPO_ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
  ) as { plugins?: { updater?: { endpoints?: string[] } }; version?: string }
  const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? ""
  const m = /github\.com\/([^/]+\/[^/]+)\/releases/.exec(endpoint)
  if (!m?.[1]) throw new Error("no GitHub repo slug in tauri.conf.json updater endpoints")
  return m[1]
}

/**
 * The app version shown on the site: the desktop bundle version when it has been set, otherwise
 * the newest released entry in CHANGELOG.md (versions 0.x are milestones, not tags).
 */
export function appVersion(): string {
  const conf = JSON.parse(
    readFileSync(join(REPO_ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
  ) as { version?: string }
  if (conf.version && conf.version !== "0.0.0") return conf.version
  const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8")
  const m = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)
  return m?.[1] ?? "0.0.0"
}

const env = (k: string) => {
  const v = process.env[k]
  return v && v.trim() !== "" ? v.trim() : undefined
}

export interface SiteConfig {
  repo: string
  repoUrl: string
  releasesUrl: string
  siteUrl: string
  appUrl: string
  version: string
  /** "v0.7": the short label used on pills. */
  versionLabel: string
  formatVersion: string
  schemaUrl: string
  offline: boolean
  blob(path: string): string
  tree(path: string): string
}

export function loadConfig(): SiteConfig {
  const repo = env("KIMO_SITE_REPO") ?? repoSlugFromUpdater()
  const repoUrl = `https://github.com/${repo}`
  const siteUrl = (env("KIMO_SITE_URL") ?? "https://kimo.design").replace(/\/$/, "")
  const version = appVersion()
  const [major, minor] = version.split(".")
  return {
    repo,
    repoUrl,
    releasesUrl: `${repoUrl}/releases/latest`,
    siteUrl,
    appUrl: env("KIMO_SITE_APP_URL") ?? `${siteUrl}/app/`,
    version,
    versionLabel: `v${major}.${minor}`,
    formatVersion: FORMAT_VERSION,
    schemaUrl: SCHEMA_URL,
    offline: env("KIMO_SITE_OFFLINE") === "1",
    blob: (path) => `${repoUrl}/blob/main/${path}`,
    tree: (path) => `${repoUrl}/tree/main/${path}`,
  }
}
