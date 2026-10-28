/**
 * Override dots on overridden fields (board 11 right panel: PropSection header Title ·
 * OverrideDot · Spacer · Action, e.g. Fill `I9nOv`). The Design tab provides which fields of the
 * single selected instance node carry an override, and how to reset them; section titles render
 * {@link SectionTitle}.
 */
import type { ExpandedView } from "@kimo/core-schema"
import { OverrideDot } from "@kimo/ui"
import { createContext, useContext } from "react"
import type { M3Controller } from "./controller"

interface OverrideFields {
  /** Overridden field names of the selected node (instance-owned layers: own override). */
  fields: ReadonlySet<string>
  reset(fields: readonly string[]): void
}

export const OverrideFieldsContext = createContext<OverrideFields | null>(null)

/** Section title with the override dot when any of `fields` is overridden. */
export function SectionTitle({ label, fields }: { label: string; fields: readonly string[] }) {
  const ctx = useContext(OverrideFieldsContext)
  const on = !!ctx && fields.some((f) => ctx.fields.has(f))
  if (!on) return label
  return (
    <span className="m3-section-title">
      {label}
      <OverrideDot
        visible
        data-testid="override-dot"
        onReset={() => ctx?.reset(fields.filter((f) => ctx.fields.has(f)))}
      />
    </span>
  )
}

/** Overridden fields of view node `id` and a reset that removes exactly those contributions. */
export function overrideFieldsOf(
  m3: M3Controller,
  view: ExpandedView,
  id: string,
): OverrideFields | null {
  const o = view.origin(id)
  if (!o || o.top === null) return null
  const own = o.overrides.filter((x) => x.layer !== "derived" && x.kind === "set")
  if (!own.length) return null
  const fields = new Set(own.flatMap((x) => x.fields))
  return {
    fields,
    reset(list) {
      const instance = o.top as string
      for (const x of own) {
        const hit = x.fields.filter((f) => list.includes(f))
        if (!hit.length) continue
        if (x.holder !== instance) continue // nested holders: reset from their own instance
        if (x.layer === "args")
          m3.run({ cmd: "setArgs", instance, args: { [x.key]: undefined } }, "Reset to main")
        else if (x.layer === "props")
          m3.run(
            { cmd: "resetOverride", instance, path: "", options: { fields: hit } },
            "Reset to main",
          )
        else
          m3.run(
            { cmd: "resetOverride", instance, path: x.key, options: { fields: hit } },
            "Reset to main",
          )
      }
    },
  }
}
