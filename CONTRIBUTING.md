# Contributing to Kimo

Thanks for helping build an open, local-first design canvas. This guide covers setup, the check
pipeline, and the rules that keep the file format, the design system and the architecture
coherent. The plan of record is [docs/teardown.md](docs/teardown.md); decisions live in
[docs/adr](docs/adr/README.md).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

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
| Tests | `bun run test` | `bun test`; files named `*.test.ts` under each package's `test/` directory |

Run a single package with `bun test packages/<name>` and
`bunx tsc -p packages/<name>/tsconfig.json`.

Browser end-to-end and perf runs are separate from `check`: `bun run --filter @kimo/web e2e` and
`bun run --filter @kimo/web e2e:perf`. **Exception to bun-only:** these two scripts run their
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

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): summary`, where `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`,
  `perf`, `build`, `ci`, `chore`, and `scope` is a package or app name without the `@kimo/`
  prefix (e.g. `feat(core-schema): add canonical serializer`). Mark breaking changes with `!`.
- Keep commits focused; a PR should do one thing. Regenerated files go in the same commit as the
  change that requires them.
- Describe *what* and *why* in the PR, link the issue or ADR, and note any spec or format impact.

## Architecture decisions (ADRs)

Write an ADR when a decision is hard to reverse, crosses package boundaries, changes the file
format or a public protocol (MCP tools, socket protocol), adds a runtime dependency under
`packages/`, or deviates from the teardown. Copy
[docs/adr/0000-template.md](docs/adr/0000-template.md) to the next number, set status
**Proposed**, and open a PR; it becomes **Accepted** on merge. Accepted ADRs are superseded by
new ones, not rewritten. See [docs/adr/README.md](docs/adr/README.md).

Two rules from [ADR 0001](docs/adr/0001-monorepo-and-server-readiness.md) are checked in review:

- **Dependency direction** as listed in the README; nothing depends on `apps/server`.
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

Open a GitHub issue for bugs and feature requests. For vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.
