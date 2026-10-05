# Writing style

How Kimo's text should read: UI copy, docs, the site, error messages, and the replies the
built-in agent writes. The goal is text that sounds like a careful person wrote it. A scan in
`scripts/writing-style.test.ts` checks UI copy and docs against the banned list below.

## Voice

- Plain, specific and short. Say what happens, to what, and what the person can do next.
- Describe the thing, not how good it is. "Exports React + Tailwind" beats "powerful export".
- One idea per sentence. Split a sentence rather than chain clauses with dashes.
- Second person ("you", "your file") in docs and dialogs. No "we" in the app.
- Keep technical precision: tool names, error codes, shortcuts, paths, numbers and API names are
  never paraphrased.
- No filler openers or closers ("Great question", "Let's dive in", "I hope this helps", "In
  summary"), no self-congratulation ("Done! Everything works perfectly").

## Banned words and patterns

Words: seamless, robust, leverage, delve, elevate, streamline, cutting-edge, comprehensive,
crucial, vibrant, sleek, effortless, unlock (in the marketing sense; the Lock / Unlock command
stays), empower, supercharge, game-changer, powerful, intuitive, best-in-class, world-class,
next-gen, revolutionary, unleash, harness (in the marketing sense; a test harness is fine),
magic/magical, stunning, beautiful, delightful, effortlessly, simply, just (as a softener).

Patterns:

- "In today's …", "Whether you're X or Y", "Not just X, but Y", "It's not X, it's Y".
- Rule-of-three padding: a list of three adjectives or three parallel clauses where one would do.
- Marketing superlatives: "the best", "the fastest", "the only" (unless it is a checked fact).
- Vague abstractions: "experience", "workflow" or "solution" where a concrete noun exists.
- Emoji, anywhere in product text or docs.

## Punctuation

- Prefer a period or a comma to an em dash. Keep a dash only when a comma would misread, and
  never more than one per sentence.
- `—` alone stays as the empty-value placeholder in fields and tables, and as the separator in
  window titles (`file.kimo — Kimo`).
- No exclamation marks in the UI. Docs use them only inside code.
- Use the ellipsis character (`…`) for menu items that open a dialog, and for progress text
  ("Saving…").
- Curly quotes in UI text (`“name”`, `’`) where the surrounding code already uses them; straight
  quotes in code and docs.

## UI labels

- Sentence case for labels, buttons, menu items, titles and settings: "Add provider", "Export
  selection". Proper nouns keep their case (Claude Code, Keychain, Tailwind).
- Buttons are verbs: "Save", "Replace fonts", "Send anyway". Avoid "OK" when a verb fits.
- Errors say what failed and what to do: "Couldn't save. Permission denied." then the fix.
  "Couldn't …" is the house opener for failures; no "Oops", "Sorry" or "Something went wrong"
  when the cause is known.
- Empty states say what is missing and how to add it, in one or two sentences.
- Tooltips name the action and its shortcut; no full sentences unless the action needs one.
- Numbers: digits ("3 layers"), real units ("12 MB"), `×` for multiplication and counts like `2×`.

## Agent replies

The built-in agent's writing rules live with its prompt in `packages/ai-agent`. They follow this
page: short, specific, no hype, no emoji, no closing summary of what it just said.
