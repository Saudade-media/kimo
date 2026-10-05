import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { type KimoDocument, MERGE_EXIT, parse, serialize, validate } from "@kimo/core-schema"
import { type CliIO, GC_EXIT, pathHash, run, USAGE_EXIT, VALIDATE_EXIT } from "../src/cli"

const FIXTURES = resolve(import.meta.dir, "../../core-schema/fixtures")
const MAIN = resolve(import.meta.dir, "../src/main.ts")
const hasGit = Bun.spawnSync(["git", "--version"]).exitCode === 0

// biome-ignore lint/suspicious/noExplicitAny: tests poke at JSON
type Loose = any

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "kimo-cli-"))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function capture(cwd?: string, env?: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }
  if (cwd) io.cwd = cwd
  if (env) io.env = env
  return { io, out: () => out.join(""), err: () => err.join("") }
}

const base = (): KimoDocument =>
  ({
    $schema: "https://kimo.design/schema/kimo-1.0.json",
    format: "1.0.0",
    nodes: {
      Page000001: { type: "frame", parent: null, order: "a0", name: "Home", w: 1440, h: 900 },
      Hero000001: { type: "frame", parent: "Page000001", order: "a0", fill: "#FFF7EE" },
      Headline01: { type: "text", parent: "Hero000001", order: "a0", content: "Plan less." },
      Footer0001: { type: "frame", parent: "Page000001", order: "a1", name: "Footer" },
    },
  }) as unknown as KimoDocument

const edit = (f: (d: Loose) => void): KimoDocument => {
  const d = JSON.parse(JSON.stringify(base())) as Loose
  f(d)
  return d
}

describe("kimo validate", () => {
  test("valid file: exit 0; open conflicts are warnings (exit 1 with --strict)", async () => {
    const f = join(FIXTURES, "lint/CONFLICT_OPEN--board-18.kimo")
    const a = capture()
    expect(await run(["validate", f], a.io)).toBe(VALIDATE_EXIT.ok)
    expect(a.out()).toContain("CONFLICT_OPEN")
    const b = capture()
    expect(await run(["validate", "--strict", f], b.io)).toBe(VALIDATE_EXIT.invalid)
  })

  test("invalid file: exit 1, with --json", async () => {
    const f = join(FIXTURES, "invalid/PARENT_CYCLE--two-node-cycle.kimo")
    const c = capture()
    expect(await run(["validate", "--json", f], c.io)).toBe(VALIDATE_EXIT.invalid)
    const [report] = JSON.parse(c.out())
    expect(report.errors.map((e: { code: string }) => e.code)).toContain("PARENT_CYCLE")
  })

  test("unparsable or newer file: exit 2", async () => {
    for (const f of ["parse-errors/truncated.kimo", "forward/newer-minor.kimo"]) {
      const c = capture()
      expect(await run(["validate", join(FIXTURES, f)], c.io)).toBe(VALIDATE_EXIT.unreadable)
      expect(c.out()).toContain("cannot validate")
    }
    const c = capture()
    expect(await run(["validate", "/nope/missing.kimo"], c.io)).toBe(VALIDATE_EXIT.unreadable)
  })

  test("libraries are loaded relative to the file; assets/ is listed", async () => {
    const c = capture()
    expect(await run(["validate", join(FIXTURES, "valid/example-10-5.kimo")], c.io)).toBe(1)
    expect(c.out()).not.toContain("LIBRARY_NOT_LOADED")
    // The fixture folder has no assets/: the referenced image is reported missing (spec §12).
    expect(c.out()).toContain("ASSET_MISSING")
  })

  test("usage errors exit 64", async () => {
    const c = capture()
    expect(await run(["validate"], c.io)).toBe(USAGE_EXIT)
    expect(await run(["frobnicate"], c.io)).toBe(USAGE_EXIT)
    expect(await run(["gc", "a", "--force"], c.io)).toBe(USAGE_EXIT)
    expect(c.err()).toContain("Usage:")
  })
})

