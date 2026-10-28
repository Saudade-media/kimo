# Releasing Kimo

One version covers the desktop app, the web app, the `kimo` CLI and every workspace package.
A release is a `vX.Y.Z` tag on `main`; `.github/workflows/release.yml` builds everything into a
**draft** GitHub release, and a maintainer publishes the draft after the smoke tests below.
Nothing is published automatically.

The `.kimo` format has its own version (`format`, `docs/spec/`). It does not move with app
releases; see [Spec freeze](#2-spec-freeze-10-only) for the one time it does.

## 0. One-time setup

### Signing and notarization secrets

Add these as secrets of the `release` environment (*Settings → Environments → release*), whose
deployment rule allows only `v*` tags, so branch workflows and fork PRs never see them. A tag
ruleset on `refs/tags/v*` limits who can create release tags. Variables stay repository-wide. Each
secret is optional: without it the corresponding step is skipped and the build is unsigned (fine
for test runs, not for a release).

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
  injects it into the release config, and the same key is committed in `tauri.conf.json`
  (since 1.0.0) so local release builds match.
- The app checks
  `https://github.com/Saudade-media/kimo/releases/download/updater/latest-<channel>.json`, where
  the channel (`stable` or `beta`) is the one picked in Settings. Both files live on the
  `updater` release, a prerelease that only holds them; don't delete it or its tag.
  `.github/workflows/updater-feed.yml` creates it on first use and, whenever a release is
  published, copies that release's `latest.json` there: to `latest-beta.json` for every release
  and to `latest-stable.json` for stable ones, never moving a feed back to an older version.
  Check that the repository slug in the endpoint is the real one.
- Installs of 1.2.0 and earlier read `releases/latest/download/latest-<channel>.json` instead,
  so `release.yml` also attaches `latest-stable.json` and `latest-beta.json` to each stable
  release. They update to the next stable release on either channel and use the new feeds from
  then on.

### Social preview image

The image shown when the repository is linked (Slack, X, search results) can only be set in the
web UI: *Settings → General → Social preview → Edit → Upload an image*. Use
`docs/assets/readme-header.png` (the README header, 1280 × 320). GitHub accepts it (the minimum
is 640 × 320) but recommends 2:1 (1280 × 640), so a 2:1 export of the header would fill link cards
without letterboxing.

## 1. Before the release

- [ ] `main` is green: `check` (lint, typecheck, generated files, unit tests, examples, e2e,
      box-diff) and `rust` (macOS, Windows, Linux).
- [ ] The `e2e (Chromium)` job shows no flaky-scenario warnings, or each one has an issue.
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
`kimo-desktop` and `kimo-mcp` crates (and their `Cargo.lock` entries), the CLI's version
strings and `@kimo/sync`'s `CLIENT_VERSION`. It accepts `major`, `minor`, `patch` and
`prerelease [--preid rc]` too.

A beta is the same release with a prerelease version, such as `1.3.0-beta.0`
(`bun scripts/version.ts 1.3.0-beta.0 --write`, then `prerelease --preid beta --write` for
`1.3.0-beta.1` and so on). The workflow marks its draft as a prerelease, and publishing it
updates only the beta feed. Beta installs get whichever is newer, the latest beta or the latest
stable release; stable installs never see a beta. The Windows MSI can't carry `-beta.N`, so
`release.yml` builds it as version `X.Y.Z.N`.

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
| updater manifest | `latest.json` and, for stable tags, `latest-stable.json` and `latest-beta.json` (for installs of 1.2.0 and earlier) |

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
      the signature, installs and relaunches (Windows: passive installer). For the first
      release there is no previous one: check instead that *Check for updates* reports no
      update, and run this check on the second release.
- [ ] A prerelease tag is not offered to stable installs, and is offered to installs on the
      beta channel (Settings → Updates).

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

- [ ] Edit the release notes on the draft. The workflow creates it with GitHub's generated
      notes (merged pull requests since the previous tag, grouped by label as configured in
      `.github/release.yml`, Dependabot updates left out); add the highlights from
      `CHANGELOG.md` above them and mark prereleases as such. The first release has no previous
      tag, so its generated notes list every merged pull request: replace them with the
      `CHANGELOG.md` entry.
- [ ] Publish the draft. When the `updater-feed` run finishes,
      `curl -L https://github.com/Saudade-media/kimo/releases/download/updater/latest-beta.json`
      returns this version, and so does `latest-stable.json` for a stable release. If the run
      failed, rerun it from `Actions → updater-feed → Run workflow` with the tag.
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
