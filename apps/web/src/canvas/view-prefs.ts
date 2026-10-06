/**
 * Board 27 §4 "View menu & settings" (jFztN): the canvas view preferences — snap to objects,
 * snap to pixel grid, pixel grid, rulers, nudge, layer names. App preferences (rule Dos9n
 * "Storage": localStorage on web, settings.json on desktop), not file data; the View menu and
 * Settings › Canvas write the same `canvas.*` keys (one source of truth, per user).
 */
import { type NudgePreset, nudgeSteps, type Settings, type SettingsApi } from "@kimo/platform"
import { useSettings } from "../settings/hooks"

export interface CanvasViewPrefs {
  snapToObjects: boolean
  snapToPixelGrid: boolean
  pixelGrid: boolean
  rulers: boolean
  layerNames: boolean
  nudge: { step: number; big: number }
  /** Settings › General › Canvas zoom. */
  wheelZoom: "trackpad" | "mouse"
}

/** The view prefs of a settings snapshot. */
export function viewPrefsOf(s: Settings): CanvasViewPrefs {
  return {
    snapToObjects: s["canvas.snapToObjects"],
    snapToPixelGrid: s["canvas.snapToPixelGrid"],
    pixelGrid: s["canvas.pixelGrid"],
    rulers: s["canvas.rulers"],
    layerNames: s["canvas.layerNames"],
    nudge: nudgeSteps(s["canvas.nudge"] as NudgePreset),
    wheelZoom: s["general.canvasZoom"],
  }
}

/** Boolean view prefs the View menu toggles. */
export type ViewToggleKey =
  | "canvas.snapToObjects"
  | "canvas.snapToPixelGrid"
  | "canvas.pixelGrid"
  | "canvas.rulers"
  | "canvas.layerNames"

/**
 * Flips a boolean view pref. A rejected write keeps the stored value and reaches `onError`
 * (A5: the editor shows "Couldn't change the view setting. <cause>").
 */
export function toggleViewPref(
  settings: SettingsApi,
  key: ViewToggleKey,
  onError: (e: unknown) => void,
): void {
  void settings.set(key, !settings.get(key)).catch(onError)
}

/** Live view prefs (re-render on any settings change, including other windows). */
export function useCanvasViewPrefs(settings: SettingsApi): CanvasViewPrefs {
  return viewPrefsOf(useSettings(settings))
}
