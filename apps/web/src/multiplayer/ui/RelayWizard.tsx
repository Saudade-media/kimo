/**
 * Board 42 "Relay setup" (desing.pen UYvSG): the wizard that gets a relay running without Kimo
 * running any server. A 600 wide sheet over the window: Head (icon, Set up a relay, step line,
 * Close) · Stepper (Choose · Set up · Test) · Body · Footer (Back, footnote, Secondary, Primary).
 *
 * - Choose (section 2): one radio card per path. Desktop: This computer, Docker or your own
 *   server, Fly.io (one click with flyctl), Railway, I already have a relay. Web: This computer
 *   disabled with a note, Fly.io copy-paste only; Docker preselected. Arrow keys move, Enter
 *   continues.
 * - Set up (sections 3-7): per path. This device's public key goes into the local relay, the
 *   flyctl deploy and the docker command as `KIMO_OWNER_KEY` (ADR 0017), so those relays start
 *   yours; Railway and a relay you already have are claimed by the test. The page's origin goes
 *   into allowed origins on web.
 * - Test (section 8): reach, handshake, protocol, ownership within 5 s (an unclaimed relay is
 *   claimed for this device; one another Kimo owns is "Not yours"); Save and use only after ok;
 *   then Saved (D): from the Share popover Start sharing, from Settings Close.
 *
 * Board 43 (yj64A, ADR 0018), when Kimo Cloud is on (`services.cloud`): Choose lists Kimo Cloud
 * first and selected, the five self-host paths behind a collapsed "Host your own, free" row that
 * stays open once one of them is chosen. The Kimo Cloud path is Choose · Sign in · Subscribe
 * (`CloudWizardSteps`), then Kimo Cloud is ready (3 C). A device already signed in with a plan
 * skips both (1 B, Use Kimo Cloud).
 */
import { Button, Dialog, DialogScrim, IconButton, Input, useFocusTrap } from "@kimo/ui"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Icon } from "../../lib/icons"
import { priceFor, priceLine, readyMeta } from "../cloud/view"
import { defaultWorkspaceName } from "../cloud/workspace-view"
import type { RelayOwnerState } from "../ownership"
import {
  autoOrigins,
  BUN_INSTALL_COMMAND,
  BUN_INSTALL_URL,
  dockerRunCommand,
  flyDeploySteps,
  flyManualCommands,
  flyRelayUrl,
  flyToml,
  parseFlyWhoami,
  railwayDeployUrl,
  suggestFlyApp,
  validFlyApp,
} from "../relay-setup/commands"
import type { ToolInfo } from "../relay-setup/host"
import {
  elapsed,
  installProgress,
  isQuickTunnelUrl,
  type Reach,
  uptime,
  validHostname,
} from "../relay-setup/local"
import { pendingChecks, type RelaySetupTest, testRelaySetup } from "../relay-setup/relay-test"
import { type FlyRun, type LocalChecks, runFlySteps, stepTime } from "../relay-setup/runner"
import {
  type RelaySetupServices,
  useCloudState,
  useLocalRelay,
  useRelaySetupState,
} from "../relay-setup/services"
import type { RelayPath } from "../relay-setup/store"
import { type CloudStep, cloudStepView } from "./CloudWizardSteps"
import { AddThisDeviceDialog, NOT_YOURS_DESC, NotYoursFix, RESET_OWNERSHIP_URL } from "./ownership"
import {
  Badge,
  CheckRow,
  CodeBlock,
  Field,
  LogLine,
  Note,
  OriginsGroup,
  Pill,
  RadioRow,
  RelayCheckRow,
  RelayUrlInput,
  radioKeys,
  SmallIconButton,
  Spacer,
  Track,
} from "./relay-parts"
import { RELAY_GUIDE_URL, useShareToast } from "./shared"
import "./share-ui.css"
import "./relay-wizard.css"
import "./cloud.css"

type Step = "choose" | "setup" | "test" | "saved" | CloudStep | "ready"

/** Where the wizard opens (board 43): Choose, or a Kimo Cloud step from the Share popover. */
export type WizardStart = "choose" | "sign-in" | "subscribe" | "renew"

export const PATH_LABEL: Record<RelayPath, string> = {
  local: "This computer",
  docker: "Docker or your own server",
  fly: "Fly.io",
  railway: "Railway",
  existing: "I already have a relay",
}

const PATH_ICON: Record<RelayPath, string> = {
  local: "laptop",
  docker: "container",
  fly: "plane",
  railway: "train-front",
  existing: "plug",
}

const STEP_INDEX: Record<Step, number> = {
  choose: 0,
  setup: 1,
  test: 2,
  saved: 2,
  "sign-in": 1,
  subscribe: 2,
  ready: 2,
}

export interface RelayWizardProps {
  services: RelaySetupServices
  /** Where it was opened: the Share popover goes straight to sharing after Save and use. */
  from: "share" | "settings"
  /** Saves the relay URL (Settings › Multiplayer › Relay URL); returns the normalized URL. */
  saveRelayUrl(url: string): Promise<string | null>
  onClose(): void
  /** Share popover: Start sharing this file on the saved relay. */
  onStartSharing?(relayUrl: string): Promise<void>
  /** People connected through the relay on this computer (Stop relay, Regenerate). */
  displayName?: string
  /** Render in place (harness specimens) instead of over a scrim in a portal. */
  inline?: boolean
  /** Board 43: open at a Kimo Cloud step (Use Kimo Cloud, Subscribe, Renew plan). */
  start?: WizardStart
}

type LocalView =
  | "checking"
  | "missing"
  | "myself"
  | "installing"
  | "installed"
  | "ready"
  | "named"
  | "running"

type FlyView = "checking" | "login" | "deploying" | "manual"

