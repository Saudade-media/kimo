/**
 * Per-op node scope enforcement for spawned agents (board 22 "How scopes are enforced",
 * teardown 11.3, ADR 0014 §8). The document host calls {@link checkScope} from its M5
 * `DispatchOptions.targets` and returns the offending ids as `CallTargets.outOfScope`;
 * M5 `authorize()` then fails the whole call with OUT_OF_SCOPE (children use `onExceed: deny`,
 * so the batch rolls back without a prompt).
 *
 * In scope = a scope root or one of its descendants. Rules:
 * - every target, every parent and every new parent must be in scope;
 * - nodes created earlier in the same call (`@key`) are in scope when their parent is;
 * - moving a node across the scope edge (in → out or out → in) is rejected;
 * - deleting, moving or replacing a scope root is rejected (updating its fields is fine);
 * - globals (variables, theme axes) are rejected unless the policy has the `globals` grant
 *   (only the lead may hold it); `make_component` is always rejected for scoped agents;
 *   other component-origin edits need the component main in scope.
 */
import { GLOBAL_OPS, type WireOp } from "@kimo/mcp-server"

/** Minimal read view of the document the host provides. */
export interface ScopeTree {
  exists(id: string): boolean
  /** Parent id, or null for top-level nodes. */
  parentOf(id: string): string | null
}

export interface ScopeViolation {
  index: number
  op: string
  nodeId: string
  reason: "outside" | "crosses-edge" | "scope-root" | "global" | "component"
}

export function inScope(tree: ScopeTree, scope: ReadonlySet<string>, id: string): boolean {
  let cur: string | null = id
  const seen = new Set<string>()
  while (cur !== null && !seen.has(cur)) {
    if (scope.has(cur)) return true
    seen.add(cur)
    cur = tree.exists(cur) ? tree.parentOf(cur) : null
  }
  return false
}

export function checkScope(
  ops: readonly WireOp[],
  tree: ScopeTree,
  scopeRoots: readonly string[],
  opts: { globalsGrant?: boolean } = {},
): ScopeViolation[] {
  if (scopeRoots.length === 0) return []
  const scope = new Set(scopeRoots)
  const keys = new Map<string, boolean>()
  const out: ScopeViolation[] = []
  const isIn = (ref: string): boolean => {
    if (ref === "root") return false
    if (ref.startsWith("@")) return keys.get(ref.slice(1)) ?? false
    return inScope(tree, scope, ref)
  }
  const flag = (index: number, op: string, nodeId: string, reason: ScopeViolation["reason"]) =>
    out.push({ index, op, nodeId, reason })
  const need = (index: number, op: string, ref: string) => {
    if (!isIn(ref)) flag(index, op, ref, "outside")
  }
  const remember = (key: unknown, parentIn: boolean) => {
    if (typeof key === "string") keys.set(key, parentIn)
  }

  ops.forEach((op, i) => {
    const o = op as WireOp & Record<string, unknown>
    if (GLOBAL_OPS.has(op.op)) {
      if (!opts.globalsGrant) flag(i, op.op, "", "global")
      return
    }
    switch (op.op) {
      case "insert":
      case "instantiate": {
        const p = String(o.parent)
        need(i, op.op, p)
        remember(o.key, isIn(p))
        break
      }
      case "copy": {
        // Reading the source anywhere is fine; the copy lands under `parent`.
        const p = String(o.parent)
        need(i, op.op, p)
        remember(o.key, isIn(p))
        break
      }
      case "update":
      case "detach":
        need(i, op.op, String(o.id))
        break
      case "replace":
      case "delete": {
        const id = String(o.id)
        if (scope.has(id)) flag(i, op.op, id, "scope-root")
        else need(i, op.op, id)
        break
      }
      case "move": {
        const id = String(o.id)
        const p = String(o.parent)
        if (scope.has(id)) flag(i, op.op, id, "scope-root")
        else if (isIn(id) !== isIn(p)) flag(i, op.op, isIn(id) ? p : id, "crosses-edge")
        else need(i, op.op, id)
        break
      }
      case "make_component":
        flag(i, op.op, String((o.ids as string[] | undefined)?.[0] ?? ""), "component")
        break
      case "declare_prop":
      case "remove_prop":
        if (!isIn(String(o.component))) flag(i, op.op, String(o.component), "component")
        break
      case "set_slot":
        if (!isIn(String(o.frame))) flag(i, op.op, String(o.frame), "component")
        break
      case "set_override":
      case "reset_override":
      case "set_args":
      case "swap_instance":
        need(i, op.op, String(o.instance))
        break
      case "set_theme_pin":
        need(i, op.op, String(o.node))
        break
      default:
        break
    }
  })
  return out
}

/** Ids for M5 `CallTargets.outOfScope` (non-empty → OUT_OF_SCOPE). */
export function outOfScopeIds(violations: readonly ScopeViolation[]): string[] {
  return [...new Set(violations.map((v) => v.nodeId || `ops[${v.index}]`))]
}
