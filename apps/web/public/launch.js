/*
 * Launch loader boot (desing.pen board 29, vIK2m). A classic same-origin script, run from <head>
 * before first paint: the desktop CSP is `script-src 'self'`, so this can't be inline.
 *
 * - Copies the stored theme (lib/theme.ts, localStorage "kimo.theme") onto <html data-theme>, so
 *   the loader paints in the app's theme; with nothing stored, CSS follows prefers-color-scheme.
 * - The hidden document host (#/host) never shows the loader: data-launch="off" → display none.
 */
;(() => {
  const root = document.documentElement
  try {
    const t = localStorage.getItem("kimo.theme")
    if (t === "light" || t === "dark") root.dataset.theme = t
  } catch {
    // Storage blocked: the system preference applies.
  }
  if (location.hash.indexOf("#/host") === 0) root.dataset.launch = "off"
})()
