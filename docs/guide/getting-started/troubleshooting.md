# Troubleshooting

## Files

**"Locked by another process."** Another Kimo window or the headless MCP server has the file open for writing. Close it there, or choose **Open read-only**. If the process named in the details is no longer running, **Retry** takes over its lock.

**"Couldn't save — permission denied."** The folder isn't writable. Use **Save as…** to save somewhere else.

**"Saved, but the read-back didn't match."** Something changed the file right after Kimo wrote it, often an antivirus or a sync client. **Show diff** compares the two; **Save as…** keeps a safe copy.

**Disk full or an I/O error.** Your edits are kept in a recovery file and Kimo retries every 30 seconds.

**"It still contains git conflict markers."** The file was merged by git line by line and contains `<<<<<<<` markers, which Kimo can't load. Resolve the merge in git, then set up the semantic merge driver (**Settings › Files & autosave › Git merge driver**) so it doesn't happen again.

**"Read-only — made with a newer Kimo."** The file uses a newer format than this version knows. Update Kimo.

**Autosave paused.** Kimo pauses while git is busy in the repository, or while merge conflicts are open. It resumes on its own once the git operation ends or the conflicts are resolved.

## Fonts

**Missing fonts.** When a file uses fonts that aren't installed, Kimo offers to **Replace** them, **Keep for now** (the text renders with a fallback), **Open fonts folder**, or **Fetch** them from Google Fonts.

**"Google Fonts are off or you're offline."** Turn on **Google Fonts** in **Settings › Fonts & privacy** (it's off while **No third-party fetch** is on), or install the font locally.

**A weight is missing** (`Inter Bold (700) isn't installed`). Install that weight, or pick one that is.

## Agents

**A coding agent can't reach Kimo.** Coding agents connect to the desktop app, not the browser. Check **Settings › Agents & MCP**: if **MCP server failed to start**, use **Change port** or **Retry**. After installing Kimo in an agent's config, restart the agent (or run `/mcp` in it). See [Connect a coding agent](../../agents/index.md).

**Agent edits paused.** The file is locked by another process or open read-only, so agents can't write to it either.

**A CLI shows "Not on PATH".** Install Claude Code, Codex or Gemini CLI, then click **Re-check all** in **Settings › AI providers**. If it shows **not signed in**, sign in from a terminal (`claude auth login`, `codex login`, or `gemini`).

**"Side by side and split run their child agents in Kimo."** These modes need an API model; pick one in the model picker, or use Single or Iterate with your CLI.

**An OpenAI-compatible endpoint or Ollama fails in the browser.** The browser blocks requests the server doesn't allow (CORS). Allow Kimo's origin (for Ollama, `OLLAMA_ORIGINS`) or use the desktop app.

**"Monthly limit reached."** Raise or clear the limit in **Settings › AI providers › Usage & limits**.

## Updates

**"Couldn't check: …"** The update check couldn't reach GitHub. Check your connection and try **Check now** in **Settings › Updates**.

## Still stuck

**Copy diagnostics** in the Help menu copies your version, platform, renderer and locale, nothing else. Include it when you [open an issue](https://github.com/kimo-design/kimo/issues).
