# Kimo Cloud payments: Paddle vs Polar

Date: 2026-10-21. Scope: merchant of record (MoR) for Kimo Cloud, a flat ~$8/mo or ~$80/yr subscription per owner, sold by Saudade Media OU (Estonia, EU VAT registered). Billing code lives in the private kimo-cloud service (Bun/TypeScript).

Sources are official pricing, docs, legal and help pages fetched on 2026-10-21 unless noted. Most of these pages carry no date. Anything older than 12 months is marked **STALE**.

## Recommendation

Go with **Paddle**, and keep Polar as the documented fallback. At Kimo's price points and buyer mix (mostly non-US cards), Paddle's list price matches or beats what a new Polar org gets. Paddle has no international-card surcharge, and EUR payouts to a Eurozone bank are free. Polar Starter adds 1.5% on non-US cards plus Stripe payout fees. Paddle is also the safer counterparty: English-law terms, 30 days' notice of changes, a 6-month post-termination hold (Polar: 9 months), and a long track record. Polar wins on DX. It has a CLI that forwards and triggers webhooks locally, a Customer State API with entitlements built in, and a more modern SDK. But Kimo's billing is simple (one flat plan, account-based, magic-link identity), so that DX gap costs days, not weeks. Before signing, ask Paddle two things. What rate applies to the under-$10 monthly plan (bespoke pricing, https://www.paddle.com/pricing)? And what margin applies when non-EUR sales convert into a EUR balance (unpublished)? If either answer is bad, Polar Pro becomes the better deal from roughly 550 monthly subscribers.

## Fees

### List rates

| Item | Paddle | Polar Starter (new org) | Polar Pro |
|---|---|---|---|
| Per transaction | 5% + $0.50 | 5% + $0.50 | 3.8% + $0.40 |
| Plan fee | none | none | $20/mo |
| Non-US card surcharge | none | +1.5% | +1.5% |
| Fee base | VAT-inclusive total | VAT-inclusive total | VAT-inclusive total |
| Chargeback | $/EUR 20, kept even if won | $15, any outcome | $15, any outcome |
| Refund | fee mostly retained | fee not refunded | fee not refunded |
| Payout cost | free for EUR to Eurozone bank; $15 SWIFT | $2/mo + 0.25% + $0.25 per payout + 0.25% EU FX | same as Starter |
| FX | up to 1.5% if payout currency differs from balance; unpublished margin converting sales into balance | 0.25% (EU) to 1% | same |

Sources: https://www.paddle.com/pricing, https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts, https://www.paddle.com/help/manage/risk-prevention/understanding-chargebacks-with-paddle, https://developer.paddle.com/build/reports/payout-reconciliation/, https://polar.sh/docs/merchant-of-record/fees, https://polar.sh/blog/introducing-polar-plans (2026-05-20).

Notes:
- Polar's Early Member rate (4% + $0.40, plus 0.5% on subscriptions) only exists for orgs created before 2026-05-27. A new Kimo org gets Starter (https://polar.sh/docs/merchant-of-record/fees).
- Paddle's refund fee retention comes from the developer changelog dated 2025-09-22 (**STALE**, 13 months): https://developer.paddle.com/changelog/2025/retained-fees-payout-totals/. Confirm with Paddle.
- Both charge on the VAT-inclusive total. Paddle's example: fee on a $120 total that includes $20 UK VAT (https://www.paddle.com/help/manage/reporting/how-are-my-earnings-calculated). Polar's example: fee on $37.50 that includes 25% Swedish VAT (https://polar.sh/docs/merchant-of-record/fees).

### Per transaction (no VAT, before payout and FX costs)

| Plan | Paddle | Polar Starter, US card | Polar Starter, non-US | Polar Pro, US | Polar Pro, non-US |
|---|---|---|---|---|---|
| $8/mo fee | $0.90 (11.25%) | $0.90 (11.25%) | $1.02 (12.75%) | $0.70 (8.8%) | $0.82 (10.3%) |
| $8/mo net | $7.10 | $7.10 | $6.98 | $7.30 | $7.18 |
| $80/yr fee | $4.50 (5.63%) | $4.50 (5.63%) | $5.70 (7.13%) | $3.44 (4.3%) | $4.64 (5.8%) |
| $80/yr net | $75.50 | $75.50 | $74.30 | $76.56 | $75.36 |

Polar Pro figures exclude the $20/mo plan fee.

With VAT, for an Estonian consumer (24%, $8 becomes $9.92 gross): Paddle about $1.00, Polar Starter about $1.14. On $80/yr ($99.20 gross): Paddle about $5.46, Polar Starter about $6.95. The VAT effect is the same for both, so the ranking does not change.

Yearly billing roughly halves the effective fee, because the fixed $0.50 dominates at $8. Push the yearly plan.

### At scale (no VAT)

| Scenario | Paddle net | Polar Starter net | Polar Pro net |
|---|---|---|---|
| 100 monthly subs ($800/mo) | $710/mo | $710 US / $698 non-US, about $692 after ~$6 payouts | $709.60 US / $697.60 non-US after the $20 plan, before payouts (Pro does not pay off) |
| 1000 monthly subs ($8,000/mo) | $7,100/mo | $7,100 US / $6,980 non-US, minus ~$37 payouts | about $7,239 US / $7,119 non-US after ~$37 payouts |
| 100 yearly subs ($8,000/yr) | $7,550/yr | $7,550 US / $7,430 non-US, before payouts | $7,416 US / $7,296 non-US (Pro does not pay off) |
| 1000 yearly subs ($80,000/yr) | $75,500/yr | $75,500 US / $74,300 non-US, minus ~$400+ payouts | $76,320 US / $75,120 non-US, minus ~$400+ payouts |

Breakeven points for Kimo's $8 order size (computed, not from Polar's blog, which assumes a $40 average order):
- Polar Pro beats Polar Starter from about 102 monthly subscribers. For yearly subscribers it is about 226.
- Polar Pro on mostly non-US cards beats Paddle's list price from about **556 monthly subscribers**, once Polar's payout fees are counted. Below that, Paddle wins.
- On yearly billing at 1000 subs, Paddle still wins by about $800/yr after Polar payout fees.

Caveat: Paddle's unpublished margin on converting USD (and other non-EUR) sales into a EUR balance is not in these numbers. It could narrow Paddle's lead. Pricing in EUR and local currencies reduces it.

## DX

| Area | Paddle | Polar |
|---|---|---|
| TS SDK | @paddle/paddle-node-sdk 3.10.0 (2026-08-07), zero deps, engines node>=20 (docs say 18) | @polar-sh/sdk 1.0.2 (2026-10-02), zero deps, engines node>=22, API version as import subpath |
| Bun | Not documented. Webhook helpers passed a local test on Bun 1.3.5. Re-run on Bun 1.3.14 | Same |
| Local webhooks | No listen or trigger command in the CLI (https://developer.paddle.com/sdks/cli.md). Needs a tunnel or the dashboard simulator | `polar webhook listen` and `polar webhook trigger`, no tunnel (https://polar.sh/docs/integrate/cli/webhooks.md), CLI 3.0.0 (2026-10-16) |
| Webhook delivery | 200 within 5 s. Live: 60 retries over ~2 days. Sandbox: 3 tries in ~2 min (https://developer.paddle.com/webhooks/respond-to-webhooks) | 2xx, 10 s timeout (aim for 2 s). 10 retries. Endpoint disabled after 10 straight failures (https://polar.sh/docs/integrate/webhooks/delivery.md) |
| Signatures | SDK helper | Standard Webhooks for secrets from 2026-09-08. SDK checks both formats |
| Entitlements | None native. Build from webhooks into Kimo's DB | Customer State API and customer.state_changed webhook (https://polar.sh/docs/integrate/customer-state.md) |
| Checkout | Paddle.js overlay or inline. Live needs website approval and a default payment link | Checkout links, sessions, or embed via @polar-sh/checkout (https://polar.sh/docs/features/checkout/embed.md) |
| Tauri desktop | Use system browser plus deep link. In-webview checkout untested | Same. Embed might work, untested |
| Customer portal | Expiring portal sessions with cancel and update-payment links | Email OTP portal or pre-authenticated sessions |
| Rate limits | 240/min per IP, 60 s block after 429. Shared egress IP counts once (https://developer.paddle.com/api-reference/about/rate-limiting) | 500/min prod, 100/min sandbox, per org or customer (https://polar.sh/docs/api-reference/introduction.md) |
| Sandbox | Separate account and keys. Catalog and webhooks recreated for live | Separate org at sandbox.polar.sh. Products and webhooks recreated for live |
| Versioning | Paddle-Version header, major only. SDK semver | Quarterly versions, each lives ~9 months, then 404. SDK path and every webhook endpoint's api_version need bumps about every 6 months (https://polar.sh/docs/api-reference/2026-10/versioning) |
| Better Auth | No plugin | @polar-sh/better-auth 2.1.0. Needs node>=24 engines and @polar-sh/sdk ^1.0.2 (docs pin 1.0.0). Does not authorize billing calls for you (https://makerkit.dev/blog/saas/polar-vs-stripe, 2026-05-18) |
| Go-live friction | Domain review, public pricing, Terms/Refund/Privacy pages, refund approval in live | No documented domain approval. First payout review up to 14 days |

Verdict: Polar has the better DX, mainly local webhook testing and built-in entitlements. Paddle's gaps are easy to cover for Kimo. Keep subscription state in kimo-cloud's own DB from webhooks, and use a tunnel for local testing. Polar's 6-monthly version bumps are a real recurring cost.

## MoR and EU (Estonian OU specifics)

Both are full MoR. Both collect and remit EU OSS VAT, UK VAT and US sales tax. Both handle B2B reverse charge with a VAT ID at checkout.

| Topic | Paddle | Polar |
|---|---|---|
| Contracting entity | Paddle.com Market Ltd (England and Wales) for non-UK suppliers (https://www.paddle.com/legal/terms, updated 2026-10-06) | Polar Software, Inc. (US, Delaware law) (https://polar.sh/legal/terms, updated 2026-03-25) |
| EU VAT | 27 EU states via OSS, B2C. Estonia listed at 24%. Page last updated 2025-08-01, **STALE** (https://www.paddle.com/help/sell/tax/which-countries-does-paddle-charge-sales-tax-or-vat-for) | Irish OSS registration, VAT number EU372061545. Some accounting tools reject the EU prefix (https://polar.sh/docs/merchant-of-record/introduction) |
| B2B VAT ID | At checkout. Can be added later once per transaction via the revise API (https://developer.paddle.com/api-reference/transactions/revise-transaction/) | "Purchasing as a business" checkbox since 2025-05-22. Reverse charge shown as a notice since 2026-10-21 (https://polar.sh/docs/changelog/recent) |
| VAT ID validation method | Not documented | Not documented |
| Invoicing Kimo to the MoR | Paddle self-bills a reverse invoice per payout, automatically (https://www.paddle.com/help/manage/get-paid/do-i-need-to-invoice-paddle-for-my-payout) | Kimo generates reverse invoices in Finance > Payouts. Not editable after generation (https://polar.sh/docs/features/finance/payouts) |
| Payout schedule | Monthly. Created on the 1st if above threshold, sent by the 15th (https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid) | Manual. Batched 24 h after request, 4 to 7 business days. 7-day settlement delay for new orgs |
| Payout minimum | EUR 100 (adjustable) | $13 equivalent for EUR |
| Payout rail | Wire or Payoneer. SEPA not named. EUR to Eurozone bank is free | Stripe. Estonia supported (https://polar.sh/docs/merchant-of-record/supported-countries) |
| Estonia supported | Yes. Not on the restricted list (https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle) | Yes for payouts. Estonia is absent from Polar's separate "Payments" list, likely Stripe-side only. Confirm |
| Verification | Domain review (5 to 7 business days if manual), business docs from the Estonian registry, ownership breakdown, owner ID (https://www.paddle.com/help/start/account-verification) | Business details, owner KYC, Stripe payout account. Review up to 14 days (https://polar.sh/docs/merchant-of-record/account-reviews) |

Estonian specifics:
- Keep the Paddle balance and payout currency both in EUR. That avoids the up-to-1.5% payout margin.
- Saudade Media's supplies to the MoR are B2B services to a UK company (Paddle) or a US company (Polar). How these go on the KMD and VIES returns needs the accountant. Paddle's reverse-invoice page does not name the billed entity.
- Paddle's domain review needs a live HTTPS site with product description, pricing, features, and Terms, Refund and Privacy pages in the navigation. The Terms must name Saudade Media OU and state that Paddle is the merchant of record (https://www.paddle.com/seller-guides/seller-handbook). The kimo-site repo needs these before go-live.

## Risk

| Risk | Paddle | Polar |
|---|---|---|
| AUP fit | SaaS fine. "VPN and Proxies" is restricted (AUP updated 2026-04-13, https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle) | SaaS listed as acceptable. "VPN, VPS & VDS" restricted (AUP effective 2026-10-01, https://polar.sh/legal/acceptable-use-policy) |
| Ongoing reviews | Periodic reviews. One freeze anecdote (2025-08-10, **STALE**, https://news.ycombinator.com/item?id=44857687). One immediate closure (2026-09-01, https://ankimcp.ai/blog/paddle-account-closure/) | Continuous reviews at hidden thresholds. Trustpilot 1.8/5 from 23 reviews, with 2026 offboarding and hold reports, mostly AI products (https://www.trustpilot.com/review/polar.sh) |
| Terms changes | 30 days' notice for existing suppliers | Effective immediately |
| Held funds after exit | Up to 6 months | Up to 9 months. Up to 120-day holds for risky sellers |
| Disputes forum | English courts | Delaware JAMS arbitration. Opt out by email within 30 days of signing up |
| Chargeback threshold | Fee kept even when won | Target 0.4% or less |
| Support | Reports of AI-only support and slow human contact (~2026-07-25, https://news.ycombinator.com/item?id=49033604) | Mixed. Quick on Discord per one user (2025-10-14, **STALE** borderline). Unanswered tickets on Trustpilot |
| Company | Founded 2012. ~$293M raised (aggregators, low confidence). FTC settlement $5M, 2025-06-16, **STALE** (https://www.ftc.gov/news-events/news/press-releases/2025/06/paddle-will-pay-5-million-settle-ftc-allegations-unfair-payment-processing-practices-facilitation) | $10M seed, 2025-06-17, **STALE**. No later round on the blog. Pricing changed 2026-05. Strategy refocus 2026-10-08 (https://polar.sh/blog) |
| Leaving | Card vault transfer within 2 weeks, no fee (https://www.paddle.com/seller-guides/subscription-migration) | Customers and cards exportable, no fee. Subscriptions must be recreated. 120-day payout pause (https://polar.sh/docs/migrate-away) |

Mitigations, for either provider:
- Describe Kimo Cloud as "collaborative design software with real-time sync". Avoid "relay", "proxy", "VPN", "VPS" and "hosting" in onboarding and on the site.
- Show renewal terms clearly at checkout and offer one-click cancel. The FTC order pushes Paddle to enforce this.
- Keep owners, entitlements and subscription state in kimo-cloud's DB. Store provider IDs only as foreign keys. Keep magic-link identity independent of the MoR. A switch is then plans plus a card vault transfer.
- Do not use Polar license keys in the desktop app. Kimo's account-based plan avoids the license phone-home privacy complaint (https://news.ycombinator.com/item?id=50000274).
- If kimo-cloud sits behind Cloudflare, allowlist the webhook path. Bot protection blocked Polar webhooks for one user.

## What would change the answer

- **Paddle quotes a worse rate for the under-$10 plan**, or a minimum fee. Then Polar Starter is level and Polar Pro wins from ~100 monthly subs.
- **Paddle's FX margin on USD-to-EUR balance conversion is large** (for example 2% or more) and many buyers pay in USD. That could cancel Paddle's lead. Price in EUR to limit it.
- **Saudade Media already has a Polar org created before 2026-05-27.** Early Member is 4.5% + $0.40 on subscriptions (6% with non-US cards), $0.88 per $8 sale. That is level with Paddle before payout fees.
- **Growth past ~550 monthly subs** on monthly billing makes Polar Pro cheaper at list price.
- **Paddle rejects the domain or the product**, or reviewers read the product as a relay or proxy. Polar is the fallback.
- **DX weighs more than ~$10 to $20/mo at launch.** If shipping speed this month is the priority, Polar's CLI and Customer State API save real time.

## Open questions for the owner

1. Does Saudade Media have any Polar org created before 2026-05-27?
2. Will the $8 and $80 prices be tax-inclusive or tax-exclusive? Inclusive means Kimo receives $8/(1+VAT) before fees.
3. Which currencies do you want to price in: USD only, EUR only, or local currencies?
4. Expected split of monthly vs yearly, and US vs non-US buyers, in year one?
5. Is the kimo-site ready for Paddle's domain review (pricing page, Terms naming Saudade Media OU and Paddle as MoR, Refund and Privacy pages)?
6. Will kimo-cloud use Better Auth? This decides whether the Polar plugin matters.
7. Is kimo-cloud deployed on Bun only, or ever on Node? This decides whether the SDK engines fields matter.
8. Can your accountant confirm KMD and VIES treatment of supplies to Paddle.com Market Ltd (UK) vs Polar Software, Inc. (US)?
9. Should we book a Paddle sales call to ask for the under-$10 rate, the sales FX margin, and whether EUR payouts go over SEPA or SWIFT?
10. Do you want a backup MoR partly integrated from day one? Freeze anecdotes on both sides suggest it.
