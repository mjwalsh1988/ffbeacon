# Beacon Store: one-time purchases, and the Personal Team Review as its first product

Status: BUILT 2026-10-30, revision 2 of the plan, and reviewed a second time the
same day; see section 22. Migrations 0343 to 0356. Task prefix in progress.md: CM-T###.
Price change after the build: the Basic Review is $4.95 (migration 0356, the
owner's call on 2026-10-30), not the $9.95 this document was written with. The
Premium Review stays $19.95. Prices live in the products row, so no copy changed.
Companion review page for the owner (sales and plain-language walkthrough with
screen mockups) was published as a Claude artifact on the same day and revised
with this document; this document is the build source, the artifact is not.

Revision 2 added, at the owner's direction: the open Stripe session is expired
before a replacement or a method switch (6.2), a duplicate payment is recorded
and reported instead of forgotten (6.3), the webhook checks the amount (6.3),
partial refunds have a column (5.3), chargebacks are handled (6.8), a Stripe
refund can be recorded by hand (6.7), pending-payment orders count toward
capacity and Stripe sessions expire in an hour (3.10, 6.2), the form posts
the price it displayed (6.1), the receipt email has a status and a retry
(8.1), every webhook event is recorded once (5.10), internal notes moved out
of the orders row (5.4), attachments upload straight to Storage (9.8), the
seller is named on the receipt (8), all sales are final with case by case
refunds (3.9, 20.1), a customer can cancel an order that has not been paid
(9.5), coupons and complimentary orders (3.14, 5.9, 6.9, 10.5, 10.6), the
"already in progress" notice (9.3), and a customer lookup that does not page
the whole user list (5.11, 10.1).

This document is written so that a fresh Claude Code session can build the
feature end to end without making a product decision. Every table, column,
status word, route, action, email, copy string, class pattern and task is
spelled out. Section 18 records the owner's open questions WITH the default the
builder uses when a question has not been answered; the builder never stops to
ask. Anything genuinely missing is built the way the nearest existing feature
does it and listed in the handoff, not asked.

Read CLAUDE.md first. Every absolute rule there applies: one shell command per
tool call, no typographic punctuation anywhere (ASCII only, write banned
characters as JavaScript escapes), American English, no DPC branding, no em
dashes, Eastern time on every timestamp, the Source and Format Sync rule inside
league views (resolveLeagueContext), defenders never priced, mobile first with
nothing hidden, nothing visible aria-hidden, 44px tap targets, every table
migration ships its RLS in the same file, regenerate database types after
every schema change, and the gate (typecheck, lint, test, build) before any
task is called complete.

Contents

1. What this is
2. What exists today (reuse, never rebuild)
3. Decisions already made
4. Names, URLs, navigation
5. Storage: migrations 0343 to 0352
6. Payment flows: Stripe, PayPal, Venmo, verification, refunds, disputes, coupons
7. The order state machine
8. Email catalog
9. Customer surfaces
10. Admin surfaces
11. Design specification
12. Accessibility
13. Security
14. Settings
15. Cron: order maintenance
16. Module map
17. Testing
18. Owner questions and the defaults the builder uses
19. Copy, glossary and banned words
20. Legal pages and environment setup
21. Build order (atomic tasks) and sub-agent reviews
22. What shipped differently

---------------------------------------------------------------------------

## 1. What this is

Two deliverables that ship together.

1.1 Beacon Store. A small commerce layer for one-time purchases: a products
table an admin edits (name, tagline, features, price, turnaround, where it is
offered), an orders ledger with a payment state and a fulfillment state, a
timeline of everything that happened to an order, outbound messages the
customer can read back, deliverables the admin writes and publishes, an admin
panel to run all of it, and a customer portal in My Beacon to see all of it.
Payment runs through the three routes the donation feature already offers:
Stripe hosted Checkout (card, Apple Pay, Google Pay, Link), PayPal, and Venmo.
Stripe payments are verified automatically by webhook and by a read-back on
the order page. PayPal and Venmo have no verification API in the form this site
uses them (plain paypal.me and venmo.com links to a personal handle), so those
orders carry the order number in the payment note and the admin confirms the
money arrived with one button. Nothing in the store is specific to the first
product: a second product is a row in `products`, not a code change.

1.2 Personal Team Review. The first product family, sold in two tiers inside
League Pulse. Basic Review ($9.95): a short written read of one roster, two or
three trade suggestions, and a direction (contend, rebuild, or hold). Premium
Review ($19.95): the full write-up: direction and reasoning, a position by
position read, buy and sell calls with names, trade shapes, a lineup note for
the week, draft capital, and one follow-up question by email. Both are written
by Michael, by hand, against the team's Blueprint and the league's own
numbers, and delivered into the customer's My Beacon portal within a stated
number of days. The Blueprint stays free; the review is the paid thing on top
of it.

The upgrade is offered in exactly three places: a section at the foot of the
Team Blueprint sheet, a strip on the league overview under the Blueprint call
to action, and a tile on the My Beacon dashboard. No other tool renders a
purchase control in this build (owner's instruction), but the `placements`
column on `products` is how one will when wanted.

---------------------------------------------------------------------------

## 2. What exists today (reuse, never rebuild)

Everything below was verified on 2026-10-30. Paths are relative to the repo
root. The builder reads each of these before writing a module that touches the
same question.

2.1 Stripe

- lib/donate/stripe.ts: REST over fetch, no SDK. Private `stripeRequest`,
  `encodeForm`, `secretKey` (shape-checked), `versionHeader`; exported
  `createDonationCheckout`, `retrieveCheckoutSession`, `isCheckoutSessionId`,
  `stripeConfigured`, types `StripeResult`, `CheckoutSession`. Omits
  `payment_method_types` on purpose (automatic payment methods). Section 16
  moves the generic half into lib/stripe/client.ts and leaves the donation
  half where it is; the four existing import sites keep working through
  re-exports. lib/stripe/client.ts gains one new call this build needs,
  `expireCheckoutSession(sessionId)` (POST /v1/checkout/sessions/{id}/expire),
  because a replacement session must never leave the old one payable (6.2).
- lib/user-identity.ts: `deriveDisplayName` (the display-name hierarchy) and
  `resolveUserIdentities`. The admin order list uses `deriveDisplayName` with
  the email and metadata the lookup RPC in 5.11 returns, so the name shown on
  an order matches the name shown everywhere else in My Beacon. The existing
  admin overview pages the whole Auth user list (app/admin/page.tsx around
  line 121); the orders pages must NOT copy that, see 10.1.
- lib/supabase/client.ts: the browser client (publishable key). The attachment
  uploader uses it for `storage.from(bucket).uploadToSignedUrl(path, token,
  file)`, which is authorized by the token alone and needs no storage policy.
- lib/donate/webhook-signature.ts: `verifyStripeSignature` and
  `signPayloadForTest`. Pure. Reused as is.
- lib/donate/redact.ts: `redactStripeEvent`, the allow-listed projection of a
  Checkout event. Pure. Reused as is for `orders.metadata`.
- lib/donate/outcome.ts: `donationOutcome` maps a session to paid, pending,
  unknown. The order reconcile step reuses the same mapping through a thin
  alias (section 6.4).
- lib/donate/return-path.ts: open redirect guard. Not needed here: every order
  redirect target is built from the order id on our own origin.
- lib/donate/links.ts: `PAY_HANDLE` ("mjwalsh1988"), `PAY_HANDLE_DISPLAY`,
  `paypalUrl(cents)`, `venmoUrl(cents)` (note fixed to "FF Beacon donation").
  lib/commerce/pay-links.ts builds the order versions with the order number in
  the note, importing `PAY_HANDLE` and `centsToDecimalString`.
- lib/donate/amounts.ts: `formatUsd(cents)`, `centsToDecimalString(cents)`.
  Reused.
- app/api/donate/checkout/route.ts: the defense order (same-origin, config,
  shape, rate limit claimed last, then the Stripe call) and the
  checkout.stripe.com host check. The order checkout action copies both.
- app/api/donate/webhook/route.ts: raw body first, verify, filter events, paid
  or nothing, idempotent row, claim, send, record. The orders webhook copies
  the structure. ONE CHANGE TO THIS FILE is required (section 6.5): it must
  ignore a session whose `metadata.product` is not `ffbeacon_donation`, or
  every order payment would also be recorded as a donation and receive the
  donation receipt.
- docs/completed/donations/donations.md: the Stripe Dashboard steps and the
  test/live signing secret trap. Section 20 adds the second endpoint.
- Environment: STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY exist
  in .env.local; STRIPE_WEBHOOK_SECRET is in .env.local.example and must be in
  Vercel for donations to receipt; STRIPE_ORDERS_WEBHOOK_SECRET is new
  (section 20).

2.2 Email

- lib/email/send.ts: `sendEmail({to, subject, html, text, replyTo?})`. From is
  `FFBeacon.com <signal@ffbeacon.com>` (EMAIL_FROM), Reply-To DEFAULTS to
  `michael@ffbeacon.com` (EMAIL_REPLY_TO) whenever `replyTo` is undefined.
  Never throws. The owner's requirement that every outbound email carry that
  reply-to is therefore ALREADY the default; this build adds a guard test
  (section 17) so no new builder can pass `replyTo: null` or another address
  on a customer-facing message. The three existing routes that override it
  (app/api/beam/learn, app/api/guide/submit, app/api/on-the-clock/report-format)
  send ADMIN NOTIFICATIONS to michael@ffbeacon.com with the submitter as
  reply-to, so a reply from Michael reaches the submitter. Section 18 Q2.
- lib/email/layout.ts: `buildBrandedEmail`, `emailHeading`, `emailSubheading`,
  `emailParagraph`, `emailQuoteCard`, `emailButton`, `emailStepList`, `esc`,
  `EMAIL_SITE_URL`. Light shell, Gmail safe. Every order email is built from
  these and nothing else.
- lib/email/donation-emails.ts: the shape every builder follows (a pure
  `buildXEmail` returning subject, html, text, plus a `sendX` wrapper).
- `after()` from next/server is how a route sends email without blocking the
  response (app/api/guide/submit/route.ts line 169). Server actions use the
  same.
- ADMIN_NOTIFICATION_EMAIL (env, default michael@ffbeacon.com) is read as a
  module constant in three routes. lib/commerce/notify.ts reads it once.

2.3 Auth, admin, rate limits, settings

- lib/supabase/server.ts: `createClient` (session, cached per request),
  `createAdminClient` (service role, cached). lib/supabase/admin.ts re-exports
  the admin client behind server-only.
- lib/admin-auth.ts: `requireAdmin(nextPath)` returns `{ userId }`;
  `getIsAdmin`.
- lib/http-origin.ts: `isSameOrigin(req)` for state-changing route handlers.
  Server actions are protected by Next's own origin check and do not call it.
- lib/rate-limit-claim.ts: `claimRateLimitSlot({bucket, max, windowSeconds})`,
  fails closed, actor derived from session or hashed IP.
- Settings pattern: supabase/migrations/0123_signal_scout_settings.sql (single
  row, id = 'global', jsonb, service role only), lib/league-blueprint/settings.ts
  (zod schema with defaults, `memoTtl`, `bustMemo`, load/save/validate),
  app/admin/league-blueprint/actions.ts (requireAdmin, validate, save,
  bustMemo, revalidatePath), components/admin/settings-form-kit.tsx
  (`NumberField`, `CheckboxField`, `SettingsSection`, `SettingsSaveBar`,
  `settingsInputCls`).
- lib/nav-tree.ts: the Admin section's children (around line 360) are where
  /admin/orders is registered. My Beacon children are in the same file.
- components/admin/pager.tsx `Pager`, components/admin/view-tabs.tsx
  `ViewTabs`, components/admin/signal-check-subnav.tsx (the subnav shape).

2.4 League Pulse context

- lib/league-pulse.ts `pulseLeagueCore`, `LEAGUE_CORE_COLUMNS` (id,
  sleeper_league_id, name, season, status, total_rosters, ...).
- lib/power-pulse/load.ts `loadRosters(admin, leagueRowId)` returns
  sleeperRosterId, id, teamName, ownerHandle, wins, losses, ties.
- lib/league-viewer.ts `matchViewerRoster`, lib/league-positional-war-data.ts
  `loadViewerCandidates`, lib/sleeper-handle/resolve.ts `resolveSleeperViewer`
  and `loadSavedSleeperHandle`.
- lib/league-format-resolution.ts `resolveLeagueContext` (format from the
  league, source from the reader).
- lib/league-blueprint/cache.ts `readCachedBlueprint`, the stored
  `BlueprintView` (lib/league-blueprint/types.ts): header.teamName,
  header.ownerHandle, header.record, header.formatDisplay,
  header.sourceDisplay, standing.overall, standing.status.label. The order
  stores a snapshot of this view (section 5.3) so Michael reviews what the
  customer saw.
- app/leagues/[league_id]/blueprint/page.tsx: `getSyncedLeague`,
  `rosterParam`, `loadTeams`, and the Suspense layout the checkout page copies.
- components/league-shell (LeagueShell, LEAGUE_NAV_ITEMS, `leagueTabHref`).
- components/league-blueprint/sheet.tsx: `Sheet`, `SheetSection`, `Leader`,
  `RULED`, `Bar`. components/league-blueprint/letterhead.tsx `GradeBox` is the
  model for the price box.
- components/league-blueprint/blueprint-cta.tsx: the overview call to action
  the review strip sits under.
- components/dashboard-panel.tsx `Panel`, components/link-tile.tsx `LinkTile`
  (My Beacon tiles), app/my-beacon/page.tsx `YOURS` list.

2.5 Cron and observability

- lib/cron-auth.ts `verifyCronRequest`, lib/cron-runs.ts `CRON_JOBS` and
  `recordCronRun`, vercel.json crons, app/api/cron/league-maintenance/route.ts
  as the template for a bounded hourly job.

2.6 Storage

- supabase/migrations/0060_signal_media_bucket.sql: bucket creation and
  storage.objects policies. The order files bucket is PRIVATE with no client
  policies (section 5.7).

2.7 Analytics

- lib/analytics.ts `trackEvent` and the `AnalyticsEvent` union. Four events
  are added (section 9.7).

---------------------------------------------------------------------------

## 3. Decisions already made

These are the owner's requirements turned into rules, plus the product calls
the builder would otherwise have to make. Section 18 lists the few the owner
may still change, each with the default used here.

3.1 An account is required to buy. The deliverable is written into the
customer's My Beacon portal, the order history lives there, and a reply from
Michael must reach the person who paid. A signed-out reader sees the two
tiers, the price, the feature list and a "Sign in to order" link that returns
to the checkout page. No guest checkout, no email-only orders.

3.2 Money is held in cents everywhere past the admin's price field.
`products.price_cents` is the live price; `orders.amount_cents` and
`orders.product_snapshot` freeze what was sold at the moment of the order, so
changing a price never changes a past receipt.

3.3 Stripe is verified automatically; PayPal and Venmo are confirmed by hand.
Stripe hosted Checkout, metadata.product = `ffbeacon_order`, a second webhook
endpoint with its own signing secret, plus a read-back of the session on the
order page when the webhook has not landed yet. PayPal and Venmo orders carry
the order number in the payment note, the customer presses "I sent it", the
admin presses "Confirm payment". A reported payment is never auto-confirmed.
An unreported manual order expires after 7 days with one reminder on day 3.

3.4 Reply-To is michael@ffbeacon.com on every customer-facing email. That is
the existing default in lib/email/send.ts; this build never passes `replyTo`
on a customer message, and a test holds that line. Admin notification emails
(to Michael) set reply-to to the customer's address so a reply reaches them.

3.5 The customer's identity is the account, never a copy. `orders.user_id`
references auth.users. Name and email are read from Auth at render and send
time and are not duplicated into the orders table. `orders.metadata` holds the
allow-listed Stripe projection (lib/donate/redact.ts) and nothing about the
card or the billing address, the same exception to the raw-object rule that
migration 0270 documents.

3.6 One product system. Products are rows. `products.placements` names the
surfaces that may offer a product; only `blueprint`, `league-overview` and
`my-beacon` are rendered in this build. Adding a product is an admin form;
adding a placement is a code change that renders one more `ProductOffer`.

3.7 The deliverable lives in the portal. The delivery email carries the first
section and a link; the full write-up is read on
/my-beacon/orders/[id], so a correction Michael makes after delivery is what
the customer sees. Attachments (a PDF, an image) are allowed through a private
bucket and signed URLs.

3.8 Order numbers are `FFB-100001` upward, from a sequence, shown everywhere
a customer or admin names an order, and put in the PayPal and Venmo note.
UUIDs stay in URLs.

3.9 All sales are final, and refunds are a case by case courtesy. The Terms
(20.1), the receipt (E1, E3) and the order page's Help section all say the
same thing in the same words: "All sales are final. Michael considers refund
requests case by case and will usually refund an order he has not started on
yet." No surface promises a refund, no button requests one; a customer writes
to michael@ffbeacon.com and quotes the order number. Refunds are performed in
the processor (Stripe Dashboard, PayPal, Venmo) and RECORDED here. The Stripe
`charge.refunded` event records itself AND the admin can record a Stripe
refund by hand when the webhook missed it (6.7); a PayPal or Venmo refund is
recorded by the admin with one button. Partial refunds are recorded in
`orders.refunded_cents`; an order is `refunded` only when the total refunded
reaches the amount paid. The system never moves money out. A customer CAN
cancel an order of their own that has not been paid (9.5), because no money is
involved.

3.10 Capacity is a setting. `storefront.maxOpenOrders` (default 10). The count
that is compared to it is `countOpenOrders` (lib/commerce/orders.ts): orders
with fulfillment_status in ('queued','in_progress') PLUS, when
`storefront.countPendingPayment` is true (default), orders with payment_status
in ('unpaid','awaiting_confirmation') whose `expires_at` is in the future. The
pending ones count because a Stripe payment cannot be refused after the fact:
an order gated only at payment time would let any number of unpaid orders be
created and all be paid later. When the count reaches the cap, or the admin
flips `storefront.fullyBooked`, every offer renders its "Fully booked" state
and the checkout action refuses. The check is a count followed by an insert
and is not atomic; two orders placed in the same second can take the count one
past the cap, which is accepted and stated here rather than solved with a
lock. A one-person service needs a door it can close. Complimentary orders
count like any other order once queued.

3.11 Turnaround is a product field. `products.turnaround_days` (Basic 3,
Premium 5). The offer says "Delivered within N days of payment", the order
gets `due_at = paid_at + N days`, and the admin queue shows due and overdue.

3.12 Intake is fixed in code for the `team-review` form (section 9.3). The
admin edits product names, prices and features, not the questions.

3.13 Duplicate guard, and the "already in progress" notice. One UNPAID (unpaid
or awaiting confirmation) order per (user, product, league, roster) at a time:
a repeat press returns the existing unpaid order's page rather than making a
second one, because two unpaid orders for the same thing is clutter and the
customer can pay the first. A PAID review for the same team never blocks a new
order: a customer who has made a run of moves may want a second read. The
checkout page shows a notice naming the review in progress (9.3) and the form
still submits.

3.14 Coupons and complimentary orders are in this build; bundles,
subscriptions and sales tax collection are not. A coupon is a row in
`coupons` (5.9) an admin creates: a code, a percent or a fixed amount off, an
optional product family, a redemption cap, a per-customer cap, a window. A
customer types it on the checkout page; the server prices the order. A coupon
that takes the total to zero makes a COMPLIMENTARY order: no payment step, paid
at once through `try_mark_order_paid` with `paid_via = 'coupon'`. An admin can
also create a complimentary order directly for a customer from
`/admin/orders/new` (10.6), with no coupon involved, for a make-good or a
friend. Both paths record what the order would have cost (`list_price_cents`)
and what was taken off (`discount_cents`), so the revenue figures stay honest.

3.15 Test-mode payments are marked. `orders.livemode` is set from the Stripe
event; the admin list shows a "Test" chip on a false value and the revenue
figures exclude them. Complimentary and manual orders have a null `livemode`
and are counted.

3.17 Money correctness rules, each enforced in code and tested:
- The browser never names a price, but it DOES post the price it displayed
  (`expectedCents`), and the server refuses when its own computed total
  differs: a price edited while the page was open is never charged unseen.
- The webhook never marks an order paid when `session.amount_total` or
  `session.currency` differs from the order. A mismatch is recorded and
  reported, and the admin decides.
- Exactly one Stripe Checkout session is ever payable for an order. Before a
  replacement session is created, or the method is switched, the open one is
  expired at Stripe. A second payment that arrives anyway is recorded as a
  duplicate and reported, never silently dropped.
- Every webhook event is recorded by its Stripe event id before it is acted
  on, so a redelivery writes no second timeline row (5.10).
- A chargeback is handled (6.8): it puts the order in Needs attention, warns
  the admin before any delivery, and a lost dispute is recorded as money gone.
- The receipt email has a status on the order, a bounded retry in the cron,
  and a Resend button; "sent in the background" is never the only record.

3.16 Nothing here is a model. No numbers are computed about a team by this
feature. It stores what the Blueprint already computed, so the Blueprint's
rules (viewer independence, cache-only images, no engine on the warm path)
are not touched.

---------------------------------------------------------------------------

## 4. Names, URLs, navigation

4.1 Words on screen

- The system is never named to a customer. A customer sees "Personal Team
  Review", "Basic Review", "Premium Review", "your order", "Orders".
- Admin label: "Orders" in the Admin rail, with three sub-pages: Orders,
  Products, Settings.
- The person writing the review is "Michael" in customer copy, matching the
  byline voice (lib/site.ts author.name).

4.2 Routes

Customer:
- `/leagues/[league_id]/review?roster=N&tier=basic|premium`: the checkout
  page, inside the league shell, active tab `blueprint`. Not in
  LEAGUE_NAV_ITEMS (reached from the offers). `tier` preselects a product by
  slug suffix; absent or unknown means Basic preselected.
- `/my-beacon/orders`: the customer's order list.
- `/my-beacon/orders/[order_id]`: one order: receipt, progress, payment
  instructions while unpaid, messages, the delivered review.

Admin:
- `/admin/orders`: queue and figures.
- `/admin/orders/new`: create a complimentary order for a customer (10.6).
- `/admin/orders/[order_id]`: one order. (`new`, `products`, `coupons` and
  `settings` are matched as static segments before the dynamic one by Next's
  router, so no collision.)
- `/admin/orders/products`: the product list and editor.
- `/admin/orders/coupons`: the coupon list and editor (10.5).
- `/admin/orders/settings`: storefront settings.

API:
- `POST /api/orders/webhook`: the Stripe endpoint for orders.
- `GET /api/orders/[order_id]/files/[deliverable_id]`: streams an attachment
  to its owner or an admin through a signed URL redirect (section 9.6).
- `GET /api/cron/order-maintenance`: hourly.

4.3 Navigation registrations

- lib/nav-tree.ts Admin children: insert `{ id: "/admin/orders", label:
  "Orders", href: "/admin/orders", hint: "Purchases, delivery and products",
  icon: "coins", alsoActiveUnder: ["/admin/orders/products",
  "/admin/orders/coupons", "/admin/orders/settings", "/admin/orders/new"] }`
  directly after the Team Blueprint entry. Icon "coins" exists (used by
  /admin/faab).
- lib/nav-tree.ts My Beacon children: insert `{ id: "/my-beacon/orders",
  label: "Orders", href: "/my-beacon/orders", hint: "Your reviews and
  receipts", icon: "receipt" }` after Rankings boards. If `receipt` is not in
  components/app-shell/nav-icons.ts, add it there from lucide `Receipt`.
- app/my-beacon/page.tsx YOURS: add `{ href: "/my-beacon/orders", title:
  "Orders", body: "Every review you have bought, its receipt, and where it
  is right now.", icon: Receipt, accent: "purple" }` as the last tile. The
  grid is `lg:grid-cols-3`; five tiles wrap to a 3 and 2 row, which is fine.
  The panel helper sentence "The three surfaces that hold something of yours."
  changes to "The surfaces that hold something of yours."

4.4 Redirects

None. No existing path moves.

---------------------------------------------------------------------------

## 5. Storage: migrations 0343 to 0352

Ten files, applied in order through MCP, saved to supabase/migrations/,
types regenerated after each. Every file begins with the access matrix
comment, as 0270 and 0341 do. Every table has RLS enabled and its policies in
the same file. Policy names follow `{table}_select_own`,
`{table}_select_public`, `{table}_service_role_all`. The verification
sequence in 5.12 applies to every table task.

RLS IS ROW LEVEL, NOT COLUMN LEVEL. A `select_own` policy hands the owner
EVERY column of the row through PostgREST, whatever the UI chooses to render.
So no customer-readable table in this section carries a column the customer
must not see: internal notes are `order_events` rows with
`visible_to_customer = false` (the events policy filters on that column), and
the orders row itself holds only facts about the customer's own order. Any
future column that is for the admin alone goes on a service-role-only table.

5.1 0343_commerce_settings.sql

Exactly the 0123 template with the table name `commerce_settings`:

```
create table if not exists public.commerce_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
```

RLS on, one policy `commerce_settings_service_role_all` for all to
service_role. Comment names lib/commerce/settings.ts as the code fallback and
/admin/orders/settings as the editor. Shape in section 14.

5.2 0344_products.sql

```
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  family text not null check (family ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(family) <= 60),
  tier_rank integer not null default 1 check (tier_rank between 1 and 9),
  name text not null check (length(name) between 1 and 60),
  tagline text check (length(tagline) <= 140),
  description text check (length(description) <= 2000),
  features jsonb not null default '[]'::jsonb,
  badge text check (length(badge) <= 24),
  price_cents integer not null check (price_cents between 100 and 100000),
  currency text not null default 'usd' check (currency = 'usd'),
  turnaround_days integer not null default 3 check (turnaround_days between 1 and 30),
  intake_form text not null default 'team-review' check (intake_form in ('team-review')),
  requires_league_context boolean not null default true,
  placements text[] not null default '{}'::text[]
    check (placements <@ array['blueprint','league-overview','my-beacon']::text[]),
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`features` is a JSON array of strings, each 1 to 120 characters; the zod
schema in lib/commerce/products.ts enforces it, the column does not. Index
`idx_products_active_order` on (is_active, display_order). RLS: policy
`products_select_public` for select to anon, authenticated using
(is_active = true); `products_service_role_all`. Admin pages read every row
through the service role client.

Seed, in the same file, with `on conflict (slug) do nothing`:

```
insert into public.products
  (slug, family, tier_rank, name, tagline, description, features, badge,
   price_cents, turnaround_days, placements, display_order)
values
  ('team-review-basic', 'team-review', 1, 'Basic Review',
   'A straight read of your team and two or three moves to make.',
   'Michael reads your roster against your league''s own numbers and your Team Blueprint, then writes you a short, plain review: where the team actually stands, the direction to take this season, and two or three trades worth offering, with the reasoning.',
   '["A written read of your roster, in plain words","The direction: contend, rebuild, or hold, and why","Two or three trade ideas with the reasoning","Delivered to your My Beacon portal within 3 days"]'::jsonb,
   null, 995, 3, array['blueprint','league-overview','my-beacon']::text[], 10),
  ('team-review-premium', 'team-review', 2, 'Premium Review',
   'The full write-up: every position, every call, and a plan for the rest of the season.',
   'Everything in the Basic Review, then the whole roster position by position, buy and sell calls by name, trade shapes to pursue and who in your league to call, a lineup note for the week, your draft capital, and one follow-up question by email after you have read it.',
   '["Everything in the Basic Review","Position by position: what is strong, thin, and aging","Buy, sell and hold calls by name","Trade shapes to pursue and the partners to call","A lineup note for this week and your draft capital","One follow-up question by email within 7 days","Delivered to your My Beacon portal within 5 days"]'::jsonb,
   'Most popular', 1995, 5, array['blueprint','league-overview','my-beacon']::text[], 20)
on conflict (slug) do nothing;
```

5.3 0345_orders.sql

```
create sequence if not exists public.orders_number_seq start with 100001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('FFB-' || nextval('public.orders_number_seq')::text),
  user_id uuid references auth.users(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  product_snapshot jsonb not null,
  origin text not null default 'customer' check (origin in ('customer','admin')),
  list_price_cents integer not null check (list_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0 and discount_cents <= list_price_cents),
  amount_cents integer not null check (amount_cents >= 0 and amount_cents = list_price_cents - discount_cents),
  currency text not null default 'usd' check (currency = 'usd'),
  payment_method text not null check (payment_method in ('stripe','paypal','venmo','complimentary')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','awaiting_confirmation','paid','expired','cancelled','refunded')),
  fulfillment_status text not null default 'pending_payment'
    check (fulfillment_status in ('pending_payment','queued','in_progress','delivered','cancelled')),
  stripe_session_id text unique,
  stripe_session_attempts integer not null default 0 check (stripe_session_attempts >= 0),
  stripe_session_expires_at timestamptz,
  stripe_payment_intent_id text,
  livemode boolean,
  external_payment_reference text check (length(external_payment_reference) <= 120),
  customer_reported_paid_at timestamptz,
  paid_at timestamptz,
  paid_via text check (paid_via in ('stripe-webhook','stripe-reconcile','manual','coupon','complimentary')),
  due_at timestamptz,
  started_at timestamptz,
  delivered_at timestamptz,
  expires_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  refunded_cents integer not null default 0 check (refunded_cents >= 0 and refunded_cents <= amount_cents),
  refunded_at timestamptz,
  refund_note text check (length(refund_note) <= 500),
  receipt_email_status text check (receipt_email_status in ('pending','sent','failed','skipped')),
  receipt_email_sent_at timestamptz,
  receipt_email_attempts integer not null default 0,
  receipt_email_error text check (length(receipt_email_error) <= 500),
  duplicate_payment_intent_id text,
  duplicate_resolved_at timestamptz,
  mismatch_amount_cents integer,
  dispute_id text,
  dispute_status text check (dispute_status in ('open','won','lost','warning_closed')),
  disputed_at timestamptz,
  context jsonb not null default '{}'::jsonb,
  intake jsonb not null default '{}'::jsonb,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

There is deliberately NO `admin_notes` column: the owner-select policy would
hand it to the customer through PostgREST (see the note under the section
heading). Internal notes are `order_events` rows with `visible_to_customer =
false` (5.4, 10.2).

Column notes:
- `origin` is `admin` for an order created from /admin/orders/new (10.6).
- `list_price_cents` is the product price at order time, `discount_cents`
  what a coupon or a complimentary grant took off, `amount_cents` what the
  customer owes. The check constraint keeps the three in agreement.
- `payment_method = 'complimentary'` is used when `amount_cents = 0`; such an
  order is paid in the same action that creates it and never shows a pay
  panel.
- `stripe_session_attempts` counts every Checkout session ever created for
  the order and is the `attempt` in the idempotency key (6.2).
  `stripe_session_expires_at` is Stripe's own expiry for the current session,
  so the cron and the pay panel agree with Stripe about when it dies.
- `refunded_cents` is the running total refunded, from `charge.amount_refunded`
  on the webhook or the amount the admin typed. `payment_status` becomes
  `refunded` only when it reaches `amount_cents`.
- `receipt_email_*`: the receipt (E1 or E3) is the one email whose absence
  costs real trust, so it has a status instead of only a timeline event.
  `try_mark_order_paid` sets `receipt_email_status = 'pending'`; the sender
  moves it to `sent`, `failed` (with the error) or `skipped` (Resend not
  configured). The cron retries `pending` and `failed` up to
  `emails.receiptRetryMax` times (8.1).
- `duplicate_payment_intent_id` is set when a second Stripe payment lands on
  an already-paid order (6.3); `duplicate_resolved_at` is stamped by the
  admin's "Mark duplicate refunded" button. `mismatch_amount_cents` holds the
  amount Stripe reported when it differed from `amount_cents`; cleared by the
  admin's decision (6.3).
- `dispute_*`: one open chargeback at a time per order, from the
  `charge.dispute.*` events (6.8).

`user_id` is nullable only so a deleted account leaves the financial record
behind; the application never inserts a null. Indexes:
`idx_orders_user_created` (user_id, created_at desc);
`idx_orders_payment_status` (payment_status) where payment_status in
('unpaid','awaiting_confirmation'); `idx_orders_fulfillment` (fulfillment_status,
due_at); `idx_orders_created` (created_at desc);
`idx_orders_payment_intent` (stripe_payment_intent_id) where not null;
`idx_orders_receipt_retry` (receipt_email_status) where receipt_email_status
in ('pending','failed'); `idx_orders_attention` (dispute_status) where
dispute_status = 'open'.

RLS: `orders_select_own` for select to authenticated using (auth.uid() =
user_id); `orders_service_role_all`. No insert, update or delete policy for
authenticated: every write goes through a server action with the service
role client after validation.

`product_snapshot` shape (written by lib/commerce/orders.ts `snapshotProduct`):

```
{ slug, family, tier_rank, name, tagline, features, price_cents,
  turnaround_days, intake_form }
```

`context` shape for intake_form `team-review`:

```
{
  sleeperLeagueId: string,
  leagueRowId: string (uuid),
  leagueName: string,
  season: string,
  totalRosters: number,
  rosterId: number,
  teamName: string,
  ownerHandle: string | null,
  formatSlug: string | null,
  formatDisplay: string,
  sourceSlug: string,
  sourceDisplay: string,
  blueprint: {
    generatedAt: string, overall: number, statusLabel: string | null,
    modelVersion: number, view: BlueprintView
  } | null,
  links: { blueprint: string, overview: string, lineups: string, tradeIdeas: string }
}
```

`links` are site-relative paths, stored so the admin page never rebuilds them.
`blueprint` is the whole stored view (under 40 KB by the Blueprint's own rule)
or null when no row was cached at order time; the page then says "No
Blueprint was built when this was ordered" and links to the live one.

`intake` shape for `team-review` (section 9.3):

```
{ direction: "contend" | "rebuild" | "unsure", questions: string,
  offLimits: string, contact: "email" }
```

The RPC that settles payment, in the same file:

```
create or replace function public.try_mark_order_paid(
  p_order_id uuid,
  p_paid_via text,
  p_reference text default null,
  p_paid_at timestamptz default now(),
  p_payment_intent_id text default null,
  p_livemode boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_won boolean := false;
begin
  select coalesce((product_snapshot->>'turnaround_days')::int, 3)
    into v_days from public.orders where id = p_order_id;

  update public.orders
     set payment_status = 'paid',
         fulfillment_status = 'queued',
         paid_at = p_paid_at,
         paid_via = p_paid_via,
         due_at = p_paid_at + make_interval(days => v_days),
         external_payment_reference = coalesce(p_reference, external_payment_reference),
         stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
         livemode = coalesce(p_livemode, livemode),
         expires_at = null,
         mismatch_amount_cents = null,
         receipt_email_status = 'pending',
         updated_at = now()
   where id = p_order_id
     and payment_status in ('unpaid','awaiting_confirmation','expired')
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;
revoke all on function public.try_mark_order_paid(uuid, text, text, timestamptz, text, boolean)
  from public, anon, authenticated;
grant execute on function public.try_mark_order_paid(uuid, text, text, timestamptz, text, boolean)
  to service_role;
```

True for exactly one caller: a webhook retry, the reconcile-on-view and a
manual confirm racing each other produce one `paid` transition and one
receipt. `expired` is included because a Stripe session that expired can
still be reported paid later by an async method, and an expired manual order
can be confirmed by the admin when the money turns up. The same function
settles a complimentary order (`p_paid_via = 'coupon'` or `'complimentary'`,
`p_paid_at = now()`), so every path to `paid` is one path.
`receipt_email_status = 'pending'` is set inside the same statement so a
process that dies after the flip and before the send leaves a row the cron
can see (8.1).

A trigger `orders_set_updated_at` (before update, sets updated_at = now())
using a shared function `public.set_updated_at()` created `or replace` in
this file.

5.4 0346_order_events.sql

```
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in (
    'created','payment_pending','payment_reported','payment_not_found','paid',
    'payment_expired','payment_cancelled','refunded','status_changed',
    'email_sent','note','delivered','delivery_updated',
    'duplicate_payment','payment_mismatch','dispute_opened','dispute_updated',
    'dispute_closed','coupon_applied','intake_updated','attachment_added')),
  actor text not null check (actor in ('system','admin','customer')),
  actor_user_id uuid references auth.users(id) on delete set null,
  visible_to_customer boolean not null default true,
  title text not null check (length(title) <= 160),
  body text check (length(body) <= 2000),
  data jsonb,
  created_at timestamptz not null default now()
);
```

Index `idx_order_events_order_created` (order_id, created_at). RLS:
`order_events_select_own` for select to authenticated using
(visible_to_customer and exists (select 1 from public.orders o where o.id =
order_id and o.user_id = auth.uid())); `order_events_service_role_all`.

`title` is the sentence the timeline shows ("Payment confirmed",
"Michael started your review"). `body` is the optional note. `data` holds
machine fields (from/to status, resend id). All server-written, rendered as
text.

Internal notes live here. `addInternalNoteAction` (10.2) inserts kind `note`,
actor `admin`, `visible_to_customer = false`, body = the note (max 5000). The
admin page's "Internal notes" panel lists exactly those rows. The customer's
events policy filters on `visible_to_customer`, so a note never reaches them
through the API or the page. The `dispute_*`, `duplicate_payment` and
`payment_mismatch` kinds are written with `visible_to_customer = false` too:
a chargeback is between the admin, Stripe and the card network, and a
duplicate payment is told to the customer by the refund email, not by a
timeline row.

5.5 0347_order_messages.sql

```
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  direction text not null default 'outbound' check (direction in ('outbound')),
  subject text not null check (length(subject) between 1 and 160),
  body_text text not null check (length(body_text) between 1 and 8000),
  sent_by uuid references auth.users(id) on delete set null,
  status text not null check (status in ('sent','failed','skipped')),
  resend_message_id text,
  error text,
  created_at timestamptz not null default now()
);
```

Index (order_id, created_at). RLS: `order_messages_select_own` (same exists
clause as events, no visibility flag: every message was sent to this
customer); `order_messages_service_role_all`. `direction` admits only
outbound today; an inbound value is a later migration.

5.6 0348_order_deliverables.sql

```
create table if not exists public.order_deliverables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('section','attachment')),
  title text not null check (length(title) between 1 and 120),
  body text check (length(body) <= 20000),
  storage_path text check (length(storage_path) <= 300),
  file_name text check (length(file_name) <= 160),
  file_size integer check (file_size >= 0),
  mime_type text check (length(mime_type) <= 100),
  sort_order integer not null default 100,
  status text not null default 'draft' check (status in ('draft','published')),
  upload_state text not null default 'ready' check (upload_state in ('pending','ready')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'section' and body is not null and storage_path is null)
      or (kind = 'attachment' and storage_path is not null)),
  check (kind = 'attachment' or upload_state = 'ready')
);
```

Index (order_id, sort_order). RLS: `order_deliverables_select_own` using
(status = 'published' and upload_state = 'ready' and exists (owner clause));
service role all. Trigger `order_deliverables_set_updated_at`.

`upload_state` exists because an attachment row is created BEFORE its bytes
exist (9.8): the admin's browser uploads straight to Storage with a signed
upload URL, and the row is `pending` until `finalizeAttachmentAction` has
confirmed the object is there. `publishAll` publishes only `ready` rows, and
the cron deletes `pending` rows older than 24 hours together with any object
at their path.

5.7 0349_order_files_bucket.sql

```
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 10485760,
  array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/markdown'])
on conflict (id) do nothing;
```

NO storage.objects policies for anon or authenticated. Uploads happen through
a signed upload URL minted by a server action with the service role client
(9.8); the token in that URL is the whole authorization, so no policy is
needed for the admin's browser to PUT the bytes. Reads go through
`/api/orders/[order_id]/files/[deliverable_id]`, which checks ownership (or
admin) and redirects to a 60-second signed URL. Object path:
`orders/{order_id}/{deliverable_id}/{sanitized file name}`.

5.9 0350_coupons.sql

```
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,24}$'),
  kind text not null check (kind in ('percent','amount')),
  percent_off integer check (percent_off between 1 and 100),
  amount_off_cents integer check (amount_off_cents between 1 and 100000),
  product_family text check (product_family ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  product_id uuid references public.products(id) on delete set null,
  max_redemptions integer check (max_redemptions >= 1),
  max_redemptions_per_user integer not null default 1 check (max_redemptions_per_user between 1 and 100),
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  note text check (length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'percent' and percent_off is not null and amount_off_cents is null)
      or (kind = 'amount' and amount_off_cents is not null and percent_off is null))
);

alter table public.orders
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_code text check (length(coupon_code) <= 24);
create index if not exists idx_orders_coupon on public.orders (coupon_id) where coupon_id is not null;
```

`code` is stored upper case; the validator upper-cases and trims what the
customer typed before the lookup. `coupon_code` on the order is a copy of the
code at order time so a receipt still names it after the coupon is deleted.
RLS: `coupons_service_role_all` only. Customers never read the table; the
checkout page previews a code through a server action (6.9).

Redemptions are COUNTED FROM ORDERS, not from a counter: a redemption is an
order with this `coupon_id` and payment_status in ('unpaid',
'awaiting_confirmation','paid','refunded'), so an abandoned order frees its
slot when the cron expires it. The per-user cap is the same count filtered on
`user_id`. The count then insert is not atomic; two customers racing the last
slot of a capped code can both get it, which is accepted and bounded by the
per-user cap. Trigger `coupons_set_updated_at`.

5.10 0351_payment_webhook_events.sql

```
create table if not exists public.payment_webhook_events (
  provider text not null check (provider in ('stripe')),
  event_id text not null check (length(event_id) <= 100),
  endpoint text not null check (endpoint in ('orders')),
  event_type text not null check (length(event_type) <= 80),
  livemode boolean,
  order_id uuid references public.orders(id) on delete set null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text check (length(outcome) <= 80),
  primary key (provider, event_id)
);
```

Index `idx_payment_webhook_events_received` (received_at). RLS:
`payment_webhook_events_service_role_all` only. This is the webhook's dedupe
ledger (6.3): the event is inserted FIRST, and a primary key conflict means
Stripe has delivered it before. `completed_at` is stamped when the route
answers 200 for a handled event; a conflicting row with a null `completed_at`
is an in-flight or crashed earlier delivery and is processed again, which is
the same reasoning the donation route applies to a stale claim. The cron
deletes rows past 90 days (15). The table is named for what it is (a ledger
of payment provider deliveries) and the provider is a column, per the naming
rules; only Stripe writes to it today.

5.11 0352_order_customer_lookup.sql

Two functions, both `security definer`, `set search_path = public, pg_temp`,
revoked from public, anon and authenticated and granted to service_role only,
exactly as `try_mark_order_paid` is. They exist so the admin order pages
never page the whole Auth user list (10.1).

```
create or replace function public.order_customer_identities(p_user_ids uuid[])
returns table (user_id uuid, email text, meta_display_name text, created_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select u.id, u.email::text,
         nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', '')), ''),
         u.created_at
  from auth.users u
  where u.id = any(p_user_ids)
$$;

create or replace function public.search_order_customers(p_query text, p_limit integer default 20)
returns table (user_id uuid, email text)
language sql security definer set search_path = public, pg_temp as $$
  select u.id, u.email::text
  from auth.users u
  where length(p_query) >= 2
    and u.email ilike '%' || replace(replace(p_query, '%', '\%'), '_', '\_') || '%'
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;
```

The caller (lib/commerce/customers.ts) passes the ids on the current page to
the first and the typed search to the second, then feeds `email`,
`meta_display_name` and the `user_preferences` first and last names into
`deriveDisplayName` from lib/user-identity.ts with surface `private` (the
admin sees the real email anyway). Verification for this task: as
`authenticated` with a real user's claims, `select
public.order_customer_identities(array[auth.uid()])` must be refused with a
permission error.

5.12 Verification sequence (every table task)

Apply via MCP; query pg_policies for the table; in one
`begin ... rollback` execute_sql, `set local role anon` then select (expect
zero rows or only active products), `set local role authenticated` with
`request.jwt.claims` set to a real test user id and select (expect own rows
only), attempt an insert as authenticated (expect a policy error); regenerate
types to lib/database.types.ts and prettier-format; record the result in the
progress.md task.

---------------------------------------------------------------------------

## 6. Payment flows: Stripe, PayPal, Venmo, verification, refunds

6.1 Creating an order (server action `createOrderAction`, app/actions/commerce.ts)

Input (zod, lib/commerce/intake.ts `createOrderInputSchema`):

```
{ productSlug: string, sleeperLeagueId: /^\d{1,20}$/, rosterId: int 1..99,
  paymentMethod: "stripe" | "paypal" | "venmo" | "none",
  expectedCents: int 0..100000,
  couponCode: string max 24 | "",
  intake: { direction: "contend" | "rebuild" | "unsure",
            questions: string max 1500, offLimits: string max 500 } }
```

`expectedCents` is the total the form DISPLAYED (list price minus the
previewed coupon). It is never used as the price; it is compared to the price
the server computes, and a difference refuses the order (3.17).
`paymentMethod: "none"` is legal only when the computed total is zero.

Steps, in this order, each failing with a plain sentence the form shows in
its error region:

1. Session. `createClient().auth.getUser()`. No user: return
   `{ ok: false, code: "signin", next: "/login?next=<encoded checkout url>" }`.
2. Settings. `loadCommerceSettings`. `storefront.enabled` false: "Reviews
   are not on sale right now." `payments[method]` false (for stripe, paypal,
   venmo): "That payment method is switched off at the moment. Pick another."
3. Product. `products` row by slug with `is_active`. Missing: "That review is
   no longer offered."
4. Capacity. `countOpenOrders(admin, settings)` (3.10). At or above
   `storefront.maxOpenOrders`, or `storefront.fullyBooked` true:
   "Michael is fully booked right now. Check back in a few days."
5. League and roster. `leagues` row by sleeper_league_id (LEAGUE_CORE_COLUMNS);
   `loadRosters(admin, league.id)` must contain rosterId. Missing: "We could
   not find that team. Open the league again and try once more."
6. Intake validation (step 0 shape already passed; this is the length and
   enum pass with trimmed strings).
7. Coupon. When `couponCode` is non-empty: `resolveCoupon(admin, code,
   product, userId)` (6.9). A refusal returns its own sentence ("That code is
   not valid.", "That code has expired.", "That code has been used up.",
   "You have already used that code.", "That code does not apply to this
   review."). On success it yields `discountCents`.
8. Price. `listPriceCents = product.price_cents`; `amountCents = listPriceCents
   - discountCents` (never below zero). If `amountCents !== expectedCents`:
   "The price changed while this page was open. Review it and order again."
   The form then calls `router.refresh()` so the new price is on screen. If
   `amountCents === 0` and `paymentMethod !== "none"`, or `amountCents > 0`
   and `paymentMethod === "none"`: the same sentence (the form and the server
   disagree about whether payment is needed, which only happens when the
   page is stale).
9. Duplicate guard. An existing order for (user_id, product_id,
   context.sleeperLeagueId, context.rosterId) with payment_status in
   ('unpaid','awaiting_confirmation'): return `{ ok: true, redirect:
   "/my-beacon/orders/<id>" }` without creating anything. A PAID order for
   the same team is not a duplicate (3.13).
10. Rate limit. `claimRateLimitSlot({ bucket: "order-checkout", max:
    settings.rateLimits.checkoutPerMinute, windowSeconds: 60 })`. False: "That
    is a lot of orders in one minute. Give it a moment and try again."
11. Context. `resolveLeagueContext` for format and source display;
    `readCachedBlueprint` for the snapshot; `links` built from the ids.
12. Insert the order: `payment_method` = the chosen method, or
    `complimentary` when the total is zero; payment_status `unpaid` for stripe
    and complimentary, `awaiting_confirmation` for paypal and venmo;
    fulfillment `pending_payment`; `expires_at` = now +
    `payments.stripeUnpaidExpiryHours` (stripe) or now +
    `payments.manualExpiryDays` days (manual) or null (complimentary);
    `list_price_cents`, `discount_cents`, `amount_cents`, `coupon_id`,
    `coupon_code`; snapshot; context; intake. Insert event `created` (system,
    visible, title "Order placed", data {method, listPriceCents,
    discountCents}). When a coupon applied, insert event `coupon_applied`
    (system, visible, title "Code <CODE> applied", body "<formatUsd(discount)>
    off").
13. Complimentary (total zero): call `try_mark_order_paid(id, 'coupon',
    couponCode, now(), null, null)`; on true, `markPaidIfWon` continues
    exactly as for any payment (the `paid` event, E1 with the coupon lines,
    A2). Return `{ ok: true, redirect: "/my-beacon/orders/<id>" }`.
14. Stripe: `startStripeCheckout(order)` (6.2). On success return `{ ok: true,
    redirect: session.url }`. On failure the order stays `unpaid` with no
    session, and the action returns `{ ok: true, redirect:
    "/my-beacon/orders/<id>?pay=failed" }`; the order page shows the pay panel
    with the message "We could not open the card payment page. Try again, or
    pay with PayPal or Venmo." so the customer is never stranded.
15. PayPal or Venmo: insert event `payment_pending` (system, visible, title
    "Waiting for your PayPal payment" or "...Venmo payment"); send email E2
    (section 8) in `after()`; if `notifications.notifyOnNew`, send admin
    email A1; return `{ ok: true, redirect: "/my-beacon/orders/<id>" }`.

The client form (components/commerce/checkout-form.tsx) calls the action
with `useTransition`, announces the error in a `role="alert"` region, and on
`redirect` performs `window.location.assign(redirect)` for an absolute Stripe
URL and `router.push` for a site path.

6.2 Stripe Checkout session (lib/commerce/stripe.ts `startStripeCheckout`)

Uses `stripeRequest` from lib/stripe/client.ts.

BEFORE A SESSION IS CREATED, the order's current session is closed. When
`order.stripe_session_id` is set and `payment_status` is `unpaid` (not
`expired`): call `expireCheckoutSession(order.stripe_session_id)`. Stripe
answers 200 for an open session (now expired), and 400 for one that is
already `expired` or `complete`. On 400, `retrieveCheckoutSession` is called:
`status = "expired"` means proceed; `status = "complete"` means THE CUSTOMER
HAS ALREADY PAID ON THAT SESSION and the webhook has not landed yet, so no new
session is created, `reconcileStripeOrder` runs instead (6.4), and the action
returns `{ ok: true, redirect: "/my-beacon/orders/<id>" }`. Any other
failure of the expire call aborts: "We could not reset the card payment page.
Try again in a minute." Only one session is ever payable for an order, which
is what makes a double charge impossible rather than merely unlikely.

Body:

```
mode: "payment",
client_reference_id: order.id,
expires_at: <unix seconds, now + settings.payments.stripeSessionMinutes * 60>,
success_url: `${SITE_ORIGIN}/my-beacon/orders/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
cancel_url:  `${SITE_ORIGIN}/my-beacon/orders/${order.id}?pay=cancelled`,
customer_email: <the account email, from auth.getUser()>,
line_items: [{ quantity: 1, price_data: { currency: "usd",
  unit_amount: order.amount_cents,
  product_data: { name: `${snapshot.name} (Personal Team Review)`,
    description: `${context.teamName} in ${context.leagueName}, ${context.season}` } } }],
payment_intent_data: { description: `FF Beacon order ${order.order_number}`,
  metadata: { product: "ffbeacon_order", order_id: order.id, order_number: order.order_number, product_slug: snapshot.slug } },
metadata: { product: "ffbeacon_order", order_id: order.id, order_number: order.order_number, product_slug: snapshot.slug },
```

No `payment_method_types` (automatic methods), no `submit_type` (the default
button reads "Pay"). `expires_at` is Stripe's own session lifetime; Stripe
accepts 30 minutes to 24 hours, and the setting is bounded the same way
(default 60 minutes). A short life is what keeps the capacity count honest
(3.10): an abandoned card page stops counting within the hour.

Idempotency key `order:${order.id}:${attempt}` where `attempt` is
`stripe_session_attempts + 1`, and the column is incremented in the same
update that stores the new session id. The counter exists for exactly this:
a retry from the pay panel must create a fresh session rather than replay an
old key with a different body, which Stripe refuses. `SITE_ORIGIN` is
`SITE.url` with trailing slashes stripped, exactly as the donation route
builds it. The returned URL's host is checked the same way the donation route
checks it before it is handed back.

On success: update the order `stripe_session_id` (replacing the old one),
`stripe_session_attempts = stripe_session_attempts + 1`,
`stripe_session_expires_at` = the session's `expires_at`, `payment_status`
back to `unpaid` if it was `expired`, `expires_at` = session expiry + 5
minutes (so the cron never expires an order before Stripe has). Insert event
`payment_pending` (visible, "Card payment opened") only on the first session;
later retries add nothing to the timeline.

6.3 Webhook `POST /api/orders/webhook`

Structure copied from app/api/donate/webhook/route.ts with these differences:

- Secret: `process.env.STRIPE_ORDERS_WEBHOOK_SECRET`. Log prefix `[orders]`.
- Handled events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
  `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.
  Anything else: 200 `{ received: true, handled: false }`. Section 20.4
  lists the same nine for the Dashboard.
- DEDUPE FIRST. After verification and parsing, and before any other read:
  insert into `payment_webhook_events` (provider 'stripe', event.id, endpoint
  'orders', event.type, event.livemode). A primary key conflict means a
  redelivery: read the row; `completed_at` set means 200
  `{ received: true, handled: false, reason: "duplicate-event" }`;
  `completed_at` null means an earlier delivery is in flight or died, so
  processing continues (it is safe: every write below is idempotent on its
  own). An insert error that is not a conflict: 500. On every 200 for a
  handled event the row's `completed_at` and `outcome` are stamped last.
- For the four session events: if `session.metadata.product !==
  "ffbeacon_order"` return 200 handled false, reason `not-an-order`. Find the
  order by `stripe_session_id = session.id`; fall back to
  `metadata.order_id` when the stored id differs (a retried session), AFTER
  checking it matches `/^[0-9a-f-]{36}$/`. No order: log warn, 200 handled
  false (a 500 would retry forever on an order that was deleted by hand).
- AMOUNT CHECK, before any paid transition: if `session.amount_total !==
  order.amount_cents` or `session.currency` (lower-cased) is not `usd`:
  do NOT call the RPC. Set `mismatch_amount_cents = session.amount_total`,
  insert event `payment_mismatch` (system, NOT visible, title "Stripe
  reported a different amount", data {expected, reported, currency,
  sessionId, paymentIntentId}), send A5 to the admin in `after()`, 200
  `reason: "amount-mismatch"`. The admin resolves it from the Payment panel
  (10.2): "Confirm payment anyway" (confirmManualPaymentAction with the
  Stripe reference) or "Cancel order". This cannot happen through our own
  checkout, which is exactly why it must be loud when it does.
- Paid (`payment_status` paid or no_payment_required): call
  `try_mark_order_paid(order.id, 'stripe-webhook', null, event.created as
  timestamptz, paymentIntentId, event.livemode)`. True: write
  `metadata = redactStripeEvent(event)` on the order, insert event `paid`
  (system, visible, "Payment received", data {via: "stripe"}), then in
  `after()` send E1 to the customer and A2 to the admin (through
  `sendReceipt`, 8.1, which owns `receipt_email_status`). False: read the
  order; if it is `paid` and `paymentIntentId` is non-null and differs from
  `stripe_payment_intent_id` and from `duplicate_payment_intent_id`, this is
  a SECOND PAYMENT: set `duplicate_payment_intent_id = paymentIntentId`,
  insert event `duplicate_payment` (system, NOT visible, title "A second
  payment arrived for this order", data {paymentIntentId, amount}), send A4
  to the admin in `after()`, 200 `reason: "duplicate-payment"`. Otherwise 200
  `reason: "already-paid"`. A duplicate is refunded by the admin in the
  Stripe Dashboard and then marked resolved (10.2); the customer hears about
  it through Stripe's own refund notice and, if the admin ticks notify, E8.
- `checkout.session.completed` with payment_status `unpaid` (a delayed
  method): insert event `payment_pending` body "Your bank is still
  confirming the payment." if the latest event is not already that; 200.
- `async_payment_failed`: if the order is still `unpaid`, insert event
  `payment_not_found` (visible, "The card payment did not go through"), send
  E7; 200.
- `checkout.session.expired`: if `unpaid` and `stripe_session_id` matches,
  set `payment_status = 'expired'`, insert event `payment_expired` (visible,
  "The card payment page expired. You can open a new one from this page.");
  200. No email: the customer abandoned it.
- `charge.refunded`: find the order by `stripe_payment_intent_id =
  charge.payment_intent` (or by `duplicate_payment_intent_id`, in which case
  only the duplicate is being refunded: stamp `duplicate_resolved_at`, insert
  an internal event "Duplicate payment refunded in Stripe", 200). For the
  primary payment, when `payment_status in ('paid','refunded')` and
  `charge.amount_refunded > order.refunded_cents`: set `refunded_cents =
  min(charge.amount_refunded, amount_cents)`, `refunded_at` = event time; if
  `refunded_cents = amount_cents` set `payment_status = 'refunded'` and
  `fulfillment_status = 'cancelled'` unless already `delivered`; insert event
  `refunded` (visible, "Refunded" or "Partly refunded", body
  `${formatUsd(delta)} refunded to the original payment method`), send E8 in
  `after()` naming the delta and the total refunded. When `amount_refunded`
  is not greater than what is stored, nothing is written (a redelivery or an
  out-of-order event).
- Dispute events: section 6.8.
- Codes: 400 for an unverifiable request, 500 only for a database write that
  must be retried, 200 for everything else, for the same reasons the donation
  route documents.

6.4 Reconcile on view (lib/commerce/reconcile.ts `reconcileStripeOrder`)

Called by the order page server component when all of: payment_method is
stripe, payment_status in ('unpaid','expired'), stripe_session_id is set,
created_at within 48 hours. Steps: claim bucket `order-reconcile`,
`settings.rateLimits.reconcilePerMinute` per minute (a refusal returns the
order unchanged and the page shows "We are still confirming your payment"
without error); `retrieveCheckoutSession`; map with `donationOutcome`
re-exported as `checkoutOutcome` from lib/stripe/outcome.ts (the function
moves there with its test, lib/donate/outcome.ts re-exports it). `paid`:
the SAME amount check as the webhook (6.3) runs first and a mismatch takes
the same path; then `try_mark_order_paid(id, 'stripe-reconcile', ...)` and
on true the same event and emails as the webhook. `unknown` with
session.status `expired`: mark expired as 6.3 does. Otherwise nothing. The
`?session_id=` query parameter is compared to the stored id and otherwise
ignored; it is never used to look anything up. The reconcile and the webhook
share one function for the paid path, `markPaidIfWon` in
lib/commerce/orders.ts, so the two can never disagree about what paid means.

6.5 The donation webhook change

In app/api/donate/webhook/route.ts, directly after the session id check (step
3 in that file), add:

```
// An order's session arrives here too, because Stripe fans every
// checkout.session event out to every endpoint subscribed to it. One is
// a donation only when our own checkout route said so.
const product = session?.metadata?.product;
if (product && product !== "ffbeacon_donation") {
  return NextResponse.json({ received: true, handled: false, reason: "not-a-donation" });
}
```

A session with no metadata at all is still treated as a donation (older
sessions predate the tag). Test added to the donation webhook tests: an
event with `metadata.product = "ffbeacon_order"` writes no row and sends
nothing.

6.6 PayPal and Venmo (lib/commerce/pay-links.ts)

```
export function orderNote(orderNumber: string): string
  // "FF Beacon order FFB-100001"
export function paypalOrderUrl(cents: number): string
  // https://www.paypal.com/paypalme/<PAY_HANDLE>/<decimal>USD  (no note parameter exists)
export function venmoOrderUrl(cents: number, orderNumber: string): string
  // https://venmo.com/?txn=pay&audience=private&recipients=<PAY_HANDLE>&amount=<decimal>&note=<orderNote>
```

The order page's pay panel for a manual order shows, in this order: the
amount in large type; the order number in large mono type with a Copy button
(the clipboard pattern from components/copy-link-button.tsx); the sentence
"Put FFB-100001 in the payment note so Michael can match it to this order.
PayPal does not carry the note across, so type it there yourself."; the
PayPal or Venmo link (a real `<a>`, new tab, "opens PayPal in a new tab" in
the accessible name); then the "I sent it" form: an optional
"Transaction id or the name on your PayPal or Venmo account" text field (max
120) and a button "I sent the payment". Submitting calls
`reportManualPaymentAction(orderId, reference)`: ownership check, state must
be `awaiting_confirmation`, claim bucket `order-report`
(`settings.rateLimits.reportPaymentPerMinute`), set
`customer_reported_paid_at = now()`, `external_payment_reference`, insert
event `payment_reported` (customer, visible, "You said the payment was
sent"), send A3 to the admin with reply-to the customer. The panel then
reads "Thanks. Michael confirms PayPal and Venmo payments by hand, usually
within a day. This page updates when he does." A second press is refused
with "Already reported."

Admin confirm: `confirmManualPaymentAction(orderId, reference, paidAtIso?)`:
requireAdmin; `try_mark_order_paid(id, 'manual', reference, paidAt ?? now())`;
on true insert event `paid` (admin, visible, "Payment confirmed", data
{via: method}) and send E3. Admin "not received":
`markPaymentNotFoundAction(orderId, note, notify)`: clears
`customer_reported_paid_at`, inserts event `payment_not_found` (admin,
visible, "We could not find this payment yet", body = note), sends E7 when
notify is checked. Admin cancel: `cancelOrderAction(orderId, note)`: allowed
from `unpaid`, `awaiting_confirmation`, `expired`; sets payment
`cancelled`, fulfillment `cancelled`, `cancelled_at`; event
`payment_cancelled`; no email unless the admin ticks notify (E9). Every
cancel (admin or customer, 9.5) of a Stripe order whose session is still
`unpaid` first calls `expireCheckoutSession` so the abandoned page cannot be
paid later; a `complete` answer there means the money has arrived and the
cancel is refused with "This order has just been paid. Refresh the page."

`switchPaymentMethodAction(orderId, method)` (customer, 9.5): ownership
check; payment_status in ('unpaid','expired'); the current method is stripe;
the target is paypal or venmo and switched on. It calls
`expireCheckoutSession` on the open session exactly as 6.2 does (a `complete`
answer runs the reconcile instead and the switch does not happen), then
rewrites `payment_method`, sets `awaiting_confirmation`, `expires_at` = now +
`manualExpiryDays` days, inserts `payment_pending` and sends E2. Claims
bucket `order-stripe-retry`.

6.7 Refunds recorded by hand (every payment method)

`recordRefundAction(orderId, amountCents, note, notify)`: requireAdmin;
allowed when payment_status in ('paid','refunded') and `amountCents` is
between 1 and `amount_cents - refunded_cents` (the form's maximum and
default). Sets `refunded_cents = refunded_cents + amountCents`,
`refunded_at` = now, `refund_note`; when the new total equals `amount_cents`
sets `payment_status = 'refunded'` and fulfillment `cancelled` unless
delivered; event `refunded` (admin, visible, title "Refunded" or "Partly
refunded", body names the amount); sends E8 when `notify` is ticked (default
on). When nothing is left to refund the button is not drawn and the panel
says "Fully refunded on <date>".

The button exists for Stripe orders too, labeled "Record a refund made in
Stripe". The webhook normally does this; the button is the path when the
endpoint was misconfigured or the event was missed, so an order refunded in
the Dashboard is never left reading Paid forever. It is idempotent with the
webhook because both add to `refunded_cents` and neither writes when the
total already covers the amount: if the admin records a refund and the
webhook event then arrives with `amount_refunded` equal to what is stored,
the webhook writes nothing (6.3). The form says, above the button: "Refund
the money in Stripe, PayPal or Venmo first. This records it; it does not move
money."

6.8 Chargebacks (Stripe disputes)

A dispute is a cardholder telling their bank the charge was not legitimate.
Stripe takes the money back at once and holds it until the bank decides.
Four events arrive on the orders endpoint, each found by
`dispute.payment_intent` against `stripe_payment_intent_id` (or
`duplicate_payment_intent_id`, in which case only an internal event is
written and `duplicate_resolved_at` is stamped, because the money is gone
either way):

- `charge.dispute.created`: set `dispute_id = dispute.id`, `dispute_status =
  'open'`, `disputed_at` = event time. Insert event `dispute_opened` (system,
  NOT visible, title "Chargeback opened", data {disputeId, amount, reason:
  dispute.reason, dueBy: dispute.evidence_details.due_by}). Send A6 to the
  admin in `after()`. The fulfillment status is NOT changed: the admin
  decides, and a delivered review is not undelivered. The order enters Needs
  attention (10.1) and the admin order page shows the dispute banner (10.2).
- `charge.dispute.funds_withdrawn`: insert `dispute_updated` (internal,
  "Stripe withdrew the disputed funds"). No status change.
- `charge.dispute.funds_reinstated`: insert `dispute_updated` (internal,
  "Stripe returned the disputed funds"). No status change.
- `charge.dispute.closed`: `dispute.status` is `won`, `lost` or
  `warning_closed`; set `dispute_status` to it. Insert `dispute_closed`
  (internal, "Chargeback closed: won" and so on). `lost`: the money is gone,
  so it is recorded as a refund of `dispute.amount` through the same
  arithmetic as 6.3 (`refunded_cents`, `refunded_at`, `refund_note =
  "Chargeback lost"`, `payment_status = 'refunded'` when the total is
  reached, fulfillment `cancelled` unless delivered). No customer email on
  any dispute event: the conversation is between the cardholder, their bank
  and Stripe, and Stripe's Dashboard is where evidence is submitted. Send A7
  to the admin on `closed`.

A new order from a customer with an OPEN dispute on another order is not
refused by the system (the admin may know more than the system does), but
the admin order page's Customer panel says "1 open chargeback" in danger
tone and A2 for the new order carries the same sentence.

6.9 Coupons and complimentary orders

`resolveCoupon(admin, rawCode, product, userId)` in lib/commerce/coupons.ts,
pure validation over a loaded row plus two counts:

1. Normalize: trim, upper-case; must match `/^[A-Z0-9]{4,24}$/`, else
   "That code is not valid."
2. Load the `coupons` row by code with `is_active`. Missing: "That code is
   not valid."
3. Window: `starts_at` in the future: "That code is not active yet."
   `expires_at` in the past: "That code has expired."
4. Scope: `product_id` set and not this product, or `product_family` set and
   not this product's family: "That code does not apply to this review."
5. Caps: count redemptions as 5.9 defines; at or above `max_redemptions`:
   "That code has been used up." The same count for this user at or above
   `max_redemptions_per_user`: "You have already used that code."
6. Discount: `percent` kind: `round(list * percent_off / 100)`; `amount`
   kind: `min(amount_off_cents, list)`. Returns `{ coupon, discountCents }`.

`previewCouponAction(productSlug, code)` (app/actions/commerce.ts) runs the
same resolver for the signed-in user and returns `{ ok: true, discountCents,
amountCents, code }` or `{ ok: false, message }`. Claims bucket
`order-coupon-preview` (`settings.rateLimits.couponPreviewPerMinute`, default
20) AFTER the shape check so junk costs nothing. The form shows the result in
a `role="status"` region and updates the summary line and the submit button.
`createOrderAction` re-resolves the code (6.1 step 7); the preview is never
trusted.

A total of zero is a complimentary order (6.1 step 13). The receipt (E1)
reads Amount "$0.00", a line "Code: <CODE>, $19.95 off", and no refund
sentence. The revenue figures sum `amount_cents`, so a free order adds
nothing; the admin list shows a "Free" chip (muted) on `amount_cents = 0`.

An admin-created complimentary order (10.6) has no coupon: `origin =
'admin'`, `payment_method = 'complimentary'`, `list_price_cents` = the price,
`discount_cents` = the price, `amount_cents = 0`, `intake = { direction:
"unsure", questions: "", offLimits: "", contact: "email", providedBy:
"admin" }`, then `try_mark_order_paid(id, 'complimentary', null, now(),
null, null)`. The customer gets E13 and can add their own questions from the
order page while the review is still queued (9.5).

---------------------------------------------------------------------------

## 7. The order state machine

Two columns, two machines, one pure module: lib/commerce/transitions.ts
exports `canTransitionPayment(from, to)`, `canTransitionFulfillment(from,
to)`, `progressStep(order)` and the display maps. Every action checks the
transition through this module and nowhere else, and the test file pins the
tables below.

7.1 payment_status

```
unpaid                -> paid (stripe webhook, reconcile, admin confirm, or at once for a complimentary order),
                         expired (session expired), cancelled (admin or customer)
awaiting_confirmation -> paid (admin confirm), expired (cron, unreported past expires_at), cancelled (admin or customer)
expired               -> unpaid (new Stripe session), paid (late async payment or admin confirm), cancelled (admin or customer)
paid                  -> refunded (webhook, admin record, or a lost chargeback, when refunded_cents reaches amount_cents)
cancelled, refunded   -> (terminal)
```

A PARTIAL refund is not a transition: `refunded_cents` grows and
`payment_status` stays `paid`; the chip reads "Paid, partly refunded" when
`refunded_cents > 0`. A chargeback is not a payment status either:
`dispute_status` is its own column and its own chip ("Chargeback open",
danger; "Chargeback won", positive; "Chargeback lost", danger), drawn beside
the payment chip wherever the payment chip is drawn. `canTransitionPayment`
is also what refuses a customer cancel on a paid order.

7.2 fulfillment_status

```
pending_payment -> queued (set by try_mark_order_paid), cancelled
queued          -> in_progress, delivered, cancelled
in_progress     -> delivered, queued (admin steps back), cancelled
delivered       -> in_progress (admin reopens for a correction; delivered_at is kept and delivery_updated events follow)
cancelled       -> (terminal)
```

`started_at` is set the first time `in_progress` is entered. `delivered_at`
is set the first time `delivered` is entered and never cleared.

7.3 The customer's progress tracker (section 9.5) has four steps and maps as:

```
1 Ordered     always complete
2 Paid        complete when payment_status = paid or refunded; current when unpaid or awaiting_confirmation; failed (danger) when expired or cancelled
3 In progress complete when fulfillment in (delivered); current when in_progress; upcoming when queued
4 Delivered   complete when fulfillment = delivered
```

A refunded order shows the tracker with a "Refunded" chip above it and the
Delivered step crossed only if it never delivered.

7.4 Display words and tones (lib/commerce/transitions.ts `PAYMENT_LABEL`,
`FULFILLMENT_LABEL`, `TONE`):

```
unpaid                 "Awaiting card payment"      warning
awaiting_confirmation  "Awaiting your payment"      warning   (customer) / "Awaiting confirmation" (admin)
paid                   "Paid"                       positive
expired                "Payment expired"            muted
cancelled              "Cancelled"                  muted
refunded               "Refunded"                   danger
pending_payment        "Not started"                muted
queued                 "In the queue"               purple
in_progress            "In progress"                cyan
delivered              "Delivered"                  positive

paid + refunded_cents > 0      "Paid, partly refunded"  warning
amount_cents = 0               "Free"                   muted    (drawn beside the payment chip)
dispute_status open            "Chargeback open"        danger   (admin surfaces only)
dispute_status won             "Chargeback won"         positive (admin surfaces only)
dispute_status lost            "Chargeback lost"        danger   (admin surfaces only)
dispute_status warning_closed  "Inquiry closed"         muted    (admin surfaces only)
```

An `unpaid` complimentary order never exists long enough to be drawn (it is
paid in the same action), so no word is needed for it. Tones map to classes
in section 11.4. A chip always carries the word; the color is never the only
signal.

---------------------------------------------------------------------------

## 8. Email catalog

Every message is built by a pure `buildXEmail(args)` in
lib/email/order-emails.ts returning `{ subject, html, text }`, sent by a
`sendX` wrapper through `sendEmail` with NO `replyTo` argument on a customer
message (so the default michael@ffbeacon.com applies) and `replyTo:
customerEmail` on an admin notification. Every send to a customer is
recorded as an `email_sent` event (system or admin, visible, title "Email
sent: <subject>", data {resendId, status}) so the portal timeline says
"Michael emailed you" with the subject, and the free-form composer also
writes an `order_messages` row. Every timestamp is `formatEastern`. Every
body ends with the order link `${EMAIL_SITE_URL}/my-beacon/orders/<id>` as
an `emailButton("Open your order", ...)`. The preheader says the useful
thing, not the subject again.

Customer emails (recipient: the account email read from Auth at send time;
reply-to default):

- E1 Order paid (Stripe, or a complimentary coupon order). Subject `Order
  FFB-100001: your Premium Review is paid for` (coupon order with a zero
  total: `Order FFB-100001: your Premium Review is on its way`). Heading
  "Thank you. Michael has your order." Quote card: Order, Review, Team (team
  name in league), Amount (and when a coupon applied, a second line "Code
  SAVE20: $4.00 off" and "List price $19.95"), Paid (Eastern), Payment (Card
  via Stripe / "No payment needed"), Sold by ("FF Beacon,
  michael@ffbeacon.com", the `SELLER_NAME` and `SELLER_EMAIL` constants in
  lib/commerce/constants.ts). Paragraph: "Michael writes every review
  himself, against your Team Blueprint and your league's own numbers. Expect
  it in your My Beacon portal within N days, and an email the moment it
  lands." Then "Keep this email as your receipt." and, when the amount is
  above zero, the refund sentence: "All sales are final. Michael considers
  refund requests case by case and will usually refund an order he has not
  started on yet. Reply to this email and quote the order number."
- E2 Order placed, awaiting PayPal or Venmo. Subject `Order FFB-100001: how
  to finish paying with PayPal` (or Venmo). Heading "One step left." Quote
  card: Order, Amount, Pay to (@mjwalsh1988 on PayPal), Put in the note
  (FFB-100001). Step list: 1 Open PayPal (link), 2 Send the exact amount with
  the order number in the note, 3 Come back and press "I sent the payment".
  "Michael confirms these by hand, usually within a day. The order is held
  for 7 days."
- E3 Payment confirmed (manual). Subject `Order FFB-100001: payment
  confirmed`. Same body as E1 with Payment "PayPal" or "Venmo".
- E4 Status update. Sent only when the admin ticks "Email the customer" on a
  status change. Subject `Order FFB-100001: Michael has started your
  review` (in_progress) or `...: an update on your review` (any other
  change). Body: the admin's note (required when notify is ticked, max 1000)
  in a quote card, then the button.
- E5 Delivered. Subject `Your Premium Review is ready, FFB-100001`. Heading
  "Your review is ready." Paragraph "Michael has finished your Premium Review
  for <team> in <league>. Here is how it opens:" then the FIRST published
  section rendered through the rich text renderer (section 9.6), clipped at
  1200 characters with "Read the rest in your portal." when longer, then the
  button "Read the full review". For Premium: "You have one follow-up
  question included. Reply to this email within 7 days and Michael will
  answer it."
- E6 Payment reminder (manual, day 3). Subject `Order FFB-100001 is waiting
  for your PayPal payment`. The E2 steps again, plus "If you have changed
  your mind, there is nothing to do: the order closes on its own on
  <expires_at Eastern date>."
- E7 Payment not found or card payment failed. Subject `Order FFB-100001: we
  could not find your payment` or `...: the card payment did not go
  through`. Body: the admin's note when there is one, the pay steps again.
- E8 Refunded. Subject `Order FFB-100001 has been refunded` (partial:
  `Order FFB-100001: a partial refund`). Quote card: Order, Amount refunded
  (this refund), Total refunded (when it differs), Refunded on, Back to (the
  original payment method). "Refunds take 5 to 10 business days to show on a
  card statement."
- E9 Cancelled (admin-initiated, notify ticked). Subject `Order FFB-100001
  was cancelled`. Body: the note.
- E10 Expired (cron). Subject `Order FFB-100001 has closed`. "We did not see a
  payment, so this order closed on its own. Nothing was charged. If you
  still want the review, start a new order from your Blueprint any time."
- E11 Free-form message from the admin composer. Subject typed by the admin
  (max 160). Body: the composer text through the rich text renderer, then the
  button. Recorded in `order_messages`.
- E12 Delivery updated. Sent only when the admin ticks notify after editing
  a published section. Subject `Order FFB-100001: Michael updated your
  review`.
- E13 Complimentary order created by the admin. Subject `Order FFB-100001:
  Michael has set up a Premium Review for you`. Heading "A review, on the
  house." Quote card: Order, Review, Team, Amount ("$0.00, complimentary"),
  Due by. Paragraph: the admin's note when one was typed (max 1000), then
  "If there is anything you want answered, add it on the order page before
  Michael starts." Button "Open your order".

Admin notifications (recipient: `notifications.adminEmail`; reply-to the
customer's address; plain, short, no quote card beyond the facts):

- A1 New order awaiting manual payment (only if `notifyOnNew`). Subject
  `[Orders] FFB-100001 placed, awaiting Venmo`.
- A2 Order paid. Subject `[Orders] FFB-100001 paid: Premium Review, <team>
  in <league>`. Body: customer display name and email, amount (and the
  coupon line when one applied), due date, the questions from the intake,
  "1 open chargeback on another order" when true, and the link
  `/admin/orders/<id>`.
- A3 Customer reported a manual payment. Subject `[Orders] FFB-100001:
  customer says Venmo was sent`. Body: reference text, amount expected, link.
- A4 Duplicate payment. Subject `[Orders] FFB-100001: a second payment
  arrived`. Body: both payment intent ids as Dashboard links, the amount, and
  the sentence "Refund the second one in Stripe, then press Mark duplicate
  refunded on the order." Always sent (no setting).
- A5 Amount mismatch. Subject `[Orders] FFB-100001: Stripe reported
  <reported> for an order of <expected>`. Body: both amounts, the session
  and payment intent links, "The order was NOT marked paid. Decide on the
  order page." Always sent.
- A6 Chargeback opened. Subject `[Orders] FFB-100001: chargeback opened,
  evidence due <due_by Eastern>`. Body: amount, Stripe's reason code, the
  Dashboard link to the dispute, the fulfillment status, and "Do not deliver
  until this is resolved unless you choose to." Always sent.
- A7 Chargeback closed. Subject `[Orders] FFB-100001: chargeback <won|lost|
  closed>`. Body: the outcome and what was recorded. Always sent.

8.1 Idempotency of sends, and the receipt's status

The paid receipt (E1 or E3) is sent only by the caller for whom
`try_mark_order_paid` returned true, through ONE function, `sendReceipt(order)`
in lib/commerce/orders.ts, which: reads the customer address from Auth,
builds E1 or E3 from the order's `payment_method`, increments
`receipt_email_attempts`, calls `sendEmail`, and writes the outcome:
`receipt_email_status = 'sent'` and `receipt_email_sent_at` on ok; `'skipped'`
with error "RESEND_API_KEY is not configured" on a skipped result; `'failed'`
with the error text otherwise. It also inserts the `email_sent` event with
`data.status`. The RPC set the status to `pending` in the paid transition
(5.3), so the gap between the flip and the send is visible as a `pending` row
rather than as nothing.

The cron (15, step 4) retries orders with `receipt_email_status in
('pending','failed')`, `paid_at` older than `emails.receiptRetryAfterMinutes`
(default 10) and `receipt_email_attempts < emails.receiptRetryMax` (default
3). `skipped` is also retried, because Resend being unconfigured is a
deployment state somebody fixes. The admin order page shows a danger banner
"Receipt email not sent (<reason>)" with a "Send the receipt now" button
(`resendReceiptAction`) whenever a paid order's status is not `sent`, and
Needs attention counts paid orders whose status has been anything but `sent`
for more than an hour.

E5 is sent by `publishDeliveryAction` once per publish (a `delivered` event
already present means the button reads "Re-send the delivery email" and
sends E5 again only on an explicit press). E6 is guarded by
`reminder_sent_at`. E10 by the transition to expired. E13 by the creation of
the complimentary order. For every email other than the receipt there is no
retry queue: a failed send is recorded on the event (`data.status =
"failed"`) and the admin order page shows a "Resend" button beside any
failed email event.

---------------------------------------------------------------------------

## 9. Customer surfaces

9.1 The offer on the Blueprint sheet (section 13 of the sheet)

In app/leagues/[league_id]/blueprint/page.tsx, after the last SheetSection
and before the footer notes, render:

```
<SheetSection id="review" number="13" title="Personal review"
  helper="Michael reads this team and writes to you.">
  <ProductOffer family="team-review" placement="blueprint"
    sleeperLeagueId=... rosterId=... linkUsername=... availability=... />
</SheetSection>
```

Only when `settings.placements.blueprintSection` is true AND the viewer has a
roster in view (the page already knows `roster`). With no roster chosen, the
section still renders with the sentence "Pick a team above to order a review
of it." and no buttons. The section is OUTSIDE the view model: the Blueprint
cache, fingerprint and share images are unchanged. The section is rendered
by the page, not by the stored view, and the share images do not draw it.

9.2 The strip on the league overview

components/commerce/review-strip.tsx, mounted in app/leagues/[league_id]/page.tsx
directly under `BlueprintCtaSection` inside its own Suspense (fallback null),
gated on `settings.placements.overviewStrip`. Same shape as
components/league-blueprint/blueprint-cta.tsx (hairline, eyebrow, h2, one
sentence, controls at the right): eyebrow "Personal Team Review", h2 "Have
Michael read your team", sentence "A written review of your roster, your
direction and the trades to make, from $9.95. Delivered to your My Beacon
portal.", then two links "Basic Review $9.95" and "Premium Review $19.95" to
the checkout page with `tier=`. Prices come from the products table (the
cheapest active tier's price in the sentence). With no roster for the
viewer, the links go to the checkout page without `roster=` and the page's
roster select is the first thing on it. When fully booked the strip shows
one sentence "Reviews are fully booked right now." and no links.

9.3 The checkout page `/leagues/[league_id]/review`

Inside `LeagueShell` with `activeTab="blueprint"`, masthead eyebrow "League
Pulse", title "Personal Team Review", description "Michael reads one team in
this league and writes to you. Pick the tier, confirm the team, tell him what
you want answered, and pay the way you like." The page is force-dynamic. Load
order: `getSyncedLeague`, `loadTeams`, `resolveSleeperViewer`,
`matchViewerRoster` (the `?roster=` wins, then the viewer's team), the
products of family `team-review` where `is_active` ordered by tier_rank,
`loadCommerceSettings`, the open-order count for capacity, and the user.

Signed out: the tier cards render (prices and features), then a Panel
"Sign in to order" with one link `/login?next=<this url>` and the sentence
"Your review is delivered into My Beacon, so an account is where it lives."
No form.

Signed in, before the form: when the user has an order for the selected
(league, roster) with payment_status `paid` and fulfillment in ('queued',
'in_progress'), a `role="status"` panel (cyan tone, not an alert) reads "You
already have a Premium Review in progress for Night Owls (FFB-100001, due by
Nov 4). You can still order another one, for example after a run of moves."
with a link to that order. The notice re-renders when the roster select
changes (the page knows every roster's open order, passed to the form as a
map keyed by roster id). It never disables anything (3.13).

Signed in: one `<form>` in components/commerce/checkout-form.tsx (client),
four numbered fieldsets, each a `<fieldset>` with a `<legend>` that carries
the number and the title in the sheet margin style:

1. "Which review". `role="radiogroup"` of native radios wrapped in labels
   (the components/league-choice-list.tsx pattern), one card per tier: name,
   badge, price in large mono type, turnaround sentence, the feature list as
   a `<ul>` with lucide `Check` aria-hidden and the text visible. The
   preselected tier comes from `?tier=`.
2. "Which team". The shared components/league-lineups/roster-select.tsx
   (native select) preselected to the matched roster; under it one line
   "Michael reviews the team as it stands when he starts, and reads the
   Blueprint you see now." and a link "Open this team's Blueprint" (new
   tab not needed; same tab).
3. "Tell Michael about your situation". Radio group "What are you trying to
   do this season?" with Contend, Rebuild, Not sure; textarea "What do you
   want answered?" (maxLength 1500, counter, hint "Trades you are weighing,
   players you are unsure about, anything you want a straight answer on");
   textarea "Anything off the table?" (maxLength 500, hint "Players you will
   not trade, picks you are keeping, league rules Michael should know").
4. "How you want to pay". Radio group of the three methods, each with its
   own sentence: Card, Apple Pay or Google Pay ("Pays on Stripe's secure
   page. Your order is confirmed the moment it goes through."), PayPal ("You
   send the amount to @mjwalsh1988 with your order number in the note.
   Michael confirms it by hand, usually within a day."), Venmo (the same
   sentence with Venmo). A method switched off in settings is not drawn;
   Stripe is also not drawn when `stripeConfigured()` is false. When an
   applied code brings the total to zero, this fieldset is replaced by one
   sentence in the same position: "No payment needed. This code covers the
   whole review." and the hidden method value is `none`.

Between fieldsets 3 and 4, when `settings.coupons.enabled` is true, a
`<details>` disclosure "Have a code?" (components/commerce/coupon-field.tsx)
holding a labeled text input "Code" (maxLength 24, `autocapitalize="characters"`,
`autocomplete="off"`) and an "Apply" button calling `previewCouponAction`
(6.9). The result renders in a `role="status"` region inside the disclosure:
"SAVE20 applied: $4.00 off. New total $15.95." or the refusal sentence. A
"Remove" button clears it. The applied code and the previewed total are held
in form state and posted as `couponCode` and `expectedCents`.

Then the summary line "Premium Review for <team> in <league>: $19.95, one
time" (with a code: "$19.95, $4.00 off with SAVE20: $15.95, one time";
updates as the radios change, in a `role="status"`), the Terms sentence
"By ordering you agree to the Terms of Service, including the purchases
section. All sales are final." with the link, and the submit button "Pay
$15.95 with card" / "Order and pay with PayPal" / "Order and pay with Venmo"
/ "Order for free" (zero total). The button is disabled only while the
action is pending; validation errors render in a `role="alert"` region above
it and move focus there. The "price changed" refusal (6.1 step 8) also calls
`router.refresh()` so the new price is on the page under the alert.

9.4 `/my-beacon/orders`

Panel eyebrow "Yours", title "Orders", helper "Every review you have bought,
and where it is." Figures row (components/commerce/figure-tile.tsx, section
11.2): Open (count not delivered and not cancelled), Delivered, Spent (sum of
paid amounts, formatUsd). Then a ruled list (`RULED`), one `<li>` per order,
newest first, each a link to the order page: order number in mono, product
name, team in league, created date (formatEastern date form), payment chip,
fulfillment chip, and a 4-step mini progress (components/commerce/order-progress.tsx
`compact`). Empty state: "No orders yet. A Personal Team Review starts from
any team's Blueprint in League Pulse." with a link to /tools/league-pulse.
Paged 20 with `Pager` (`?page=`). Reads go through the session client, so RLS
scopes them; the figures use `count: "exact", head: true`.

9.5 `/my-beacon/orders/[order_id]`

Ownership: the row is read with the SESSION client, so a foreign id returns
nothing and the page calls `notFound()`. The page is one sheet
(components/commerce/order-sheet.tsx, the `Sheet` primitive): a letterhead
with the FF Beacon mark, "Order", the order number in large mono type, the
product name as the h2, the dotted-leader details (Team, League, Season,
Format, Values source, Ordered, Paid, Due by or Delivered, Amount, Payment
method, Reference when manual), and in the grade box position the AMOUNT in
large type with the payment chip under it. Then sections:

- 01 Progress: the 4-step tracker (full size), the sentence for the current
  state: "Michael confirms PayPal payments by hand..." / "Michael is working
  on it. Expect it by <due_at>." / "Delivered <delivered_at>."
- 02 Pay (only while payment_status in unpaid, awaiting_confirmation,
  expired): the pay panel from section 6.6 for manual orders; for Stripe a
  button "Open the card payment page" calling `startStripeCheckoutAction`
  (which runs 6.2, expiring the old session first) and under it "Or switch
  to PayPal or Venmo" calling `switchPaymentMethodAction(orderId, method)`
  (6.6). `?pay=cancelled` renders "You backed out of the payment page.
  Nothing was charged." in a status region; `?pay=failed` renders the
  sentence from 6.1 step 14. At the foot of the panel, in small type, a
  "Cancel this order" button (`cancelOwnOrderAction(orderId)`: ownership
  check, `canTransitionPayment(current, 'cancelled')` must allow it, which it
  does only from unpaid, awaiting_confirmation and expired; the Stripe
  session is expired first per 6.6; sets payment `cancelled`, fulfillment
  `cancelled`, `cancelled_at`; event `payment_cancelled` (customer, visible,
  "You cancelled this order"); no email). The button opens the house
  confirm dialog (`desktopPlacement="center"`) reading "Cancel order
  FFB-100001? Nothing has been charged. You can start a new order any time."
  with "Cancel the order" and "Keep it". A paid order shows no cancel
  control anywhere; the Help section says how refunds work.
- 03 Your review (only when fulfillment is delivered, or in_progress with
  published sections): each published section as an h3 and the rendered
  body (9.6), attachments as a list of links to the files route with the
  file name and size, a line "Updated <time>" when `updated_at` is after
  `published_at`. For Premium, the follow-up sentence with the mailto text
  shown as text (michael@ffbeacon.com) beside the link.
- 04 What you told Michael: the intake answers as a dl. When
  `intake.providedBy = "admin"` and fulfillment is `queued` and
  `intake.questions` is empty, this section is instead the intake form from
  the checkout page (fieldset 3 only) with the button "Send these to
  Michael", calling `updateIntakeAction(orderId, intake)`: ownership check,
  fulfillment must still be `queued`, same validation as 6.1 step 6, writes
  `intake` with `providedBy` kept, inserts event `intake_updated` (customer,
  visible, "You added your questions"), sends A2's intake paragraph to the
  admin as a short note (subject `[Orders] FFB-100001: the customer added
  their questions`, reusing A3's builder shape). Once Michael has started,
  the section says "Michael has started, so the questions are fixed. Reply
  to any email about this order to add something."
- 05 Timeline: `order_events` where visible, oldest first, each a `<li>` with
  the time (formatEastern), the title, the body; an `email_sent` event shows
  "Email sent: <subject>"; a `note` event from the admin reads "Michael
  added a note" with the body. Under it, "Messages from Michael": the
  `order_messages` rows with subject, date and the rendered body in a
  `<details>` each.
- 06 Help: "Something wrong with this order? Reply to any email about it, or
  write to michael@ffbeacon.com and quote FFB-100001." then, for a paid order,
  "All sales are final. Michael considers refund requests case by case and
  will usually refund an order he has not started on yet." and the Terms
  link. The refund sentence is the one constant `REFUND_POLICY_SENTENCE` in
  lib/commerce/constants.ts, used here, in E1 and E3, and quoted in the
  Terms, so the three can never drift apart.

9.6 Rich text (lib/commerce/rich-text.ts)

A tiny pure parser for what Michael types: blank line separates paragraphs;
a line starting with `## ` is a subheading (h3 on the page, h2 in email); a
run of lines starting with `- ` is a bullet list; a line starting with `1. `
begins a numbered list; everything else is a paragraph; a URL on its own
line becomes a link whose text is the URL. No inline formatting, no HTML
passthrough. `parseRichText(text): Block[]` is the one function; the page
renders Blocks to React elements (no dangerouslySetInnerHTML) and the email
renders Blocks to table-safe HTML through `esc`. Tests cover each block kind,
a `<script>` typed as text staying text, and a 20000-character body.

Attachments stream through `GET /api/orders/[order_id]/files/[deliverable_id]`:
session user must own the order or be an admin; the deliverable must be
published (or the caller an admin); `createSignedUrl(path, 60)` with the
service role client; 302 to it; `Cache-Control: private, no-store`. Not
rate limited beyond the platform's own (an authenticated owner-only read of
a small file).

9.7 Analytics events (lib/analytics.ts)

```
| { name: "review_offer_view"; params: { placement: "blueprint" | "league-overview" | "my-beacon" } }
| { name: "review_checkout_start"; params: { tier: string; method: "stripe" | "paypal" | "venmo"; value: number; currency: "USD" } }
| { name: "review_order_paid"; params: { tier: string; method: "stripe" | "paypal" | "venmo"; value: number; currency: "USD" } }
| { name: "review_external_click"; params: { method: "paypal" | "venmo"; value: number; currency: "USD" } }
```

`review_offer_view` fires once per mount from the offer component;
`review_order_paid` fires from the order page when it first renders a paid
state after `?session_id=` or when a `paid` event is newer than the page's
last visit (a `sessionStorage` key `order-paid-<id>` guards the repeat). A
complimentary order fires `review_order_paid` with `value: 0`.

9.8 Attachment upload (admin browser to Storage, never through a server action)

A server action body is capped at 1 MB by Next's default
(`serverActions.bodySizeLimit`, not raised in next.config.ts) and a Vercel
function request body at about 4.5 MB whatever the setting, so a 10 MB file
cannot travel through an action. The bytes go straight from the admin's
browser to Supabase Storage with a signed upload URL, in three steps, all in
components/admin/attachment-uploader.tsx (client) and
app/admin/orders/actions.ts:

1. `requestAttachmentUploadAction(orderId, { fileName, mimeType, size })`:
   requireAdmin; the order exists; `mimeType` is one of the bucket's allowed
   types and `size` is 1 to 10485760; `sanitizeFileName` (16); insert an
   `order_deliverables` row (kind `attachment`, status `draft`, `upload_state`
   `pending`, `storage_path = orders/{order_id}/{deliverable_id}/{name}`,
   `file_name`, `mime_type`, `file_size`); then
   `admin.storage.from("order-files").createSignedUploadUrl(storage_path)`
   and return `{ deliverableId, path, token }`. The token is good for two
   hours (Supabase's default) and authorizes exactly one object at exactly
   that path.
2. The browser calls `createClient()` from lib/supabase/client.ts and
   `storage.from("order-files").uploadToSignedUrl(path, token, file, {
   contentType: mimeType })`. Progress is shown as the words "Uploading
   owls-trade-targets.pdf" in a `role="status"` region (the JS client exposes
   no progress events, so no bar is drawn). The bucket's own
   `file_size_limit` and `allowed_mime_types` are enforced by Storage on this
   PUT regardless of what the browser claims.
3. `finalizeAttachmentAction(deliverableId)`: requireAdmin; read the row;
   `admin.storage.from("order-files").list("orders/{order_id}/{deliverable_id}")`
   must return the object; write the real `file_size` from the listing's
   `metadata.size` and set `upload_state = 'ready'`; insert event
   `attachment_added` (admin, NOT visible, "Attached <file name>"). A
   listing that does not contain the object returns "The upload did not
   finish. Try again." and leaves the row `pending` for the cron to clear.

`deleteDeliverableAction` removes the Storage object first (ignoring a
not-found) and then the row. The cron (15, step 5) deletes `pending`
attachment rows older than 24 hours and the object at their path if one got
there. The files route (9.6) serves only `ready` and `published` rows to a
customer, because the owner-select policy already says so (5.6).

---------------------------------------------------------------------------

## 10. Admin surfaces

All under requireAdmin with the path, force-dynamic, reading with the
service role client, writing through server actions in
app/admin/orders/actions.ts that each call requireAdmin again. A subnav
components/admin/orders-subnav.tsx with Orders, New order, Products,
Coupons, Settings (the signal-check-subnav shape) sits under the h1 of each
page.

10.1 `/admin/orders`

Header: eyebrow "Orders", h1 "Orders", one sentence "Every purchase, where it
is, and what is due." Then:

Figures (section 11.2 tiles, 2 columns below sm, 3 at sm, 6 at lg):
- Needs attention: count of orders where ANY of: (payment_status =
  awaiting_confirmation and customer_reported_paid_at is not null); (due_at
  < now and fulfillment in queued, in_progress); (dispute_status = 'open');
  (duplicate_payment_intent_id is not null and duplicate_resolved_at is
  null); (mismatch_amount_cents is not null); (payment_status = paid and
  receipt_email_status is distinct from 'sent' and paid_at < now - 1 hour).
  The hint line under the figure names the reasons with counts ("1 reported
  payment, 1 overdue, 1 chargeback"). Tone danger when > 0. The predicate is
  ONE function, `needsAttention(order)` in lib/commerce/figures.ts, with a
  SQL twin `ATTENTION_FILTER` used by the tab query, and the test asserts
  the two agree over a table of orders.
- In the queue: fulfillment = queued and paid.
- In progress.
- Awaiting payment: unpaid or awaiting_confirmation, not reported.
- Revenue, 30 days: sum of (amount_cents - refunded_cents) where paid_at in
  the last 30 days, livemode is not false, payment_status in (paid,
  refunded). Complimentary orders add zero by construction. Under it a
  12-week bars chart (components/commerce/revenue-bars.tsx): one bar per week
  ending Sunday Eastern, `role="img"` with an aria-label naming the total and
  the best week, a `<details>` under it with a real table (week starting,
  orders, revenue, refunded).
- Turnaround, 30 days: mean of (delivered_at - paid_at) in days with one
  decimal over orders delivered in the last 30 days; "No deliveries yet" when
  none.

Tabs (`ViewTabs`, `?view=`): Needs attention (default when its count > 0,
else Queue), Queue (queued + in_progress ordered by due_at), Awaiting payment,
Delivered, Cancelled and refunded, All. When `q` is set the tab filter is
ignored.

Search (GET form, `?q=`, components/admin/order-search.tsx, a labeled input
"Find an order" with the hint "Order number, or part of an email address").
Resolution in lib/commerce/orders.ts `searchOrders(admin, q, page)`:
1. `q` trimmed and upper-cased matches `/^FFB-\d{6,}$/`: orders where
   `order_number = q`, one row.
2. `q` matches `/^[0-9a-f-]{36}$/`: orders where `id = q`.
3. Otherwise, and `q` is at least 2 characters: `search_order_customers(q,
   50)` (5.11) returns up to 50 user ids whose email contains `q`; orders
   where `user_id in (...)`, newest first, paged. Zero ids: the empty state
   "No customer has an email containing <q>."
Display names are not searched: a display name is derived at render time
from several sources (lib/user-identity.ts) and is not a stored column
anywhere, so a search over it would have to load every user, which is the
thing this design exists to avoid. The hint says email, and the Customer
panel on every order links to `?q=<email>` so one click finds a person's
other orders.

Identities for the rows on screen come from `lookupCustomers(admin, ids)` in
lib/commerce/customers.ts: ONE `order_customer_identities` RPC call with the
page's distinct user ids, ONE `user_preferences` read (`user_id, first_name,
last_name`) for the same ids, then `deriveDisplayName(..., "private")` per
row. Never `auth.admin.listUsers`, and never `getUserById` in a loop over a
page. The email for a single order page comes from `lookupCustomers` with one
id, the same way.

The list: ruled rows, one per order, each row a link to the order page
wrapping these cells: order number (mono) with a "Test" chip when livemode is
false and a "Free" chip when amount_cents is 0; customer (display name, email
under it in subtle); product name; team in league; amount with method word
(and "partly refunded" when refunded_cents > 0); payment chip and, when set,
the chargeback chip; fulfillment chip; due ("Due in 2 days" / "Overdue by 1
day" in danger / "Delivered Oct 28"); placed (relative, with the Eastern full
time in a `title`-free sr-only span). Below md the row is two lines: line one
order number, customer, amount; line two product, team, chips, due. Nothing
hidden. `Pager` 25 per page.

10.2 `/admin/orders/[order_id]`

Header: h1 "Order FFB-100001", the two chips (plus the chargeback chip and
the Free chip when they apply), the amount large, placed date. (A link to the
customer's own order page is NOT rendered: it would 404 for the admin by RLS.
The admin reads the same data in the panels below.) Under the header, zero
or more BANNERS, each a `role="status"` block in danger tone with one
sentence and one button, drawn in this order when their condition holds:
- Chargeback: "A chargeback is open on this payment (<reason>, evidence due
  <due_by Eastern>). Do not deliver until it is resolved unless you choose
  to." Button "Open in Stripe" (the dispute's Dashboard URL,
  `https://dashboard.stripe.com/payments/<pi>` or the `/test/` form).
- Duplicate payment: "A second payment of <amount> arrived on this order
  (<pi>). Refund it in Stripe, then mark it here." Button "Mark duplicate
  refunded" (`resolveDuplicatePaymentAction(orderId)`: stamps
  `duplicate_resolved_at`, inserts an internal `note`). Shown until stamped.
- Amount mismatch: "Stripe reported <reported> for an order of <expected>.
  The order was not marked paid." Buttons "Confirm payment anyway"
  (`confirmManualPaymentAction` with the Stripe payment intent as the
  reference, paid_via 'manual') and "Cancel order".
- Receipt: "The receipt email was not sent (<status>: <error>)." Button
  "Send the receipt now" (`resendReceiptAction(orderId)`, which calls
  `sendReceipt`, 8.1).

Then a two-column grid from lg (left 2/5, right 3/5), single column below:

Left column panels (Panel component, h2):
- Customer: display name, email (a `mailto:` link with the address as its
  text), Sleeper handle from the saved identity when present, member since,
  count of prior orders with a link to the list filtered `?q=<email>`, and
  "1 open chargeback on another order" in danger tone when true.
- Order: product name and tier, list price, discount and code when a coupon
  applied ("$4.00 off with SAVE20") or "Complimentary, created by you" for
  an admin order, amount, method, payment status with the words from section
  7.4, refunded so far when `refunded_cents > 0`, paid at, paid via, Stripe
  session and payment intent as links to
  `https://dashboard.stripe.com/payments/<pi>` (test mode:
  `https://dashboard.stripe.com/test/payments/<pi>`), external reference,
  due by, turnaround.
- Team: team name, league name and season, record from the Blueprint
  snapshot, format, source, overall grade and standing from the snapshot
  ("No Blueprint was built at order time" when null), and the four links
  (Blueprint, Overview, Lineups, Trade Ideas) to the live league pages.
- Intake: direction, questions, off limits, as a dl with the text rendered
  as text (white-space pre-line).
- Internal notes: the `order_events` rows with kind `note` and
  `visible_to_customer = false`, newest first, each with its Eastern time
  and body (white-space pre-line), then a textarea (max 5000) labeled
  "Add an internal note (never shown to the customer)" and a button "Save
  note" calling `addInternalNoteAction(orderId, body)` (5.4). There is no
  edit or delete: a note is a dated record, and a correction is another
  note.

Right column panels:
- Workflow: the 4-step tracker; a `<select>` of fulfillment statuses allowed
  from the current one (lib/commerce/transitions.ts), a note textarea (max
  1000), a checkbox "Email the customer about this change" (requires a note;
  the client disables submit until one is typed when checked), button
  "Update status". Calls `setFulfillmentStatusAction`.
- Payment: for awaiting_confirmation: "Customer reported sent at <time>" or
  "Not reported yet", a reference field prefilled from the customer's text,
  a date-time field defaulting to now, buttons "Confirm payment" and "Not
  received" (the latter opens a note field and a notify checkbox). For
  unpaid Stripe orders the same "Confirm payment" exists under the heading
  "Confirm by hand" with the sentence "Only when you can see the payment in
  Stripe and the webhook did not record it." (`confirmManualPaymentAction`
  works for every method; `paid_via` is `manual`). For paid or partly
  refunded orders: "Record a refund" with amount (defaults to the remaining
  amount, max the remaining amount), note, and a notify checkbox (default
  on), the sentence "Refund the money in Stripe, PayPal or Venmo first. This
  records it; it does not move money.", and for Stripe orders the label
  reads "Record a refund made in Stripe" with "The webhook normally records
  these on its own; use this if it did not." (6.7). Fully refunded: the
  sentence "Fully refunded on <date>" and no button. For unpaid/expired:
  "Cancel order" with a note and a notify checkbox.
- Deliverable: the sections list (title, status chip, order arrows, Edit
  opens an inline form with title and a textarea with the rich text hint
  "Blank line for a paragraph, ## for a heading, - for a bullet"), "Add
  section" (prefilled title suggestions: "The short version", "Direction",
  "Position by position", "Buy, sell, hold", "Trades to pursue", "This week's
  lineup", "Draft capital", "Closing note"), "Attach a file" (the uploader
  from 9.8: a labeled file input with the accepted types and "up to 10 MB"
  in its description, the three-step upload, and a `role="status"` line for
  progress and the result; a `pending` row shows "Upload did not finish"
  with a Retry that re-requests a token for the same row and a Remove), a
  preview (`<details>`) rendering every section through the same renderer
  the customer sees, and the primary button "Publish and mark delivered"
  (disabled until at least one section exists; disabled while any attachment
  is `pending`, with the reason in the button's description) which calls
  `publishDeliveryAction`: sets every section and every `ready` attachment
  `published`, fulfillment `delivered`, `delivered_at` if null, inserts the
  `delivered` event ("Your review is ready"), sends E5. When
  `dispute_status = 'open'` the button is replaced by a checkbox "I
  understand a chargeback is open on this order" that must be ticked before
  the button is enabled; the action re-checks and refuses without the
  acknowledgement flag. After delivery the button reads "Save changes"
  (publishes new or edited sections, inserts `delivery_updated`, sends E12
  only when a notify checkbox is ticked) and a second button "Re-send the
  delivery email".
- Email the customer: subject (max 160), body textarea (max 8000, rich text
  hint), a preview `<details>`, button "Send email". Calls
  `sendOrderEmailAction`: requireAdmin, sendEmail to the customer with no
  replyTo override, insert `order_messages`, insert `email_sent` event,
  revalidatePath. A failed send shows the error and records status failed.
- Timeline: every event including `visible_to_customer = false` ones (those
  carry an "Internal" chip), newest first, plus the messages.

10.3 `/admin/orders/products`

h1 "Products". A list of every product (active and inactive), each an
expandable editor (components/admin/products-manager.tsx, client): slug
(read-only after creation), family, tier rank, name, tagline, description,
badge, features (one per line textarea; saved as the array; max 12 lines),
price in dollars (a text input parsed with the donation
`parseDonationAmount` rules then stored as cents; the field shows the stored
cents formatted), turnaround days, placements (three checkboxes), active,
display order, and Save. "Add product" at the foot: slug, family, tier rank,
name, price required; the rest defaulted. Validation in
lib/commerce/products.ts `productInputSchema` (zod) runs on the server
action `saveProductAction`. Deleting is not offered; deactivate instead
(orders reference products with `on delete restrict`). A note at the top:
"Changing a price changes new orders only. Every past order keeps the price
it was sold at."

10.4 `/admin/orders/settings`

The settings form (components/admin/commerce-settings-manager.tsx) with
`SettingsSection` groups matching section 14: Storefront (enabled, fully
booked, max open orders, count pending payment, fully booked message),
Payments (three method switches, manual expiry days, reminder day, Stripe
session minutes, Stripe unpaid expiry hours), Coupons (enabled),
Notifications (admin email, three switches), Emails (receipt retry max,
receipt retry after minutes), Rate limits (four numbers), Placements (three
switches). `SettingsSaveBar`. Saving calls `saveCommerceSettingsAction`
(validate, save, bustMemo, revalidatePath of the admin pages; revalidation
of the dynamic league pages is not possible, so they read settings through
memoTtl with a 60-second TTL and the change lands within a minute).

10.5 `/admin/orders/coupons`

h1 "Coupons". One sentence under it: "A code a customer types at checkout.
A code that covers the whole price makes the review free and skips payment."
A list of every coupon (components/admin/coupons-manager.tsx, client), each a
ruled row with the code in mono, the discount in words ("20% off", "$5.00
off", "100% off (free)"), the scope ("Any review", "team-review family",
or the product name), redemptions used over the cap ("3 of 10", "3, no
cap") computed by `countCouponRedemptions` (5.9), the window in Eastern
dates, an Active chip, and an Edit that opens the inline editor: code
(read-only after creation), kind (percent or amount) with the matching
number field, product family (text, optional), product (select of active
products, optional), max redemptions (optional), max per customer (default
1), starts at and expires at (date-time inputs, Eastern, optional), active,
note (admin only, max 500). "Add coupon" at the foot with code, kind and the
number required. Validation in lib/commerce/coupons.ts `couponInputSchema`
(zod) on `saveCouponAction` and `createCouponAction`: the code is
upper-cased and must match the pattern; percent 1 to 100; amount 1 to
100000 cents; a family must match the slug pattern; `expires_at` after
`starts_at` when both set. Deleting is not offered; deactivate instead
(orders reference coupons). A row's "Copy code" button uses the
components/copy-link-button.tsx pattern.

10.6 `/admin/orders/new`

h1 "Create an order for a customer". One sentence: "A complimentary order: no
payment, paid and queued the moment you create it. The customer gets an email
and can add their questions from the order page."
components/admin/new-order-form.tsx (client), fields in order:
1. Customer: a labeled text input "Customer email" with a "Find" button
   calling `searchCustomersAction(q)` (requireAdmin, `search_order_customers`
   RPC, 5.11) and a `role="radiogroup"` of the matches (display name and
   email, native radios in labels); none found: "No account has an email
   containing that."
2. Product: a native select of active products ordered by family and tier.
3. League: a labeled input "Sleeper league id" (digits only) with a "Load
   teams" button calling `loadLeagueTeamsAction(sleeperLeagueId)`
   (requireAdmin; `leagues` row by sleeper_league_id must already exist, the
   action never syncs a league: "That league has not been opened in League
   Pulse yet. Open it once at /leagues/<id>, then come back."; then
   `loadRosters`), which fills
4. Team: the shared roster select, with the roster whose owner matches the
   chosen customer's saved Sleeper id preselected when there is one.
5. Note to the customer (optional, max 1000, goes into E13).
6. Internal note (optional, max 5000, becomes an internal `note` event).
Button "Create the complimentary order" calls
`createComplimentaryOrderAction(input)`: requireAdmin; validate the shape;
the user id exists (`order_customer_identities`); product active; league and
roster exist; capacity is NOT checked (the admin is choosing to do the
work); `resolveLeagueContext` and `readCachedBlueprint` for the context as
6.1 step 11; insert per 6.9's complimentary shape with `origin = 'admin'`;
`try_mark_order_paid(id, 'complimentary', null, now(), null, null)`; event
`created` (admin, visible, "Michael created this order for you") and the
`paid` event; E13 in `after()`; redirect to `/admin/orders/<id>`. Not rate
limited (behind requireAdmin).

---------------------------------------------------------------------------

## 11. Design specification

The owner's brief: no generic dashboard boxes, big obvious primary numbers,
visuals wherever a proportion or a state exists (bars, status marks,
progress), the same report-card language the Leaderboards and the Blueprint
sheet use. Brand only: dark surfaces, purple #A855F7 and cyan #22D3EE as
accents, Geist Sans for words and Geist Mono for every figure, the tokens in
tailwind.config.ts (base, surface, line, ink, brand, signal). Nothing from
DPC.

11.1 The sheet, again

The customer order page and the admin order page are both ONE sheet
(`Sheet`, `SheetSection`, `Leader`, `RULED`, `Bar` from
components/league-blueprint/sheet.tsx, imported directly). The checkout page
is a sheet too: four numbered sections (01 to 04) with the number and title
in the margin column from lg. Inside a section nothing is boxed except the
radio cards in sections 01 and 04 of the checkout, because a choice between
peers is the one place a card earns its border, and the price box in a tier
card, for the same reason the Blueprint's grade box exists.

11.2 Figures

`components/commerce/figure-tile.tsx`: a `<div>` with a `<dt>` label (11px
uppercase tracking-wide text-ink-subtle), a `<dd>` value in `font-mono
text-4xl font-black tabular-nums leading-none` (text-5xl at sm), an optional
hint line, and an optional `Bar` under the value. Tone classes on the value:
positive, warning, danger, cyan, purple, or ink. The figure is ONE text
node; a unit or a missing word is appended `sr-only` inside the same
element ("of 10", "dollars"). Tiles sit in a `<dl>` grid with gap-3, no
border on the tile (ruled by the grid's own spacing), hairline above the row.

The tier card's price: `font-mono text-5xl font-black tabular-nums` with the
cents in `text-2xl` superscripted by `align-top` ("$9" and "95" as one text
node "$9.95" styled with two spans that are NOT aria-hidden; the whole price
is the text). "one time" under it in 11px uppercase.

The order sheet letterhead's amount box: the Blueprint `GradeBox` pattern
with "Amount" above, the amount in text-6xl gradient text (`bg-beacon
bg-clip-text text-transparent`), the payment chip under it.

11.3 Progress tracker

`components/commerce/order-progress.tsx`: an `<ol>` with four `<li>` in a
row (a column below sm with the connector vertical), each with a 28px circle
mark and the step word. Marks: complete = filled `bg-signal-positive` with a
lucide `Check` (aria-hidden) and the sr-only word "complete"; current =
ring `border-2 border-brand-cyan` with a pulsing dot (no motion under
`prefers-reduced-motion`) and `aria-current="step"`; upcoming = `border
border-line` hollow; failed = `bg-signal-danger` with lucide `X` and the word
"did not complete". The connector between marks is a 2px line, filled
`bg-signal-positive` up to the last complete step and `bg-line` after, drawn
with a `Bar`-style span, aria-hidden. Under each step word a small line of
mono text with the time it happened (formatEastern short date) or nothing.
`compact` prop drops the words and times to a one-line strip of four marks
with an `aria-label` naming the state ("Paid, in progress").

11.4 Chips

`components/commerce/status-chip.tsx`: `inline-flex items-center gap-1
rounded-full border px-2 py-0.5 text-[11px] font-semibold` with the state
word and a 6px dot (aria-hidden) in the tone color. Tones:

```
positive  border-signal-positive/40 bg-signal-positive/10 text-signal-positive
warning   border-signal-warning/40  bg-signal-warning/10  text-signal-warning
danger    border-signal-danger/40   bg-signal-danger/10   text-signal-danger
cyan      border-brand-cyan/40      bg-brand-cyan/10      text-brand-cyan
purple    border-brand-purple/40    bg-brand-purple/10    text-brand-purple-light
muted     border-line               bg-base/50            text-ink-muted
```

The word is always present; the dot never carries meaning alone.

11.5 Tier cards (components/commerce/tier-card.tsx)

A `<label>` wrapping a native radio (sr-only) and the card: `rounded-card
border bg-surface/60 p-5`, `border-line` at rest, `border-brand-cyan
ring-1 ring-brand-cyan` when checked (`has-[:checked]:` utilities), a
focus ring through `has-[:focus-visible]:outline`. Inside: the badge as a
chip (purple tone) at the top right when present; the name as the card's
heading text (not a heading element, the fieldset legend is the heading);
the price block (11.2); the turnaround sentence; the feature `<ul>` with
`Check` marks; nothing else. Two cards side by side from sm, stacked below.
As a non-interactive OFFER (the Blueprint section, the overview strip's
expanded form) the same card renders with a link button "Order the Premium
Review" at the foot instead of being a radio.

11.6 Revenue bars (components/commerce/revenue-bars.tsx)

An inline `<svg>` 12 bars, viewBox 0 0 240 64, each bar `fill` brand purple
with the best week cyan, a faint baseline, the week labels as the table
under it rather than in the SVG (too small to read at 12 columns). The SVG is
`role="img"` with an `aria-label` sentence; the `<details>` table is the
data. No library.

11.7 Lists

Ruled rows everywhere (`RULED`), 44px minimum row height, the whole row a
link where the row IS a navigation (admin list, customer list) with the
order number as the link's leading text so a screen reader hears the number
first.

11.8 Empty, loading, error states

Loading: `app/my-beacon/orders/loading.tsx` and `app/admin/orders/loading.tsx`
draw the sheet skeleton (components/league-blueprint/body-skeleton.tsx
pattern) with the known words. Empty: one sentence and one link, never a
blank panel. Error: the server actions return sentences; route handlers
return JSON; nothing renders a stack trace.

---------------------------------------------------------------------------

## 12. Accessibility

Every rule in CLAUDE.md applies. Specific to this build:

- One h1 per page: checkout "Personal Team Review"; customer list "Orders";
  customer order "Order FFB-100001" (the letterhead h2 is the product name);
  admin pages as named in section 10.
- Fieldsets with legends for every group on the checkout; native radios in
  labels; the submit button's text names the action and the amount.
- The progress tracker is an ordered list with `aria-current="step"` on the
  current step; every mark has a word.
- Every chip carries its word. Every figure is one text node with sr-only
  words inside the same element. Nothing visible is aria-hidden except
  decorative icons, the connector line, the chip dot and the SVG bars (which
  have their table).
- The copy buttons announce through the shared live region pattern
  (components/copy-link-button.tsx).
- The pay links say "opens in a new tab" in the accessible name.
- The rich text renderer produces real headings (h3 under the section's h2),
  lists and paragraphs.
- Focus moves to the alert region on a failed submit and to the h1 after a
  successful status change on the admin page (the page re-renders; a
  `role="status"` region announces "Status updated to In progress").
- Admin file input has a visible label and the accepted types and size in
  its description.
- Tap targets 44px: every button, link row, radio card and chip-link.
- Timestamps: formatEastern everywhere, including emails.
- Mobile: nothing hidden at any width; the admin list row restacks to two
  lines; the tier cards stack; the tracker goes vertical.

---------------------------------------------------------------------------

## 13. Security

- Price never comes from the client. The action takes a product slug and a
  coupon code and reads the price; the client's `expectedCents` is compared,
  never used (3.17).
- Ownership: customer reads use the session client (RLS); every customer
  action re-reads the order with the service role client and compares
  `user_id` to the session user before doing anything.
- No customer-readable table carries a column the customer must not see
  (section 5 heading note). Internal notes, dispute, duplicate and mismatch
  events are `visible_to_customer = false`; `coupons`,
  `payment_webhook_events` and the lookup RPCs are service role only.
- Admin actions call requireAdmin first, then validate, then write.
- Webhook: raw body, signature verified first, fails closed without the
  secret, event recorded by id before anything else, product tag checked,
  order looked up by our own ids (the metadata fallback validated as a
  uuid), amount and currency compared before any paid transition, 200 for
  anything that must not be retried.
- Idempotency: `try_mark_order_paid`, unique stripe_session_id,
  `payment_webhook_events`, `refunded_cents` as a running total that only
  grows, reminder_sent_at, the delivered event, `receipt_email_status`.
- One payable Stripe session per order: `expireCheckoutSession` before any
  replacement, switch or cancel; a `complete` answer there is treated as a
  payment, never ignored.
- Rate limits (all fail closed, claimed after validation):
  `order-checkout` 6/min, `order-reconcile` 10/min, `order-report` 6/min,
  `order-stripe-retry` (startStripeCheckoutAction, switchPaymentMethodAction,
  cancelOwnOrderAction) 6/min, `order-coupon-preview` 20/min. Admin actions
  are not metered (behind requireAdmin).
- Coupon codes are compared after normalization against a service-role-only
  table; a wrong code gives the same sentence as a missing one, and the
  preview is metered, so the table cannot be enumerated quickly.
- The signed upload token authorizes one path, minted only by an admin
  action that already wrote the row at that path; the bucket enforces size
  and type on the PUT regardless of the browser.
- No open redirect: every redirect target is `/my-beacon/orders/<uuid>` on
  our origin or a Stripe URL whose host was checked.
- Stored text (intake, notes, messages, deliverables, references) is
  rendered as text, never as HTML. The rich text renderer emits elements
  from a parsed structure, not markup.
- Stripe metadata is redacted through `redactStripeEvent`. No card data, no
  billing address, no customer_details is stored anywhere.
- Storage bucket is private; reads are owner-or-admin checked and signed
  for 60 seconds; the path is built from ids and a sanitized file name
  (`/[^A-Za-z0-9._-]/g` replaced with `-`, max 100 characters).
- Emails: the recipient address is read from Auth, never from a request
  body. Subject and body lengths are capped. Reply-To is never set by a
  customer.
- Logs mask addresses (lib/email/send.ts already does; this build logs
  order ids and numbers, never emails).
- Secrets: STRIPE_SECRET_KEY, STRIPE_ORDERS_WEBHOOK_SECRET, RESEND_API_KEY,
  SUPABASE_SECRET_KEY are server-only. Nothing new reaches the browser.
- `lib/security/order-pages-auth.test.ts`: a route-level test that
  /admin/orders pages call requireAdmin and the customer pages read with the
  session client (grep-style guard, like lib/security/league-refresh-public.test.ts).

---------------------------------------------------------------------------

## 14. Settings

lib/commerce/default-settings.ts:

```
export const DEFAULT_COMMERCE_SETTINGS = {
  version: 1,
  storefront: {
    enabled: true,
    fullyBooked: false,
    maxOpenOrders: 10,
    countPendingPayment: true,
    fullyBookedMessage: "Michael is fully booked right now. Check back in a few days.",
  },
  payments: {
    stripe: true,
    paypal: true,
    venmo: true,
    manualExpiryDays: 7,
    manualReminderDay: 3,
    stripeSessionMinutes: 60,
    stripeUnpaidExpiryHours: 25,
  },
  coupons: { enabled: true },
  notifications: {
    adminEmail: "michael@ffbeacon.com",
    notifyOnNew: false,
    notifyOnPaid: true,
    notifyOnReported: true,
  },
  emails: { receiptRetryMax: 3, receiptRetryAfterMinutes: 10 },
  rateLimits: {
    checkoutPerMinute: 6,
    reconcilePerMinute: 10,
    reportPaymentPerMinute: 6,
    couponPreviewPerMinute: 20,
  },
  placements: { blueprintSection: true, overviewStrip: true, myBeaconTile: true },
} as const;
```

`stripeUnpaidExpiryHours` is now used only for an unpaid Stripe order that
has NO session (the create call failed, 6.1 step 14); an order with a session
expires 5 minutes after Stripe's own `expires_at` (6.2). The duplicate,
mismatch and dispute notifications have no switch: they are always sent.

lib/commerce/settings.ts: zod schema with `.default()` on every field
(bounds: maxOpenOrders 1..500, manualExpiryDays 1..30, manualReminderDay
1..29 and less than manualExpiryDays, stripeSessionMinutes 30..1440 (Stripe's
own limits), stripeUnpaidExpiryHours 1..72, receiptRetryMax 0..10,
receiptRetryAfterMinutes 1..1440, rate limits 1..120, adminEmail a valid
address), `loadCommerceSettings(admin)`
through `memoTtl("settings:commerce", 60_000, ...)`, `saveCommerceSettings`,
`validateCommerceSettings`, `COMMERCE_SETTINGS_MEMO_KEY`. The row is read on
every storefront render through the memo, so a save lands within a minute on
every instance.

---------------------------------------------------------------------------

## 15. Cron: order maintenance

`GET /api/cron/order-maintenance`, hourly at minute 40 (`40 * * * *` in
vercel.json), registered in CRON_JOBS as `order-maintenance` with label
"Order maintenance" and description "Expires unpaid orders and sends the one
PayPal and Venmo reminder.", `verifyCronRequest`, `recordCronRun`,
`maxDuration = 60`. Body in lib/commerce/maintenance.ts
`runOrderMaintenance(admin, settings, now)`:

1. Reminders: orders where payment_status = awaiting_confirmation,
   customer_reported_paid_at is null, reminder_sent_at is null, created_at <
   now - manualReminderDay days, limit 50: send E6, set reminder_sent_at,
   insert event `note` (system, visible, "Reminder email sent").
2. Manual expiry: payment_status = awaiting_confirmation,
   customer_reported_paid_at is null, expires_at < now, limit 100: set
   expired, fulfillment cancelled, insert `payment_expired`, send E10. A
   REPORTED but unconfirmed order is never expired by the cron: it stays in
   Needs attention until the admin decides.
3. Stripe expiry: payment_method = stripe, payment_status = unpaid, expires_at
   < now, limit 100: set expired, insert `payment_expired`, no email. Because
   `expires_at` sits 5 minutes past Stripe's own session expiry (6.2),
   Stripe's `checkout.session.expired` event normally gets there first and
   this step finds nothing; it exists for the webhook being down.
4. Receipt retry: payment_status = paid, receipt_email_status in
   ('pending','failed','skipped'), paid_at < now - `emails.receiptRetryAfterMinutes`,
   receipt_email_attempts < `emails.receiptRetryMax`, limit 50: call
   `sendReceipt` (8.1) for each. The status row is the whole guard; no event
   is read.
5. Abandoned uploads: `order_deliverables` where kind = attachment,
   upload_state = pending, created_at < now - 24 hours, limit 100: remove the
   Storage object at `storage_path` (ignore not found), delete the row.
6. Ledger prune: delete from `payment_webhook_events` where received_at <
   now - 90 days, one statement.

Returns `{ reminders, expiredManual, expiredStripe, receiptsRetried,
uploadsCleared, eventsPruned }`. It iterates orders, not leagues, bounded by
the limits, and recomputes nothing.

---------------------------------------------------------------------------

## 16. Module map

New files unless marked (changed).

Shared Stripe (a mechanical extraction; donation behavior unchanged):
- lib/stripe/client.ts: `stripeRequest`, `encodeForm`, `secretKey`,
  `versionHeader`, `stripeConfigured`, `isCheckoutSessionId`,
  `retrieveCheckoutSession`, NEW `expireCheckoutSession(sessionId)` (POST
  `/checkout/sessions/{id}/expire`; returns `StripeResult<CheckoutSession>`,
  and a 400 whose body `error.code` names an already expired or complete
  session is returned as `{ ok: false, reason: "error", detail:
  "already-closed" }` so the caller can retrieve and decide), types
  `StripeResult`, `CheckoutSession` (gains `expires_at: number | null`). Log
  prefix `[stripe]`.
- lib/stripe/client.test.ts: the encodeForm, key shape and retrieve tests
  moved from lib/donate/stripe.test.ts.
- lib/stripe/outcome.ts: `checkoutOutcome` (the body of donationOutcome) and
  its test moved.
- lib/donate/stripe.ts (changed): keeps `createDonationCheckout`, imports
  from lib/stripe/client.ts, re-exports `retrieveCheckoutSession`,
  `isCheckoutSessionId`, `stripeConfigured`, `StripeResult`,
  `CheckoutSession`. lib/donate/stripe.test.ts keeps the donation session
  tests (no payment_method_types, submit_type donate).
- lib/donate/outcome.ts (changed): `export { checkoutOutcome as
  donationOutcome }` plus the type.
- app/api/donate/webhook/route.ts (changed): the product tag guard (6.5).
- app/api/donate/webhook.test.ts or the existing donation webhook test file
  (changed): the not-a-donation case.

Commerce library (lib/commerce/):
- types.ts: `Order`, `OrderEvent`, `OrderMessage`, `OrderDeliverable`,
  `Product`, `ProductSnapshot`, `Coupon`, `TeamReviewContext`,
  `TeamReviewIntake`, `PaymentMethod`, `PaymentStatus`, `FulfillmentStatus`,
  `DisputeStatus`, `ReceiptEmailStatus`, with the rules of section 3 in its
  header.
- constants.ts: `SELLER_NAME` ("FF Beacon"), `SELLER_EMAIL`
  ("michael@ffbeacon.com"), `REFUND_POLICY_SENTENCE` (3.9), `ORDER_NUMBER_RE`.
- default-settings.ts, settings.ts (section 14).
- coupons.ts: `normalizeCode`, `resolveCoupon` (6.9, pure over a loaded row
  plus two counts injected as numbers), `countCouponRedemptions(admin,
  couponId, userId?)`, `discountFor(coupon, listCents)` (pure),
  `couponInputSchema`, `saveCoupon`, `loadAllCoupons`. coupons.test.ts.
- customers.ts: `lookupCustomers(admin, ids)` and `searchCustomers(admin,
  q)` over the two RPCs in 5.11 plus `deriveDisplayName`. Never
  `listUsers`.
- products.ts: `loadActiveProducts(client, family?)`, `loadAllProducts`,
  `productInputSchema`, `saveProduct`, `snapshotProduct`, `featuresFromLines`,
  `linesFromFeatures`.
- intake.ts: `createOrderInputSchema`, `TEAM_REVIEW_QUESTIONS` (labels,
  hints, max lengths; the one place the form's words live), `intakeSchema`.
- transitions.ts (section 7) and transitions.test.ts.
- pay-links.ts (6.6) and pay-links.test.ts.
- orders.ts: `createOrder` (the insert and the events), `loadOrderForOwner`
  (session client), `loadOrderForAdmin`, `listOrdersForOwner`,
  `listOrdersForAdmin(filters, page)`, `searchOrders(admin, q, page)` (10.1),
  `countOpenOrders(admin, settings)` (3.10), `findOpenDuplicate`,
  `findReviewsInProgress(userId, sleeperLeagueId)` (for the 9.3 notice),
  `insertEvent`, `markPaidIfWon` (the RPC call plus the `paid` event, then
  `sendReceipt` and A2; used by webhook, reconcile, manual confirm and both
  complimentary paths), `sendReceipt(order)` (8.1, owns
  `receipt_email_status`), `recordRefund(order, deltaCents, source, note)`
  (the one arithmetic for 6.3, 6.7 and 6.8), `customerEmailFor(userId)` (one
  `order_customer_identities` call).
- stripe.ts: `startStripeCheckout(order, email)` (6.2, including the
  expire-first step), `closeOpenSession(order)` (the expire-then-retrieve
  decision shared by start, switch and cancel), `stripeDashboardUrl`,
  `stripeDisputeUrl`.
- reconcile.ts (6.4).
- disputes.ts: `applyDisputeEvent(admin, order, event)` (6.8), pure decision
  plus the writes, and its test.
- rich-text.ts and rich-text.test.ts (9.6).
- figures.ts: the admin figures and the 12-week revenue buckets (pure over
  rows; tested), `turnaroundDays`.
- maintenance.ts and maintenance.test.ts (15).
- deliverables.ts: `listDeliverables`, `saveSection`, `deleteDeliverable`
  (object then row), `beginAttachment` (the row plus `createSignedUploadUrl`),
  `finalizeAttachment` (the listing check), `publishAll` (ready rows only),
  `clearAbandonedUploads`, `sanitizeFileName` (tested).
- notify.ts: `ADMIN_EMAIL` resolution (settings first, env second, constant
  third) and the A1 to A7 senders.
- availability.ts: `offerAvailability(settings, openCount, stripeOk)` ->
  `{ open: boolean, reason: "closed" | "fully_booked" | null, methods:
  PaymentMethod[] }`, pure, tested.

Email:
- lib/email/order-emails.ts: every builder and sender in section 8.
- lib/email/order-emails.test.ts: subject and body assertions per email,
  Eastern timestamps, no replyTo on customer sends (a spy on sendEmail
  asserting `replyTo` is undefined), reply-to equals the customer address
  on admin sends.
- lib/email/reply-to-guard.test.ts: scans lib/email/*.ts for `replyTo:` and
  allows it only in an allow-list naming the admin-notification senders,
  with a reason per entry.

Actions:
- app/actions/commerce.ts: `createOrderAction`, `previewCouponAction`,
  `startStripeCheckoutAction`, `switchPaymentMethodAction`,
  `cancelOwnOrderAction`, `reportManualPaymentAction`, `updateIntakeAction`.
- app/admin/orders/actions.ts: `setFulfillmentStatusAction`,
  `confirmManualPaymentAction`, `markPaymentNotFoundAction`,
  `cancelOrderAction`, `recordRefundAction`, `resolveDuplicatePaymentAction`,
  `resendReceiptAction`, `addInternalNoteAction`,
  `saveDeliverableSectionAction`, `deleteDeliverableAction`,
  `requestAttachmentUploadAction`, `finalizeAttachmentAction`,
  `publishDeliveryAction` (with the dispute acknowledgement flag),
  `resendDeliveryEmailAction`, `resendEventEmailAction`,
  `sendOrderEmailAction`, `saveProductAction`, `createProductAction`,
  `saveCouponAction`, `createCouponAction`, `searchCustomersAction`,
  `loadLeagueTeamsAction`, `createComplimentaryOrderAction`,
  `saveCommerceSettingsAction`.

Routes:
- app/api/orders/webhook/route.ts (6.3) and its test.
- app/api/orders/[order_id]/files/[deliverable_id]/route.ts (9.6).
- app/api/cron/order-maintenance/route.ts (15).

Customer pages and components:
- app/leagues/[league_id]/review/page.tsx, loading.tsx.
- app/my-beacon/orders/page.tsx, loading.tsx.
- app/my-beacon/orders/[order_id]/page.tsx, loading.tsx.
- components/commerce/product-offer.tsx (the offer in a placement: tier
  cards as links, the availability sentence, analytics on mount).
- components/commerce/review-strip.tsx (9.2).
- components/commerce/tier-card.tsx (11.5).
- components/commerce/checkout-form.tsx (9.3, client) and coupon-field.tsx
  (the "Have a code?" disclosure).
- components/commerce/review-in-progress-notice.tsx (9.3).
- components/commerce/cancel-order-button.tsx (9.5, the confirm dialog).
- components/commerce/order-sheet.tsx (9.5 letterhead and sections),
  order-progress.tsx (11.3), status-chip.tsx (11.4), figure-tile.tsx (11.2),
  pay-panel.tsx (6.6, client for the report form), rich-text-view.tsx (the
  Block renderer), order-timeline.tsx, order-list.tsx (shared by the
  customer and admin lists with a `variant`).
- app/leagues/[league_id]/blueprint/page.tsx (changed): section 13.
- app/leagues/[league_id]/page.tsx (changed): the strip.
- app/my-beacon/page.tsx (changed): the tile and the helper sentence.
- lib/nav-tree.ts (changed): two entries. components/app-shell/nav-icons.ts
  (changed) if `receipt` is missing.
- lib/analytics.ts (changed): four events.

Admin pages and components:
- app/admin/orders/page.tsx, loading.tsx, [order_id]/page.tsx,
  products/page.tsx, coupons/page.tsx, new/page.tsx, settings/page.tsx.
- components/admin/orders-subnav.tsx, components/admin/order-search.tsx,
  components/commerce/revenue-bars.tsx,
  components/admin/order-banners.tsx (the four banners of 10.2),
  components/admin/order-workflow-panel.tsx (client),
  components/admin/order-payment-panel.tsx (client),
  components/admin/internal-notes-panel.tsx (client),
  components/admin/deliverable-editor.tsx (client),
  components/admin/attachment-uploader.tsx (client, 9.8),
  components/admin/order-email-composer.tsx (client),
  components/admin/products-manager.tsx (client),
  components/admin/coupons-manager.tsx (client),
  components/admin/new-order-form.tsx (client),
  components/admin/commerce-settings-manager.tsx (client).

Database: supabase/migrations/0343 to 0352, lib/database.types.ts
(regenerated).

Cron: lib/cron-runs.ts (changed), vercel.json (changed).

Docs and config: .env.local.example (changed: STRIPE_ORDERS_WEBHOOK_SECRET
with the comment), docs/README.md (changed: the Active row), CLAUDE.md
(changed at the end: a "Beacon Store and the Personal Team Review" section),
app/terms/page.tsx and app/privacy/page.tsx (changed, section 20), progress.md.

---------------------------------------------------------------------------

## 17. Testing

Vitest, colocated. Every pure module has a test file. The gate is typecheck,
lint (0 and 0), test, build, run after each phase in section 21.

- transitions.test.ts: every allowed and every forbidden transition in the
  two tables; progressStep for each combination in 7.3; a customer cancel is
  refused from paid; the partly-refunded and chargeback chip words.
- coupons.test.ts: normalization (lower case and spaces accepted, symbols
  refused), each refusal sentence in 6.9 order, percent rounding, an amount
  larger than the price capping at the price, a 100% code producing zero,
  the per-user cap, scope by family and by product, the input schema.
- orders.test.ts (pure parts): `recordRefund` arithmetic (partial, then the
  rest, then a redelivery with the same total writing nothing; never above
  amount_cents), `needsAttention` against `ATTENTION_FILTER` over a table of
  orders, the price comparison in `createOrder` (a stale expectedCents
  refused, a zero total with method stripe refused, a zero total with method
  none accepted).
- disputes.test.ts: created sets the columns and writes an internal event;
  funds_withdrawn and reinstated write only events; closed won and
  warning_closed leave money alone; closed lost records the refund through
  `recordRefund`; an event for an unknown payment intent writes nothing; a
  dispute on the duplicate intent stamps `duplicate_resolved_at`.
- stripe.test.ts (lib/commerce): `closeOpenSession` decisions: 200 proceeds,
  already-closed plus retrieved expired proceeds, already-closed plus
  retrieved complete returns "paid" and no session is created, any other
  error aborts; the idempotency key uses attempts + 1; `expires_at` is
  minutes from now within Stripe's bounds.
- customers.test.ts: `lookupCustomers` feeds `deriveDisplayName` correctly
  (metadata name, then first and last, then email local part) and makes one
  RPC call for N ids; `searchOrders` routing by order number, uuid, email.
- pay-links.test.ts: amounts with and without cents, the note text, URL
  encoding of the note, the handle.
- rich-text.test.ts: each block kind, mixed documents, script text stays
  text, numbered lists, a bare URL line, an empty body, a 20000-character body.
- availability.test.ts: closed, fully booked by count, fully booked by
  switch, Stripe unconfigured removing the method, a method switched off.
- figures.test.ts: revenue buckets by Eastern week across a DST change, the
  turnaround mean with none delivered, livemode false excluded.
- maintenance.test.ts: a reported order is never expired; the reminder is
  sent once; the Stripe expiry; the receipt retry respects the attempt cap
  and the delay and retries `skipped`; abandoned uploads are cleared only
  past 24 hours; the ledger prune; the limits.
- products.test.ts: the input schema (slug pattern, price bounds, features
  line count and length), snapshotProduct, featuresFromLines trimming and
  dropping blanks.
- intake.test.ts: lengths, enum, trimming, a 1501-character question refused.
- deliverables.test.ts: sanitizeFileName cases, the path shape.
- settings.test.ts: defaults fill a partial row, the reminder-before-expiry
  rule, a wrong type fails.
- order-emails.test.ts: subjects per email, the order number in every
  subject, formatEastern output present, the delivery email clips at 1200
  characters and says so, no replyTo on customer sends, replyTo on admin
  sends, the seller line and `REFUND_POLICY_SENTENCE` present on E1 and E3
  for a paid amount and the refund sentence absent on a zero total, the
  coupon lines on E1, E13's body, A4 to A7 subjects.
- reply-to-guard.test.ts: the allow-list scan.
- app/api/orders/webhook/route.test.ts: unverified 400; not-an-order ignored;
  a redelivered event id with `completed_at` set is answered
  duplicate-event and touches nothing; one with a null `completed_at` is
  processed; paid marks once across two deliveries (a mocked RPC returning
  true then false) and sends one receipt; a second payment intent on a paid
  order writes `duplicate_payment_intent_id`, an internal event and A4; an
  amount_total that differs from the order writes `mismatch_amount_cents`
  and A5 and never calls the RPC; expired marks expired; charge.refunded
  partial then full; a metadata.order_id that is not a uuid is ignored;
  each dispute event per disputes.test.ts through the route; unknown event
  200 unhandled.
- lib/commerce/receipt.test.ts: `sendReceipt` writes sent, failed and
  skipped correctly and increments attempts each time.
- app/api/donate/webhook test (changed): the order session is ignored.
- lib/stripe/client.test.ts and lib/stripe/outcome.test.ts: moved cases pass
  unchanged; lib/donate/stripe.test.ts still asserts no payment_method_types.
- lib/security/order-pages-auth.test.ts: the guard scan.
- A visual pass in Claude in Chrome on the local production build at 1440,
  1024, 768 and 390 (and 360 through the 500px window per the memory note):
  checkout signed out and in, each payment method's order page state, the
  delivered state with a long review, the admin list with every tab, the
  admin order page with each panel, products and settings. Check: one h1,
  no heading skips, no unnamed role=img, every tap target 44px, nothing
  past the viewport, the tracker vertical on a phone.
- A Stripe test-mode end to end: create an order, pay with 4242 4242 4242
  4242 on the test key, confirm the webhook marks paid (Stripe CLI `stripe
  listen --forward-to localhost:3000/api/orders/webhook` with its own
  secret in STRIPE_ORDERS_WEBHOOK_SECRET), confirm the donation webhook
  ignored it, confirm one receipt email in Resend's log and
  `receipt_email_status = 'sent'`. Then: open a second card page from the
  pay panel of an unpaid order and confirm the first session reads expired
  in the Dashboard; refund the paid order from the Dashboard and confirm
  `refunded_cents` and the E8; pay with the test card 4000 0000 0000 0259
  (creates a dispute) and confirm the chargeback banner, A6, and the Needs
  attention count; `stripe trigger checkout.session.completed` twice with
  the same event id (`stripe events resend <id>`) and confirm the second is
  answered duplicate-event; apply a 100% test coupon and confirm the order
  is paid with no Stripe call; create a complimentary order from
  /admin/orders/new and confirm E13; upload a 6 MB PDF through the uploader
  and confirm it is served from the files route.

---------------------------------------------------------------------------

## 18. Owner questions and the defaults the builder uses

The builder does not stop for any of these. Each has the default written
into the sections above; the owner changes a default by editing this file
before the build starts, or in the admin panel afterwards where it is a
setting.

Q1 Automatic PayPal and Venmo verification. PayPal has a merchant API
(Checkout Orders v2 plus webhooks) that would confirm a PayPal payment
without a button, and "Pay with Venmo" inside PayPal Checkout would do the
same for Venmo for US buyers. It needs a PayPal Business account, a
developer app (client id and secret), a verified webhook, and a different
button (the PayPal JS SDK or a server-side order redirect) instead of the
paypal.me link. Default: NOT built. Manual confirmation with the order
number in the note. The data model already fits an automatic path
(`paid_via` gains a value, `external_payment_reference` holds the capture
id), so adding it later is a route and a button, not a migration.

Q2 Reply-To on admin notifications. Default: customer-facing emails never
set it (so michael@ffbeacon.com applies); the three admin notifications set
reply-to to the customer's address so a reply from the inbox reaches them.
If the owner wants michael@ffbeacon.com on those too, delete the `replyTo`
argument in lib/commerce/notify.ts and the allow-list entries in
reply-to-guard.test.ts.

Q3 Account required to buy. Default: yes (3.1).

Q4 Turnaround. Default: Basic 3 days, Premium 5 days. Editable per product.

Q5 Capacity. Default: 10 open orders, plus the manual Fully booked switch.

Q6 Product names and copy. Default: the seed in 5.2. Editable in
/admin/orders/products.

Q7 Refund policy. DECIDED by the owner on 2026-10-30: all sales are final;
refunds are considered case by case and Michael will usually refund an order
he has not started on yet. No surface promises a refund and no button
requests one. Wording in 3.9 and 20.1, with the consumer law carve-out the
donation section already uses. A customer may cancel an UNPAID order of
their own (9.5) because no money has moved.

Q8 Sales tax. Default: no tax is collected or calculated. Stripe Tax is not
enabled. Whether a written review is a taxable digital service in the
buyer's state is a question for the owner's accountant; the system stores
enough (amount, date, payment method, no address) to report revenue, and
Stripe holds the buyer's billing country for card orders.

Q9 Where the deliverable lives. Default: the portal, with the first section
in the delivery email (3.7).

Q10 The Premium follow-up. Default: one follow-up question by email within 7
days, as a feature line and as a sentence in E5. Handled in the inbox, not
tracked by the system.

Q11 Guest purchase, bundles, gifting a review to a league mate. Default:
none in this build. Gifting would need a recipient field and a claim link;
bundles a multi-line order. The order model (one product per order,
amount_cents, snapshot) does not prevent either. Coupons ARE in this build
(Q14).

Q14 Complimentary reviews. DECIDED by the owner on 2026-10-30: both paths
are built. Coupon codes (5.9, 6.9, 10.5) for handing out, including 100%
codes that make an order free; and a direct "Create an order for a customer"
page (10.6) for a make-good or a friend, which needs no code. Both record
the list price and the discount so revenue figures stay honest.

Q15 A second review for the same team. DECIDED by the owner on 2026-10-30:
always allowed. The checkout page shows a notice naming the review already
in progress (9.3) and never blocks the order. Only an UNPAID duplicate is
folded into the existing order (3.13).

Q16 Admin alerts for overdue work. Owner's call on 2026-10-30: not built. The
Needs attention figure and tab are the only surface for an overdue order; a
daily digest email can be added to the cron later as one more step.

Q17 PayPal and Venmo account type. Owner's call on 2026-10-30: build as is
with the personal handles in lib/donate/links.ts. The owner intends to change
the accounts soon; when that happens only `PAY_HANDLE` and the Q1 path are
affected.

Q18 Stripe's own receipt emails. Owner's call on 2026-10-30: the owner
manages the Stripe Dashboard receipt setting. The build sends E1 regardless,
with the seller named (FF Beacon, michael@ffbeacon.com).

Q12 Stripe statement descriptor. Unchanged from the donation note: set the
prefix in the Dashboard first, then add `statement_descriptor_suffix:
"REVIEW"` to the order session, then test one live payment.

Q13 A second Stripe webhook endpoint versus one shared endpoint. Default:
two endpoints, two secrets, so a mistake in one cannot stop donation
receipts and the donation route's test suite stays untouched beyond the
one guard.

---------------------------------------------------------------------------

## 19. Copy, glossary and banned words

- "Personal Team Review", "Basic Review", "Premium Review". Never "package",
  "plan", "subscription", "tier" in customer copy (tier is fine in code and
  admin).
- "Michael" writes the review. Never "we" or "our analysts" for the review
  itself; "we" is fine for the site ("we email you a receipt").
- "Order", "order number", "receipt", "delivered". Never "ticket", "job",
  "invoice".
- "Pay", "Paid", "Awaiting your payment". Never "pending" alone (the
  donation review found it misleading).
- "Fully booked", never "sold out" (nothing is in stock).
- "Code" on screen for a coupon ("Have a code?", "Code SAVE20 applied");
  "coupon" is fine in admin and in code. "Free" and "complimentary" for a
  zero total; never "discount" as a noun on a customer screen ("$4.00 off").
- "All sales are final." is said exactly that way, and the refund sentence
  is `REFUND_POLICY_SENTENCE` everywhere it appears. Never "money-back",
  "guarantee" or "satisfaction".
- "Chargeback" in admin copy, never "dispute" (Stripe's word) on a screen.
- The word "upgrade" is not used on screen: nothing is being unlocked, the
  Blueprint stays free, and the purchase is a service. "Add a personal
  review" is the verb when one is needed.
- No exclamation marks, no "amazing", "unlock", "elevate", "seamless",
  "robust", "game-changing", no three-part rhythmic lists, no em dashes, no
  curly quotes, no ellipsis character (CLAUDE.md rule 6 and the user's
  writing rules).
- Every date and time in customer and admin copy is Eastern with the zone
  label.

---------------------------------------------------------------------------

## 20. Legal pages and environment setup

20.1 Terms of Service (app/terms/page.tsx)

Section 9 is renamed "9. Donations and purchases" (the nav list entry label
"Donations" becomes "Donations and purchases", id unchanged so existing
anchors hold). The donation bullets stay. A new subsection "Purchases"
follows with these bullets:

- What you are buying. "A Personal Team Review is a written opinion about
  one fantasy football roster, prepared by the person who runs FF Beacon
  from publicly available league data and the tools on this site. It is
  analysis for entertainment and information. It is not financial, legal or
  betting advice, and it does not promise any result in your league."
- Price and payment. "The price shown at the time you order is the price
  you pay, in US dollars, one time. A code you enter at checkout is applied
  before you pay and is shown on your receipt. Card and wallet payments are
  processed by Stripe on Stripe's own pages. PayPal and Venmo payments are
  sent by you to our account and are confirmed by hand; an order paid that
  way is not started until we confirm the payment, and it closes on its own
  if no payment arrives within seven days. You may cancel an order you have
  not paid for at any time from the order page."
- Delivery. "The review is delivered into your My Beacon account and we
  email you when it is ready. Each review states a delivery window on the
  order page. If we cannot deliver within it we will tell you and talk
  through what you would like to do."
- Refunds. "All sales are final. We consider refund requests case by case,
  and we will usually refund an order that has not been started on yet.
  Write to {CONTACT} and quote your order number. A refund, when we make
  one, goes back to the way you paid. That is a goodwill practice rather
  than a right you have under these Terms, and nothing here limits any
  refund or chargeback right you may have under your local consumer law or
  your card network's rules."
- Disputed payments. "If you dispute a card payment with your bank while a
  review is in progress, we may pause the work until the dispute is
  resolved."
- Your part. "A review is written for the account that bought it. You may
  share it with your league, but you may not resell it or present it as
  your own published work."
- Account. "A purchase requires an FF Beacon account, because the review
  and your receipt live there."

The last bullet of the Donations list ("We email you a receipt...") gains:
"For a purchase we email a receipt whichever way you paid."

20.2 Privacy Policy (app/privacy/page.tsx)

- The Stripe paragraph (around line 202) gains a sentence: "If you buy a
  Personal Team Review, the same applies to the card payment, and we also
  keep the order itself: what you bought, the price, when it was paid and
  delivered, the team and league it is about, the answers you typed when
  ordering, every email we sent you about it, and the review we wrote. That
  record is tied to your account so you can read it back, and it is kept as
  a financial record for as long as we are required to keep one."
- The PayPal and Venmo bullet gains: "For a purchase paid that way, we store
  the reference you give us (a transaction id or the name on your account)
  so we can match the payment to the order."
- The Stripe paragraph also gains: "If a card payment is refunded or
  disputed, Stripe tells us, and we record the amount and the outcome on the
  order. A code you use at checkout is recorded on the order."
- The retention list gains the orders ledger, kept indefinitely as a
  financial record, with the deliverable deleted on account deletion request
  while the amount, date and order number are kept.

20.3 Environment

- `STRIPE_ORDERS_WEBHOOK_SECRET`: new. Added to .env.local.example under the
  existing STRIPE_WEBHOOK_SECRET with the comment "Signing secret for the
  second endpoint, /api/orders/webhook. Test and live mode have different
  secrets, and the Stripe CLI prints a third."
- `ADMIN_NOTIFICATION_EMAIL`: already read by three routes; now also the
  fallback for `notifications.adminEmail`.
- Nothing else is new.

20.4 Stripe Dashboard (manual, by the owner)

1. Developers, Webhooks, Add endpoint (Add destination in the newer
   Dashboard): `https://ffbeacon.com/api/orders/webhook`, with exactly these
   nine events selected:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
   - `charge.dispute.funds_withdrawn`
   - `charge.dispute.funds_reinstated`
   Copy the signing secret into STRIPE_ORDERS_WEBHOOK_SECRET in Vercel. Do
   this for live mode; for local testing use the Stripe CLI secret. The
   route answers 200 unhandled to any other event, so an extra selection
   does no harm, but a MISSING one is silent: with `charge.refunded` unticked
   a Dashboard refund never reaches the order.
2. Confirm the existing donation endpoint is still subscribed to its two
   events and that its secret is in STRIPE_WEBHOOK_SECRET in Vercel. If it
   is not, donation receipts are not being sent today, independent of this
   build.
3. Leave "Successful payments" customer emails OFF (we send our own).
4. Optionally set the statement descriptor prefix (Q12).

20.5 Resend

No change. The same key and verified domain. Confirm EMAIL_REPLY_TO is not
set in Vercel to anything other than michael@ffbeacon.com (the code default
is correct when it is unset).

---------------------------------------------------------------------------

## 21. Build order (atomic tasks) and sub-agent reviews

One file, one feature or one migration per task. Each task lists its files,
its dependency and its verification in progress.md in the project format.
Phases end with the gate (typecheck, lint 0 and 0, test, build) and, where
marked, the review sub-agents (implementation, accessibility, security; or
one combined reviewer when the owner says so).

Phase A: database

- CM-T001 docs/README.md Active row for docs/commerce/commerce-and-team-review-plan.md.
- CM-T002 Migration 0343 commerce_settings (apply, RLS verify, types).
- CM-T003 Migration 0344 products with the seed (apply, verify anon sees
  only active rows, types).
- CM-T004 Migration 0345 orders, sequence, set_updated_at trigger,
  try_mark_order_paid (apply, verify, RPC grant check, types).
- CM-T005 Migration 0346 order_events (apply, verify the owner join policy
  with a test user, types).
- CM-T006 Migration 0347 order_messages.
- CM-T007 Migration 0348 order_deliverables.
- CM-T008 Migration 0349 order-files bucket (verify no anon or authenticated
  policy exists on the bucket).
- CM-T009 Migration 0350 coupons and the orders coupon columns (apply,
  verify service role only, types).
- CM-T010 Migration 0351 payment_webhook_events (apply, verify, types).
- CM-T011 Migration 0352 customer lookup RPCs (apply, verify the
  authenticated refusal in 5.11, types).
- CM-T012 Security sub-agent: RLS on all eight tables, the two RPCs, the
  paid RPC and the bucket, in prod, with begin/rollback probes; confirm
  that as the test user `select * from orders` returns no column the
  customer must not see (there is none by design).

Phase B: pure library

- CM-T013 lib/stripe/client.ts and client.test.ts (extraction plus
  `expireCheckoutSession`) and lib/donate/stripe.ts re-exports; donation
  tests pass unchanged.
- CM-T014 lib/stripe/outcome.ts and lib/donate/outcome.ts re-export.
- CM-T015 lib/commerce/types.ts and constants.ts.
- CM-T016 lib/commerce/default-settings.ts, settings.ts, settings.test.ts.
- CM-T017 lib/commerce/transitions.ts and test.
- CM-T018 lib/commerce/pay-links.ts and test.
- CM-T019 lib/commerce/rich-text.ts and test.
- CM-T020 lib/commerce/availability.ts and test.
- CM-T021 lib/commerce/products.ts and test.
- CM-T022 lib/commerce/coupons.ts and test.
- CM-T023 lib/commerce/intake.ts and test.
- CM-T024 lib/commerce/figures.ts and test (including needsAttention against
  ATTENTION_FILTER).
- CM-T025 lib/commerce/deliverables.ts and test (sanitizeFileName, the
  begin and finalize decisions).
- CM-T026 lib/commerce/customers.ts and test.
- CM-T027 lib/commerce/orders.ts and orders.test.ts (reads, inserts,
  countOpenOrders, findReviewsInProgress, searchOrders, markPaidIfWon,
  sendReceipt, recordRefund, customerEmailFor) and receipt.test.ts.
- CM-T028 lib/commerce/stripe.ts and test (closeOpenSession,
  startStripeCheckout, dashboard and dispute urls).
- CM-T029 lib/commerce/reconcile.ts.
- CM-T030 lib/commerce/disputes.ts and test.
- CM-T031 lib/commerce/notify.ts (A1 to A7).
- CM-T032 lib/email/order-emails.ts and order-emails.test.ts (E1 to E13).
- CM-T033 lib/email/reply-to-guard.test.ts.
- CM-T034 Gate.

Phase C: payment paths

- CM-T035 app/api/orders/webhook/route.ts and route.test.ts (dedupe ledger,
  amount check, duplicate payment, refunds, disputes).
- CM-T036 app/api/donate/webhook/route.ts product tag guard and its test.
- CM-T037 app/actions/commerce.ts (createOrderAction with the coupon and
  price steps, previewCouponAction, startStripeCheckoutAction,
  switchPaymentMethodAction, cancelOwnOrderAction, reportManualPaymentAction,
  updateIntakeAction).
- CM-T038 .env.local.example entry.
- CM-T039 Gate.

Phase D: customer surfaces

- CM-T040 components/commerce/status-chip.tsx, figure-tile.tsx,
  order-progress.tsx.
- CM-T041 components/commerce/tier-card.tsx and product-offer.tsx.
- CM-T042 components/commerce/coupon-field.tsx and
  review-in-progress-notice.tsx.
- CM-T043 components/commerce/checkout-form.tsx.
- CM-T044 app/leagues/[league_id]/review/page.tsx and loading.tsx.
- CM-T045 components/commerce/rich-text-view.tsx, order-timeline.tsx,
  pay-panel.tsx, cancel-order-button.tsx, order-sheet.tsx.
- CM-T046 app/my-beacon/orders/[order_id]/page.tsx and loading.tsx (with
  reconcile on view and the admin-order intake form).
- CM-T047 components/commerce/order-list.tsx and
  app/my-beacon/orders/page.tsx and loading.tsx.
- CM-T048 app/api/orders/[order_id]/files/[deliverable_id]/route.ts.
- CM-T049 Blueprint page section 13.
- CM-T050 components/commerce/review-strip.tsx and the overview mount.
- CM-T051 My Beacon tile, nav-tree entries, nav icon if needed.
- CM-T052 lib/analytics.ts events and the fires.
- CM-T053 Gate, then accessibility sub-agent on every customer surface
  (confirm nothing hidden at any breakpoint, every figure one text node,
  the tracker's semantics, the radio cards' focus ring, the coupon
  disclosure's status region, the cancel confirm dialog).

Phase E: admin

- CM-T054 components/admin/orders-subnav.tsx and order-search.tsx.
- CM-T055 app/admin/orders/actions.ts (every admin action in section 16).
- CM-T056 components/commerce/revenue-bars.tsx.
- CM-T057 app/admin/orders/page.tsx and loading.tsx (figures, tabs, search,
  list, identities through lookupCustomers).
- CM-T058 components/admin/order-banners.tsx, order-workflow-panel.tsx and
  order-payment-panel.tsx.
- CM-T059 components/admin/internal-notes-panel.tsx.
- CM-T060 components/admin/attachment-uploader.tsx (9.8).
- CM-T061 components/admin/deliverable-editor.tsx.
- CM-T062 components/admin/order-email-composer.tsx.
- CM-T063 app/admin/orders/[order_id]/page.tsx.
- CM-T064 components/admin/products-manager.tsx and
  app/admin/orders/products/page.tsx.
- CM-T065 components/admin/coupons-manager.tsx and
  app/admin/orders/coupons/page.tsx.
- CM-T066 components/admin/new-order-form.tsx and app/admin/orders/new/page.tsx.
- CM-T067 components/admin/commerce-settings-manager.tsx and
  app/admin/orders/settings/page.tsx.
- CM-T068 lib/nav-tree.ts admin entry.
- CM-T069 Gate, then implementation and security sub-agents on the admin
  surfaces (every action calls requireAdmin, every transition goes through
  transitions.ts, the file route checks ownership, the upload token is
  minted only after the row exists, no `listUsers` anywhere under
  app/admin/orders or lib/commerce, no email address in a log line).

Phase F: cron, legal, docs

- CM-T070 lib/commerce/maintenance.ts and test (six steps).
- CM-T071 app/api/cron/order-maintenance/route.ts, CRON_JOBS entry,
  vercel.json entry.
- CM-T072 app/terms/page.tsx section 9 (20.1).
- CM-T073 app/privacy/page.tsx (20.2).
- CM-T074 lib/security/order-pages-auth.test.ts.
- CM-T075 Gate.

Phase G: verification

- CM-T076 Stripe test-mode end to end with the CLI (17), including the
  donation webhook ignoring the order session, the session replacement, a
  Dashboard refund, the dispute test card, the event redelivery, a 100%
  coupon, a complimentary admin order and a 6 MB upload.
- CM-T077 Manual path end to end: a Venmo order, report, admin confirm,
  receipt email received; then a customer cancel of an unpaid Venmo order.
- CM-T078 Visual pass in Claude in Chrome at the five widths (17), adding
  the coupons page, the new order page and the banners on the admin order
  page.
- CM-T079 One combined review sub-agent (implementation, accessibility,
  security, performance) over the whole feature; fix every finding.
- CM-T080 CLAUDE.md section "Beacon Store and the Personal Team Review"
  after Market Signals: the rules (price never from the client and the
  displayed price compared, Reply-To default, one paid transition through
  try_mark_order_paid, manual payments confirmed by hand and never
  auto-confirmed, one payable Stripe session per order, the amount check,
  the webhook event ledger, refunded_cents as the one refund arithmetic,
  chargebacks handled and never a customer email, the donation webhook
  guard, all sales final with the one constant sentence, no column a
  customer must not see on a customer-readable table, uploads never through
  an action, no listUsers, deliverable in the portal, no model, placements),
  the module map and the admin paths.
- CM-T081 Plan moved to docs/completed/commerce/ with a "What shipped
  differently" section; docs/README.md row moved; handoff.md updated.
- CM-T082 Owner steps (not the builder's): Stripe Dashboard endpoint with
  the nine events and the secret in Vercel (20.4); first live order watched
  end to end.

---------------------------------------------------------------------------

## 22. What shipped differently

Storage
- Migration 0353 is new. The one review found that orders_select_own handed the
  owner the chargeback, duplicate, mismatch, refund note and receipt delivery
  columns, against the rule at the head of section 5. Those columns are now
  withheld with column grants, and the owner reads named columns.
- order_events.body is capped at 5000, not 2000, because 5.4 stores a 5000
  character internal note there.

Headings
- My Beacon's layout holds the page h1, so the customer list title and "Order
  FFB-100001" are h2 (12 says h1). The one-h1 rule won. The product name is a
  paragraph under the order number.
- The checkout h1 needed a new optional pageTitle on LeagueMasthead.

Added, not in the plan
- middleware.ts excludes /api/orders/webhook, as it does the donation webhook.
- lib/commerce/context.ts, offer.ts, product-fields.ts, eastern-input.ts;
  moveDeliverableAction, retryAttachmentUploadAction; loadSleeperHandleForUser in
  lib/sleeper-handle/resolve.ts; app/api/donate/webhook/route.test.ts (none existed).
- formatMoney always prints cents, because formatUsd prints $10 and $0.
- ATTENTION_FILTER is attentionFilter(now), a function.
- The checkout posts the source on screen, so the order stores the Blueprint the
  reader saw.

Behavior beyond the plan, from the review
- closeOpenSession also asks about an expired order, and has a fourth answer,
  pending, for a delayed payment still settling. The cron asks Stripe before it
  expires a card order.
- A paid event on any settled order, cancelled and refunded included, is reported
  as a duplicate payment rather than only on a paid one. A paid event on a card
  order the admin confirmed by hand adopts the intent.
- Reopening an expired order rechecks the storefront, capacity, product and code.
- The status form cannot deliver and cannot move an unpaid order: delivery is
  Publish, and an unpaid order is cancelled from the Payment panel.
- Confirming a card order by hand closes its session first.
- A customer-visible "Email sent" row is written only when the email was sent.
- "Not received" gives the customer a fresh expiry window and a fresh reminder.

Kept literal, worth knowing
- Plan order puts the coupon check before the duplicate guard, so a repeat press
  with a one-use code reads "You have already used that code" rather than landing
  on the unpaid order.
- An admin row below md stacks more than the two lines 10.1 describes.

Not verified the way section 17 describes
- CM-T076 ran without the Stripe CLI, which is not installed: real sandbox sessions
  and a real test card payment through the app, then hand-signed events to
  localhost. No event from Stripe itself has reached the route, and neither the
  Dashboard refund nor the dispute test card was run.
- CM-T078 was an in-page audit plus screenshots, not every view at every width. The
  Chrome extension dropped, and the admin order page was audited at 1440 and 360
  only. Details in progress.md.
- The review did not reach lines 405 to 520 and 705 to 836 of
  app/admin/orders/actions.ts, or lib/commerce/deliverables.ts, notify.ts,
  customers.ts, lib/email/order-emails.ts, the admin list page and most components.

Second review, 2026-10-30 (five reviewers over the whole build, every file read)

Storage
- Migration 0354: the four owner-read policies (orders, order_events,
  order_messages, order_deliverables) rewritten in the initplan form, as 0274
  did for the rest of the site, plus covering indexes on orders.product_id and
  payment_webhook_events.order_id. Policy names, roles and commands unchanged.
- Migration 0355: idx_orders_receipt_retry now covers 'skipped' too, which the
  hourly retry query already filtered on, and partial indexes on paid_at and
  delivered_at for the admin figures.

Money and state
- The reconcile window (6.4) is measured from the later of created_at and the
  current session's expiry, not from created_at alone. A reader who reopened the
  card page on day three and paid while the webhook was down was otherwise never
  read back, and Confirm payment told the admin it was recorded when nothing was.
  Confirm payment now falls through to the manual confirm when the read-back
  declines.
- A customer cannot cancel a PayPal or Venmo order after pressing "I sent the
  payment". The button is gone from the page and the action refuses. 9.5 allowed
  the cancel from awaiting_confirmation; a reported payment may be in flight.
- Publish and mark delivered, Mark not received, recordRefund and saveSection are
  conditional on the state that was read, so two admins at once produce one
  delivery, one email, and never write cancelled over delivered.
- Send the receipt now and the Resend button refuse an order that is not paid or
  refunded. A complimentary order that could not be marked paid is reported to the
  admin rather than returned as created.
- The hourly cron stops between rows at 45 seconds and reports `partial`, so a
  backlog after an outage cannot be killed mid-run before the prune. The reminder
  is keyed on the payment window (expires_at) rather than created_at, so an order
  whose window was restarted by Not received waits for day three of the new
  window. The visible "Reminder email sent" note is written only when it was sent.
- loadOfferState catches a failed open-order count and reads closed for a minute
  instead of taking the league overview or the Blueprint down with it.
- The Needs attention figure carries an exact count beside the capped row read.
- The admin figures' attention and turnaround reads are still capped at 1000 rows
  for the hint and the mean; stated here rather than paged.

Emails and copy
- E2 says "The order is held until <Eastern date>" from the order's own expiry
  instead of a fixed "7 days"; the preheader names the order number as the note,
  matching the body. E8's "5 to 10 business days" line is card only. A6's subject
  drops "evidence due" when Stripe sent no due date. "1 days" is pluralized on the
  tier card and the receipt.
- American English in prose: Canceled, Canceling. The stored status value is
  still 'cancelled' and never changes.
- The checkout description says "Pick the review", not "Pick the tier" (19).
- lib/commerce/notify.test.ts asserts reply-to on admin notices; the reply-to
  guard also scans the admin actions, the webhook and the cron route.
- Known and left: the Terms say "within seven days" while the expiry is a setting;
  the Terms and Privacy use the word "dispute" where 20.1 and 20.2 prescribe it;
  the privacy page's deliverable-deleted-on-request line is a manual promise with
  no code path; the eighth admin notice (questions added) has no switch.

Accessibility
- review_order_paid fires once per paid_at (localStorage), not once per browser
  session, and a complimentary order reports "complimentary" rather than "stripe".
- The checkout's tier group no longer carries a second radiogroup role inside its
  fieldset; the selected tier card shows the word Selected beside its border; the
  coupon-removed note lives outside the disclosure; with no payment method the
  button reads "Ordering is paused" and refuses with the same sentence; the copy
  button's visible word stays Copy; the intake update form reuses the checkout
  textarea with its counter; figure tiles take their grid class directly so a dl
  never holds a div in a div; the compact tracker is named "N of 4 steps done".
- Admin: every action announces "Working on it." then the result in persistent
  status and alert regions, focus goes to the h1 on success and to the alert on
  failure; the forms that replace a button (Not received, Edit, Add section) take
  focus on open; the chargeback banner reads the reason as words and omits a
  missing due date; the disabled Update status button says why; the attachment
  link is 44px; the second "Payment" leader is "Payment intent"; the timeline ol
  has role list and says "by Michael" rather than "admin".
- Not done from the admin review: focus return to the trigger after Cancel; the
  Add product and Add coupon forms do not take focus on open; the Retry file
  picker keeps its retry state if the dialog is dismissed; Enter in the customer
  search field does not run Find; the refund cap is server-side only; the section
  title suggestions stay a datalist. None blocks a sale.
