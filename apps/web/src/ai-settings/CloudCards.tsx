/**
 * Bedrock · Vertex · Foundry "Set up" (board 25 "v1 Polish" §4 gpmey; rules Oo1ZC / wqHjl /
 * zYzwc): the cloud row expands one detail card per cloud, same field grammar as Anthropic.
 *
 *   Detail · <Cloud> (YewZG / bSx6y / g7Uzta) column, gap 10, padding 16, bg-app, stroke border,
 *     radius-lg › Head (da1Bb) row gap 8 center: Tile 24 (bg-muted, radius-sm, cloud 14) ·
 *     Title sans 12 / 600 · Spacer · "Desktop only" (StatusPill warning) › Field rows (row gap 8,
 *     center; Label 96 sans 12 text-secondary lh 1.45; Select / Value Field h 28) › Hint (Y0owv)
 *     row gap 6: info 12 · Text sans 11 text-tertiary lh 1.45
 *
 * No key field: these use signed / OAuth credentials resolved on the desktop side. The relay
 * supports Foundry with an API key only, so Auth "API key" adds a key row (not drawn).
 */
import { MODEL_CATALOG } from "@kimo/ai-agent"
import { AgentTonePill, Select } from "@kimo/ui"
import { Cloud, Info } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import type { AiSettingsController, CloudFields } from "./controller"
import type { StoredProvider } from "./model"
import "./polish.css"

type CloudKind = "bedrock" | "vertex" | "foundry"

export const BEDROCK_REGIONS = [
  { value: "us-east-1", label: "us-east-1 · N. Virginia" },
  { value: "us-east-2", label: "us-east-2 · Ohio" },
  { value: "us-west-2", label: "us-west-2 · Oregon" },
  { value: "eu-central-1", label: "eu-central-1 · Frankfurt" },
  { value: "eu-west-1", label: "eu-west-1 · Ireland" },
  { value: "eu-west-3", label: "eu-west-3 · Paris" },
  { value: "ap-northeast-1", label: "ap-northeast-1 · Tokyo" },
  { value: "ap-southeast-2", label: "ap-southeast-2 · Sydney" },
]

export const VERTEX_REGIONS = [
  "us-east5",
  "us-central1",
  "europe-west1",
  "europe-west4",
  "asia-southeast1",
  "global",
].map((r) => ({ value: r, label: r }))

const anthropicIds = () => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of MODEL_CATALOG.anthropic)
    if (!seen.has(m.label)) {
      seen.add(m.label)
      out.push(m.id)
    }
  return out
}

const withCurrent = (opts: { value: string; label: string }[], cur: string | undefined) =>
  cur && !opts.some((o) => o.value === cur) ? [...opts, { value: cur, label: cur }] : opts

export interface CloudCardsProps {
  ctl: AiSettingsController
  /** Web: the cards still render (read-only) under the disabled row. */
  readOnly?: boolean
}