export function RelayWizard(props: RelayWizardProps) {
  const { services, from } = props
  const { store, local } = services
  const setup = useRelaySetupState(store)
  const localState = useLocalRelay(local)
  const toast = useShareToast()
  const web = services.kind === "web"
  const copy = useCallback(
    async (text: string, what = "Copied") => {
      try {
        await services.copy(text)
        toast({ tone: "success", icon: "copy", text: what })
      } catch {
        toast({ tone: "danger", text: "Couldn't copy to the clipboard" })
      }
    },
    [services, toast],
  )

  // --- Draft --------------------------------------------------------------------------------------
  const cloud = services.cloud
  const cloudState = useCloudState(cloud)
  const [step, setStep] = useState<Step>(
    !cloud || !props.start || props.start === "choose"
      ? "choose"
      : props.start === "sign-in"
        ? "sign-in"
        : "subscribe",
  )
  // Board 43: Kimo Cloud is first and selected on a fresh install; Host your own starts collapsed.
  const [cloudChosen, setCloudChosen] = useState(
    cloud !== null && (setup.path === null || setup.path === "cloud"),
  )
  const [hostOpen, setHostOpen] = useState(!cloudChosen)
  const [path, setPath] = useState<RelayPath>(
    setup.path && setup.path !== "cloud" && !(web && setup.path === "local")
      ? setup.path
      : web
        ? "docker"
        : "local",
  )
  const [extraOrigins, setExtraOrigins] = useState<string[]>(setup.extraOrigins)
  const [url, setUrl] = useState("")
  const [addThisDevice, setAddThisDevice] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  const auto = autoOrigins(services.kind, services.pageOrigin)
  const origins = [...auto, ...extraOrigins]

  // This device's public key (`KIMO_OWNER_KEY`): public, so it may show in commands and logs.
  const [ownerKey, setOwnerKey] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void services.ownership
      .devicePublicKey()
      .then((key) => live && setOwnerKey(key))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [services.ownership])

  // --- This computer ----------------------------------------------------------------------------
  const [localView, setLocalView] = useState<LocalView>("checking")
  const [checks, setChecks] = useState<LocalChecks | null>(null)
  const [reach, setReach] = useState<Reach>(setup.local?.reach ?? "lan")
  const [hostname, setHostname] = useState(setup.local?.hostname ?? "")
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [cfLoggedIn, setCfLoggedIn] = useState<boolean | null>(null)
  const [cfLoggingIn, setCfLoggingIn] = useState(false)
  const [lanAddress, setLanAddress] = useState<string | null>(null)

  const runChecks = useCallback(async () => {
    if (!local) return null
    const c = await local.checks(setup.local?.port)
    setChecks(c)
    return c
  }, [local, setup.local?.port])

  const enterLocal = useCallback(async () => {
    if (!local || !services.host) return
    await local.adopt(setup.local ?? undefined)
    if (local.getState().status === "running") {
      setLocalView("running")
      return
    }
    setLocalView("checking")
    void services.host.lanAddress().then(setLanAddress)
    const c = await runChecks()
    setLocalView(c?.bun ? "ready" : "missing")
  }, [local, services.host, runChecks, setup.local])

  useEffect(() => {
    if (localState?.status === "running" && step === "setup" && path === "local")
      setLocalView("running")
  }, [localState?.status, step, path])

  const installBun = async () => {
    setConfirmInstall(false)
    if (!local) return
    setLocalView("installing")
    const bun = await local.installBun()
    if (bun) {
      setChecks((c) => (c ? { ...c, bun } : c))
      await runChecks()
      setLocalView("installed")
    }
  }

  const startRelay = async () => {
    if (!local || !checks?.port) return
    if (reach === "named" && localView !== "named") {
      setLocalView("named")
      setCfLoggedIn((await services.host?.cloudflaredLoggedIn().catch(() => false)) ?? false)
      return
    }
    const state = await local.start({
      port: checks.port,
      ownerKey,
      origins,
      reach,
      hostname: reach === "named" ? hostname.trim().toLowerCase() : null,
    })
    if (state.status === "running") setLocalView("running")
    else toast({ tone: "danger", text: `Couldn't start the relay. ${state.error ?? ""}`.trim() })
  }

  const cloudflareLogin = async () => {
    const host = services.host
    if (!host) return
    setCfLoggingIn(true)
    try {
      const proc = await host.spawn({ kind: "cloudflared", args: ["tunnel", "login"] }, () => {})
      // cloudflared opens the browser and waits for the person; the certificate appears after.
      const until = services.clock.now() + 5 * 60_000
      while (services.clock.now() < until) {
        if (await host.cloudflaredLoggedIn()) break
        await new Promise<void>((r) => services.clock.setTimeout(r, 2000))
      }
      void proc.kill()
      setCfLoggedIn(await host.cloudflaredLoggedIn())
    } finally {
      setCfLoggingIn(false)
    }
  }

  // --- Fly.io ---------------------------------------------------------------------------------------
  const [flyView, setFlyView] = useState<FlyView>("checking")
  const [flyctl, setFlyctl] = useState<ToolInfo | null>(null)
  const [flyAccount, setFlyAccount] = useState<string | null>(null)
  const [flyLoggingIn, setFlyLoggingIn] = useState(false)
  const [flyApp, setFlyApp] = useState(setup.fly?.app ?? suggestFlyApp(props.displayName ?? ""))
  const [flyRegion, setFlyRegion] = useState<string | null>(setup.fly?.region ?? null)
  const [flyRun, setFlyRun] = useState<FlyRun | null>(null)
  const flyCancelled = useRef(false)

  const whoami = useCallback(async () => {
    const host = services.host
    if (!host) return null
    const lines: string[] = []
    const proc = await host.spawn({ kind: "flyctl", args: ["auth", "whoami"] }, ({ line }) =>
      lines.push(line),
    )
    const code = await proc.exited
    return code === 0 ? parseFlyWhoami(lines.join("\n")) : null
  }, [services.host])

  const enterFly = useCallback(async () => {
    if (web || !services.host) {
      setFlyView("manual")
      return
    }
    setFlyView("checking")
    const tool = await services.host.findTool("flyctl")
    setFlyctl(tool)
    if (!tool) {
      setFlyView("manual")
      return
    }
    setFlyView("login")
    setFlyAccount(await whoami().catch(() => null))
    if (!flyRegion) setFlyRegion((await services.host.flyRegion().catch(() => null)) ?? "iad")
  }, [web, services.host, whoami, flyRegion])

  const flyLogin = async () => {
    const host = services.host
    if (!host) return
    setFlyLoggingIn(true)
    try {
      const proc = await host.spawn({ kind: "flyctl", args: ["auth", "login"] }, () => {})
      await proc.exited
      setFlyAccount(await whoami().catch(() => null))
    } finally {
      setFlyLoggingIn(false)
    }
  }

  const deployFly = async () => {
    const host = services.host
    if (!host || !validFlyApp(flyApp)) return
    flyCancelled.current = false
    const region = flyRegion ?? "iad"
    const config = await host.writeFlyConfig(flyToml({ app: flyApp, region }))
    const steps = flyDeploySteps({ app: flyApp, region, config, ownerKey, origins })
    setFlyView("deploying")
    await runFlySteps(
      host,
      steps,
      flyApp,
      async (u) =>
        await services.test.probe(u).then(
          () => true,
          () => false,
        ),
      setFlyRun,
      services.clock,
      () => flyCancelled.current,
    )
  }

  // --- I already have a relay -------------------------------------------------------------------------
  /** Section 7: on blur, whether the relay answers and whose it is (nothing is claimed yet). */
  type Probe =
    | { kind: "ok"; protocol: string; owner: RelayOwnerState | null }
    | { kind: "too-old" | "not-a-relay" | "unreachable" }
  const [probe, setProbe] = useState<Probe | null>(null)
  const probeUrl = async (value: string) => {
    if (!value.trim()) {
      setProbe(null)
      return
    }
    const r = await testRelaySetup(value, {
      ...services.test,
      // The probe only asks /version: claiming waits for Test relay.
      ownership: async () => "unclaimed",
      claim: async () => {},
    })
    if (r.outcome !== "ok") {
      setProbe({
        kind: r.outcome === "too-old" || r.outcome === "not-a-relay" ? r.outcome : "unreachable",
      })
      return
    }
    const owner = await services.test.ownership(r.url).catch(() => null)
    setProbe({ kind: "ok", protocol: r.protocol ?? "kimo-mp/1", owner })
  }

  // --- Steps ------------------------------------------------------------------------------------------
  const goSetup = (p: RelayPath = path) => {
    setStep("setup")
    if (p === "local") void enterLocal()
    if (p === "fly") void enterFly()
  }

  const testUrl =
    path === "local"
      ? (localState?.publicUrl ?? localState?.lanUrl ?? "")
      : path === "fly" && flyView === "deploying"
        ? flyRelayUrl(flyApp)
        : url

  const [test, setTest] = useState<RelaySetupTest | null>(null)
  const runTest = useCallback(async () => {
    setTest({
      outcome: "testing",
      url: testUrl,
      checks: pendingChecks(),
      ms: null,
      protocol: null,
      owned: null,
      message: null,
    })
    await testRelaySetup(testUrl, services.test, setTest)
  }, [testUrl, services.test])

  const goTest = () => {
    setStep("test")
    void runTest()
  }

  const [saving, setSaving] = useState(false)
  /** Board 46 1F: the first workspace's name as typed (null: the default from the email). */
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [savedUrl, setSavedUrl] = useState<string | null>(null)
  const save = async () => {
    if (test?.outcome !== "ok") return
    setSaving(true)
    try {
      const saved = (await props.saveRelayUrl(test.url)) ?? test.url
      await store.save({
        patch: {
          path,
          extraOrigins,
          ...(path === "local" && localState?.options
            ? {
                local: {
                  port: localState.options.port,
                  reach: localState.options.reach,
                  hostname: localState.options.hostname,
                },
              }
            : {}),
          ...(path === "fly"
            ? {
                fly: {
                  app:
                    flyView === "deploying"
                      ? flyApp
                      : (hostOf(test.url)?.replace(/\.fly\.dev$/, "") ?? flyApp),
                  region: flyRegion ?? "iad",
                  byKimo: flyView === "deploying",
                },
              }
            : {}),
        },
      })
      setSavedUrl(saved)
      setStep("saved")
    } catch (e) {
      toast({
        tone: "danger",
        text: `Couldn't save the relay: ${e instanceof Error ? e.message : e}`,
      })
    } finally {
      setSaving(false)
    }
  }

  // --- Kimo Cloud (board 43) ---------------------------------------------------------------------
  // The account only on a device that chose Kimo Cloud (prices load with Choose, below): it
  // is the saved relay, or the wizard opened at one of its steps (Use Kimo Cloud, Subscribe, Renew).
  // A self-hosting install never sends its key to Kimo Cloud just by opening the wizard; Choose ›
  // Kimo Cloud › Continue asks then. Subscribe and Renew start at 3 A or 3 B.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    if (!cloud) return
    const chose = setup.path === "cloud" || (props.start !== undefined && props.start !== "choose")
    if (props.start === "subscribe" || props.start === "renew") cloud.backToChoose()
    if (props.start === "renew") void cloud.startCheckout()
    if (!chose) return
    void cloud.refresh().then((s) => {
      if (s.session !== "signed-in" && cloud.getState().signIn.phase === "signed-in")
        cloud.changeEmail()
      // Opened at Sign in on a device that is signed in already: on to the plan.
      if (s.session === "signed-in" && props.start === "sign-in") {
        if (s.account?.plan.canShare) void saveCloud()
        else {
          cloud.backToChoose()
          setStep("subscribe")
        }
      }
    })
  }, [])

  // Prices only while Choose shows the Kimo Cloud card or a Kimo Cloud step is open (3 A); the
  // store asks once and waits after a failure, so reopening the wizard does not ask again.
  useEffect(() => {
    if (cloud && (step === "choose" || step === "subscribe")) void cloud.loadPlans()
  }, [cloud, step])

  const savingCloud = useRef(false)
  const saveCloud = useCallback(async () => {
    if (!cloud || savingCloud.current) return
    savingCloud.current = true
    setSaving(true)
    try {
      const relay = await cloud.relay()
      const saved = (await props.saveRelayUrl(relay.relayUrl)) ?? relay.relayUrl
      await store.save({ patch: { path: "cloud" } })
      setSavedUrl(saved)
      setStep("ready")
    } catch (e) {
      toast({
        tone: "danger",
        text: `Couldn't save Kimo Cloud: ${e instanceof Error ? e.message : e}`,
      })
    } finally {
      savingCloud.current = false
      setSaving(false)
    }
  }, [cloud, props.saveRelayUrl, store, toast])

  // 2 C → 3 C when the plan already allows sharing; 3 B → 3 C once the payment went through.
  // The store's state now, not this render's: on the first commit the mount effect has just reset
  // a checkout left "ready" by an earlier one (Renew after a lapse), which this render still shows.
  const signInPhase = cloudState?.signIn.phase
  const checkoutPhase = cloudState?.checkout.phase
  const canShare = cloudState?.account?.plan.canShare === true
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-checks the store when its phases change
  useEffect(() => {
    const now = cloud?.getState()
    if (!now) return
    if (
      step === "sign-in" &&
      now.signIn.phase === "signed-in" &&
      now.account?.plan.canShare === true
    )
      void saveCloud()
    if (step === "subscribe" && now.checkout.phase === "ready") void saveCloud()
  }, [cloud, step, signInPhase, checkoutPhase, canShare, saveCloud])

  /** Choose › Continue on Kimo Cloud: signed in with a plan saves it; else Sign in or Subscribe. */
  const continueCloud = async () => {
    if (!cloud) return
    // The first time this device asks for its account (the wizard did not on open).
    const s = cloud.getState().session === "unknown" ? await cloud.refresh() : cloud.getState()
    if (s.session === "signed-in" && s.account?.plan.canShare) return void saveCloud()
    if (s.session === "signed-in") {
      cloud.backToChoose()
      setStep("subscribe")
      return
    }
    if (s.signIn.phase === "signed-in") cloud.changeEmail()
    setStep("sign-in")
  }

  // --- Shell --------------------------------------------------------------------------------------
  const root = useRef<HTMLDivElement>(null)
  const trap = useFocusTrap(root, "none")
  // Focus: the chosen card on Choose (arrow keys move, Enter continues), else the sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each step
  useEffect(() => {
    if (props.inline) return
    const el = root.current
    if (!el || el.contains(document.activeElement)) return
    const target =
      step === "choose"
        ? el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        : null
    ;(target ?? el).focus({ preventScroll: true })
  }, [step])
  const stepIndex = STEP_INDEX[step]
  const onCloudPath =
    step === "sign-in" || step === "subscribe" || (step === "choose" && cloudChosen)
  const sub =
    step === "choose"
      ? "Step 1 of 3 · Choose where it runs"
      : step === "sign-in"
        ? "Step 2 of 3 · Sign in"
        : step === "subscribe"
          ? "Step 3 of 3 · Subscribe"
          : step === "setup"
            ? `Step 2 of 3 · ${PATH_LABEL[path]}${
                path === "local" && localView === "named"
                  ? " · Named tunnel"
                  : path === "docker" && web
                    ? " · on web"
                    : ""
              }`
            : "Step 3 of 3 · Test"
  const headIcon = onCloudPath
    ? "cloud"
    : step === "choose"
      ? "server"
      : step === "setup"
        ? PATH_ICON[path]
        : "activity"

  let body: ReactNode
  let footer: ReactNode
  let bodyGap: 8 | 14 | 16 = 16

  const back = (to: () => void, disabled = false) => (
    <Button
      variant="ghost"
      className="rw-btn rw-back"
      icon={<Icon name="arrow-left" size={16} />}
      disabled={disabled}
      onClick={to}
    >
      Back
    </Button>
  )
  const primary = (
    label: string,
    onClick: () => void,
    opts: { icon?: string; disabled?: boolean; name?: string } = {},
  ) => (
    <Button
      variant="primary"
      className="rw-btn rw-primary"
      data-action={opts.name}
      {...(opts.icon ? { icon: <Icon name={opts.icon} size={16} /> } : {})}
      disabled={opts.disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  )
  const secondary = (
    label: string,
    onClick: () => void,
    opts: { icon?: string; disabled?: boolean; name?: string } = {},
  ) => (
    <Button
      variant="secondary"
      className="rw-btn rw-secondary"
      data-action={opts.name}
      {...(opts.icon ? { icon: <Icon name={opts.icon} size={16} /> } : {})}
      disabled={opts.disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  )

  const urlField = (help?: string, placeholder?: string) => (
    <Field label="Relay URL" {...(help ? { help } : {})}>
      {(id) => (
        <RelayUrlInput
          id={id}
          inputRef={urlRef}
          value={url}
          onChange={setUrl}
          {...(path === "existing" ? { onBlur: (v: string) => void probeUrl(v) } : {})}
          {...(placeholder ? { placeholder } : {})}
        />
      )}
    </Field>
  )

  if (step === "choose") {
    bodyGap = 8
    // Board 43 A2 lists the self-host paths as "Free" with the hosted plan above them; without
    // Kimo Cloud they keep board 42's badges.
    const options: { value: RelayPath; desc: string; badges: string[]; disabled?: boolean }[] = [
      {
        value: "local",
        desc: web
          ? "Needs the Kimo desktop app: it starts a relay with Bun on your machine."
          : "Kimo starts a relay here with Bun. Same network right away, internet through a Cloudflare tunnel.",
        badges: web ? ["Desktop only"] : cloud ? ["Free"] : ["Fastest", "Free"],
        disabled: web,
      },
      {
        value: "docker",
        desc: "A ready docker run command with a volume filled in, origins added for you.",
        badges: cloud ? ["Free"] : ["Always on"],
      },
      {
        value: "fly",
        desc: web
          ? "Copy-paste commands from the Kimo repo, then paste the URL."
          : "One click with flyctl if it is installed, otherwise copy-paste commands.",
        badges: ["Free tier"],
      },
      {
        value: "railway",
        desc: cloud
          ? "Deploy on Railway from the Kimo template, then paste its domain."
          : "Deploy on Railway from the Kimo template, paste the variables, then the URL.",
        badges: ["Free tier"],
      },
      { value: "existing", desc: "Enter its URL.", badges: [] },
    ]
    const selfRows = options.map((o) => (
      <RadioRow
        key={o.value}
        className="rw-option"
        value={o.value}
        checked={!(cloud && cloudChosen) && path === o.value}
        {...(o.disabled ? { disabled: true } : {})}
        onSelect={() => {
          setPath(o.value)
          setCloudChosen(false)
        }}
        onActivate={() => {
          setCloudChosen(false)
          goSetup(o.value)
        }}
      >
        <span className="rw-option__icon" aria-hidden="true">
          <Icon name={PATH_ICON[o.value]} size={16} />
        </span>
        <span className="rw-text">
          <span className="rw-option__title">{PATH_LABEL[o.value]}</span>
          <span className="rw-option__desc">{o.desc}</span>
        </span>
        {o.badges.map((b) => (
          <Badge key={b} className="rw-badge">
            {b}
          </Badge>
        ))}
      </RadioRow>
    ))
    if (cloud && cloudState) {
      const account = cloudState.session === "signed-in" ? cloudState.account : null
      const ready = account?.plan.canShare === true
      const month = priceFor(cloudState.plans.plans, "month")
      const keys = [
        { value: "cloud" },
        ...(hostOpen ? options.map((o) => ({ value: o.value, disabled: o.disabled })) : []),
      ]
      body = (
        <div
          className="rw-options"
          role="radiogroup"
          aria-label="Where the relay runs"
          style={{ display: "contents" }}
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).getAttribute("role") !== "radio") return
            radioKeys(e, keys, cloudChosen ? "cloud" : path, (v) => {
              if (v === "cloud") setCloudChosen(true)
              else {
                setPath(v as RelayPath)
                setCloudChosen(false)
              }
            })
          }}
        >
          <RadioRow
            className="rw-option"
            value="cloud"
            checked={cloudChosen}
            onSelect={() => setCloudChosen(true)}
            onActivate={() => void continueCloud()}
          >
            <span className="rw-option__icon" aria-hidden="true">
              <Icon name="cloud" size={16} />
            </span>
            <span className="rw-text">
              <span className="rw-option__title">Kimo Cloud</span>
              <span className="rw-option__desc">
                {ready && account
                  ? `Signed in as ${account.account.email}. Your plan is active.`
                  : "We run the relay for you. Sign in, subscribe, share."}
              </span>
            </span>
            {ready ? (
              <Badge className="rw-badge">Active</Badge>
            ) : (
              <>
                <Badge className="rw-badge">No setup</Badge>
                {month && <Badge className="rw-badge">{priceLine(month)}</Badge>}
              </>
            )}
          </RadioRow>
          <button
            type="button"
            className="rw-disclosure"
            aria-expanded={hostOpen}
            data-action="host-your-own"
            onClick={() => {
              // Stays open once a self-host path is chosen.
              if (hostOpen && !cloudChosen) return
              setHostOpen((o) => !o)
            }}
          >
            <span className="rw-disclosure__chevron" aria-hidden="true">
              <Icon name={hostOpen ? "chevron-down" : "chevron-right"} size={16} />
            </span>
            <span className="rw-text">
              <span className="rw-option__title">Host your own, free</span>
              <span className="rw-option__desc">
                This computer, Docker, Fly.io, Railway or a relay you have
              </span>
            </span>
          </button>
          {hostOpen && selfRows}
          {hostOpen && web && (
            <Note icon="info">
              A browser tab can't run a server. Get the desktop app to host from this computer.
            </Note>
          )}
        </div>
      )
      footer = (
        <>
          <span className="rw-footnote">
            {cloudChosen && ready ? "Nothing to set up" : "Self-hosting is always free"}
          </span>
          <Spacer />
          {cloudChosen && ready
            ? primary(saving ? "Saving…" : "Use Kimo Cloud", () => void saveCloud(), {
                name: "use-cloud",
                disabled: saving,
              })
            : primary("Continue", () => (cloudChosen ? void continueCloud() : goSetup()), {
                icon: "arrow-right",
                name: "continue",
              })}
        </>
      )
    } else {
      body = (
        <>
          <div
            className="rw-options"
            role="radiogroup"
            aria-label="Where the relay runs"
            style={{ display: "contents" }}
            onKeyDown={(e) => radioKeys(e, options, path, (v) => setPath(v as RelayPath))}
          >
            {selfRows}
          </div>
          {web && (
            <Note icon="info">
              A browser tab can't run a server. Get the desktop app to host from this computer.
            </Note>
          )}
        </>
      )
      footer = (
        <>
          <span className="rw-footnote">Kimo runs no servers for you</span>
          <Spacer />
          {primary("Continue", () => goSetup(), { name: "continue" })}
        </>
      )
    }
  } else if ((step === "sign-in" || step === "subscribe") && cloud && cloudState) {
    const view = cloudStepView({
      step,
      cloud,
      state: cloudState,
      clock: services.clock,
      saving,
      workspaceName: workspaceName ?? defaultWorkspaceName(cloudState.account?.account.email ?? ""),
      onWorkspaceName: setWorkspaceName,
      onChoose: () => setStep("choose"),
      onUseCloud: () => void saveCloud(),
      onSubscribe: () => {
        cloud.backToChoose()
        setStep("subscribe")
      },
    })
    body = view.body
    footer = view.footer
    bodyGap = view.bodyGap
  } else if (step === "setup") {
    const toChoose = () => setStep("choose")
    if (path === "local") {
      const bunRow = (c: LocalChecks | null) =>
        c?.bun ? (
          <CheckRow
            status="ok"
            label={`Bun${c.bun.version ? ` ${c.bun.version}` : ""}`}
            meta={tildePath(c.bun.path)}
          />
        ) : (
          <CheckRow status="warning" label="Bun" meta="not found on PATH" />
        )
      const portRow = (c: LocalChecks | null) =>
        c?.bun ? (
          c.port ? (
            <CheckRow status="ok" label={`Port ${c.port} free`} />
          ) : (
            <CheckRow status="failed" label="Port 8787 free" meta="8787 to 8806 are taken" />
          )
        ) : (
          <CheckRow status="pending" label="Port 8787 free" />
        )
      const cfRow = (c: LocalChecks | null) =>
        c?.bun && c.cloudflared ? (
          <CheckRow
            status="ok"
            label={`cloudflared${c.cloudflared.version ? ` ${c.cloudflared.version}` : ""}`}
            meta={tildePath(dirOf(c.cloudflared.path))}
          />
        ) : (
          <CheckRow status="pending" label="cloudflared" meta="optional, for internet access" />
        )
      const checksGroup = (
        <div className="rw-group" data-group="checks">
          <span className="rw-label">Checks</span>
          {bunRow(checks)}
          {portRow(checks)}
          {cfRow(checks)}
        </div>
      )
      const missing = (
        <div className="rw-callout" data-callout="missing">
          <span className="rw-callout__icon" aria-hidden="true">
            <Icon name="triangle-alert" size={16} />
          </span>
          <div className="rw-text">
            <p className="rw-title">Bun is not installed</p>
            <p className="rw-desc">
              Kimo uses Bun to run the relay. Kimo can run the official installer for you, or you
              can install it yourself.
            </p>
          </div>
        </div>
      )
      const install = localState?.install
      if (localView === "checking") {
        bodyGap = 14
        body = checksGroup
        footer = (
          <>
            {back(toChoose)}
            <Spacer />
            {primary("Start relay", () => {}, { icon: "play", disabled: true })}
          </>
        )
      } else if (localView === "missing") {
        bodyGap = 14
        body = (
          <>
            {missing}
            {checksGroup}
          </>
        )
        footer = (
          <>
            {back(toChoose)}
            <Spacer />
            {secondary("Install it myself", () => setLocalView("myself"), {
              icon: "terminal",
              name: "myself",
            })}
            {primary("Install Bun", () => setConfirmInstall(true), { name: "install-bun" })}
          </>
        )
      } else if (localView === "myself") {
        bodyGap = 14
        body = (
          <>
            {missing}
            <div className="rw-group" data-group="install-yourself">
              <span className="rw-label">
                Run this in Terminal (official installer from bun.sh)
              </span>
              <CodeBlock
                text={BUN_INSTALL_COMMAND}
                label="install command"
                onCopy={() => void copy(BUN_INSTALL_COMMAND, "Command copied")}
              />
              <button
                type="button"
                className="rw-link"
                onClick={() => void services.openUrl(BUN_INSTALL_URL)}
              >
                <span>Windows and other options on bun.sh</span>
                <span className="rw-link__icon" aria-hidden="true">
                  <Icon name="arrow-up-right" size={12} />
                </span>
              </button>
            </div>
            {checksGroup}
          </>
        )
        footer = (
          <>
            {back(() => setLocalView("missing"))}
            <Spacer />
            {secondary(
              "Re-check",
              () =>
                void runChecks().then((c) => {
                  if (c?.bun) setLocalView("installed")
                }),
              { icon: "refresh-cw", name: "recheck" },
            )}
            {primary("Start relay", () => void startRelay(), { disabled: !checks?.bun })}
          </>
        )
      } else if (localView === "installing") {
        bodyGap = 14
        const failed = install?.error != null
        body = (
          <>
            <div className="rw-status">
              {failed ? (
                <Pill tone="danger" label="Install failed" />
              ) : (
                <Pill tone="muted" label="Installing Bun" />
              )}
              <Spacer />
              <Elapsed
                since={install?.startedAt ?? services.clock.now()}
                clock={services.clock}
                stop={failed}
              />
            </div>
            <ul className="rw-log" aria-label="Installer">
              {(install?.lines ?? []).map((l) => (
                <LogLine key={l.id} status={l.status} text={l.label} />
              ))}
            </ul>
            {failed && install?.tail.length ? (
              <pre className="rw-tail">{install.tail.join("\n")}</pre>
            ) : null}
            <Track value={install ? installProgress(install.lines) : 0} />
          </>
        )
        footer = failed ? (
          <>
            {back(() => setLocalView("missing"))}
            <Spacer />
            {secondary("Install it myself", () => setLocalView("myself"), { icon: "terminal" })}
            {primary("Try again", () => void installBun(), { icon: "refresh-cw" })}
          </>
        ) : (
          <>
            {back(() => {}, true)}
            <Spacer />
            {secondary("Cancel", () => {
              local?.cancelInstall()
              setLocalView("missing")
            })}
            {primary("Start relay", () => {}, { disabled: true })}
          </>
        )
      } else if (localView === "installed") {
        bodyGap = 14
        body = (
          <>
            <div className="rw-callout rw-callout--success" data-callout="installed">
              <span className="rw-callout__icon" aria-hidden="true">
                <Icon name="circle-check" size={16} />
              </span>
              <p className="rw-title">
                Bun{checks?.bun?.version ? ` ${checks.bun.version}` : ""} installed in ~/.bun
              </p>
            </div>
            {checksGroup}
          </>
        )
        footer = (
          <>
            {back(() => setLocalView("missing"))}
            <Spacer />
            {secondary("Install it myself", () => {}, { icon: "terminal", disabled: true })}
            {primary("Continue", () => setLocalView("ready"), { name: "continue" })}
          </>
        )
      } else if (localView === "named") {
        const canStart = cfLoggedIn === true && validHostname(hostname) && !!checks?.port
        body = (
          <>
            <div className="rw-group" data-group="cloudflare">
              <span className="rw-label">Cloudflare</span>
              {checks?.cloudflared ? (
                <CheckRow
                  status="ok"
                  label={`cloudflared${checks.cloudflared.version ? ` ${checks.cloudflared.version}` : ""}`}
                />
              ) : (
                <CheckRow status="warning" label="cloudflared" meta="not found on PATH" />
              )}
              <div className="rw-check" data-status={cfLoggedIn ? "ok" : "pending"}>
                <span className="rw-check__icon" aria-hidden="true">
                  <Icon name={cfLoggedIn ? "circle-check" : "circle-dashed"} size={14} />
                </span>
                <span className="rw-check__label">
                  {cfLoggedIn ? "Logged in to Cloudflare" : "Not logged in to Cloudflare"}
                </span>
                <Spacer />
                {cfLoggedIn ? (
                  <Button
                    variant="ghost"
                    className="rw-btn--26"
                    onClick={() => void cloudflareLogin()}
                  >
                    Switch account
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="rw-btn--26"
                    icon={<Icon name="log-in" size={16} />}
                    disabled={cfLoggingIn || !checks?.cloudflared}
                    onClick={() => void cloudflareLogin()}
                  >
                    {cfLoggingIn ? "Waiting for the browser…" : "Log in to Cloudflare"}
                  </Button>
                )}
              </div>
            </div>
            <Field
              label="Hostname"
              help="Pick any subdomain on a domain in this Cloudflare account. Kimo creates the tunnel and its DNS record with cloudflared."
            >
              {(id) => <HostnameInput id={id} value={hostname} onChange={setHostname} />}
            </Field>
            <OriginsGroup
              kind={services.kind}
              auto={auto}
              extra={extraOrigins}
              onChange={setExtraOrigins}
            />
          </>
        )
        footer = (
          <>
            {back(() => setLocalView("ready"))}
            <Spacer />
            {primary(
              localState?.status === "starting" ? "Starting…" : "Start relay",
              () => void startRelay(),
              {
                icon: "play",
                disabled: !canStart || localState?.status === "starting",
                name: "start-relay",
              },
            )}
          </>
        )
      } else if (localView === "running" && localState) {
        const quick = isQuickTunnelUrl(localState.publicUrl)
        body = (
          <>
            <div className="rw-status">
              <Pill tone="success" label="Running" />
              <span className="rw-mono rw-mono--secondary">
                <Uptime
                  since={localState.startedAt ?? services.clock.now()}
                  clock={services.clock}
                />
              </span>
            </div>
            <div className="rw-group" data-group="addresses">
              <span className="rw-label">Addresses</span>
              {localState.lanUrl && (
                <AddressRow
                  icon="wifi"
                  label="Same network"
                  url={localState.lanUrl}
                  onCopy={() => void copy(localState.lanUrl ?? "", "Address copied")}
                />
              )}
              {localState.publicUrl && (
                <AddressRow
                  icon="globe"
                  label={quick ? "Internet · Quick tunnel" : "Internet · Named tunnel"}
                  url={localState.publicUrl}
                  onCopy={() => void copy(localState.publicUrl ?? "", "Address copied")}
                />
              )}
            </div>
            {quick && (
              <Note icon="triangle-alert" tone="warning">
                This address changes when the relay restarts. Links made with it stop working. Use a
                named tunnel to keep them.
              </Note>
            )}
          </>
        )
        footer = (
          <>
            <Spacer />
            <Button
              variant="ghost"
              className="rw-btn rw-btn--danger"
              icon={<Icon name="square" size={16} />}
              data-action="stop-relay"
              onClick={() => {
                void local?.stop().then(() => void enterLocal())
              }}
            >
              Stop relay
            </Button>
            {primary("Continue to test", goTest, { name: "continue-test" })}
          </>
        )
      } else {
        // ready
        const cf = !!checks?.cloudflared
        const reachRows: {
          value: Reach
          title: string
          badge?: string
          desc: string
          disabled?: boolean
        }[] = [
          {
            value: "lan",
            title: "Same network only",
            desc: `People on this Wi-Fi or LAN use ws://${lanAddress ?? "127.0.0.1"}:${checks?.port ?? 8787}. Nothing leaves your network.`,
          },
          {
            value: "quick",
            title: "Internet · Quick tunnel",
            badge: "No account",
            desc: "A free trycloudflare.com address. It changes every time the relay restarts, so links you shared stop working.",
            disabled: !cf,
          },
          {
            value: "named",
            title: "Internet · Named tunnel",
            badge: "Free Cloudflare account",
            desc: "A stable address on your domain. Links keep working across restarts.",
            disabled: !cf,
          },
        ]
        body = (
          <>
            {checksGroup}
            <div
              className="rw-group"
              role="radiogroup"
              aria-label="Who can reach it"
              data-group="reach"
              onKeyDown={(e) => radioKeys(e, reachRows, reach, (v) => setReach(v as Reach))}
            >
              <span className="rw-label">Who can reach it</span>
              {reachRows.map((r) => (
                <RadioRow
                  key={r.value}
                  className="rw-reach"
                  value={r.value}
                  checked={reach === r.value}
                  {...(r.disabled ? { disabled: true } : {})}
                  onSelect={() => setReach(r.value)}
                  onActivate={() => void startRelay()}
                >
                  <span className="rw-text">
                    <span className="rw-title-row">
                      <span className="rw-option__title">{r.title}</span>
                      {r.badge && <Badge className="rw-badge">{r.badge}</Badge>}
                    </span>
                    <span className="rw-option__desc">{r.desc}</span>
                  </span>
                </RadioRow>
              ))}
            </div>
            <Note icon="power">
              Reachable only while this computer is on and Kimo is open. For always-on sharing pick
              Docker, Fly.io or Railway.
            </Note>
          </>
        )
        footer = (
          <>
            {back(toChoose)}
            <Spacer />
            {primary(
              localState?.status === "starting" ? "Starting…" : "Start relay",
              () => void startRelay(),
              {
                icon: "play",
                disabled: !checks?.bun || !checks.port || localState?.status === "starting",
                name: "start-relay",
              },
            )}
          </>
        )
      }
    } else if (path === "docker") {
      const input = { ownerKey, origins }
      body = (
        <>
          {web && (
            <OriginsGroup kind="web" auto={auto} extra={extraOrigins} onChange={setExtraOrigins} />
          )}
          <div className="rw-group" data-group="run">
            <span className="rw-label">Run on your server</span>
            <CodeBlock
              text={dockerRunCommand(input, { masked: true })}
              label="docker run command"
              onCopy={() => void copy(dockerRunCommand(input, { masked: false }), "Command copied")}
            />
            <p className="rw-desc rw-desc--tertiary">
              KIMO_OWNER_KEY is this device's public key, safe to share. It makes the relay yours
              from the start. Put a TLS proxy (Caddy, nginx) in front and use its wss:// address.
            </p>
          </div>
          {urlField("The public address of the relay, wss:// from the internet or ws:// on a LAN.")}
        </>
      )
      footer = (
        <>
          {back(toChoose)}
          <Spacer />
          {primary("Test relay", goTest, {
            icon: "activity",
            disabled: !url.trim(),
            name: "test-relay",
          })}
        </>
      )
    } else if (path === "fly") {
      if (flyView === "manual" || flyView === "checking") {
        const input = { ownerKey, origins }
        const shown = flyManualCommands(input, { masked: true })
        const real = flyManualCommands(input, { masked: false })
        body = (
          <>
            <Note icon="info">
              {web
                ? "Run these in a terminal from a clone of github.com/Saudade-media/kimo."
                : "flyctl was not found. Run these in a terminal from a clone of github.com/Saudade-media/kimo."}
            </Note>
            <OriginsGroup
              kind={services.kind}
              auto={auto}
              extra={extraOrigins}
              onChange={setExtraOrigins}
            />
            <div className="rw-group" data-group="commands">
              <span className="rw-label">Commands</span>
              <CodeBlock
                text={shown.launch}
                label="launch command"
                onCopy={() => void copy(real.launch, "Command copied")}
              />
              {shown.secrets && (
                <CodeBlock
                  text={shown.secrets}
                  label="owner key command"
                  onCopy={() => void copy(real.secrets, "Command copied")}
                />
              )}
              <CodeBlock
                text={shown.deploy}
                label="deploy command"
                onCopy={() => void copy(real.deploy, "Command copied")}
              />
            </div>
            {urlField(undefined, "wss://your-app.fly.dev")}
          </>
        )
        footer = (
          <>
            {back(toChoose)}
            <Spacer />
            {primary("Test relay", goTest, {
              icon: "activity",
              disabled: !url.trim(),
              name: "test-relay",
            })}
          </>
        )
      } else if (flyView === "login") {
        const appOk = validFlyApp(flyApp)
        body = (
          <>
            <div className="rw-group" data-group="flyctl">
              <span className="rw-label">flyctl</span>
              <CheckRow
                status="ok"
                label={`flyctl${flyctl?.version ? ` ${flyctl.version}` : ""}`}
                meta={flyctl ? tildePath(dirOf(flyctl.path)) : null}
              />
              <div className="rw-check" data-status={flyAccount ? "ok" : "pending"}>
                <span className="rw-check__icon" aria-hidden="true">
                  <Icon name={flyAccount ? "circle-check" : "circle-dashed"} size={14} />
                </span>
                <span className="rw-check__label">
                  {flyAccount ? "Logged in to Fly.io" : "Not logged in to Fly.io"}
                </span>
                <Spacer />
                {flyAccount ? (
                  <span className="rw-mono">{flyAccount}</span>
                ) : (
                  <Button
                    variant="secondary"
                    className="rw-btn--26"
                    icon={<Icon name="log-in" size={16} />}
                    disabled={flyLoggingIn}
                    data-action="fly-login"
                    onClick={() => void flyLogin()}
                  >
                    {flyLoggingIn ? "Waiting for the browser…" : "Log in to Fly.io"}
                  </Button>
                )}
              </div>
            </div>
            <Field
              label="App name"
              help={
                appOk
                  ? `Becomes ${flyApp}.fly.dev. Region picked by flyctl, closest to you.`
                  : "Lowercase letters, digits and dashes, starting with a letter."
              }
            >
              {(id) => <AppNameInput id={id} value={flyApp} onChange={setFlyApp} />}
            </Field>
          </>
        )
        footer = (
          <>
            {back(toChoose)}
            <Spacer />
            {primary("Deploy", () => void deployFly(), {
              icon: "rocket",
              disabled: !flyAccount || !appOk || !ownerKey,
              name: "deploy",
            })}
          </>
        )
      } else {
        // deploying
        const run = flyRun
        const done = run?.done && !run.error
        const failed = !!run?.error
        body = (
          <>
            <div className="rw-status">
              {failed ? (
                <Pill tone="danger" label="Deploy failed" />
              ) : done ? (
                <Pill tone="success" label="Deployed" />
              ) : (
                <Pill tone="muted" label="Deploying" />
              )}
              <span className="rw-mono rw-mono--secondary">
                {flyApp} · {flyRegion ?? "iad"}
              </span>
              <Spacer />
              <Elapsed
                since={run?.startedAt ?? services.clock.now()}
                clock={services.clock}
                stop={!!run?.done}
              />
            </div>
            <ul className="rw-log" aria-label="Deploy">
              {(run?.lines ?? []).map((l) => (
                <LogLine
                  key={l.id}
                  status={l.status}
                  text={l.label}
                  meta={l.ms !== null ? stepTime(l.ms) : null}
                />
              ))}
            </ul>
            {failed && run?.tail.length ? (
              <pre className="rw-tail">{run.tail.join("\n")}</pre>
            ) : null}
            {run && run.output.length > 0 && (
              <details className="rw-output">
                <summary>Full output</summary>
                <pre>{run.output.join("\n")}</pre>
              </details>
            )}
            <Track
              value={
                run ? run.lines.filter((l) => l.status === "done").length / run.lines.length : 0
              }
            />
          </>
        )
        footer = failed ? (
          <>
            {back(() => setFlyView("login"))}
            <Spacer />
            {primary("Retry", () => void deployFly(), { icon: "refresh-cw", name: "retry" })}
          </>
        ) : (
          <>
            <Spacer />
            <Button
              variant="ghost"
              className="rw-btn"
              disabled={done}
              onClick={() => {
                flyCancelled.current = true
                setFlyView("login")
              }}
            >
              Cancel
            </Button>
            {primary("Continue to test", goTest, { disabled: !done, name: "continue-test" })}
          </>
        )
      }
    } else if (path === "railway") {
      body = (
        <>
          <div className="rw-group" data-group="template">
            <span className="rw-label">1 · Deploy on Railway</span>
            <Button
              variant="secondary"
              className="rw-btn rw-railway"
              icon={<Icon name="external-link" size={16} />}
              style={{ alignSelf: "flex-start" }}
              onClick={() => void services.openUrl(railwayDeployUrl(ownerKey))}
            >
              Deploy on Railway
            </Button>
            <p className="rw-desc rw-desc--tertiary">
              Opens railway.com with the Kimo template. Sign in or create a free account there, then
              Deploy.
            </p>
          </div>
          <div className="rw-group" data-group="domain">
            <span className="rw-label">2 · Paste your service URL here</span>
            {urlField(undefined, "wss://kimo-relay-production.up.railway.app")}
          </div>
        </>
      )
      footer = (
        <>
          {back(toChoose)}
          <Spacer />
          {primary("Test relay", goTest, {
            icon: "activity",
            disabled: !url.trim(),
            name: "test-relay",
          })}
        </>
      )
    } else {
      // existing
      const r = probe
      body = (
        <>
          {urlField()}
          {r && (
            <div className="rw-probe" data-probe={r.kind === "ok" ? (r.owner ?? "ok") : r.kind}>
              {r.kind === "ok" ? (
                <>
                  <Pill tone="success" label={`Kimo relay · ${r.protocol}`} />
                  {r.owner && (
                    <span className="rw-mono">
                      {r.owner === "unclaimed"
                        ? "not claimed yet"
                        : r.owner === "yours"
                          ? "yours"
                          : r.owner === "external"
                            ? "managed by its host"
                            : "not yours"}
                    </span>
                  )}
                </>
              ) : r.kind === "too-old" ? (
                <Pill tone="warning" label="Older protocol" />
              ) : r.kind === "not-a-relay" ? (
                <Pill tone="warning" label="Not a relay" />
              ) : (
                <Pill tone="danger" label="Unreachable" />
              )}
            </div>
          )}
          {r?.kind === "ok" && r.owner === "unclaimed" && (
            <div className="rw-none" data-claim="free">
              <span className="rw-none__icon" aria-hidden="true">
                <Icon name="circle-check" size={14} />
              </span>
              <p className="rw-desc">
                Nobody has claimed this relay yet. The test makes it yours, nothing to enter.
              </p>
            </div>
          )}
          {r?.kind === "ok" && r.owner === "other" && (
            <NotYoursFix
              desc={NOT_YOURS_DESC}
              onAddThisDevice={() => setAddThisDevice(true)}
              onResetOwnership={() => void services.openUrl(RESET_OWNERSHIP_URL)}
            />
          )}
        </>
      )
      footer = (
        <>
          {back(toChoose)}
          <Spacer />
          {primary("Test relay", goTest, {
            icon: "activity",
            disabled: !url.trim(),
            name: "test-relay",
          })}
        </>
      )
    }
  } else if (step === "test") {
    const t = test
    const outcome = t?.outcome ?? "testing"
    const rows =
      !t || outcome === "testing" || outcome === "ok" || outcome === "not-yours"
        ? (t?.checks ?? pendingChecks())
        : outcome === "too-old"
          ? t.checks.slice(0, 3)
          : t.checks.slice(0, 2)
    const pill =
      outcome === "testing" ? (
        <Pill tone="muted" label="Testing" />
      ) : outcome === "ok" ? (
        <Pill tone="success" label="Ready" />
      ) : outcome === "not-yours" ? (
        <Pill tone="warning" label="Not yours" />
      ) : outcome === "not-a-relay" ? (
        <Pill tone="warning" label="Not a relay" />
      ) : outcome === "too-old" ? (
        <Pill tone="warning" label="Older protocol" />
      ) : (
        <Pill tone="danger" label="Unreachable" />
      )
    const editUrl = () => {
      setStep("setup")
      if (path === "local") void enterLocal()
      requestAnimationFrame(() => urlRef.current?.focus())
    }
    const failure =
      outcome === "unreachable" ||
      outcome === "invalid" ||
      outcome === "not-a-relay" ||
      outcome === "too-old"
    body = (
      <>
        <div className="rw-target">
          <span className="rw-check__icon" aria-hidden="true">
            <Icon name="server" size={14} />
          </span>
          <span className="rw-mono rw-mono--primary">{displayUrl(t?.url ?? testUrl)}</span>
          <Spacer />
          {pill}
        </div>
        <div className="rw-group" data-group="test" role="status" aria-live="polite">
          {rows.map((c) => (
            <RelayCheckRow key={c.id} check={c} server={outcome === "not-a-relay"} />
          ))}
        </div>
        {outcome === "not-yours" && (
          <NotYoursFix
            desc={NOT_YOURS_DESC}
            onAddThisDevice={() => setAddThisDevice(true)}
            onResetOwnership={() => void services.openUrl(RESET_OWNERSHIP_URL)}
          />
        )}
        {outcome === "ok" && t?.owned === "already" && (
          <div className="rw-message" data-message="already-yours">
            <p className="rw-title">Already yours</p>
            <p className="rw-desc">
              Kimo set up this relay for this device, so it is already yours. Save and use as usual.
            </p>
          </div>
        )}
        {failure && (
          <>
            <div className="rw-message">
              <p className="rw-title">
                {outcome === "not-a-relay"
                  ? "Something answered, but not a Kimo relay"
                  : outcome === "too-old"
                    ? "This relay speaks an older protocol"
                    : "Couldn't reach the relay"}
              </p>
              <p className="rw-desc">
                {outcome === "not-a-relay"
                  ? "Check the path; Kimo relays usually end in /kimo or have none."
                  : outcome === "too-old"
                    ? `It speaks ${t?.protocol ?? "an older protocol"} and this Kimo needs kimo-mp/1. Update it: redeploy on Fly or Railway, docker pull for Docker. Kimo updates its own local relay.`
                    : outcome === "invalid"
                      ? "Check the URL: use wss://, https://, or ws:// on a local network."
                      : "Check the URL and that it is running. A new Fly or Railway deploy can take a minute to come up."}
              </p>
            </div>
            <div className="rw-actions">
              <Button
                variant="secondary"
                className="rw-btn--26"
                icon={<Icon name="refresh-cw" size={16} />}
                data-action="test-again"
                onClick={() => void runTest()}
              >
                Test again
              </Button>
              {outcome === "too-old" ? (
                <Button
                  variant="ghost"
                  className="rw-btn--26"
                  icon={<Icon name="book-open" size={16} />}
                  onClick={() => void services.openUrl(RELAY_GUIDE_URL)}
                >
                  Update guide
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="rw-btn--26"
                  icon={<Icon name="pencil" size={16} />}
                  onClick={editUrl}
                >
                  Edit URL
                </Button>
              )}
            </div>
          </>
        )}
      </>
    )
    footer = (
      <>
        {back(() => {
          setStep("setup")
          if (path === "local") void enterLocal()
        })}
        <Spacer />
        {outcome === "not-yours" &&
          secondary("Test again", () => void runTest(), { icon: "refresh-cw", name: "test-again" })}
        {primary(saving ? "Saving…" : "Save and use", () => void save(), {
          disabled: outcome !== "ok" || saving,
          name: "save",
        })}
      </>
    )
  }

  const readyAccount = cloudState?.account ?? null
  const shell =
    step === "ready" ? (
      <div
        ref={root}
        className="rw-shell rw-shell--saved"
        role="dialog"
        aria-modal={props.inline ? undefined : "true"}
        aria-label="Kimo Cloud is ready"
        data-step="ready"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault()
            props.onClose()
            return
          }
          trap(e)
        }}
      >
        <div className="rw-saved">
          <span className="rw-saved__icon" aria-hidden="true">
            <Icon name="circle-check" size={18} />
          </span>
          <div className="rw-saved__text">
            <h2 className="rw-head__title">Kimo Cloud is ready</h2>
            <p className="rw-saved__desc">
              Saved to Settings › Multiplayer. Start sharing from the Share button.
            </p>
          </div>
          <span className="rw-mono">
            {readyMeta(readyAccount?.account.email ?? "", readyAccount?.plan ?? null)}
          </span>
          <div className="rw-actions rw-actions--ready">
            {from === "share" && props.onStartSharing ? (
              <>
                <Button
                  variant="ghost"
                  className="rw-btn rw-ready-close"
                  data-action="close"
                  onClick={props.onClose}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  className="rw-btn"
                  icon={<Icon name="radio" size={16} />}
                  data-action="start-sharing"
                  onClick={() => {
                    if (savedUrl) void props.onStartSharing?.(savedUrl).then(props.onClose)
                  }}
                >
                  Start sharing
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                className="rw-btn"
                data-action="close"
                onClick={props.onClose}
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
    ) : step === "saved" ? (
      <div
        ref={root}
        className="rw-shell rw-shell--saved"
        role="dialog"
        aria-modal={props.inline ? undefined : "true"}
        aria-label="Relay setup"
        data-step="saved"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault()
            props.onClose()
            return
          }
          trap(e)
        }}
      >
        <div className="rw-saved">
          <span className="rw-saved__icon" aria-hidden="true">
            <Icon name="circle-check" size={18} />
          </span>
          <div className="rw-saved__text">
            <h2 className="rw-head__title">Your relay is ready</h2>
            <p className="rw-saved__desc">
              Saved to Settings › Multiplayer. This relay is yours now.{" "}
              {from === "share"
                ? "Start sharing this file now."
                : "Start sharing from the Share button."}
            </p>
          </div>
          <span className="rw-mono">
            {displayUrl(savedUrl ?? "")} · {test?.protocol ?? "kimo-mp/1"}
          </span>
          <div className="rw-actions rw-actions--saved">
            {from === "share" && props.onStartSharing ? (
              <Button
                variant="primary"
                className="rw-btn"
                icon={<Icon name="radio" size={16} />}
                data-action="start-sharing"
                onClick={() => {
                  if (savedUrl) void props.onStartSharing?.(savedUrl).then(props.onClose)
                }}
              >
                Start sharing
              </Button>
            ) : (
              <Button
                variant="primary"
                className="rw-btn"
                data-action="close"
                onClick={props.onClose}
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
    ) : (
      <div
        ref={root}
        className="rw-shell"
        role="dialog"
        aria-modal={props.inline ? undefined : "true"}
        aria-labelledby="rw-title"
        data-step={step}
        data-path={path}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault()
            props.onClose()
            return
          }
          trap(e)
        }}
      >
        <div className="rw-head">
          <span className="rw-icon-wrap" aria-hidden="true">
            <Icon name={headIcon} size={16} />
          </span>
          <div className="rw-head__text">
            <h2 id="rw-title" className="rw-head__title">
              Set up a relay
            </h2>
            <p className="rw-head__sub">{sub}</p>
          </div>
          <IconButton
            className="rw-close"
            label="Close"
            icon={<Icon name="x" size={14} />}
            size="sm"
            tone="ghost"
            onClick={props.onClose}
          />
        </div>
        <ol className="rw-stepper" aria-label="Steps">
          {(onCloudPath ? ["Choose", "Sign in", "Subscribe"] : ["Choose", "Set up", "Test"]).map(
            (label, i) => {
              const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "next"
              return (
                <li key={label} style={{ display: "contents" }}>
                  {i > 0 && <span className="rw-connector" aria-hidden="true" />}
                  <span
                    className="rw-step"
                    data-state={state}
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    <span className="rw-step__dot" aria-hidden="true">
                      {state === "done" ? <Icon name="check" size={12} /> : i + 1}
                    </span>
                    <span className="rw-step__label">{label}</span>
                  </span>
                </li>
              )
            },
          )}
        </ol>
        <div className="rw-body" data-gap={bodyGap}>
          {body}
        </div>
        <div className="rw-footer">{footer}</div>
        {addThisDevice && (
          <AddThisDeviceDialog
            host={hostOf(test?.url ?? url) ?? displayUrl(test?.url ?? url)}
            onClose={() => setAddThisDevice(false)}
          />
        )}
        {confirmInstall && (
          <DialogScrim className="rw-scrim">
            <Dialog
              className="rw-install-dialog"
              icon={<Icon name="download" size={16} />}
              title="Install Bun?"
              description="Kimo runs the official installer from bun.sh in a hidden terminal. It installs Bun for your user only, in ~/.bun, and needs network access. No admin password."
              footnote="About 30 MB, under a minute."
              confirmLabel="Install Bun"
              onCancel={() => setConfirmInstall(false)}
              onConfirm={() => void installBun()}
            >
              <div className="rw-dialog-code">{BUN_INSTALL_COMMAND}</div>
            </Dialog>
          </DialogScrim>
        )}
      </div>
    )
  if (props.inline) return shell
  return createPortal(<DialogScrim className="rw-scrim">{shell}</DialogScrim>, document.body)
}

