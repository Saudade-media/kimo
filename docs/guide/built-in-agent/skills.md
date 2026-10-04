# Skills

A skill is a set of instructions added to the agent's system prompt: how to use Kimo's tools, a house style, a checklist. Type `/` in the composer to open the **Skills** menu.

- `↵` inserts `/name` into your message: that skill applies to this one turn.
- `⌥↵` turns a skill on or off for every following turn.

## Built-in skills

| Skill | Covers | Default |
|---|---|---|
| `kimo-design` | Schema, ops and the working loop for editing `.kimo` documents through Kimo's tools | On |
| `kimo-layout` | Auto layout and responsive sizing in Kimo frames | Off |
| `kimo-tokens` | Variables, themes and token-driven styling in Kimo | Off |

## Your own skills (desktop app)

Put each skill in its own folder under `~/.kimo/skills/`, as a `SKILL.md` that starts with front matter:

```md
---
name: brand-voice
description: Copy rules and type scale for Acme product pages.
---

Headlines are sentence case, at most eight words.
Use the `type/display` variables for headlines and never hard-code font sizes.
```

- `name` uses lowercase letters, digits and dashes (up to 64 characters), and can't reuse a built-in skill's name.
- `description` is required; the menu shows it.
- The file must be a regular UTF-8 file of at most 256 KiB inside that folder.

Kimo watches the folder, so a new or edited skill shows up in the menu (under **Yours · ~/.kimo/skills**) without a restart. A skill with a problem is listed with its error. In the desktop app, **Open skills folder** at the bottom of the menu shows `~/.kimo/skills` in Finder, Explorer or your file manager, creating it first if needed. User skills aren't available in the browser, so the button isn't shown there.
