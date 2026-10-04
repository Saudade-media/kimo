<!-- Generated from packages/mcp-server/guides/text.md by scripts/gen-guides.ts. Agents read the same text with kimo_read_docs {path: "text"}. MIT licence. -->

# Text

```json
{"type":"text","content":"Ship faster","grow":"fixed-width","w":{"mode":"fill"},
 "style":{"font":"Inter","size":32,"weight":700,"lineHeight":1.2,"letterSpacing":-0.5}}
```

## Growth

| `grow` | Width | Height | Use for |
|---|---|---|---|
| `auto` (default) | from content | from content | labels, buttons, one-liners. Omit `w`/`h` |
| `fixed-width` | `w` | from content | paragraphs, anything that wraps |
| `fixed` | `w` | `h` | fixed boxes. Overflow is cut only by an ancestor's `clip` |

## Style

`font` (family), `size` px, `weight` 1–1000, `italic`, `lineHeight` (a multiplier like `1.4`,
or `{"px":24}`), `letterSpacing` px, `align` (`left` `center` `right` `justify`), `valign`
(`top` `middle` `bottom`), `decoration` (`["underline"]`, `["strike"]`), `case`
(`upper` `lower` `title`, applied at render time, so `content` keeps what was typed), `href`.

The text color is `fill`. With no `fill`, text uses the variable `text/default` if the document
defines one, else black. So you rarely need to set it, and you should not set `fill: []`.

## Content

- `content` is literal. `"$49"` is just text. To bind a string variable use
  `{"$ref":"copy/cta"}`.
- Line breaks: `\n` inside the string.
- Mixed styles in one node (feature `text/runs`):
  `"content":[{"text":"Save "},{"text":"40%","style":{"weight":700}}]`.
- Typography tokens (feature `tokens/composite`): `"style":{"typography":{"$ref":"heading/l"}}`.
  Inline fields override the token.

## Fonts

`kimo_assets {action:"check_font", family}` tells you whether a family is available. If it isn't,
the text renders in a fallback face and measures differently. Use common families (Inter,
Roboto, system stacks) unless the document already uses others.