export function CloudCards({ ctl, readOnly = false }: CloudCardsProps) {
  const stored = (k: CloudKind): Partial<StoredProvider> => {
    const s = ctl.storedOf(k)
    return s && s.kind === k ? s : ({} as Partial<StoredProvider>)
  }
  const set = (k: CloudKind, f: CloudFields) => void ctl.setCloud(k, f)
  const b = stored("bedrock")
  const v = stored("vertex")
  const f = stored("foundry")
  const jsonInput = useRef<HTMLInputElement>(null)
  const [foundryKey, setFoundryKey] = useState("")
  const bedrockModels = anthropicIds().map((id) => ({
    value: `anthropic.${id}`,
    label: `anthropic.${id}`,
    mono: true,
  }))
  const deployments = anthropicIds().map((id) => ({ value: id, label: id, mono: true }))
  const profile = b.profile ?? "default"
  return (
    <>
      <div className="ai-cloud" data-pen="YewZG" data-cloud="bedrock">
        <Head title="Amazon Bedrock" pen="da1Bb" />
        <Row label="Region" pen="Wqt1R">
          <Select
            className="ai-select"
            label="Bedrock region"
            disabled={readOnly}
            options={withCurrent(BEDROCK_REGIONS, b.region)}
            value={b.region ?? "us-east-1"}
            onChange={(r) => set("bedrock", { region: r })}
          />
        </Row>
        <Row label="Credentials" pen="f0KTgP">
          <Select
            className="ai-select"
            label="Bedrock credentials"
            disabled={readOnly}
            options={[
              { value: "profile", label: `AWS profile · ${profile}` },
              { value: "env", label: "Environment (AWS_ACCESS_KEY_ID…)" },
              { value: "sso", label: "SSO session" },
            ]}
            value={b.credentials ?? "profile"}
            onChange={(c) => set("bedrock", { credentials: c })}
          />
        </Row>
        <Row label="Profile" pen="VlNqo" htmlFor="bedrock-profile">
          <span className="ai-value-field ai-add__value" data-pen="VSebY">
            <input
              id="bedrock-profile"
              key={b.profile ?? ""}
              className="ai-add__input ai-add__input--mono"
              disabled={readOnly}
              placeholder="default  (~/.aws/config)"
              defaultValue={b.profile ? `${b.profile}  (~/.aws/config)` : ""}
              spellCheck={false}
              onFocus={(e) => {
                e.currentTarget.value = b.profile ?? ""
              }}
              onBlur={(e) => {
                const val = e.currentTarget.value.replace(/\s+\(~\/\.aws\/config\)$/, "").trim()
                if (val !== (b.profile ?? "")) set("bedrock", { profile: val })
                else if (b.profile) e.currentTarget.value = `${b.profile}  (~/.aws/config)`
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
            />
          </span>
        </Row>
        <Row label="Models" pen="R281n">
          <Select
            className="ai-select ai-select--mono"
            label="Bedrock model"
            disabled={readOnly}
            options={withCurrent(bedrockModels, b.models?.agent)}
            value={b.models?.agent ?? bedrockModels[0]?.value ?? ""}
            onChange={(m) => set("bedrock", { model: m })}
          />
        </Row>
        <Hint pen="Y0owv">
          Credential source: AWS profile, environment (AWS_ACCESS_KEY_ID…), or SSO session. Kimo
          signs requests with SigV4 on the Rust side; nothing is stored in Kimo.
        </Hint>
      </div>

      <div className="ai-cloud" data-pen="bSx6y" data-cloud="vertex">
        <Head title="Google Vertex AI" pen="frYz2" />
        <Row label="Project ID" pen="iN4fQ" htmlFor="vertex-project">
          <span className="ai-value-field ai-add__value" data-pen="q9hw2">
            <TextInput
              id="vertex-project"
              value={v.project}
              placeholder="my-gcp-project"
              disabled={readOnly}
              onCommit={(project) => set("vertex", { project })}
            />
          </span>
        </Row>
        <Row label="Region" pen="CiYaA">
          <Select
            className="ai-select"
            label="Vertex region"
            disabled={readOnly}
            options={withCurrent(VERTEX_REGIONS, v.region)}
            value={v.region ?? "us-east5"}
            onChange={(r) => set("vertex", { region: r })}
          />
        </Row>
        <Row label="Credentials" pen="VR8Jd">
          <Select
            className="ai-select"
            label="Vertex credentials"
            disabled={readOnly}
            options={[
              { value: "adc", label: "Application default credentials" },
              { value: "service-account", label: "Service account JSON…" },
            ]}
            value={v.credentials ?? "adc"}
            onChange={(c) => {
              if (c === "service-account") jsonInput.current?.click()
              else {
                set("vertex", { credentials: c })
                void ctl.deleteKey("vertex").catch(() => {})
              }
            }}
          />
          <input
            ref={jsonInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ""
              if (!file) return
              // The file is copied into the keychain, then the path is forgotten.
              void file.text().then(async (json) => {
                await ctl.setCloud("vertex", { credentials: "service-account" })
                await ctl.setKey("vertex", json)
              })
            }}
          />
        </Row>
        <Hint pen="PdJoH">
          Or use 'Service account JSON…'. The file is copied into the Keychain, then the path is
          forgotten.
        </Hint>
      </div>

      <div className="ai-cloud" data-pen="g7Uzta" data-cloud="foundry">
        <Head title="Microsoft Foundry" pen="dGO0R" />
        <Row label="Resource" pen="W8RUsj" htmlFor="foundry-resource">
          <span className="ai-value-field ai-add__value" data-pen="Dfa2q">
            <TextInput
              id="foundry-resource"
              value={f.resource}
              placeholder="my-ai-resource"
              disabled={readOnly}
              onCommit={(resource) => set("foundry", { resource })}
            />
          </span>
        </Row>
        <Row label="Project" pen="w7DSE" htmlFor="foundry-project">
          <span className="ai-value-field ai-add__value" data-pen="FYSVE">
            <TextInput
              id="foundry-project"
              value={f.project}
              placeholder="my-project"
              disabled={readOnly}
              onCommit={(project) => set("foundry", { project })}
            />
          </span>
        </Row>
        <Row label="Auth" pen="P4s1XM">
          <Select
            className="ai-select"
            label="Foundry auth"
            disabled={readOnly}
            options={[
              { value: "entra", label: "Microsoft Entra ID · signed in" },
              { value: "api-key", label: "API key" },
            ]}
            value={f.credentials ?? "entra"}
            onChange={(c) => set("foundry", { credentials: c })}
          />
        </Row>
        {f.credentials === "api-key" && (
          <Row label="API key" pen="foundry-key" htmlFor="foundry-key">
            <span className="ai-value-field ai-add__value">
              <input
                id="foundry-key"
                className="ai-add__input ai-add__input--mono"
                type="password"
                autoComplete="off"
                placeholder="Paste the resource's key"
                value={foundryKey}
                disabled={readOnly}
                onChange={(e) => setFoundryKey(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && foundryKey.trim())
                    void ctl.setKey("foundry", foundryKey).then(() => setFoundryKey(""))
                }}
              />
            </span>
          </Row>
        )}
        <Row label="Deployment" pen="V48kJ4">
          <Select
            className="ai-select ai-select--mono"
            label="Foundry deployment"
            disabled={readOnly}
            options={withCurrent(deployments, f.models?.agent)}
            value={f.models?.agent ?? deployments[0]?.value ?? ""}
            onChange={(m) => set("foundry", { model: m })}
          />
        </Row>
      </div>
    </>
  )
}

