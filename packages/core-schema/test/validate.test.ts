import { describe, expect, test } from "bun:test"
import { type KimoDocument, type ValidateOptions, validate } from "../src/index"
import { codes, doc, HEADER } from "./helpers"

type Case = {
  rule: string
  code: string
  /** Document that must report `code` (as error or warning). */
  bad: KimoDocument
  /** Closest document that must not report `code`. */
  good: KimoDocument
  options?: ValidateOptions
}

const frame = (parent: string | null, order = "a0", extra: object = {}) => ({
  type: "frame",
  parent,
  order,
  ...extra,
})
const rect = (extra: object = {}) => ({
  type: "rect",
  parent: null,
  order: "a0",
  w: 10,
  h: 10,
  ...extra,
})
const text = (parent: string, extra: object = {}) => ({
  type: "text",
  parent,
  order: "a0",
  content: "Hi",
  ...extra,
})

/** A local component `Card000001` (frame) with a text `Title00001` and a slot frame `Slot000001`. */
const card = (componentDef: unknown = true, extra: Record<string, unknown> = {}) => ({
  Card000001: frame(null, "a0", { component: componentDef, layout: { dir: "column" } }),
  Title00001: text("Card000001"),
  Slot000001: frame("Card000001", "a1", { slot: {} }),
  ...extra,
})
const inst = (extra: object = {}) => ({
  type: "instance",
  parent: null,
  order: "b0",
  of: "Card000001",
  ...extra,
})