// --- Bits ---------------------------------------------------------------------------------------------

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** `https://x` is shown as the `wss://x` people paste (the relay accepts both). */
export function displayUrl(url: string): string {
  return url.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
}

function tildePath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~")
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return i > 0 ? p.slice(0, i) : p
}

function AddressRow({
  icon,
  label,
  url,
  onCopy,
}: {
  icon: string
  label: string
  url: string
  onCopy(): void
}) {
  return (
    <div className="rw-box rw-box--address" data-address={icon}>
      <span className="rw-box__icon" aria-hidden="true">
        <Icon name={icon} size={14} />
      </span>
      <div className="rw-text rw-text--1">
        <span className="rw-desc rw-desc--tertiary" style={{ lineHeight: "normal" }}>
          {label}
        </span>
        <span className="rw-mono rw-mono--primary">{url}</span>
      </div>
      <SmallIconButton icon="copy" label={`Copy ${label.toLowerCase()} address`} onClick={onCopy} />
    </div>
  )
}

/** m:ss since `since`, ticking every second until `stop`. */
function Elapsed({
  since,
  clock,
  stop,
}: {
  since: number
  clock: RelaySetupServices["clock"]
  stop?: boolean
}) {
  const [now, setNow] = useState(clock.now())
  useEffect(() => {
    if (stop) return
    let handle: unknown
    const tick = () => {
      setNow(clock.now())
      handle = clock.setTimeout(tick, 1000)
    }
    handle = clock.setTimeout(tick, 1000)
    return () => clock.clearTimeout(handle)
  }, [clock, stop])
  return <span className="rw-mono">{elapsed(now - since)}</span>
}

