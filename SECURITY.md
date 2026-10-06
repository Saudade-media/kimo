# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| < 1.0 | No (development milestones, never released) |

Security fixes ship as 1.0.x patch releases. Desktop apps receive them through the built-in
updater.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it through GitHub's private vulnerability reporting ("Report a vulnerability" under the
repository's **Security** tab).

Include what is affected (package, app, version or commit), how to reproduce it, and the impact
you expect. We aim to acknowledge reports within 3 working days and to agree on a fix and
disclosure timeline with you. We credit reporters in the advisory unless you prefer otherwise.

## Scope

In scope, with particular interest:

- **Local endpoints:** the MCP socket (`~/.kimo/socket/kimo.sock` / named pipe), the localhost
  Streamable HTTP server and its tokens, and the web attach bridge (pairing tokens, `Origin`
  checks). Any way for another local user, a website or a non-paired process to reach them.
- **File handling:** anything that writes outside the intended document and `assets/` folder,
  path or URI resolution that escapes the document's directory, saving over a file after a failed
  load, or a crafted `.kimo` / `.kimoz` / SVG / font that causes code execution or data loss.
- **Agent permissions:** bypassing the permission prompts for file system, shell or network
  access, or escaping a spawned agent's enforced scope.
- **Secrets:** API keys leaving the OS keychain or local storage, or being sent anywhere other
  than the configured provider.
- **Script sandbox** (once script nodes ship): any escape from the sandbox.
- **Desktop app:** Tauri capability or `fs` scope misconfiguration, updater integrity.

Out of scope: vulnerabilities in third-party model providers themselves, issues that require an
already-compromised machine or user account, and social engineering.

## Design principles that matter for security

Kimo has no backend and no account, and no telemetry: no analytics, crash reporting or usage
tracking, on or off. The only network requests are Google Fonts (`fonts.googleapis.com`,
`fonts.gstatic.com` only: when a file uses a Google font you don't have, after which the font is
stored in the file's `assets/` folder and never fetched again; and the optional offline font pack,
only when you press Download), the AI provider you configure (only when you use the built-in
agent), the agent's web searches and page reads (run by the provider's servers or the agent CLI,
never by Kimo; on by default, Settings › AI providers › Allow web access), and the desktop update
check against GitHub releases. "No third-party fetch" (Settings › Fonts & privacy) blocks every
Google request, including the pack, and turns off the agent's web access. Kimo never loads remote image
URLs: format 1.0 images are files in `assets/`. Local endpoints bind to loopback
only and require tokens. These are commitments; a deviation from them is a security bug.
