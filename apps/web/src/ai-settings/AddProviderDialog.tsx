/**
 * Settings › AI providers › "Add provider" (board 25 "v1 Polish" §4 uOwr0, rules w4DgfP).
 *
 *   Dialog (uOwr0) column, gap 14, padding 20, width 520, bg-overlay, stroke border, radius-xl,
 *     shadow 0 16 48 shadow-strong
 *   › Head (x8Lc26) row gap 12: Icon Wrap 32 pill bg-muted (server 16) · Text column gap 4:
 *     Title sans 14 / 600 · Desc sans 12 text-secondary lh 1.45
 *   › Body (kumFs) column gap 10: Field rows (row gap 8, center; Label 96 sans 12 text-secondary)
 *     Type (Select) · Name · Base URL (mono) · Auth header (SegmentedText + Preview mono 11
 *     tertiary, column gap 6) · API key (mono + eye) · Models (chips h 24 + Fetch /models) ·
 *     Origin Pin Note (W2ERTF) · Storage (F1hbeP)
 *   › Footer (ThgQE) row gap 8, center: Test connection (Button/Secondary h 28, plug-zap 14) ·
 *     Spacer · Cancel (Button/Ghost h 28) · Add provider (Button/Primary h 28)
 *
 * Type picks the form: Custom endpoint shows every field; OpenAI / Gemini / OpenRouter drop
 * Base URL + Auth header. Add is enabled once Name + Base URL + key are valid and runs the Test;
 * a failing Test still adds the provider, "Not verified".
 */
import { CompactButton, SegmentedText, Select, useFocusTrap } from "@kimo/ui"
import { Eye, EyeOff, HardDrive, Lock, Pin, PlugZap, RefreshCw, Server, X } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import type { AddProviderInput, AiSettingsController } from "./controller"
import {
  type AuthScheme,
  authPreview,
  hostOf,
  originOf,
  type StoredTest,
  storageLabel,
} from "./model"
import { TestResult } from "./TestResult"
import "./polish.css"

type ProviderType = AddProviderInput["type"]

export const ADD_PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: "custom", label: "Custom endpoint (OpenAI-compatible)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Google Gemini" },
  { value: "openrouter", label: "OpenRouter" },
]

const SCHEMES: { value: AuthScheme["scheme"]; label: string }[] = [
  { value: "bearer", label: "Bearer" },
  { value: "x-api-key", label: "x-api-key" },
  { value: "custom", label: "Custom…" },
]

const DEFAULT_NAME: Record<ProviderType, string> = {
  custom: "",
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
}

/** Copy (uOwr0 l0KL0); other types are not drawn: one line about the key instead. */
const DESC: Record<ProviderType, string> = {
  custom: "Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM or a company gateway.",
  openai: "OpenAI's API with your key. OpenAI bills the usage, not Kimo.",
  gemini: "Google's Gemini API with your key. Google bills the usage, not Kimo.",
  openrouter: "OpenRouter with your key. OpenRouter bills the usage, not Kimo.",
}

/** Local runtimes need no key (Ollama, LM Studio on localhost). */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1"
  } catch {
    return false
  }
}

/** Add is enabled once Name + Base URL + key are valid (board 25 vwFWh). */
export function addProviderValid(d: {
  type: ProviderType
  label: string
  baseURL: string
  key: string
  auth: AuthScheme
}): boolean {
  if (!d.label.trim()) return false
  if (d.type !== "custom") return d.key.trim().length >= 8
  if (!/^https?:\/\/[^/\s]+/.test(d.baseURL.trim()) || originOf(d.baseURL.trim()) === null)
    return false
  if (d.auth.scheme === "custom" && !/^[A-Za-z0-9-]+$/.test(d.auth.header?.trim() ?? ""))
    return false
  return d.key.trim().length >= 8 || isLocalUrl(d.baseURL.trim())
}

export interface AddProviderDialogProps {
  ctl: AiSettingsController
  /** Desktop keychain / web localStorage copy of the Storage line. */
  backend: "keychain" | "localStorage" | "memory"
  os: string
  onAdded: (id: string) => void
  onCancel: () => void
}

