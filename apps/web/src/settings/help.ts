/**
 * Board 25 §7 (b) Help menu (A0qRF) and the About pane's outbound links (cKZbq): the items, the
 * URLs, the diagnostics block and the bus every entry point uses.
 *
 * Entry points: macOS native Help menu (menu.rs → `platform.help.onMenu`), File › Help on
 * Windows / Linux / web (FileMenu), ⌘/ (the shortcuts table). They all call
 * {@link runHelpAction}; {@link HelpHost} (mounted once per window) runs them — the issue
 * confirm, the clipboard, the browser.
 */
import { type HelpMenuAction, type KimoPlatform, REPO_URL_PLACEHOLDER } from "@kimo/platform"
import { t } from "../lib/i18n"
import { releaseLine, type VersionInfo, versionString } from "./version-info"

export type HelpAction = HelpMenuAction | "logs"

export interface HelpItem {
  id: HelpAction
  label: string
  /** Lucide name in the item's Check Slot (A0qRF RmOTH). */
  icon: "book-open" | "keyboard" | "scroll-text" | "bug" | "clipboard-copy" | "folder-open"
  /** A divider goes before this item. */
  divider?: boolean
}

/**
 * The Help items in menu order (rule oKY0y): Kimo documentation · Keyboard shortcuts ⌘/ ·
 * What's new · ─ · Report an issue… · Copy diagnostics · ─ · Show logs in Finder (desktop only).
 */
export function helpItems(o: {
  version: string
  os: KimoPlatform["os"]
  logs: boolean
}): HelpItem[] {
  const items: HelpItem[] = [
    { id: "docs", label: t("help.docs"), icon: "book-open" },
    { id: "shortcuts", label: t("help.shortcuts"), icon: "keyboard" },
    {
      id: "whats-new",
      label: t("help.whatsNew", { version: releaseLine(o.version) }),
      icon: "scroll-text",
    },
    { id: "report-issue", label: t("help.reportIssue"), icon: "bug", divider: true },
    { id: "copy-diagnostics", label: t("help.copyDiagnostics"), icon: "clipboard-copy" },
  ]
  if (o.logs) items.push({ id: "logs", label: logsLabel(o.os), icon: "folder-open", divider: true })
  return items
}

/** "Show logs in Finder" (macOS) / "… in Explorer" (Windows) / "… in folder" (Linux). */
function logsLabel(os: KimoPlatform["os"]): string {
  return os === "windows"
    ? t("help.showLogsExplorer")
    : os === "linux"
      ? t("help.showLogsFolder")
      : t("help.showLogsFinder")
}

export const DOCS_URL = "https://getkimo.design/docs/"
export const REPO_URL = REPO_URL_PLACEHOLDER

/**
 * Where provider keys live, for the About › Privacy meta: the OS store on desktop (the same names
 * as AI providers' Storage line), the page's localStorage in the browser.
 */
export function keysLocation(host: Pick<KimoPlatform, "kind" | "os">): string {
  if (host.kind !== "desktop") return t("settings.about.keysBrowser")
  return host.os === "windows"
    ? t("settings.about.keysCredential")
    : host.os === "linux"
      ? t("settings.about.keysSecret")
      : t("settings.about.keysKeychain")
}

/** The four About links (t4H8L): label · meta · icon · URL. */
export function aboutLinks(
  version: string,
  host: Pick<KimoPlatform, "kind" | "os"> = { kind: "browser", os: "web" },
) {
  return [
    {
      id: "docs",
      label: t("settings.about.docs"),
      meta: "getkimo.design/docs",
      icon: "book-open",
      url: DOCS_URL,
    },
    {
      id: "source",
      label: t("settings.about.source"),
      meta: REPO_URL.replace(/^https:\/\//, ""),
      icon: "git-branch",
      url: REPO_URL,
    },
    {
      id: "release-notes",
      label: t("settings.about.releaseNotes"),
      meta: version,
      icon: "scroll-text",
      url: releaseNotesUrl(version),
    },
    {
      id: "privacy",
      label: t("settings.about.privacy"),
      meta: t("settings.about.noTelemetry", { where: keysLocation(host) }),
      icon: "shield",
      url: `${REPO_URL}/blob/main/SECURITY.md`,
    },
  ] as const
}

export function releaseNotesUrl(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`
}

/**
 * Copy diagnostics / Report an issue (rule RkNqb): the version string, the host and the renderer —
 * never file content, paths or keys.
 */
export function diagnosticsBlock(
  info: VersionInfo,
  o: { host: KimoPlatform["kind"]; renderer: string; locale: string },
): string {
  return [
    versionString(info),
    `Host: ${o.host}`,
    `Renderer: ${o.renderer}`,
    `Locale: ${o.locale}`,
  ].join("\n")
}

/** `github.com/…/issues/new` prefilled with the diagnostics block. */
export function reportIssueUrl(diagnostics: string): string {
  const body = [
    "### What happened?",
    "",
    "",
    "### Steps to reproduce",
    "",
    "1. ",
    "",
    "### Environment",
    "",
    "```",
    diagnostics,
    "```",
  ].join("\n")
  return `${REPO_URL}/issues/new?${new URLSearchParams({ body }).toString()}`
}

/** The canvas renderer as Report an issue names it: CanvasKit over WebGL 2 + the GPU string. */
export function rendererLabel(): string {
  if (typeof document === "undefined") return "unknown"
  try {
    const gl = document.createElement("canvas").getContext("webgl2")
    if (!gl) return "CanvasKit · no WebGL 2"
    const ext = gl.getExtension("WEBGL_debug_renderer_info")
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ""
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return gpu ? `CanvasKit · WebGL 2 · ${gpu}` : "CanvasKit · WebGL 2"
  } catch {
    return "unknown"
  }
}

// --- bus ---------------------------------------------------------------------------------------

type Listener = (action: HelpAction) => void
const listeners = new Set<Listener>()

/** Runs a Help item in this window (File › Help, ⌘/ table entries, tests). */
export function runHelpAction(action: HelpAction): void {
  for (const l of listeners) l(action)
}

export function onHelpAction(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
