/**
 * React hooks over the multiplayer view model (`./model`). Every hook is a thin
 * `useSyncExternalStore` over a model store; selectors must return a member of the view (members
 * keep their identity while unchanged), never a new object.
 */
import { type ClaimView, claimsFor, type DocStore } from "@kimo/editor-state"
import { createContext, useCallback, useContext, useSyncExternalStore } from "react"
import { useOptionalRuntime } from "../platform/runtime"
import type {
  DocumentShareModel,
  DocumentShareView,
  JoinState,
  MultiplayerModel,
  MultiplayerSettingsView,
  RelayTestState,
} from "./model"

/** A multiplayer model for a subtree (harnesses, tests); the app uses the runtime's. */
export const MultiplayerContext = createContext<MultiplayerModel | null>(null)

/** The window's multiplayer model: the nearest {@link MultiplayerContext}, else the runtime's. */
export function useMultiplayer(): MultiplayerModel | null {
  const provided = useContext(MultiplayerContext)
  const runtime = useOptionalRuntime()
  return provided ?? runtime?.multiplayer ?? null
}

/** The model of one document (a file ref, or `roomKeyOf(room)` for a joined room). */
export function useDocumentShareModel(model: MultiplayerModel, key: string): DocumentShareModel {
  return model.document(key)
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
export const useFontsNameOnly = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectFonts)
export const useCapabilities = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectCapabilities)
export const useAgentPauses = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectPaused)
/** Claims as the backend reports them (desktop windows: the host's registry). */
export const useShareClaims = (model: MultiplayerModel, key: string) =>
  useDocumentShare(model, key, selectClaims)

export const selectShare = (v: DocumentShareView) => v.share
export const selectLinks = (v: DocumentShareView) => v.links
export const selectPeople = (v: DocumentShareView) => v.people
export const selectAgents = (v: DocumentShareView) => v.agents
export const selectFollow = (v: DocumentShareView) => v.follow
export const selectAssets = (v: DocumentShareView) => v.assets
export const selectFonts = (v: DocumentShareView) => v.fontsNameOnly
export const selectCapabilities = (v: DocumentShareView) => v.capabilities
export const selectPaused = (v: DocumentShareView) => v.paused
export const selectClaims = (v: DocumentShareView) => v.claims

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

/** Claims of a store in this window (`claimsFor(store).list()`), for web and agent panels. */
export function useClaims(store: DocStore): readonly ClaimView[] {
  const registry = claimsFor(store)
  const subscribe = useCallback((l: () => void) => registry.subscribe(l), [registry])
  const get = useCallback(() => registry.list(), [registry])
  return useSyncExternalStore(subscribe, get, get)
}
