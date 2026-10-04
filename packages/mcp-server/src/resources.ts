/**
 * MCP resources and prompts (teardown 11.3 "Resources"; ADR 0013 §3). SDK-free definitions; the
 * server wires them. Resources are read-only views; clients may subscribe to the per-document
 * ones and receive `notifications/resources/updated` after each committed change (debounced
 * 250 ms per document).
 */

export interface ResourceDef {
  /** Fixed URI or RFC 6570 template. */
  uri: string
  name: string
  title: string
  description: string
  mimeType: "application/json" | "text/markdown" | "application/schema+json"
  template: boolean
  subscribable: boolean
}

export const RESOURCES: readonly ResourceDef[] = [
  {
    uri: "kimo://schema/1.0",
    name: "kimo-schema",
    title: ".kimo JSON Schema",
    description: "The normative JSON Schema (draft 2020-12) of the .kimo format, version 1.0.",
    mimeType: "application/schema+json",
    template: false,
    subscribable: false,
  },
  {
    uri: "kimo://docs/{path}",
    name: "kimo-docs",
    title: "Kimo agent guides",
    description: "MIT agent guides (same content as kimo_read_docs).",
    mimeType: "text/markdown",
    template: true,
    subscribable: false,
  },
  {
    uri: "kimo://doc/{docId}",
    name: "kimo-document",
    title: "Open document summary",
    description: "Summary of an open document (as kimo_get_state for one docId).",
    mimeType: "application/json",
    template: true,
    subscribable: true,
  },
  {
    uri: "kimo://doc/{docId}/node/{id}",
    name: "kimo-node",
    title: "Node",
    description: "One node and its direct children as .kimo data (kimo_query ids=[id], depth 1).",
    mimeType: "application/json",
    template: true,
    subscribable: true,
  },
  {
    uri: "kimo://doc/{docId}/variables",
    name: "kimo-variables",
    title: "Variables and themes",
    description: "Variables and theme axes (kimo_get_variables).",
    mimeType: "application/json",
    template: true,
    subscribable: true,
  },
]

export const RESOURCE_UPDATE_DEBOUNCE_MS = 250

export interface PromptDef {
  name: string
  title: string
  description: string
  arguments: { name: string; description: string; required: boolean }[]
}

export const PROMPTS: readonly PromptDef[] = [
  {
    name: "kimo-design-screen",
    title: "Design a screen in Kimo",
    description:
      "Plan and build a screen in an open .kimo document with kimo_apply_ops, verifying each section with kimo_render.",
    arguments: [
      { name: "docId", description: "Target document (from kimo_get_state).", required: true },
      { name: "brief", description: "What to design.", required: true },
      { name: "platform", description: "web | mobile (default web).", required: false },
    ],
  },
  {
    name: "kimo-implement-design",
    title: "Implement a Kimo design in code",
    description:
      "Read a frame with kimo_query (resolveVariables, include bounds) and kimo_get_variables, then write framework code in the repository.",
    arguments: [
      { name: "docId", description: "Document.", required: true },
      { name: "nodeId", description: "Frame to implement.", required: true },
      { name: "stack", description: "Target stack, e.g. react-tailwind.", required: false },
    ],
  },
]