describe("kimo merge (in process)", () => {
  function files(b: KimoDocument, o: KimoDocument | string, t: KimoDocument | string) {
    const d = tmp()
    const w = (n: string, v: KimoDocument | string) => {
      writeFileSync(join(d, n), typeof v === "string" ? v : serialize(v))
      return join(d, n)
    }
    return { dir: d, base: w("base", b), ours: w("ours", o), theirs: w("theirs", t) }
  }

  test("clean: exit 0 and the canonical result in <ours>", async () => {
    const f = files(
      base(),
      edit((d) => {
        d.nodes.Hero000001.fill = "#000000"
      }),
      edit((d) => {
        d.nodes.Headline01.content = "Ship more."
      }),
    )
    const c = capture()
    expect(await run(["merge", f.base, f.ours, f.theirs, "design/home.kimo"], c.io)).toBe(
      MERGE_EXIT.clean,
    )
    const text = readFileSync(f.ours, "utf8")
    expect(serialize(parse(text))).toBe(text)
    const d = parse(text) as Loose
    expect(d.nodes.Hero000001.fill).toBe("#000000")
    expect(d.nodes.Headline01.content).toBe("Ship more.")
    expect(c.err()).toContain("design/home.kimo: 2 changes merged")
  })

  test("conflicts: exit 1, stored with labels (-L ours,base,theirs), file validates", async () => {
    const f = files(
      base(),
      edit((d) => {
        d.nodes.Hero000001.fill = "#111111"
      }),
      edit((d) => {
        d.nodes.Hero000001.fill = "#222222"
      }),
    )
    const c = capture()
    const code = await run(
      ["merge", f.base, f.ours, f.theirs, "home.kimo", "-L", "main,4e1a9c2,feat/pricing-v2"],
      c.io,
    )
    expect(code).toBe(MERGE_EXIT.conflicts)
    const d = parse(readFileSync(f.ours, "utf8")) as Loose
    expect(d.merge).toEqual({
      base: "4e1a9c2",
      ours: "main",
      theirs: "feat/pricing-v2",
      changes: 0,
    })
    expect(Object.values(d.conflicts)).toHaveLength(1)
    expect(validate(d).errors).toEqual([])
  })

  test("-o writes elsewhere and leaves <ours> untouched", async () => {
    const ours = edit((d) => {
      d.nodes.Hero000001.fill = "#000000"
    })
    const f = files(base(), ours, base())
    const out = join(f.dir, "out.kimo")
    expect(await run(["merge", f.base, f.ours, f.theirs, "-o", out], capture().io)).toBe(0)
    expect(readFileSync(f.ours, "utf8")).toBe(serialize(ours))
    expect(parse(readFileSync(out, "utf8"))).toEqual(parse(serialize(ours)))
  })

  test.if(hasGit)("unparsable input: exit 2 and git's textual merge in <ours>", async () => {
    const theirs = serialize(base()).replace('"Plan less."', '"Plan more."')
    const f = files(base(), `${serialize(base())}<<<<<<< broken\n`, theirs)
    const c = capture()
    expect(await run(["merge", f.base, f.ours, f.theirs], c.io)).toBe(MERGE_EXIT.failed)
    expect(c.err()).toContain("not mergeable")
    expect(readFileSync(f.ours, "utf8")).toContain("<<<<<<<")
  })

  test("a newer format is not mergeable", async () => {
    const newer = readFileSync(join(FIXTURES, "forward/newer-minor.kimo"), "utf8")
    const f = files(base(), base(), newer)
    expect(await run(["merge", f.base, f.ours, f.theirs], capture().io)).toBe(MERGE_EXIT.failed)
  })
})

