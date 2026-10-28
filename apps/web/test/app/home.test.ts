/**
 * Home: which folder a route belongs to, the merged file list, names that never collide with an
 * existing file, the design systems index, and creating a file when the folder cannot be read.
 */
import { describe, expect, test } from "bun:test"
import { PlatformError, type RecentFile, type WatchedFolder } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  copyName,
  libraryIndex,
  mergeFiles,
  numberedName,
  probeDocument,
  resolveFolder,
} from "../../src/home/model"
import { createDiskFile, homeDocument } from "../../src/home/submit"

const file = (ref: string, modifiedAt: number, openedAt: number | null = null): RecentFile => ({
  ref,
  name: ref.split("/").pop() ?? ref,
  folder: ref.slice(0, ref.lastIndexOf("/")),
  modifiedAt,
  openedAt,
  git: null,
  missing: false,
})
const folder = (ref: string): WatchedFolder => ({
  ref,
  label: ref.split("/").pop() ?? ref,
  git: null,
  fileCount: 0,
})

describe("file lists", () => {
  test("a folder route resolves to the added folder holding it, else null (All files)", () => {
    const folders = [
      folder("/u/Work/kimo-site"),
      folder("/u/Work/kimo-site/design"),
      folder("/u/x"),
    ]
    expect(resolveFolder("/u/Work/kimo-site", folders)?.ref).toBe("/u/Work/kimo-site")
    expect(resolveFolder("/u/Work/kimo-site/design/sub", folders)?.ref).toBe(
      "/u/Work/kimo-site/design",
    )
    expect(resolveFolder("/u/Work/kimo-site-2", folders)).toBeNull()
    expect(resolveFolder("/elsewhere", folders)).toBeNull()
  })

  test("All files merges recents and folder scans, deduped by path, newest first", () => {
    const a = file("/w/a.kimo", 10, 5)
    const aScan = file("/w/a.kimo", 10)
    const b = file("/w/b.kimo", 30)
    const merged = mergeFiles([a], [aScan, b])
    expect(merged.map((f) => f.ref)).toEqual(["/w/b.kimo", "/w/a.kimo"])
    expect(merged[1]?.openedAt).toBe(5)
  })
})

describe("names", () => {
  test("a taken name gets a number, a duplicate is “<stem> copy”", () => {
    const taken = new Set(["landing.kimo", "landing 2.kimo"])
    expect(numberedName("landing.kimo", (n) => taken.has(n))).toBe("landing 3.kimo")
    expect(numberedName("Landing page", (n) => n === "Landing page")).toBe("Landing page 2")
    expect(copyName("home.kimo", () => false)).toBe("home copy.kimo")
    expect(copyName("home.kimo", (n) => n === "home copy.kimo")).toBe("home copy 2.kimo")
    expect(copyName("Pricing", () => false)).toBe("Pricing copy")
  })

  test("a refused stat is the error when creating a file, never a free name", async () => {
    const p = createMemoryPlatform({
      settings: { "files.newFilesDir": "/Users/me/Documents/Kimo" },
    })
    await p.settings.ready
    const files = p.files as { stat: typeof p.files.stat }
    files.stat = async (ref) => {
      throw new PlatformError("PERMISSION", `${ref} is outside the files Kimo was given access to`)
    }
    const e = await createDiskFile(p, "Pricing", (n) =>
      homeDocument({ title: n, owner: null }),
    ).catch((x: unknown) => x)
    expect(e instanceof PlatformError && e.code).toBe("PERMISSION")
    expect(p.control.readFile("/Users/me/Documents/Kimo/Pricing.kimo")).toBeNull()
  })
})

describe("design systems", () => {
  const doc = (o: object) => JSON.stringify({ format: "1.0.0", nodes: {}, ...o })

  test("library = meta.library or imported by a known file; local components alone don't count", () => {
    const probes = [
      probeDocument("/w/ds/kimo-ds.lib.kimo", doc({ meta: { library: true } })),
      probeDocument(
        "/w/app/settings.kimo",
        doc({ imports: { ds: "../ds/kimo-ds.lib.kimo", ui: "./ui.kimo" } }),
      ),
      probeDocument("/w/app/ui.kimo", doc({})),
      probeDocument(
        "/w/app/buttons.kimo",
        doc({ nodes: { B1: { type: "frame", parent: null, component: true } } }),
      ),
      probeDocument("/w/plain.kimo", doc({})),
      probeDocument("/w/broken.kimo", "not json"),
    ].filter((p) => p !== null)
    const libs = libraryIndex(probes)
    // buttons.kimo has a component but nothing imports it and it isn't marked as a library.
    expect(libs.map((l) => l.name)).toEqual(["kimo-ds.lib.kimo", "ui.kimo"])
    expect(libs.find((l) => l.name === "kimo-ds.lib.kimo")?.usedBy).toBe(1)
  })
})
