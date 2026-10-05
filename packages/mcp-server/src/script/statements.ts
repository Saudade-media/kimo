/**
 * Complete top-level statements of a script that is still being written (streamed tool input).
 * A statement is complete when it ends with `;` at depth 0, or when it ends a line and the next
 * line starts a new statement (an identifier or a statement keyword, not `.`, `(`, an operator,
 * `else`, …). The candidate prefix must also parse on its own.
 */
import { parse, tokenizer } from "acorn"

const STARTERS = new Set([
  "const",
  "let",
  "var",
  "function",
  "if",
  "for",
  "while",
  "do",
  "return",
  "throw",
  "try",
  "switch",
  "class",
  "break",
  "continue",
  "name",
])
/** Token labels a statement may end with (without `;`). */
const ENDERS = new Set([
  ")",
  "]",
  "}",
  "name",
  "num",
  "string",
  "`",
  "true",
  "false",
  "null",
  "this",
  "regexp",
])

const parses = (src: string): boolean => {
  try {
    parse(src, { ecmaVersion: "latest", sourceType: "script" })
    return true
  } catch {
    return false
  }
}

/** Length of the longest prefix of `src` made of complete top-level statements (0 if none). */
export function completePrefix(src: string): number {
  const toks: { label: string; start: number; end: number; value?: unknown }[] = []
  try {
    for (const t of tokenizer(src, { ecmaVersion: "latest" }))
      toks.push({
        label: t.type.label,
        start: t.start,
        end: t.end,
        value: (t as { value?: unknown }).value,
      })
  } catch {
    // The tail is an unfinished token: what came before still counts.
  }
  let depth = 0
  const candidates: number[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as (typeof toks)[number]
    const l = t.label
    if (l === "(" || l === "[" || l === "{" || l === "${") depth++
    else if (l === ")" || l === "]" || l === "}") depth--
    if (depth !== 0) continue
    if (l === ";") {
      candidates.push(t.end)
      continue
    }
    const next = toks[i + 1]
    if (!next || !ENDERS.has(l)) continue
    if (!/\n/.test(src.slice(t.end, next.start))) continue
    const starter =
      next.label === "name"
        ? !["of", "in", "instanceof"].includes(String(next.value))
        : STARTERS.has(next.label)
    if (starter) candidates.push(t.end)
  }
  for (let i = candidates.length - 1, tries = 0; i >= 0 && tries < 4; i--, tries++) {
    const end = candidates[i] as number
    if (parses(src.slice(0, end))) return end
  }
  return 0
}

interface PatternNode {
  type: string
  name?: string
  properties?: { value?: PatternNode; argument?: PatternNode }[]
  elements?: (PatternNode | null)[]
  left?: PatternNode
  argument?: PatternNode
}

function patternNames(p: PatternNode | null | undefined, out: string[]): void {
  if (!p) return
  if (p.type === "Identifier" && p.name) out.push(p.name)
  else if (p.type === "ObjectPattern")
    for (const prop of p.properties ?? []) patternNames(prop.value ?? prop.argument, out)
  else if (p.type === "ArrayPattern") for (const el of p.elements ?? []) patternNames(el, out)
  else if (p.type === "AssignmentPattern") patternNames(p.left, out)
  else if (p.type === "RestElement") patternNames(p.argument, out)
}

/** Names a script declares at its top level (const/let/var, functions, classes); [] if it does not parse. */
export function topLevelNames(code: string): string[] {
  let ast: { body: { type: string; id?: PatternNode; declarations?: { id: PatternNode }[] }[] }
  try {
    ast = parse(code, { ecmaVersion: "latest", sourceType: "script" }) as never
  } catch {
    return []
  }
  const out: string[] = []
  for (const s of ast.body) {
    if (s.type === "VariableDeclaration")
      for (const d of s.declarations ?? []) patternNames(d.id, out)
    else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id)
      patternNames(s.id, out)
  }
  return [...new Set(out)]
}