describe("kimo gc", () => {
  function project(lock?: object) {
    const d = tmp()
    mkdirSync(join(d, "assets"))
    writeFileSync(join(d, "assets", "aaaaaaaaaaaaaaaa.png"), "used")
    writeFileSync(join(d, "assets", "bbbbbbbbbbbbbbbb.png"), "unused!")
    writeFileSync(join(d, "assets", "cccccccccccccccc.svg"), "listed but unused")
    const doc = edit((x) => {
      x.assets = {
        "aaaaaaaaaaaaaaaa.png": { mime: "image/png" },
        "cccccccccccccccc.svg": { mime: "image/svg+xml" },
      }
      x.nodes.Img0000001 = {
        type: "rect",
        parent: "Hero000001",
        order: "a1",
        w: 10,
        h: 10,
        fill: { kind: "image", src: "./assets/aaaaaaaaaaaaaaaa.png", fit: "cover" },
      }
    })
    const file = join(d, "home.kimo")
    writeFileSync(file, serialize(doc))
    const home = join(d, ".kimo-home")
    if (lock) {
      mkdirSync(join(home, "locks"), { recursive: true })
      writeFileSync(join(home, "locks", `${pathHash(file)}.lock`), JSON.stringify(lock))
    }
    return { dir: d, file, env: { KIMO_HOME: home } }
  }

  test("dry run lists unreferenced files and manifest entries, deletes nothing", async () => {
    const p = project()
    const c = capture(undefined, p.env)
    expect(await run(["gc", p.file], c.io)).toBe(GC_EXIT.ok)
    expect(c.out()).toContain("Would remove 2 unused assets")
    expect(c.out()).toContain("assets/bbbbbbbbbbbbbbbb.png")
    expect(c.out()).toContain("cccccccccccccccc.svg")
    expect(existsSync(join(p.dir, "assets", "bbbbbbbbbbbbbbbb.png"))).toBe(true)
  })

  test("--yes deletes them and prunes the manifest; the document still validates", async () => {
    const p = project()
    const c = capture(undefined, p.env)
    expect(await run(["gc", p.file, "--yes"], c.io)).toBe(GC_EXIT.ok)
    expect(existsSync(join(p.dir, "assets", "bbbbbbbbbbbbbbbb.png"))).toBe(false)
    expect(existsSync(join(p.dir, "assets", "cccccccccccccccc.svg"))).toBe(false)
    expect(existsSync(join(p.dir, "assets", "aaaaaaaaaaaaaaaa.png"))).toBe(true)
    const d = parse(readFileSync(p.file, "utf8")) as Loose
    expect(Object.keys(d.assets)).toEqual(["aaaaaaaaaaaaaaaa.png"])
    expect(validate(d, { assetFiles: ["aaaaaaaaaaaaaaaa.png"] }).errors).toEqual([])
    const again = capture(undefined, p.env)
    expect(await run(["gc", p.file], again.io)).toBe(0)
    expect(again.out()).toContain(
      "Nothing to clean up. Every asset is in use. Each file in assets/",
    )
  })

  test("a live lease blocks --yes (exit 3); a dead pid's lease does not", async () => {
    const live = project({ pid: process.pid, host: hostname(), appLabel: "Kimo", sinceIso: "" })
    const c = capture(undefined, live.env)
    expect(await run(["gc", live.file, "--yes"], c.io)).toBe(GC_EXIT.locked)
    expect(c.err()).toContain("locked by Kimo")
    expect(existsSync(join(live.dir, "assets", "bbbbbbbbbbbbbbbb.png"))).toBe(true)
    const dead = project({ pid: 999999, host: hostname(), appLabel: "Kimo" })
    expect(await run(["gc", dead.file, "--yes"], capture(undefined, dead.env).io)).toBe(0)
  })
})

describe("the kimo executable", () => {
  test("runs as a script and returns exit codes", () => {
    const p = Bun.spawnSync(["bun", MAIN, "validate", join(FIXTURES, "valid/minimal.kimo")])
    expect(p.exitCode).toBe(0)
    expect(p.stdout.toString()).toContain("valid")
    expect(Bun.spawnSync(["bun", MAIN, "--version"]).stdout.toString()).toContain("kimo")
  })
})