const cases: Case[] = [
  {
    rule: "node ids follow the id grammar",
    code: "SCHEMA",
    bad: doc({ "has:colon": frame(null) }),
    good: doc({ hasNoColon: frame(null) }),
  },
  {
    rule: "unknown properties are rejected",
    code: "UNKNOWN_PROPERTY",
    bad: doc({ Frame00001: frame(null, "a0", { cornerRadius: 4 }) }),
    good: doc({ Frame00001: frame(null, "a0", { radius: 4 }) }),
  },
  {
    rule: "node types are the 1.0 set",
    code: "UNKNOWN_NODE_TYPE",
    bad: doc({ Node000001: { type: "image", parent: null, order: "a0" } }),
    good: doc({ Node000001: rect() }),
  },
  {
    rule: "parents exist",
    code: "PARENT_MISSING",
    bad: doc({ Frame00001: frame("Missing001") }),
    good: doc({ Frame00001: frame(null), Frame00002: frame("Frame00001") }),
  },
  {
    rule: "no parent cycles",
    code: "PARENT_CYCLE",
    bad: doc({
      Frame00001: frame("Frame00003"),
      Frame00002: frame("Frame00001"),
      Frame00003: frame("Frame00002"),
    }),
    good: doc({
      Frame00001: frame(null),
      Frame00002: frame("Frame00001"),
      Frame00003: frame("Frame00002"),
    }),
  },
  {
    rule: "self-parenting is a cycle",
    code: "PARENT_CYCLE",
    bad: doc({ Frame00001: frame("Frame00001") }),
    good: doc({ Frame00001: frame(null) }),
  },
  {
    rule: "only frames and groups have children",
    code: "PARENT_NOT_CONTAINER",
    bad: doc({
      Text000001: text("Text000002"),
      Text000002: { type: "text", parent: null, order: "a0", content: "x" },
    }),
    good: doc({
      Text000001: text("Group00001"),
      Group00001: { type: "group", parent: null, order: "a0" },
    }),
  },
  {
    rule: "siblings with equal order keys are flagged (legal)",
    code: "ORDER_DUPLICATE",
    bad: doc({ Frame00001: frame(null, "a0"), Frame00002: frame(null, "a0") }),
    good: doc({ Frame00001: frame(null, "a0"), Frame00002: frame(null, "a1") }),
  },
  {
    rule: "order keys of different sibling groups may repeat",
    code: "ORDER_DUPLICATE",
    bad: doc({ Frame00001: frame(null, "a0"), Frame00002: frame(null, "a0") }),
    good: doc({ Frame00001: frame(null, "a0"), Frame00002: frame("Frame00001", "a0") }),
  },
  {
    rule: "`at` only under instance parents",
    code: "AT_WITHOUT_INSTANCE",
    bad: doc({
      Frame00001: frame(null),
      Frame00002: frame("Frame00001", "a0", { at: "Frame00001" }),
    }),
    good: doc({ Frame00001: frame(null), Frame00002: frame("Frame00001", "a0") }),
  },
  {
    rule: "children of instances carry `at`",
    code: "INSTANCE_CHILD_WITHOUT_AT",
    bad: doc(
      card(true, {
        Inst000001: inst({ overrides: { Slot000001: { slot: true } } }),
        Kid0000001: frame("Inst000001"),
      }),
    ),
    good: doc(
      card(true, {
        Inst000001: inst({ overrides: { Slot000001: { slot: true } } }),
        Kid0000001: frame("Inst000001", "a0", { at: "Slot000001" }),
      }),
    ),
  },
  {
    rule: "`at` names a slot or replace override",
    code: "AT_WITHOUT_OVERRIDE",
    bad: doc(
      card(true, {
        Inst000001: inst({ overrides: { Slot000001: { set: { name: "x" } } } }),
        Kid0000001: frame("Inst000001", "a0", { at: "Slot000001" }),
      }),
    ),
    good: doc(
      card(true, {
        Inst000001: inst({ overrides: { Slot000001: { slot: true } } }),
        Kid0000001: frame("Inst000001", "a0", { at: "Slot000001" }),
      }),
    ),
  },
  {
    rule: "a replace override has exactly one replacement",
    code: "REPLACE_COUNT",
    bad: doc(card(true, { Inst000001: inst({ overrides: { Title00001: { replace: true } } }) })),
    good: doc(
      card(true, {
        Inst000001: inst({ overrides: { Title00001: { replace: true } } }),
        New0000001: text("Inst000001", { at: "Title00001" }),
      }),
    ),
  },
  {
    rule: "instances carry no visual fields",
    code: "INSTANCE_VISUAL_FIELD",
    bad: doc(card(true, { Inst000001: inst({ opacity: 0.5 }) })),
    good: doc(card(true, { Inst000001: inst({ props: { opacity: 0.5 } }) })),
  },
  {
    rule: "`of` targets exist",
    code: "REF_MISSING",
    bad: doc(card(true, { Inst000001: inst({ of: "Nope000001" }) })),
    good: doc(card(true, { Inst000001: inst() })),
  },
  {
    rule: "`of` targets are components",
    code: "REF_NOT_COMPONENT",
    bad: doc(card(false, { Inst000001: inst() })),
    good: doc(card(true, { Inst000001: inst() })),
  },
  {
    rule: "a component cannot contain itself (transitively)",
    code: "INSTANCE_CYCLE",
    bad: doc({
      ...card(true),
      Other00001: frame(null, "c0", { component: true }),
      InOther001: inst({ parent: "Other00001", order: "a0" }),
      InCard0001: inst({ parent: "Card000001", order: "a2", of: "Other00001" }),
    }),
    good: doc({
      ...card(true),
      Other00001: frame(null, "c0", { component: true }),
      InOther001: inst({ parent: "Other00001", order: "a0" }),
    }),
  },
  {
    rule: "override paths resolve to descendants",
    code: "OVERRIDE_PATH_UNRESOLVED",
    bad: doc(
      card(true, { Inst000001: inst({ overrides: { Nowhere001: { set: { visible: false } } } }) }),
    ),
    good: doc(
      card(true, { Inst000001: inst({ overrides: { Title00001: { set: { visible: false } } } }) }),
    ),
  },
  {
    rule: "override paths cross instance boundaries one segment per instance",
    code: "OVERRIDE_PATH_UNRESOLVED",
    bad: doc({
      ...card(true),
      Wrap000001: frame(null, "c0", { component: true }),
      Nested0001: inst({ parent: "Wrap000001", order: "a0" }),
      Use0000001: inst({
        of: "Wrap000001",
        order: "d0",
        overrides: { Title00001: { set: { content: "x" } } },
      }),
    }),
    good: doc({
      ...card(true),
      Wrap000001: frame(null, "c0", { component: true }),
      Nested0001: inst({ parent: "Wrap000001", order: "a0" }),
      Use0000001: inst({
        of: "Wrap000001",
        order: "d0",
        overrides: { "Nested0001/Title00001": { set: { content: "x" } } },
      }),
    }),
  },
  {
    rule: "set overrides keep the target valid",
    code: "OVERRIDE_INVALID",
    bad: doc(
      card(true, { Inst000001: inst({ overrides: { Title00001: { set: { content: 42 } } } }) }),
    ),
    good: doc(
      card(true, { Inst000001: inst({ overrides: { Title00001: { set: { content: "42" } } } }) }),
    ),
  },
  {
    rule: "set cannot move or retype a node",
    code: "OVERRIDE_INVALID",
    bad: doc(
      card(true, { Inst000001: inst({ overrides: { Title00001: { set: { type: "rect" } } } }) }),
    ),
    good: doc(
      card(true, { Inst000001: inst({ overrides: { Title00001: { set: { name: "Heading" } } } }) }),
    ),
  },
  {
    rule: "props override only root visual fields",
    code: "OVERRIDE_INVALID",
    bad: doc(card(true, { Inst000001: inst({ props: { parent: "Card000001" } }) })),
    good: doc(card(true, { Inst000001: inst({ props: { w: { mode: "fill" } } }) })),
  },
  {
    rule: "slot overrides target slot frames",
    code: "SLOT_TARGET_INVALID",
    bad: doc(card(true, { Inst000001: inst({ overrides: { Title00001: { slot: true } } }) })),
    good: doc(card(true, { Inst000001: inst({ overrides: { Slot000001: { slot: true } } }) })),
  },
  {
    rule: "declared props target the right node kind",
    code: "PROP_TARGET_INVALID",
    bad: doc(card({ props: { swap: { type: "instance", target: "Title00001" } } })),
    good: doc(card({ props: { title: { type: "text", target: "Title00001", field: "content" } } })),
  },
  {
    rule: "declared prop targets resolve",
    code: "OVERRIDE_PATH_UNRESOLVED",
    bad: doc(card({ props: { title: { type: "text", target: "Missing001", field: "content" } } })),
    good: doc(card({ props: { title: { type: "text", target: "Title00001", field: "content" } } })),
  },
  {
    rule: "enum prop options keep the target valid",
    code: "OVERRIDE_INVALID",
    bad: doc(
      card({
        props: {
          tone: {
            type: "enum",
            target: "Title00001",
            field: "fill",
            options: { a: "#000", b: "red" },
          },
        },
      }),
    ),
    good: doc(
      card({
        props: {
          tone: {
            type: "enum",
            target: "Title00001",
            field: "fill",
            options: { a: "#000", b: "#F00" },
          },
        },
      }),
    ),
  },
  {
    rule: "args name declared props",
    code: "ARG_UNKNOWN",
    bad: doc(
      card(
        { props: { title: { type: "text", target: "Title00001", field: "content" } } },
        { Inst000001: inst({ args: { titel: "Hi" } }) },
      ),
    ),
    good: doc(
      card(
        { props: { title: { type: "text", target: "Title00001", field: "content" } } },
        { Inst000001: inst({ args: { title: "Hi" } }) },
      ),
    ),
  },
  {
    rule: "args fit their prop",
    code: "ARG_INVALID",
    bad: doc(
      card(
        {
          props: {
            size: { type: "enum", target: "Title00001", field: "opacity", options: { dim: 0.5 } },
          },
        },
        { Inst000001: inst({ args: { size: "bright" } }) },
      ),
    ),
    good: doc(
      card(
        {
          props: {
            size: { type: "enum", target: "Title00001", field: "opacity", options: { dim: 0.5 } },
          },
        },
        { Inst000001: inst({ args: { size: "dim" } }) },
      ),
    ),
  },
  {
    rule: "the components index lists components",
    code: "COMPONENTS_INDEX_INVALID",
    bad: doc(card(true), { components: ["Title00001"] }),
    good: doc(card(true), { components: ["Card000001"] }),
  },
  {
    rule: "bindings resolve",
    code: "VARIABLE_MISSING",
    bad: doc({ Rect000001: rect({ opacity: { $ref: "fade" } }) }),
    good: doc(
      { Rect000001: rect({ opacity: { $ref: "fade" } }) },
      { variables: { fade: { type: "number", value: 0.5 } } },
    ),
  },
  {
    rule: "binding types match the property",
    code: "VARIABLE_TYPE_MISMATCH",
    bad: doc(
      { Rect000001: rect({ visible: { $ref: "fade" } }) },
      { variables: { fade: { type: "number", value: 0.5 } } },
    ),
    good: doc(
      { Rect000001: rect({ visible: { $ref: "on" } }) },
      { variables: { on: { type: "boolean", value: true } } },
    ),
  },
  {
    rule: "binding types match inside paints",
    code: "VARIABLE_TYPE_MISMATCH",
    bad: doc(
      {
        Rect000001: rect({
          fill: {
            kind: "linear",
            stops: [
              { color: { $ref: "n" }, at: 0 },
              { color: "#000", at: 1 },
            ],
          },
        }),
      },
      { variables: { n: { type: "number", value: 1 } } },
    ),
    good: doc(
      {
        Rect000001: rect({
          fill: {
            kind: "linear",
            stops: [
              { color: { $ref: "c" }, at: 0 },
              { color: "#000", at: 1 },
            ],
          },
        }),
      },
      { variables: { c: { type: "color", value: "#FFF" } } },
    ),
  },
  {
    rule: "numeric properties accept dimension tokens",
    code: "VARIABLE_TYPE_MISMATCH",
    bad: doc(
      { Frame00001: frame(null, "a0", { layout: { dir: "row", gap: { $ref: "s" } } }) },
      { variables: { s: { type: "string", value: "8px" } } },
    ),
    good: doc(
      { Frame00001: frame(null, "a0", { layout: { dir: "row", gap: { $ref: "s" } } }) },
      {
        features: ["tokens/composite"],
        variables: { s: { type: "dimension", value: { value: 8, unit: "px" } } },
      },
    ),
  },
  {
    rule: "bindings in args match the declared prop type",
    code: "VARIABLE_TYPE_MISMATCH",
    bad: doc(
      card(
        { props: { title: { type: "text", target: "Title00001", field: "content" } } },
        { Inst000001: inst({ args: { title: { $ref: "on" } } }) },
      ),
      { variables: { on: { type: "boolean", value: true } } },
    ),
    good: doc(
      card(
        { props: { title: { type: "text", target: "Title00001", field: "content" } } },
        { Inst000001: inst({ args: { title: { $ref: "label" } } }) },
      ),
      { variables: { label: { type: "string", value: "Hi" } } },
    ),
  },
  {
    rule: "alias cycles are errors",
    code: "VARIABLE_CYCLE",
    bad: doc(
      { Rect000001: rect({ fill: { $ref: "a" } }) },
      { variables: { a: { type: "color", value: { $ref: "a" } } } },
    ),
    good: doc(
      { Rect000001: rect({ fill: { $ref: "a" } }) },
      {
        variables: {
          a: { type: "color", value: { $ref: "b" } },
          b: { type: "color", value: "#000" },
        },
      },
    ),
  },
  {
    rule: "theme pins name declared axes",
    code: "THEME_AXIS_UNKNOWN",
    bad: doc(
      { Frame00001: frame(null, "a0", { theme: { contrast: "high" } }) },
      { themes: { mode: ["light", "dark"] } },
    ),
    good: doc(
      { Frame00001: frame(null, "a0", { theme: { mode: "dark" } }) },
      { themes: { mode: ["light", "dark"] } },
    ),
  },
  {
    rule: "theme pins name declared values",
    code: "THEME_VALUE_UNKNOWN",
    bad: doc(
      { Frame00001: frame(null, "a0", { theme: { mode: "Dark" } }) },
      { themes: { mode: ["light", "dark"] } },
    ),
    good: doc(
      { Frame00001: frame(null, "a0", { theme: { mode: "dark" } }) },
      { themes: { mode: ["light", "dark"] } },
    ),
  },
  {
    rule: "aliases are imported",
    code: "ALIAS_UNKNOWN",
    bad: doc({ Rect000001: rect({ fill: { $ref: "ui:accent" } }) }),
    good: doc(
      { Rect000001: rect({ fill: { $ref: "ui:accent" } }) },
      { imports: { ui: "./ui.lib.kimo" } },
    ),
  },
  {
    rule: "asset references exist in the manifest",
    code: "ASSET_MISSING",
    bad: doc(
      { Rect000001: rect({ fill: { kind: "image", src: "./assets/00112233445566aa.png" } }) },
      { assets: {} },
    ),
    good: doc(
      { Rect000001: rect({ fill: { kind: "image", src: "./assets/00112233445566aa.png" } }) },
      { assets: { "00112233445566aa.png": { mime: "image/png" } } },
    ),
  },
  {
    rule: "asset references exist in the asset folder (when listed)",
    code: "ASSET_MISSING",
    bad: doc({
      Rect000001: rect({ fill: { kind: "image", src: "./assets/00112233445566aa.png" } }),
    }),
    good: doc({
      Rect000001: rect({ fill: { kind: "image", src: "./assets/0011223344556677.png" } }),
    }),
    options: { assetFiles: ["0011223344556677.png"] },
  },
  {
    rule: "feature-gated constructs need their feature",
    code: "FEATURE_NOT_DECLARED",
    bad: doc({
      Text000001: { type: "text", parent: null, order: "a0", content: [{ text: "rich" }] },
    }),
    good: doc(
      { Text000001: { type: "text", parent: null, order: "a0", content: [{ text: "rich" }] } },
      { features: ["text/runs"] },
    ),
  },
  {
    rule: "a text span's fill binds a color variable (board 30)",
    code: "VARIABLE_TYPE_MISMATCH",
    bad: doc(
      {
        Text000001: {
          type: "text",
          parent: null,
          order: "a0",
          content: [{ text: "a" }, { text: "b", fill: { $ref: "n" } }],
        },
      },
      { features: ["text/runs"], variables: { n: { type: "number", value: 1 } } },
    ),
    good: doc(
      {
        Text000001: {
          type: "text",
          parent: null,
          order: "a0",
          content: [
            { text: "a", fill: "#E5484D" },
            { text: "b", fill: { $ref: "c" } },
          ],
        },
      },
      { features: ["text/runs"], variables: { c: { type: "color", value: "#2F6BFF" } } },
    ),
  },
  {
    rule: "a text span's fill is a color, not a paint (board 30)",
    code: "SCHEMA",
    bad: doc(
      {
        Text000001: {
          type: "text",
          parent: null,
          order: "a0",
          content: [{ text: "a", fill: { kind: "solid", color: "#000" } }],
        },
      },
      { features: ["text/runs"] },
    ),
    good: doc(
      {
        Text000001: {
          type: "text",
          parent: null,
          order: "a0",
          content: [{ text: "a", fill: { space: "oklch", l: 0.6, c: 0.2, h: 25 } }],
        },
      },
      { features: ["text/runs"] },
    ),
  },
  {
    rule: "feature gates apply inside instance props",
    code: "FEATURE_NOT_DECLARED",
    bad: doc(card(true, { Inst000001: inst({ props: { layout: { dir: "row", wrap: true } } }) })),
    good: doc(card(true, { Inst000001: inst({ props: { layout: { dir: "row", wrap: true } } }) }), {
      features: ["layout/wrap"],
    }),
  },
  {
    rule: "composite variable types need tokens/composite",
    code: "FEATURE_NOT_DECLARED",
    bad: doc({}, { variables: { s: { type: "dimension", value: { value: 4, unit: "px" } } } }),
    good: doc(
      {},
      {
        features: ["tokens/composite"],
        variables: { s: { type: "dimension", value: { value: 4, unit: "px" } } },
      },
    ),
  },
  {
    rule: "unknown features are reported",
    code: "FEATURE_UNKNOWN",
    bad: doc({}, { features: ["layout/grid"] }),
    good: doc({}, { features: ["layout/wrap"] }),
  },
  {
    rule: "mesh sizes match cols × rows",
    code: "MESH_SIZE",
    bad: doc(
      {
        Rect000001: rect({
          fill: {
            kind: "mesh",
            cols: 1,
            rows: 2,
            colors: ["#000"],
            points: [
              [0, 0],
              [0, 1],
            ],
          },
        }),
      },
      { features: ["fill/mesh"] },
    ),
    good: doc(
      {
        Rect000001: rect({
          fill: {
            kind: "mesh",
            cols: 1,
            rows: 2,
            colors: ["#000", "#FFF"],
            points: [
              [0, 0],
              [0, 1],
            ],
          },
        }),
      },
      { features: ["fill/mesh"] },
    ),
  },
  {
    rule: "lint: themed variables without a match",
    code: "THEME_NO_MATCH",
    bad: doc(
      { Rect000001: rect({ fill: { $ref: "ink" } }) },
      {
        themes: { mode: ["light", "dark"] },
        variables: { ink: { type: "color", value: [{ value: "#000", when: { mode: "dark" } }] } },
      },
    ),
    good: doc(
      { Rect000001: rect({ fill: { $ref: "ink" } }) },
      {
        themes: { mode: ["light", "dark"] },
        variables: {
          ink: {
            type: "color",
            value: [
              { value: "#000", when: { mode: "dark" } },
              { value: "#FFF", when: { mode: "light" } },
            ],
          },
        },
      },
    ),
  },
  {
    rule: "lint: invisible text",
    code: "TEXT_INVISIBLE",
    bad: doc({
      Text000001: {
        type: "text",
        parent: null,
        order: "a0",
        content: "x",
        fill: { kind: "solid", color: "#000", visible: false },
      },
    }),
    good: doc({ Text000001: { type: "text", parent: null, order: "a0", content: "x" } }),
  },
  {
    rule: "lint: fit parent with all-fill children",
    code: "FIT_ALL_FILL",
    bad: doc({
      Col0000001: frame(null, "a0", { layout: { dir: "column" } }),
      Kid0000001: frame("Col0000001", "a0", { h: { mode: "fill" } }),
    }),
    good: doc({
      Col0000001: frame(null, "a0", { h: 400, layout: { dir: "column" } }),
      Kid0000001: frame("Col0000001", "a0", { h: { mode: "fill" } }),
    }),
  },
  {
    rule: "lint: unused variables (not for libraries)",
    code: "VARIABLE_UNUSED",
    bad: doc({}, { variables: { x: { type: "number", value: 1 } } }),
    good: doc({}, { meta: { library: true }, variables: { x: { type: "number", value: 1 } } }),
  },
]

