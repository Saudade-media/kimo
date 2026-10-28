/**
 * Board 25 §7 rule "Version string": `Kimo <semver> (<build>) · <os> · <arch>` — the same block
 * the About pane shows (minus "Kimo"), Copy version info copies, and Copy diagnostics / Report an
 * issue send. Never file content, paths or keys.
 */
import type { HostOS, KimoPlatform } from "@kimo/platform"

export interface VersionInfo {
  version: string
  /** Build number (CI `VITE_KIMO_BUILD`, else the commit count at build time; "dev" otherwise). */
  build: string
  /** "macOS", "Windows", "Linux"; on the web the browser's OS + "(web)". */
  os: string
  /** "arm64", "x64"; null when the host can't tell (web). */
  arch: string | null
}

const OS_LABEL: Record<Exclude<HostOS, "web">, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
}

/** Rust `std::env::consts::ARCH` → the names people know (`aarch64` → `arm64`). */
function archLabel(arch: string | undefined | null): string | null {
  if (!arch) return null
  if (arch === "aarch64") return "arm64"
  if (arch === "x86_64") return "x64"
  if (arch === "x86") return "x86"
  return arch
}

/** The OS a browser runs on, from its user agent (web builds only). */
function webOsLabel(ua: string): string {
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS"
  if (/Windows/i.test(ua)) return "Windows"
  if (/CrOS/i.test(ua)) return "ChromeOS"
  if (/Linux/i.test(ua)) return "Linux"
  return "Unknown OS"
}

function buildNumber(): string {
  // The literal `import.meta.env.VITE_KIMO_BUILD` is what vite.config.ts `define` replaces.
  try {
    return import.meta.env.VITE_KIMO_BUILD || "dev"
  } catch {
    return "dev"
  }
}

export function versionInfo(
  platform: Pick<KimoPlatform, "os" | "appVersion" | "arch">,
): VersionInfo {
  const os =
    platform.os === "web"
      ? `${webOsLabel(typeof navigator === "undefined" ? "" : navigator.userAgent)} (web)`
      : OS_LABEL[platform.os]
  return { version: platform.appVersion, build: buildNumber(), os, arch: archLabel(platform.arch) }
}

/** `1.0.0 (412) · macOS · arm64` (the pane prefixes "Version "). */
export function versionLine(i: VersionInfo): string {
  return [`${i.version} (${i.build})`, i.os, ...(i.arch ? [i.arch] : [])].join(" · ")
}

/** `Kimo 1.0.0 (412) · macOS · arm64` — Copy version info. */
export function versionString(i: VersionInfo): string {
  return `Kimo ${versionLine(i)}`
}

/** "1.0" for "What's new in 1.0" (the release line). */
export function releaseLine(version: string): string {
  return version.split(/[.+-]/).slice(0, 2).join(".")
}