export function AddProviderDialog({ ctl, backend, os, onAdded, onCancel }: AddProviderDialogProps) {
  const titleId = useId()
  const descId = useId()
  const root = useRef<HTMLDivElement>(null)
  const [type, setType] = useState<ProviderType>("custom")
  const [label, setLabel] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [auth, setAuth] = useState<AuthScheme>({ scheme: "bearer" })
  const [key, setKey] = useState("")
  const [reveal, setReveal] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelDraft, setModelDraft] = useState("")
  const [fetching, setFetching] = useState(false)
  const [busy, setBusy] = useState<"test" | "add" | null>(null)
  const [test, setTest] = useState<StoredTest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const trap = useFocusTrap(root, "first")
  const custom = type === "custom"
  const draft = { type, label, baseURL, key, auth }
  const valid = addProviderValid(draft)
  // A new form value makes the last draft Test stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on any field change.
  useEffect(() => setTest(null), [type, baseURL, key, auth.scheme, auth.header])

  const input = (): AddProviderInput => ({
    type,
    label: label.trim(),
    ...(custom ? { baseURL: baseURL.trim(), auth } : {}),
    ...(key.trim() ? { key: key.trim() } : {}),
    models: [...models, ...(modelDraft.trim() ? [modelDraft.trim()] : [])],
  })
  const host = custom ? hostOf(originOf(baseURL.trim()) ?? "") : ""
  const addModel = (m: string) => {
    const v = m.trim()
    if (v && !models.includes(v)) setModels([...models, v])
    setModelDraft("")
  }

  return (
    <div className="kimo-dialog-scrim ai-add-scrim">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="ai-add"
        data-pen="uOwr0"
        data-testid="add-provider-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
            return
          }
          trap(e)
        }}
      >
        <div className="ai-add__head" data-pen="x8Lc26">
          <span className="ai-add__icon-wrap" aria-hidden="true">
            <Server />
          </span>
          <div className="ai-add__text">
            <h2 id={titleId} className="ai-add__title">
              Add provider
            </h2>
            <p id={descId} className="ai-add__desc">
              {DESC[type]}
            </p>
          </div>
        </div>

        <div className="ai-add__body" data-pen="kumFs">
          <Field label="Type" pen="cmSwF">
            <Select
              className="ai-select ai-add__select"
              label="Provider type"
              options={ADD_PROVIDER_TYPES}
              value={type}
              onChange={(v) => {
                const t = v as ProviderType
                setType(t)
                if (!label.trim() || Object.values(DEFAULT_NAME).includes(label))
                  setLabel(DEFAULT_NAME[t])
              }}
            />
          </Field>
          <Field label="Name" pen="mjxjz" htmlFor="add-name">
            <span className="ai-value-field ai-add__value" data-pen="p8jZmn">
              <input
                id="add-name"
                className="ai-add__input"
                placeholder="Acme gateway"
                value={label}
                spellCheck={false}
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
            </span>
          </Field>
          {custom && (
            <Field label="Base URL" pen="Fvp9F" htmlFor="add-url">
              <span className="ai-value-field ai-add__value" data-pen="VMdpU">
                <input
                  id="add-url"
                  className="ai-add__input ai-add__input--mono"
                  placeholder="https://llm.example.com/v1"
                  value={baseURL}
                  spellCheck={false}
                  onChange={(e) => setBaseURL(e.currentTarget.value)}
                />
              </span>
            </Field>
          )}
          {custom && (
            <div className="ai-add__field ai-add__field--auth" data-pen="UqJ1i">
              <span className="ai-add__label">Auth header</span>
              <div className="ai-add__auth" data-pen="q7PGg">
                <SegmentedText
                  className="ai-add__scheme"
                  label="Auth header"
                  options={SCHEMES}
                  value={auth.scheme}
                  onChange={(v) =>
                    setAuth(
                      v === "custom" ? { scheme: v, header: auth.header ?? "" } : { scheme: v },
                    )
                  }
                />
                {auth.scheme === "custom" && (
                  // Not designed: Custom… reveals a header-name field (rule LHmnP).
                  <span className="ai-value-field ai-add__value ai-add__header-name">
                    <input
                      className="ai-add__input ai-add__input--mono"
                      aria-label="Header name"
                      placeholder="X-Api-Token"
                      value={auth.header ?? ""}
                      spellCheck={false}
                      onChange={(e) => setAuth({ scheme: "custom", header: e.currentTarget.value })}
                    />
                  </span>
                )}
                <span className="ai-add__preview" data-pen="bwOPU">
                  {authPreview(auth)}
                </span>
              </div>
            </div>
          )}
          <Field label="API key" pen="Qym0o" htmlFor="add-key">
            <span
              className={`ai-value-field ai-add__value${test && !test.ok && test.errorKind === "auth" ? " is-danger" : ""}`}
              data-pen="UkWYy"
            >
              <input
                id="add-key"
                className="ai-add__input ai-add__input--mono"
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  custom && isLocalUrl(baseURL) ? "No key (local runtime)" : "Paste a key"
                }
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
              />
              <button
                type="button"
                className="ai-field-icon"
                aria-label={reveal ? "Hide key" : "Show key"}
                aria-pressed={reveal}
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </Field>
          <div className="ai-add__field" data-pen="l7EYr">
            <span className="ai-add__label">Models</span>
            <div className="ai-add__chips" data-pen="MMIyj">
              {models.map((m) => (
                <span key={m} className="ai-add__chip" data-model={m}>
                  <span className="ai-add__chip-label">{m}</span>
                  <button
                    type="button"
                    className="ai-add__chip-x"
                    aria-label={`Remove ${m}`}
                    onClick={() => setModels(models.filter((x) => x !== m))}
                  >
                    <X />
                  </button>
                </span>
              ))}
              {/* Free text (rule BdODa): not drawn — a borderless mono input after the chips. */}
              <input
                className="ai-add__chip-input"
                aria-label="Add a model id"
                placeholder={models.length ? "" : "model id"}
                value={modelDraft}
                spellCheck={false}
                size={Math.max(8, modelDraft.length + 1)}
                onChange={(e) => setModelDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault()
                    addModel(modelDraft)
                  } else if (e.key === "Backspace" && !modelDraft && models.length)
                    setModels(models.slice(0, -1))
                }}
                onBlur={() => addModel(modelDraft)}
              />
              <button
                type="button"
                className="ai-add__fetch"
                data-pen="avnRN"
                disabled={fetching || (custom && originOf(baseURL.trim()) === null)}
                onClick={() => {
                  setFetching(true)
                  setError(null)
                  void ctl
                    .fetchModels(input())
                    .then((ids) => setModels([...new Set([...models, ...ids])].slice(0, 24)))
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setFetching(false))
                }}
              >
                <RefreshCw className={fetching ? "ai-spin" : undefined} aria-hidden="true" />
                <span>Fetch /models</span>
              </button>
            </div>
          </div>
          {custom && (
            <div className="ai-add__pin" data-pen="W2ERTF">
              <Pin className="ai-add__pin-icon" aria-hidden="true" />
              <p className="ai-add__pin-text">
                This key is pinned to the first origin it's sent to: {host || "this endpoint"}. If
                the base URL later points at another host, Kimo withholds the key until you re-enter
                it.
              </p>
            </div>
          )}
          <div className="ai-add__storage" data-pen="F1hbeP">
            {backend === "localStorage" ? (
              <HardDrive className="ai-add__storage-icon" aria-hidden="true" />
            ) : (
              <Lock className="ai-add__storage-icon" aria-hidden="true" />
            )}
            <span className="ai-add__storage-label">
              {savedTo(custom ? `custom:${slug(label)}` : type, backend, os)}
            </span>
          </div>
          {test && (
            <TestResult test={test} retrying={busy === "test"} onRetry={() => void runTest()} />
          )}
          {error && (
            <p className="ai-add__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="ai-add__footer" data-pen="ThgQE">
          <CompactButton
            variant="secondary"
            height={28}
            padX={12}
            icon={<PlugZap />}
            disabled={!valid || busy !== null}
            onClick={() => void runTest()}
            data-pen="Opv6O"
          >
            Test connection
          </CompactButton>
          <span className="ai-spacer" aria-hidden="true" />
          <CompactButton variant="ghost" height={28} padX={12} onClick={onCancel} data-pen="snjit">
            Cancel
          </CompactButton>
          <CompactButton
            variant="primary"
            height={28}
            padX={12}
            disabled={!valid || busy !== null}
            data-pen="AHKbr"
            onClick={() => {
              setBusy("add")
              setError(null)
              void ctl
                .addProvider(input())
                .then(({ id }) => onAdded(id))
                .catch((e) => {
                  setError(e instanceof Error ? e.message : String(e))
                  setBusy(null)
                })
            }}
          >
            Add provider
          </CompactButton>
        </div>
      </div>
    </div>
  )

  async function runTest() {
    setBusy("test")
    setError(null)
    try {
      setTest(await ctl.testDraft(input()))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
}

/** "Saved to macOS Keychain · kimo/provider.custom:acme-gateway" (F1hbeP xawMn). */
export function savedTo(
  providerId: string,
  backend: "keychain" | "localStorage" | "memory",
  os: string,
): string {
  if (backend === "localStorage") return storageLabel(providerId, backend, os)
  const store =
    os === "windows"
      ? "Windows Credential Manager"
      : os === "linux"
        ? "Secret Service"
        : "macOS Keychain"
  return `Saved to ${store} · kimo/provider.${providerId}`
}

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "endpoint"
  )
}

/** Field · <Name> (cmSwF …): row, gap 8, center; Label 96 sans 12 text-secondary lh 1.45. */
function Field({
  label,
  pen,
  htmlFor,
  children,
}: {
  label: string
  pen: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="ai-add__field" data-pen={pen}>
      {htmlFor ? (
        <label className="ai-add__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="ai-add__label">{label}</span>
      )}
      {children}
    </div>
  )
}
