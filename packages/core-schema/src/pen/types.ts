/**
 * The parts of the pen.dev `.pen` format (schema 2.x, plain JSON) that the importer reads.
 * Written from pen.dev's public schema; every field is optional because real files omit
 * defaults freely.
 */

/** A `.pen` node (any `type`), or a `descendants` override value (no `type`). */
export interface PenNode {
  type?: string
  id?: string
  children?: PenNode[]
  descendants?: Record<string, PenNode>
  [key: string]: unknown
}

/** One themed entry of a `.pen` variable value. */
export interface PenThemedValue {
  value: unknown
  theme?: Record<string, string>
}

export interface PenVariable {
  type: string
  value: unknown
}

/** A `.pen` document root. */
export interface PenDocument {
  version: string
  children: PenNode[]
  themes?: Record<string, string[]>
  imports?: Record<string, string>
  variables?: Record<string, PenVariable>
  [key: string]: unknown
}
