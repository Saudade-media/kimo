/**
 * The real driver: temp git repositories with `*.kimo merge=kimo diff=kimo` and
 * `merge.kimo.driver = kimo merge %O %A %B %P` (exactly what the desktop app installs), merged
 * with `git merge`.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { type KimoDocument, parse, serialize, validate } from "@kimo/core-schema"

const MAIN = resolve(import.meta.dir, "../src/main.ts")
const hasGit = Bun.spawnSync(["git", "--version"]).exitCode === 0
// biome-ignore lint/suspicious/noExplicitAny: tests poke at JSON
type Loose = any

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const home = mkdtempSync(join(tmpdir(), "kimo-git-home-"))
dirs.push(home)

function git(cwd: string, ...args: string[]) {
  const p = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: home,
    },
  })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const base = (): Loose => ({
  $schema: "https://kimo.design/schema/kimo-1.0.json",
  format: "1.0.0",
  nodes: {
    Page000001: { type: "frame", parent: null, order: "a0", name: "Home" },
    Hero000001: { type: "frame", parent: "Page000001", order: "a0", fill: "#FFF7EE" },
    Headline01: { type: "text", parent: "Hero000001", order: "a0", content: "Plan less." },
    Footer0001: { type: "frame", parent: "Page000001", order: "a1", name: "Footer" },
    Legal00001: { type: "text", parent: "Footer0001", order: "a0", content: "©" },
  },
})

/**
 * A repo whose `main` and `feat` branches edit `design/home.kimo`; returns the result of
 * `git merge feat` on main.
 */
function scenario(ours: (d: Loose) => void, theirs: (d: Loose) => void, raw?: string) {
  const dir = mkdtempSync(join(tmpdir(), "kimo-git-"))
  dirs.push(dir)
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "merge.kimo.name", "Kimo semantic merge")
  git(dir, "config", "merge.kimo.driver", `bun ${MAIN} merge %O %A %B %P`)
  writeFileSync(join(dir, ".gitattributes"), "*.kimo merge=kimo diff=kimo\n")
  Bun.spawnSync(["mkdir", "-p", join(dir, "design")])
  const file = join(dir, "design", "home.kimo")
  const write = (d: Loose) => writeFileSync(file, serialize(d as KimoDocument))
  write(base())
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "base")
  git(dir, "checkout", "-q", "-b", "feat")
  const t = base()
  theirs(t)
  if (raw !== undefined) writeFileSync(file, raw)
  else write(t)
  git(dir, "commit", "-q", "-am", "theirs")
  git(dir, "checkout", "-q", "main")
  const o = base()
  ours(o)
  write(o)
  git(dir, "commit", "-q", "-am", "ours")
  const merge = git(dir, "merge", "--no-edit", "feat")
  return { dir, file, merge, text: () => readFileSync(file, "utf8") }
}

describe.if(hasGit)("git merge with the kimo driver", () => {
  test("disjoint edits on the same node line merge cleanly (plain git would conflict)", () => {
    const s = scenario(
      (d) => {
        d.nodes.Hero000001.fill = "#000000"
      },
      (d) => {
        d.nodes.Hero000001.name = "Hero"
      },
    )
    expect(s.merge.code).toBe(0)
    const d = parse(s.text()) as Loose
    expect(d.nodes.Hero000001).toMatchObject({ fill: "#000000", name: "Hero" })
    expect(serialize(d)).toBe(s.text())
    expect(git(s.dir, "status", "--porcelain").out).toBe("")
  })

  test("true conflicts are stored in the file; git marks the path conflicted", () => {
    const s = scenario(
      (d) => {
        d.nodes.Hero000001.fill = "#111111"
        d.nodes.Headline01.content = "Ship more."
      },
      (d) => {
        d.nodes.Hero000001.fill = "#222222"
        delete d.nodes.Legal00001
      },
    )
    expect(s.merge.code).not.toBe(0)
    expect(git(s.dir, "status", "--porcelain").out).toContain("UU design/home.kimo")
    const text = s.text()
    expect(text).not.toContain("<<<<<<<")
    const d = parse(text) as Loose
    expect(d.features).toEqual(["merge/conflicts"])
    expect(d.merge.changes).toBe(2)
    expect(Object.values(d.conflicts)).toEqual([
      {
        kind: "prop",
        node: "Hero000001",
        path: "/fill",
        base: "#FFF7EE",
        ours: "#111111",
        theirs: "#222222",
        applied: "ours",
      },
    ])
    expect(d.nodes.Legal00001).toBeUndefined()
    expect(validate(d).errors).toEqual([])
  })

  test("an unparsable side leaves git's textual merge (driver exit 2)", () => {
    const s = scenario(
      (d) => {
        d.nodes.Hero000001.fill = "#111111"
      },
      () => {},
      `${serialize(base() as KimoDocument).replace('"#FFF7EE"', '"#222222"')}trailing garbage\n`,
    )
    expect(s.merge.code).not.toBe(0)
    expect(s.text()).toContain("<<<<<<<")
    expect(s.merge.out + s.merge.err).toContain("not mergeable")
  })
})
