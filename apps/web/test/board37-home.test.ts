/**
 * Board 37 "Home & gaps" (A1, B1–B7, B11): section helpers, list sources, new-file names, the
 * Design systems index, the web Trash clock and the "Couldn't …" copy.
 */
import { describe, expect, test } from "bun:test"
import { PlatformError, type RecentFile, type WatchedFolder } from "@kimo/platform"
import {
  causeOf,
  copyName,
  countLabel,
  daysLeft,
  failure,
  filesNote,
  libraryIndex,
  libraryInfo,
  mergeFiles,
  numberedName,
  probeDocument,
  resolveFolder,
  resolveImport,
  sameSection,
  searchFiles,
} from "../src/home/model"

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

describe("sections", () => {
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
  test("sameSection compares folders by ref", () => {
    expect(sameSection({ kind: "all" }, { kind: "all" })).toBe(true)
    expect(sameSection({ kind: "folder", ref: "/a" }, { kind: "folder", ref: "/b" })).toBe(false)
    expect(sameSection({ kind: "trash" }, { kind: "templates" })).toBe(false)
  })
  test("All files merges recents and folder scans, deduped by path, newest first", () => {
    const a = file("/w/a.kimo", 10, 5)
    const aScan = file("/w/a.kimo", 10)
    const b = file("/w/b.kimo", 30)
    const merged = mergeFiles([a], [aScan, b])
    expect(merged.map((f) => f.ref)).toEqual(["/w/b.kimo", "/w/a.kimo"])
    expect(merged[1]?.openedAt).toBe(5)
  })
  test("search is case-insensitive on the name", () => {
    expect(searchFiles([file("/w/Pricing.kimo", 1), file("/w/home.kimo", 1)], " pric").length).toBe(
      1,
    )
    expect(searchFiles([file("/w/a.kimo", 1)], "").length).toBe(1)
  })
  test("Files Header copy", () => {
    expect(countLabel(24)).toBe("24 files")
    expect(countLabel(1)).toBe("1 file")
    expect(countLabel(3, "library", "libraries")).toBe("3 libraries")
    expect(filesNote("all", 4)).toBe("in 4 folders and Recents · sorted by modified")
    expect(filesNote("folder", 4)).toBe("in this folder and its subfolders · sorted by modified")
  })
})

describe("names", () => {
  test("a taken template name gets “ 2”", () => {
    const taken = new Set(["landing.kimo", "landing 2.kimo"])
    expect(numberedName("landing.kimo", (n) => taken.has(n))).toBe("landing 3.kimo")
    expect(numberedName("Landing page", (n) => n === "Landing page")).toBe("Landing page 2")
  })
  test("Duplicate is “<stem> copy”", () => {
    expect(copyName("home.kimo", () => false)).toBe("home copy.kimo")
    expect(copyName("home.kimo", (n) => n === "home copy.kimo")).toBe("home copy 2.kimo")
    expect(copyName("Pricing", () => false)).toBe("Pricing copy")
  })
})

describe("design systems", () => {
  const doc = (o: object) => JSON.stringify({ format: "1.0.0", nodes: {}, ...o })
  test("library = meta.library, a published component, or imported by a known file", () => {
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
    expect(libs.map((l) => l.name)).toEqual(["buttons.kimo", "kimo-ds.lib.kimo", "ui.kimo"])
    expect(libs.find((l) => l.name === "kimo-ds.lib.kimo")?.usedBy).toBe(1)
    expect(libs.find((l) => l.name === "buttons.kimo")?.components).toBe(1)
    expect(libraryInfo({ components: 12, usedBy: 2 })).toBe("12 components · used by 2 files")
    expect(libraryInfo({ components: 1, usedBy: 1 })).toBe("1 component · used by 1 file")
  })
  test("import paths resolve against the importing file", () => {
    expect(resolveImport("/w/app/a.kimo", "../ds/x.kimo")).toBe("/w/ds/x.kimo")
    expect(resolveImport("/w/app/a.kimo", "./x.kimo")).toBe("/w/app/x.kimo")
    expect(resolveImport("/w/app/a.kimo", "/abs/x.kimo")).toBe("/abs/x.kimo")
  })
})

describe("web Trash and errors", () => {
  const DAY = 86_400_000
  test("days left before a trashed file is deleted for good", () => {
    expect(daysLeft(0, 0)).toBe("30 days")
    // A clock read before the file was trashed never shows more than 30.
    expect(daysLeft(5000, 0)).toBe("30 days")
    expect(daysLeft(0, DAY + 1)).toBe("29 days")
    expect(daysLeft(0, 29.5 * DAY)).toBe("1 day")
    expect(daysLeft(0, 40 * DAY)).toBe("1 day")
  })
  test("“Couldn't <verb> <object>” then the cause", () => {
    expect(failure("move home.kimo to the Trash", new PlatformError("PERMISSION", "EACCES"))).toBe(
      "Couldn't move home.kimo to the Trash. Permission denied.",
    )
    expect(failure("rename home.kimo", new PlatformError("EXISTS", "taken"), "pricing.kimo")).toBe(
      "Couldn't rename home.kimo. pricing.kimo already exists.",
    )
    expect(causeOf(new PlatformError("EXISTS", "x"))).toBe("A file with that name exists.")
    expect(causeOf(new Error("Disk ejected"))).toBe("Disk ejected.")
  })
})