function Head({ title, pen }: { title: string; pen: string }) {
  return (
    <div className="ai-cloud__head" data-pen={pen}>
      <span className="ai-cloud__tile" aria-hidden="true">
        <Cloud />
      </span>
      <span className="ai-cloud__title">{title}</span>
      <span className="ai-spacer" aria-hidden="true" />
      <AgentTonePill className="ai-cloud__pill" tone="warning" label="Desktop only" />
    </div>
  )
}

function Row({
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
    <div className="ai-add__field ai-cloud__field" data-pen={pen}>
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

function Hint({ pen, children }: { pen: string; children: ReactNode }) {
  return (
    <div className="ai-cloud__hint" data-pen={pen}>
      <Info className="ai-cloud__hint-icon" aria-hidden="true" />
      <p className="ai-cloud__hint-text">{children}</p>
    </div>
  )
}

function TextInput({
  id,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  id: string
  value: string | undefined
  placeholder: string
  disabled: boolean
  onCommit: (v: string) => void
}) {
  return (
    <input
      id={id}
      key={value ?? ""}
      className="ai-add__input ai-add__input--mono"
      placeholder={placeholder}
      defaultValue={value ?? ""}
      disabled={disabled}
      spellCheck={false}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim()
        if (v !== (value ?? "")) onCommit(v)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}
