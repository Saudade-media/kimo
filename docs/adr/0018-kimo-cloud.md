# 0018. Kimo Cloud: a paid hosted relay, with billing outside the open repo and an owner policy hook in the relay

- **Status:** Proposed
- **Date:** 2026-10-21
- **Deciders:** project owner
- **Builds on:** [0016](0016-multiplayer-transport-and-sessions.md) (blind relay), [0017](0017-relay-ownership-pairing.md) (device owners)

## Context

Kimo is MIT and free. Multiplayer runs on a relay the user hosts (This computer, Docker, Fly.io,
Railway). The project needs income, and the owner wants the whole app to stay free while charging
for multiplayer, and later for other hosted features.

Cap (cap.so) is the reference: open code, free self-hosting, and a paid cloud (Cap Pro) that sells
hosting, storage and share links rather than access to the code. A paywall inside an MIT app does
not hold: anyone can remove it in a fork, and it would contradict 0016's "hosting is the user's
choice". What the code cannot give away is a relay that someone else runs, keeps up and pays for.

## Decision

**The app stays free and MIT, and so does self-hosting. Kimo sells Kimo Cloud: a hosted,
end-to-end encrypted relay with no setup. Accounts, billing and provisioning live in a private
`Saudade-media/kimo-cloud` repo. The open relay gains one small seam, an owner policy, that Kimo
Cloud plugs its account check into.**

1. **What is paid.** Only the hosted relay. Every app feature, including multiplayer on your own
   relay, stays free. No license checks or paywalls go into the open repo.
2. **Who pays.** The owner who shares. Guests join by capability link with no account and no
   payment, as today. Price: one flat monthly or yearly plan per owner (about $8 a month or $80 a
   year), unlimited shared files and guests, with a storage cap. No free tier: self-hosting is the
   free path.
3. **Accounts.** Owners only, signed in with an email magic link. Signing in on a device links
   that device's key (0017 decision 1) to the account, so the account replaces pairing links on
   Kimo Cloud: any signed-in device is an owner device.
4. **Payments.** Polar (polar.sh) is the merchant of record, so EU VAT and sales tax are handled
   for Saudade Media OÜ. Prices are in USD with tax added at checkout. Polar's customer portal is
   the first billing UI. Polar won on developer experience (local webhook CLI, customer state
   API), at fees level with Paddle for the first year's volume; Paddle is the fallback. kimo-cloud
   keeps subscriptions and entitlements in its own database, with provider ids only as foreign
   keys, so switching stays cheap. Comparison: [payments research](../research/payments-paddle-vs-polar.md).
5. **One shared relay fleet.** Kimo Cloud runs the open relay image as a multi-tenant service, not
   one relay per customer. Tenancy is the owner policy below; content stays end to end encrypted,
   so Kimo Cloud stores ciphertext and never sees designs.
6. **Owner policy (the only open-repo change).** The relay's owner checks go through an
   interface, chosen at startup:
   - `devices` (default): today's 0017 owner set in `relay.sqlite`, unchanged.
   - `external`: register asks a policy module "may this device create this room, and for which
     account?" and records the room's account. The relay enforces per-account storage from its
     existing byte counts and asks the policy before new rooms and blob writes. Claim and pairing
     ops answer `OWNER_EXTERNAL` in this mode.
   The interface and the `devices` module are open. The Kimo Cloud module (account lookup, plan
   limits, signed device-to-account bindings) lives in kimo-cloud and is loaded by the private
   deployment. Self-hosters can write their own module for a team relay.
7. **In the app.** The relay wizard (board 42) lists Kimo Cloud first: sign in, subscribe in the
   provider's checkout, done. The open app only knows Kimo Cloud's public API base URL and the
   relay URL; both are plain config, so a fork can drop or replace them.
8. **Lapsed subscription.** New rooms are refused (`PLAN_REQUIRED`). Existing rooms keep syncing
   for a grace period, then turn read-only; data is kept for a retention period, and every
   participant already holds a local copy. The exact periods are set before launch.

### Private side (kimo-cloud)

- Magic-link auth, accounts, device-key bindings.
- Payment webhooks to plan state.
- The `external` owner policy module and the relay deployment (region EU first).
- Usage per account (storage, rooms), surfaced in the app and a small dashboard.

### Later paid candidates

Hosted AI agent credits, cloud file sync and version history, team admin, public publishing of
view links or prototypes. Each follows the same rule: the feature works free with your own
infrastructure or keys, and Kimo sells the hosted version.

## Consequences

- Multiplayer ships first with self-hosted relays only; Kimo Cloud is added afterwards as the
  easiest wizard option.
- Design comes first: board 42 (Kimo Cloud option, sign in, upgrade and lapsed states) in
  desing.pen, a pricing page in site.pen, then the dashboard.
- The relay gets a policy interface and an `external` mode; spec and tests cover both modes.
- Anyone may run a competing hosted relay from MIT code. The bet is that a well run, private
  by design hosted service from the makers is worth paying for.
- Guests never need accounts, so the capability link model from 0016 is unchanged.

## Open questions

- Exact price (before tax), storage cap, grace and retention periods.
- Kimo Cloud domains (for example `relay.getkimo.design` and `cloud.getkimo.design`).
