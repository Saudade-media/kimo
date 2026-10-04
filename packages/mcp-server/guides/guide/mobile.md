<!-- related: layout, text, components -->
# Designing mobile screens

## Frame

- Phone frame `w:390` (iPhone 14–16) or `w:360` (Android baseline), `h:844` / `800`, `clip:true`,
  `layout:{dir:"column"}`.
- Put several screens side by side, 80 px apart: `kimo_find_space` with `direction:"right"`
  next to the previous screen.

## Structure

```
Screen (column, clip)
├─ Status bar  (h 44–54, fixed)
├─ Header      (row, justify between, pad [12,16])
├─ Content     (column, gap 16, pad [16,16], h fill)
└─ Tab bar     (row, justify around, pad [8,16,28,16])
```

`h:{"mode":"fill"}` on Content pushes the tab bar to the bottom. For a floating action button,
use `position:"absolute"` with explicit x/y.

## Touch and type

- Tap targets at least 44×44 (iOS) / 48×48 (Android). Wrap a small icon in a 44 px frame with
  `justify`/`align` `center`.
- Body 16–17, secondary 13–15, title 28–34. Avoid text under 12.
- Side margins 16–20. List rows are 56–72 high with `align:"center"`.
- Icons: one set per design (`lucide` is a safe default), 20–24 px.

## Safe areas

Leave the top 44–54 px for the status bar and 28–34 px at the bottom for the home indicator.
Don't put controls there.

## Check

Render each screen at scale 2 (`kimo_render {scale:2}`) to judge small text. Run `kimo_query
include:["bounds"]` on rows to confirm they really fill the width.
