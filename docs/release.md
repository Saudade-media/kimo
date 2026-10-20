# Releasing Kimo

One version covers the desktop app, the web app, the `kimo` CLI and every workspace package.
A release is a `vX.Y.Z` tag on `main`; `.github/workflows/release.yml` builds everything into a
**draft** GitHub release, and a maintainer publishes the draft after the smoke tests below.
Nothing is published automatically.

The `.kimo` format has its own version (`format`, `docs/spec/`). It does not move with app
releases; see [Spec freeze](#2-spec-freeze-10-only) for the one time it does.

## 0. One-time setup

### Signing and notarization secrets

Add these under *Settings → Secrets and variables → Actions*. Each is optional: without it the
corresponding step is skipped and the build is unsigned (fine for test runs, not for a release).

| Secret / variable | Used for | How to get it |
|---|---|---|
| `APPLE_CERTIFICATE` | macOS code signing | Export the *Developer ID Application* certificate with its private key from Keychain Access as `.p12`; `base64 -i cert.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD` | " | The `.p12` export password. |
| `APPLE_SIGNING_IDENTITY` | " | `Developer ID Application: <Name> (<TEAMID>)` (`security find-identity -v -p codesigning`). |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization (Apple ID) | An app-specific password from appleid.apple.com. |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | notarization (API key, preferred) | App Store Connect → Users and Access → Keys; `APPLE_API_KEY_P8` is the base64 of `AuthKey_<id>.p8`. |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Authenticode | base64 of an OV/EV code signing `.pfx` and its password. EV certificates on hardware tokens need a cloud signing service instead (set `bundle.windows.signCommand`). |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater signatures | See below. |
| variable `TAURI_UPDATER_PUBKEY` | updater public key | See below. |
| variable `WINDOWS_TIMESTAMP_URL` | optional | Defaults to `http://timestamp.digicert.com`. |

### Updater keys

```sh
bunx tauri signer generate -w ~/.tauri/kimo-updater.key
```

- Store the private key **content** as `TAURI_SIGNING_PRIVATE_KEY` and its password as
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline backup: losing the key means installed
  apps can never update again (they only accept manifests signed by it).
- Store the public key as the repository variable `TAURI_UPDATER_PUBKEY`. The release build
  injects it over `UPDATER_PUBKEY_PLACEHOLDER` in `tauri.conf.json`; once the key is final,
  commit it to `tauri.conf.json` as well so local release builds match.
- The app's updater endpoint is
  `https://github.com/Saudade-media/kimo/releases/latest/download/latest-stable.json`. The workflow
  uploads tauri-action's `latest.json` and, for non-prerelease tags, a copy named
  `latest-stable.json`. Check that the repository slug in the endpoint is the real one.

## 1. Before the release

- [ ] `main` is green: `check` (lint, typecheck, generated files, unit tests, examples, e2e,
      box-diff) and `rust` (macOS, Windows, Linux).
- [ ] The e2e job summary lists no flaky scenarios (`↻`), or each one has an issue.
- [ ] `bun run check:examples` passes; rebuild thumbnails with `bun run build:examples` if the
      renderer changed and commit them.
- [ ] `docs/scope-checklist.md` and the ADRs reflect what ships.
- [ ] Dependencies: Dependabot PRs merged or deferred on purpose; `cargo update -p` only with a
      reason; the lockfiles are committed.
- [ ] Third-party notices are current (`bun run check:generated`).

## 2. Spec freeze (1.0 only)

For 1.0 the format becomes `1.0.0` and stays backward compatible within 1.x
(spec §16.4).

- [ ] Resolve the open spec items; nothing marked *draft* or *reserved* without a decision.
- [ ] Copy `docs/spec/kimo-format-v0.1.md` → `kimo-format-1.0.md` (status *Stable*, no "Draft");
      keep the 0.1 file as a historical record that points to 1.0.
- [ ] `@kimo/core-schema`: `FORMAT_VERSION` = `1.0.0`, `SCHEMA_URL` =
      `https://getkimo.design/schema/kimo-1.0.json`, a `0.1 → 1.0` migration (even if it only
      rewrites `format` and `$schema`), fixtures under `fixtures/forward/` and
      `fixtures/migrations/` updated; keep `schema/kimo-0.1.schema.json` as the frozen 0.1 schema.
- [ ] `bun run --filter @kimo/core-schema build:schema`, then `bun run check:generated`.
- [ ] `bun run build:examples` (the examples pick up the new version) and commit.
- [ ] Publish the JSON Schema at `https://getkimo.design/schema/kimo-1.0.json` (and keep 0.1).
- [ ] Opening a 0.1 file in the release build migrates it after the upgrade-consent prompt.

## 3. Version bump

```sh
bun scripts/version.ts                 # current version, and any drift between files
bun scripts/version.ts 1.0.0           # dry run: every file and line that would change
bun scripts/version.ts 1.0.0 --write   # apply
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --locked
```

`scripts/version.ts` updates every workspace `package.json`, `tauri.conf.json`, the
`kimo-desktop` and `kimo-mcp` crates (and their `Cargo.lock` entries) and the CLI's version
strings. It accepts `major`, `minor`, `patch` and `prerelease [--preid rc]` too.

- [ ] Move the `Unreleased` section of `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`.
- [ ] `bun run check` passes.
- [ ] Commit (`Release vX.Y.Z`), open a PR, merge it.

## 4. Tag and build

```sh
git switch main && git pull
git tag -s vX.Y.Z -m "Kimo X.Y.Z"
git push origin vX.Y.Z
```

The workflow checks that the tag matches `tauri.conf.json` and that no version drifted, then:

| Job | Produces |
|---|---|
| desktop · macOS | universal `Kimo.app` (`.app.tar.gz` + `.sig` for the updater) and `.dmg`, signed and notarized |
| desktop · Windows | `.msi` and NSIS `-setup.exe` (+ `.sig`), Authenticode-signed |
| desktop · Linux | `.AppImage` (+ `.sig`) and `.deb` |
| web | `kimo-web-X.Y.Z.tar.gz`: the static web app for any static host |
| cli | `bun publish --dry-run` of `@kimo/cli` (nothing uploaded) |
| updater manifest | `latest.json` and, for stable tags, `latest-stable.json` |

Every desktop bundle bundles `kimo-mcp` next to the app binary (`tauri.bundle.conf.json`
`externalBin`, staged by `apps/desktop/scripts/build-shim.ts`).

`Actions → release → Run workflow` runs the same builds without a tag or release (artifacts
only), to try signing changes on a branch.

## 5. Smoke tests (on the draft's artifacts)

Run on a clean machine or VM per platform (macOS on Apple silicon **and** Intel or Rosetta,
Windows 11, Ubuntu 22.04 or later).

**Install and launch**

- [ ] macOS: the `.dmg` opens, the app launches without a Gatekeeper warning
      (`spctl -a -vv /Applications/Kimo.app` says *Notarized Developer ID*).
- [ ] Windows: no SmartScreen "unknown publisher" (the signature shows the publisher); MSI and
      NSIS both install and uninstall.
- [ ] Linux: the AppImage runs; the `.deb` installs and appears in the app menu.
- [ ] `Kimo.app/Contents/MacOS/kimo-mcp --version` (and the Windows/Linux equivalents) runs.

**Files**

- [ ] Double-click each file in `examples/`: the file association opens it; the library
      consumer finds `kimo-ds.lib.kimo`; the dashboard switches mode and density.
- [ ] Edit, save, quit, reopen; edit externally while open (reload prompt); kill the app while
      dirty (recovery offers the snapshot).
- [ ] `kimo://` deep link opens the app (single instance).
- [ ] Settings → install the git merge driver, then reproduce `examples/merge-demo` in a
      scratch repo: the merge stores one conflict and the Conflicts panel resolves it.
- [ ] Missing font flow (open a file using an uninstalled font), local font, Google font.

**Export**

- [ ] Export the dashboard as React + Tailwind, HTML/CSS, tokens (DTCG), SVG, PDF and PNG; the
      HTML matches the canvas in both themes.

**Updater**

- [ ] Install the previous release, then *Check for updates*: it finds this version, verifies
      the signature, installs and relaunches (Windows: passive installer).
- [ ] A prerelease tag is not offered to stable installs.

**Agents (real, not scripted)**

- [ ] Settings → Agents & MCP → install for Claude Code; in a terminal Claude Code session ask it
      to change the dashboard's revenue chart; presence, the approval prompt, attribution and
      the Activity tab show it; undo reverts it.
- [ ] The same with Codex (default approval mode, then `--auto-approve`) and Gemini CLI.
- [ ] Built-in agent: with an Anthropic API key, and with the Claude Code provider signed in,
      generate a screen from the Home composer; split mode rejects out-of-scope edits.
- [ ] Headless: `kimo mcp --headless` in `examples/` with Claude Code edits a file without the
      app running and saves atomically.

## 6. Publish

- [ ] Write the release notes from `CHANGELOG.md` on the draft; mark prereleases as such.
- [ ] Publish the draft. Then
      `curl -L https://github.com/Saudade-media/kimo/releases/latest/download/latest-stable.json`
      returns this version.
- [ ] Deploy `kimo-web-X.Y.Z.tar.gz` to the static host.
- [ ] CLI: `@kimo/cli` is still `private`, because it imports unpublished workspace packages
      (`@kimo/core-schema`, `@kimo/editor-state`, `@kimo/mcp-server`, `@kimo/platform`) and ships
      TypeScript sources run by Bun. Publishing it needs either a bundled build (`bun build`
      into one file, dependencies inlined) or publishing those packages first; then drop
      `private`, and publish from CI with provenance (`npm publish --provenance` or
      `bun publish`) using an automation token.
- [ ] Announce; close the milestone.

## 7. After the release

- [ ] Add a fresh `## [Unreleased]` section to `CHANGELOG.md`.
- [ ] File issues for anything the smoke tests found.
