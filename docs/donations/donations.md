# Donations

Shipped 2026-09-06. One-time donations by card, digital wallet, PayPal or
Venmo, plus the legal pages that had to be brought up to date to describe them
honestly.

FF Beacon has no ads, no subscription and no locked tier, and it is paid for
personally. This feature is the only place on the site where money changes
hands, and everything below follows from wanting that to be true without
changing anything else about how the product behaves.

## Where it appears

| Surface | What it is |
| --- | --- |
| Site header | A Donate control to the right of search and Ask BEAM, at every breakpoint. Opens the house dialog: up from the bottom edge on a phone, in from the right on a desktop. |
| `/donate` | The same picker as a page. The URL people type, paste, and come back to. |
| `/donate/thanks` | Where Stripe returns a reader. Confirms what actually happened by asking Stripe, never by reading the query string. |
| `/about` | A Support panel saying the site is self funded, that everything stays free either way, and that donations are final. |
| Footer, Site column | A Donate link, for the reader who wants to find it again later. |

## The decisions, and why

**Hosted Stripe Checkout, not the embedded Payment Element.** Apple Pay and
Google Pay are the point of the feature and they are the part that is easy to
get subtly wrong. On `checkout.stripe.com` they work immediately: the domain is
Stripe's own and is already registered with Apple, so there is no verification
file to host and nothing to re-register when a preview deploy gets a new
hostname. Embedding would put that registration on us and would require
loosening this site's `Permissions-Policy: payment=()` header, which is doing
real work. The redirect also means no card number, no wallet token and no
payment iframe ever touches this origin.

**No `payment_method_types` is sent.** Omitting it is what switches automatic
payment methods on, so Stripe serves whatever the account has enabled and
whatever the reader's browser can do. Sending an explicit list would freeze that
at whatever was typed and silently drop every wallet. `lib/donate/stripe.test.ts`
asserts the parameter never appears, because nothing about its return would
raise an error.

**No Stripe SDK.** REST over `fetch`, matching `lib/email/send.ts`. The key
lives in the environment, a missing one is a loud no-op rather than a throw, and
every failure is a structured result.

**A webhook, and a receipt ledger.** This reversed an earlier decision, and the
reason is worth recording. The first build had no webhook at all: a donation
fulfils nothing, so there was no entitlement to grant and no state to reconcile,
and Stripe's own automatic receipt covered the only message a donor gets. We now
send that receipt ourselves, in the FF Beacon email shell, because it is the one
moment a donor is most glad they gave and a Stripe-branded email is a poor use
of it.

Owning the receipt means owning delivery, which is what the webhook and the
ledger are for. It must not depend on the donor keeping the thank-you page open,
so Stripe calls us rather than the browser doing it; and Stripe retries until it
gets a 2xx and may deliver the same event twice by design, so without a durable
record every retry is another receipt in the donor's inbox.

**The receipt ledger stores no donor identity.** `donation_receipts` holds an
amount, Stripe's identifiers, the surface the donation started from and whether
the email went out. No name, no email address, no billing address, nothing about
the card. The address is read from Stripe's event in memory, used to send, and
dropped; `metadata` keeps the event with `customer_details` and `customer`
stripped out. That is a considered exception to the raw-object preservation rule
in CLAUDE.md, written into migration 0270: the rule exists for audit, backfill
and diagnosis, and the Stripe ids recover the full object from Stripe in one
lookup, so a second copy of a donor's identity here would be breach exposure
with no capability attached.

**PayPal and Venmo are plain links, and they need no server.** They carry the
chosen amount in the URL, so the number picked here is the number already filled
in there. That is also the fallback: if Stripe is misconfigured, rate limited or
down, there is still a way to give.

**The card key's SHAPE is checked, not just its presence.** Written after
finding `STRIPE_SECRET_KEY=#22D3EE`, a brand hex colour pasted onto the wrong
line, in a real environment file. A key that merely exists sends the request,
gets a 401, and reaches the reader as "we could not open the payment page",
which points at Stripe when the problem is one line of config. Refusing it in
`secretKey()` turns that into the honest "card donations are not set up" state
with PayPal and Venmo still offered, and puts the real reason in the log.

## The endpoint

`POST /api/donate/checkout` creates a Checkout Session and returns its URL. It
creates no charge, writes nothing to our database and stores no card data.

Defences run in this order, and the order is the point:

1. **Same-origin.** A cross-site page cannot forge `Origin`, so this is the cheap
   first filter on a state-changing POST. Same guard as `/api/guide/submit`.
2. **Configuration.** Nothing to open means nothing to spend a slot on.
3. **Shape and amount.** Free, so garbage never costs a reader their budget and
   never reaches Stripe.
4. **The rate limit, claimed last**, immediately before the only expensive call.
   Eight per minute per actor, through the shared `claimRateLimitSlot`. Same
   ordering as Trade Ideas and for the same reason: a stale request must not burn
   a real donor's budget.

