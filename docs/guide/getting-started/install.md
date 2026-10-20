# Install Kimo

Kimo is a local-first design canvas that coding agents can edit. It runs as a desktop app on macOS, Windows and Linux, or in a browser. There is no account and no sign-up.

## Desktop app

Download the build for your system from the latest [GitHub release](https://github.com/Saudade-media/kimo/releases/latest):

| System | Download |
|---|---|
| macOS (Apple silicon and Intel) | `.dmg` (one universal app) |
| Windows x64 | `.msi` or the `-setup.exe` installer |
| Linux x64 | `.AppImage` or `.deb` (needs glibc 2.35, Ubuntu 22.04 or newer) |

The desktop app opens `.kimo` and `.kimoz` files from Finder, Explorer or your file manager, and `kimo://` links. It is the full Kimo: files on disk with autosave, the [MCP server](../../agents/index.md) for coding agents, local agent CLIs for the [built-in agent](../built-in-agent/providers.md), git integration and updates.

### Updates

Kimo checks for an update when it starts and, with **Download updates** on (the default), downloads it in the background. A toast then says **Kimo X is ready · Restart**. Restarting saves every open file first; Kimo never restarts on its own. **Settings › Updates** has the switch, the release channel and **Check now**. With **Download updates** off, an available update shows **Download** there (turning the switch on downloads it); once downloaded, **Restart to update** saves every open file in every window first. A failed check or download shows a banner with **Retry**.

## In a browser

Open the web app from **Open in browser** on [kimo.design](https://kimo.design). It runs entirely in the browser; your files stay in that browser's storage until you save them to disk.

| | Desktop | Browser |
|---|---|---|
| Files | Real files on disk, autosaved | A library in the browser's storage. **Save** writes a `.kimo` (or a `.kimoz` if it has images) to disk; in Chromium browsers Save can write back to the file in place |
| Coding agents (MCP) | Yes | No: agents connect to the desktop app |
| Built-in agent | Local CLIs and every API provider | Some API providers (see [Providers](../built-in-agent/providers.md)) |
| Git merge driver, Reveal in Finder, updates | Yes | No |
| Local fonts | Yes | Where the browser allows it |

## Build from source

Kimo is open source (MIT). With [Bun](https://bun.sh):

```sh
bun install
bun --filter @kimo/web dev       # the web editor
bun --filter @kimo/desktop dev   # the desktop app (needs the Tauri v2 prerequisites)
```

See [Contributing](../../../CONTRIBUTING.md) for the full setup.

Next: [Your first file](first-file.md).
