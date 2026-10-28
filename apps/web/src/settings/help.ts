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
    { id: "docs", label: "Kimo documentation", icon: "book-open" },
    { id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard" },
    { id: "whats-new", label: `What's new in ${releaseLine(o.version)}`, icon: "scroll-text" },
    { id: "report-issue", label: "Report an issue…", icon: "bug", divider: true },
    { id: "copy-diagnostics", label: "Copy diagnostics", icon: "clipboard-copy" },
  ]
  if (o.logs) items.push({ id: "logs", label: logsLabel(o.os), icon: "folder-open", divider: true })
  return items
}

/** "Show logs in Finder" (macOS) / "… in Explorer" (Windows) / "… in folder" (Linux). */
function logsLabel(os: KimoPlatform["os"]): string {
  return os === "windows"
    ? "Show logs in Explorer"
    : os === "linux"
      ? "Show logs in folder"
      : "Show logs in Finder"
}

export const DOCS_URL = "https://getkimo.design/docs/"
export const REPO_URL = REPO_URL_PLACEHOLDER

/**
 * Where provider keys live, for the About › Privacy meta: the OS store on desktop (the same names
 * as AI providers' Storage line), the page's localStorage in the browser.
 */
export function keysLocation(host: Pick<KimoPlatform, "kind" | "os">): string {
  if (host.kind !== "desktop") return "keys stay in this browser"
  return host.os === "windows"
    ? "keys stay in Credential Manager"
    : host.os === "linux"
      ? "keys stay in Secret Service"
      : "keys stay in your Keychain"
}

/** The four About links (t4H8L): label · meta · icon · URL. */
export function aboutLinks(
  version: string,
  host: Pick<KimoPlatform, "kind" | "os"> = { kind: "browser", os: "web" },
) {
  return [
    {
      id: "docs",
      label: "Documentation",
      meta: "getkimo.design/docs",
      icon: "book-open",
      url: DOCS_URL,
    },
    {
      id: "source",
      label: "Source code",
      meta: REPO_URL.replace(/^https:\/\//, ""),
      icon: "git-branch",
      url: REPO_URL,
    },
    {
      id: "release-notes",
      label: "Release notes",
      meta: version,
      icon: "scroll-text",
      url: releaseNotesUrl(version),
    },
    {
      id: "privacy",
      label: "Privacy",
      meta: `No telemetry · ${keysLocation(host)}`,
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
