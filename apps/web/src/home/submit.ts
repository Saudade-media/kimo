/**
 * Home composer submit (board 22 "Home composer rules" › Submit): ↵ creates "<title>.kimo" in
 * the default folder (title from the fast model, fallback "Untitled"), never overwriting
 * (an existing name gets " 2", " 3"…), with the first root frame as a placeholder owned by the
 * session's agent, then stashes the hand-off and opens the editor.
 */
import {
  cliIdOf,
  isCliProvider,
  type ModelSelection,
  newSessionId,
  placeholderFor,
} from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import type { FileRef, KimoPlatform } from "@kimo/platform"
import { defaultNewFilesDir, homeOf } from "../settings/model"
import type { HomeHandoffRecord } from "./handoff"

/** Chip presets (board 06 Chips y5Si79) → prompt prefill and the first frame's size. */
export const HOME_PRESETS = {
  "Landing page": { prefill: "A landing page for ", w: 1440, h: 1024 },
  "Mobile app": { prefill: "A mobile app screen for ", w: 390, h: 844 },
  Dashboard: { prefill: "A dashboard for ", w: 1440, h: 900 },
  "Design system": { prefill: "A design system for ", w: 1440, h: 1024 },
  Slides: { prefill: "A slide deck about ", w: 1920, h: 1080 },
} as const
export type HomePreset = keyof typeof HOME_PRESETS

export const UNTITLED = "Untitled"
export const FIRST_FRAME_ID = "HomeFrame1"

/** Owner origin of the session's placeholder (ADR 0014 §5 / §11). */
export function ownerOrigin(model: ModelSelection, sessionId: string): string {
  return isCliProvider(model.provider)
    ? `mcp:${cliIdOf(model.provider)}.${sessionId}`
    : `agent:kimo.${sessionId}.0`
}

/** The new document: one root frame, `placeholder: {by, since}` (format §5.3). */
export function homeDocument(opts: {
  title: string
  preset?: HomePreset | undefined
  owner: string | null
  now?: Date
}): KimoDocument {
  const d = createEmptyDocument(opts.title) as KimoDocument & { nodes: Record<string, unknown> }
  const size = opts.preset ? HOME_PRESETS[opts.preset] : { w: 1440, h: 1024 }
  d.nodes[FIRST_FRAME_ID] = {
    type: "frame",
    parent: null,
    order: "a0",
    name: opts.title,
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
    fill: "#FFFFFF",
    ...(opts.owner ? { placeholder: placeholderFor(opts.owner, opts.now) } : {}),
  }
  return d
}

/** `files.newFilesDir`, else `~/Documents/Kimo` (board 19 "New files go to"). */
export { defaultNewFilesDir }

const join = (dir: string, name: string) =>
  `${dir.replace(/[\\/]+$/, "")}${dir.includes("\\") && !dir.includes("/") ? "\\" : "/"}${name}`

/** "Pricing page", "Pricing page 2", … — the first name `exists` says is free. */
export async function uniqueName(
  title: string,
  exists: (name: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? title : `${title} ${n}`
    if (!(await exists(name))) return name
  }
  return `${title} ${Date.now()}`
}

/** Writes `<dir>/<title>[ n].kimo` (never overwriting). */
export async function createDiskFile(
  platform: KimoPlatform,
  title: string,
  build: (name: string) => KimoDocument,
  dir = defaultNewFilesDir(platform),
): Promise<{ ref: FileRef; name: string }> {
  // `stat` resolves null for a free name; any rejection (PERMISSION outside the granted folders,
  // IO) is the real failure and propagates (audit A4), never read as "free".
  const name = await uniqueName(
    title,
    async (n) => (await platform.files.stat(join(dir, `${n}.kimo`))) !== null,
  )
  const ref = join(dir, `${name}.kimo`)
  // Last check right before the write: a file that appeared meanwhile is never overwritten.
  if (await platform.files.stat(ref)) return createDiskFile(platform, `${name} 2`, build, dir)
  await platform.files.writeTextAtomic(ref, serialize(build(name)), { mkdirs: true })
  return { ref, name }
}

export interface HomeSubmitDeps {
  platform: KimoPlatform
  model: ModelSelection
  /** Fast-model title (null → "Untitled"). */
  nameFile(prompt: string): Promise<string | null>
  /** Web: creates a library file and returns its id; desktop uses {@link createDiskFile}. */
  createWebFile?(name: string, document: KimoDocument): Promise<string>
  /** Existing web library names (uniqueness). */
  webNames?(): Promise<string[]>
  stash(h: HomeHandoffRecord): void
  now?: () => number
}

export type HomeSubmitStep =
  | { step: "created"; fileName: string; display: string }
  | { step: "opening" }

/** Runs the submit; resolves with the hand-off (the caller navigates). */
export async function submitHomePrompt(
  prompt: string,
  preset: HomePreset | undefined,
  deps: HomeSubmitDeps,
  onStep: (s: HomeSubmitStep) => void = () => {},
): Promise<HomeHandoffRecord> {
  const now = deps.now ?? Date.now
  const sessionId = newSessionId()
  const owner = ownerOrigin(deps.model, sessionId)
  const title = (await deps.nameFile(prompt).catch(() => null)) ?? UNTITLED
  const build = (name: string) => homeDocument({ title: name, preset, owner, now: new Date(now()) })
  let path: string
  let name: string
  let display: string
  if (deps.createWebFile) {
    const taken = new Set((await deps.webNames?.().catch(() => [])) ?? [])
    name = await uniqueName(title, async (n) => taken.has(n))
    path = await deps.createWebFile(name, build(name))
    display = `${name}.kimo`
  } else {
    const r = await createDiskFile(deps.platform, title, build)
    path = r.ref
    name = r.name
    const home = homeOf(deps.platform.recovery.dir)
    display = home && r.ref.startsWith(home) ? `~${r.ref.slice(home.length)}` : r.ref
  }
  onStep({ step: "created", fileName: `${name}.kimo`, display })
  const h: HomeHandoffRecord = {
    prompt,
    ...(preset ? { preset } : {}),
    path,
    sessionId,
    fileName: `${name}.kimo`,
    model: deps.model,
    frameId: FIRST_FRAME_ID,
    owner,
    createdAt: now(),
  }
  deps.stash(h)
  onStep({ step: "opening" })
  return h
}

/** "Design by hand instead": an empty file, no agent, no placeholder. */
export function emptyDocument(title: string): KimoDocument {
  return createEmptyDocument(title)
}
