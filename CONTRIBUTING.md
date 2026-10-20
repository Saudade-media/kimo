# Contributing to Kimo

Thanks for helping build an open, local-first design canvas. This guide covers setup, the check
pipeline, and the rules that keep the file format, the design system and the architecture
coherent. The plan of record is [docs/teardown.md](docs/teardown.md); decisions live in
[docs/adr](docs/adr/README.md).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Questions go to
[GitHub Discussions](https://github.com/Saudade-media/kimo/discussions); [SUPPORT.md](SUPPORT.md)
lists where everything else goes.

This repository holds the apps, the packages and the docs. The website, getkimo.design, lives in
a separate private repository and renders the docs from this one at a pinned commit, so a docs
change lands here and reaches the site with its next update.

## Setup

Kimo uses [Bun](https://bun.sh) workspaces. **bun is the only supported package manager**: do not
commit `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`.

```sh
bun install
bun run check
```

Desktop work also needs the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
(Rust toolchain and OS libraries).

Adding a dependency: run `bun add <dep>` inside the package that needs it, never at the root
unless it is repo-wide tooling. A new runtime dependency in anything under `packages/` needs a
justification in the PR (and an ADR if it is architectural), because those packages must run in
Node, Bun, browsers and workers. Only `apps/*` may depend on React or Tauri, with one exception:
`packages/ui` (browser-only editor chrome) may depend on React, and only apps may import it
([ADR 0001](docs/adr/0001-monorepo-and-server-readiness.md)).

## The check pipeline

`bun run check` is what CI runs, and it must pass before review:

| Step | Command | What it does |
|---|---|---|
| Lint + format | `bun run lint` (`biome check .`) | Biome; 2 spaces, double quotes, no semicolons. Fix with `bunx biome check --write <paths>` |
| Typecheck | `bun run typecheck` | `tsc` per workspace; strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |
| Generated artifacts | `bun run check:generated` | Each package's `check:generated` verifies committed generated files (JSON Schema, design tokens) are up to date; it fails if they are stale |
| Tests | `bun run test` | `scripts/test-all.sh`: one guarded `bun test` per workspace; files named `*.test.ts` under each package's `test/` directory |

### Running tests safely

A runaway `bun test` once grew past 200 GB of memory and crashed the machine it ran on, so tests
run through a guard:

- Run tests only through `scripts/safe-test.sh` or `bun run test`. The guard kills the run at
  4 GB of memory or after 15 minutes, applies a 10 s per-test timeout (also set in
  `bunfig.toml`) and holds a machine-wide lock, so only one guarded run happens at a time.
  - One file or package: `scripts/safe-test.sh ./packages/layout/test/property.test.ts`
  - Tighter limits: `SAFE_TEST_MAX_RSS_MB=1024 SAFE_TEST_TIMEOUT=60 scripts/safe-test.sh <path>`
  - Everything: `bun run test`, one guarded process per workspace (a single process over the
    whole repo passes 4 GB).
- Never run bare `bun test`, and don't run several test processes in parallel.
- Keep test fakes bounded: no endless streams, unbounded loops or retries.

Typecheck one package with `bunx tsc -p packages/<name>/tsconfig.json`.

Browser end-to-end and perf runs are separate from `check`: `bun run --filter @kimo/web e2e` and
`bun run --filter @kimo/web e2e:perf` (`bun run --filter @kimo/web e2e "<name filter>"` runs the
scenarios whose name matches). CI runs the e2e suite on macOS, because the scenarios measure the
app against the design boards, which are drawn for macOS. **Exception to bun-only:** these two scripts run their
Playwright driver under Node through `tsx` (an `apps/web` devDependency), because under Bun 1.3.5
the pipe to Chromium is intermittently closed mid-session and the scenario hangs until its timeout
(details in `apps/web/e2e/run.ts`). Bun remains the package manager and the script runner, and
nothing that ships runs under Node. Perf numbers from before this switch (Bun-driven) are not
comparable with Node-driven ones: compare baseline and candidate with the same driver, interleaved,
and record `uptime` load averages with every run.

Code expectations: well-typed TypeScript, JSDoc on public APIs, tests next to the behaviour they
cover (property tests with fast-check where an invariant exists), and comments that explain *why*
rather than restating code.

## Commits and pull requests

`main` is protected: every change lands through a pull request, and pull requests are
**squash-merged** once CI is green, so `main` has one commit per pull request and a linear
history.

1. Fork the repository (or, with write access, create a branch), and branch from `main`.
2. Commit as you like on your branch; the commits are squashed on merge.
3. Open a pull request against `main`. **Its title becomes the commit title on `main`, and its
   description becomes the commit message**, so write both for the log:
   - The title is a plain sentence that says what changes, like the existing history
     (`git log --oneline`), e.g. "PDF export rounds content stream numbers so output is
     byte-identical across platforms". No `feat:` / `fix:` prefixes.
   - The description says *what* and *why*, links the issue or ADR (`Closes #123`), and notes any
     spec or format impact.
4. CI (`check` and, for desktop changes, `rust`) must pass. A maintainer reviews, then
   squash-merges.

Keep a pull request to one thing. Regenerated files go in the same pull request as the change
that requires them.

## Architecture decisions (ADRs)

Write an ADR when a decision is hard to reverse, crosses package boundaries, changes the file
format or a public protocol (MCP tools, socket protocol), adds a runtime dependency under
`packages/`, or deviates from the teardown. Copy
[docs/adr/0000-template.md](docs/adr/0000-template.md) to the next number, set status
**Proposed**, and open a PR; it becomes **Accepted** on merge. Accepted ADRs are superseded by
new ones, not rewritten. See [docs/adr/README.md](docs/adr/README.md).

Two rules from [ADR 0001](docs/adr/0001-monorepo-and-server-readiness.md) are checked in review:

- **Dependency direction** as listed in [docs/architecture.md](docs/architecture.md#dependency-rule); nothing depends on `apps/server`.
- **One op path:** every document mutation (UI, agent, MCP, file watcher) goes through
  `editor-state` ops with an origin. No direct writes to the Yjs document or the file.

## Design changes

The editor's design system is defined in [`desing.pen`](desing.pen)
([ADR 0007](docs/adr/0007-editor-design-system.md)).

1. Change the design in `desing.pen` first. Until Kimo can open its own design, this means
   editing it with pen.dev/Pencil; tooling reads it only through the Pencil MCP.
2. Update the tokens (`packages/design-tokens`) and commit them with the design change:
   1. refresh the snapshot `packages/design-tokens/test/fixtures/pen-variables.json` through the
      Pencil MCP (`Print(JSON.stringify(GetVariables()))` on `desing.pen`);
   2. transcribe the changes into `packages/design-tokens/src/tokens.json`;
   3. run `bun run --filter @kimo/design-tokens build:tokens`.

   The tests compare `tokens.json` with the snapshot. Changes to `desing.pen` are not detected
   automatically: if the snapshot is not refreshed, CI cannot see them. Never hand-edit the
   generated files under `src/generated/`; `check:generated` will fail.
3. Update `packages/ui` components to consume the new tokens. Color stays reserved for selection,
   agent activity and status.

PRs that change chrome visuals without a matching `desing.pen` change will be asked to add one.

## File format and spec changes

The `.kimo` format is the product ([ADR 0005](docs/adr/0005-kimo-file-format.md)). A format
change must update, **in the same PR**:

1. the prose spec in `docs/spec/`,
2. the normative TypeScript types in `@kimo/core-schema` and the regenerated JSON Schema,
3. fixtures and tests (round-trip, forward-compat and, for any non-additive change, a migration
   with its own fixtures),
4. the format changelog, with the semver bump (minor for additive or feature-flagged changes,
   major for breaking ones).

A PR touching only one of these will not be merged.

## Licensing and sign-off

Kimo is [MIT](LICENSE). Contributions are accepted under the same licence
(**inbound = outbound**): by submitting a contribution you agree it is licensed under MIT.

- **No CLA.** You keep your copyright.
- **No DCO sign-off is required.** Inbound = outbound under MIT is enough for this project; a
  `Signed-off-by` trailer is welcome but not checked.
- Only contribute code you have the right to submit. Do not copy code, prompts, skill text or
  assets from proprietary products (pen.dev included) or from open-source projects without
  respecting and recording their licence (see [teardown 13.4](docs/teardown.md#134-legal-and-ethical-risks)).
  Third-party code must be listed in [NOTICE](NOTICE).

## Reporting bugs and security issues

Open a [GitHub issue](https://github.com/Saudade-media/kimo/issues/new/choose) for bugs and
feature requests, and use [Discussions](https://github.com/Saudade-media/kimo/discussions) for
questions. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

New issues get the `needs triage` label until a maintainer looks at them. Issues labeled
`good first issue` are small and well scoped, a good place to start; `help wanted` marks issues
where an outside contribution is especially welcome.