**The limiter fails closed here, deliberately**, unlike the lineups free-agent
panel. An unbounded session-creation endpoint is what a card tester wants, and
the modal still offers PayPal and Venmo, neither of which touches our server, so
nobody who wants to give is left without a way to.

**The amount is re-parsed on the server** and never trusted from the browser.
Money is held in cents past the input: `parseDonationAmount` is the one
conversion, it rounds once, and nothing downstream sees a fractional cent.

**The cancel destination is the one piece of caller-supplied input on a URL a
third party redirects to**, which is the exact shape of an open redirect. It is
not sanitised, it is resolved against our own origin and then checked against it
(`lib/donate/return-path.ts`). Control characters are rejected BEFORE the trim,
because trimming first repairs a hostile string instead of refusing it. Both
redirect targets are built from the configured site URL rather than the request's
Host header.

**`/donate/thanks` asks Stripe.** The session id is the only thing the browser
carries out of Checkout, and a page that congratulated a reader because a query
string said so would congratulate anyone who typed one. Only the status and the
total are read; nothing about the person, nothing about the card. The page is
`noindex` and `force-dynamic`.

## Module map

- `lib/donate/amounts.ts` holds the presets, the floor, the ceiling, and the one
  dollars-to-cents conversion. Pure, with no imports, so the browser and the
  server enforce identical rules.
- `lib/donate/links.ts` builds the PayPal and Venmo URLs. Pure.
- `lib/donate/return-path.ts` is the open-redirect guard. Pure.
- `lib/donate/stripe.ts` is the REST client. Server only.
- `app/api/donate/checkout/route.ts` is the endpoint.
- `components/donate/donate-form.tsx` is the picker. One component with two
  homes, so the amounts and the wording cannot drift between the modal and the
  page.
- `components/donate/donate-launcher.tsx` is the header control and its dialog.
- `lib/donate/webhook-signature.ts` verifies that a webhook really came from
  Stripe. Pure, and the security boundary of the whole receipt system.
- `app/api/donate/webhook/route.ts` is the receipt endpoint.
- `lib/email/donation-emails.ts` builds and sends the receipt in the shared
  branded shell.

## Setup still required

1. **Put a real Stripe key in the environment.** `STRIPE_SECRET_KEY` must start
   with `sk_live_`, `sk_test_`, `rk_live_` or `rk_test_`. Until it does,
   `stripeConfigured()` returns false, the card button is not drawn at all, and
   PayPal and Venmo take the lead. Documented in `.env.local.example`.
2. **Payment methods.** Stripe Dashboard, Settings, Payments, Payment methods:
   confirm Cards, Apple Pay, Google Pay and Link are enabled. Wallets then appear
   in Checkout automatically, with no domain registration, because the payment
   page is on Stripe's domain.
3. **The receipt webhook.** Stripe Dashboard, Developers, Webhooks, add an
   endpoint pointing at `https://ffbeacon.com/api/donate/webhook`, subscribed to
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

   **TEST MODE AND LIVE MODE HAVE DIFFERENT SIGNING SECRETS**, and the Stripe
   CLI prints a third one of its own. A deployment can verify exactly one at a
   time, and using the wrong one is the most common cause of every webhook
   failing verification.

   Two more requirements that are easy to miss. The endpoint must be a publicly
   reachable HTTPS URL, and **Stripe counts a redirect as a failure**: if
   ffbeacon.com redirects to www, or the reverse, register the post-redirect URL
   or every delivery fails.

   Until the variable is set, every webhook is refused and no receipt is sent.
   Donations still complete and each refusal is logged, but this is not a benign
   state: **Stripe retries for about three days and then gives up for good**, so
   a misconfiguration lasting longer than that loses those receipts permanently.
   The Dashboard can resend an event by hand for 15 days, and
   `npm run donate:receipts` replays anything already in the ledger.
4. **Leave Stripe's own receipt OFF.** Settings, Business, Customer emails,
   "Successful payments" stays switched off, because we send our own. Two
   receipts for one donation is worse than either alone, and a donor cannot tell
   which is authoritative.
5. **Resend must be configured.** The receipt goes out through the same
   `RESEND_API_KEY` and verified sending domain as every other FF Beacon email.
   Without it the donation is still recorded and the row is marked `skipped` with
   the reason, rather than the event being retried for days.
6. **Business details.** Stripe Dashboard, Settings, Business, Public details:
   legal name, support address, support email and privacy policy URL.
7. Nothing else. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not read by any code,
   because hosted Checkout needs no client-side Stripe.js. It is harmless to keep
   for a future embedded flow.

### Considered and deliberately not done

- **`statement_descriptor_suffix`.** A card statement reading FF BEACON would
  prevent some "what is this charge" disputes, which donations attract more of
  than purchases do. It is not set, because Stripe rejects the request outright
  when the account has no statement descriptor prefix configured, and a rejected
  request means every donation fails. Set the prefix in the Dashboard first,
  then add the suffix, then test one live payment.
