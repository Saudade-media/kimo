import { createContext, useCallback, useContext, useSyncExternalStore } from "react"
import { useOptionalRuntime } from "../platform/runtime"
import type {
  DocumentShareView,
  JoinState,
  MultiplayerModel,
  MultiplayerSettingsView,
  RelayTestState,
} from "./model"
import type { SharedSession } from "./share"

/** A multiplayer model for a subtree (harnesses, tests); the app uses the runtime's. */
const MultiplayerContext = createContext<MultiplayerModel | null>(null)

/** The window's multiplayer model: the nearest {@link MultiplayerContext}, else the runtime's. */
export function useMultiplayer(): MultiplayerModel | null {
  const provided = useContext(MultiplayerContext)
  const runtime = useOptionalRuntime()
  return provided ?? runtime?.multiplayer ?? null
}

/** The whole document view, or one member of it. */
export function useDocumentShare(model: MultiplayerModel, key: string): DocumentShareView
export function useDocumentShare<T>(
  model: MultiplayerModel,
  key: string,
  select: (view: DocumentShareView) => T,
): T
export function useDocumentShare<T>(
  model: MultiplayerModel,
  key: string,
  select?: (view: DocumentShareView) => T,
): T | DocumentShareView {
  const doc = model.document(key)
  const subscribe = useCallback((l: () => void) => doc.subscribe(l), [doc])
  const get = useCallback(() => (select ? select(doc.getState()) : doc.getState()), [doc, select])
  return useSyncExternalStore(subscribe, get, get)
}

export const useShareState = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectShare)
export const useShareLinks = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectLinks)
export const useCollaborators = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectPeople)
export const useAgents = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectAgents)
export const useFollow = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectFollow)
export const useAssetTransfers = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectAssets)
export const useCapabilities = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectCapabilities)

export const selectShare = (v: DocumentShareView) => v.share
export const selectLinks = (v: DocumentShareView) => v.links
export const selectPeople = (v: DocumentShareView) => v.people
export const selectAgents = (v: DocumentShareView) => v.agents
export const selectFollow = (v: DocumentShareView) => v.follow
export const selectAssets = (v: DocumentShareView) => v.assets
export const selectCapabilities = (v: DocumentShareView) => v.capabilities

export function useMultiplayerSettings(model: MultiplayerModel): MultiplayerSettingsView {
  const s = model.settings
  const subscribe = useCallback((l: () => void) => s.subscribe(l), [s])
  const get = useCallback(() => s.getState(), [s])
  return useSyncExternalStore(subscribe, get, get)
}

export function useRelayTest(model: MultiplayerModel): RelayTestState {
  const r = model.relayTest
  const subscribe = useCallback((l: () => void) => r.subscribe(l), [r])
  const get = useCallback(() => r.getState(), [r])
  return useSyncExternalStore(subscribe, get, get)
}

export function useJoin(model: MultiplayerModel): JoinState {
  const j = model.join
  const subscribe = useCallback((l: () => void) => j.subscribe(l), [j])
  const get = useCallback(() => j.getState(), [j])
  return useSyncExternalStore(subscribe, get, get)
}

/** The room this window keeps joined from `link` (#79: a room tab stays joined while open). */
export function useJoinedRoom(model: MultiplayerModel | null, link: string): SharedSession | null {
  const j = model?.join ?? null
  const subscribe = useCallback((l: () => void) => (j ? j.subscribe(l) : () => {}), [j])
  const get = useCallback(() => j?.roomFor(link) ?? null, [j, link])
  return useSyncExternalStore(subscribe, get, get)
}