function Uptime({ since, clock }: { since: number; clock: RelaySetupServices["clock"] }) {
  const [now, setNow] = useState(clock.now())
  useEffect(() => {
    let handle: unknown
    const tick = () => {
      setNow(clock.now())
      handle = clock.setTimeout(tick, 30_000)
    }
    handle = clock.setTimeout(tick, 30_000)
    return () => clock.clearTimeout(handle)
  }, [clock])
  return <>{uptime(now - since)}</>
}

function HostnameInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange(v: string): void
}) {
  return (
    <InputWithIcon
      id={id}
      icon="globe"
      value={value}
      onChange={onChange}
      placeholder="kimo.example.com"
    />
  )
}

function AppNameInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange(v: string): void
}) {
  return (
    <InputWithIcon
      id={id}
      icon="tag"
      value={value}
      onChange={(v) => onChange(v.toLowerCase())}
      placeholder="kimo-relay-you"
    />
  )
}

function InputWithIcon({
  id,
  icon,
  value,
  onChange,
  placeholder,
}: {
  id: string
  icon: string
  value: string
  onChange(v: string): void
  placeholder: string
}) {
  return (
    <Input
      id={id}
      frameProps={{ className: "rw-mono-input" }}
      icon={<Icon name={icon} size={16} />}
      spellCheck={false}
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}
