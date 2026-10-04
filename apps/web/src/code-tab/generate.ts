/**
 * Runs `@kimo/exporters` for the Code tab (rule "Source": same IR + generators as Export, the
 * tab has no codegen of its own). React + Tailwind and HTML + CSS use `exportDocument` exactly
 * as the Export dialog does (same options), plus a second emitter run with `data-kimo-id`
 * attributes for the line source map. Tokens emit DTCG + CSS for the variables the selection
 * uses. The package is loaded lazily (it stays out of the editor's main chunk).
 */

import type { KimoDocument, Libraries } from "@kimo/core-schema"
import type { ExportFile, IconLoader, IRDocument, IRVariable } from "@kimo/exporters"
import type { ExportToggles } from "../export/model"
import { type Framework, type LineRange, sourceMapOf } from "./model"

export interface CodeSource {
  document(): KimoDocument
  libraries?(): Libraries | undefined
  icons?: IconLoader | null
}

export interface CodeFile {
  path: string
  contents: string
  /** Node id → line range (React / HTML markup files; null when unavailable). */
  map: Map<string, LineRange> | null
}

export interface GeneratedCode {
  files: CodeFile[]
  /** Tokens: variables the selection uses / all the IR lists. */
  tokens: { used: number; total: number } | null
  errors: string[]
}

const loadExporters = () => import("@kimo/exporters")

/** Variables the roots use, plus the targets of their aliases (transitively). */
export function usedVariables(variables: readonly IRVariable[]): IRVariable[] {
  const byName = new Map(variables.map((v) => [v.name, v]))
  const keep = new Set<string>()
  const visit = (name: string) => {
    if (keep.has(name)) return
    const v = byName.get(name)
    if (!v) return
    keep.add(name)
    const values = v.entries ? v.entries.map((e) => e.value) : [v.value]
    for (const value of values)
      if (value && typeof value === "object" && "$ref" in value)
        visit(String((value as { $ref: unknown }).$ref))
  }
  for (const v of variables) if (v.usage.length > 0) visit(v.name)
  return variables.filter((v) => keep.has(v.name))
}

const text = (f: ExportFile) => (typeof f.contents === "string" ? f.contents : "")

/** Generates the files of `framework` for `roots` (the root component first). */
export async function generateCode(
  source: CodeSource,
  roots: readonly string[],
  framework: Framework,
  toggles: ExportToggles,
): Promise<GeneratedCode> {
  const ex = await loadExporters()
  const doc = source.document()
  const libraries = source.libraries?.()
  const libs = libraries ? { libraries } : {}
  const errors: string[] = []
  try {
    if (framework === "tokens") {
      const ir = ex.buildIR(doc, { ...libs, ids: roots })
      const used = usedVariables(ir.variables)
      const scoped: IRDocument = { ...ir, variables: used }
      return {
        files: [
          { path: "tokens.json", contents: ex.emitDtcg(scoped), map: null },
          { path: "tokens.css", contents: ex.emitTokensCss(scoped), map: null },
        ],
        tokens: { used: used.length, total: ir.variables.length },
        errors,
      }
    }
    const target = framework === "react" ? "react-tailwind" : "html-css"
    // Same call as the Export dialog's `generateExport` (apps/web/src/export/generate.ts).
    const shown = await ex.exportDocument(doc, target, {
      ...libs,
      ids: roots,
      variables: toggles.variables,
      components: toggles.components,
      layerNames: toggles.layerNames,
      ...(source.icons ? { icons: source.icons } : {}),
    })
    // The same emitter with `data-kimo-id` (exportDocument's own IR options).
    const ir = ex.buildIR(doc, {
      ...libs,
      ids: roots,
      components: target === "react-tailwind" && toggles.components,
      cssVariables: toggles.variables,
    })
    const icons = source.icons ? await ex.loadIcons(ir, source.icons) : undefined
    const withIds =
      target === "react-tailwind"
        ? ex.emitReact(ir, {
            variables: toggles.variables,
            components: toggles.components,
            layerNames: toggles.layerNames,
            ids: true,
            ...(icons ? { icons } : {}),
          })
        : ex.emitHtml(ir, {
            variables: toggles.variables,
            layerNames: toggles.layerNames,
            ids: true,
            ...(icons ? { icons } : {}),
          })
    const byPath = new Map(withIds.map((f) => [f.path, text(f)]))
    const files = shown.files
      .filter((f) => typeof f.contents === "string")
      .map((f) => {
        const other = byPath.get(f.path)
        const contents = text(f)
        return {
          path: f.path,
          contents,
          map: other !== undefined && other !== contents ? sourceMapOf(contents, other) : null,
        }
      })
    // Rule "File tabs": the root component first.
    const first = files.findIndex((f) => /\.(tsx|html)$/.test(f.path))
    if (first > 0) files.unshift(...files.splice(first, 1))
    return { files, tokens: null, errors }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
    return { files: [], tokens: null, errors }
  }
}
