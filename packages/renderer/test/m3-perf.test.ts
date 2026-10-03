/**
 * M3 perf: 1k-instance stress variant of the perf gate (headless CPU raster, a pessimistic
 * proxy for WebGL). 1,000 root instances of a 6-node card component (7k view nodes) laid out
 * by the Yoga engine through the shared expanded view. Gates:
 * *  - moving an instance re-expands only it and re-records 1 picture;
 *  - an instance override re-expands and re-records that instance only;
 *  - a main edit re-lays out and re-records every instance, within a frame budget multiple.
 * Budgets are loose multiples of a local M-class run (printed) so CI noise does not flake.
 */
import { describe, expect, test } from "bun:test"
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  type NodeSource,
  nodeSourceFromDocument,
} from "@kimo/layout"
import { CanvasKitRenderer, type RenderScene } from "../src"
import { instancesDoc } from "./fixtures/m3"

const now = () => performance.now()

describe("M3 perf: 1k instances", () => {
  test("instance edits stay local; a main edit re-lays out every instance", async () => {
    const doc = instancesDoc(1000)
    let table = { ...doc.nodes }
    let src: NodeSource = nodeSourceFromDocument({ nodes: table } as never)
    const store: NodeSource = {
      getNode: (id) => src.getNode(id),
      children: (p, at) => src.children(p, at),
    }
    const header = { variables: doc.variables, themes: doc.themes } as never
    const view = createInstanceView(store, { header: () => header })
    const resolve = createResolver(header, view)
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const scene: RenderScene = { nodes: view, header, resolve, assets: { load: async () => null } }
    r.setDocument(scene)
    const engine = createLayoutEngine()
    await engine.init()
    const input = () => ({ nodes: store, expanded: view, resolve, measureText: r.textMeasurer() })
    const edit = (id: string, patch: Record<string, unknown>) => {
      table = { ...table, [id]: { ...table[id], ...patch } }
      src = nodeSourceFromDocument({ nodes: table } as never)
      resolve.invalidate()
      const t = now()
      const layout = engine.update(input(), { nodes: [id] })
      const layoutMs = now() - t
      r.invalidate([id])
      r.setLayout(layout)
      const t2 = now()
      r.render()
      const st = r.stats()
      return {
        layout,
        layoutMs,
        frameMs: now() - t2,
        recorded: st.recorded ?? 0,
        shared: st.sharedRecorded ?? 0,
        wrapped: st.wrapped ?? 0,
      }
    }

    let t = now()
    const first = engine.compute(input())
    const computeMs = now() - t
    expect(first.nodes.size).toBe(6 + 1000 * 6)
    expect(first.issues).toEqual([])
    r.setLayout(first)
    r.attachRaster(1440, 900, 1)
    r.setViewport({ x: -20, y: -20, zoom: 0.25 })
    t = now()
    r.render()
    const firstFrameMs = now() - t
    t = now()
    r.render()
    const replayMs = now() - t

    // Instance roots draw from shared pictures (one per distinct expanded content): moving
    // one re-attaches it to the picture it already shares, recording nothing.
    const move = edit("i0500", { x: 70 })
    expect(move.recorded).toBe(0)
    expect(move.wrapped).toBe(1)
    expect(move.layout.changed.size).toBeLessThanOrEqual(6)

    // An override makes a new variant: one shared recording.
    const ov = edit("i0001", { overrides: { bar: { set: { w: 30 } } } })
    expect(ov.shared).toBe(1)
    expect(ov.wrapped).toBe(1)
    expect(ov.layout.nodes.get("i0001/bar")?.local.w).toBe(30)

    // A main edit re-lays out every instance; they re-attach to a handful of new variants.
    const main = edit("bar", { w: 100 })
    expect(main.layout.nodes.get("i0999/bar")?.local.w).toBe(100)
    expect(main.layout.nodes.get("i0001/bar")?.local.w).toBe(30)
    expect(main.wrapped).toBeGreaterThan(900) // every visible instance root
    expect(main.shared).toBeLessThanOrEqual(4)

    console.log(
      [
        `1k instances (${first.nodes.size} view nodes)`,
        `compute ${computeMs.toFixed(1)} ms`,
        `first frame ${firstFrameMs.toFixed(1)} ms`,
        `replay ${replayMs.toFixed(1)} ms`,
        `instance move layout ${move.layoutMs.toFixed(2)} + frame ${move.frameMs.toFixed(1)} ms`,
        `override layout ${ov.layoutMs.toFixed(2)} + frame ${ov.frameMs.toFixed(1)} ms`,
        `main edit layout ${main.layoutMs.toFixed(1)} + frame ${main.frameMs.toFixed(1)} ms`,
      ].join(" · "),
    )
    // Interactive budgets (CPU raster; WebGL replays cached pictures faster).
    expect(move.layoutMs).toBeLessThan(8)
    expect(ov.layoutMs).toBeLessThan(8)
    expect(main.layoutMs).toBeLessThan(Math.max(250, computeMs * 2))
    engine.dispose()
    r.dispose()
  }, 60_000)
})