describe("validator rules (negative and positive)", () => {
  for (const c of cases) {
    test(`${c.code}: ${c.rule}`, () => {
      const bad = validate(c.bad, c.options)
      expect([...codes(bad.errors), ...codes(bad.warnings)]).toContain(c.code)
      const good = validate(c.good, c.options)
      expect([...codes(good.errors), ...codes(good.warnings)]).not.toContain(c.code)
    })
  }
})

describe("validator behaviour", () => {
  test("never throws on arbitrary JSON", () => {
    for (const v of [
      null,
      1,
      "x",
      [],
      {},
      { format: 3 },
      { ...HEADER },
      { ...HEADER, nodes: [] },
      { ...HEADER, nodes: { a: 1 } },
      { ...HEADER, nodes: {}, variables: { x: null } },
    ]) {
      expect(() => validate(v)).not.toThrow()
      expect(validate(v).ok).toBe(false)
    }
  })

  test("errors carry JSON Pointer paths with escaping", () => {
    const r = validate(
      doc(
        card(true, { Inst000001: inst({ overrides: { "Title00001/Nope000001": { set: {} } } }) }),
      ),
    )
    expect(r.errors.map((e) => e.path)).toContain(
      "/nodes/Inst000001/overrides/Title00001~1Nope000001",
    )
  })

  test("union errors are collapsed to the plausible branch", () => {
    const r = validate(doc({ Rect000001: rect({ fill: { kind: "solid", color: "#00" } }) }))
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.path).toBe("/nodes/Rect000001/fill/color")
  })

  test("older and newer formats are not validated beyond the version", () => {
    expect(codes(validate({ ...HEADER, format: "0.0.9", nodes: {} }).errors)).toEqual([
      "FORMAT_OLDER",
    ])
    expect(codes(validate({ ...HEADER, format: "1.1.0", nodes: {} }).errors)).toEqual([
      "FORMAT_NEWER",
    ])
  })

  test("a plain string starting with $ is literal text", () => {
    const r = validate(
      doc({ Text000001: { type: "text", parent: null, order: "a0", content: "$49/mo" } }),
    )
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })

  test("derived components resolve paths through their base component", () => {
    const d = doc({
      ...card(true),
      Ghost00001: inst({ component: true, props: { opacity: 0.5 } }),
      Use0000001: inst({
        of: "Ghost00001",
        order: "c0",
        overrides: { Title00001: { set: { content: "x" } } },
      }),
    })
    expect(validate(d).errors).toEqual([])
  })

  test("library references are checked when the library is supplied", () => {
    const lib = doc(
      { Button0001: frame(null, "a0", { component: true }), Label00001: text("Button0001") },
      { meta: { library: true } },
    )
    const consumer = (key: string) =>
      doc(
        {
          Inst000001: {
            type: "instance",
            parent: null,
            order: "a0",
            of: "ui:Button0001",
            overrides: { [key]: { set: { content: "OK" } } },
          },
        },
        { imports: { ui: "./ui.lib.kimo" } },
      )
    expect(validate(consumer("ui:Label00001"), { libraries: { ui: lib } }).errors).toEqual([])
    expect(codes(validate(consumer("Label00001"), { libraries: { ui: lib } }).errors)).toEqual([
      "OVERRIDE_PATH_UNRESOLVED",
    ])
    expect(codes(validate(consumer("Label00001")).warnings)).toEqual(["LIBRARY_NOT_LOADED"])
  })

  test("a bad record value is a SCHEMA error only, never UNKNOWN_PROPERTY", () => {
    const only = (d: KimoDocument) => codes(validate(d).errors)
    expect(
      only(doc(card(true, { Inst000001: inst({ overrides: { Title00001: { set: 1 } } }) }))),
    ).toEqual(["SCHEMA"])
    expect(only(doc({}, { assets: { "0123456789abcdef.png": { mime: 3 } } }))).toEqual(["SCHEMA"])
    expect(only(doc({}, { themes: { mode: [] } }))).toEqual(["SCHEMA"])
    expect(
      only(doc(card({ props: { title: { type: "text", target: "Title00001", field: "nope" } } }))),
    ).toEqual(["SCHEMA"])
  })

  test("feature gates skip opaque records and match typography only inside style", () => {
    const script = (inputs: unknown) =>
      doc(
        {
          Script0001: {
            type: "script",
            parent: null,
            order: "a0",
            w: 10,
            h: 10,
            src: "./s.js",
            inputs,
          },
        },
        { features: ["node/script"] },
      )
    expect(validate(script({ typography: 1, k: { kind: "mesh" } })).errors).toEqual([])
    const styled = doc({
      Text000001: text("Text000001", { parent: null, style: { typography: { $ref: "t" } } }),
    })
    expect(codes(validate(styled).errors)).toContain("FEATURE_NOT_DECLARED")
  })

  test("enum option values are gated as values of the prop's field", () => {
    const d = (features: string[]) =>
      doc(
        card({
          props: {
            look: {
              type: "enum",
              target: "Slot000001",
              field: "layout",
              options: { wrapped: { dir: "row", wrap: true } },
            },
          },
        }),
        { features },
      )
    expect(codes(validate(d([])).errors)).toEqual(["FEATURE_NOT_DECLARED"])
    expect(validate(d(["layout/wrap"])).errors).toEqual([])
  })

  test("supportedFeatures narrows the known feature set", () => {
    const d = doc({}, { features: ["layout/wrap"] })
    expect(codes(validate(d, { supportedFeatures: [] }).warnings)).toEqual(["FEATURE_UNKNOWN"])
  })
})
