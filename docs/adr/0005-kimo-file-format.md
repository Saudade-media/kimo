# 0005. `.kimo` format: flat node table, canonical serialization, semver with migrations, never encrypted

- **Status:** Accepted
- **Date:** 2026-10-02
- **Teardown refs:** 4.1 (pen.dev's "encrypted" contradiction), 7.2 (weaknesses), 8.1 principles 1–2, 10.1 (container), 10.2 (serialization rules), 10.3 (schema), 10.6 (validation), 12 (M0 exit criteria), 13.3

## Context

"The file is the product" (8.1). pen.dev's `.pen` is a nested JSON tree: diffable, but conflicts
are resolved by redoing work in the app, auto-conversion may rewrite whole files, and its own MCP
server calls the format "encrypted" while the docs and public files say plain JSON (4.1, 7.2).
Kimo files live in git next to code, are edited concurrently by people and agents, and must
survive app upgrades in both directions.

## Decision

1. **Container.** The working form is one UTF-8 JSON `.kimo` file plus an `assets/` sidecar folder
   of content-addressed files (`assets/<sha256-16>.<ext>`). ZIP (`.kimoz`) is for transport only.
   The working form is **never encrypted, never compressed, never obfuscated**, and the spec says
   so plainly.
2. **Flat node table.** After a header block (`$schema`, `format`, `features`, `meta`, `themes`,
   `imports`, `variables`, …), nodes are a flat `nodes` object keyed by id. Tree structure is
   `parent` + fractional-index `order`; sibling order is (`order`, then `id`) by code unit; roots
   have `parent: null`. Ids match `/^[A-Za-z0-9]{6,24}$/`; Kimo generates 10-character base62.
3. **Canonical serialization.** Exactly one byte representation per document: canonical key order,
   nodes sorted by id, **one node per line**, a blank line between nodes, separating commas at the
   start of each node line after the first, defaults omitted per the normative defaults table,
   shortest round-trip numbers. One serializer in `@kimo/core-schema` is the only writer.
4. **Versioning.** The header `format` field is semver. Minor versions add optional fields or
   feature-flagged capabilities; majors may break. Every change ships with a pure migration
   function (`migrations/<from>→<to>.ts`) and fixtures, and a changelog entry. Older files are
   migrated in memory and written back **only after user consent** (autosave goes to a recovery
   file until then).
5. **Forward compatibility.** A newer `format` or an unknown `features` entry opens read-only.
   Readers preserve unknown properties and node fields on round-trip.
6. **Normative sources.** TypeScript types (TypeBox) in `@kimo/core-schema` are normative; the
   JSON Schema (draft 2020-12) is generated from them and committed, verified by
   `check:generated`. The prose spec lives at `docs/spec/kimo-format-v<version>.md`.

## Consequences

- Git diffs show changed nodes as changed lines; appending or removing a node never touches a
  neighbour's line, and the blank line keeps unrelated neighbours out of one conflict hunk. This
  is INFERRED from git's line merge and is measured by M0's plain-`git merge` conflict-rate
  fixtures.
- Semantic merging (`kimo merge`) is a local git driver only; hosted PR merges ignore it, so the
  textual layout must carry the common case (10.2 rule 8).
- M0 exit criteria: parse → serialize is byte-stable (property tests), the forward-compat test
  (10.2 rule 7) passes, and the schema is published.
- Every spec change must update spec, schema (types + generated JSON Schema) and fixtures together
  (see CONTRIBUTING).
- The flat table maps 1:1 onto the Yjs document shape ([0003](0003-crdt-yjs-behind-docstore.md)).

## Alternatives considered

- **Nested tree (pen.dev style).** Readable, but moves rewrite large spans and merges conflict
  across unrelated edits. Rejected.
- **ZIP container as the working form** (Penpot/Figma style). Not diffable; ZIP kept for
  transport only.
- **Pretty-printed multi-line nodes.** Nicer to read raw, but one-node edits spread over many
  lines and neighbouring nodes merge-conflict more. Rejected in favour of one node per line plus a
  semantic `kimo diff` textconv.
- **Binary or CRDT-update-log format.** Compact and merge-free, but unreadable and not hand-
  repairable; contrary to principle 1.
- **Silent auto-migration on open.** Convenient but rewrites user files without consent (7.2).
  Rejected.

## Revisit when

Plain-`git merge` fixtures show conflict rates the layout was supposed to avoid, or spec 1.0 is
frozen (v1.0 release).