- **Stripe Custom Domains.** If it is ever enabled, the host allowlist in
  `app/api/donate/checkout/route.ts` has to learn the new host in the same
  change, or every donation starts failing with a log line that reads like a
  Stripe outage.

## Legal pages

Rewritten in the same change, because the old ones did not describe a site that
takes money and were behind the product in several other places.

Terms gained: what the Service is and is not (analysis rather than advice, a
gambling disclaimer covering the odds data, an AI-assisted content disclosure), a
content licence for Signal profiles and submissions, a copyright complaints
route, a no-affiliation statement for the NFL and every data provider, the
donations section, indemnification, a liability cap with consumer carve-outs,
governing law and an informal-resolution-then-courts dispute process, and the
usual general clauses.

Privacy gained: the payment processors and exactly what each receives, Resend,
Anthropic (drafting the Brief from public data, with no personal information
sent), Vercel Analytics, GIPHY, Discord poll identifiers, Supabase Storage, the
salted IP hashing used by the rate limiters, BEAM's scrubbed question log with an
explicit statement that questions are not sent to a model provider, legal bases,
international transfers, per-category retention (the donation ledger is kept
indefinitely as a financial record and identifies nobody; the payment itself
lives with the processor), and GDPR plus CCPA rights.

`lib/site.ts` now carries `author.legalName`, `legalContactEmail` and
`governingState`, so both legal pages name the same party and the same
jurisdiction rather than drifting apart.

## What four reviews changed

The feature was reviewed for Stripe correctness, security, accessibility, and
implementation quality before it shipped. The findings worth recording, because
each one is a trap the next payment feature can fall into:

- **A comma read as a decimal point.** `parseDonationAmount` stripped every
  comma and then validated, so "12,50", which is how most of the world writes
  twelve dollars fifty, became 1250. A hundred times the intended amount, on the
  one form on the site that moves money. The module header had named that exact
  input as the thing it must never do. Grouping is now validated before any
  comma is removed, and seven cases are pinned in the tests.
- **An abandoned checkout told it had paid.** Stripe's `open` status means
  payment processing never started, and the thank-you page read it as "pending"
  and said the money was on its way. The mapping now lives in
  `lib/donate/outcome.ts` with tests, because inline logic in a server component
  is logic nothing can test.
- **A protocol-relative path out of the open-redirect guard.**
  `/..//evil.example` cleared every input check and normalised to
  `//evil.example`. Harmless with today's single caller, which prefixes an
  absolute origin, and a live open redirect for any future one. The output is
  now checked as well as the input.
- **An unmetered Stripe call on a public GET.** `/donate/thanks` retrieved a
  session on every render with no limit, which is an amplifier into the same
  Stripe read quota real donors depend on. Metered now, generously, and a
  refusal degrades to the honest "we could not confirm this" state.
- **One error channel doing two jobs.** A Stripe outage marked a perfectly good
  amount as `aria-invalid` and read "check your connection" out as the
  description of the amount field. Field errors and request errors are now
  separate, and each is announced exactly once.
- **A promise that depended on an invisible setting.** The page said Stripe had
  emailed a receipt. Stripe only does that when a Dashboard toggle is on. See
  step 3 above.
- **Claims the site could not keep.** The copy said "no ads" while `public/ads.txt`
  is served for AdSense verification. It now says "no subscription, no paywall,
  no locked tier", which is durably true. The Privacy Policy described donation
  records we do not store, gave "performance of a contract" as the lawful basis
  for a gift, and claimed we honour Global Privacy Control, which nothing
  implements. All three corrected.

## The receipt, end to end

1. A donor pays on Stripe's page and is redirected to `/donate/thanks`, which
   confirms the payment by asking Stripe about the session.
2. Independently, Stripe POSTs `checkout.session.completed` to
   `/api/donate/webhook`. The two are not ordered, and the receipt does not
   depend on the redirect happening at all: the donor can close the tab.
3. The route verifies the signature BEFORE parsing the body or touching the
   database, and fails closed when the signing secret is missing.
4. A row is upserted into `donation_receipts` keyed on the session id.
5. `try_claim_donation_receipt` hands the send to exactly one caller.
6. The receipt goes out through Resend, and the row records `sent` or `failed`.

The status codes are chosen for Stripe's retry behaviour rather than for
tidiness. A bad signature is 400, because that request will never become valid
and retrying it helps nobody. An event we do not handle is 200, because a 500
would have Stripe retrying it for days. A genuine send failure is 500, so the
event comes back and the claim, which treats `failed` as reclaimable, lets the
retry through.

A delayed-notification payment method completes Checkout unpaid and settles
later. That first event is acknowledged and no receipt is sent, because a receipt
for money that has not arrived is not a receipt; the settlement arrives as
`checkout.session.async_payment_succeeded` and is handled the same way.
