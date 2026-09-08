# Beacon Link: acting on a reader's real Sleeper account

Status: PLAN ONLY. Nothing in this document has been built. Written 2026-09-05
against `main` at `bca707d`. Task prefix for the build: `BL-T###` in
`progress.md`. Next available migration number after the Manager Pulse speed
plan's block (which reserves 0261 to 0266) was 0267 when this was written;
see the revision note below for the numbers now in force.

THIS DOCUMENT IS THE SPEC. It carries every file, function, migration, RPC,
env var, header and test the build needs, so nothing is left to
interpretation. The companion artifact is the plain-language pitch; it carries
none of this detail.

REVISION 2026-09-07. Two things changed since this was written on 2026-09-05.

1. Migration numbers. The block this plan reserved (0267 to 0270) was used by
   other work in the two days between (0267 Manager Pulse review fixes, 0268
   saved-handle settings shape, 0269 the /donate route reservation, 0270 the
   donation receipt ledger). Every Beacon Link migration below has been
   renumbered: sleeper_connections is 0271, sleeper_link_challenges 0272,
   sleeper_action_log 0273, beacon_link_settings 0274. Membership and billing
   (Part 12 onward) starts at 0275. Renumber again if anything lands first;
   the numbers are an ordering, not an identity.

2. Parts 12 to 27 were added. They specify the membership and billing system:
   admin-defined tiers, a catalog of features that can be assigned to any tier
   one by one (every Beacon Link action is one such feature, and so is Beacon
   Link itself), one-time purchasable services such as a roster review, Stripe
   hosted Checkout for every payment, and PayPal with Venmo behind the same
   interface. Part 6.1's action envelope and Part 5.2's link flow each gain one
   step, stated in Part 14.6. Nothing else in Parts 0 to 11 changes.

REVISION 2026-09-07, fourth pass, on the owner's notes to the third. Four
changes. (1) Nothing is keyed to "the season" any more; it is keyed to LEAGUE
TYPE. Dynasty and keeper leagues run all year (trades, rookie drafts, waivers,
news), so every notification kind fires on what actually happened in a league
and never on the calendar, and "offseason" copy appears only for a reader
whose leagues are all redraft, with the distinction explained wherever we do
not know (Part 26.9, Part 31.1). (2) League plans become LEAGUE HOME: a
league's own homepage, built from League Pulse's sections as modules the
league arranges itself, served at a free subdomain at once and at a custom
domain bought through Cloudflare and connected to Vercel with everything but
the purchase itself automated (Part 31.4, 31.4a, 31.4b; migrations 0300 and
0301). (3) The Discord role has a full lifecycle: granted on membership,
granted the moment Discord is connected, removed the moment it is
disconnected or the membership ends, and re-derived nightly so nothing stale
survives (Part 31.2). (4) The donor thank-you script is removed; the beta
period stays. Migrations now run 0275 to 0301.

REVISION 2026-09-07, third pass, after a gap review the owner accepted. Part
31 (new) carries every addition: seasonality (pause, season pass, offseason
copy), league plans and gifts, a Discord channel and a Plus role, email
deliverability (bounces, complaints, a sending subdomain, a postal line),
per-kind roll-ups instead of dropped mail, per-member time zones, inbox-poll
backoff, event pruning, chargeback evidence, terms-version records,
attribution, proactive alerts, a fail-soft entitlement cache, hashed
unsubscribe tokens, a calendar feed and a beta period.
Three things changed elsewhere: the free tools are NOT wired to feature gates
(the old MB-T028 is withdrawn), tiers are fully editable and the seeded ones
are starting points only, and the refund policy and Terms gain a plans-may-
change clause with credit or refund at our discretion. Migrations now run 0275
to 0299. The old Parts 31, 32 and 33 are 32, 33 and 34. The owner has said the
legal read is theirs and that the system ships OFF by default, so nothing here
argues about launch-day contents again.

REVISION 2026-09-07, second pass, after the owner's review of the artifact.

1. The owner's decisions are recorded in Part 12. The product is BEACON PLUS,
   written Beacon+ where space is short. PayPal and Venmo are in (a business
   account exists). Sales tax runs through Stripe Tax behind a modular tax
   settings block (Part 29). All sales are final, handled case by case, and a
   cancelled membership runs to the end of its paid period (Part 30 is the
   policy text). Everything that existed before this plan is in the Free tier;
   everything this plan and the Beacon Link plan add is paid. The legal read is
   the owner's to arrange and does not gate the build.
2. Part 8.2's "not advertised" rule is REVERSED and replaced. Beacon Link and
   every other paid feature are promoted inside the tools, at the exact place
   each would be used, and on the Beacon Plus pages. What is never described,
   anywhere, is HOW an action reaches Sleeper. Part 25 is the promotion
   system and its copy rules; a test enforces the mechanism ban.
3. Six parts were added: Part 25 (promotion inside the tools), Part 26 (email
   notifications, a paid feature with one toggle per tier and one master
   switch per reader), Part 27 (the Beacon Plus pages: sales, tour, comparison
   and the post-purchase welcome), Part 28 (comps, trials and redeemable
   codes), Part 29 (the tax module) and Part 30 (the refund policy). The old
   Parts 25, 26 and 27 are now 32, 33 and 34 (see the third revision note).
4. The pricing route is `/plus`, not `/membership`; the member's page stays
   `/my-beacon/membership`. Migrations now run 0275 to 0299.

Read Part 0 before anything else. This feature is different in kind from
everything else on FF Beacon: it holds a credential that can act as the reader
on a third party's system, and one of the mutation groups on that system moves
real money. The engineering is the easy part. Part 0 is the part that decides
whether this gets built at all.

---

## Part 0. The gate: two decisions only the owner can make

Neither of these is an engineering question, and the build does not start until
both are answered in writing in this document.

### 0.1 Terms of service

Sleeper's GraphQL endpoint at `https://sleeper.com/graphql` is undocumented and
unsanctioned. Automating writes against it, on behalf of users, using their
logged-in sessions, is the kind of activity a platform's terms of service
commonly forbid, and doing it at scale from a branded product is a materially
different risk from a hobbyist script. This plan does not assert that it is
permitted. Before build:

- The owner reviews Sleeper's current terms of service and, if there is any
  doubt, gets a lawyer's read.
- The owner accepts that Sleeper can revoke access, rename a mutation, or block
  non-app clients on any deploy, and that when they do, every actionable button
  in this feature fails at once. The plan is built so that failure is graceful
  (Part 6.5), but it cannot be built so that failure does not happen.

Decision (owner, date): ______________________________________________

### 0.2 Credential custody, and the money surface

To act as a reader we hold their Sleeper session token. That token is a FULL
credential. The same endpoint that sets a lineup also carries `deposit`,
`withdraw_league_dues`, `pay_league_dues`, `cc_withdrawal`, `order_contract`,
bank-account linking, `change_password` and `delete_user` (verified in the
mutation introspection, Part 1.2). A token we hold could call any of them.

The plan's answer, and it is a hard rule, not a default:

- We NEVER implement, call, or expose any financial, account-security, or
  account-destruction mutation. `lib/sleeper-write.ts` is an ALLOWLIST: the only
  mutations that exist in our code are the fantasy-management ones in Part 1.3,
  and `lib/sleeper-write-allowlist.test.ts` fails the build if any other
  mutation string appears in the module. Not implementing them is what bounds
  what a bug in our code can do.
- But not implementing them does not shrink what a LEAKED token can do. A token
  that escapes our systems can be replayed against Sleeper directly, by whoever
  holds it, to move that person's money. So the token is treated as the most
  sensitive datum on the site: encrypted at rest with a key that is not in the
  database, never sent to a browser, never logged, never returned by any API,
  and revocable by the reader and by us in one action (Part 5).

The owner accepts that FF Beacon becomes a custodian of account access, with the
security and legal posture that implies, including a breach-notification duty if
a token store is ever compromised.

Decision (owner, date): ______________________________________________

If either decision is no, this plan stops here and none of it is built. The
Manager Pulse speed plan is entirely independent of this one and is unaffected.

---

## Part 1. What the research established

Run live on 2026-09-05 against `https://sleeper.com/graphql`, unauthenticated,
introspection only. No login was performed and no write was attempted.

### 1.1 The endpoint has a full write half

Introspection: `{ __schema { query_type { name } mutation_type { name } } }`
returns `RootQueryType` and `RootMutationType`. The mutation type has 349
fields. It is the real write surface of the Sleeper product, not a read-only
mirror. The full introspection dump is not checked in; regenerate with
`{ __type(name: "RootMutationType") { fields { name args { name type { name kind of_type { name kind } } } } } }`
(this server uses snake_case introspection: `of_type`, `query_type`).

### 1.2 The mutations we will NEVER touch (Part 0.2)

Present in the schema, permanently excluded from our code:
`deposit`, `withdraw_league_dues`, `pay_league_dues`, `cc_deposit`,
`cc_withdrawal`, `aeropay_deposit`, `aeropay_withdraw`, `bank_withdrawal`,
`offline_withdrawal`, `order_contract`, `link_aeropay_account`,
`register_aeropay_user`, `purchase_item_with_cookies`, `purchase_gift_for_user`,
`purchase_gift_for_league`, `redeem_receipt_for_cookies`, `change_password`,
`change_password2`, `reset_password`, `request_password_reset`, `delete_user`,
`delete_league`, `delete_roster`, and every `*_withdraw*`, `*_deposit*`,
`*password*`, `*aeropay*`, `*bank*`, `cc_*` name. The allowlist test enforces
exclusion by denylisting these substrings AND by allowlisting the exact set in
1.3, so a new mutation Sleeper adds is excluded by default.

### 1.3 The mutations we WILL use, with their verified argument shapes

Every signature below is from the live introspection. `Snowflake` is Sleeper's
string id type; `k_x` / `v_x` pairs are how Sleeper passes a one-entry map
(key string, value); multi-entry maps are passed as JSON strings.

Lineups and roster:
```
roster_update_starters(league_id: Snowflake, roster_id: Int, starters: String) -> Roster
roster_update_reserve(league_id: Snowflake, roster_id: Int, reserve: String) -> Roster
roster_update_taxi(league_id: Snowflake, roster_id: Int, taxi: String, force: Boolean) -> Roster
roster_set_keepers(league_id: Snowflake, roster_id: Int, keepers: String) -> Roster
```
`starters` is the positional array Sleeper stores (the same one
`lib/league-matchups.ts` reads, placeholders and all), serialized as its JSON.

Trades:
```
propose_trade(league_id: Snowflake, expires_at: Int, draft_picks: String, waiver_budget: String,
              v_adds: Int, k_adds: String, v_drops: Int, k_drops: String,
              reject_transaction_id: Snowflake, reject_transaction_leg: Int) -> LeagueTransaction
accept_trade(league_id: Snowflake, transaction_id: Snowflake, leg: Int) -> LeagueTransaction
reject_trade(league_id: Snowflake, transaction_id: Snowflake, leg: Int) -> LeagueTransaction
process_transaction(league_id: Snowflake, transaction_id: Snowflake, leg: Int) -> LeagueTransaction
```
`k_adds`/`v_adds` etc. carry the player-to-roster map; a multi-player, multi-pick
trade passes the full maps as JSON in `draft_picks` and the adds/drops. The
exact multi-entry encoding (one call carrying several adds) is the ONE thing the
spike (BL-T001) confirms against a live account before the trade builder ships,
because the `k_`/`v_` single-pair shape suggests these mutations may take one
add and one drop per call and compose a trade from several. Until confirmed, the
trade builder is specified against the JSON-map reading and the spike either
confirms it or the builder is adjusted before BL-T030.

Waivers and free agency:
```
submit_waiver_claim(league_id: Snowflake, v_adds: Int, k_adds: String, v_drops: Int, k_drops: String,
                    k_settings: String, v_settings: Int, k_metadata: String, v_metadata: String) -> LeagueTransaction
update_waiver_claim(league_id: Snowflake, transaction_id: Snowflake, leg: Int,
                    k_settings: String, v_settings: Int, k_metadata: String, v_metadata: String) -> LeagueTransaction
cancel_waiver_claim(league_id: Snowflake, transaction_id: Snowflake, leg: Int) -> LeagueTransaction
league_create_transaction(league_id: Snowflake, type: String, v_adds: Int, k_adds: String, v_drops: Int, k_drops: String) -> LeagueTransaction
```
`v_settings` on a waiver claim is the FAAB bid (an Int). `league_create_transaction`
with `type: "free_agent"` is the direct add/drop for a league with no waivers.

League social (the cockpit's chat and polls):
```
create_message(channel_id: Snowflake, text: String, parent_type: String, parent_id: Snowflake, client_id: String, ...) -> Message
create_poll(prompt: String, choices: String, k_metadata: String, v_metadata: String) -> Poll
poll_vote(poll_id: Snowflake, choice_id: String, type: String, type_id: Snowflake, parent_id: Snowflake) -> Poll
create_reaction(message_id: Snowflake, parent_id: Snowflake, reaction: String, enable_multi: Boolean) -> Reaction
```
The league chat channel id is on the league object (`League.last_message_id`
names the channel's newest message; the channel id itself comes from the league,
confirmed in the spike). `choices` on a poll is the JSON array of options.

Roster-adjacent niceties:
```
add_league_player_trade_block(league_id: Snowflake, player_id: String) -> LeaguePlayer
remove_league_player_trade_block(league_id: Snowflake, player_id: String) -> LeaguePlayer
add_league_player_note(league_id: Snowflake, player_id: String, note: String) -> LeaguePlayer
like_league_player(league_id: Snowflake, player_id: String) -> LeaguePlayer
```

Draft (a later phase, Part 4.6):
```
draft_pick_player(draft_id: Snowflake, player_id: String, pick_no: Int, sport: String) -> DraftPick
draft_make_offer(draft_id: Snowflake, player_id: String, pick_no: Int, slot: Int, amount: Int, sport: String) -> DraftOffer
```

### 1.4 What authenticated READS open up

Every transaction query is closed to an anonymous caller and opens with a token.
The two that matter:
```
league_transactions(league_id: Snowflake, status: String, type: String, leg: Int, roster_id: Int, limit: Int) -> [LeagueTransaction]
```
Filtered by `type: "trade", status: "pending"` this is the PENDING TRADES INBOX
that the cockpit's Trades section is built on. There is no other way to learn a
reader's incoming trade offers: the REST transactions endpoint returns them, but
only per week and without a reliable "pending and addressed to me" filter, and
the anonymous GraphQL call is refused. This query, authenticated, is the
feature-enabling read.

Also useful authenticated: `matchup_legs` and `matchup_legs_related_to_roster`
(a whole season for one roster in one call, refused anonymously). We do NOT
switch the Manager Pulse or Power Pulse slate reads onto these; those stay on
the anonymous REST path per the Manager Pulse plan (the authenticated slate is
only available to a connected reader, and those features run for every league,
connected or not). The cockpit MAY use `matchup_legs_related_to_roster` to show
the connected reader their own live scores faster; optional, Part 4.3.

### 1.5 How authentication works (confirmed shape, exact spike)

Sleeper issues a session token that authenticated calls carry in the
`authorization` request header. There is a verification-code path
(`request_verification`, `create_verification_code`, `verify_verification_code`)
which is the username-plus-2FA flow, and a passkey path. The verification path
returns the token. `league_sync_login` is NOT this; it imports leagues from ESPN
or Yahoo INTO Sleeper and is unrelated.

BL-T001 (the spike) confirms, against the owner's own account, with explicit
consent, in a throwaway branch, and records here:
- the exact mutation names and argument shapes of the two or three auth steps;
- whether the header is `authorization: <token>` or `authorization: Bearer <token>`;
- the token's lifetime and whether a refresh mutation exists;
- the exact `create_message` channel id source and the multi-entry trade
  encoding (Part 1.3).

Spike result (to be filled in): ______________________________________________

Until the spike is recorded, no code past BL-T001 is written. Everything below
is specified against the confirmed shape and adjusted if the spike differs.

---

## Part 2. What we are building, in one paragraph

A reader with an FF Beacon account can LINK their Sleeper account once (username,
then the 2FA code Sleeper texts them). After that, FF Beacon can act as them on
their own leagues: set a lineup, submit a waiver bid, propose a trade, accept or
reject a trade offer, drop or add a free agent, post to league chat, start a
poll. Those actions appear as buttons on the tools that already compute the
decision (the FAAB calculator's bid, Trade Ideas' suggestion, the Lineups page's
optimal lineup), and the League Pulse deep view of a league the reader is IN
becomes a cockpit: a Trades inbox, a My Team management surface, and league chat,
all sitting beside the WAR, projections and Power Pulse the deep view already
shows. Nothing about this is visible to a reader who is not signed in, and no
action fires without a clearly stated warning that it will happen on their real
Sleeper account.

The connection layer is BEACON LINK. The cockpit is the existing League Pulse
deep view, extended; it is not a new tool and not a new dashboard area (an
earlier sketch put it in My Beacon, then folded it into League Pulse because the
deep view already is, in effect, the league). Naming is Part 8.

---

## Part 3. Architecture: the connection layer

### 3.1 The one module that talks to Sleeper with a token

`lib/sleeper-write.ts` (new) is the ONLY module in the codebase that sends an
authenticated request to `https://sleeper.com/graphql`. It mirrors how
`getSleeperDraftAutopickers` is the one place that touches the anonymous GraphQL
host. Rules baked into its header comment and enforced by tests:

- Every exported function is one Sleeper action. There is no generic
  `runMutation(name, args)` export: a generic runner is how an arbitrary
  mutation reaches the wire. Each function names its mutation as a string
  literal, and the allowlist test (Part 0.2) reads the module source.
- Every function takes a `SleeperSession` (the decrypted token plus the Sleeper
  user id and a fetch), never a raw token string from a caller, so the token's
  only in-memory lifetime is inside a call.
- Every function returns a discriminated result, never throws:
  `{ ok: true; data: T } | { ok: false; reason: SleeperWriteError }` where
  `SleeperWriteError` is `"unauthorized" | "not_your_roster" | "rejected_by_sleeper" | "rate_limited" | "network" | "shape"`. `unauthorized` means the token is dead (Part 5.4).
- The token goes in the `authorization` header (exact form per the spike). It is
  never interpolated into the query string, never logged, and the module has no
  `console.log` of its arguments.
- 429 and 5xx from Sleeper map to `rate_limited` / `network`; a `data` member
  that is not the expected shape maps to `shape`. A GraphQL `errors` array with
  an `unauthorized` code maps to `unauthorized`.

Function set (V1), one per Part 1.3 mutation we ship, e.g.
`setLineup(session, { leagueId, rosterId, starters })`,
`proposeTrade(session, proposal)`, `respondToTrade(session, { leagueId, transactionId, leg, accept })`,
`submitWaiverClaim(session, claim)`, `addDropFreeAgent(session, move)`,
`postLeagueMessage(session, { channelId, text })`, `createLeaguePoll(session, poll)`.

### 3.2 The token store

Migration `0271_sleeper_connections.sql`:

```sql
-- Migration 0271: sleeper_connections (a reader's linked Sleeper session)
--
-- THE MOST SENSITIVE TABLE ON THE SITE. Each row holds an encrypted Sleeper
-- session token that can act as the reader on Sleeper, including on mutation
-- groups this product will never call but a leaked token could (Part 0.2 of
-- docs/beacon-link/beacon-link-plan.md). Treat every column accordingly.
--
-- token_ciphertext is AES-256-GCM, encrypted in the app with a key held in the
-- SLEEPER_TOKEN_KEY env var, NEVER in the database. A database dump alone does
-- not yield a usable token. lib/crypto/secret-box.ts owns the format.
--
-- Access matrix
--   anon          : none
--   authenticated : SELECT own row's NON-SECRET projection ONLY, via the
--                   sleeper_connection_status VIEW below, never this table.
--   service_role  : ALL. The token is read only by server code holding the
--                   service role AND the env key.
--   client writes : BLOCKED. Linking and unlinking go through server actions.
--
-- Rollback: drop view sleeper_connection_status; drop table sleeper_connections;

create table if not exists public.sleeper_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sleeper_user_id text not null,
  sleeper_username text not null,
  token_ciphertext text not null,      -- base64(iv || ciphertext || tag)
  token_key_version int not null default 1,
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked')),
  linked_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text,                      -- server-written, never user text, rendered as text
  updated_at timestamptz not null default now()
);

comment on table public.sleeper_connections is
  'Encrypted Sleeper session tokens, one per FF Beacon user. Service-role only. The token is never exposed to a browser; the sleeper_connection_status view is the only thing authenticated users may read.';

alter table public.sleeper_connections enable row level security;

drop policy if exists sleeper_connections_service_role_all on public.sleeper_connections;
create policy sleeper_connections_service_role_all
  on public.sleeper_connections for all to service_role using (true) with check (true);

revoke all on table public.sleeper_connections from anon, authenticated;

-- The ONLY thing a browser may learn about its own connection: that it exists,
-- the handle it is for, and whether it is healthy. No token, no error internals.
create or replace view public.sleeper_connection_status
  with (security_invoker = true) as
  select user_id, sleeper_username, status, linked_at, last_used_at
  from public.sleeper_connections
  where user_id = (select auth.uid());

comment on view public.sleeper_connection_status is
  'Owner-readable projection of sleeper_connections with the token and error internals removed. security_invoker so the underlying table RLS still applies.';

grant select on public.sleeper_connection_status to authenticated;
```

Note: `security_invoker = true` means the view runs with the querying user's
rights, so the table's own `revoke ... from authenticated` still applies and the
view must therefore be granted explicitly; because the view selects only the
five non-secret columns, the grant exposes only those. Verify in the RLS
sequence that `select * from sleeper_connections` as an authenticated role
returns nothing while `select * from sleeper_connection_status` returns the
reader's own row.

### 3.3 The encryption helper

`lib/crypto/secret-box.ts` (new), no dependencies beyond `node:crypto`:

```ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM sealed box for a single secret string (a Sleeper token).
 *
 * The key is 32 bytes, provided as base64 in SLEEPER_TOKEN_KEY, and lives ONLY
 * in the environment, never in the database, so a database dump cannot decrypt
 * a token. Ciphertext format is base64(iv[12] || ciphertext || tag[16]).
 *
 * keyVersion lets the key be rotated: seal always writes with the current
 * version, open accepts any version whose key is still configured
 * (SLEEPER_TOKEN_KEY, SLEEPER_TOKEN_KEY_1, ...), so a rotation re-seals lazily.
 */
export function sealSecret(plaintext: string): { ciphertext: string; keyVersion: number };
export function openSecret(ciphertext: string, keyVersion: number): string | null;
```

`SLEEPER_TOKEN_KEY` is added to `.env.local` (32 random bytes, base64) and to
the deploy environment, and is documented in `CLAUDE.md`'s env section as
service-side only, never `NEXT_PUBLIC`. `openSecret` returns null on any
failure (wrong key, tampered ciphertext, GCM tag mismatch) rather than throwing,
and a null read maps to a dead connection, never a crash. Test:
`lib/crypto/secret-box.test.ts` round-trips, rejects a flipped byte, and returns
null for a wrong key.

### 3.4 Loading a session for a call

`lib/sleeper-session.ts` (new): `loadSleeperSession(admin, userId)` reads the
`sleeper_connections` row with the service role, `openSecret`s the token, and
returns `{ ok: true; session } | { ok: false; reason: "not_linked" | "dead" }`.
It stamps `last_used_at` on a successful load. The decrypted token exists only
in the returned session object, is passed straight to one `lib/sleeper-write.ts`
call, and is never stored elsewhere or returned to a caller above the action
layer. A `dead` result flips the row to `status = 'expired'` and is what the UI
reads to prompt a re-link.

---

## Part 3A. Security model: handling and storing bearer tokens

This is the section the whole feature answers to. A Sleeper session token is a
bearer credential: whoever holds it IS the reader on Sleeper, with no second
factor, until it expires. We are choosing to store thousands of them. The design
below is defense in depth, so that no single failure exposes a token, and it is
a hard specification, not guidance. A security review sub-agent verifies every
item in 3A.9 before Phase 1 ships, and again before launch.

### 3A.1 Threat model, stated plainly

What we defend against, in rough order of likelihood:

1. A database dump or read-replica leak (a Supabase misconfig, a stolen backup,
   an over-broad RLS policy). Mitigated by encryption at rest with a key that is
   NOT in the database (3A.3): a dump alone yields ciphertext, not tokens.
2. A token reaching a browser (a server component serializing a connection row
   into flight data, a leaky API response, a log line rendered somewhere). This
   is the Signal Scout / Would You Rather trap and it is the easiest mistake to
   make. Mitigated by the projection view (3A.2), the no-return rule (3A.4), and
   a build-time guard (3A.6).
3. A token in logs, error trackers, or an LLM prompt. Mitigated by the no-log
   rule (3A.4) and by the write module never logging its arguments.
4. A compromised dependency or a supply-chain attack reading process memory or
   the env. Mitigated by minimizing where the key and the plaintext live (3A.3,
   3A.5) and by the dependency posture (3A.8).
5. Our own code calling a mutation it should not (a bug, a future careless
   addition). Mitigated by the allowlist (Part 0.2, 3A.7).
6. An attacker abusing a legitimately-linked account through our UI (CSRF, a
   forged action, an IDOR onto someone else's connection). Mitigated by the
   action envelope's re-derived ownership, the same-origin guard, and per-user
   scoping (3A.7).
7. Brute-forcing the 2FA code during linking. Mitigated by tight verify-bucket
   rate limits and short challenge expiry (3A.7, Part 6.4).

What we explicitly do NOT claim to defend against: a full server compromise
where an attacker has both the database AND the running process's environment.
At that point they have the key and the ciphertext and can decrypt. No
app-level design survives that; it is bounded by infrastructure security
(Vercel and Supabase account hardening, 2FA on both, least-privilege service
keys), which is an operational duty recorded in 3A.10, not a code task.

### 3A.2 The token never leaves the server, structurally

- The token lives in exactly two forms: ciphertext in `sleeper_connections.token_ciphertext`,
  and plaintext transiently inside a single `performSleeperAction` call, in a
  `SleeperSession` object that is created by `loadSleeperSession`, passed to one
  `lib/sleeper-write.ts` function, and discarded.
- No browser can read `sleeper_connections`: the table is `revoke all ... from
  anon, authenticated`, and the ONLY authenticated-readable object is the
  `sleeper_connection_status` view, which selects five non-secret columns and is
  `security_invoker` so the table RLS still applies. The RLS verification
  sequence (BL-T004) proves `select * from sleeper_connections` as the
  authenticated role returns zero rows.
- No server action, route, or server component ever puts a token, or a
  `SleeperSession`, into a prop, a JSON response, a redirect, a cookie, or a
  rendered page. The connection is represented to the client as at most
  `{ connected: boolean; username: string; status }` from the view.

### 3A.3 Encryption at rest, and the key

- AES-256-GCM (`lib/crypto/secret-box.ts`), an authenticated cipher, so a
  tampered ciphertext fails the GCM tag check and `openSecret` returns null
  rather than yielding a forged plaintext.
- The 32-byte key is provided as base64 in `SLEEPER_TOKEN_KEY`, an environment
  variable, NEVER a `NEXT_PUBLIC_` var, never committed, never in the database,
  never in a client bundle. A dump of Supabase does not contain it. Vercel holds
  it as an encrypted environment secret scoped to server runtimes.
- Per-record IV: `randomBytes(12)` per seal, stored alongside the ciphertext, so
  two identical tokens do not produce identical ciphertext.
- Key rotation is built in from day one: `token_key_version` on every row,
  `SLEEPER_TOKEN_KEY` plus optional `SLEEPER_TOKEN_KEY_1`, `_2` for older
  versions, `sealSecret` always writes the current version, `openSecret` reads
  any configured version, and `scripts/rotate-sleeper-token-key.ts` (BL-T035a,
  a follow-on, not V1-blocking) re-seals every row to the current version so an
  old key can then be retired. A compromised key is rotated without asking every
  reader to re-link, though a KNOWN key compromise still forces re-link because
  the tokens themselves must be treated as exposed (3A.10).
- `openSecret` never throws and never logs the ciphertext or the key; a failure
  is a null return that maps to a dead connection.

### 3A.4 Never logged, never returned, never in an LLM prompt

- `lib/sleeper-write.ts` and `lib/sleeper-session.ts` contain no `console.*` of
  their arguments or of any object that transitively holds the token. The write
  module logs at most the mutation kind and the mapped error reason, never the
  request body.
- The 2FA code and the token pass through the link actions and are never logged.
- `sleeper_action_log.detail` and `sleeper_connections.last_error` are
  server-written from a fixed vocabulary (like `power_pulse_detail` and the
  Manager Pulse run detail), never a raw Sleeper response and never user text,
  so a token or an internal message can never land in a reader-visible column.
- No token, connection row, or session ever enters a prompt to BEAM or any
  other model. If Beacon Link data is ever summarized for an AI surface, it is
  the action log's safe columns only.

### 3A.5 Transport and process hygiene

- The only outbound destination for a token is `https://sleeper.com/graphql`
  over TLS, from `lib/sleeper-write.ts`, in the `authorization` header. The
  token is never a query parameter or a URL segment (URLs are logged by proxies;
  headers under TLS are not).
- The plaintext token is held only for the duration of one action call and is
  not cached in a module-level variable, a memo, or the request-coalescer. Two
  concurrent actions each decrypt their own.
- `SleeperSession` is not serializable into a React Server Component payload by
  construction: it is created and consumed inside a server action, below the
  component tree, and never returned upward.

### 3A.6 The build-time guard against leakage

`lib/beacon-link/leakage-guard.test.ts` (new) is a source-scanning test in the
spirit of the Manager Pulse purity and client-boundary guards. It fails the
build if:
- any file outside `lib/sleeper-write.ts`, `lib/sleeper-session.ts` and
  `lib/crypto/secret-box.ts` imports `secret-box`'s `openSecret`;
- any component file (has `"use client"`) imports from `lib/sleeper-session`,
  `lib/sleeper-write` or references `token_ciphertext`;
- any server component or route returns an object literal whose keys include
  `token_ciphertext` or `token` sourced from a `sleeper_connections` read (a
  heuristic string check that flags `sleeper_connections` selects that do not go
  through the status view or the session loader).
The heuristic is deliberately noisy toward false positives; a legitimate new
reader of the table adds an allow-list entry with a reason, the same debt-ledger
pattern the projection guards use.

### 3A.7 Authorization, CSRF, IDOR, and brute force

- Every action re-derives the acting roster from the connection's Sleeper user
  id against the league's synced rosters (`resolveCockpitContext`), and refuses
  when the target roster is not the reader's own. A forged `rosterId` or
  `leagueId` in a request buys nothing: the connection decides who you are.
- Connection and log rows are keyed by `user_id` and scoped by RLS to the owner
  (reads) or the service role (writes); there is no numeric or guessable id that
  could be walked to reach another reader's connection (IDOR). The action-log
  admin view is behind `requireAdmin`.
- Every state-changing action carries the same-origin guard the write routes
  already use (`x-requested-with: ff-beacon`, rejected cross-origin), and server
  actions inherit Next's action-id protection; a bare GET can never trigger a
  write.
- Linking is the one place we touch Sleeper's auth. `beacon-link-verify` is
  rate limited tightly (default 10 per hour per user) and the challenge expires
  in ten minutes, so a 2FA code cannot be brute-forced within its validity, and
  a failed verify consumes a slot. `beacon-link-start` is limited so an attacker
  cannot spray Sleeper's auth with a wordlist of usernames through us.

### 3A.8 The write module is a permanent allowlist

Restated here because it is a security control, not a convenience: the only
mutations that exist in our code are the fantasy-management set in Part 1.3.
`lib/sleeper-write-allowlist.test.ts` denylists the financial, password and
deletion substrings AND allowlists the exact V1 set, so a mutation Sleeper adds,
or a mutation a future contributor pastes in, is excluded by default and fails
the build. This bounds what a bug in OUR code can do to a reader's account; it
does not bound a leaked token, which is why 3A.2 through 3A.6 exist.

### 3A.9 The review checklist, verified before Phase 1 and before launch

A security review sub-agent confirms each, explicitly, citing the code:
1. `select * from sleeper_connections` as anon and as authenticated returns
   nothing; the status view returns only the owner's five safe columns.
2. No `"use client"` file imports the session, write, or secret-box modules.
3. No token, ciphertext, or `SleeperSession` appears in any API response, prop,
   flight payload, cookie, redirect, or log, proven by grepping the built server
   and client chunks, not just the source (the Manager Pulse build found a
   client-boundary bug that only showed in the built chunk).
4. `SLEEPER_TOKEN_KEY` is absent from every client bundle and every
   `NEXT_PUBLIC_` surface.
5. The allowlist test denies a financial mutation added to the write module.
6. The leakage guard fails when a token is returned from a server component.
7. Every action re-derives ownership; a forged roster or league id is refused,
   proven by a test that submits a mismatched id.
8. Rate limits fail closed (a limiter outage refuses the action, never opens
   it), matching the handle-lookup limiter's direction.
9. `openSecret` on a tampered ciphertext returns null and the action refuses.
10. Disconnect deletes the row and the action log records it; a subsequent
    action on that user refuses with `not_linked`.
11. `npm audit` is clean of new high or critical findings introduced by this
    feature.

### 3A.10 Operational duties (not code, but part of the security posture)

- Vercel and Supabase accounts have 2FA and least-privilege access. The service
  role key and `SLEEPER_TOKEN_KEY` are held only in the deploy environment.
- A written incident plan exists before launch: if a token store or the key is
  believed exposed, the response is (a) rotate `SLEEPER_TOKEN_KEY`, (b) set
  every `sleeper_connections.status` to `revoked` so no action fires, (c) notify
  affected readers that they should sign out on Sleeper and re-link, (d) follow
  any breach-notification duty the owner's jurisdiction imposes. This is a
  custody obligation the owner accepts in Part 0.2, written down so it is not
  improvised under pressure.
- The action log is the forensic record: if a reader reports an action they did
  not take, the log shows what fired, when, and from which session, which is how
  a compromised-account report is investigated.

---

## Part 4. The cockpit: League Pulse, extended

The League Pulse deep view (`/leagues/[sleeper_league_id]` and its section
routes) already renders a league as if it were Sleeper, with our own WAR,
projections, Power Pulse and Manager Ledger on top. When the connected reader is
looking at a league they are IN, it becomes the cockpit. Nothing here changes
for a league the reader is not in, or for a reader who is not connected: the new
sections and buttons simply do not render.

### 4.0 The gate every cockpit surface shares

`lib/beacon-link/cockpit-context.ts` (new): `resolveCockpitContext(admin, userId, sleeperLeagueId)`
returns, in one place, the four facts every actionable surface needs:

```ts
type CockpitContext = {
  connected: boolean;             // reader has an active sleeper_connections row
  sleeperUserId: string | null;   // from the connection, never the client
  myRosterId: number | null;      // this reader's roster in THIS league, or null if not a member
  actable: boolean;               // connected AND myRosterId !== null
};
```

`myRosterId` is derived by matching the connection's `sleeperUserId` against the
league's stored `rosters.owner_id` / `co_owners` (already synced by League
Pulse). A surface renders an action ONLY when `actable` is true, and every
server action re-derives this context and re-checks `actable` and roster
ownership itself. The client is never trusted for "this is my team": a forged
`rosterId` in a request is rejected because the action re-derives it from the
connection. This is the same "ownership re-derived, never trusted from the
caller" rule the Trade Ideas server path already holds.

### 4.1 New section: Trades (the inbox)

New route `/leagues/[sleeper_league_id]/trades`, new `LEAGUE_NAV_ITEMS` entry
`{ id: "trades", label: "Trades", hint: "Offers waiting on you, and deals you have out", icon: "handshake" }`
placed after `trade-ideas`. Visible only when `actable`.

Reads, through `lib/beacon-link/trades-inbox.ts`:
- `league_transactions(leagueId, type: "trade", status: "pending")` through the
  connected session, giving every pending trade in the league.
- Split into INCOMING (a side is `myRosterId`, proposed by someone else),
  OUTGOING (proposed by `myRosterId`), and OTHER (does not involve me; shown
  collapsed, read-only, because a commissioner can see them).

Each incoming trade renders the SAME `TradeVerdict` the Transactions page and
Trade Ideas already render (`lib/trade-analyzer.ts analyzeTrade`), so the reader
sees our value differential, the projected-wins impact (`lib/trade-impact/`),
and the WAR context on the offer BEFORE they act, then two buttons: Accept and
Reject, each behind the action envelope (Part 6). Outgoing trades get a Cancel
(which is `reject_trade` on your own proposal). This is the single most valuable
surface in the feature: an incoming trade offer, graded by our engine, accepted
or rejected in one click, with the offer never having to be retyped.

The section reads live (no cache): a pending trade is a now fact, and the read
is one authenticated call. It is metered (Part 6.4).

### 4.2 New section: My Team (management)

Extends the existing Lineups page rather than adding a route, because Lineups is
already "one team, one week, the optimiser and the waiver wire". When `actable`
and the roster shown is the reader's own:

- The optimiser's "best lineup" gains an Apply this lineup button:
  `roster_update_starters` with the optimiser's `optimalSleeperIds` arranged
  into the league's slot order. The button is disabled during a live week (you
  cannot change a lineup mid-game for players who have played), matching the
  page's existing live-week rules.
- Each bench-to-starter what-if swap gains a Make this change button (the single
  swap, not the whole lineup).
- The cut list and the free-agent panel gain Drop and Add / Claim buttons
  (`league_create_transaction type: "free_agent"` for a free league, or a
  `submit_waiver_claim` when the player is on waivers), the claim carrying the
  FAAB bid the FAAB calculator computed if the reader came from there.
- Set trade block / remove trade block on any of the reader's own players
  (`add_league_player_trade_block`).

Every one is behind the action envelope and rate limited.

### 4.3 New section: Chat (optional, later in the phase)

The league chat and polls, in a panel on the deep view Overview. Reads the
channel's recent messages (an authenticated query, confirmed in the spike) and
offers: post a message (`create_message`), start a poll (`create_poll`), react
(`create_reaction`). The value beyond novelty: a "post my Power Pulse standing"
or "start a poll: who wins this trade" button that turns our data into a league
conversation. Lower priority than Trades and My Team; ships last in Part 9's
cockpit phase and can be cut without affecting the rest.

### 4.4 What the cockpit does NOT do

No financial anything (Part 0.2). No commissioner-only destructive mutations
(`delete_league`, `league_remove_user`, `override_league_playoff_brackets`) in
V1, even though a commissioner's token could call them: they are high-blast-radius
and not what this feature is for. No acting on a league the reader is not a
member of. No acting on another member's roster.

---

## Part 5. Beacon Link: the account connection UX

### 5.1 Where it lives

A "Connect Sleeper" card on `/my-beacon/account` (the natural home for account
links, beside the sessions list that already manages auth sessions there) and a
compact "Connect to act on your leagues" prompt that appears on the League Pulse
deep view of a league the reader is in but has not connected. Both are visible
only to a signed-in reader.

### 5.2 The link flow

Two server actions in `app/my-beacon/account/beacon-link-actions.ts`:

1. `startSleeperLink({ username })`: validates the handle
   (`isValidSleeperHandle`), resolves it to a Sleeper user id
   (`resolveManagerHandle`), then calls the auth step that triggers Sleeper's
   2FA (the exact mutation from the spike), and returns
   `{ ok: true; challengeId }` or a typed error. It stores a short-lived,
   server-side challenge record (a row in `sleeper_link_challenges`, migration
   0272, keyed by user, holding the Sleeper-side handle to the pending
   verification, expiring in ten minutes) and NEVER returns anything secret.
2. `completeSleeperLink({ challengeId, code })`: submits the 2FA code to
   Sleeper's verify mutation, receives the token, `sealSecret`s it, upserts the
   `sleeper_connections` row, deletes the challenge, and returns
   `{ ok: true; username }`. The code and the token pass through this action and
   are never logged.

Both are rate limited (Part 6.4) on a `beacon-link-start` and
`beacon-link-verify` bucket, tighter than the action buckets, because they touch
Sleeper's auth and a code-guessing attempt must not be cheap.

### 5.3 Consent at link time

The Connect card states, in plain words, before the reader types their username:
what FF Beacon will be able to do (set lineups, submit waivers, propose and
respond to trades, post to chat, on leagues they are in), what it will never do
(anything involving money or their password), that they can disconnect any time,
and that every action will warn them first. The reader ticks an explicit consent
box, whose state is recorded on the connection row (`linked_at` plus a
`consent_version` column, so a later change to what we do can require re-consent).

### 5.4 Disconnect and expiry

- Disconnect (`disconnectSleeper()` server action) deletes the
  `sleeper_connections` row. The token is gone from our systems; we cannot and
  do not revoke it on Sleeper's side (we have no un-authenticated way to), and
  the card says so: "This removes your token from FF Beacon. To end the Sleeper
  session itself, sign out on Sleeper." That is the honest statement.
- A `dead` token (Sleeper returned unauthorized) flips the row to `expired`, and
  every cockpit surface then shows a "Reconnect Sleeper" prompt instead of the
  actions. No action is ever attempted on an expired connection.
- We surface the connection in the same place as auth sessions, so a reader has
  one obvious spot to see and cut it.

---

## Part 6. The action envelope: one pattern for every actionable button

Every button that writes to Sleeper, everywhere in the app, goes through one
shared pattern so the warning, the confirmation, the rate limit, the ownership
check, the execution and the audit log are identical and cannot be forgotten on
a new surface.

### 6.1 The shape

`lib/beacon-link/action-envelope.ts` (new) exports `performSleeperAction`, a
server-side function every action server-action calls:

```ts
performSleeperAction(admin, {
  userId,
  leagueId,
  kind: SleeperActionKind,     // "set_lineup" | "accept_trade" | "submit_waiver" | ...
  // a closure that, given the loaded session and the derived cockpit context,
  // validates ownership for THIS kind and returns the lib/sleeper-write.ts call
  run: (session, ctx) => Promise<SleeperWriteResult>,
  summary: string,             // server-built, human, stored in the log and shown in the toast
}): Promise<{ ok: true; summary: string } | { ok: false; reason: string }>
```

`performSleeperAction`, in order, every time:
1. Resolves the session (`loadSleeperSession`). Not linked or dead returns a
   typed refusal the UI turns into a reconnect prompt.
2. Resolves `CockpitContext` and asserts `actable` and that the action's target
   roster is `myRosterId` (the `run` closure receives `ctx` and does the
   kind-specific ownership assertion; the envelope refuses if it throws).
3. Claims a rate-limit slot (Part 6.4). Refusal returns `rate_limited`.
4. Writes an `intent` row to `sleeper_action_log` (Part 6.3) BEFORE the call, so
   an action that crashes mid-flight still leaves a trace.
5. Runs `run`, maps the result, and updates the log row to `success` or the
   failure reason.
6. Returns a server-built summary for the toast. Never returns Sleeper's raw
   response.

Validation before claiming, ownership re-derived not trusted, the slot claimed
before the expensive half: the same order the Trade Ideas evaluation path holds.

### 6.2 The warning, on the client, before the call

No actionable button fires on first click. Each opens the house dialog
(`components/slide-up-dialog.tsx`, `desktopPlacement="center"` because it is a
decision, the same choice the Signal Scout confirms make) stating exactly what
will happen on the reader's real Sleeper account, in specific terms built from
the action: "This will set your Week 12 lineup in Sunday Champs on Sleeper,"
"This will accept the trade sending Bijan Robinson for Puka Nacua in Sunday
Champs on Sleeper. This cannot be undone from FF Beacon." The dialog names the
league, the specific change, and that it is real, and has a single confirming
button plus Cancel. The confirming button is the only thing that calls the
server action. This is a hard rule: `components/beacon-link/action-button.tsx`
is the ONLY component that triggers a Sleeper write, every actionable surface
uses it, and it cannot be constructed without a `confirmation` prop carrying the
league name, the specific effect sentence, and the reversibility note.
`components/beacon-link/action-button.test.tsx` asserts the dialog opens and the
action does not fire until confirm.

### 6.3 The audit log

Migration `0273_sleeper_action_log.sql`: one row per attempted action, owner and
service-role readable, holding `user_id`, `sleeper_league_id`, `kind`, `summary`
(server-built text), `status` (`intent` | `success` | `rejected` | `error` |
`rate_limited`), `detail` (server-written, never user text, rendered as text),
`created_at`, `completed_at`. The reader sees their own log on the account page
("Everything FF Beacon has done on your Sleeper account"), which is both a trust
feature and the thing they check if something looks wrong. An admin sees it at
`/admin/beacon-link` for support and abuse detection.

### 6.4 Rate limiting

Through the existing `claimRateLimitSlot` (`lib/rate-limit-claim.ts`,
`try_claim_rate_limit`, migration 0137), fails closed. Buckets and defaults, all
admin-editable in a `beacon_link_settings` row (migration 0274, the same
single-row jsonb shape as `manager_pulse_settings`, validated server-side,
covered by a settings-coverage test):

| Bucket | Default | Why |
| --- | --- | --- |
| `beacon-link-start` per user | 5 / hour | starting a link hits Sleeper auth |
| `beacon-link-verify` per user | 10 / hour | a 2FA code must not be cheap to guess |
| `sleeper-action` per user | 30 / 10 min | a person managing a team, not a script |
| `sleeper-action` per user per league | 15 / 10 min | one league cannot monopolize |
| `sleeper-write-global` site-wide | 600 / min | our own ceiling on Sleeper write egress, mirrors the Manager Pulse read bucket |

The site-wide bucket shares the token-bucket idea from the Manager Pulse plan's
`lib/sleeper-budget.ts` if that has shipped; if not, it is a durable
`try_claim_rate_limit` bucket, which is fine here because writes are far rarer
than the read drainer's calls.

### 6.5 When Sleeper breaks

Every action can return `rejected_by_sleeper` (Sleeper accepted the request and
refused the action: a waiver that lost, a trade the other side already pulled) or
`unauthorized` (dead token) or `network`. The UI states each honestly: a rejected
action explains it did not happen and why in plain terms, a dead token prompts
reconnect, a network error offers retry. Because Sleeper is undocumented, a
mutation that starts returning a new error shape must degrade to
`rejected_by_sleeper` with a generic message, never a crash; the write module's
`shape` result covers this. An admin alert fires (through `lib/email/`) when the
site-wide rejection rate crosses a threshold, which is the early warning that
Sleeper changed something.

---

## Part 7. Actionable buttons in the existing tools

Each is the same `ActionButton` (Part 6.2) wired to the same envelope, added to a
surface that already computes the decision. Each renders only when `actable` for
the relevant league.

- FAAB calculator (`/tools/faab`): the computed bid gains Place this bid, which
  is `submit_waiver_claim` with `v_settings` set to the calculator's number, for
  the reader's roster in the chosen league. The calculator already knows the
  player, the league and the bid; the button carries them into the claim.
- Trade Ideas (`/leagues/[id]/trade-ideas`): every suggested trade and every
  built trade the reader is a side of gains Propose this trade
  (`propose_trade`). The suggestion already has both sides' player and pick maps;
  they become the mutation arguments. A suggestion involving a roster that is not
  the reader's own does not get the button (you can only propose from your own
  team).
- Lineups (`/leagues/[id]/lineups`): the Apply this lineup and per-swap buttons
  from Part 4.2 (this page IS the My Team surface).
- Free Agent Finder (`/my-beacon/sleeper-leagues` and the panel): a found free
  agent gains Add (with a drop picker) in any league where the reader is
  connected and a member.
- Transactions page (`/leagues/[id]/transactions`): a pending trade addressed to
  the reader gains Accept / Reject inline, the same controls as the Trades
  inbox, so a reader who lands on Transactions is not sent elsewhere to act.

None of these change for a non-connected reader or a league the reader is not in:
the button is absent, and the tool is exactly what it is today.

---

## Part 8. Naming and gating

### 8.1 Names

- The connection capability: BEACON LINK ("Connect Sleeper" is the button verb;
  "Beacon Link" is the feature name in docs and the account card). Fits the
  Beacon Brief / Beacon Steals family and describes what it does (links the
  account). Owner may override.
- The cockpit is NOT separately named. It is the League Pulse deep view when
  you are connected and a member; the new sections are "Trades" and the extended
  "Lineups", in plain functional labels, matching every other League Pulse tab.
  The word "cockpit" is a design intent in this doc, not UI copy. If the owner
  wants a name for the connected state, options: "Live", "Connected", "Piloting";
  recorded as a decision, not chosen here.

Decision (owner): capability name ______; connected-state label (if any) ______.

### 8.2 Gating, in three layers

1. Signed out: none of this exists. No nav entry, no card, no action button,
   no route that renders anything (the routes 404-or-redirect to login exactly
   as the Manager Pulse report route does). The one thing a guest may see is a
   Part 25 promotion for an action (a locked control or a strip), which is
   not an action button: it never calls an action, and its dialog's link
   reads "Sign in or join Beacon Plus" and carries `next`.
2. Signed in, not connected: the "Connect Sleeper" card and the connect prompt
   on a league the reader is in. No action buttons anywhere.
3. Signed in and connected: action buttons on leagues the reader is a member of,
   the Trades inbox, the My Team controls, chat.

Promotion (REVISED 2026-09-07, this replaces the earlier "not advertised"
rule): Beacon Link IS promoted, in two places and in one register. Inside the
tools, at the exact spot each action would be used, a reader who is not
entitled sees the Beacon+ promotion for that action (Part 25: a locked button,
a one-line strip, a rail card or a disclosure, never a modal of its own and
never more than one per screen). On the Beacon Plus pages (Part 27) it is one
of the things a membership includes, listed by outcome ("apply the lineup our
optimiser found, on Sleeper, in one press") and never as the headline. There
is still no tools-hub card and no footer link for Beacon Link on its own,
because it is a capability of a membership rather than a tool.

ABSOLUTE RULE: nothing on the site, in an email, in a tooltip, in alt text or
in a dialog ever describes HOW an action reaches Sleeper. No mention of a
token, a session, a header, an endpoint, a query, a mutation or a login flow
anywhere a reader can see. Copy says what happens ("your lineup is set on
Sleeper") and stops. `lib/billing/promo-copy.test.ts` (Part 25.5) holds the
denylist and fails the build on a violation. The consent copy at link time
(Part 5.3) is the one exception, because it must say what we hold to be
honest, and it is worded by Part 5.3 and reviewed, not by the promotion
system.

A `beacon_link_settings.enabled` kill switch (default false until launch)
hides every surface at once, so the whole feature can be turned off without a
deploy if Sleeper objects. Off, the promotions for Beacon Link actions are
hidden too (Part 25.3): a pitch for something nobody can buy is a broken
promise.

### 8.3 Real-account requirement

Already true by construction: every surface requires a signed-in FF Beacon
account (Part 8.2), and the action log ties every action to that account, so
activity is always attributable. A guest can never reach any of it.

---

## Part 9. Phases and tasks

Nothing starts until Part 0 is signed and BL-T001 is recorded.

### Phase 0: the spike and the foundations

```
BL-T001 | THE SPIKE. Confirm the auth flow, the token header, the token lifetime,
        | the create_message channel source, and the multi-entry trade encoding,
        | against the owner's own account with consent, in a throwaway branch.
        | Record every finding in Part 1.5 and Part 1.3. No code past here until done.
BL-T002 | lib/crypto/secret-box.ts + test. AES-256-GCM sealed box, key from env.
BL-T003 | SLEEPER_TOKEN_KEY added to .env.local and documented in CLAUDE.md env section.
BL-T004 | migration 0271 sleeper_connections + the status view; RLS sequence verified.
BL-T005 | migration 0272 sleeper_link_challenges (short-lived link challenges).
BL-T006 | migration 0273 sleeper_action_log.
BL-T007 | migration 0274 beacon_link_settings (buckets, consent_version, enabled kill switch).
BL-T008 | regenerate lib/database.types.ts.
BL-T009 | lib/sleeper-write.ts: the authenticated module, V1 function set, allowlist header.
BL-T010 | lib/sleeper-write-allowlist.test.ts: denylist substrings + exact allowlist (3A.8).
BL-T010a | lib/beacon-link/leakage-guard.test.ts: the source and built-chunk scan (3A.6).
BL-T011 | lib/sleeper-session.ts: load, decrypt, stamp, dead-token handling.
BL-T012 | lib/beacon-link/cockpit-context.ts: resolveCockpitContext + tests.
BL-T013 | lib/beacon-link/action-envelope.ts: performSleeperAction + tests (ownership, order, log).
BL-T014 | components/beacon-link/action-button.tsx + test: the one component that fires a write.
```

### Phase 1: Beacon Link, the connection

```
BL-T015 | app/my-beacon/account/beacon-link-actions.ts: start, complete, disconnect.
BL-T016 | the Connect Sleeper card, the consent copy, the connected/expired states.
BL-T017 | the "Connect to act" prompt on a league the reader is in but not connected.
BL-T018 | the reader's action log view on the account page.
BL-T019 | security review sub-agent: the full Part 3A.9 checklist, before Phase 1 ships.
```

### Phase 2: the highest-value surface, Trades

```
BL-T020 | lib/beacon-link/trades-inbox.ts: the authenticated pending-trades read, split by side.
BL-T021 | migration/nav: LEAGUE_NAV_ITEMS gains "trades"; the route renders only when actable.
BL-T022 | /leagues/[id]/trades: incoming/outgoing/other, each with the TradeVerdict already used.
BL-T023 | Accept / Reject / Cancel through the envelope and the ActionButton.
BL-T024 | Transactions page: inline Accept/Reject on a pending trade addressed to the reader.
BL-T025 | accessibility + security review sub-agents.
```

### Phase 3: My Team (Lineups) and the tool buttons

```
BL-T026 | Lineups: Apply this lineup, per-swap Make this change (disabled live-week).
BL-T027 | Lineups: Drop / Add / Claim on the cut list and free-agent panel.
BL-T028 | Lineups: set/remove trade block.
BL-T029 | FAAB calculator: Place this bid.
BL-T030 | Trade Ideas: Propose this trade (after BL-T001 confirmed the trade encoding).
BL-T031 | Free Agent Finder: Add with a drop picker.
BL-T032 | accessibility + security review sub-agents across all six.
```

### Phase 4: Chat, the kill switch UI, the admin surface

```
BL-T033 | Chat panel on the deep view Overview: read, post message, react.
BL-T034 | Poll: create and vote, with a "poll this trade / standing" shortcut from our data.
BL-T035 | /admin/beacon-link: the action log, the settings form, the site-wide rejection alert.
BL-T036 | CLAUDE.md: the Beacon Link rules (Part 10).
```

Draft-room live control (`draft_pick_player`, `draft_make_offer`) is a Phase 5
that is not scoped here; it is a real-time surface with its own failure modes and
is recorded as a follow-on, not planned in detail.

---

## Part 10. Rules this feature adds, for CLAUDE.md

- `lib/sleeper-write.ts` is the ONLY module that sends an authenticated request
  to Sleeper. It is an allowlist: no generic mutation runner, one function per
  action, every mutation a string literal, and
  `lib/sleeper-write-allowlist.test.ts` fails the build if any financial,
  password, or account-deletion mutation string appears.
- A Sleeper session token is the most sensitive datum on the site. It is
  encrypted at rest with `SLEEPER_TOKEN_KEY` (never in the database), never sent
  to a browser, never logged, never returned by any API, and revocable in one
  action. Only `sleeper_connection_status` is readable by a browser, and it
  carries no token and no error internals.
- Every Sleeper write goes through `performSleeperAction`, which re-derives the
  reader's roster from the connection (never trusts the client), rate limits,
  logs an intent before the call, and logs the outcome after. Ownership is
  re-derived, never submitted.
- No Sleeper write fires without the house confirm dialog naming the league, the
  specific effect, and that it is real. `components/beacon-link/action-button.tsx`
  is the only component that triggers a write and cannot be built without that
  confirmation copy.
- Beacon Link surfaces render only for a signed-in, connected reader acting on a
  league they are a member of. Signed out, the feature does not exist. A
  `beacon_link_settings.enabled` kill switch hides everything at once.
- We never implement a financial, password, or account-destruction mutation,
  and we never act on a league the reader is not in or a roster that is not
  theirs, even when the token could.

---

## Part 11. Open decisions for the owner

1. Part 0.1 (terms of service) and Part 0.2 (custody). Both required.
2. The capability name (Part 8.1). Beacon Link is the proposal.
3. Whether Chat (Part 4.3) is in V1 or deferred. It is the lowest-value, most
   novelty-driven surface and the easiest to cut.
4. Whether commissioner powers are ever in scope (Part 4.4 excludes them for V1).
5. Whether the action log is retained forever or pruned; a trust feature argues
   for keeping it, storage argues for a window. Default: keep, revisit.

---

# MEMBERSHIP AND BILLING: paying for Beacon Link, and for anything else

Added 2026-09-07 against `main` at `ffb32a7`, revised the same day after the
owner's review (Part 12 records the decisions). Task prefix for the build:
`MB-T###` in `progress.md`. Migrations 0275 to 0301. Status: PLAN ONLY.

THIS IS THE SPEC for the paid half of the product. It carries every table,
column, policy, RPC, route, module, env var, provider call, email and test the
build needs. The companion artifact is the plain-language pitch and carries
none of this.

Read Part 12 first. Like Part 0, it is a list of decisions that are the
owner's alone, and two of them (a PayPal Business account, and sales tax)
decide what can be built at all.

---

## Part 12. The gate: decisions the owner has made

Every decision below was answered by the owner on 2026-09-07. They are recorded
here as the terms the build works to. A change to any of them is a revision to
this document first and a code change second.

### 12.1 The name: Beacon Plus, written Beacon+ where space is short

DECIDED 2026-09-07. The paid membership is BEACON PLUS. The short mark is
BEACON+ (a plus sign, no space), used where a full word does not fit or where
a badge is wanted: the header pill, the locked-button suffix, the tier badge,
the promotion strip's leading mark, an email subject prefix, an OG card. In
running prose, headings, the Terms, the refund policy and every email body the
full name Beacon Plus is used. Both spellings resolve to one constant pair in
`lib/billing/constants.ts`:

```ts
export const MEMBERSHIP_NAME = "Beacon Plus";
export const MEMBERSHIP_MARK = "Beacon+";
```

Rules for the mark, enforced by `lib/billing/copy.test.ts`: the plus sign is
the ASCII `+`, never a typographic variant; the accessible name of anything
that shows the mark visually is the full name (a `<span aria-hidden>` mark
beside an `sr-only` "Beacon Plus" is NOT the pattern, per the Lineups rule;
the element's text is "Beacon Plus" and CSS may not shorten it, so the mark is
used only where the full name is not already on the same control); the mark is
never pluralised or possessive.

The tiers underneath the product are named by the admin (Part 14.2). The seed
(Part 15.13) creates two: `free`, named "Free", and `plus`, named "Plus", so
the day-one paid tier reads "Beacon Plus" in full on the pricing page and
"Plus" as the badge. The owner can rename or add tiers in the panel at any
time.

### 12.2 PayPal and Venmo: in, behind a switch

DECIDED 2026-09-07. A PayPal Business account exists. Part 16.3 is built as
specified, in Phase 3. `billing_settings.providers.paypal.enabled` (Part 15.1)
turns PayPal and Venmo on and off together without a deploy, and
`providers.paypal.venmo` hides the Venmo wording and funding option while
leaving PayPal on. Card and wallet through Stripe are unaffected by either
switch. The PayPal.me and Venmo DONATION links keep pointing at the personal
account and are unaffected by any of this.

### 12.3 Sales tax: Stripe Tax, through a modular tax module

DECIDED 2026-09-07. Tax is collected through Stripe Tax inside Checkout. The
owner's expectation, which this plan matches, is that Stripe handles the
computation and the filing reports; our side passes the right parameters. The
tax settings are a BLOCK with a mode, not a boolean, so a later change (a flat
rate for a single-state registration, or turning collection off) is a form in
the panel rather than a code change. Part 29 specifies the module
(`lib/billing/tax.ts`), the three modes (`stripe_tax`, `manual`, `none`), and
what each puts on a Checkout session. PayPal has no equivalent; Part 29.4
says what the PayPal button shows when tax is on.

### 12.4 Refunds: all sales final, handled case by case

DECIDED 2026-09-07. The policy the site publishes and the code enforces:

- All sales are final. No refund is issued automatically for any reason.
- A cancelled membership runs to the END of the period already paid for, then
  stops. There is no partial-period refund and no proration on cancel. The
  owner can end a membership early by hand (Part 19.6, Members: "End now") when
  a case warrants it.
- A refund, when the owner grants one, is a case-by-case decision made by a
  person, issued from the admin panel or the Stripe Dashboard, and recorded in
  the audit log with a note. Nothing in the reader-facing UI offers a refund
  button.
- A one-time service is likewise final at purchase. The owner may refund one
  at their discretion; the admin queue offers the button at every fulfilment
  stage, and the audit row records the stage it was at.
- A disputed charge (a chargeback) suspends access at once and until the
  dispute resolves. The policy asks readers to contact us before disputing.
- Where a law grants a reader a right that cannot be waived (a statutory
  cooling-off period in some jurisdictions), that right applies and the policy
  says so.

The full policy text, written to read as a professional legal document while
saying exactly the above, is Part 30. It is published at `/refund-policy`, is
linked from the pricing page beside every Buy or Join control, from the Terms,
from the receipt and welcome emails, and from the checkout return page.
`billing_settings.purchases.refundableUntil` defaults to `"never"` (Part
15.1) so that the code's default matches the policy's.

### 12.5 Terms, privacy and the legal read

DECIDED 2026-09-07: the owner will arrange the legal read of `/terms`,
`/privacy` and `/refund-policy` themselves, and it does not gate the build.
The plan still builds every mechanism the auto-renewal laws describe (the
pre-charge disclosure, the affirmative consent tick on Checkout, the
confirmation email with the terms and a cancel link, and one-step online
cancellation), because they are good product regardless of jurisdiction, and
Part 23 remains the list of copy that changes. None of this document is legal
advice.

### 12.6 What is free and what is paid

DECIDED 2026-09-07. Everything that existed on the site before this plan is in
the Free tier and stays there. Everything the Beacon Link plan (Parts 0 to 11)
and this plan add is paid: linking a Sleeper account, every Beacon Link
action, the trades inbox, and email notifications (Part 26). The seed (Part
15.13) therefore creates the `plus` tier WITH those features already assigned,
so that the day Beacon Link ships nothing needs to be ticked, and the Free
tier with every existing feature, so that day one of billing changes nothing
for anybody. Moving an existing feature out of Free remains possible in the
panel, and remains a product decision this plan does not make.

### 12.7 Where Beacon Plus is promoted

DECIDED 2026-09-07, and it reverses Part 8.2's earlier rule. Beacon Plus is
promoted PRIMARILY INSIDE THE TOOLS, at the exact place a paid capability
would be used, in a register the owner described as "a premium upgrade
without being in your face": a locked control that says what it would do, a
one-line strip under a panel, a rail card, a disclosure on a result. It is
also promoted on a public sales page (Part 27), where Beacon Link and the
ability to send trades or post to league chat MAY appear, but never as the
headline claim. And at no point, on any surface, does copy describe how an
action is carried out on Sleeper; that is proprietary. Part 25 is the whole
system, including the test that enforces the last sentence.

With every decision recorded, Phase 0 can start. Phase 3 (PayPal) is
unblocked. Nothing in this plan waits on a further answer; the remaining
open items in Part 34 are choices of numbers (prices, thresholds) the owner
can make in the panel after the build.

---

## Part 13. What we are building, in one paragraph

A reader can join BEACON PLUS from `/plus`, a sales page that shows what each
tier does, compares them in one table, and sells with outcomes rather than
mechanisms. The admin defines the TIERS (Free and Plus at launch, more if
wanted), sets a monthly and a yearly price on each, and ticks the FEATURES each
tier includes from a catalog: every tool on the site, every League Pulse
section, every quota, email notifications as one switch, and Beacon Link
itself plus each individual action it can take on Sleeper (set a lineup, place
a bid, propose a trade, accept a trade, post to chat, and so on, one checkbox
each). Payment happens on Stripe's hosted Checkout page, or PayPal's, never on
ours; a member manages their card, switches tier or cancels on the provider's
hosted page or on ours where the provider has none. Inside every tool, at the
place a paid capability would be used, a reader who does not have it sees a
quiet, well-made Beacon+ promotion for exactly that capability, and never more
than one per screen. A member gets email notifications about their own leagues
(a matchup won or lost and why, a trade offer waiting, a waiver day coming
with pickups chosen for their roster, a projected finish that moved, a hole in
Sunday's lineup), under one master switch on their notifications page and one
unsubscribe link in every message. After joining, a welcome tour shows what
the new tier can do and what the next one adds. The owner can hand any tier
to anyone for any length of time without a payment, mint redeemable codes for
free trials, and set trial days per tier. Separately, the admin can list
ONE-TIME SERVICES (a roster review, a trade review, a draft debrief) at a
fixed price; a reader buys one on the same hosted Checkout, fills in an intake
form, and gets the finished review on a private page plus an email when it is
ready. All sales are final, cancellation runs to the end of the paid period,
and the published refund policy says so in plain legal English. Nothing that
is free today becomes paid on launch day: the migration seeds a Free tier that
includes every existing feature, and a Plus tier that already holds every
Beacon Link feature and notifications, so the day Beacon Link ships it is
already priced.

---

## Part 14. The entitlement model

This is the part every other part depends on. Three nouns, one function.

### 14.1 Features

A FEATURE is one thing the site can do that an admin might want to put behind
a tier. The list of features that EXIST is code, because code is what checks
them: `lib/billing/feature-registry.ts` (new) exports `FEATURES`, a readonly
array of

```ts
type FeatureDefinition = {
  key: string;                    // "beacon_link.action.set_lineup"
  name: string;                   // "Set a lineup on Sleeper"
  description: string;            // one sentence, shown in the admin and on the pricing page
  area: FeatureArea;              // "beacon_link" | "league_pulse" | "tools" | "beam" | "manager_pulse" | "games"
  kind: "access" | "action" | "quota";
  // quota only: the window the limit counts over
  window?: "hour" | "day" | "month";
  // what a reader without it sees. "locked" renders the control with the
  // Beacon+ promotion for this feature (Part 25); "hidden" renders nothing.
  // Every key is "locked" at launch, Beacon Link included (Part 12.7).
  visibility: "locked" | "hidden";
  // whether the Beacon Plus pages may list it. True for every key at launch.
  // The one reason to set it false is a feature that exists only as an
  // internal quota (a rate ceiling nobody would buy on its own).
  marketable: boolean;
  // THE SALES SENTENCE. One sentence, present tense, names the outcome for the
  // reader and nothing about how it happens. Shown on the locked control, in
  // the promotion strip, on the pricing card and in the comparison table, so
  // the four cannot disagree. Overridable per key in the admin panel
  // (billing_features.pitch); this is the code default. Part 25.5's denylist
  // test runs over every pitch, default and override.
  pitch: string;
  // Whether this key may be a headline on /plus. Up to
  // settings.pricing.headlineMax keys (default 4, admin-editable), and none
  // of them a Beacon Link key (Part 12.7: Beacon Link is included, listed,
  // and never the headline). The test enforces the Beacon Link rule; the
  // panel enforces the count.
  headline: boolean;
};
```

Key naming: `area.subject` or `area.subject.verb`, lowercase, dots between
segments, underscores within one. The area is the first segment so the admin
panel can group by it. Keys are permanent: renaming one is a migration that
rewrites `membership_tier_features`, never a search and replace.

The three kinds:

- ACCESS: a boolean. You can open the thing or you cannot. Most tools.
- ACTION: a boolean checked by the Beacon Link envelope before it writes to
  Sleeper. One per `SleeperActionKind`, key `beacon_link.action.<kind>`, and
  `lib/billing/feature-registry.test.ts` fails if a kind exists without a key
  or a key without a kind.
- QUOTA: an integer per window, or null for unlimited. The tier assignment
  carries the number. The gate claims from the existing durable limiter
  (`claimRateLimitSlot`, bucket `feature:<key>`) with the tier's number as
  `max`, so a quota is enforced by the same RPC every other limit uses and
  fails closed the same way.

The catalog at launch, seeded by migration 0287 and ALL assigned to the Free
tier so that day one changes nothing for anybody:

| Key | Kind | Name |
| --- | --- | --- |
| `league_pulse.deep_view` | access | Open a league in League Pulse |
| `league_pulse.power_pulse` | access | Power Pulse |
| `league_pulse.positional_war` | access | Positional WAR |
| `league_pulse.decisions` | access | The Manager Ledger |
| `league_pulse.lineups` | access | Lineups |
| `league_pulse.lineups.what_if` | access | The bench what-if on Lineups |
| `league_pulse.schedules` | access | Schedules and the matchup view |
| `league_pulse.trade_ideas` | access | Trade Ideas, suggested mode |
| `league_pulse.trade_builder` | access | Trade Ideas, build mode |
| `league_pulse.transactions` | access | The transaction feed |
| `manager_pulse.report` | access | A Manager Pulse report |
| `manager_pulse.leagues_per_hour` | quota (hour) | League-seasons a reader may queue per hour |
| `tools.faab` | access | The FAAB calculator |
| `tools.signal_check` | access | Signal Check |
| `tools.on_the_clock` | access | On The Clock |
| `tools.beacon_breakdown` | access | Beacon Breakdown |
| `beam.ask` | access | Ask BEAM |
| `games.would_you_rather` | access | Would You Rather, signed in |

The PAID catalog, seeded by the same migration and assigned to the `plus`
tier (Part 12.6). Beacon Link keys do nothing until Beacon Link ships and its
kill switch is on, and notifications do nothing until Part 26's dispatcher is
deployed; assigning them now means the day each ships it is already priced.

| Key | Kind | Name |
| --- | --- | --- |
| `notifications.email` | access | Email notifications about your leagues (Part 26) |

`notifications.email` is deliberately ONE key. The owner's decision is one
toggle per tier: a tier either includes email notifications or it does not, and
which kinds a member receives is the member's choice on their notifications
page (Part 26.4), not the tier's. Adding a second notification key later (a
premium-only kind, say) is a registry entry like any other.

The Beacon Link catalog, seeded by the same migration and also assigned to
`plus`:

| Key | Kind | Name |
| --- | --- | --- |
| `beacon_link.access` | access | Link a Sleeper account (Part 5) |
| `beacon_link.trades_inbox` | access | The pending-trades inbox (Part 4.1) |
| `beacon_link.action.set_lineup` | action | Apply a lineup |
| `beacon_link.action.swap_starter` | action | Make one bench-to-starter change |
| `beacon_link.action.submit_waiver` | action | Place a waiver bid |
| `beacon_link.action.cancel_waiver` | action | Cancel a waiver bid |
| `beacon_link.action.add_drop_free_agent` | action | Add or drop a free agent |
| `beacon_link.action.propose_trade` | action | Propose a trade |
| `beacon_link.action.respond_trade` | action | Accept, reject or cancel a trade |
| `beacon_link.action.trade_block` | action | Set or clear the trade block |
| `beacon_link.action.post_message` | action | Post to league chat |
| `beacon_link.action.create_poll` | action | Start a league poll |
| `beacon_link.action.react` | action | React to a message |
| `beacon_link.action.draft_pick` | action | Make a draft pick (Phase 5, reserved) |

A feature that is in the registry and assigned to no tier is granted to
nobody. That is the safe default and it is why the registry can grow without
a migration: add the definition, deploy, assign in the panel. The seed assigns
the paid catalog to `plus` because the owner decided where it goes (Part 12.6);
a key added AFTER the seed follows the safe default until the owner assigns it.

ABSOLUTE RULE: `manager_pulse.leagues_per_hour` illustrates how a quota and an
existing setting coexist. The tier's number, when the reader's tier carries
one, REPLACES `manager_pulse_settings.sync.capture.leaguesPerUserPerHour` for
that reader; when the tier carries no row for the key, the setting applies
unchanged. `resolveEntitlements` exposes `limits`, and the enqueue path reads
`limits.get(key) ?? settings.value`. The setting is not deleted, because it is
also the number the worker uses for a reader with no account.

### 14.2 Tiers

A TIER is an admin-defined row in `membership_tiers` (Part 15.3): a slug, a
name, a description, a display order, an active flag, a public flag (listed
on the pricing page or not), and exactly one tier marked `is_default`, which
is the Free tier every reader who has paid nothing belongs to, guests
included. Each tier has zero or more PRICES (`membership_tier_prices`, one per
provider per interval) and zero or more FEATURES (`membership_tier_features`,
one row per key, carrying `limit_value` for quotas).

TIERS ARE ENTIRELY THE ADMIN'S. The seed's `free` and `plus` rows are
starting points, not a design: every non-default tier can be renamed,
re-described, re-badged, re-priced, given or stripped of any feature, hidden,
deactivated, or deleted, and new tiers created, all from the panel. Deleting
a tier that any membership row (paid, comp, or a league-plan seat) points at
is refused with the count and the offer to archive instead; ARCHIVING sets
`is_active = false` and `archived_at`, hides it everywhere, keeps existing
members on it until their own end date, and the panel lists archived tiers
in their own section with "Move members to..." which runs the price
migration script's logic for comps and points paid members at the portal.
The one thing that is fixed is that exactly one default tier exists; its
slug is `free` and it holds whatever the admin puts in it. Nothing in this
plan assumes what any tier contains beyond the seed's day-one contents.

Tiers are not ordered by generosity and there is no inheritance: a third tier
does not "include Plus". Every tier lists its own features, so the admin can
build a tier that has more of one thing and less of another. The panel offers
"copy features from another tier" as a starting point (Part 19.6), which is a
one-time copy, not a link.

Each tier also carries `trial_days` (null means "use
`billing_settings.trialDays`", 0 means no trial for this tier whatever the
global says) and `trial_requires_card` (Part 28.2), so a promotional tier can
offer a longer or card-free trial without changing the global setting.

A tier with no active price on any enabled provider is NOT listed on `/plus`
even when `is_public`, and its features render as `hidden` rather than
`locked` in the promotions, because a promotion pointing at a tier that cannot
be bought is a broken promise. The seed creates `plus` public and active with
no prices; it appears on the pricing page the moment the owner sets one.
`/admin/billing/tiers` says this beside any priceless public tier.

ABSOLUTE RULE: the default tier is never deleted, never deactivated, and its
slug (`free`) is a constant. `DEFAULT_TIER_SLUG` in `lib/billing/constants.ts`,
a trigger in migration 0277 that rejects `is_active = false` or `delete` on the
row where `is_default`, and a unique partial index that permits exactly one
default. A site with no default tier has no answer to "what can a guest do",
and that must never be a runtime question.

### 14.3 Grants

A GRANT (`feature_grants`, Part 15.8) gives ONE feature to ONE user for a
window, outside any tier. Sources: a one-time product that grants access
(`purchase`), an admin comp (`admin`), a promotion (`promo`). A grant stacks on
top of the tier; it never removes anything. This is how "a week of Beacon
Link" can be a product, and how the owner hands a friend a feature without
inventing a tier for them.

A COMP MEMBERSHIP is different from a grant: it is a `memberships` row with
`provider = 'comp'`, no provider ids, an `expires_at`, a tier, and a `source`
saying how it came to exist: `admin` (the owner handed it over in the panel),
`code` (the reader redeemed a code the owner minted, Part 28.3) or `trial` (a
card-free trial the owner enabled on a tier, Part 28.2). It gives a whole
tier. Both exist because "give this person Plus for a year" and "give this
person Beacon Link for a week" are different sentences. Part 28 is the whole
of how comps, trials and codes work; this section only fixes the shapes.

### 14.4 The resolver

`lib/billing/entitlements.ts` (new), server-only:

```ts
export type Entitlements = {
  userId: string | null;
  tier: { slug: string; name: string; isDefault: boolean };
  features: ReadonlySet<string>;
  /** quota features only. null means unlimited. Absent means "not granted at all". */
  limits: ReadonlyMap<string, number | null>;
  membership: {
    status: MembershipStatus;
    provider: "stripe" | "paypal" | "comp";
    currentPeriodEnd: string | null;   // ISO
    cancelAtPeriodEnd: boolean;
    inGrace: boolean;                  // past_due but inside the grace window
  } | null;
  grantCount: number;
};

export const resolveEntitlements: (userId: string | null) => Promise<Entitlements>;
export function hasFeature(ent: Entitlements, key: FeatureKey): boolean;
export function featureLimit(ent: Entitlements, key: FeatureKey): number | null | undefined;
export async function requireFeature(key: FeatureKey, nextPath: string): Promise<Entitlements>;
export async function claimQuota(key: FeatureKey, nextPath: string): Promise<boolean>;
```

How it resolves, in order:

1. `userId` null: the default tier's features, nothing else. One query, cached
   process-wide for 60 seconds because every guest gets the same answer.
2. The reader's newest `memberships` row whose status GRANTS (Part 14.5). If
   none, the default tier.
3. That tier's `membership_tier_features` rows become `features` and `limits`.
4. Every `feature_grants` row for the reader with `starts_at <= now()` and
   (`expires_at is null or expires_at > now()`) is unioned in. A grant's
   `limit_value` on a quota key wins over the tier's if it is larger or null.
5. The result is wrapped in React `cache()` for the request and in
   `unstable_cache` with tag `entitlements:<userId>` and a 60 second
   revalidate, so a page that gates four things resolves once, and a webhook
   or an admin action calls `revalidateTag` to make the change visible at
   once. The 60 seconds bounds staleness if the tag call is missed.
6. FAIL SOFT, and say so. If any query in steps 2 to 4 throws, the resolver
   returns the LAST GOOD answer for that reader from `lib/billing/entitlement-fallback.ts`,
   an in-process map of `userId -> { entitlements, at }` written on every
   successful resolve and honoured for `ENTITLEMENT_FALLBACK_MS` (15
   minutes), with `ent.degraded = true`. With no last good answer (a cold
   process), a SIGNED-IN reader gets the default tier plus `degraded`, and a
   guest gets the process-wide default-tier cache. A degraded answer is never
   written to `unstable_cache`, so the next successful resolve replaces it at
   once. Surfaces render normally on a degraded answer; a locked control adds
   the sentence "We could not confirm your membership just now" instead of
   the price phrase, and no promotion strip or card renders, because telling a
   paying member to upgrade during a database blip is the one outcome this
   step exists to prevent. `resolveEntitlements` logs one warn line per
   degraded answer with the reader id hashed. Part 31.10.

`requireFeature` calls `resolveEntitlements`, and on denial `redirect()`s to
`/plus?feature=<key>&next=<nextPath>` (a signed-in reader) or
`/login?next=<nextPath>` (a guest, since the default tier is the same either
way and the pricing page needs an account to sell to). It never throws to a
component; a denial is a navigation.

`claimQuota` resolves, reads the limit, and: absent means denied (the feature
is not granted at all); null means allowed without a claim; a number means
`claimRateLimitSlot({ bucket: "feature:" + key, max: limit, windowSeconds })`
with the registry window, so it fails closed like every other limit.

### 14.5 Which membership statuses grant

`MembershipStatus` is our own enum, mapped from each provider's (Part 16):
`trialing | active | past_due | canceled | unpaid | incomplete | paused`.

Grants access: `trialing`, `active`, and `past_due` while
`now() < current_period_end + settings.gracePeriodDays` (default 7). A card
that fails on renewal is Stripe's Smart Retries' problem for a week before it
is the member's; cutting them off on day one of a failed retry punishes a bank
hiccup.

Does not grant: `canceled` once `current_period_end` has passed (until then it
grants, because cancel-at-period-end is the default cancellation and the
member paid for that period), `unpaid`, `incomplete`, `paused`.

### 14.6 Where the gate goes, and the rules

ABSOLUTE RULE: ENTITLEMENT IS DECIDED ON THE SERVER, EVERY TIME, AT THE POINT
OF USE. A page gates in its server component with `requireFeature`. A server
action or route handler gates itself again before it does work, never
trusting that the page did. A client component receives at most a boolean
telling it how to render, and that boolean buys nothing: the action behind the
button re-checks. `lib/billing/gate-guard.test.ts` scans every file under
`app/**/actions.ts`, `app/actions/`, and `app/api/**/route.ts` that imports a
gated module and fails if it does not call `requireFeature` or `claimQuota`
(allow-list entries carry a reason, the debt-ledger pattern).

ABSOLUTE RULE: the Beacon Link envelope (Part 6.1) gains step 2a, between the
ownership assertion and the rate-limit claim:

```
2a. Resolves entitlements for userId and asserts hasFeature for
    "beacon_link.action." + kind. A denial returns { ok: false, reason:
    "not_entitled", feature } and writes a "rejected" log row with detail
    "not_entitled", BEFORE any rate-limit slot is claimed, so an unentitled
    click costs no budget and leaves a trace.
```

And Part 5.2's `startSleeperLink` asserts `beacon_link.access` before it
touches Sleeper's auth, for the same reason. The Trades inbox read (Part 4.1)
asserts `beacon_link.trades_inbox`. `resolveCockpitContext` (Part 4.0) gains a
fifth fact, `entitled: ReadonlySet<string>`, the Beacon Link subset of the
reader's features, so a surface can render an action button locked (Part
14.7) without a second resolve.

ABSOLUTE RULE: gating never hides DATA a reader already has. A feature key
gates a TOOL, a SECTION or an ACTION, never a column in a table the reader can
open, and never a number on a page they can see. The mobile-first rule
forbids hiding data by breakpoint; this forbids hiding it by tier. "Plus
members see the beat rate" is not a feature this system can express, on
purpose. If the owner wants it, that is a plan revision, not a registry entry.

### 14.7 What a reader without a feature sees

`components/billing/feature-gate.tsx` (new), a SERVER component:

```tsx
<FeatureGate feature="league_pulse.trade_builder" fallback="locked">
  {children}
</FeatureGate>
```

Resolves once (cached), renders `children` when granted. Otherwise, by the
registry's `visibility` (a `fallback` prop overrides it per call site):

- `locked`: renders `components/billing/plus-promo.tsx` in its `panel`
  variant (Part 25.2), which carries the feature's pitch, names the cheapest
  public priced tier that includes it ("Included in Beacon Plus, from $4 a
  month"), and links to `/plus?feature=<key>&next=<currentPath>`. It is a
  real region with a heading, not a disabled button with a tooltip, because a
  screen reader cannot read a tooltip on a disabled control. If NO public
  priced tier includes the feature, it renders nothing at all: a prompt that
  cannot be satisfied is a broken promise.
- `hidden`: renders nothing. Used for no key at launch; kept for a feature the
  owner wants to sell quietly or not at all, and for every key while
  `billing_settings.enabled` is false (Part 15.1).

The locked rendering is the promotion system's smallest unit and is specified,
with its copy rules and its frequency rules, in Part 25. This component only
decides WHETHER to render it.

For an ACTION button specifically, `components/beacon-link/action-button.tsx`
gains a `locked` prop set by the server from `ctx.entitled`; locked, it
renders as a button whose accessible name ends "(included in <tier>)", whose
click opens the same house dialog with the upgrade prompt in it instead of
the confirmation, and which never calls the server action. Same component, so
the "only one component fires a write" rule (Part 6.2) still holds.

---

## Part 15. Storage

Twenty-seven migrations, one table or one concern each, in dependency order (0296 to 0301 are specified in Part 31).
Every one carries its access matrix in the header comment, its policies in
the same file, and its rollback line. `npm run db:types` after each.

Column naming follows the Data Architecture rules: no provider name in a data
column (`provider` is a discriminator column and provider ids are operational
identifiers, both allowed); `metadata` for the stored projection.

### 15.1 Migration 0275: `billing_settings`

The single-row jsonb settings pattern (`would_you_rather_settings`), id
`'global'`, service-role only, admin-edited at `/admin/billing/settings`,
validated by `lib/billing/settings.ts` (zod, every field defaulted, a coverage
test asserting every key has a control in the panel). Keys and defaults, in
`lib/billing/default-settings.ts`:

```ts
{
  enabled: false,                 // THE KILL SWITCH. False hides every selling surface at once.
  providers: {
    stripe: { enabled: true },
    paypal: { enabled: true, venmo: true, subscriptions: true },
    // paypal.enabled: PayPal and Venmo on or off together (Part 12.2).
    // paypal.venmo: show the Venmo wording and funding option inside PayPal.
    // paypal.subscriptions: whether PayPal may sell a RECURRING tier, or
    // one-time services only (Part 16.4, Part 29.4).
  },
  trialDays: 0,                   // global default; a tier's trial_days overrides (Part 28.2)
  trialRequiresCard: true,        // false = payment_method_collection=if_required (Part 28.2)
  gracePeriodDays: 7,             // past_due keeps access this long past period end
  renewalReminderDays: 30,        // yearly plans only; 0 disables
  compEndingReminderDays: 3,      // email a comp or trial member this many days before it ends; 0 disables
  disputeRevokesImmediately: true,
  purchases: {
    enabled: true,
    refundableUntil: "never",         // "in_progress" | "delivered" | "never". Part 12.4: never.
    intakeReminderDays: 3,            // email a buyer who has not filled in the intake
  },
  tax: {                          // Part 29. A block with a mode, not a boolean.
    mode: "stripe_tax",           // "stripe_tax" | "manual" | "none"
    behavior: "exclusive",        // "exclusive" | "inclusive": whether the listed price includes tax
    manual: { stripeTaxRateIds: [] },   // manual mode only: Stripe Tax Rate objects to apply
    paypalNote: true,             // show "tax is not collected through PayPal" when mode is not "none"
  },
  codes: {                        // Part 28.3
    enabled: true,
    redeemRateLimitPerHour: 5,    // attempts per actor per hour on /plus/redeem
  },
  promotion: {                    // Part 25
    enabled: true,                // false hides every in-tool promotion, leaving locked controls as plain disabled text
    dismissDays: 30,              // how long a dismissed strip or card stays dismissed
    maxPerPage: 1,                // never more than this many promotions visible on one screen
    placements: {},               // placement id -> false to switch one placement off (Part 25.4)
  },
  pricing: {
    headline: "Everything free stays free.",
    subhead: "Beacon Plus adds what you cannot get anywhere else: your leagues, acted on.",
    showAnnualSavings: true,
  },
}
```

`enabled` gates SELLING, not entitlement. When it is false: the pricing page
returns 404, the header shows no upgrade control, `FeatureGate` renders
`hidden` for everything (because there is nothing to upgrade to), the
checkout routes return 503, and the webhooks STILL PROCESS (a member who paid
before the switch flipped is still a member). That last clause is what makes
the switch safe to flip off in an emergency.

### 15.2 Migration 0276: `billing_features`

```sql
create table if not exists public.billing_features (
  key text primary key,                               -- "beacon_link.action.set_lineup"
  name text not null,
  description text not null default '',
  area text not null,
  kind text not null check (kind in ('access', 'action', 'quota')),
  quota_window text check (quota_window in ('hour', 'day', 'month')),
  visibility text not null default 'locked' check (visibility in ('locked', 'hidden')),
  marketable boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Access: SELECT public (anon + authenticated): the catalog is what the pricing
-- page lists. Writes: service_role only (the registry sync, Part 15.14).
```

The table MIRRORS the code registry; it exists so the panel can join it and
the pricing page can read names without importing server code. The registry
is the source of truth for existence and kind; the table is the source of
truth for nothing. `syncFeatureCatalog(admin)` (`lib/billing/catalog.ts`)
upserts every registry entry by key and never deletes, and runs on every
render of `/admin/billing/tiers` and from `npm run billing:sync-features`. A
row in the table with no registry entry is shown in the panel as "retired"
and its assignments grant nothing, because the resolver intersects with the
registry.

### 15.3 Migration 0277: `membership_tiers`

```sql
create table if not exists public.membership_tiers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name text not null,
  tagline text not null default '',
  description text not null default '',
  display_order int not null default 0,
  is_active boolean not null default true,
  is_public boolean not null default true,
  is_default boolean not null default false,
  badge text,                                          -- short label on the header pill, e.g. "PLUS"
  trial_days int check (trial_days is null or trial_days between 0 and 365),   -- null = use the global setting
  trial_requires_card boolean,                         -- null = use the global setting (Part 28.2)
  stripe_product_id text,                              -- operational id, allowed by the hybrid rule
  paypal_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists membership_tiers_one_default
  on public.membership_tiers ((true)) where is_default;
-- Trigger membership_tiers_protect_default: raise on delete, and on update
-- setting is_active=false or is_public=false, where old.is_default.
-- Access: SELECT public where is_active (a policy with `using (is_active)`), so
-- the pricing page and the upgrade prompt read it with the publishable key.
-- Admin reads through service_role see inactive tiers too. Writes service_role.
```

### 15.4 Migration 0278: `membership_tier_prices`

```sql
create table if not exists public.membership_tier_prices (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid not null references public.membership_tiers(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'paypal')),
  interval text not null check (interval in ('month', 'year')),
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'usd',
  provider_price_id text not null,                     -- Stripe price_..., PayPal plan P-...
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists membership_tier_prices_active_one
  on public.membership_tier_prices (tier_id, provider, interval) where is_active;
-- Access: SELECT public where is_active. Writes service_role.
```

A price is IMMUTABLE once created, on both providers (a Stripe Price cannot
change its amount; a PayPal Plan's pricing can be updated but the semantics
differ). Changing a tier's price creates a new row and archives the old
(`is_active=false`, `archived_at`), and existing subscribers stay on the old
price until the owner migrates them (Part 17.6). The panel says this out loud
above the price form.

### 15.5 Migration 0279: `membership_tier_features`

```sql
create table if not exists public.membership_tier_features (
  tier_id uuid not null references public.membership_tiers(id) on delete cascade,
  feature_key text not null references public.billing_features(key) on delete cascade,
  limit_value int check (limit_value is null or limit_value >= 0),   -- quota only; null = unlimited
  created_at timestamptz not null default now(),
  primary key (tier_id, feature_key)
);
-- Access: SELECT public (joined with active tiers by the pricing page). Writes service_role.
```

One row is one checkbox in the panel. Adding a feature to a tier is an
insert; removing it is a delete; nothing is ever soft-deleted here, because
the pricing page must reflect exactly what a new member gets today.

### 15.6 Migration 0280: `billing_customers`

```sql
create table if not exists public.billing_customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'paypal')),
  provider_customer_id text not null,                  -- cus_... ; PayPal payer id
  created_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, provider_customer_id)
);
-- Access: service_role only. A browser never needs a customer id.
```

One Stripe Customer per user, created the first time they open Checkout
(`POST /v1/customers` with `email` and `metadata[user_id]`) and reused
forever, so the portal, the invoice history and a second subscription all
attach to one object on Stripe's side. The email is sent to Stripe and NOT
stored here: Stripe is the system of record for it, as with donations.

### 15.7 Migration 0281: `memberships` and the `my_membership` view

```sql
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier_id uuid not null references public.membership_tiers(id),
  provider text not null check (provider in ('stripe', 'paypal', 'comp')),
  provider_subscription_id text,                       -- sub_... ; I-... ; null for comp
  provider_price_id text,
  status text not null check (status in
    ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'paused')),
  interval text check (interval in ('month', 'year')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  trial_end timestamptz,
  expires_at timestamptz,                              -- comp only
  source text check (source in ('admin', 'code', 'trial')),   -- comp only (Part 28); null for a paid row
  code_id uuid,                                        -- comp only, source = 'code': membership_codes.id (FK added in 0289)
  livemode boolean,
  synced_at timestamptz,                               -- last successful fetch from the provider
  granted_by uuid references auth.users(id),           -- comp only: the admin
  note text,                                           -- comp only, server-written, rendered as text
  metadata jsonb,                                      -- allow-listed projection (lib/billing/redact.ts)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index if not exists memberships_user_status_idx
  on public.memberships (user_id, status, current_period_end desc);
-- Access: table service_role only. Authenticated readers use the view:
create or replace view public.my_membership with (security_invoker = true) as
  select m.id, t.slug as tier_slug, t.name as tier_name, m.provider, m.status,
         m.interval, m.current_period_end, m.cancel_at_period_end, m.trial_end,
         m.expires_at, m.created_at
    from public.memberships m join public.membership_tiers t on t.id = m.tier_id
   where m.user_id = (select auth.uid());
-- plus a memberships_select_own policy so security_invoker resolves; no client
-- INSERT/UPDATE/DELETE policy exists, so those are blocked.
```

`metadata` is an allow-listed projection under the Part 15 exception, which
applies here for the same three reasons as `donation_receipts`: the provider
is the system of record with retention duties and a read-back API, the object
can carry personal data (a Stripe Subscription carries the customer id and,
expanded, the customer), and the ids stored here recover the original. The
projection is `redactSubscription` in `lib/billing/redact.ts`, tested against
a payload with every identity field populated.

### 15.8 Migration 0282: `feature_grants` and the `my_feature_grants` view

```sql
create table if not exists public.feature_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null references public.billing_features(key) on delete cascade,
  limit_value int check (limit_value is null or limit_value >= 0),
  source text not null check (source in ('purchase', 'admin', 'promo')),
  source_id uuid,                                      -- purchases.id when source = 'purchase'
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists feature_grants_user_active_idx
  on public.feature_grants (user_id, feature_key) where revoked_at is null;
-- Access: service_role all; authenticated SELECT own via my_feature_grants
-- (feature_key, starts_at, expires_at, source) for the account page.
```

### 15.9 Migration 0283: `billing_products`

The one-time services.

```sql
create table if not exists public.billing_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name text not null,
  tagline text not null default '',
  description text not null default '',                -- plain text, paragraphs by blank line
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'usd',
  fulfilment text not null check (fulfilment in ('manual', 'grant')),
  -- manual: a human delivers something. grant: rows in feature_grants.
  turnaround_days int check (turnaround_days is null or turnaround_days > 0),
  intake_fields jsonb not null default '[]'::jsonb,   -- Part 17.8, validated by zod
  grant_features jsonb not null default '[]'::jsonb,  -- [{ key, days, limit_value }] for grant fulfilment
  stripe_product_id text,
  stripe_price_id text,
  paypal_product_id text,
  is_active boolean not null default true,
  is_public boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Access: SELECT public where is_active. Writes service_role.
```

Changing `amount_cents` on a product creates a new Stripe Price and archives
the old one, exactly as with tiers; the admin action does both.

### 15.10 Migration 0284: `purchases` and the `my_purchases` view

```sql
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.billing_products(id),
  provider text not null check (provider in ('stripe', 'paypal')),
  provider_checkout_id text,                           -- cs_... ; PayPal order id
  provider_payment_id text,                            -- pi_... ; PayPal capture id
  amount_cents int not null,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in
    ('pending', 'paid', 'refunded', 'disputed', 'expired')),
  fulfilment_status text not null default 'awaiting_intake' check (fulfilment_status in
    ('awaiting_intake', 'queued', 'in_progress', 'delivered', 'cancelled')),
  intake jsonb,                                        -- the buyer's answers, validated against the product's intake_fields
  intake_submitted_at timestamptz,
  deliverable text,                                    -- plain text, written by the admin, rendered as text nodes
  delivered_at timestamptz,
  due_at timestamptz,                                  -- intake_submitted_at + turnaround_days
  livemode boolean,
  metadata jsonb,                                      -- allow-listed projection
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_checkout_id)
);
create index if not exists purchases_queue_idx
  on public.purchases (fulfilment_status, due_at) where status = 'paid';
-- Access: service_role all. Authenticated SELECT own via my_purchases (everything
-- above except metadata and provider ids). Authenticated UPDATE of exactly
-- `intake` and `intake_submitted_at` on own rows where status='paid' and
-- fulfilment_status='awaiting_intake', through the submitIntake server action,
-- which validates against the product's schema first. No client INSERT/DELETE.
```

ABSOLUTE RULE: the purchase row is created BEFORE Checkout opens, in `pending`,
and its uuid travels to the provider as `client_reference_id` and in
`metadata[purchase_id]` (mirrored onto `payment_intent_data[metadata]`, per the
donation lesson). The webhook matches on that id and NOTHING ELSE: never on
the email, never on the amount. A `pending` row older than 24 hours with no
payment is marked `expired` by the reconcile cron (Part 18.5).

ABSOLUTE RULE: `deliverable` is plain text. Blank lines separate paragraphs.
It is rendered as text nodes inside `<p>` elements by
`components/billing/plain-paragraphs.tsx`, never through `dangerouslySetInnerHTML`
and never through a markdown renderer, because there is no sanitising renderer
in this codebase today and a review page is not the place to introduce one.
The admin who writes it is trusted; the rule exists so the page cannot become
an HTML injection surface if that ever changes.

### 15.11 Migration 0285: `billing_events` and `try_claim_billing_event`

The webhook ledger, one row per provider event, the idempotency boundary.

```sql
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal')),
  provider_event_id text not null,
  event_type text not null,
  livemode boolean,
  status text not null default 'received' check (status in
    ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,                                     -- server-written vocabulary, never provider text verbatim
  subject_type text,                                   -- 'subscription' | 'purchase' | 'customer' | null
  subject_id text,                                     -- the provider's object id
  metadata jsonb,                                      -- allow-listed projection of the event
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
-- Access: service_role only. The admin ledger page reads it with the service client.
```

`try_claim_billing_event(p_provider, p_event_id, p_stale_seconds default 300,
p_max_attempts default 8)` is `try_claim_donation_receipt` with the same
semantics and the same SECURITY DEFINER posture: true for exactly one caller,
a claim older than the stale window is reclaimable, past the attempt ceiling
the row stops being claimable and is left for the admin ledger.

### 15.12 Migration 0286: `billing_audit_log`

Every admin action on this system, and every automatic change to a member's
access, as a row: `actor_user_id` (null for the system), `action` (a fixed
vocabulary: `tier.create`, `tier.update`, `tier.feature.add`,
`tier.feature.remove`, `price.create`, `price.archive`, `product.*`,
`membership.comp`, `membership.revoke`, `membership.sync`, `grant.create`,
`grant.revoke`, `purchase.refund`, `purchase.deliver`, `settings.save`),
`subject_type`, `subject_id`, `detail` jsonb (server-built), `created_at`.
Service-role only, never pruned, shown at `/admin/billing/audit`. When a member
asks "why did I lose access on Tuesday", this table answers.

### 15.13 Migration 0287: the seed

Data only. Inserts the `free` tier (`is_default`, `is_public`, order 0, name
"Free", tagline "Every tool on the site, no account needed for most of it")
and the `plus` tier (`is_public`, `is_active`, order 1, name "Plus", badge
"PLUS", tagline "Your leagues, acted on", NO prices: the owner sets those in
the panel and the tier appears on `/plus` when the first one exists, Part
14.2). Inserts every registry feature into `billing_features` (the 14.1
tables). Assigns one `membership_tier_features` row per EXISTING-tool key onto
`free`, and one per PAID key (`notifications.email` and every `beacon_link.*`
key) onto `plus`. Idempotent (`on conflict do nothing`), so it can be re-run.

ABSOLUTE RULE: this migration is what makes launch day a no-op for readers,
and what makes Beacon Link priced on the day it ships. `lib/billing/seed.test.ts`
asserts BOTH halves of Part 12.6: every registry key whose area is not
`beacon_link` or `notifications` appears in the seed's free-tier assignments,
and every key in those two areas appears in the plus-tier assignments and in
NO free-tier assignment. A key added to the registry later is in neither list
and is granted to nobody until assigned, which is correct: the seed describes
launch day, not forever.

### 15.14 Migration 0288: reserve the routes

`insert into signal_reserved_handles (handle) values ('plus'), ('services'),
('notifications'), ('refund-policy') on conflict do nothing;` plus the matching
`RESERVED_ROUTE_SEGMENTS` entries, exactly as 0269 did for `/donate`, so
`scripts/check-reserved-routes.ts` keeps passing. `membership` is reserved too,
so nobody can claim the handle the old plan named and the redirect below can
exist: `next.config.ts` gains a permanent 308 from `/membership` to `/plus`,
because the earlier revision of this plan and its artifact both named the old
path and a saved link should not 404.

### 15.15 Migration 0289: `membership_codes` and `membership_code_redemptions`

The redeemable codes of Part 28.3. Two tables in one migration because the
second is meaningless without the first and neither is ever created alone.

```sql
create table if not exists public.membership_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                           -- stored UPPERCASE, compared case-insensitively
  tier_id uuid not null references public.membership_tiers(id),
  days int not null check (days between 1 and 730),    -- length of the comp membership a redemption creates
  max_redemptions int check (max_redemptions is null or max_redemptions >= 1),   -- null = unlimited
  redeemed_count int not null default 0,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,                              -- the code stops working; existing comps are unaffected
  new_members_only boolean not null default true,      -- refuse a reader who has ever held a granting membership
  note text not null default '',                       -- admin-facing, e.g. "Discord launch week"
  created_by uuid references auth.users(id),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.membership_code_redemptions (
  code_id uuid not null references public.membership_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code_id, user_id)                       -- one redemption per person per code, enforced by the database
);
alter table public.memberships
  add constraint memberships_code_id_fkey foreign key (code_id) references public.membership_codes(id);
-- Access: both tables service_role only. A reader never lists codes; they type
-- one into /plus/redeem and the redeem_membership_code RPC answers.
```

`redeem_membership_code(p_code text)` is a SECURITY DEFINER function, granted to
`authenticated` only (and revoked from `public` and `anon` by name, per the
grants rule): it uppercases and trims the input, locks the code row `for
update`, checks `disabled_at is null`, `starts_at <= now()`, `expires_at is null
or > now()`, `redeemed_count < max_redemptions` (when set), that the caller has
no redemption of this code (the primary key), and, when `new_members_only`,
that the caller has never had a `memberships` row in a granting status. It then
inserts the comp membership (`provider = 'comp'`, `source = 'code'`,
`expires_at = now() + days`, `status = 'active'`), the redemption row,
increments `redeemed_count`, and returns `{ ok, tier_slug, expires_at }` or
`{ ok: false, reason }` with a fixed vocabulary (`not_found`, `expired`,
`exhausted`, `already_redeemed`, `not_new`, `disabled`). One transaction, one
row lock, so two tabs redeeming the last use of a code cannot both succeed.

### 15.16 Migration 0290: `notification_preferences`

Part 26.4. One row per reader who has ever touched the notifications page or
received a notification; absent means the defaults.

```sql
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,          -- THE MASTER SWITCH
  kinds jsonb not null default '{}'::jsonb,            -- { [kind]: boolean }, absent = the kind's default (Part 26.2)
  muted_league_ids uuid[] not null default '{}',       -- leagues.id values the reader does not want mail about
  quiet_hours boolean not null default true,           -- hold non-urgent mail between 11pm and 7am Eastern
  unsubscribe_token_hash text not null unique,          -- sha256 of the token; the token itself is minted server-side and lives only in the email (Part 31.11)
  time_zone text not null default 'America/New_York',    -- IANA zone the reader picked (Part 31.7); windows and quiet hours resolve in it
  channels jsonb not null default '{"email": true}'::jsonb,   -- { email: bool, discord: bool } (Part 31.2)
  calendar_token_hash text unique,                       -- sha256 of the calendar feed token (Part 31.13); null until they ask for a feed
  updated_at timestamptz not null default now()
);
-- Access: SELECT / INSERT / UPDATE own row (auth.uid() = user_id), no DELETE
-- (the account-deletion cascade removes it), no anon access. The one-click
-- unsubscribe route (Part 26.6) runs as service_role and matches on
-- unsubscribe_token alone, which is why the token is 192 random bits and
-- unique.
```

### 15.17 Migration 0291: `notification_events`

Part 26.3. The queue of things that happened that MIGHT become an email.
Producers insert; the dispatcher claims and resolves.

```sql
create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                                  -- Part 26.2 vocabulary, checked by the dispatcher against the registry
  league_id uuid references public.leagues(id) on delete cascade,
  roster_id text,                                      -- the roster the event is about, when it is about one
  user_id uuid references auth.users(id) on delete cascade,   -- set when the producer already knows the reader; else resolved by the dispatcher
  dedupe_key text not null,                            -- Part 26.3: one email per (user, kind, dedupe_key)
  payload jsonb not null default '{}'::jsonb,          -- server-built figures the email needs; never provider text verbatim
  occurred_at timestamptz not null default now(),
  not_before timestamptz not null default now(),       -- quiet hours and scheduled kinds push this forward
  status text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'skipped', 'failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  resolved_at timestamptz,
  skip_reason text,                                    -- fixed vocabulary: not_entitled, master_off, kind_off, league_muted, daily_cap, duplicate, no_address, stale
  created_at timestamptz not null default now()
);
create index if not exists notification_events_dispatch_idx
  on public.notification_events (status, not_before) where status in ('pending', 'claimed');
create unique index if not exists notification_events_dedupe_idx
  on public.notification_events (kind, dedupe_key, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- Access: service_role only.
```

`try_claim_notification_events(p_limit int, p_stale_seconds int default 300)`
claims up to `p_limit` rows whose `status = 'pending'` (or `claimed` with a
stale claim) and `not_before <= now()`, oldest first, `for update skip locked`,
sets `claimed`, `claimed_at`, increments `attempts`, and returns them. Same
posture as `claim_league_sync_jobs`.

### 15.18 Migration 0292: `notification_deliveries`

The ledger of what was actually SENT, and the idempotency boundary the daily
cap and the dedupe rule are enforced against.

```sql
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.notification_events(id) on delete set null,
  kind text not null,
  dedupe_key text not null,
  league_id uuid references public.leagues(id) on delete set null,
  subject text not null,                               -- what the reader saw in their inbox, for the admin ledger and the reader's history
  provider_message_id text,                            -- Resend's id, operational
  sent_at timestamptz not null default now(),
  unique (user_id, kind, dedupe_key)                   -- THE GUARANTEE: one email per reader per thing
);
create index if not exists notification_deliveries_user_day_idx
  on public.notification_deliveries (user_id, sent_at desc);
-- Access: service_role all; authenticated SELECT own via the my_notification_history
-- view (kind, subject, sent_at, league_id), which the notifications page lists
-- so a reader can see what we sent and when.
```

The dispatcher INSERTS the delivery row BEFORE calling Resend (the donation
receipt pattern): a unique violation means another pass already sent it and
this one stops; a Resend failure after the insert marks the event `failed` and
deletes the delivery row inside the same transaction so the retry can claim
it. Never the other order.

### 15.19 Migration 0293: `notification_settings`

The single-row jsonb pattern again, `id = 'global'`, service-role only, edited
at `/admin/notifications`, validated by `lib/notifications/settings.ts`, keys
and defaults in Part 26.7.

### 15.20 Migration 0294: `billing_features` copy columns

`alter table public.billing_features add column pitch text, add column
headline boolean not null default false, add column story text;` The registry
default fills `pitch` and `headline` on sync when the column is null; an admin
edit in `/admin/billing/features` writes them and the sync then leaves them
alone (the same "code default, panel override" rule as `visibility`). `story`
is the two- or three-sentence paragraph the tour pages (Part 27) show under
the pitch, admin-written, plain text rendered as text nodes, and every value
in all three columns passes the Part 25.5 denylist on save. This is its own
migration rather than an edit to 0276 because 0276 mirrors the registry's
shape and this mirrors the panel's; keeping them apart keeps the "table is
the source of truth for nothing" sentence in 15.2 true for the registry
columns and false, deliberately, for these three.

---

## Part 16. Providers

### 16.1 The interface

`lib/billing/providers/types.ts` (new):

```ts
export type ProviderSlug = "stripe" | "paypal";

export type NormalizedSubscription = {
  provider: ProviderSlug;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  providerPriceId: string | null;
  status: MembershipStatus;
  interval: "month" | "year" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  trialEnd: string | null;
  livemode: boolean | null;
  /** Our own metadata, echoed back: user_id and tier_slug. */
  metadata: { userId: string | null; tierSlug: string | null };
  raw: unknown;                                          // handed to redact, never stored as is
};

export type NormalizedOrder = {
  provider: ProviderSlug;
  providerCheckoutId: string;
  providerPaymentId: string | null;
  status: "pending" | "paid" | "refunded" | "disputed" | "expired";
  amountCents: number | null;
  currency: string | null;
  livemode: boolean | null;
  metadata: { purchaseId: string | null; userId: string | null };
  raw: unknown;
};

export type NormalizedEvent = {
  provider: ProviderSlug;
  eventId: string;
  type: string;                                          // the provider's own type string
  livemode: boolean | null;
  subject:
    | { kind: "subscription"; id: string }
    | { kind: "order"; id: string }
    | { kind: "refund"; paymentId: string; amountCents: number | null }
    | { kind: "dispute"; paymentId: string; status: string }
    | { kind: "upcoming_renewal"; subscriptionId: string; dueAt: string }
    | { kind: "ignored" };
  raw: unknown;
};

export interface BillingProvider {
  slug: ProviderSlug;
  configured(): boolean;
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<ProviderResult<{ url: string; providerRef: string }>>;
  createPurchaseCheckout(input: PurchaseCheckoutInput): Promise<ProviderResult<{ url: string; providerRef: string }>>;
  /** Stripe only today. Null means "this provider has no hosted portal; render our own controls". */
  createManageSession(input: { providerCustomerId: string; returnUrl: string; flow?: PortalFlow }): Promise<ProviderResult<{ url: string }> | null>;
  cancelSubscription(input: { providerSubscriptionId: string; atPeriodEnd: boolean }): Promise<ProviderResult<void>>;
  fetchSubscription(providerSubscriptionId: string): Promise<ProviderResult<NormalizedSubscription>>;
  fetchOrder(providerCheckoutId: string): Promise<ProviderResult<NormalizedOrder>>;
  refundPayment(input: { providerPaymentId: string; amountCents?: number }): Promise<ProviderResult<void>>;
  /** Verifies and normalises ONE webhook request. Fails closed on any doubt. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<ProviderResult<NormalizedEvent>>;
  /** Admin-side catalog mirroring. */
  ensureTierProduct(tier: TierRow): Promise<ProviderResult<{ providerProductId: string }>>;
  createRecurringPrice(input: { providerProductId: string; amountCents: number; currency: string; interval: "month" | "year" }): Promise<ProviderResult<{ providerPriceId: string }>>;
  archivePrice(providerPriceId: string): Promise<ProviderResult<void>>;
  ensureProduct(product: ProductRow): Promise<ProviderResult<{ providerProductId: string; providerPriceId: string }>>;
}
```

`ProviderResult<T>` is the `StripeResult<T>` shape from `lib/donate/stripe.ts`:
`{ ok: true; data } | { ok: false; reason: "unconfigured" } | { ok: false; reason: "error"; detail }`.
No provider function throws.

`lib/billing/providers/index.ts` exports `getProvider(slug)` and
`enabledProviders(settings)`: a provider is offered only when it is BOTH
configured (its env vars are present and shaped correctly) AND enabled in
settings. The pricing page reads `enabledProviders` to decide which payment
buttons to draw.

### 16.2 Stripe

`lib/billing/providers/stripe.ts` (new) is built on `lib/stripe/client.ts`
(new), which is `stripeRequest`, `encodeForm`, `secretKey` and `versionHeader`
LIFTED out of `lib/donate/stripe.ts` unchanged. `lib/donate/stripe.ts` then
imports them (MB-T004), so there is exactly one Stripe HTTP client, one key
shape check, and one log prefix convention. The donation tests keep passing
because the exported functions of `lib/donate/stripe.ts` do not change.

No SDK, REST over fetch, form-encoded bodies, ten-second timeout, an
`Idempotency-Key` on every POST, no pinned API version (the account default,
per the donation decision), and the four consequences of that last choice
handled explicitly:

- `current_period_start` / `current_period_end` are read from the Subscription
  and, when absent, from `items.data[0]`, because the 2025-03-31 API version
  moved them onto the item. The normaliser handles both shapes and
  `lib/billing/providers/stripe.test.ts` feeds it both.
- The subscription id on an Invoice is read from `invoice.subscription` and,
  when absent, from `invoice.parent.subscription_details.subscription`, for
  the same reason.
- `payment_intent` and `customer` may arrive as a string or an expanded
  object; the id is taken either way (the donation route's `paymentIntentId`
  helper, generalised).
- Anything unrecognised in a status string maps to `incomplete` and is logged,
  never to `active`.

Calls, with the exact parameters:

Customer (first Checkout for a user):
```
POST /v1/customers
  email=<from the auth session, never the body>
  metadata[user_id]=<uuid>
```

Subscription Checkout:
```
POST /v1/checkout/sessions
  mode=subscription
  customer=<cus_>
  client_reference_id=<user uuid>
  line_items[0][price]=<price_>          line_items[0][quantity]=1
  subscription_data[metadata][user_id]=<uuid>
  subscription_data[metadata][tier_slug]=<slug>
  subscription_data[trial_period_days]=<effectiveTrialDays(tier, settings), omitted when 0>   (Part 28.2)
  payment_method_collection=if_required               (ONLY when the effective trial does not require a card, Part 28.2)
  allow_promotion_codes=true
  consent_collection[terms_of_service]=required        (Terms URL set in Dashboard, Part 23)
  custom_text[submit][message]=<the renewal sentence, Part 23.3>
  success_url=<SITE_ORIGIN>/plus/welcome?checkout=success&session_id={CHECKOUT_SESSION_ID}
  cancel_url=<SITE_ORIGIN><safeReturnPath>
  ...taxParamsForCheckout(settings.tax)               (Part 29.2: automatic_tax, customer_update[address],
                                                        or subscription_data[default_tax_rates][], or nothing)
  metadata[user_id]=<uuid>   metadata[tier_slug]=<slug>   metadata[product]=ffbeacon_membership
Idempotency-Key: sub-checkout:<user>:<price>:<floor(now / 60s)>
```
No `payment_method_types`, for the donation reason: automatic payment methods
means card, Apple Pay, Google Pay, Link, Cash App Pay and whatever else the
Dashboard has on, without a deploy. The idempotency key makes a double click
return the SAME session for a minute rather than two.

One-time purchase Checkout:
```
POST /v1/checkout/sessions
  mode=payment
  customer=<cus_>
  client_reference_id=<purchase uuid>
  line_items[0][price]=<price_>   line_items[0][quantity]=1
  payment_intent_data[metadata][purchase_id]=<uuid>    (mirrored, per the donation lesson)
  payment_intent_data[metadata][user_id]=<uuid>
  metadata[purchase_id]=<uuid>   metadata[user_id]=<uuid>   metadata[product]=ffbeacon_service
  success_url=<SITE_ORIGIN>/my-beacon/purchases/<uuid>?checkout=success&session_id={CHECKOUT_SESSION_ID}
  cancel_url=<SITE_ORIGIN>/services/<slug>
  ...taxParamsForCheckout(settings.tax)               (Part 29.2; the one-time shape uses line_items[0][tax_rates][] in manual mode)
Idempotency-Key: purchase-checkout:<purchase uuid>
```

Portal:
```
POST /v1/billing_portal/sessions
  customer=<cus_>
  return_url=<SITE_ORIGIN>/my-beacon/membership
  flow_data[type]=subscription_cancel | subscription_update | payment_method_update   (optional)
  flow_data[subscription_cancel][subscription]=<sub_>                                 (with cancel)
  flow_data[subscription_update][subscription]=<sub_>                                 (with update)
```
The portal CONFIGURATION is a Dashboard object, set once and recorded in
`docs/billing/billing.md` (MB-T060): cancel at period end on, payment method
update on, invoice history on, subscription update on with the tier products
listed and proration enabled, and the business name and Terms and Privacy URLs
filled in.

Read-backs: `GET /v1/subscriptions/{id}`, `GET /v1/checkout/sessions/{id}`,
`GET /v1/invoices/{id}`. Cancel: `POST /v1/subscriptions/{id}` with
`cancel_at_period_end=true`, or `DELETE /v1/subscriptions/{id}` for
immediate (admin only). Refund: `POST /v1/refunds` with `payment_intent`.
Catalog: `POST /v1/products` (`name`, `metadata[tier_slug]` or
`metadata[product_slug]`), `POST /v1/prices` (`product`, `unit_amount`,
`currency`, `recurring[interval]` for tiers), `POST /v1/prices/{id}` with
`active=false` to archive.

Env: `STRIPE_SECRET_KEY` (exists), `STRIPE_BILLING_WEBHOOK_SECRET` (new: a
second endpoint, Part 18.1, has its own signing secret). Note for the owner:
`STRIPE_WEBHOOK_SECRET`, which the donation webhook reads, is not present in
the local `.env.local` today; both secrets must be in the deploy environment,
and local webhook testing uses the Stripe CLI's `listen --forward-to`.
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` exists and is used by nothing in this
plan, because hosted Checkout needs no client key; it stays for the day an
embedded element is wanted.

### 16.3 PayPal, and Venmo

Verified 2026-09-07 against Stripe's and PayPal's documentation:

- Stripe's native PayPal payment method is available only to Stripe accounts
  in the EEA, the UK, Switzerland, Liechtenstein and Norway. A US Stripe
  account cannot turn it on. Stripe has since added a "PayPal custom payment
  method" that lets a Checkout page show PayPal processed by the merchant's
  OWN PayPal account; its support for recurring billing was not confirmed.
- Venmo is offered by PayPal's checkout to US buyers as a funding source for
  one-time payments, and is rendered by PayPal's JavaScript SDK when
  `enable-funding=venmo` is set. PayPal's documentation does not say whether
  a Venmo-funded subscription is possible, and this plan does not assume it.

So PayPal is its own provider, `lib/billing/providers/paypal.ts` (new), over
PayPal's REST API with fetch and no SDK, and the FIRST task of Phase 3 is a
spike (MB-T070) that settles, in a sandbox: (a) whether the redirect-only
flow shows Venmo, or whether the JS SDK buttons are required for it; (b)
whether a subscription can be Venmo-funded; (c) whether Stripe's custom
payment method bridge is a simpler route to PayPal for ONE-TIME services.
The spike's answers are recorded here before any other Phase 3 task starts.

Spike result (to be filled in): ______________________________________________

Specified against the reading that PayPal's own APIs are used for both:

Auth: `POST /v1/oauth2/token` with `grant_type=client_credentials`, basic
auth from `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`; the token is memoised
in-process until 60 seconds before `expires_in`. Host from `PAYPAL_ENV`
(`sandbox` → `api-m.sandbox.paypal.com`, `live` → `api-m.paypal.com`).

One-time purchase (Orders v2):
```
POST /v2/checkout/orders
  intent=CAPTURE
  purchase_units[0].reference_id=<purchase uuid>   .custom_id=<purchase uuid>
  purchase_units[0].amount={ currency_code, value }   .description=<product name>
  payment_source.paypal.experience_context={ return_url, cancel_url, user_action: "PAY_NOW",
    shipping_preference: "NO_SHIPPING", brand_name: "FF Beacon" }
```
Redirect to the `payer-action` link. On return (`?token=<order id>`), the
return route calls `POST /v2/checkout/orders/{id}/capture` and then
`syncPurchaseFromProvider`. Webhook `PAYMENT.CAPTURE.COMPLETED` does the same,
whichever arrives first; both are idempotent.

Subscription (Subscriptions v1): the admin's "create price" action creates a
catalog product (`POST /v1/catalogs/products`) and a plan
(`POST /v1/billing/plans` with one `REGULAR` billing cycle, `MONTH` or `YEAR`,
`payment_preferences.auto_bill_outstanding=true`), stored as
`provider_price_id`. Checkout is `POST /v1/billing/subscriptions` with
`plan_id`, `custom_id=<user uuid>`, and `application_context` (`return_url`,
`cancel_url`, `user_action: "SUBSCRIBE_NOW"`); redirect to the `approve` link;
on return (`?subscription_id=`) sync from the provider. Status map: `ACTIVE` →
`active`, `APPROVAL_PENDING` / `APPROVED` → `incomplete`, `SUSPENDED` →
`past_due`, `CANCELLED` → `canceled`, `EXPIRED` → `canceled` with `ended_at`.
`current_period_end` is `billing_info.next_billing_time`. Cancel is
`POST /v1/billing/subscriptions/{id}/cancel`, from our own Cancel button (Part
17.5), because PayPal has no hosted portal; a member can also cancel from
PayPal itself, which arrives as `BILLING.SUBSCRIPTION.CANCELLED`.

Webhook verification: `POST /v1/notifications/verify-webhook-signature` with
`auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`,
`transmission_time` (the five request headers), `webhook_id`
(`PAYPAL_WEBHOOK_ID`) and `webhook_event` (the parsed body). Only
`verification_status = "SUCCESS"` passes; anything else, including a network
failure, fails closed. Events handled: `PAYMENT.CAPTURE.COMPLETED`,
`PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`,
`CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`,
`BILLING.SUBSCRIPTION.ACTIVATED`, `.UPDATED`, `.CANCELLED`, `.SUSPENDED`,
`.EXPIRED`, `.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`.

Venmo, if the spike says the SDK is required: `components/billing/paypal-buttons.tsx`
(client) loads `https://www.paypal.com/sdk/js?client-id=<PAYPAL_CLIENT_ID_PUBLIC>&enable-funding=venmo&intent=capture`
on the CHECKOUT CHOICE page only (`/services/[slug]` and `/plus`), renders
PayPal's own buttons, and on approval hands the order id to our return route.
No card field, no payment iframe on our origin, and the `Permissions-Policy:
payment=()` header stays, because PayPal's buttons open PayPal's own window
rather than the Payment Request API. It DOES require `script-src` and
`frame-src` entries for `www.paypal.com` and `www.sandbox.paypal.com` in the
CSP (MB-T073), which the security review verifies are the only additions.

Env: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
`PAYPAL_ENV` (`sandbox` | `live`), and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` ONLY if
the SDK buttons are built (a client id is public by design; the secret never
is).

### 16.4 What the two providers cannot share, and how the UI says so

- Stripe members manage everything on the hosted portal. PayPal members get
  our own Cancel button and a "Update how you pay on PayPal" outbound link,
  because there is no portal. `/my-beacon/membership` renders per provider.
- Switching tier on PayPal is cancel plus resubscribe (PayPal has a plan
  revise call, `POST /v1/billing/subscriptions/{id}/revise`, but it is not
  built in V1). The page says so.
- Promotion codes are a Stripe feature. A PayPal checkout has none.
- Stripe Tax has no PayPal equivalent. Part 29.4 says what the PayPal button
  shows when `tax.mode` is not `none` (a note, on by default through
  `tax.paypalNote`) and gives the owner the switch
  (`providers.paypal.subscriptions: false`) that limits PayPal to one-time
  services if their accountant prefers that. Both are settings, neither is a
  deploy.

---

## Part 17. The flows

Every flow below writes membership state through ONE function per subject:
`syncMembershipFromProvider(provider, providerSubscriptionId)` and
`syncPurchaseFromProvider(provider, providerCheckoutId)` in
`lib/billing/sync.ts`. Each FETCHES the object from the provider, normalises
it, upserts our row, revalidates the entitlement tag, writes an audit row when
access changed, and returns the row. Webhooks, success pages, the reconcile
cron and the admin resync button all call the same function.

ABSOLUTE RULE: THE WEBHOOK IS A DOORBELL, NOT A LETTER. An event's payload is
never written to our tables as fact. It tells us WHICH object to look at, and
the sync function fetches the current object. Provider events arrive out of
order (a `customer.subscription.updated` for the cancel can land before the
`created`), and a handler that applies payloads in arrival order writes a
stale state last. Fetching makes ordering irrelevant.

### 17.1 Upgrade (join a tier)

1. Reader on `/plus` picks a tier and an interval and a provider, and
   submits `POST /api/billing/checkout` with `{ tierSlug, interval, provider,
   returnPath }`. Amounts and price ids are NEVER in the request.
2. The route, in order: same-origin (`isSameOrigin`); signed in (a guest is
   sent to `/login?next=/plus`); `settings.enabled` and the provider
   enabled and configured (503 with the honest message otherwise); tier
   active and public, price active for that provider and interval (400);
   the reader has no membership that currently grants (a member is sent to
   the portal to switch instead, 409 with the portal path); rate limit
   `billing-checkout` 6 per minute per actor, claimed LAST before the
   expensive half; ensure the customer; create the session; verify the
   redirect host (`checkout.stripe.com` / `*.stripe.com` or the PayPal
   host); return `{ ok, url }`.
3. Stripe collects payment on its page. The reader lands on
   `/plus/welcome?checkout=success&session_id=cs_...` (Part 27.5, the
   post-purchase welcome).
4. The welcome page's success handler retrieves the session, reads
   `subscription`, and calls `syncMembershipFromProvider` itself. It does NOT
   wait for the webhook: the page can grant access in the same render. If the
   session is `open` (payment pending on a delayed method), the page shows
   "activating" with a live region and revalidates every 5 seconds for up to
   2 minutes via `GET /api/billing/status` (own membership only), then tells
   the reader the email will confirm. Once the membership grants, the page
   renders the welcome tour for the tier just joined.
5. The webhook (Part 18) arrives whenever it arrives and calls the same sync,
   which finds nothing to change.

### 17.2 The welcome

On the first transition to a granting status, `lib/email/billing-emails.ts
sendMembershipWelcome` (Part 21) goes out ONCE, claimed by a `welcome_sent_at`
column on `memberships` (added in 0281). It carries the tier, the amount, the
interval, the renewal date, how to cancel, and the Terms link: that email is
the auto-renewal confirmation the law wants (Part 23).

### 17.3 Renewal

`invoice.paid` on a subscription: sync (the period dates move). No email from
us; Stripe's own invoice receipt is ON for subscriptions, which is the
opposite of the donation rule and is stated in `docs/billing/billing.md`: a
renewal receipt is a tax document with an invoice number and Stripe's is the
authoritative one. We send NO receipt of our own for renewals, so there is
exactly one, as with donations, just the other way round.

`invoice.upcoming` (fires `days_until_due` ahead, configured to 30 in the
Dashboard) on a YEARLY subscription: `sendRenewalReminder`, once per period,
claimed by `renewal_reminder_sent_for` (a period-end timestamp column on
`memberships`). Monthly plans get none; the settings key
`renewalReminderDays` is the one knob.

### 17.4 A failed renewal

`invoice.payment_failed`: sync (status becomes `past_due`), then
`sendPaymentFailed` once per period, claimed the same way. Stripe's Smart
Retries and its own dunning emails are ON (Dashboard, recorded in the doc);
ours is the one that says what happens to Beacon Plus and links to the portal
to fix the card. Access continues for `gracePeriodDays` past the period end
(Part 14.5). When Stripe gives up, the subscription becomes `canceled` or
`unpaid` and access ends at the next resolve.

### 17.5 Cancel

Stripe: the member presses "Cancel membership" on `/my-beacon/membership`,
which opens a portal session with `flow_data[type]=subscription_cancel`.
Stripe shows its own confirmation, cancels at period end, and the webhook
syncs `cancel_at_period_end=true`. Our page then reads "Ends on <date>. You
keep everything until then." and offers "Keep my membership" (portal again,
`subscription_update` flow, which Stripe uses to reverse a pending cancel).

PayPal: our own Cancel button opens the house confirm dialog
(`desktopPlacement="center"`, it is a decision), and the server action calls
`cancelSubscription({ atPeriodEnd: true })`, then syncs.

`sendCancellationConfirmed` goes out once, on the transition, from the sync
function, whichever path caused it.

ABSOLUTE RULE: cancelling takes no more steps than joining did. One page,
one button, one confirmation. No retention screen of ours, no "are you sure"
beyond the single confirm, no email-us-to-cancel. This is both the law's
requirement and the site's character.

### 17.6 Switch tier or interval

Stripe: the "Switch to <tier>" buttons on `/my-beacon/membership` open the
portal `subscription_update` flow, which shows Stripe's proration and
confirms. Our tier row is read off the subscription's price id on sync
(`membership_tier_prices.provider_price_id` → `tier_id`), so a switch made on
Stripe's page lands in our table without any code that knows what "upgrade"
means. A price archived on our side (Part 15.4) still resolves, because the
row is archived, not deleted.

When the owner changes a tier's price, existing members stay on the old
price. `scripts/migrate-tier-price.ts` (MB-T059) moves them, with a dry run,
a `--tier` and `--to-price` and Stripe's `proration_behavior=none`, and is run
by hand. It is never scheduled.

### 17.7 Refunds and disputes

Per Part 12.4, no refund is ever automatic and no reader-facing control offers
one. A refund, when the owner decides to grant one, is issued from
`/admin/billing/orders` (a service, at any fulfilment stage, with a required
note that goes into the audit row) or `/admin/billing/members` (a membership
invoice, likewise with a note), or from the Stripe or PayPal dashboards.
`charge.refunded` arrives; the handler finds the purchase by `payment_intent`,
marks it `refunded`, revokes every grant whose `source_id` is that purchase,
revalidates, audits, and sends `sendRefundConfirmed`. A refund on a
SUBSCRIPTION invoice changes nothing about access on its own (the
subscription's status is what grants) and is recorded in the audit log; if the
owner also wants access to stop, "End now" on the Members page does that as a
separate, separately audited step. `purchases.refundableUntil` is `"never"` by
default, which means the buyer's purchase page never states a refund window and
the product page links the refund policy instead.

`charge.dispute.created`: the purchase or membership is marked `disputed`,
and if `disputeRevokesImmediately`, the membership's row is set to `unpaid`
locally (a provider re-fetch would overwrite it, so `dispute_hold_until` is
also set and the sync function honours it) and grants from that purchase are
revoked. An admin email goes out at once. `charge.dispute.closed` with `won`
clears the hold and resyncs.

### 17.8 Buy a service, fill in the intake, receive the review

1. `/services/<slug>` describes the product, the turnaround, the refund
   window and the price. "Buy" posts to `POST /api/billing/purchase` with
   `{ productSlug, provider }`, same defenses as 17.1, plus: the purchases row
   is inserted first (`pending`), and its id goes into the session.
2. Return lands on `/my-beacon/purchases/<id>?checkout=success&session_id=`.
   The page syncs from the session, and on `paid` renders the INTAKE FORM
   built from `billing_products.intake_fields`, a zod-validated list of
   `{ key, label, kind: "league" | "roster" | "text" | "longtext" | "trade" | "choice", required, options?, help? }`.
   A `league` field renders the reader's saved-handle league list
   (`components/league-choice-list.tsx`, the radiogroup, per the saved-handle
   rules); `roster` renders the rosters of the chosen league; `trade` renders
   the Signal Check trade picker. The answers are stored on `intake`, and a
   league or roster answer is stored as the Sleeper ids, so the admin's
   fulfilment view can open the league in League Pulse in one click.
3. `submitIntake` (server action) validates the answers against the product's
   schema, asserts ownership and `fulfilment_status = 'awaiting_intake'`,
   writes `intake`, `intake_submitted_at`, `due_at`, flips to `queued`, and
   emails the admin (`sendOrderQueued`).
4. `/admin/billing/orders` is the queue: due soonest first, overdue in red
   with `role="status"` text, each row opening the intake, the league links,
   and a plain-text editor for the deliverable. "Start" flips to
   `in_progress` (which, by the default policy, ends the refund window and
   the page says so); "Deliver" requires a non-empty deliverable, flips to
   `delivered`, stamps `delivered_at`, and sends `sendOrderDelivered` with a
   link to `/my-beacon/purchases/<id>`.
5. The buyer's page renders the deliverable as paragraphs (Part 15.10), the
   intake they submitted, and the dates. Own-only, uuid-keyed, no listing
   without a session.
6. A `grant` product skips 2 to 5: on `paid`, `feature_grants` rows are
   inserted from `grant_features` (`expires_at = now() + days`), the purchase
   is `delivered` at once, and `sendGrantActivated` says what was unlocked
   and until when.

A buyer who has not submitted the intake after `intakeReminderDays` gets one
reminder (`intake_reminder_sent_at` claim). Nothing is ever auto-cancelled;
an unclaimed purchase is the admin's to refund.

### 17.9 Account deletion

The existing account-deletion path gains a step (MB-T041): before the auth
user is deleted, cancel any granting membership immediately on the provider
(so a card is not charged for an account that no longer exists), and the
`on delete cascade` on `memberships`, `purchases`, `feature_grants` and
`billing_customers` removes our rows. The Stripe Customer is NOT deleted
(Stripe is the retention record for invoices); a note is written to the
customer's metadata (`deleted_from_ffbeacon_at`).

---

## Part 18. Webhooks and reconciliation

### 18.1 Two Stripe endpoints, on purpose

`/api/donate/webhook` is untouched and keeps its own signing secret and its
receipt ledger; it is subscribed only to the two Checkout events it already
handles, filtered further by `metadata[product] = ffbeacon_donation` (MB-T003,
a one-line guard added so a membership session can never be receipted as a
donation). `/api/billing/webhook/stripe` (new) has `STRIPE_BILLING_WEBHOOK_SECRET`
and is subscribed to:

```
checkout.session.completed            checkout.session.async_payment_succeeded
checkout.session.async_payment_failed checkout.session.expired
customer.subscription.created         customer.subscription.updated
customer.subscription.deleted         customer.subscription.paused
customer.subscription.resumed         customer.subscription.trial_will_end
invoice.paid                          invoice.payment_failed
invoice.payment_action_required       invoice.upcoming
charge.refunded                       charge.dispute.created
charge.dispute.closed                 customer.deleted
```

Two endpoints because the donation route has shipped with an exactly-once
receipt guarantee that has been reasoned about line by line, and threading a
second responsibility through it would put that reasoning at risk for the
sake of one fewer URL. Stripe supports any number of endpoints, each with its
own secret and event list.

`/api/billing/webhook/paypal` (new) is the PayPal twin.

### 18.2 The handler, in order, every time

Both routes share `lib/billing/webhook-handler.ts handleBillingWebhook(provider, rawBody, headers)`:

1. Raw body as text, never `req.json()` (signature).
2. `provider.verifyWebhook` FIRST. Failure is 400 and a warn line with the
   reason only. `no-secret` is an error line naming the env var.
3. Upsert `billing_events` by `(provider, provider_event_id)` with
   `ignoreDuplicates`, `status = 'received'`, and the redacted projection.
4. `try_claim_billing_event`. False: read the row; `processed` or `ignored`
   → 200 `already-handled`; still `processing` → 500 so the provider retries
   after the stale window (the donation route's reasoning, verbatim).
5. Dispatch on `subject.kind`:
   - `subscription` → `syncMembershipFromProvider`
   - `order` → `syncPurchaseFromProvider`
   - `refund` → Part 17.7
   - `dispute` → Part 17.7
   - `upcoming_renewal` → Part 17.3
   - `ignored` → mark `ignored`, 200.
6. Mark `processed` with `processed_at`, or `failed` with a vocabulary
   `last_error` and 500 (so the provider retries; the attempt ceiling stops
   a poison event after 8).

Livemode: an event whose `livemode` does not match `BILLING_LIVEMODE_EXPECTED`
(`true` in production, derived from the secret key's `sk_live_` prefix, never
a separate setting) is recorded and `ignored`, with a warn. A test-mode
webhook pointed at production grants nobody anything.

### 18.3 `lib/billing/redact.ts`

`redactStripeEvent` from `lib/donate/redact.ts` generalised by object type:
`redactCheckoutSession` (the donation allow-list, unchanged),
`redactSubscription` (id, object, status, items[].price.id, items[].current_period_*,
current_period_*, cancel_at_period_end, canceled_at, ended_at, trial_end,
livemode, created, metadata), `redactInvoice` (id, status, subscription (both
shapes), amount_paid, amount_due, currency, period_start, period_end,
livemode, created), `redactCharge` (id, amount, amount_refunded, currency,
payment_intent, refunded, disputed, livemode, created), `redactDispute` (id,
status, reason, amount, charge, payment_intent, livemode, created), and
`redactPayPalEvent` (id, event_type, resource_type, resource.id,
resource.status, resource.custom_id, resource.plan_id, resource.amount,
resource.billing_info.next_billing_time, create_time). Each is an ALLOW-LIST,
each is pure, and `lib/billing/redact.test.ts` feeds every one a payload with
`customer_details`, `billing_details`, `payer`, `subscriber`, `shipping`,
`email_address`, `name` and `address` populated and asserts that not one of
those strings appears anywhere in the output, recursively.

### 18.4 The success page is not the webhook, and neither is trusted

The success page fetches by session id, which is unguessable and was minted
by our own authenticated call. The session's `client_reference_id` must equal
the signed-in user (or the purchase's `user_id`) or the page refuses with a
generic message and logs: a session id belonging to someone else grants
nothing to whoever pastes it. The webhook is authenticated by signature.
Neither reads a query string as fact.

### 18.5 The reconcile cron

`/api/cron/billing-reconcile`, daily, registered in `CRON_JOBS`
(`lib/cron-runs.ts`) with the `CRON_SECRET` gate every cron has. Bounded
sweeps, each paged with `range()` (the first three here; the fourth is comp
expiry, Part 28.1; the fifth is the tax status read, Part 29.3; the sixth is
league-plan seat reconciliation and the seventh is the paused-membership
resume check, both Part 31; the eighth prunes `notification_events` older than
30 days and `promotion_impressions` older than 400 days, Part 31.8; the ninth
polls domain verification, disconnects lapsed league homes and marks expired
registrations, Part 31.4b):

1. Memberships in a granting status whose `synced_at` is older than 24 hours:
   `syncMembershipFromProvider`, at most 200 per run, oldest first. A webhook
   that never arrived (endpoint misconfigured for a day) is repaired within a
   day.
2. `purchases` in `pending` older than 24 hours: fetch; `paid` → sync;
   otherwise `expired`.
3. `billing_events` in `failed` under the attempt ceiling: re-claim and
   re-dispatch, at most 50.

It iterates NO leagues and touches NO on-demand model. It is the one billing
job on a schedule, and the reason it exists is that money and access must
agree even when a webhook is lost.

---

## Part 19. Surfaces

### 19.1 `/plus`, the pricing section of the sales page

`/plus` is the Beacon Plus sales page, and Part 27.1 specifies it top to
bottom. This section specifies the three pieces of it that are REUSED
elsewhere and therefore live in their own components: the interval toggle and
tier cards (`components/billing/tier-cards.tsx`), the comparison table
(`components/billing/tier-comparison.tsx`), and the "why you are here" status
line. The tour pages (Part 27.2, 27.3) and the member's page (19.2) render the
same components with a `currentTierSlug` prop, so a tier is described in one
place.

Server component. 404 when `settings.enabled` is false. Reads active public
tiers that have at least one active price on an enabled provider (Part 14.2),
their active prices per enabled provider, their features joined to the catalog
(with `pitch` from the panel override or the registry default), and the
reader's entitlements.

Layout, in reading order: the headline and subhead from settings; an interval
toggle (Monthly / Yearly, a `role="radiogroup"` of two native radios in
labels, defaulting to Yearly when `showAnnualSavings` and a yearly price
exists on every public tier, with the saving stated in words beside the
radio, "Yearly, two months free"); then ONE CARD PER TIER in display order,
each an `<article>` with an `h2` (the tier name), the price for the chosen
interval as one text node ("$4 a month, billed $48 a year"), the tagline, a
real `<ul>` of the tier's MARKETABLE features (name, and for a quota the
number in words: "150 league captures an hour"), and the buttons: one per
enabled provider ("Join with card or wallet", "Join with PayPal or Venmo"),
or "Your current tier" as text, or "Switch on the billing page" as a link for
a member of another tier. The Free tier's card is the first, so the page's
first claim is what stays free.

Below the tiers: a comparison `<table>` with one row per marketable feature
in catalog order and one column per public tier, cells reading "Included",
"Not included", or the quota number, with `<th scope>` on both axes and a
`<caption>`. Then the ONE-TIME SERVICES section (Part 19.3), then the plain
words: the renewal terms sentence (Part 23.3), the refund policy in one
paragraph, and links to Terms and Privacy.

`?feature=<key>` (from an upgrade prompt) puts a `role="status"` line at the
top, "You followed a link about <feature name>. It is included in <tiers>.",
and moves focus to it, so the reader knows why they are here.

Wide content scrolls in its own container; the body never scrolls
horizontally. Every price is one text node with the missing words appended
`sr-only` inside the same element, never drawn twice (the Lineups rule).

### 19.2 `/my-beacon/membership`

The member's page, signed-in only. Renders from `my_membership` and the
entitlements: the tier, the status in words ("Active, renews 12 Oct 2026",
"Ends 12 Oct 2026, you keep everything until then", "Payment failed, access
continues until 19 Oct 2026"), the provider, and the controls per provider
(Part 16.4): Manage billing (portal), Cancel, Keep my membership, Switch to
<tier>. A grants list ("Beacon Link until 3 Nov, from your Roster Review
purchase") from `my_feature_grants`. A comp or trial membership reads "Plus,
on us, until 3 Nov 2026" with a "Keep Plus after that" link to `/plus`
(Part 28.4). A Free-tier reader sees a short card that links to `/plus`.

Below the status: a "What your tier can do" panel (Part 27.3), which is the
tier comparison with the reader's column marked as theirs and every feature
they hold rendered as a link into the tool where it is used, so the page is
also the reader's map of the site. Then a "Notifications" line (on or off, how
many kinds, a link to `/my-beacon/notifications`), so the two things a member
manages sit one link apart. The checkout success state itself is on
`/plus/welcome` (Part 17.1 step 3), not here.

The `beacon-rail.tsx` "Account at a glance" panel gains one line, the tier
name, linking here, and `/my-beacon/account` gains a "Membership and
purchases" panel under Connected accounts with the same link, so both
obvious places lead to one page.

### 19.3 `/services` and `/services/[slug]`

`/services` lists active public products as cards (name, tagline, price,
turnaround in words, "Learn more"). `/services/[slug]` is the description,
the price, the turnaround, the refund window sentence, what the intake will
ask (built from `intake_fields` so the page and the form cannot disagree),
and the Buy buttons per provider. Signed out, Buy is "Sign in to buy",
because a purchase needs an account to deliver to.

Advertising, where the owner asked for it: `/tools` gains a card, "Get a
human review", linking to `/services`; the League Pulse deep view header gains
a "Get this roster reviewed" link (rendered by `FeatureGate` on nothing, it is
always shown, but only when `settings.purchases.enabled`) that deep-links
`/services/<slug>?league=<id>&roster=<id>` so the intake opens prefilled;
`/tools/signal-check`'s result gains "Get a second opinion on this trade"
linking the trade-review product with the trade encoded. Each is one
`Link`, styled as the site's secondary button, and each is absent when
purchases are off.

### 19.4 `/my-beacon/purchases` and `/my-beacon/purchases/[id]`

The list (product, date, status in words, "Open"), and the detail (Part 17.8
steps 2 and 5). The detail's status line is `role="status"` so a buyer who
refreshes hears the change. `awaiting_intake` puts focus on the form's
heading.

### 19.5 Header and hub

The site header gains, for a signed-in reader on the Free tier when selling
is on, a "Beacon+" control to the LEFT of the donate heart, matched to its
neighbours (the recent header commit set that convention): the mark as its
visible text, "Beacon Plus, see what a membership adds" as its accessible
name, linking to `/plus`. It is the one place the promotion system is allowed
to be persistent (Part 25.3), because a header control is where a reader
expects to find the way to a product's paid half, and it is small. For a
member it becomes the tier badge (`membership_tiers.badge`), a link to
`/my-beacon/membership`, with the accessible name "<tier name> member,
manage membership". Signed out, the same "Beacon+" control links to `/plus`
too, because the sales page is public (Part 27.1) and a guest is exactly who
it is for; it is the footer's Site column entry as well, beside Donate.

The `/tools` hub marks a gated tool's card with the words "Included in <tier>"
under its title, from the same resolver the page uses, so the hub and the
tool agree. At launch nothing on the hub is gated (Part 12.6), so the hub
gains instead ONE card at the end of the grid, "Beacon Plus", styled as the
other tool cards and linking to `/plus`, with the subhead from settings. It is
a card among cards, not a banner.

### 19.6 `/admin/billing`

A new admin area, every page behind `requireAdmin` plus the layout gate,
every write a server action with the same-origin guard and an audit row.
Subpages, each its own route so each has its own H1:

- `/admin/billing` (overview): members by tier, MRR computed from active
  prices (a number, labelled as an estimate, because proration and tax are
  Stripe's), purchases this month, the fulfilment queue count with overdue
  in red, failed events count, and the kill switch state, loud.
- `/admin/billing/tiers`: the list, reorderable (up and down buttons, not
  drag), with per-tier: name, slug (immutable after creation), tagline,
  description, badge, public and active toggles, the PRICE panel (current
  active price per provider and interval, "Set a new price" which creates the
  provider object and archives the old, with the immutability note), and the
  FEATURE CHECKLIST: every catalog feature grouped by area, one native
  checkbox per feature in a `<fieldset>` per area, a number input beside each
  quota ("blank means unlimited"), and "Copy features from..." (a one-time
  copy). Save writes the diff as insert and delete rows and audits each.
  The catalog sync runs on render (Part 15.2).
- `/admin/billing/features`: the catalog: key, name, kind, area, visibility,
  marketable, headline, and WHICH TIERS include it. Visibility, marketable and
  headline are editable here (they are catalog properties, not code), and so
  are the three copy fields of migration 0294: the PITCH (one sentence, the
  registry default shown as placeholder text, "Reset to default" beside it),
  the STORY (the tour paragraph, plain text), and the headline flag, with the
  headline count (settings.pricing.headlineMax) and no-Beacon-Link-headline rules enforced on save and the
  Part 25.5 denylist run over every field; a rejected save names the word.
- `/admin/billing/codes`: Part 28.3. Create a code (auto-generated or typed,
  tier, days, max redemptions, start and expiry, new-members-only, note), the
  list with redeemed counts, disable, and a per-code redemption list linking
  each member. Copy-to-clipboard on the code with a `role="status"`
  confirmation.
- `/admin/billing/promotions`: Part 25.4. Every promotion placement in the
  registry, grouped by surface, each with its variant, the feature it sells,
  its current copy, an on/off switch (`settings.promotion.placements`), and
  the counts from `promotion_impressions` (shown and dismissed, last 30 days).
  The global promotion switch, `dismissDays` and `maxPerPage` live on the
  settings page; this page is per placement.
- `/admin/billing/products`: create and edit services: name, slug, tagline,
  description, price (same create-and-archive rule), fulfilment kind,
  turnaround, the intake field builder (add a field, pick its kind, label,
  required), the grant list for `grant` products, public and active.
- `/admin/billing/orders`: the queue (Part 17.8 step 4), filterable by
  status, with Start, Deliver, Refund (house confirm dialog, then
  `refundPayment`, then the webhook confirms), and "Open in League Pulse".
- `/admin/billing/members`: search by email or handle (through the auth
  admin API, as the overview's user list does), each member's memberships,
  grants, purchases, notification history and events; actions, each confirmed
  in the house dialog and audited with a note (Part 28.1): "Give a tier"
  (tier, until a date or for N days, note; creates a comp with `source =
  'admin'`), "Extend" (moves a comp's `expires_at`), "Change tier" (a comp
  only; a paid membership is changed on the provider's page), "End now" (a
  comp ends at once; a paid membership is cancelled immediately on the
  provider with a warning that no refund is issued by this action), "Grant a
  feature" (feature, until, limit, note), "Revoke" a grant, "Resync from
  provider", "Resend welcome", and "Refund an invoice" (Part 17.7, note
  required). A bulk form takes a list of handles or emails, one per line, and
  gives each the same comp, with a preview of who resolved and who did not
  before anything is written.
- `/admin/billing/events`: the webhook ledger, newest first, with status,
  type, subject, and "Reprocess" on failed rows.
- `/admin/billing/audit`: the audit log.
- `/admin/billing/settings`: the settings form from Part 15.1, with a
  coverage test (`app/admin/billing/settings-coverage.test.ts`) asserting
  every key has a control, the Manager Pulse pattern.

The `/admin` index gains a Billing section card linking here, and a
Notifications card linking to `/admin/notifications` (Part 26.7), which is its
own area because notifications are a product feature that happens to be paid,
not a billing concern.

---

## Part 20. Security model and checklist

### 20.1 Threats, in rough order of likelihood

1. A reader granting themselves a feature (a forged flag, a tampered cookie,
   a client-side check). Mitigated by server-side resolution at the point of
   use, every time (14.6), and the gate guard test.
2. A forged webhook granting a membership. Mitigated by signature
   verification first, failing closed, on both providers (18.2), and by the
   handler fetching the object rather than trusting the payload (17).
3. Price tampering. The request carries a tier slug and an interval; the
   price id comes from our table, the amount lives on the provider. There is
   no amount in any request we accept.
4. A session id or purchase id belonging to someone else pasted into a
   success URL. Mitigated by `client_reference_id` ownership check (18.4),
   uuid purchase ids, and own-only views.
5. Personal data leaking into our database. Mitigated by allow-list
   projections for every stored provider object (18.3), no email column
   anywhere in Part 15, and the redact test.
6. A checkout-creation endpoint used to spam sessions or a limiter that
   fails open. Mitigated by the same-origin guard, auth, the durable
   fail-closed limiter claimed last (17.1).
7. An admin action forged cross-site. Mitigated by `requireAdmin`, the
   same-origin guard on every action, confirm dialogs on money-moving ones,
   and the audit log.
8. A test-mode event at a production endpoint. Mitigated by the livemode
   check (18.2).
9. The deliverable page as an injection surface. Mitigated by plain text
   rendered as text nodes (15.10).
10. A secret in the client bundle. Mitigated by `server-only` on every
    provider module and a built-chunk grep in the review.

Explicitly not defended: a compromise of the deploy environment. Same
statement as Part 3A.1.

### 20.2 The review checklist, verified before Phase 1 ships

A security review sub-agent confirms each, citing code:

1. `select * from memberships` (and `purchases`, `billing_customers`,
   `feature_grants`, `billing_events`, `billing_audit_log`, `billing_settings`)
   as anon and as authenticated returns nothing; each `my_*` view returns
   only the owner's rows and only the listed columns; the public tables
   return only active rows to anon.
2. Every route and action under Part 17 checks same-origin, auth and
   entitlement in the stated order, and the rate-limit claim is the last
   thing before the provider call.
3. A webhook with a bad signature, a stale timestamp, a missing secret, or a
   mismatched livemode changes nothing and returns 400 (or 200 ignored for
   livemode), proven by tests using `signPayloadForTest`.
4. A replayed event (same id) processes once, proven by a test that delivers
   it three times.
5. A subscription event whose payload says `active` but whose fetched object
   says `canceled` results in `canceled`.
6. A success URL with another user's session id grants nothing.
7. `redact.test.ts` passes for every object type with identity fields
   populated.
8. `gate-guard.test.ts` passes, and a deliberately ungated action fails it
   (verified with a throwaway file, then removed).
9. No `NEXT_PUBLIC_` variable carries a secret; `STRIPE_SECRET_KEY`,
   `STRIPE_BILLING_WEBHOOK_SECRET`, `PAYPAL_CLIENT_SECRET` and
   `PAYPAL_WEBHOOK_ID` are absent from every client chunk, proven by
   grepping the build.
10. The Beacon Link envelope refuses an unentitled action before claiming a
    slot and logs `not_entitled`, proven by a test.
11. The default tier cannot be deleted or deactivated (trigger test).
12. `npm audit` shows no new high or critical finding.

### 20.3 Operational duties

- Stripe Dashboard: restricted key with only the permissions this plan calls
  (Checkout Sessions, Customers, Subscriptions, Prices, Products, Refunds,
  Billing Portal, Invoices read), rather than the full secret key, once the
  build is stable. Recorded in the doc.
- Both webhook endpoints registered with exactly the event lists above, and
  the signing secrets stored only in the deploy environment.
- A written incident plan: if a key is believed exposed, roll it in the
  Dashboard, redeploy, and audit `billing_audit_log` and `billing_events` for
  the window.

---

## Part 21. Emails

`lib/email/billing-emails.ts` (new), each built in the branded shell, each
with a pure `build*` function and a test on the wording, each timestamp
through `formatEastern`:

| Function | When | Claim column |
| --- | --- | --- |
| `sendMembershipWelcome` | first granting status | `memberships.welcome_sent_at` |
| `sendRenewalReminder` | `invoice.upcoming`, yearly only | `memberships.renewal_reminder_sent_for` |
| `sendPaymentFailed` | `invoice.payment_failed` | `memberships.payment_failed_notified_for` |
| `sendCancellationConfirmed` | transition to cancel-at-period-end or canceled | `memberships.cancel_notified_at` |
| `sendMembershipEnded` | granting → not granting, not by cancel (unpaid) | `memberships.ended_notified_at` |
| `sendPurchaseReceipt` | purchase `paid` | `purchases.receipt_sent_at` |
| `sendOrderQueued` (to admin) | intake submitted | `purchases.admin_notified_at` |
| `sendOrderDelivered` | delivered | `purchases.delivered_notified_at` |
| `sendGrantActivated` | grant product paid | same column as delivered |
| `sendRefundConfirmed` | refund processed | `purchases.refund_notified_at` |
| `sendIntakeReminder` | `intakeReminderDays` after paid, no intake | `purchases.intake_reminder_sent_at` |
| `sendDisputeOpened` (to admin) | dispute created | none (admin, idempotent by event) |
| `sendTrialEnding` | `customer.subscription.trial_will_end` (3 days before) | `memberships.trial_ending_notified_at` |
| `sendCompStarted` | a comp membership is created (admin or code) | `memberships.welcome_sent_at` (it IS the welcome for a comp) |
| `sendCompEnding` | `compEndingReminderDays` before a comp or trial `expires_at` | `memberships.renewal_reminder_sent_for` (reused: a comp has no renewal) |
| `sendCompEnded` | a comp or trial expired without a paid membership following it | `memberships.ended_notified_at` |

The claim columns are added in 0281 and 0284.

ABSOLUTE RULE: every email in this table is TRANSACTIONAL and is sent
regardless of the reader's notification master switch (Part 26.4). A member
who has turned notifications off still receives their welcome, their
payment-failed notice and their cancellation confirmation, because those are
records of a transaction they entered into and the auto-renewal laws expect
them. The notification emails of Part 26 are the ones the switch governs, and
they live in `lib/email/notification-emails.ts`, a separate file, so the line
between the two is a file boundary and not a flag. Every send is claimed BEFORE
the call, the donation way, so a retried webhook cannot double-send.
Addresses come from the auth session or the provider object in memory and
are never stored. Stripe's own receipts: OFF for one-time purchases (we send
`sendPurchaseReceipt`, one receipt), ON for subscription invoices (Part 17.3,
one receipt). The doc records both toggles.

---

## Part 22. Accessibility rules for these surfaces

Beyond the site-wide rules, which apply in full:

- A price is ONE text node, "$4 a month", with "billed yearly as $48" as a
  sibling sentence, never a struck-through old price beside a new one
  (a screen reader reads both numbers with no indication which is real).
- The interval toggle and the provider choice are native radios in labels,
  never buttons with `aria-pressed`, because the choice is one-of-many and
  the platform's radio behaviour is the correct keyboard model.
- The tier comparison is a real `<table>` with `<caption>` and scoped
  headers; the tier cards above it are the reading-order version of the same
  data, so the table is never the only place a fact lives.
- `FeatureGate`'s locked prompt is a landmark-free `<section>` with a heading
  at the level the gated content would have had, so heading navigation still
  finds the place where the feature would be.
- Every status change a reader can cause on `/my-beacon/membership` and
  `/my-beacon/purchases/[id]` is announced through one `role="status"` line
  per page, and focus goes to the confirmation heading after a server action
  round trip, because the button that was pressed may no longer exist.
- Redirecting to a provider's hosted page is announced first: the button's
  accessible name ends "(opens Stripe's secure checkout)", and the click
  disables nothing until the URL is in hand (the FAAB lesson: a button
  disabled in the same commit as its click drops focus to the body).
- The admin feature checklist uses one `<fieldset>` with a `<legend>` per
  area, so a reader tabbing through eighteen checkboxes always knows which
  area they are in.
- The accessibility review sub-agent confirms "no data hidden at any
  breakpoint" AND "no data hidden by tier" (Part 14.6) on every surface here.

---

## Part 23. Legal and copy changes

None of this is legal advice; all of it is copy the build must change or the
site says something untrue on launch day.

### 23.1 Copy that becomes false the day a tier exists

- `/donate` masthead: "FF Beacon has no subscription, no paywall and no
  locked tier" → "Everything that is free today stays free. Beacon Plus is
  optional, and a donation is still a gift, not a purchase."
- `/donate` fine print: "it unlocks nothing, because there is nothing
  locked" → "it unlocks nothing; Beacon Plus is a separate, optional
  membership."
- `lib/email/donation-emails.ts`: "It does not buy a feature, because there
  is nothing to buy" → "It does not buy a feature. Beacon Plus is separate,
  and a donation is not a membership payment."
- `docs/donations/donations.md` opening paragraph, same change.
- `/about` Support panel, same change.
- `/tools` page title "Free Fantasy Football Tools" stays true (the tools on
  it are on the Free tier at launch) and is re-read the day any of them
  moves.

### 23.2 Terms of Service

A new section 10, "Membership and purchases", after Donations:

- What Beacon Plus is, that it is optional, that the Free tier exists.
- Recurring billing: the amount and interval are shown before you pay, the
  membership renews automatically until cancelled, cancellation takes effect
  at the end of the paid period, and all sales are final (Part 12.4), with a
  link to the Refund Policy (Part 30) as the controlling document on refunds.
- How to cancel: on `/my-beacon/membership`, in one step, any time.
- Trials and codes: a trial converts to a paid membership at its end unless
  cancelled before then, and the trial end date is shown before you start;
  a redeemed code grants a membership for a stated period and does not renew.
- Price changes: notice by email at least 30 days before a change applies to
  an existing member.
- One-time services: what is bought, the turnaround as a target not a
  promise, that the sale is final at purchase, what "delivered" means.
- Chargebacks: a disputed payment suspends access until resolved; contact us
  first.
- Changes to plans: we may change, add to, withdraw or reprice tiers,
  features and services at any time; where a change reduces what a current
  member has paid for, we may extend, credit or refund at our discretion,
  case by case, with no entitlement created (the Part 30 section 10 wording,
  referenced rather than repeated).
- League plans and gifts: a seat in a league plan is held at the plan
  holder's pleasure and ends when the plan does; a gift code carries the
  terms of a code.
- Email notifications: what they are, that they are governed by a switch the
  member controls, and that transactional messages about a purchase are sent
  regardless.
- Payment processing by Stripe and PayPal under their own terms.

The section 9 sentence "We do not set up recurring charges and we do not
store a payment method to reuse" is amended to "for donations" so it stays
true.

### 23.3 The renewal sentence

One sentence, built by `renewalSentence(price)` in `lib/billing/copy.ts`,
tested, and used in FOUR places so they cannot disagree: the pricing page
card, Checkout's `custom_text[submit][message]`, the welcome email, and the
Terms: "Beacon Plus renews automatically at $48 every year until you cancel.
Cancel any time on your membership page; you keep access until the end of
the period you paid for."

Beside it, `finalSaleSentence()` from the same file, used wherever a Buy or
Join control appears and in every receipt: "All sales are final. See our
Refund Policy." with the last three words linking `/refund-policy`. When a
trial is in force, `trialSentence(tier, price)` precedes the renewal sentence:
"Your first 14 days are free. Your card is charged $48 on 21 Sep 2026 unless
you cancel before then." (or, card-free, "Nothing is charged unless you add a
card before it ends"), with the date through `formatEastern`.

### 23.6 `/refund-policy`

A new public page carrying the Part 30 text verbatim, in the same shell as
`/terms` and `/privacy`, with an "Effective" date line, an H1 "Refund Policy",
one H2 per section, and a footer link from every page. It is linked from:
every Join and Buy control's `finalSaleSentence`, Terms section 10, the
pricing page's plain-words block, every receipt and welcome email, the
checkout return page, and the purchase detail page. `lib/billing/copy.test.ts`
asserts the page's text equals the constant in `lib/billing/refund-policy.ts`
so the published page and the emails' summary cannot drift apart.

### 23.4 Privacy Policy

The Donations section becomes "Donations, membership and purchases": what
Stripe and PayPal collect (card, name, email, billing address, on their
pages), what we store (a customer id, a subscription id, amounts, dates,
statuses, your intake answers for a service you bought), what we do not store
(card details, billing address, the email you gave the processor), retention
(purchase and membership records are kept for as long as the account exists
and for seven years after for tax, because they are financial records), and
that the intake answers may name a league and a roster.

### 23.5 Stripe Dashboard settings recorded in `docs/billing/billing.md`

Public business name and support email; Terms and Privacy URLs (required for
`consent_collection`); the portal configuration (Part 16.2); Smart Retries
and dunning emails on; invoice receipts on, one-time receipts off; the
`invoice.upcoming` lead time at 30 days; Stripe Tax per 12.3; both webhook
endpoints with their event lists.

---

## Part 24. Naming, gating and kill switches

- The product is BEACON PLUS, decided (Part 12.1); the short mark is BEACON+
  and Part 12.1 says where each is used. The tiers are the admin's names
  ("Free" and "Plus" at launch); "membership" is the word for the relationship
  in all copy ("your membership", never "your subscription", except in the
  Terms and the refund policy where "subscription" is the legal term and is
  used beside it). "On us" is the phrase for a comp or a trial in reader-facing
  copy ("Plus, on us, until 3 Nov"), never "comp", "complimentary" or "free
  trial" as a noun on its own; "trial" is used as an adjective where the
  reader chose one ("your trial ends").
- Routes: `/plus`, `/plus/tour`, `/plus/compare`, `/plus/welcome`,
  `/plus/redeem`, `/refund-policy`, `/services`, `/services/[slug]`,
  `/my-beacon/membership`, `/my-beacon/notifications`, `/my-beacon/purchases`,
  `/my-beacon/purchases/[id]`, `/admin/billing/*`, `/admin/notifications`,
  `/api/billing/checkout`, `/api/billing/purchase`, `/api/billing/portal`,
  `/api/billing/status`, `/api/billing/webhook/stripe`,
  `/api/billing/webhook/paypal`, `/api/billing/paypal/return`,
  `/api/notifications/unsubscribe`, `/api/cron/billing-reconcile`,
  `/api/cron/notifications`. `/membership` is a permanent 308 to `/plus`.
- `billing_settings.enabled` hides every selling surface at once and keeps
  every member a member (Part 15.1). `providers.paypal.enabled` hides PayPal
  alone. `purchases.enabled` hides the services alone. Three switches, each a
  toggle in the panel, none a deploy.
- Beacon Link's own `beacon_link_settings.enabled` (Part 8.2) is unchanged and
  sits UNDER entitlement: a reader needs the Beacon Link switch on AND the
  feature in their tier. Off, nobody sees it; on, only those entitled do.

---

## Part 25. Promotion inside the tools

The owner's brief, verbatim in spirit: everywhere a paid capability could be
used, a nice, non-intrusive but obvious note that it exists; it should feel
like a premium upgrade without being in your face. This part turns that into
one component, one registry of placements, one budget per page, one set of
copy rules, and one test.

### 25.1 The principle: at the point of use, once, and never in the way

A promotion appears exactly where the paid capability would be used, because
that is the only place it is a helpful sentence rather than an advertisement.
On the Lineups page, the "Apply this lineup" control is the promotion for
applying a lineup. Under a Trade Ideas verdict, one line says a member could
send that trade from here. On the notifications page, a Free reader sees the
kinds they would receive. Nowhere else does a promotion for that capability
appear: not on the home page, not in a banner, not in a modal, not in an
email to a non-member (we do not send those).

Five rules, all enforced in code:

1. ONE PER SCREEN. A page render has a promotion budget of
   `settings.promotion.maxPerPage` (default 1). The first placement in render
   order claims it; every later placement on the same render renders nothing.
   Locked CONTROLS (25.2, variant `locked`) do not count against the budget,
   because a locked control is the control itself in its unavailable state,
   not an extra element, and hiding it would hide where the action lives.
2. NEVER MODAL, NEVER OVER CONTENT. No promotion opens on its own, floats,
   sticks, slides in, or covers anything. The `dialog` variant only ever
   appears inside a dialog the reader themselves opened by pressing a locked
   control.
3. DISMISSABLE, AND DISMISSED MEANS GONE. The `strip` and `card` variants
   carry a Dismiss button; dismissal is remembered for
   `settings.promotion.dismissDays` (default 30) per placement. Locked
   controls and the FeatureGate `panel` are not dismissable, because they
   stand where the feature would be and removing them would leave a hole the
   reader cannot explain.
4. NEVER A PROMISE THAT CANNOT BE KEPT. A promotion renders only when every
   one of the following holds: `billing_settings.enabled`,
   `settings.promotion.enabled`, the placement is not switched off, the
   feature is in at least one public tier that has an active price on an
   enabled provider (Part 14.2), the reader does not already hold the
   feature, and, for a `beacon_link.*` key, `beacon_link_settings.enabled`.
   Any one false, and the placement renders nothing (a locked control then
   renders as plain disabled text with no upgrade wording).
5. NEVER ON THE BEACON PLUS PAGES THEMSELVES, never in a loading state, never
   in an error state, never beside a `role="alert"`. A reader dealing with a
   problem is not a sales opportunity.

### 25.2 The component: `components/billing/plus-promo.tsx`

A SERVER component with one small client island (the dismiss button). Props:
`placement: PromoPlacementId` (25.4) and, optionally, `variant` and
`featureKey` overrides for a call site that needs them. It reads the
placement, resolves entitlements (cached, Part 14.4), checks rule 4, claims
the page budget (a React `cache()`d counter keyed on the request), and
renders one of six variants:

- `locked`: a real `<button>` whose visible text is the action's normal label
  and whose accessible name is "<label> (included in Beacon Plus)". Visually:
  the site's secondary button style with the Beacon+ mark set in the
  purple-to-cyan beam at the trailing edge. Pressing it opens the house
  dialog (`components/slide-up-dialog.tsx`, default placement, because it is
  a detail view of what the reader would get) containing the `dialog`
  variant. It never calls the server action behind the real control. This is
  the `locked` prop on `components/beacon-link/action-button.tsx` (Part 14.7)
  and the same rendering for every other locked control on the site, so a
  reader learns the pattern once.
- `strip`: one line, `<p>` inside a `<div role="note" aria-label="Beacon
  Plus">`: the mark, the feature's pitch, the price phrase ("from $4 a
  month"), a "See Plus" link to `/plus?feature=<key>&next=<path>`, and the
  Dismiss button. Sits directly UNDER the heading of the panel it relates to,
  at the panel's text size, with a hairline top border and no background
  fill, so it reads as a footnote to the panel rather than a box on top of it.
- `card`: a rail card for pages with a side rail (`beacon-rail.tsx`, the
  league deep view's right column on wide viewports): a small heading (h3 at
  the rail's heading level), two or three sentences (the pitch plus one
  sentence of the story), the price phrase, the link, Dismiss. Bordered like
  the rail's other cards. On narrow viewports the rail stacks below the main
  content, so the card appears after the content, never before it.
- `panel`: the FeatureGate locked fallback (Part 14.7): a `<section>` with a
  heading at the level the gated content would have had, the pitch, one
  sentence saying what would be here, the price phrase, the link. Not
  dismissable.
- `disclosure`: a "What is Beacon+?" button styled like `InfoTooltip`'s
  trigger that expands an inline region (`aria-expanded`, `aria-controls`)
  with the pitch and the link. For dense surfaces (a table toolbar, a chip
  row) where even a strip is too much. It is a real disclosure, not a
  hover tooltip, because the content is a sentence a screen reader must be
  able to reach and hold.
- `dialog`: the content of the dialog a locked control opens: the feature
  name as the dialog title, the pitch, the story paragraph, what tier
  includes it and at what price, a "See Plus" primary link, and a "Not now"
  button that closes the dialog and returns focus to the locked control.

Every variant shares one anatomy, in reading order: the mark (text "Beacon
Plus" styled to show as "Beacon+", Part 12.1 rule), the pitch, the price
phrase from `pricePhrase(tier, interval)` in `lib/billing/copy.ts` ("from $4
a month" when a monthly price exists, "from $40 a year" otherwise), the link,
and, where allowed, Dismiss. The price phrase is one text node.

The dismiss island: `components/billing/promo-dismiss.tsx`, a client
component rendering the Dismiss button. On press it writes the placement id
into the `bp_promo` cookie (a JSON array of `{ id, until }` entries, capped
at 40 entries oldest-out, `SameSite=Lax`, `Secure`, 30 days, NOT `HttpOnly`
because the client writes it, and it carries nothing but placement ids), calls
`recordPromoEvent(placement, "dismissed")` (25.7), removes the strip or card
from the DOM, and moves focus to the nearest following heading (or the panel
heading the strip sat under). The server component reads the same cookie on
render and skips a dismissed placement, so the note does not flash and
vanish on the next load. A signed-in reader's dismissals are cookie-scoped
too: storing them server-side would put a marketing preference on
`user_preferences`, and Part 26.4's page already holds the one preference
that matters (whether to be told about Plus at all, 25.6).

### 25.3 Where it is allowed to be persistent

Exactly two places may show the Beacon+ mark on every visit without a budget
or a dismissal: the header control (Part 19.5) and the tier card on the tools
hub (Part 19.5). Both are navigation, both are small, both are where a reader
would look for a product's paid half. Nothing else is exempt.

### 25.4 The placement registry: `lib/billing/promo-placements.ts`

Every place a promotion may appear is a row in a readonly array, so the admin
page (Part 19.6, `/admin/billing/promotions`) can list, count and switch each
one, and so the test can prove every one sells a real feature.

```ts
type PromoPlacement = {
  id: string;                 // "lineups.apply", dot-separated, surface first
  surface: string;            // human label of the page, for the admin list
  variant: "locked" | "strip" | "card" | "panel" | "disclosure";
  featureKey: FeatureKey;     // what it sells; the pitch comes from the catalog
  body?: string;              // optional second sentence, overrides the story's first sentence
  order: number;              // render order within a page, for the budget
};
```

The launch list. Each row names the file the placement lives in, so the
implementer is not choosing.

| id | surface (file) | variant | feature |
| --- | --- | --- | --- |
| `lineups.apply` | Lineups optimiser panel, the Apply control (`app/leagues/[id]/lineups/`, the optimiser panel component) | locked | `beacon_link.action.set_lineup` |
| `lineups.swap` | Lineups, each listed move's "Make this change" | locked | `beacon_link.action.swap_starter` |
| `lineups.cuts` | Lineups cut list, "Drop" | locked | `beacon_link.action.add_drop_free_agent` |
| `lineups.waivers` | Lineups free agent panel, "Claim" | locked | `beacon_link.action.submit_waiver` |
| `lineups.rail` | Lineups right rail | card | `beacon_link.access` |
| `trade_ideas.propose` | Trade Ideas, "Propose this trade" beside the verdict | locked | `beacon_link.action.propose_trade` |
| `trade_ideas.strip` | Trade Ideas, under the verdict heading | strip | `beacon_link.action.propose_trade` |
| `transactions.pending` | Transactions feed, a pending trade addressed to the reader | locked | `beacon_link.action.respond_trade` |
| `league.trades_tab` | League nav "Trades" entry for a non-member (renders the panel on the route) | panel | `beacon_link.trades_inbox` |
| `faab.bid` | FAAB calculator result, "Place this bid" | locked | `beacon_link.action.submit_waiver` |
| `faab.strip` | FAAB calculator, under the result heading | strip | `beacon_link.action.submit_waiver` |
| `schedules.matchup` | Matchup detail, under the lineup heading | disclosure | `notifications.email` |
| `power_pulse.strip` | Power Pulse panel, under the odds table heading | strip | `notifications.email` |
| `overview.chat` | League overview, the chat panel's compose control | locked | `beacon_link.action.post_message` |
| `dashboard.card` | `/my-beacon` rail | card | `notifications.email` |
| `manager_pulse.footer` | Manager Pulse report, after the last section | strip | `notifications.email` |
| `account.notifications` | `/my-beacon/notifications` for a Free reader | panel | `notifications.email` |
| `account.beacon_link` | `/my-beacon/account`, where the Connect Sleeper card would be | panel | `beacon_link.access` |

Rules the registry test (`lib/billing/promo-placements.test.ts`) enforces:
ids unique and grammatical; every `featureKey` exists in the registry; no
two placements on one surface share a variant other than `locked`; every
`beacon_link.*` placement is on a surface that exists in the Beacon Link plan
(Parts 4 and 7), so a promotion for an action never appears where the action
itself would not.

Switching a placement off is `settings.promotion.placements[id] = false`, a
toggle on the admin page. Adding a placement is a registry entry plus the
component at the call site, then a deploy.

### 25.5 Copy rules, and the test that enforces the one that matters most

The register is premium, which here means quiet. Concretely, and checked by
`lib/billing/promo-copy.test.ts` over every pitch, story, placement body,
`/plus` page string, notification email template and admin-saved override:

- Present tense, second person, one outcome per sentence. "Apply the lineup
  our optimiser found, on Sleeper, in one press."
- No exclamation marks. No "unlock", "supercharge", "level up", "elevate",
  "game-changing", "seamless", "powerful" or any word on the site-wide
  writing standard's banned list. No urgency ("limited time", "act now",
  "don't miss") except a real code expiry date stated as a date.
- The price appears once per unit, as the price phrase, never struck through
  against another number.
- The mark appears once per unit.
- ABSOLUTE RULE, THE MECHANISM BAN: none of the following strings, case
  insensitive, whole word or as a prefix: token, session, cookie, credential,
  password, passcode, log in, login, sign in to Sleeper, api, endpoint,
  graphql, mutation, query, header, bearer, scrape, scraping, bot,
  automation, automate, script, headless, browser extension, reverse,
  oauth, webhook, integration, sync your account, connect your credentials.
  Copy says WHAT happens and WHERE ("your lineup is set on Sleeper"), never
  HOW. The denylist lives in `lib/billing/promo-copy.ts` as
  `MECHANISM_DENYLIST` with `assertNoMechanism(text): string | null`
  returning the offending word, and the admin save path for pitches,
  stories, placement bodies and the pricing headline calls it and refuses the
  save naming the word. The Part 5.3 link-time consent copy is exempt by
  file, because it must be honest about what we hold; it is reviewed by hand.
- "Connect Sleeper" is the verb for linking (Part 8.1) and is allowed; what
  follows it is an outcome, never a description of the connection.

### 25.6 Accessibility of the promotions

- Nothing in a promotion is `aria-hidden` except the decorative beam. The
  mark's text is "Beacon Plus"; CSS renders it as "Beacon+" through a
  `::after` on a span whose text is "Beacon" and whose `aria-label` is
  "Beacon Plus", the one permitted use of `aria-label` on a text span here,
  because the visual mark is a brand form of the same words and not a
  different word.
- A locked control is a real button, focusable, with the tier in its name,
  and its dialog returns focus to it on close. It is never `disabled`, because
  a disabled button is skipped by a screen reader's tab order and the reader
  would never learn the action exists.
- A strip's Dismiss button is named "Dismiss the Beacon Plus note about
  <feature>", and after dismissal focus lands on the nearest following
  heading, announced.
- A disclosure is a button with `aria-expanded` and `aria-controls`, and its
  region is inline in reading order directly after the button.
- The accessibility review sub-agent confirms, on every surface that carries
  a placement, that the promotion never sits between a heading and the data
  it introduces (it follows the heading and precedes the data only in the
  `strip` variant, which is one line and is itself labelled).
- A reader may turn every non-control promotion off for their account: a
  checkbox on `/my-beacon/notifications`, "Show me notes about Beacon Plus
  inside the tools", stored as `notification_preferences.kinds.plus_notes`
  (default true). Off, strips, cards and disclosures render nothing; locked
  controls and panels stay, because they are the feature's place. This is
  the one server-side promotion preference and it is a courtesy, not a
  marketing consent record.

### 25.7 Measuring, so "not in your face" can be checked

Migration 0295, `promotion_impressions`: `(placement_id text, day date,
shown int, dismissed int, clicked int, primary key (placement_id, day))`,
service-role only. `record_promo_event(p_placement text, p_event text)` is a
SECURITY DEFINER RPC granted to `anon` and `authenticated` (named, per the
grants rule) that increments one counter for today's Eastern date; it takes
no user id and stores none. The server component records `shown` at render;
the dismiss island records `dismissed`; the "See Plus" link is a Next `Link`
with an `onClick` that records `clicked` and lets navigation proceed. The
admin promotions page shows the three numbers per placement for the last 30
days and the dismissal rate, which is the number the owner watches: a
placement dismissed by most readers who see it is in their face, whatever
its styling, and gets switched off or moved.

---

## Part 26. Email notifications

A paid feature (`notifications.email`, one key, Part 14.1) that sends a
member email about THEIR OWN leagues when something they would want to know
has happened or is about to. One master switch per reader, one checkbox per
kind, one unsubscribe link in every message, and a hard rule that the
notification system observes the site's models and never runs them.

### 26.1 What a member gets, in one paragraph

On Tuesday morning, after the week settles, an email that says whether they
won or lost, by how much, who carried them, whether the best lineup they had
would have changed the result, and where that leaves their record and their
playoff odds. On Thursday, a preview of this week's matchup with the win
probability the Schedules board shows. On Sunday morning, only if there is a
problem, an alert that a starter is on bye, out, or a slot is empty, and how
many points the bench would add. The evening before waivers run, the FAAB
budget they have left and the four free agents our engine rates highest FOR
THEIR ROSTER, with a bid range for each. When a trade offer lands in their
Sleeper inbox (a connected reader only), the offer and our verdict, with the
Accept and Reject controls one link away. When a trade goes through in their
league, both sides and what it did to the balance of the league. When
somebody views the league and Power Pulse recomputes, and their projected
finish has moved by more than a little, a note saying so and why. And a
Monday morning digest of all of it, if they would rather have one email than
several. Every one of these can be turned off separately, all of them can be
turned off at once, and any league can be muted.

### 26.2 The kinds: `lib/notifications/kinds.ts`

A readonly registry, the same shape of thing as the feature registry:

```ts
type NotificationKind = {
  key: string;                       // "matchup_result"
  name: string;                      // "Your matchup result"
  description: string;               // one sentence on the preferences page
  group: "matchups" | "roster" | "trades" | "league" | "summaries";
  defaultOn: boolean;
  urgency: "now" | "normal";        // "now" ignores quiet hours (a trade offer); "normal" waits for 7am
  schedule: "event" | "scheduled";   // produced by a hook, or by the dispatcher on a window
  batch: "none" | "daily";           // daily: pending events of this kind for one reader become ONE email
  requiresBeaconLink: boolean;       // needs a connected Sleeper account (the inbox read, Part 1.4)
  dedupe: (input) => string;         // pure, documented per kind below
};
```

| key | group | default | urgency | schedule | batch | needs link | dedupe key |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `matchup_result` | matchups | on | normal | scheduled (Tuesday) | none | no | `league:season:week:roster` |
| `matchup_preview` | matchups | on | normal | scheduled (Thursday) | none | no | `league:season:week:roster` |
| `lineup_alert` | roster | on | now | scheduled (Sunday morning, Thursday evening) | none | no | `league:season:week:roster:<hash of the problem set>` |
| `waiver_reminder` | roster | on | normal | scheduled (evening before waivers run) | none | no | `league:season:week:roster` |
| `roster_news` | roster | on | normal | event (news ingestion) | daily | no | `league:roster:day` (batched) |
| `trade_offer` | trades | on | now | event (inbox poll) | none | YES | `league:transaction_id` |
| `trade_offer_resolved` | trades | on | normal | event (inbox poll) | none | YES | `league:transaction_id:status` |
| `league_trade_alert` | league | on | normal | event (transaction sync) | none | no | `league:transaction_id` |
| `power_pulse_shift` | league | on | normal | event (Power Pulse recompute) | none | no | `league:season:through_week:roster` |
| `beacon_link_receipt` | trades | OFF | now | event (action log) | none | YES | `action_log_id` |
| `weekly_digest` | summaries | OFF | normal | scheduled (Monday 8am) | none | no | `season:week:user` |
| `plus_notes` | (not an email; the promotion preference of Part 25.6) | on | | | | | |

What each says, and where every figure comes from. Every sentence is a
deterministic template that cites a figure in the payload (the Trade Ideas
rule); a null figure means the sentence does not fire. No language model
writes a notification in V1; if BEAM's voice is wanted later, the prompt is a
DB-backed, admin-editable setting per the site's AI rule, and that is a plan
revision.

- `matchup_result`: the reader's score and the opponent's, from
  `league_matchups` where `is_final`; the margin; the top scorer on each side
  with points; the best lineup that was available (the one-sided comparison,
  `lib/league-lineups/build.ts grade()` on actuals over the same candidate
  pool, exactly as the Lineups page does on a settled week, including the
  IDP exclusion and the official-total-plus-deficit arithmetic); whether that
  lineup would have won ("You lost a game your own bench would have won" is
  the loudest sentence in the product and appears when it is true); the
  record now; the Power Pulse playoff odds now from
  `league_power_pulse_cache`, with "as of <formatEastern(generated_at)>" and
  only when `through_week >= week`, otherwise the sentence is omitted rather
  than stale. Link: the matchup page.
- `matchup_preview`: opponent, both projected totals and the win probability
  from `league_power_pulse_cache.weekly` for the week (the same figure the
  Schedules board reads; absent, the email says the projection is not built
  and links the board), the reader's two highest-projected starters and the
  opponent's, the implied team total context if `lib/nfl-game-environment.ts`
  has one. Link: the matchup page and the Lineups page.
- `lineup_alert`: from `lib/league-lineups/build.ts` on the reader's roster
  for the live week: every started slot holding a "0" placeholder, a player
  on bye, or a player whose `players.metadata.sleeper.injury_status` is
  `Out`, `IR`, `Doubtful` or `Suspended`; and the optimiser's
  `pointsLeftOnBench` when it exceeds `settings.thresholds.lineupBenchGap`
  (default 8.0). Fires ONLY when at least one problem exists. The dedupe key
  hashes the sorted problem set, so a second alert fires only if a NEW
  problem appears (a Saturday injury), never twice for the same one. Sent at
  the Sunday morning window and again at the Thursday evening window for a
  Thursday starter only (the window checks `players` game day through
  `nfl_game_odds` when present). Link: the Lineups page; a connected member's
  link lands on the optimiser with Apply one press away.
- `waiver_reminder`: the league's waiver settings from `leagues.metadata`
  (`waiver_type`, `waiver_budget`, `waiver_day_of_week`, `daily_waivers`,
  `waiver_clear_days`, and the roster's remaining budget from
  `rosters.metadata.settings.waiver_budget_used`); the top
  `settings.waiverPickups` (default 4) free agents for THIS roster by
  `lib/faab/marginal.ts` wins added, each with the calculator's bid range
  from `lib/faab/calculate-faab.ts` and one template sentence naming the
  slot they would improve. Sent at the evening window before the league's
  processing day. Sleeper's `waiver_day_of_week` is an integer; whether 0 is
  Sunday or Monday is CONFIRMED in MB-T104 against a league whose waivers are
  known to run on Wednesday, recorded here before the kind ships, and mapped
  in one function `waiverProcessingWeekday()` with a test. `daily_waivers`
  leagues get the reminder Tuesday evening only. Leagues with no waivers
  (`waiver_type` free-agent-only) never get it. Link: the Lineups free agent
  panel, and the FAAB calculator with the league selected.
- `roster_news`: `news_items` rows ingested since the last digest whose
  resolved player is on the reader's roster, injury and transaction
  categories only (`news_categories`), batched into one daily email at the
  morning window with one line per item (headline, source display name,
  link). MB-T105 verifies the player linkage the ingestion writes; if news
  items do not carry a resolved player id today, the kind ships when they
  do and the preferences page does not list it until then (a kind is listed
  only when `notification_settings.kinds[key].enabled`).
- `trade_offer`: a pending trade addressed to the reader's roster from the
  authenticated inbox read (`lib/beacon-link/trades-inbox.ts`, Part 4.1,
  Part 1.4), polled by the dispatcher for connected members with the kind on
  every `settings.inboxPollMinutes` (default 15), through the Sleeper token
  bucket like every other Sleeper call. Content: both sides by name and
  position, the `TradeVerdict` (value and wins, Part "Trade Ideas"), and a
  link to `/leagues/[id]/trades` where Accept and Reject are the Beacon Link
  actions. `urgency: now`, because an offer can expire.
- `trade_offer_resolved`: the reader's OWN proposal was accepted, rejected or
  countered, from the same poll (a transaction the reader proposed that left
  `pending`). Content: which, and the verdict of what went through.
- `league_trade_alert`: a completed trade in the reader's league not
  involving them, from the transaction sync hook (26.3), with the Signal
  Check verdict (`lib/would-you-rather/grade.ts`'s wrapper over
  `analyzeLeagueTrades`, which already exists for exactly this read) and both
  sides. Only for transactions whose `created_at_sleeper` is within 48 hours,
  so a first capture of a league's history never emails a season of trades.
- `power_pulse_shift`: fires from the hook in `refreshPowerPulse` after a
  SUCCESSFUL write (26.3). The dispatcher compares the reader's roster's new
  `pulse_rank` and `playoff_odds` with the values in the payload of the LAST
  SENT `power_pulse_shift` delivery for that (league, roster) (or, when none,
  with the previous cache row's values carried in the event payload by the
  hook). It sends when `abs(rank delta) >= settings.thresholds.powerPulseRankDelta`
  (default 2) OR `abs(odds delta) >= settings.thresholds.powerPulseOddsDelta`
  (default 0.15). Content: the two figures before and after, the
  `through_week`, and the top driver from `drivers` in template form. At most
  one per roster per `through_week` by the dedupe key.
- `beacon_link_receipt`: after a Beacon Link action's outcome is logged
  (`sleeper_action_log`, Part 6.3): what was done, on which league, when, and
  a link to the action log. Default off; a member who wants a paper trail
  turns it on.
- `weekly_digest`: Monday 8am Eastern: for every unmuted league, the record,
  the standing, the Power Pulse rank and odds as of the cache, last week's
  result in one line, this week's opponent, and any pending trade offer.
  Default off, because the individual kinds already cover it; a reader who
  turns it on typically turns the others off, and the page suggests that in
  one sentence.

### 26.3 Architecture: producers, a queue, one dispatcher

```
producers  -->  notification_events (0291)  -->  dispatcher cron  -->  notification_deliveries (0292)  -->  Resend
```

PRODUCERS are of three kinds, and none of them sends anything:

(a) HOOKS inside existing writers. Each is ONE call to
`emitNotificationEvent({ kind, leagueId, rosterId?, userId?, dedupeKey, payload })`
in `lib/notifications/emit.ts`, which inserts a `pending` row (ignoring a
dedupe conflict) and NEVER throws: it catches, logs one warn line with the
kind and league, and returns. It is awaited (so the row exists before the
caller's response) but wrapped, so a notification failure cannot fail a
league sync. The hooks:
  - `lib/league-pulse.ts`, after `league_transactions` rows are persisted:
    for each NEW completed trade within 48 hours, `league_trade_alert`.
  - `lib/league-power-pulse.ts refreshPowerPulse`, after a successful cache
    write: one `power_pulse_shift` event per roster whose previous row
    existed, carrying the previous and new `pulse_rank` and `playoff_odds`.
  - `lib/beacon-link/action-envelope.ts`, after the outcome log row: one
    `beacon_link_receipt` event.
  - The news ingestion, after a `news_items` row with a resolved player id is
    written: one `roster_news` event per league roster holding that player
    (resolved by the dispatcher, not the ingestion, so the ingestion does one
    insert per item: `rosterId` null, `payload.playerId` set).

(b) SCHEDULED PRODUCERS inside the dispatcher, each a pure "is it time"
check against a window in `notification_settings` resolved in
America/New_York through Intl (the league relay pattern, for the same
reason: a UTC cron hour shifts twice a year), followed by a bounded pass over
SUBSCRIBED ROSTERS: `matchup_result`, `matchup_preview`, `lineup_alert`,
`waiver_reminder`, `weekly_digest`. A scheduled producer inserts events with
`not_before` set to the window and its dedupe key, so a dispatcher tick that
runs twice in one hour produces one email.

(c) THE INBOX POLL, for connected members with `trade_offer` or
`trade_offer_resolved` on: `lib/notifications/inbox-poll.ts` reads each
connected member's pending trades through the Beacon Link read module,
diffs against the last poll's ids held in `notification_preferences.kinds`?
No: against `notification_deliveries` by dedupe key, so it needs no extra
state. Every request passes through `lib/sleeper-budget.ts`. A failed read is
not evidence: it produces no event and no "resolved" inference.

SUBSCRIBED ROSTERS are computed once per tick by
`lib/notifications/subscribers.ts loadSubscribedRosters(kind)`: members whose
entitlements include `notifications.email` (the resolver, Part 14.4), whose
`email_enabled` is true, whose `kinds[kind]` is not false (default applies),
joined to `rosters.owner_user_id` or `co_owners` by the saved
`sleeper_user_id` through a NEW batch function on the one identity module,
`lib/sleeper-handle/resolve.ts resolveViewersBySleeperUserIds(ids)` (the
guard test allows the read there and nowhere else), excluding
`muted_league_ids`. A member with no saved handle is subscribed to nothing
and the preferences page says so in words with the link to save one.

DATA FRESHNESS, and the rule that governs it. ABSOLUTE RULE: THE NOTIFICATION
SYSTEM NEVER RUNS A MODEL. It never calls `refreshPowerPulse`,
`refreshPositionalWar`, `refreshManagerLedger` or `calculateLeaguePowerRankings`,
directly or through `pulseLeagueDerived`. Those are on-demand-only through the
league deep view, for the scaling reasons their own sections state, and a
cron that iterated leagues to recompute them would be exactly the thing those
rules forbid. What the dispatcher MAY do is ask for a league's RAW data to be
brought up to date through the existing budgeted queue: on the Monday night
window it enqueues one `league_sync_jobs` row per subscribed league (the
worker runs the capture set with matchups, under the site's token bucket and
the single-drainer lease), and the Tuesday `matchup_result` pass then reads
`league_matchups` rows that are `is_final`. A league whose sync has not
completed by the window is skipped that week with `skip_reason = 'stale'`,
never emailed from old rows. Power Pulse figures in any email are read from
the cache with their `generated_at` stated, and omitted when older than the
week in question.

THE DISPATCHER: `/api/cron/notifications`, every 10 minutes, registered in
`CRON_JOBS` and `vercel.json`, `CRON_SECRET`-gated, `maxDuration` 300. In
order, each step bounded:

1. `notification_settings.enabled` false: record a `skipped` run and return.
2. Run each scheduled producer whose window is open (b), and the inbox poll
   (c) if `inboxPollMinutes` have passed since its last run
   (`notification_settings` carries `lastInboxPollAt`, written by the
   dispatcher).
3. `try_claim_notification_events(settings.dispatchBatchSize)`.
4. For each claimed event, RESOLVE the recipient(s): `user_id` if set, else
   the subscribed viewers of `(league_id, roster_id)`, else every subscribed
   viewer of the league (for `league_trade_alert`). For each recipient, in
   order, and each a `skip_reason`: `not_entitled` (re-resolved NOW, so a
   lapsed member queued last night gets nothing), `master_off`, `kind_off`,
   `league_muted`, `suppressed` (the address is on `email_suppressions`,
   Part 31.5), `no_address` (the auth user has no confirmed email), `stale`
   (the event's `occurred_at` is older than `staleAfterHours`, default 36,
   and the kind is not a digest). The daily cap is applied in step 5, not
   here, because it rolls up rather than drops.
5. ROLL UP, NEVER DROP (Part 31.6). Pending `daily` events for one recipient
   and kind become one render. Then, for every kind, if one recipient has
   more than `rollupThreshold` (default 2) events of the same kind pending in
   this pass (a manager in nine leagues on a Tuesday), they become ONE email
   for that kind with one section per league, in the order of the reader's
   league list, using the kind's `buildRollup` builder. Only after roll-up is
   the daily cap (`dailyCapPerUser`, counted against
   `notification_deliveries` since midnight in the reader's own zone)
   applied; an email that would exceed it is held with `not_before` set to
   the next morning and `skip_reason` left null, never discarded. `urgency:
   now` kinds are exempt from the cap.
6. INSERT the `notification_deliveries` row (the guarantee, Part 15.18),
   then render (`lib/email/notification-emails.ts`, 26.5), then send through
   `lib/email/send.ts` with the unsubscribe headers (26.6). A unique
   violation on the insert is `duplicate` and stops. A send failure deletes
   the delivery row and marks the event `failed` in the same transaction;
   after `maxAttempts` (5) it stays `failed` for the admin ledger.
7. Mark the event `sent` or `skipped` with its reason; record the run.

Quiet hours: an event of `urgency: normal` claimed between
`quietHours.start` (23) and `quietHours.end` (7) Eastern for a reader with
`quiet_hours` on has `not_before` pushed to 7am and is released, not sent.
`urgency: now` ignores quiet hours.

### 26.4 What the reader controls: `/my-beacon/notifications`

Signed-in only. For a reader WITH `notifications.email`:

- The master switch: a native checkbox in a label, "Email me about my
  leagues", saved on change by a server action (same-origin, own row upsert),
  with a `role="status"` line "Saved. Notifications are on." The whole page
  below it is inside a `<fieldset>` that is `disabled` when the master is
  off, so the state of the controls says the state of the system.
- One `<fieldset>` per group (Matchups, Your roster, Trades, Your league,
  Summaries) with a `<legend>`, one native checkbox per kind with its name
  and description, defaults from the registry. A kind that
  `requiresBeaconLink` for a reader who is not connected renders its checkbox
  with a following sentence "Needs a connected Sleeper account" and a link to
  the account page; the checkbox still saves, so the preference is ready the
  day they connect.
- "Leagues" fieldset: every league the reader is in (from the saved handle),
  each a native checkbox "Email me about <league name>", checked unless
  muted, with the league logo through `components/league-logo.tsx` in its
  own column per the saved-handle rules.
- "Quiet hours": one checkbox, "Hold non-urgent email between 11pm and 7am
  Eastern", with the sentence that a trade offer still arrives at once.
- "Notes about Beacon Plus inside the tools": the Part 25.6 checkbox.
- "Where we send it": the account email, read-only text, with "Change it on
  the account page" as a link. No address is stored on this system; the
  dispatcher reads it from auth at send time.
- "What we have sent you": the last 30 rows of `my_notification_history` as
  a real table (date through `formatEastern`, kind, subject, league), so a
  reader can see exactly what left and when.

For a reader WITHOUT the feature: the same headings, the list of kinds as
plain text with their descriptions (so they know what they would get), and
the `account.notifications` promotion panel (Part 25.4) in place of the
controls. No disabled checkboxes: a control that does nothing is the thing
this site does not ship.

The account page (`/my-beacon/account`) gains a "Notifications" line under
the Membership and purchases panel (Part 19.2) linking here, and the
membership page's Notifications line does the same.

### 26.5 The emails: `lib/email/notification-emails.ts`

One `build<Kind>Email(payload)` per kind, pure, returning `{ subject, html,
text }`, tested on wording with a fixture payload each, built in the branded
shell (`buildBrandedEmail`), every date and time through `formatEastern`.
Structure of every one, in order: the subject line names the league and the
thing ("Won by 12.4 in Dynasty Degenerates, week 3"); an H1 that repeats it;
THE FIGURE (one number, large, one text node); two to five template
sentences; a primary button to the page on the site; then the footer common to
every notification: "You are getting this because email notifications are on
for your Beacon Plus membership." with "Manage what you get" linking
`/my-beacon/notifications` and "Unsubscribe from all" linking the one-click
route (26.6). Plain text alternative always, generated from the same parts.
Team names are the reader's own league's names (this is their league; the
Would You Rather anonymity rule does not apply, and `league_users` is read
for display names as the deep view does). No mechanism words, by the Part
25.5 test, which runs over these templates too.

`lib/email/send.ts` gains an optional `headers?: Record<string, string>`
field passed through to Resend's `headers` (MB-T091), used only by this file.

### 26.6 Unsubscribe

Every notification carries `List-Unsubscribe: <https://ffbeacon.com/api/notifications/unsubscribe?t=TOKEN>`
and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), and the
footer link to the same URL.

`app/api/notifications/unsubscribe/route.ts`: `GET` renders a small page (no
session needed) with one sentence and one `POST` form button "Turn off all
notification email", because a mail client's link scanner performs GETs and a
GET must not change state. `POST` (from the form, or from a mail client's
one-click with the `List-Unsubscribe=One-Click` body) looks up
`notification_preferences` by `unsubscribe_token` with the service client,
comparing in SQL (the token is the only key), sets `email_enabled = false`,
writes an audit line into `notification_deliveries`? No: into
`billing_audit_log` with `action = 'notifications.unsubscribe'`, `actor` null
and `subject_id` the user, and renders "Done. You will get no more
notification email. Membership and receipt emails still arrive." with a
"Turn it back on" link to `/my-beacon/notifications` (which needs sign-in).
An unknown or malformed token renders the same page with "This link is no
longer valid" and changes nothing. Rate limit `notifications-unsubscribe`, 30
per hour per IP, claimed after the shape check. The token is never in a log
line.

### 26.7 Settings and the admin page: `/admin/notifications`

`notification_settings` (migration 0293), defaults in
`lib/notifications/default-settings.ts`, validated by
`lib/notifications/settings.ts`, coverage test asserting every key has a
control:

```ts
{
  enabled: false,                        // THE KILL SWITCH for the dispatcher
  dispatchBatchSize: 200,
  dailyCapPerUser: 6,
  staleAfterHours: 36,
  maxAttempts: 5,
  quietHours: { start: 23, end: 7 },     // Eastern
  inboxPollMinutes: 15,
  lastInboxPollAt: null,                 // written by the dispatcher, shown read-only
  windows: {                             // Eastern weekday (0 Sunday) and hour
    leagueSync:     { weekday: 1, hour: 23 },   // Monday night: enqueue subscribed leagues
    matchupResult:  { weekday: 2, hour: 8 },
    matchupPreview: { weekday: 4, hour: 9 },
    lineupAlertSunday:   { weekday: 0, hour: 9 },
    lineupAlertThursday: { weekday: 4, hour: 17 },
    waiverReminderHour: 19,              // the evening before the league's processing day
    rosterNewsDigest: { hour: 8 },       // daily
    weeklyDigest:   { weekday: 1, hour: 8 },
  },
  thresholds: {
    powerPulseRankDelta: 2,
    powerPulseOddsDelta: 0.15,
    lineupBenchGap: 8,
  },
  waiverPickups: 4,
  kinds: {                               // per kind: may the site send it at all, and the default for a new reader
    matchup_result: { enabled: true, defaultOn: true },
    // ... every key in the registry; the settings test fails on a missing one
  },
}
```

`/admin/notifications`: the settings form; a "Queue" panel (pending, claimed,
failed counts, the oldest pending age, "Reprocess failed"); a "Sent" ledger
(last 200 deliveries: time, kind, subject, the recipient as their handle or
user id, NEVER an address); a "Skipped" breakdown by reason for the last 7
days (the number the owner watches: a large `daily_cap` count means the cap
is too low or a kind too chatty); and "Send me a sample" per kind, which
renders the kind with fixture data to the ADMIN'S OWN address only. The
cron health page lists `notifications` beside the others.

### 26.8 Rules, restated as absolutes

- The notification system OBSERVES. It never triggers Power Pulse, Positional
  WAR, the Manager Ledger or the trade-value rankings, and never imports
  `pulseLeagueDerived`. Raw-data freshness comes only from the existing
  budgeted `league_sync_jobs` queue.
- One email per (reader, kind, dedupe key), guaranteed by the unique index
  on `notification_deliveries`, the row inserted BEFORE the send.
- Entitlement, the master switch, the kind switch, the league mute and the
  daily cap are re-checked AT SEND TIME, not at enqueue time.
- Transactional emails (Part 21) ignore the master switch. Notification
  emails obey it. The two live in different files.
- Every scheduled window is a setting resolved in America/New_York. The cron
  expression is `*/10 * * * *` and carries no product meaning.
- Addresses come from auth at send time and are stored nowhere on this
  system; logs carry masked addresses only (the existing `send.ts` rule).
- Every Sleeper request made on behalf of notifications passes through
  `lib/sleeper-budget.ts`; the inbox poll is the only such request the
  dispatcher makes itself.
- No sentence in a notification describes how an action reaches Sleeper
  (Part 25.5), and no sentence is written by a language model in V1.
- Nothing fires on the calendar. Every kind fires on a real row in a real
  league, and the only "season" any producer knows is the league's own
  status (Part 26.9).

### 26.9 League type decides the calendar, not the month

ABSOLUTE RULE: NO PRODUCER, POLL OR SENTENCE CONSULTS THE MONTH. A redraft
league is dormant from its championship to its next draft; a dynasty or
keeper league is never dormant, and the site has many dynasty readers. So
every notification is produced from something that HAPPENED in a league, and
"nothing happened" is the only quiet there is:

- `matchup_result`, `matchup_preview`, `lineup_alert` and `power_pulse_shift`
  fire only when a league has matchup rows for the week in question (a
  schedule Sleeper has published, a week that has settled) or a fresh Power
  Pulse row. A league with no schedule produces none of them, in any month,
  for any type. Their weekday windows (Tuesday, Thursday, Sunday) are
  windows within a week that HAS games, never a season calendar.
- `waiver_reminder` fires when the league's waiver settings say waivers
  process and the league's Sleeper `status` is `in_season`, or, for a league
  with offseason waivers on (dynasty leagues commonly run them), when the
  league has processed a waiver claim in the last 21 days. It never
  consults the month.
- `trade_offer`, `trade_offer_resolved`, `league_trade_alert` and
  `roster_news` run all year for every league. The inbox poll's cadence is
  activity-based (31.8), never date-based. Dynasty trades in March are the
  reason.
- `weekly_digest` sends when it has something to say and is skipped with
  `nothing_to_say` otherwise (31.1).

COPY. Wherever the product speaks about quiet periods it speaks about LEAGUE
TYPE, and when it does not know the reader's mix it explains both. The three
sentences and the `readerLeagueMix` helper are in Part 31.1; the surfaces are
the notifications page, the pause control, the sales page's notifications
section, the FAQ entry "Will I get emails in the offseason?" (answer: "If
your leagues are redraft, nothing between the championship and the next
draft. Dynasty and keeper leagues run all year and so do their emails."), and
the digest's own footer. The word "offseason" is never used on its own; it is
always "the redraft offseason" or "between the championship and the next
draft". `lib/notifications/copy.test.ts` greps the templates for a bare
"offseason" and fails on one.

---

## Part 27. The Beacon Plus pages

The owner asked for very nicely designed informational and walkthrough pages,
before and after purchase: what the current tier does, what other tiers add,
everything in one comparison table, and a premium sales page. Five routes,
three shared components, one copy module.

### 27.1 `/plus`, the sales page

Public (a guest can read it; joining needs an account, and every Join button
for a guest reads "Sign in to join" and carries `next=/plus`). 404 when
`billing_settings.enabled` is false. Sections in reading order, each a
`<section aria-labelledby>` with one h2:

1. HERO. The eyebrow "FF Beacon", the H1 from `settings.pricing.headline`
   ("Everything free stays free."), the subhead from settings, the Beacon+
   mark rendered large in the beam gradient with the accessible text "Beacon
   Plus", one paragraph of what a membership is (from `plus-copy.ts`), and
   two links styled as buttons: "See what Plus does" (anchor to section 2) and
   "Join Plus" (anchor to section 4). No image. No animation beyond the
   gradient, which is static.
2. WHAT A MEMBERSHIP ADDS. The registry's `headline` features (at most four,
   never Beacon Link, Part 14.1), each an h3 with the pitch, the story
   paragraph, and an EXAMPLE FIGURE rendered as real HTML and fenced the way
   the Manager Ledger's example is (the words "Example" in the heading, an
   "Example" badge, invented team names that cannot be read as real ones,
   and a `<caption>` where it is a table): a sample Tuesday result email, a
   sample waiver reminder with four picks, a sample Power Pulse shift note.
   Which features are headlines is the owner's choice in the panel, up to
   `settings.pricing.headlineMax`; the page renders whatever is ticked, and
   renders the section with one feature as comfortably as with four.
3. ACT ON SLEEPER FROM FF BEACON. The Beacon Link section, deliberately third
   (Part 12.7: included, listed, never the headline). An h2, one paragraph
   saying that a member can connect their Sleeper account and carry out what
   our tools recommend without leaving the page, then a `<ul>` of the
   Beacon Link actions in the reader's tier (or the cheapest priced tier
   that has them), each by OUTCOME: "Apply the lineup the optimiser found",
   "Place the bid the FAAB calculator suggests", "Send a trade from Trade
   Ideas", "Accept or reject an offer with our verdict beside it", "Post to
   your league's chat and start a poll". Not one sentence about how. Hidden
   entirely while `beacon_link_settings.enabled` is false; nothing on this
   page ever says "coming soon".
4. PRICING. The interval toggle and the tier cards (Part 19.1). The Free
   card first. Each paid card's button list per enabled provider, the trial
   sentence when a trial applies (Part 23.3), the renewal sentence, and the
   final-sale sentence with its link.
5. COMPARE EVERYTHING. The comparison table (Part 19.1), with a "See the full
   comparison" link to `/plus/compare` when the marketable feature count
   exceeds 20 (the table on this page then shows the first 20 in catalog
   order and the link).
6. TRY IT FIRST. Shown only when a public priced tier has an effective trial
   or `settings.codes.enabled` is true: the trial sentence, and "Have a
   code?" linking `/plus/redeem`.
7. KEEP FF BEACON FREE FOR EVERYONE. One honest paragraph: the free tools stay
   free, a membership is what pays for the parts that cost real money to run,
   and a donation is still a gift and not a purchase, linking `/donate`.
8. ONE-TIME SERVICES. The Part 19.3 teaser: up to three product cards and a
   link to `/services`. Hidden when `purchases.enabled` is false.
9. QUESTIONS. A `<dl>` of eight questions from `plus-copy.ts`: Can I cancel
   (yes, one step, access to the end of the period); What happens to the free
   tools (nothing); Refunds (all sales final, case by case, link); Card,
   wallet, PayPal or Venmo (which are on, from settings); Tax (one sentence
   from Part 29.5); Is my Sleeper account safe (the outcome-level answer:
   you connect it yourself, you can disconnect it in one press, we only ever
   do what you press a button to do, and the consent screen says exactly what
   we hold; no mechanism); Can I choose which emails I get (yes, each one,
   any league); What does "on us" mean (a membership the owner gave you or
   you redeemed a code for, until the date shown).
10. THE PLAIN WORDS. The renewal sentence, the final-sale sentence, links to
    Terms, Privacy and the Refund Policy.

`?feature=<key>` from a promotion: the Part 19.1 status line at the top,
"You followed a link about <feature name>. It is included in <tier>.", focus
moved to it, and the matching row in the comparison table given
`aria-current="true"` and a visible marker so the reader can find it.

Metadata: title "Beacon Plus", description from the subhead. OG image
`/api/og/plus`, 1200x630, brand rules of the League Pulse OG section (dark
ground, the beam, Geist, the wordmark, the footer URL), showing the mark and
the headline.

### 27.2 `/plus/tour`, the walkthrough

"What you can do on FF Beacon, and what Plus adds." A long page, not a
carousel: a `<nav aria-label="Tour sections">` with an anchor per area, then
one `<section>` per area in the order a season runs: Rankings and players,
League Pulse (overview and rankings), Lineups, Schedules, Trade Ideas and
Signal Check, Waivers and FAAB, Notifications, Manager Pulse, Services. Each
section: an h2, two or three sentences on what the tool does TODAY (free,
from `plus-copy.ts`), an "Open it" link into the live tool (for a signed-in
reader with a saved handle, into their first league's matching page; otherwise
into the tool's entry page), then a `<ul>` "With Plus" of the paid features
that live on that surface (from the promo placement registry's surfaces
joined to the catalog, so the tour and the tools cannot disagree about where
a feature lives), each with its pitch and, for a signed-in reader, "You have
this" or "Included in <tier>". `?tier=<slug>` compares against a chosen tier
instead of the cheapest. The tour is linked from `/plus` (hero, "See what
Plus does" also anchors here on wide viewports? No: it anchors to section 2;
the tour is the "Take the full tour" link under section 2), from
`/my-beacon/membership` ("Take the tour"), and from `/plus/welcome`.

### 27.3 `/plus/compare`, the full comparison

The comparison table alone, every marketable feature grouped by area with a
group header row (`<th scope="rowgroup">`), every public priced tier as a
column, quotas in words, "Included" and "Not included" as text (never an icon
alone), and for a signed-in reader their own tier's column header suffixed
"(your tier)" with `aria-current`. A native `<select>` "Show area" filters
the rows client-side with the count announced in a `role="status"`. Printable
(a print stylesheet drops the header and footer). The same
`components/billing/tier-comparison.tsx` as 19.1, with `full` set.

The member's page (19.2) renders this component with `currentTierSlug` and
`linkFeatures` set, so each feature the reader holds is a link into the tool:
that is the "What your tier can do" panel, and it is why a member never needs
a separate "your features" list to be written.

### 27.4 `/plus/redeem`

Part 28.3's page. One `<form>`, one labelled input "Your code", one button
"Redeem", a `role="alert"` for errors and a `role="status"` for success,
the `?code=` prefill, "Sign in to redeem" for a guest with `next` carrying the
code. Below the form, one sentence on what a code is (a membership on us for
a stated time; it does not renew and does not need a card) and the
final-sale sentence, because a code holder may later pay.

### 27.5 `/plus/welcome`, after joining

The `success_url` of every subscription Checkout (Part 16.2, 17.1) and the
destination after a code redemption (`?redeemed=1`) and after an admin comp
is created (the `sendCompStarted` email links here). Signed-in only. In
order:

1. The success handling of Part 17.1 step 4 (retrieve, sync, or the
   "activating" live region). Failure states are honest: an `open` session
   that never completes ends with "Your payment is still processing; we will
   email you when your membership starts" and no tour.
2. Once the membership grants: an H1 "Welcome to Beacon Plus" (or "<tier
   name> is on" for a non-Plus tier), a `role="status"` line "Your <tier>
   membership is active" (or "on us until <date>"), and a `<ol>` "Three
   things to do first", each a link with a done state read from real data
   and marked "Done" in text when true: (a) "Save your Sleeper handle" if
   `loadSavedSleeperHandle` returns none, else Done with the handle shown;
   (b) "Choose which emails you get", linking `/my-beacon/notifications`,
   Done when a `notification_preferences` row exists; (c) "Connect Sleeper",
   linking the account page, shown only when `beacon_link_settings.enabled`
   and the tier holds `beacon_link.access`, Done when connected.
3. "What you can do now": the tier's features as links into the tools (the
   27.3 component with `linkFeatures`), grouped by area, each with its pitch.
4. "What the next tier adds", only when a public priced tier with a higher
   lowest price exists: that tier's features not in the reader's, each with
   its pitch, and a "Switch" link to `/my-beacon/membership`.
5. Links: "Take the full tour" (`/plus/tour`), "Manage your membership".

The welcome EMAIL (Part 21) links here with the subject "Welcome to Beacon
Plus", and the page is reachable later from `/my-beacon/membership` as "See
the welcome page again", so the walkthrough is never a one-time modal.

### 27.6 Design, stated so it is not reinterpreted

- Brand: dark ground (`#07070D` / `#0F0F1A`), purple `#A855F7` to cyan
  `#22D3EE` beam used ONLY for the mark, the hero H1's accent word, and the
  focus ring; Geist Sans for text, Geist Mono for prices and the eyebrow.
  Light theme through the site's existing tokens. Never gold, never DPC's
  ground.
- Type scale: the site's; the hero H1 at the largest step the site already
  has, never larger. Measure 60 to 72 characters for prose, tables in their
  own `overflow-x: auto` container, the body never scrolls horizontally.
- Whitespace does the work. Sections are separated by space, not by boxes;
  cards appear only where there is a genuine set of parallel things (tiers,
  services). Hairlines, not shadows.
- No dark patterns: no countdown, no invented scarcity, no pre-selected
  add-on, no "most popular" badge unless `settings.pricing.recommendedTier`
  is set by the owner (a slug; renders the words "Recommended" as text on
  that card and nothing else). The yearly interval may be the default only
  when every public priced tier has a yearly price, and the saving is stated
  in words beside the radio.
- Prices are one text node each, never struck through against another. The
  comparison is a real table. Every example figure is labelled as an example
  in words.
- Motion: none that conveys information; anything decorative respects
  `prefers-reduced-motion`.
- Copy: `lib/billing/plus-copy.ts` for every structural string, exported as
  constants and covered by the Part 25.5 denylist test and by
  `lib/copy-guard.test.ts` (no em or en dash, no curly quote, no ellipsis
  character, no exclamation mark), and read against the site-wide writing
  standard before merge. Feature pitches and stories come from the catalog
  (registry default, panel override); the headline and subhead from settings.
  Nothing on these pages describes how anything reaches Sleeper.

---

## Part 28. Comps, trials and codes: membership without a payment

The owner asked to be able to give any tier to anyone without a payment, to
let people try features, and to offer free trial days and coupons. Three
mechanisms, each for a different sentence, all landing in the same
`memberships` table so the resolver (Part 14.4) has one thing to read.

### 28.1 Comps: "give this person Plus until March"

Created only from `/admin/billing/members` (Part 19.6), one at a time or in
bulk. `createCompMembership({ userId, tierSlug, expiresAt, note })` in
`lib/billing/comp.ts`, a server action behind `requireAdmin` and the
same-origin guard:

1. Refuses when the user already has a PAID membership in a granting status
   (the panel says "already a paying member; change their tier on Stripe" and
   offers nothing), because a comp under a paid row would be invisible and
   confusing. A user with an existing COMP gets it extended or changed
   instead (the action detects and offers "Extend to <date>" or "Change to
   <tier>").
2. Inserts `memberships` with `provider = 'comp'`, `source = 'admin'`,
   `status = 'active'`, `tier_id`, `expires_at`, `current_period_end =
   expires_at` (so every surface that reads a period end reads the right
   date), `granted_by`, `note`.
3. Revalidates the entitlement tag, writes `billing_audit_log
   membership.comp` with the note, and sends `sendCompStarted` (Part 21),
   which is the welcome for a comp: what they have, until when, how to keep
   it, the link to `/plus/welcome`.

"Extend" moves `expires_at` and `current_period_end` (audit
`membership.comp_extend`). "Change tier" swaps `tier_id` (audit
`membership.comp_change`). "End now" sets `expires_at = now()`, `status =
'canceled'`, `ended_at` (audit `membership.comp_end`). Every one confirmed in
the house dialog (`desktopPlacement="center"`, a decision) with the person's
handle and the effect in the dialog text.

Expiry is passive and exact: the resolver treats a comp with `expires_at <=
now()` as not granting the instant it passes. The reconcile cron (Part 18.5)
gains a FOURTH sweep: comps past `expires_at` still `active` are set
`canceled` with `ended_at`, audited `membership.comp_expired`, and
`sendCompEnded` goes out unless a paid membership now grants. Three days
before (`compEndingReminderDays`), `sendCompEnding` goes out once with "Keep
Plus" linking `/plus`.

KEEPING PLUS AFTER A COMP. A comp holder who joins on `/plus` is allowed
through the checkout route (the Part 17.1 "already a member" 409 applies to
PAID granting memberships only). When the comp has more than 48 hours left,
the subscription is created with `subscription_data[trial_end]=<comp.expires_at
as a unix timestamp>` so their card is first charged the day the comp would
have ended, not today; Stripe requires `trial_end` at least 48 hours out,
which is why the threshold is 48 hours, and under it the subscription simply
starts now. On the first granting sync of that paid row, the comp row is
ended (`expires_at = now()`, `status = 'canceled'`, audit
`membership.comp_superseded`) so exactly one row grants. PayPal has no
`trial_end` equivalent, so a comp holder joining through PayPal is told, in
the provider choice, "Your PayPal membership starts today; your time on us
ends when it starts", and the comp is superseded the same way.

### 28.2 Trials: "the first 14 days are free"

A trial is a PAID membership that starts in `trialing`, which grants (Part
14.5). Two knobs, both settings: `billing_settings.trialDays` (global, default
0) and `trialRequiresCard` (default true), each overridable per tier by
`membership_tiers.trial_days` and `trial_requires_card` (null means "use the
global"). `effectiveTrial(tier, settings)` in `lib/billing/trial.ts` returns
`{ days, requiresCard }` and is the one place the precedence lives; a test
covers every combination.

ONE TRIAL PER PERSON, enforced by us because Stripe does not: the checkout
route passes `trial_period_days` only when the user has NO `memberships` row
with `trial_end` set and NO comp with `source = 'trial'`; otherwise the tier
card and the route both omit the trial, and the card's trial sentence reads
"for new members" so the rule is visible before anyone is surprised by it.

Card required (default): Stripe collects the card, `status = 'trialing'`,
and at `trial_end` the first invoice is charged; `customer.subscription.trial_will_end`
(3 days before) triggers `sendTrialEnding` (added to the Part 21 table with
claim column `memberships.trial_ending_notified_at`, added in 0281), which
states the date and the amount and links the cancel path. Card not required
(`trialRequiresCard: false`): the session carries
`payment_method_collection=if_required` and
`subscription_data[trial_settings][end_behavior][missing_payment_method]=cancel`,
so a trial with no card added simply ends (`canceled`, `sendMembershipEnded`
with a "Join Plus" link) and nobody is charged for something they did not
choose. The membership page during a trial reads "Trial, ends 21 Sep 2026.
Then $48 a year." or "Trial, ends 21 Sep 2026. Add a card before then to
keep Plus." per the mode.

PayPal does not offer a trial in V1 (a PayPal plan can carry a `TRIAL` cycle,
but that is a plan-level change to Part 16.3 that this plan does not make);
the tier card says "Try it free with card or wallet" beside the Stripe button
only. The Terms sentence on trials is Part 23.2.

### 28.3 Codes: "here is a month of Plus, on us"

A code is a string the owner mints that a signed-in reader redeems on
`/plus/redeem` for a COMP membership of a set tier and length (`source =
'code'`). Tables and the redeem RPC are Part 15.15; the admin page is Part
19.6; the reader's page is Part 27.4. The flow:

1. Admin creates a code: typed (letters, digits and hyphens, 4 to 32 chars,
   stored uppercase) or generated (three groups of four, e.g.
   `BEAM-7K2Q-PLUS`), tier, days, max redemptions (blank for unlimited),
   starts and expires, new-members-only (default on), note. The panel shows
   the shareable link `/plus/redeem?code=<CODE>` with a copy button.
2. Reader opens `/plus/redeem` (or the link), signs in if needed (the code
   survives in `next`), submits. The server action `redeemMembershipCode`:
   same-origin; signed in; `settings.codes.enabled`; shape check (the
   allowed characters and length, so garbage never reaches the database);
   rate limit `billing-redeem` at `settings.codes.redeemRateLimitPerHour` per
   actor AND 20 per hour per IP, claimed after the shape check and before the
   RPC; the RPC (Part 15.15) does the rest under a row lock.
3. Success: revalidate the tag, audit `membership.code_redeemed` with the
   code id, `sendCompStarted`, redirect to `/plus/welcome?redeemed=1`.
   Failure: the reason vocabulary mapped to one sentence each in a
   `role="alert"` ("That code has already been used", "That code has
   expired", "That code is for new members", "We do not recognise that
   code"), and no distinction between "never existed" and "disabled", so a
   guesser learns nothing.

A code grants a WHOLE TIER; a code that grants one feature is a later
revision (the grant table exists, the code table does not point at it yet,
on purpose, to keep the redeem RPC to one shape). A code holder who joins on
`/plus` before the comp ends gets the 28.1 supersede treatment, `trial_end`
included.

Stripe PROMOTION CODES (`allow_promotion_codes=true` on every subscription
Checkout) remain available for DISCOUNTS on a paid membership and are created
and managed in the Stripe Dashboard; PayPal has none. The two are named apart
everywhere: on Stripe's page it is a "promo code" and gives money off; on
ours it is a "code" and gives a membership on us. The `/plus` FAQ says so in
one sentence.

### 28.4 What a comp, trial or code holder sees

The same site as a paying member: the tier badge in the header, every feature
of the tier, every promotion silent. `/my-beacon/membership` reads "Plus, on
us, until 3 Nov 2026" (comp or code) or the trial sentences of 28.2, with
"Keep Plus after that" opening the tier cards. `sendCompEnding` three days
out, `sendCompEnded` after, both with the join link. Nothing about a comp is
ever visible to anyone but the holder and the admin.

### 28.5 Abuse and audit

Every comp action carries an admin note and an audit row. Codes default to
new-members-only, are capped by `max_redemptions` under a row lock, are
rate-limited per actor and per IP, and can be disabled at once (existing
comps unaffected) or ended in bulk ("End every membership from this code",
confirmed, audited per member). The members page shows each person's comp
history so a serial redeemer is visible.

---

## Part 29. Sales tax: a module with a mode

The owner expects Stripe to handle sales tax, and it does; what this part
adds is the modularity they asked for, so a later change is a form and not a
code change. `lib/billing/tax.ts` is the one module that knows what the
settings mean.

### 29.1 The settings block

`billing_settings.tax` (Part 15.1):

```ts
tax: {
  mode: "stripe_tax" | "manual" | "none",     // default "stripe_tax"
  behavior: "exclusive" | "inclusive",        // default "exclusive": the listed price is before tax
  productTaxCode: "txcd_10103001",            // Stripe tax code applied to membership products (SaaS, personal use)
  serviceTaxCode: "txcd_20030000",            // applied to one-time service products (general services)
  manual: { stripeTaxRateIds: [] },           // manual mode: Stripe Tax Rate ids (txr_...) to apply to every sale
  paypalNote: true,                           // show the PayPal tax note (29.4)
}
```

The two tax codes are DEFAULTS the owner confirms against Stripe's published
tax code list in the Dashboard before launch (MB-T024a's checklist), editable
in the panel, and passed as `tax_code` when a product is created on Stripe
(Part 16.2 catalog calls). Changing a code in the panel updates the Stripe
Product (`POST /v1/products/{id}` with `tax_code`), which is allowed, unlike a
price.

### 29.2 `taxParamsForCheckout(settings.tax, kind)`

Pure. Returns the form-encoded parameters the Stripe provider spreads into
the Checkout session body (Part 16.2):

- `stripe_tax`: `automatic_tax[enabled]=true`,
  `customer_update[address]=auto`, `billing_address_collection=auto`. Stripe
  computes the tax from the buyer's address on its page and adds the line.
- `manual`: for a subscription, `subscription_data[default_tax_rates][i]=txr_...`
  for each id; for a one-time purchase, `line_items[0][tax_rates][i]=txr_...`.
  Every sale gets every listed rate, which is right for a seller registered
  in one jurisdiction and wrong for more than one, and the panel says exactly
  that above the list. Requires at least one id; validation refuses the mode
  otherwise.
- `none`: nothing.

`behavior` is applied at PRICE creation (`tax_behavior=exclusive|inclusive`
on `POST /v1/prices`), because Stripe fixes it per price. Changing it in the
panel warns that existing prices keep theirs and takes effect on the next
"Set a new price"; the reconcile cron does nothing about it.

A test feeds every mode and kind through the function and asserts the exact
parameter set; a second test asserts the Stripe provider spreads the result
and adds nothing tax-related of its own.

### 29.3 Prerequisites, checks and the admin form

Stripe Tax must be ACTIVATED in the Dashboard with an origin address and at
least one registration, or a session with `automatic_tax[enabled]=true` is
refused by Stripe. The provider surfaces that refusal as
`{ ok: false, reason: "error", detail }`, the checkout route returns 503 with
"Payments are briefly unavailable; nothing was charged", and the admin
overview shows a loud "Tax is misconfigured" line. That line is driven by the
reconcile cron's daily `GET /v1/tax/settings` read (status `active` /
`pending`), stored in `billing_settings.tax.lastStatus` (written by the
system, shown read-only), so the owner learns before a buyer does.

`/admin/billing/settings`, the Tax section: the mode as three native radios
with a sentence under each; the behavior as two radios with the "existing
prices keep theirs" warning; the two tax code inputs with a link to Stripe's
list; in manual mode, the list of rate ids with a "Create a rate" form
(display name, percentage, jurisdiction, inclusive or not, which calls `POST
/v1/tax_rates` and appends the id); the PayPal note toggle; and the last
status line. Validation in `lib/billing/settings.ts`: a tax code matches
`^txcd_\d{8}$`; a rate id matches `^txr_[A-Za-z0-9]+$`; manual requires one
or more.

### 29.4 PayPal

PayPal collects no tax on our behalf and PayPal Checkout has no equivalent of
`automatic_tax`. When `tax.mode` is not `none` and `tax.paypalNote` is on,
the PayPal button on the tier card and the service page carries the sentence
"Tax is not collected on PayPal payments" as a sibling text node. If the
owner's accountant prefers not to sell a recurring membership through a
channel that cannot collect tax, `providers.paypal.subscriptions: false`
limits PayPal to one-time services and the tier cards show the Stripe button
only. Both are settings.

### 29.5 What the reader sees

Under `exclusive` behavior, every price on the site carries the sibling
sentence "plus tax where it applies" once per card (never per number), and
Stripe's page shows the tax line before the charge. Under `inclusive`, the
sentence is "tax included". Our one-time purchase receipt (Part 21) states
the tax amount read from the session's `total_details.amount_tax`; Stripe's
subscription invoices carry their own tax lines. The refund policy's section
8 (Part 30) says how tax is treated on the rare refund.

---

## Part 30. The refund policy

The text below is published verbatim at `/refund-policy` (Part 23.6), is the
constant in `lib/billing/refund-policy.ts`, and is the document the Terms
(Part 23.2) point to on refunds. It says what the owner decided in Part 12.4
in the register of a professional policy. It is not legal advice; the owner
has said they will arrange the legal read, and a lawyer's edits replace this
text in one place. The placeholders in angle brackets are filled by the
constant from `lib/site.ts` and `EMAIL_REPLY_TO`.

```
Refund Policy

Effective <date of publication>

This Refund Policy applies to Beacon Plus memberships, one-time services, and
any other paid product offered on ffbeacon.com (the "Site"), operated by
<legal name> ("FF Beacon", "we", "us"). It forms part of our Terms of Service.
By purchasing a membership or a service you agree to this policy.

1. All sales are final

All purchases made through the Site are final. We do not offer refunds,
credits or exchanges for any purchase, whether recurring or one-time, except
where this policy or applicable law expressly provides otherwise. Please read
the description of a membership tier or a service carefully before you buy.
Every price, renewal term and trial period is shown before you are asked to
pay.

2. Memberships

A Beacon Plus membership is a recurring subscription billed monthly or yearly,
as you choose at checkout. It renews automatically at the end of each billing
period until you cancel.

You may cancel at any time from your membership page. Cancellation takes
effect at the end of the billing period you have already paid for. You keep
full access to your membership until that date, and you will not be charged
again. We do not refund or prorate any portion of a billing period that has
already begun, including where you cancel on the first day of a new period.

If we change the price of a membership tier, we will give existing members at
least thirty days' notice by email before the new price applies to them. A
member who does not wish to continue at the new price may cancel before it
takes effect.

3. Trials and codes

Where a free trial is offered, its length and the date on which the first
charge will occur are shown before you start it. You may cancel during the
trial at no cost. If you do not cancel before the trial ends, your membership
begins and the first charge is made as shown. A charge made after a trial
ends is not refundable.

A membership granted by a redeemable code or by us at our discretion runs for
the period stated when it is granted, does not renew, and carries no monetary
value. It cannot be exchanged for a refund or a credit.

4. One-time services

A one-time service, such as a roster review or a trade review, is purchased
for a fixed price and is delivered to you on the Site. The sale is final at
the time of purchase. A stated turnaround time is a target and not a
guarantee; a delivery that is late does not by itself entitle you to a
refund. If we are unable to deliver a service at all, we will refund it in
full.

5. Discretionary refunds

Although all sales are final, we recognise that circumstances vary. We
consider refund requests case by case, at our sole discretion, and a decision
in one case does not bind us in another. To request a refund, email
<support email> from the address on your account within fourteen days of the
charge, stating the purchase, the date and the reason. We aim to respond
within ten business days. An approved refund is returned to the original
payment method; your payment provider may take five to ten business days to
show it. A refunded purchase ends any access, membership or service it
provided.

6. Chargebacks and disputes

If you believe a charge is wrong, please contact us first so that we can look
into it. A payment that is disputed with your card issuer, bank or payment
provider suspends the access it paid for while the dispute is open. If the
dispute is resolved in our favour, access is restored; if it is resolved in
yours, the purchase is treated as refunded. We reserve the right to decline
future purchases from an account that has raised a dispute without contacting
us.

7. Your statutory rights

Nothing in this policy limits any right you have under the law of the place
where you live that cannot be excluded or limited by agreement. Where such a
law grants you a right to cancel a purchase and receive a refund within a set
period, that right applies notwithstanding sections 1 to 4. Residents of the
European Union and the United Kingdom acknowledge that, by requesting
immediate access to a digital service, they consent to its supply beginning
within the statutory cancellation period and may lose the right to cancel once
supply has begun, to the extent the law permits.

8. Taxes

Where sales tax or a similar tax was collected on a purchase, an approved
refund includes the tax collected on the refunded amount.

9. Payment processing

Payments are processed by Stripe and by PayPal under their own terms. We do
not store your card number or bank details. A refund can only be returned
through the provider that took the original payment.

10. Changes to plans, features and this policy

We reserve the right to change, add to, withdraw or reprice membership tiers,
the features they include, and the services we offer, at any time. Where a
change reduces what a current member receives before the end of a period they
have paid for, we will consider extending their membership, crediting them or
refunding them, in each case at our discretion and on a case-by-case basis. We
do not anticipate circumstances that would require this, and this section
creates no entitlement to a refund.

We may also update this policy from time to time. The effective date above
shows when it last changed. A change applies to purchases made after that
date; the policy in force when you bought applies to that purchase.

11. Contact

Questions about this policy or a purchase: <support email>.
```

Rules the build applies to this text: straight quotes only; no em or en
dash; the two placeholders are the only interpolation; the page's H1 is
"Refund Policy" and each numbered heading is an h2; `lib/billing/copy.test.ts`
asserts the published page equals the constant; the summary sentence used
beside every Join and Buy control is `finalSaleSentence()` (Part 23.3) and
says nothing this text does not.

---

## Part 31. Additions from the gap review

Each subsection below was accepted by the owner on 2026-09-07 after a review
of the plan for what it was missing. Each is specified to the same standard as
the parts before it, and the tasks for all of them are in Part 32 under the
phase they belong to. Migrations 0296 to 0301 are specified in 31.20.

### 31.1 Pause, season pass, and the two calendars

ABSOLUTE RULE: NOTHING IN THIS PRODUCT IS KEYED TO "THE SEASON". It is keyed
to LEAGUE TYPE and to WHAT HAPPENED. A redraft league is alive from its draft
to its championship and dormant after. A dynasty or keeper league is alive
all year: trades in March, a rookie draft in May, waivers and news in July.
The site has many dynasty readers, and a system that goes quiet in February
would be wrong for every one of them. So: no scheduled producer, no poll, no
sentence of copy consults the month. Producers consult the LEAGUE (its
`status` from Sleeper, its category from `lib/league-category.ts
categorizeLeague`, and the presence of real rows: a settled matchup, a
pending trade, a completed transaction, a news item). Part 26.9 states the
rule for notifications in full. The two mechanisms below are the only ones
that mention a calendar at all, and both are the READER's choice, not the
system's.

PAUSE. A member may pause a monthly membership from `/my-beacon/membership`:
"Pause until <date>" with a native `<input type="date">` bounded to between
one month and `settings.pause.maxMonths` (default 8) ahead, confirmed in the
house dialog. Stripe: `POST /v1/subscriptions/{id}` with
`pause_collection[behavior]=void` and `pause_collection[resumes_at]=<unix>`;
the sync maps a subscription with `pause_collection` set to our `paused`
status (which does not grant, Part 14.5) and stores `paused_until`. PayPal:
`POST /v1/billing/subscriptions/{id}/suspend` on pause and `/activate` on
resume, driven by our own reconcile sweep (the seventh, Part 18.5) because
PayPal has no resume-at. Resume early is one button. Access ends the moment
the pause starts and returns the moment it ends; the membership page says
"Paused until 1 Aug 2026. Nothing is charged until then." and
`sendMembershipPaused` / `sendMembershipResumed` go out once each. Pausing is
offered only when `settings.pause.enabled` (default true) and only on a
monthly interval. It is offered to EVERY monthly member, whatever their
leagues, because it is their money; but the control's helper sentence is
type-aware (Part 26.9's `readerLeagueMix`): for a reader whose leagues are
all redraft it reads "Many redraft managers pause between the championship and
the next draft."; for a reader with any dynasty or keeper league it reads
"Your dynasty leagues keep moving all year, so trade offers, waivers and news
will not reach you while paused."; for a reader with no known leagues it
explains both in one sentence each. Nothing here counts as a cancellation,
and a paused member keeps their notification preferences for the day they
return.

SEASON PASS. A one-time product may grant a WHOLE TIER for a period:
`billing_products.fulfilment` gains the value `tier`, and `grant_tier` (jsonb,
`{ tier_slug, days }` or `{ tier_slug, until: "YYYY-MM-DD" }`) says which and
for how long. On `paid` the sync creates a comp membership (`provider =
'comp'`, `source = 'purchase'`, `source_id = purchases.id`, `expires_at` from
the grant), sends `sendCompStarted`, and the purchase is `delivered` at once.
An `until` date lets the owner sell "Plus through the championship" with a
fixed end regardless of when it is bought; the product page states the end
date in words. The one-trial and comp-supersede rules of Part 28 apply
unchanged. A code (Part 28.3) and a season pass are the same row in
`memberships` with a different `source`, which is why the resolver needs no
new branch.

A season pass's `until` date is the OWNER's choice per product, and the
product page must say what kind of league it suits: the products admin has a
required "Suits" field (`redraft`, `dynasty`, `both`) that renders as one
sentence on the product page ("Runs through the redraft championship. A
dynasty league keeps going after that, so a yearly membership may suit you
better.").

THE TWO CALENDARS, IN WORDS. There is no site-wide "offseason" setting and no
season window. What exists is `lib/notifications/league-mix.ts
readerLeagueMix(userId)`, which returns `{ redraft: n, dynasty: n, unknown: n
}` from the reader's leagues through `categorizeLeague` (keeper leagues count
as dynasty for this purpose, because they carry assets across years), and
three sentences chosen from it, used on the notifications page under the
master switch, on the sales page's notifications section, on the pause
control, and in the digest:

- All redraft: "Your leagues are redraft, so between the championship and
  the next draft there is nothing to tell you about. Your settings are kept
  and everything resumes when your leagues do."
- Any dynasty or keeper: "Your dynasty leagues run all year: trade offers,
  waivers, rookie drafts and player news reach you whenever they happen. Your
  redraft leagues, if you have any, go quiet between the championship and the
  next draft."
- Nothing known (no saved handle, or no leagues loaded): "Redraft leagues go
  quiet between the championship and the next draft. Dynasty and keeper
  leagues run all year, and so do the emails about them. Save your Sleeper
  handle and this page will say which you have."

The Monday digest sends whenever it has something to say for at least one
league (a result, a standing change, a transaction, a pending offer, a news
item) and is skipped with reason `nothing_to_say` otherwise; a dynasty reader
in March gets a digest about their March trades, and a redraft-only reader
gets none until their draft. The `recommendedInterval` setting (`month` |
`year`, default `year`) decides which radio the interval toggle starts on
when both prices exist, and the saving sentence beside it stays.

### 31.2 A Discord channel for notifications, and a Plus role

The site already runs a Discord bot (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`)
and Discord is where the community lives, so notifications gain a second
channel and members gain a role.

CHANNEL. `notification_preferences.channels` is `{ email: boolean, discord:
boolean }`, default email on and Discord off. The Discord user id comes from
the reader's Discord sign-in identity (`auth.identities` where `provider =
'discord'`, the `provider_id`), read at send time, never stored on the
notifications tables; a reader with no Discord identity sees the Discord
checkbox with "Sign in with Discord once to turn this on" and a link to the
account page's identity manager. Sending: `POST /users/@me/channels` with
`recipient_id` to open (or reopen) the DM, then `POST /channels/{id}/messages`
with plain text content built by the kind's `buildDiscordMessage` (the same
figures as the email, no embeds, one link, under 2,000 characters), through
`lib/discord/dm.ts` (new) which honours Discord's rate-limit headers and
returns a reason on any failure (`not_in_guild`, `dms_closed`, `rate_limited`,
`error`), never throws. A DM that fails with `dms_closed` sets the channel off
and the next email says so in one sentence. `notification_deliveries` gains
`channel text not null default 'email'` and the unique guarantee becomes
`(user_id, kind, dedupe_key, channel)`, so a reader on both channels gets each
thing once per channel. The daily cap and roll-up (31.6) apply per channel.
Transactional emails (Part 21) stay email-only.

ROLE. `membership_tiers.discord_role_id text` (null = no role for this
tier), set on the tiers page from a list of the guild's roles read through the
bot (`GET /guilds/{DISCORD_GUILD_ID}/roles`), with the bot's own highest role
shown so the owner can see that the chosen role sits BELOW it (Discord refuses
a role assignment above the bot's position, and the page says so). One
function owns every change: `lib/discord/role-sync.ts syncDiscordRole(userId)`,
which (1) resolves entitlements, (2) reads the reader's Discord identity from
`auth.identities` (`provider = 'discord'`, `provider_id`), (3) computes the
set of roles the reader SHOULD hold (the role of their granting tier, if any;
one role, since one tier grants), (4) reads the member's current roles
(`GET /guilds/{g}/members/{user}`), and (5) adds and removes to make them
match, touching ONLY roles that appear in `membership_tiers.discord_role_id`
across all tiers, never any other role the person holds. It returns a state
(`synced`, `no_identity`, `not_in_guild`, `no_role_configured`,
`rate_limited`, `error`) that is written to `memberships.discord_role_state`
and `discord_role_synced_at`, and never throws.

WHEN IT RUNS, and each of these is a call to that one function:

1. On every granting transition of a membership (the sync function, Part
   17), and on every transition OUT of granting (cancel at period end
   reached, unpaid, comp expired, pause started, seat lost), so the role
   leaves the day the access does.
2. THE MOMENT DISCORD IS CONNECTED. `app/my-beacon/account/actions.ts` gains
   a post-link step: after `linkIdentity` completes for `discord` (the
   callback that lands the reader back on the account page with the new
   identity), the action calls `syncDiscordRole` before rendering, so a
   member who connects Discord sees "Your Plus role is on in the FF Beacon
   server" in the same `role="status"` line that confirms the link. No
   nightly wait.
3. THE MOMENT DISCORD IS DISCONNECTED. The unlink action reads the Discord
   `provider_id` FIRST, calls `syncDiscordRole` in "remove everything we
   manage" mode with that id (because after the unlink there is no identity
   to find it by), and only then unlinks. If the removal fails
   (`rate_limited`, `error`), the unlink still proceeds (the reader asked for
   it) and the id is written to `discord_role_orphans` (a small table: `discord_user_id`,
   `role_id`, `queued_at`, `attempts`) for the nightly sweep to clear.
4. NIGHTLY, the reconcile cron's membership sweep calls `syncDiscordRole` for
   every reader with a Discord identity who EITHER holds a granting
   membership on a tier with a role OR held one in the last 48 hours, and
   then, separately, pages every guild member holding any managed role
   (`GET /guilds/{g}/members?limit=1000&after=`) and removes the role from
   anyone whose Discord id does not resolve to a currently entitled account.
   That second pass is what guarantees no stale role survives, whatever path
   created it: a member who left, a role added by hand in Discord, an
   identity unlinked while the bot was rate limited.

TELLING PEOPLE. The membership page, the welcome page and the Plus-role
line on `/plus` all say "Connect Discord on your account page to get your
Plus role in the FF Beacon server" when a role is configured for the reader's
tier and no Discord identity exists, linking the identity manager; and "Your
Plus role is on" when it is. The Discord bot needs Manage Roles and the role
must sit below the bot's; both are in the `docs/billing/billing.md` checklist.
The role is a courtesy and never a source of truth: entitlement is our
table, and every path above derives from it.

### 31.3 The free tools are not gated

MB-T028 is withdrawn. Wiring every existing tool page to `requireFeature`
would put a database read per request on pages whose answer is always
"yes", and would force pages that can be cached to render per request for a
gate that gates nothing. The registry keys for the free tools stay (the
switchboard shows them, the comparison lists them, and the day the owner
moves one out of Free the gate is added to that ONE surface in a task of its
own). `lib/billing/gate-guard.test.ts` therefore scans only modules that
import a PAID feature key, and its allow-list needs no entries for the free
tools. The one Phase 0 read that stays is Manager Pulse's quota key, because
it is a number a tier can raise, not a gate.

### 31.4 League plans: one payment, every seat in a league, and a home for it

A LEAGUE PLAN is the premium product for a whole league. It has three parts:
a SEAT of the plan's tier for every roster (this section), LEAGUE HOME, the
league's own homepage built from League Pulse's sections and arranged by the
league (31.4a), and a CUSTOM DOMAIN for that homepage, registered for a year
and kept for as long as the plan continues (31.4b). The subdomain form of the
homepage is live the moment the plan is paid; the custom domain follows once
the owner has bought it.

Anyone in a league may buy the plan. A SEAT is a membership row that follows
a roster.

Storage (migration 0297, `league_plans`): `id`, `owner_user_id`,
`league_id` (our `leagues.id`), `tier_id`, `seats int` (the roster count at
purchase), `provider` (`stripe` only in V1; PayPal league plans are a later
revision), `provider_subscription_id`, `provider_price_id`, `status` (the
membership status vocabulary), `interval`, `current_period_end`,
`cancel_at_period_end`, `metadata` (allow-listed), timestamps; service-role
only, with a `my_league_plans` view for the owner. `memberships` gains
`league_plan_id uuid references league_plans(id)`, and a seat is a row with
`provider = 'comp'`, `source = 'league_plan'`, `expires_at =
plan.current_period_end`, moved forward by the sync on every renewal.

Pricing: `membership_tier_prices` gains `kind text not null default
'member' check (kind in ('member', 'seat'))`, and the tiers page offers "Set a
league seat price" per tier and interval. Checkout is the Part 16.2
subscription session with `line_items[0][quantity]=<seats>` on the seat
price and `subscription_data[metadata][league_plan_id]`; the plan row is
created `pending` BEFORE Checkout, like a purchase, and the sync matches on
its id. The page is `/plus/league`: pick one of your leagues (the saved
handle's list through `components/league-choice-list.tsx`), see the roster
count, the per-seat price and the total in one sentence ("12 seats at $3 a
month each, $36 a month, billed to you"), the renewal sentence, and the
final-sale sentence. A league that already has a plan shows who holds it.

Seats follow rosters. On every plan sync and on the reconcile cron's sixth
sweep, `lib/billing/league-seats.ts reconcileSeats(planId)` reads the
league's rosters and their `owner_user_id` / `co_owners`, resolves each to an
FF Beacon account through `resolveViewersBySleeperUserIds` (Part 26.3), and
makes the seat rows match: an owner with an account gets a seat row (or keeps
theirs), a roster whose owner changed loses the old seat and gains the new
one at once, a roster owner with no FF Beacon account has no row (the seat
is theirs the moment they sign up with a saved handle that matches, which
the sign-up welcome says when a plan exists for one of their leagues). A
member who already has their own paid membership keeps it and the seat sits
beside it unused; the resolver takes the newest granting row, and the
membership page says "You also hold a seat in <league>'s plan." Co-owners
share one seat. Seats are never more than `seats`; a league that grew shows
the owner "Add a seat" (a quantity update through the portal).

Cancel and end: cancel at period end through the portal; every seat's
`expires_at` is the period end already, so nothing else moves. A plan whose
owner leaves the league keeps paying until they cancel; the page tells them.
The plan owner sees the seat list (handles, not emails) on
`/my-beacon/membership`. Admin: `/admin/billing/league-plans` lists plans,
seats and sync state, with "Reconcile now". Emails: `sendLeaguePlanStarted`
to the owner, `sendSeatGranted` to each seated member (a Part 21 row, claimed
by `memberships.welcome_sent_at`), `sendSeatEnded` when a plan ends.

### 31.4a League Home: the league's own homepage

League Pulse today is a tool a reader opens. Under a league plan it becomes
the league's HOMEPAGE: a page the league points people at, that says who is
in it, who is winning, what just happened and what is coming, in the order
and with the emphasis the league chooses, under the league's name and logo,
at its own address. Every number on it is a number League Pulse already
computes; League Home adds arrangement, ownership and a front door, never a
model.

WHERE IT LIVES. `/leagues/[sleeper_league_id]/home` on ffbeacon.com for any
league with an active plan (a 404 otherwise, with the plan's `/plus/league`
link for a signed-in member of that league), plus the root of the league's
subdomain and, when connected, its custom domain (31.4b). The nav gains a
"Home" entry as the FIRST item for a plan league, so the overview becomes the
second tab; a league without a plan sees no change.

WHO EDITS. The plan owner, every commissioner of the league
(`getLeagueAdminContext`, the existing rule), and a site admin. Editors open
`/leagues/[id]/home/edit`. Nobody else can write, and the server action
re-derives editor status on every save; the client receives a boolean for
rendering only.

STORAGE (migration 0300, `league_home_settings`): `league_id` (primary key,
references `leagues.id`), `plan_id` (references `league_plans.id`), `slug
text not null unique` (the subdomain label: 3 to 40 chars, `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`,
not in `RESERVED_ROUTE_SEGMENTS` or `signal_reserved_handles`, defaulting to
a slug of the league name with a numeric suffix on collision), `layout jsonb
not null`, `theme jsonb not null default '{}'`, `pages jsonb not null default
'{}'` (the long-text pages: rules, history), `visibility text not null
default 'public' check (visibility in ('public', 'members'))`, `logo_path
text` (a Supabase Storage object in the `league-home` bucket, uploaded through
the same pipeline as profile avatars: PNG, JPEG or WebP, 512 KB, re-encoded
server-side), `published boolean not null default true`, `updated_by`,
timestamps. Access: SELECT public where `published` (the home is a public
page); writes service-role through the editor's server actions. Every write
is audited (`billing_audit_log`, actions `league_home.layout`,
`league_home.theme`, `league_home.pages`, `league_home.visibility`,
`league_home.slug`, `league_home.logo`).

THE MODULE REGISTRY, `lib/league-home/modules.ts`: a readonly array, each
`{ id, name, description, sizes: ("full" | "half")[], defaultEnabled,
defaultSize, fixed?: "first" }`, with a server component per id under
`components/league-home/modules/`. The launch set, every one a re-arrangement
of a panel League Pulse already renders from its caches:

| id | what it shows | source |
| --- | --- | --- |
| `hero` (fixed first, cannot be disabled) | league name, logo, season, team count, format in words, the editor's one-line tagline | `leagues`, `theme` |
| `standings` | the rankings table, Power Pulse order by default with the Value column beside it (the overview's rule) | `league_power_pulse_cache`, `league_power_rankings_cache` |
| `odds` | playoff, bye and title odds per team | `league_power_pulse_cache` |
| `this_week` | the current week's matchups with win probabilities | `league_matchups`, `league_power_pulse_cache.weekly` |
| `last_week` | last settled week's results with margins and top scorers | `league_matchups` |
| `activity` | the recent-activity panel, the overview's `LeagueActivityPanel` | `loadLeagueActivity` |
| `positional_war` | the Positional WAR chart | `league_positional_war_cache` |
| `ledger` | lineup efficiency and best-lineup record ranks | `league_manager_ledger_cache` |
| `countdown` | the next fixed event: waivers processing, trade deadline, playoff start, draft night | the calendar feed's data (31.13) |
| `announcements` | editor-written text, plain paragraphs | `pages.announcements` |
| `rules` | a teaser and link to the league's rules page `/home/rules` | `pages.rules` |
| `history` | champions by season, from prior seasons we hold through `previous_league_id`, with an editor-written override list for seasons we do not | `leagues` chain, `pages.history` |
| `links` | up to twelve labelled links (http or https only, validated) | `pages.links` |
| `discord` | a "Join the league Discord" button for one invite URL | `pages.discordInvite` |

Every module reads caches and never triggers a compute (the same rule as
every other on-demand model consumer); a module whose cache is empty renders
its honest "not built yet" line, never a zero. The page itself is a League
Pulse deep-view page: it calls `pulseLeagueCore` and streams
`pulseLeagueDerived` behind Suspense exactly as the overview does, so the
60-minute cache and the 12-hour model TTLs bound its cost. A module that
renders a table renders a real table; a chart renders `role="img"` with a
summary and a data table under a disclosure (the Lineups rule).

THE LAYOUT, `layout` jsonb, validated by `lib/league-home/layout.ts` (zod):

```ts
{
  version: 1,
  modules: [ { id, size: "full" | "half", enabled: boolean, settings?: {} } ],  // in display order; hero first
  tagline?: string,                           // 120 chars, plain text
}
theme: { accent?: "#RRGGBB", logoSource: "sleeper" | "upload" }
pages: { announcements?: string, rules?: string, history?: [{ season, champion, note? }], links?: [{ label, url }], discordInvite?: string }
```

Unknown module ids are dropped on save; a missing module is appended
disabled; `hero` is forced to index 0 and enabled; two `half` modules in a
row share one row on wide viewports and stack on narrow ones, and a `half`
with no partner renders full. The accent colour is checked for contrast
against both the dark and the light ground (WCAG AA on text it is applied to,
which is headings and the beam only) and refused with the measured ratio
when it fails; the default is the site's purple. Long text is plain
paragraphs rendered as text nodes (`components/billing/plain-paragraphs.tsx`),
never HTML, never markdown.

THE EDITOR, `/leagues/[id]/home/edit`: a server-rendered form. One
`<fieldset>` per module in current order with a `<legend>` of its name: an
"Include" checkbox, a Size radiogroup (where the module allows both), Move
up and Move down buttons (not drag, per the tiers-page convention), and the
module's own fields where it has them (the tagline, the announcements text
area with a character count, the rules text area, the history rows, the
links rows with add and remove, the invite URL). Then Theme (accent, logo
source and upload), Visibility (public, or members only, with the sentence
that members-only works on ffbeacon.com and that a custom domain is always
public, 31.4b), and the Address block (the subdomain slug with live
availability check on blur, and the custom domain's status in words). Save
is one server action (`saveLeagueHome`) with the same-origin guard, the
editor check, zod validation, the audit rows, and a `role="status"` "Saved"
with focus moved to it. "Preview" is a link to the home itself. Every
control is a native control in a label; the page passes the site's
accessibility review before it ships.

VISIBILITY. `public` is the default and the point. `members` requires the
viewer to be signed in and matched to a roster in the league (the saved
handle's `sleeper_user_id` against `rosters.owner_user_id` / `co_owners`),
renders a sign-in prompt otherwise, and is honoured on ffbeacon.com only; a
custom domain has no session (31.4b), so a `members` home is served on the
custom domain as a one-line "This league's home is private. Open it on FF
Beacon." with the link.

WHEN THE PLAN ENDS. The home keeps rendering read-only for
`settings.leaguePlan.homeGraceDays` (default 30) with a line visible to
editors only ("Your league plan ended on <date>; the home stays up until
<date>"); the editor is locked to read-only; after the grace period
`/home` redirects to the overview and the subdomain and custom domain
disconnect (31.4b). `league_home_settings` is KEPT, so a plan renewed later
brings the same home back untouched. Nothing is deleted by a lapse.

METADATA AND SHARING. Title "<league name>", description from the tagline,
OG image `/api/og/league-home/[league_id]` (1200 by 630, the league's name
and logo, the top three by Power Pulse, brand rules as every other OG route),
canonical URL the custom domain when connected, else the subdomain, else
the ffbeacon.com path. Indexable when `public`.

### 31.4b Custom domains

Every plan league gets two addresses, one at once and one after a purchase.

THE SUBDOMAIN, at once: `<slug>.leagues.ffbeacon.com`. One wildcard domain,
`*.leagues.ffbeacon.com`, is added to the Vercel project once by hand
(recorded in `docs/billing/billing.md`) with a wildcard CNAME at Cloudflare;
after that a new league's subdomain needs no provisioning at all. The slug
is `league_home_settings.slug`, editable by the league within the rules
above; an old slug 308s to the new one for 90 days through a `previous_slug`
column and expiry.

THE CUSTOM DOMAIN, after purchase. The owner buys every domain, through
Cloudflare Registrar, in the owner's Cloudflare account, and holds it. The
plan holder is buying the USE of the domain for the life of the plan, and
the plan page, the Terms addition (Part 23.2) and the editor's Address block
all say so in one sentence: "FF Beacon registers and holds the domain; it
points at your league home for as long as your league plan continues."
Cloudflare's Registrar API manages domains an account already holds (list,
read, auto-renew, lock) but does not register a NEW domain; registration is
a two-minute step in the Cloudflare dashboard, and MB-T140 re-verifies that
statement against Cloudflare's API reference before the build and records
the answer here. Everything on either side of that step is automated.

Storage (migration 0301, `league_domains`): `id`, `league_id`, `plan_id`,
`domain text not null unique` (lowercase, IDNA-encoded), `status text not
null check (status in ('requested', 'purchased', 'dns_pending', 'verifying',
'active', 'disconnected', 'expired'))`, `requested_names jsonb` (the
buyer's up to three candidates, in order), `cloudflare_zone_id text`,
`registrar_expires_at timestamptz`, `registrar_auto_renew boolean`,
`vercel_added_at`, `verified_at`, `disconnected_at`, `last_check_at`,
`last_error text` (vocabulary, never provider text verbatim), `note text`
(admin), timestamps. Service-role only, plus `league_domain_routes`, a
public-SELECT view of `(domain, league_id)` where `status = 'active'` that
the middleware reads (below). A league has at most one row that is not
`disconnected` or `expired` (partial unique index).

The flow, end to end:

1. REQUEST. On `/plus/league` after payment, and later from the editor's
   Address block, the plan holder enters up to three domain names they would
   like, in order of preference. `lib/domains/rdap.ts` checks each against
   the public RDAP service (`GET https://rdap.org/domain/<name>`; a 404 means
   no registration found, which is shown as "looks available" and never as a
   promise; any other answer or a failure is shown as "taken or unknown");
   `lib/domains/policy.ts` checks the TLD against
   `settings.leaguePlan.domain.allowedTlds` (default `com`, `net`, `org`) and
   the label against the same slug grammar as subdomains. The row is written
   `requested` and `sendDomainRequested` goes to the admin.
2. PURCHASE. `/admin/billing/domains` lists requests oldest first with each
   candidate's RDAP hint and a "Buy in Cloudflare" outbound link to the
   Registrar page. The owner buys the first available candidate (the price
   cap is `settings.leaguePlan.domain.maxPriceUsd`, default 20, shown beside
   the link as the owner's own rule), turns auto-renew ON in Cloudflare, and
   presses "Purchased" on the row, typing the exact domain bought. Status
   `purchased`.
3. CONNECT, one button, `connectLeagueDomain(domainId)`:
   a. `lib/domains/cloudflare.ts` (`CLOUDFLARE_API_TOKEN` scoped to
      Zone:Read and DNS:Edit on the account, `CLOUDFLARE_ACCOUNT_ID`): find
      the zone (`GET /zones?name=<domain>&account.id=<id>`; Cloudflare creates
      the zone on registration), then upsert two records: `CNAME @ ->
      cname.vercel-dns.com` (Cloudflare flattens an apex CNAME) and `CNAME
      www -> cname.vercel-dns.com`, both `proxied: false` (DNS only, so
      Vercel terminates TLS and nothing about our origin is double-proxied),
      TTL auto. Read `GET /accounts/{id}/registrar/domains/<domain>` for
      `expires_at` and `auto_renew` and store both. Status `dns_pending`.
   b. `lib/domains/vercel.ts` (`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`,
      `VERCEL_TEAM_ID`): `POST /v10/projects/{projectId}/domains` with
      `{ name: <domain> }`, then the same with `{ name: "www.<domain>",
      redirect: <domain>, redirectStatusCode: 308 }`. Status `verifying`.
   c. The reconcile cron's NINTH sweep polls `GET /v9/projects/{id}/domains/<domain>`
      for every `verifying` row (at most 20 per run) until `verified: true`
      and the config check `GET /v6/domains/<domain>/config` reports no
      misconfiguration, then sets `active`, `verified_at`, and sends
      `sendDomainConnected` to the plan holder with the live URL. A row
      `verifying` for more than 48 hours raises a cron-health alert (31.15)
      with the last Vercel verification challenge in the admin row.
   Every provider call goes through one client per provider with a
   ten-second timeout, returns `{ ok } | { ok: false, reason }`, never
   throws, and logs the domain and the reason only.
4. SERVE. `middleware.ts` gains host routing BEFORE `updateSession`: if the
   request host is `SITE_HOST` (from `NEXT_PUBLIC_SITE_URL`), a Vercel
   preview host, or `localhost`, nothing changes. If it matches
   `*.leagues.ffbeacon.com`, the slug is looked up; otherwise the host is
   looked up in `league_domain_routes`. The lookup is a fetch to the
   PostgREST view with the publishable key, cached in module scope for 60
   seconds per host (an edge function's module scope, so per region), and a
   miss caches too. A match REWRITES: `/` to `/leagues/<id>/home`, `/rules`
   to `/leagues/<id>/home/rules`, and `/<section>` for the read-only
   sections in `LEAGUE_NAV_ITEMS` (`power-pulse`, `schedules`,
   `positional-war`, `decisions`, `transactions`, `trade-ideas`, `lineups`)
   to `/leagues/<id>/<section>`; anything else on that host is a 404 in the
   league-home shell. The rewrite sets request header `x-league-home: <id>`
   and `x-league-home-host: <host>`. `updateSession` is skipped for these
   hosts: there is no session on them by design, so no auth cookie is read
   or set, and every request is a guest request.
5. THE SHELL. The root layout reads `x-league-home` and, when present,
   renders the LEAGUE HOME SHELL instead of the site shell: a header with the
   league's logo and name (linking to `/`), the league's section nav, and a
   footer "Powered by FF Beacon" linking to `https://ffbeacon.com/plus/league`;
   no site nav, no account controls, no donate heart, no Beacon+ control, no
   promotions (the placement registry's budget reads the header and renders
   nothing). Every action that needs a session (sign in, Beacon Link buttons,
   the editor, Trade Ideas' saved trades) renders as a link to
   `https://ffbeacon.com<same path>` with the sentence "Sign in on FF Beacon".
   `<link rel="canonical">` is the custom domain; the ffbeacon.com path
   carries a canonical pointing at the custom domain too, so one address is
   indexed.
6. RENEW. The domain is registered for one year at purchase and auto-renews
   in Cloudflare while the plan is active. Thirty days before
   `registrar_expires_at`, cron-health alerts the owner if the plan is
   `active` and `registrar_auto_renew` is false (turned off by hand), and
   the plan holder gets nothing, because the renewal is ours to keep. A
   domain whose plan is NOT active at renewal time is not renewed: the
   admin domains page shows "do not renew" on it and the owner turns
   auto-renew off in Cloudflare (one click, linked), because the Registrar
   API's update call is used for the auto_renew flag when the token has the
   Registrar scope, and by hand otherwise; MB-T140 records which.
7. END. When a plan stops granting and `homeGraceDays` pass, the reconcile
   sweep disconnects: Vercel `DELETE /v9/projects/{id}/domains/<domain>` for
   both records, Cloudflare `DELETE /zones/{zone}/dns_records/{id}` for the
   two records, status `disconnected`, `sendDomainDisconnected` to the
   former plan holder. The registration stays ours until it expires and is
   marked `expired` by the sweep when `registrar_expires_at` passes; a plan
   renewed before then reconnects with step 3 and no new purchase. Nothing
   is transferred to the plan holder as part of the product; a transfer
   request is a case-by-case email to the owner, and the FAQ says so.

CHANGING THE DOMAIN. One active domain per league. A change is a new request
(step 1); on connect of the new one, the old one goes through step 7 at once
(no grace), and the old row keeps its history.

WHAT THE PAGE SAYS. `/plus/league` describes the plan in this order: every
seat gets <tier>; your league gets its own homepage you arrange; a free
address at once; a custom domain of your choosing, registered and held by FF
Beacon and pointing at your home for as long as the plan continues; the
price sentence; the renewal and final-sale sentences. The FAQ gains three
entries: who owns the domain, what happens to the home if the plan ends,
and why sign-in happens on ffbeacon.com.

ADMIN. `/admin/billing/domains`: every domain row with status in words, the
RDAP hints, the Cloudflare and Vercel deep links, Purchased, Connect,
Disconnect, Reconnect, Re-check, and the last error; and the wildcard
subdomain's health (a fetch of a known slug once a day). The league-plans
page links to it per plan.

ENV, all server-only, documented in the CLAUDE.md env section:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VERCEL_API_TOKEN`,
`VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`. The publishable Supabase key the
middleware already has is the only credential the edge sees.

RULES, for Part 33: a custom-domain request is served as a guest with no
session and no cookie, and every session-bound action links back to
ffbeacon.com; the middleware host table is the `league_domain_routes` view and
nothing else, so a spoofed Host header for an unknown domain reaches the
normal site or a 404 and never another league; League Home reads caches and
never computes; the layout is validated against the module registry on every
save and unknown ids are dropped; the domain is registered and held by FF
Beacon and its use ends with the plan.

### 31.5 Email deliverability

Notifications multiply the site's sending by a large factor, and a sender
that ignores bounces is a sender that stops being delivered. Five pieces.

SUPPRESSION (migration 0296, `email_suppressions`): `address_hash text
primary key` (sha256 of the lowercased, trimmed address; the address itself
is never stored), `reason text check (reason in ('hard_bounce', 'complaint',
'soft_bounces', 'manual'))`, `source text` (`resend`, `admin`),
`created_at`, `note`. Service-role only. `lib/email/suppression.ts
isSuppressed(address)` hashes and looks up; `lib/email/send.ts` calls it
for every send when the caller passes `category: 'notification' |
'membership' | 'transactional'`: a `notification` to a suppressed address is
refused (`{ ok: false, skipped: true, reason: 'suppressed' }`), a
`membership` email (comp ending, trial ending) likewise, a `transactional`
one (a receipt, a payment failure) is still attempted because it is a
record of a transaction, unless the reason is `complaint`, in which case
nothing is sent and the admin is told.

RESEND WEBHOOKS. `app/api/email/webhook/resend/route.ts` (new) verifies the
Svix signature (`svix-id`, `svix-timestamp`, `svix-signature` headers,
`RESEND_WEBHOOK_SECRET`, five-minute timestamp tolerance, constant-time
compare, fail closed) and handles `email.bounced` (hard: suppress, set the
reader's `email_enabled = false`, audit `notifications.bounce_off`, and record
on `notification_deliveries.provider_status`), `email.complained` (suppress
with `complaint`, master off, audit, admin email), `email.delivered` (stamp
`provider_status`), and soft bounces (counted in `email_bounce_counts`, a
keyed counter in `notification_settings`? No: a small table is cleaner, so
`email_suppressions` gains a sibling `email_bounce_counts (address_hash,
count, first_at, last_at)`, same migration, and three soft bounces in seven
days become a `soft_bounces` suppression). The recipient of a webhook is
matched to a delivery by Resend's message id (`notification_deliveries.provider_message_id`,
already stored), never by address.

SENDING SUBDOMAIN. Notifications and membership emails send from
`EMAIL_FROM_NOTIFICATIONS` (default `FF Beacon <notify@mail.ffbeacon.com>`),
a subdomain verified in Resend on its own, with SPF, DKIM and a DMARC record
at `p=quarantine`, so a bad week for notifications cannot take receipts and
the Signal community's mail down with it. `docs/billing/billing.md` records
the DNS records. Receipts and community mail keep `EMAIL_FROM`.

THE POSTAL LINE. `notification_settings.footer.postalAddress` (a string,
required non-empty before `enabled` can be turned on; the settings validator
enforces it) is rendered in the footer of every notification and every
membership email, under the unsubscribe line. It is one line of text.

WARM-UP. `notification_settings.warmup` is `{ enabled: true, startedAt,
dailyMax: [50, 100, 200, 400, 800, 1600] }`: for the first six days after
`startedAt`, the dispatcher sends at most that day's number and holds the
rest with `not_before` tomorrow, then the cap is gone. The admin page shows
the day and the count.

### 31.6 Roll-ups instead of dropped mail

Specified inline in Part 26.3 step 5. In short: a reader with several
events of one kind in a pass gets ONE email for that kind with a section per
league; the daily cap is applied after roll-up and holds rather than drops;
`urgency: now` kinds are exempt. Every kind gains a `buildRollup(payloads[])`
beside its `build`, tested with two and nine leagues, and the subject line
names the count ("Your 9 matchup results, week 3"). `rollupThreshold`
(default 2) is a setting.

### 31.7 Time zones and kickoff

`notification_preferences.time_zone` (IANA, default `America/New_York`) is
chosen on the notifications page from a native `<select>` grouped with the
six US zones first and the rest alphabetically. Every per-reader window
(lineup alert, quiet hours, the daily cap's midnight, the Monday digest) is
resolved in the reader's zone through Intl; the display rule of the site
(`formatEastern`) is unchanged for what is DISPLAYED, and every timestamp in
an email still carries its zone label, which is now the reader's own. The
site-wide rule in CLAUDE.md is amended by Part 33 to say that a notification
email is the one surface rendered in the reader's chosen zone, because a
Sunday alert timed for a reader in Los Angeles is only useful in their
morning.

BEFORE FIRST KICKOFF. The lineup alert's Sunday window is `max(window,
firstKickoff - settings.lineupAlert.hoursBeforeKickoff)` where
`firstKickoff` is the earliest kickoff among the reader's STARTERS that
week, read from `nfl_game_odds` when present (it carries game times), so an
alert about a starter in a London game arrives before that game and not
after. A Thursday or Monday starter with a problem gets an alert before
that game on that day. When no kickoff time is known, the window alone
applies, and the email says nothing about kickoff.

### 31.8 Inbox-poll backoff and pruning

The inbox poll (Part 26.3 c) scales with connected members, so it is
bounded, but NEVER by the calendar (Part 26.9): a dynasty league trades in
March, and a poll that slept until August would miss the offers the reader
is paying to hear about. Three bounds, all activity-based: it runs only in
each reader's waking hours (8am to 11pm in their zone,
`settings.inboxPoll.wakingHours`); per LEAGUE it polls at `inboxPollMinutes`
(default 15) while the league is active, which means Sleeper's league
`status` is `in_season` or `drafting` OR the league has had any transaction
in the last `inboxPoll.activeDays` (default 21), and otherwise at
`inboxPoll.quietMinutes` (default 120), so a dormant redraft league in
February costs one call every two hours and a dynasty league with an active
trade market keeps the fast cadence in any month; and per reader it backs
off further, after `inboxPoll.quietDaysBeforeBackoff` (default 14) days with
no offer seen in ANY of their leagues, to `backoffMinutes` (default 60),
resetting the moment an offer appears, a transaction lands in one of their
leagues, or the reader opens their Trades page. Each tick polls at most
`inboxPoll.maxPerTick` (default 200) readers, oldest-polled first, so a tick
is bounded even at thousands of connected members.

Sleeper rolls a dynasty league into a new league id each year
(`previous_league_id` on the new one). The saved handle's league list
returns the CURRENT season's ids, the poll follows that list, and a freshly
rolled league has no pending trades and no transactions, so nothing fires
until something real happens in it. A `trade_offer` is keyed by Sleeper's
transaction id, which is new per offer, and a `league_trade_alert` only for
transactions created within 48 hours (Part 26.2), so the roll itself never
produces an email. The preceding season's league id stays in the reader's
list until Sleeper drops it, and a pending offer in it is still an offer.

Pruning is the reconcile cron's eighth sweep: `notification_events` rows
resolved more than 30 days ago are deleted (deliveries are kept, they are the
guarantee and the history); `promotion_impressions` rows older than 400 days
are deleted. Both paged.

### 31.9 Chargeback evidence

`/admin/billing/members` gains "Evidence pack" per member: a server action
that assembles, in memory, a plain-text document and returns it for download
by the admin (never stored, never emailed): account created date and sign-in
providers, every `terms_acceptances` row (31.12) with version and date, the
membership rows with provider ids and dates, checkout session ids, the
`billing_audit_log` rows for the member, the `sleeper_action_log` rows (what
they did with Beacon Link, when), `notification_deliveries` (what we sent,
when, and Resend's delivered status), and the active-session history the
account page already shows. No addresses, no card data (we hold none). The
point is that a dispute response takes five minutes and shows the person
used what they paid for.

### 31.10 Fail-soft entitlement

Specified inline as Part 14.4 step 6. Rule, restated for Part 33: a
resolver failure returns the reader's last good answer for up to fifteen
minutes, marked `degraded`; a degraded answer never shows a promotion and
never writes to the durable cache.

### 31.11 Tokens that survive a log leak

The unsubscribe token and the calendar token are DERIVED, not stored: `token
= base64url(HMAC-SHA256(NOTIFICATIONS_TOKEN_SECRET, userId + ":" +
purpose))`, regenerated for every email or feed URL, and the table holds only
`sha256(token)` for lookup (`unsubscribe_token_hash`, `calendar_token_hash`,
Part 15.16). A request presents the token; the route hashes it and looks up
the hash in constant time. A leaked request log therefore holds a token that
still works (that is unavoidable for a link in an email) but the DATABASE
never holds a usable token, and rotating `NOTIFICATIONS_TOKEN_SECRET`
invalidates every link at once and is the incident response. The secret is
a new env var, 32 random bytes, documented in the CLAUDE.md env section.

### 31.12 Terms versions

Migration 0298, `terms_acceptances`: `id`, `user_id`, `document text check
(document in ('terms', 'privacy', 'refund'))`, `version text`,
`accepted_at`, `context text` (`checkout`, `redeem`, `league_plan`,
`purchase`, `notifications`), `reference text` (a checkout session id, a code
id), service-role only with a `my_terms_acceptances` view. `lib/legal/versions.ts`
exports `TERMS_VERSION`, `PRIVACY_VERSION`, `REFUND_POLICY_VERSION` as dated
strings (`"2026-09-07"`), bumped by hand with every wording change, and the
three pages render "Version <date>" under their H1. The checkout, purchase,
redeem and league-plan routes write one row per document at the moment the
reader passes through (Stripe records the tick on its page; we record which
version we showed), and the members page and the evidence pack list them.

### 31.13 A calendar feed

`/api/calendar/<token>.ics` (token per 31.11, purpose `calendar`): a
`text/calendar` feed, cached for one hour, of the reader's leagues' fixed
dates from data already held: waiver processing time each week (from the
league's waiver settings and `waiverProcessingWeekday()`), the trade
deadline (`leagues.metadata.settings.trade_deadline` as a week, resolved to
a date through the NFL week table), playoff start, the draft date and time
from `league_drafts` when scheduled, and each week's matchup as an all-day
event titled "<league>: you play <opponent>". Every event carries the page
URL in its description. The feed is offered on the notifications page as
"Add to your calendar" with the URL in a read-only input and a copy button,
behind the feature key `notifications.calendar` (access, on `plus` in the
seed), and revoked by "Reset the link", which changes nothing in the
database beyond bumping a per-user `calendar_salt` mixed into the HMAC.
Rate limit 60 per hour per token.

### 31.14 Attribution

Every promotion link carries `?via=<placement id>`; `/plus` and
`/plus/league` store it in a `bp_via` cookie (30 days, first value wins);
the checkout, purchase, redeem and league-plan routes read the cookie and
put `metadata[via]` on the session (or the comp row); the sync writes
`memberships.attribution jsonb` (`{ via, at }`) on first creation, and the
first granting transition increments `promotion_impressions.converted` for
that placement and day. `/admin/billing/promotions` shows conversions and a
conversion rate beside the dismissal rate, so the owner can see which notes
are noise and which pay for the site. `purchases.attribution` does the same
for services.

### 31.15 Proactive alerts

The existing `/api/cron/cron-health` job gains billing and notification
checks, emailed to the admin through `lib/email/cron-health-emails.ts` with
one section per finding, at most one email a day: `billing_events` in
`failed` above zero in the last 24 hours; no Stripe webhook received in 48
hours while any paid membership exists; `tax.lastStatus` not `active` while
`tax.mode` is `stripe_tax`; `notification_events` in `failed` above
`settings.alerts.failedEventsThreshold` (default 10); more than
`settings.alerts.suppressionsPerDay` (default 5) new suppressions in a day;
a Resend send failure rate above 5 percent in the last day; the notification
dispatcher not having run in 30 minutes. Each check is a pure function over
counts, tested.

### 31.16 Gift memberships

`billing_products.fulfilment` gains `gift_code`: on `paid`, the sync mints
one `membership_codes` row (the product's `grant_tier` tier and days,
`max_redemptions = 1`, `new_members_only = false`, `note = "gift from
<purchase id>"`), sends the buyer `sendGiftPurchased` with the code and the
redeem link, and, if the intake included the optional `recipient_email`
field, sends `sendGiftReceived` to that address once (the address is used
for that send and not stored; the intake stores only that a recipient was
named). The product page says the gift does not renew and needs no card.
Redemption is Part 28.3 unchanged.

### 31.17 The beta period

The donor thank-you script proposed in the third revision is removed: the
donation feature shipped days ago and there is nobody to thank yet. If that
changes, it is a bulk comp from the members page (Part 19.6), which already
takes a list.

BETA. The membership system ships with `billing_settings.enabled = false`.
In that state comps still grant, the promotions render for nobody, `/plus`
returns 404, and every gated feature works for comped readers. The beta is
therefore: comp a cohort from the admin page with a `note` tag (`beta`),
run for as long as the owner likes, read the notification skipped-reason
breakdown and the (empty) promotion counters, tune the defaults, then flip
`enabled`. `/admin/billing` shows the count of `beta`-tagged comps and a
"Beta cohort" filter on the members page.

### 31.18 The price form shows the net

`/admin/billing/tiers` and `/admin/billing/products` render, beside the
price input, "Estimated processor fee $0.42, you keep $3.58 per charge" from
`settings.fees` (`{ stripe: { percent: 2.9, fixedCents: 30 }, paypal: {
percent: 3.49, fixedCents: 49 } }`, admin-editable, with the note that these
are the published standard rates and the owner's account may differ). It is
a note, computed client-side from the settings, and stores nothing.

### 31.19 PayPal paperwork starts now

The PayPal Business REST app, its live credentials, and its webhook
registration take days of PayPal's time, not ours. `docs/billing/billing.md`
carries a checklist the owner can start before Phase 0 is written: create
the REST app in the developer dashboard, note sandbox and live client ids,
register the webhook URL for the event list in Part 16.3, and request any
feature flags PayPal gates (subscriptions on some account types). MB-T070's
spike then has credentials waiting.

### 31.20 Migrations 0296 to 0301

- 0296 `email_suppressions` and `email_bounce_counts` (31.5). Service-role
  only. Rollback: drop both.
- 0297 `league_plans` and the `my_league_plans` view; `memberships.league_plan_id`;
  `membership_tier_prices.kind` (31.4). Rollback: drop the column and the
  table.
- 0298 `terms_acceptances` and the `my_terms_acceptances` view (31.12).
- 0299 the columns the rest of this part adds, one `alter table` each with a
  comment naming its subsection: `memberships.paused_until`,
  `memberships.attribution`, `memberships.discord_role_synced_at`,
  `memberships.discord_role_state`, the `source` check extended to
  `('admin', 'code', 'trial', 'purchase', 'league_plan')`;
  `purchases.attribution`; `billing_products.fulfilment` check extended to
  `('manual', 'grant', 'tier', 'gift_code')` and `billing_products.grant_tier
  jsonb`; `membership_tiers.discord_role_id` and `membership_tiers.archived_at`;
  `notification_deliveries.channel` and the unique index rebuilt as
  `(user_id, kind, dedupe_key, channel)`; `notification_deliveries.provider_status`;
  `promotion_impressions.converted int not null default 0`;
  `notification_preferences.calendar_salt text not null default
  encode(gen_random_bytes(8), 'hex')`. Every RLS matrix unchanged, restated
  in the header.

- 0300 `league_home_settings` (31.4a), with `previous_slug` and
  `previous_slug_until` for the 90-day slug redirect, and the `league-home`
  storage bucket with its policies (public read, service-role write).
- 0301 `league_domains` (31.4b), the partial unique index on one live domain
  per league, the `league_domain_routes` public view, and
  `discord_role_orphans` (31.2). Rollback: drop all three.

New env vars, all server-only, documented in the CLAUDE.md env section:
`RESEND_WEBHOOK_SECRET`, `EMAIL_FROM_NOTIFICATIONS`,
`NOTIFICATIONS_TOKEN_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`. New settings keys:
`pause`, `recommendedInterval`, `headlineMax`, `fees`, `alerts`, `warmup`,
`footer.postalAddress`, `inboxPoll.*` (`wakingHours`, `activeDays`,
`quietMinutes`, `quietDaysBeforeBackoff`, `backoffMinutes`, `maxPerTick`),
`rollupThreshold`, `lineupAlert.hoursBeforeKickoff`, `leaguePlan.homeGraceDays`,
`leaguePlan.domain.allowedTlds`, `leaguePlan.domain.maxPriceUsd`, each with a
control and a coverage-test entry. There is deliberately NO `season` key
(Part 26.9).

---

## Part 32. Phases and tasks

Every decision in Part 12 is recorded, so nothing gates Phase 0. Beacon Link
(Parts 0 to 11) and this plan are independent: this can ship before, after,
or without Beacon Link, and the Beacon Link tasks that reference entitlement
(BL-T013, BL-T014, BL-T015, BL-T020) take a dependency on MB-T020. The
notifications phase (Phase 5) depends on Phase 1 (a member must exist to be
entitled) and on nothing in Beacon Link except for the two trade-offer kinds,
which ship when BL-T020 does.

### Phase 0: foundations (Stripe, no selling surface yet)

```
MB-T001 | lib/billing/constants.ts (MEMBERSHIP_NAME "Beacon Plus", MEMBERSHIP_MARK "Beacon+", DEFAULT_TIER_SLUG),
        | lib/billing/types.ts.
MB-T002 | lib/billing/feature-registry.ts: the catalog of Part 14.1 with pitch and headline per key, and
        | feature-registry.test.ts (every SleeperActionKind has a key; keys match the naming grammar; no
        | duplicates; at most four headline keys and none of them beacon_link.*; notifications.email present).
MB-T002a| lib/billing/promo-copy.ts: MECHANISM_DENYLIST + assertNoMechanism, and promo-copy.test.ts over every
        | registry pitch (Part 25.5). Grows to cover placements, plus-copy and notification templates as they land.
MB-T003 | app/api/donate/webhook/route.ts: ignore sessions whose metadata.product is not ffbeacon_donation.
MB-T004 | lib/stripe/client.ts lifted from lib/donate/stripe.ts; donate imports it; donation tests unchanged.
MB-T005 | migration 0275 billing_settings + lib/billing/default-settings.ts + settings.ts (zod) + tests.
MB-T006 | migration 0276 billing_features + lib/billing/catalog.ts syncFeatureCatalog + test.
MB-T007 | migration 0277 membership_tiers (one-default index, protect trigger) + trigger test via begin/rollback.
MB-T008 | migration 0278 membership_tier_prices.
MB-T009 | migration 0279 membership_tier_features.
MB-T010 | migration 0280 billing_customers.
MB-T011 | migration 0281 memberships + my_membership view + the email claim columns.
MB-T012 | migration 0282 feature_grants + my_feature_grants view.
MB-T013 | migration 0283 billing_products.
MB-T014 | migration 0284 purchases + my_purchases view + the intake update policy.
MB-T015 | migration 0285 billing_events + try_claim_billing_event (grants named for all three roles).
MB-T016 | migration 0286 billing_audit_log.
MB-T017 | migration 0287 the seed (free AND plus tiers, paid keys onto plus) + lib/billing/seed.test.ts (both halves).
MB-T018 | migration 0288 reserve /plus, /services, /notifications, /refund-policy, /membership + RESERVED_ROUTE_SEGMENTS
        | + the /membership -> /plus permanent 308 in next.config.ts.
MB-T018a| migration 0289 membership_codes + membership_code_redemptions + redeem_membership_code RPC (grants named for
        | all three roles; authenticated only) + a begin/rollback test of the row lock and every reason code.
MB-T018b| migration 0290 notification_preferences (own-row policies, no delete).
MB-T018c| migration 0291 notification_events + try_claim_notification_events.
MB-T018d| migration 0292 notification_deliveries + my_notification_history view.
MB-T018e| migration 0293 notification_settings.
MB-T018f| migration 0294 billing_features pitch, headline, story columns.
MB-T018g| migration 0295 promotion_impressions + record_promo_event (granted to anon and authenticated by name).
MB-T019 | regenerate lib/database.types.ts; RLS verification sequence for every table (Part 20.2 item 1),
        | the new tables included.
MB-T020 | lib/billing/entitlements.ts: resolveEntitlements, hasFeature, featureLimit, requireFeature,
        | claimQuota, the caches and the tag; tests for every status in Part 14.5 and every grant rule.
MB-T021 | lib/billing/gate-guard.test.ts (Part 14.6).
MB-T022 | components/billing/feature-gate.tsx + plus-promo.tsx (all six variants) + promo-dismiss.tsx + tests
        | (locked, hidden, no priced tier has it, budget of one per page, dismissed cookie honoured, kill switches).
MB-T022a| lib/billing/promo-placements.ts: the Part 25.4 launch list + promo-placements.test.ts.
MB-T023 | lib/billing/redact.ts + redact.test.ts (Part 18.3).
MB-T024 | lib/billing/providers/types.ts + index.ts (getProvider, enabledProviders).
MB-T024a| lib/billing/tax.ts: taxParamsForCheckout for every mode and kind + tests (Part 29.2); the tax-code
        | confirmation checklist in docs/billing/billing.md.
MB-T024b| lib/billing/trial.ts effectiveTrial + test over every precedence combination (Part 28.2).
MB-T025 | lib/billing/providers/stripe.ts: every call in Part 16.2 (tax params spread, trial params, trial_end for a
        | comp holder, tax_behavior and tax_code on catalog calls), both period-date shapes, tests.
MB-T026 | lib/billing/sync.ts: syncMembershipFromProvider, syncPurchaseFromProvider, audit, revalidate; tests.
MB-T027 | lib/billing/webhook-handler.ts + app/api/billing/webhook/stripe/route.ts; replay, order,
        | livemode and signature tests (Part 20.2 items 3, 4, 5).
MB-T028 | WITHDRAWN (Part 31.3). The free tools are NOT wired to feature gates. Their registry keys exist so
        | the switchboard can show them and so a gate can be added the day one moves out of Free, in a task
        | of its own for that one surface. The only Phase 0 wiring is the Manager Pulse enqueue reading the
        | quota key (Part 14.1 rule), which is a read of a number rather than a gate.
MB-T029 | security review sub-agent: Part 20.2 in full, before anything sells.
```

### Phase 1: selling, Stripe

```
MB-T030 | app/api/billing/checkout/route.ts (Part 17.1, the comp-holder and one-trial rules of Part 28) + tests on
        | the defense order.
MB-T031 | app/api/billing/portal/route.ts + app/api/billing/status/route.ts.
MB-T032 | lib/billing/copy.ts: renewalSentence, finalSaleSentence, trialSentence, pricePhrase + tests;
        | lib/billing/refund-policy.ts (the Part 30 constant) + copy.test.ts equality with the page.
MB-T032a| lib/billing/plus-copy.ts: every structural string of Part 27 + lib/copy-guard.test.ts.
MB-T033 | components/billing/tier-cards.tsx + tier-comparison.tsx (Part 19.1, 27.3) + tests.
MB-T033a| /plus: the sales page, all ten sections (Part 27.1) + /api/og/plus.
MB-T033b| /plus/tour (Part 27.2).
MB-T033c| /plus/compare (Part 27.3).
MB-T033d| /plus/welcome (Part 27.5), including the success handling moved here from the membership page.
MB-T033e| /refund-policy (Part 23.6, Part 30).
MB-T034 | /my-beacon/membership (Part 19.2): status in words including comp and trial states, cancel/keep/switch
        | controls, the "What your tier can do" panel, the Notifications line.
MB-T035 | beacon-rail.tsx line + /my-beacon/account panel (Membership and purchases, Notifications).
MB-T036 | header Beacon+ control and tier badge (Part 19.5); footer link; /tools Beacon Plus card.
MB-T037 | lib/email/billing-emails.ts: welcome, renewal reminder, payment failed, cancellation, ended, trial ending,
        | comp started, comp ending, comp ended; tests on wording; every date through formatEastern.
MB-T038 | app/api/cron/billing-reconcile/route.ts (four sweeps, Part 18.5 and 28.1, plus the daily tax status read of
        | Part 29.3) + CRON_JOBS entry + vercel.json schedule.
MB-T039 | Terms section 10, section 9 amendment, Privacy section (Part 23.2, 23.4).
MB-T040 | /donate, donation receipt, /about, donations.md copy (Part 23.1).
MB-T041 | account deletion cancels the membership first (Part 17.9).
MB-T042 | /admin/billing overview (with the tax status line) + /admin/billing/settings (every Part 15.1 key, the
        | tax section of Part 29.3, the promotion switches) + settings-coverage.test.ts.
MB-T043 | /admin/billing/tiers: list, edit (trial_days, trial_requires_card), prices (create-and-archive through the
        | provider), feature checklist, the priceless-public-tier notice.
MB-T044 | /admin/billing/features: catalog, visibility, marketable, headline, pitch, story, with the denylist and the
        | headline rules enforced on save.
MB-T045 | /admin/billing/members: search, give a tier, extend, change tier, end now, grant, revoke, resync, resend
        | welcome, refund an invoice, the bulk comp form (Part 19.6, Part 28.1) + lib/billing/comp.ts + tests.
MB-T045a| /admin/billing/codes + app/actions/billing-codes.ts (Part 28.3 admin half).
MB-T045b| /plus/redeem + the redeemMembershipCode server action with both rate limits (Part 28.3 reader half) + tests.
MB-T045c| /admin/billing/promotions + the impressions counters (Part 25.7).
MB-T046 | /admin/billing/events + /admin/billing/audit.
MB-T047 | /admin index Billing card and Notifications card.
MB-T048 | docs/billing/billing.md: the Dashboard settings (Part 23.5), Stripe Tax activation and the tax code
        | confirmation, the env vars, the runbook.
MB-T049 | accessibility + security review sub-agents across Phase 1; owner walkthrough with a screen reader of
        | join, cancel, keep, redeem a code, and every promotion variant, in test mode.
MB-T049a| Wire the launch promotion placements that do not depend on Beacon Link (schedules.matchup,
        | power_pulse.strip, dashboard.card, manager_pulse.footer, account.notifications), one task per surface in
        | progress.md, each one file.
```

### Phase 2: one-time services

```
MB-T050 | lib/billing/intake.ts: the field schema, validation, the league/roster/trade field loaders; tests.
MB-T051 | app/api/billing/purchase/route.ts (Part 17.8 step 1).
MB-T052 | /services and /services/[slug].
MB-T053 | /my-beacon/purchases and /my-beacon/purchases/[id] with the intake form and plain-paragraphs.tsx.
MB-T054 | app/actions/billing-intake.ts submitIntake.
MB-T055 | /admin/billing/products with the intake builder and grant list.
MB-T056 | /admin/billing/orders: the queue, Start, Deliver, Refund.
MB-T057 | emails: purchase receipt, order queued, delivered, grant activated, refund, intake reminder, dispute.
MB-T058 | the three advertising links (Part 19.3) behind purchases.enabled.
MB-T059 | scripts/migrate-tier-price.ts (Part 17.6), dry run by default.
MB-T060 | Stripe receipts toggles recorded and set (Part 21).
MB-T061 | accessibility + security review sub-agents across Phase 2.
```

### Phase 3: PayPal and Venmo (requires Part 12.2 = yes)

```
MB-T070 | THE SPIKE (Part 16.3), in sandbox: redirect vs SDK for Venmo; Venmo-funded subscriptions;
        | Stripe's custom payment method as an alternative for one-time. Findings recorded in 16.3 first.
MB-T071 | lib/billing/providers/paypal.ts: auth, orders, subscriptions, plans, cancel, refund, verify; tests
        | with recorded sandbox fixtures.
MB-T072 | app/api/billing/webhook/paypal/route.ts + app/api/billing/paypal/return/route.ts.
MB-T073 | CSP additions for PayPal hosts (only if the spike says SDK) + components/billing/paypal-buttons.tsx.
MB-T074 | /plus and /services/[slug] PayPal buttons; /my-beacon/membership PayPal controls (Part 16.4).
MB-T075 | admin: PayPal plan creation on price create; settings providers.paypal.
MB-T076 | env: PAYPAL_* in .env.local and the deploy; documented in CLAUDE.md env section.
MB-T077 | accessibility + security review sub-agents; the CSP diff reviewed line by line.
```

### Phase 4: Beacon Link entitlement (when Beacon Link is built)

```
MB-T080 | performSleeperAction step 2a (Part 14.6) + test; startSleeperLink asserts beacon_link.access.
MB-T081 | resolveCockpitContext gains `entitled`; action-button.tsx gains `locked`, rendering plus-promo's locked
        | variant (Part 25.2) and opening the dialog variant.
MB-T082 | Trades inbox asserts beacon_link.trades_inbox; the Trades nav entry renders the league.trades_tab panel for
        | a non-member.
MB-T083 | Wire the Beacon Link promotion placements (lineups.*, trade_ideas.*, transactions.pending, faab.*,
        | overview.chat, account.beacon_link), one task per surface in progress.md. The keys are already on the
        | plus tier from the seed, so no assignment step exists.
MB-T083a| /plus section 3 ("Act on Sleeper from FF Beacon") switches from hidden to shown when
        | beacon_link_settings.enabled flips; verify the copy against the denylist one more time with the real
        | action list.
MB-T084 | CLAUDE.md: the rules in Part 33.
```

### Phase 5: email notifications (Part 26)

```
MB-T090 | lib/notifications/kinds.ts: the registry of Part 26.2 + kinds.test.ts (every key has a settings entry,
        | a dedupe function, a build function and a preferences label).
MB-T091 | lib/email/send.ts gains optional headers; test that List-Unsubscribe headers pass through unchanged.
MB-T092 | lib/notifications/default-settings.ts + settings.ts (zod) + the coverage test (Part 26.7).
MB-T093 | lib/notifications/emit.ts emitNotificationEvent (never throws; dedupe conflict ignored) + tests.
MB-T094 | lib/sleeper-handle/resolve.ts resolveViewersBySleeperUserIds + guard test allow-list entry with reason;
        | lib/notifications/subscribers.ts loadSubscribedRosters + tests.
MB-T095 | lib/notifications/dispatch.ts: claim, resolve recipients, every skip reason in order, batch, insert-then-send,
        | quiet hours, failure path; tests for each reason and for the insert-before-send guarantee.
MB-T096 | app/api/cron/notifications/route.ts + CRON_JOBS entry + vercel.json (*/10 * * * *) + the Monday-night
        | league_sync_jobs enqueue window.
MB-T097 | lib/email/notification-emails.ts: one build per kind with fixture tests; the common footer; plain text.
MB-T098 | Hooks: league-pulse.ts (league_trade_alert), league-power-pulse.ts (power_pulse_shift), the news ingestion
        | (roster_news, after MB-T105), action-envelope.ts (beacon_link_receipt, Phase 4). One task per hook.
MB-T099 | Scheduled producers: matchup_result, matchup_preview, lineup_alert, waiver_reminder, weekly_digest, each
        | its own pure module under lib/notifications/producers/ with a test on the window and the payload.
MB-T100 | lib/notifications/inbox-poll.ts (trade_offer, trade_offer_resolved), through the token bucket; ships with
        | BL-T020.
MB-T101 | /my-beacon/notifications (Part 26.4) + app/actions/notifications.ts + tests; the Free-reader rendering.
MB-T102 | app/api/notifications/unsubscribe/route.ts (GET page, POST flip, one-click) + rate limit + tests.
MB-T103 | /admin/notifications (Part 26.7): settings, queue, sent ledger, skipped breakdown, send-me-a-sample.
MB-T104 | Confirm Sleeper's waiver_day_of_week origin against a known league; record in Part 26.2;
        | waiverProcessingWeekday() + test.
MB-T105 | Verify news_items carries a resolved player id (or add the linkage in the ingestion); record in Part 26.2.
MB-T106 | Terms and Privacy: the notifications sentences (Part 23.2, 23.4); the "why you got this" footer copy.
MB-T107 | accessibility + security review sub-agents across Phase 5: the preferences page, the unsubscribe route
        | (GET is idempotent, token never logged, constant-time compare), the dispatcher's entitlement re-check,
        | and the "never runs a model" rule verified by grep for the forbidden imports.
```

### Phase 7: League Home and custom domains (Part 31.4a, 31.4b), after Phase 1's league plans

```
MB-T140 | THE CHECK. Re-verify against Cloudflare's API reference that Registrar has no register-new-domain call and
        | whether the token can flip auto_renew; verify Vercel's project-domains and domain-config endpoints and
        | response shapes in a sandbox project. Record both in 31.4b before any other Phase 7 task.
MB-T141 | migration 0300 league_home_settings + the league-home storage bucket + policies; RLS sequence.
MB-T142 | migration 0301 league_domains + league_domain_routes view + discord_role_orphans; RLS sequence.
MB-T143 | lib/league-home/modules.ts registry + lib/league-home/layout.ts (zod, hero-first, unknown-id drop, half
        | pairing, accent contrast check) + tests.
MB-T144 | components/league-home/modules/*: one server component per module, each reading its cache and rendering
        | its honest empty line; one task per module in progress.md.
MB-T145 | /leagues/[id]/home + /home/rules: the page, pulseLeagueCore then Derived behind Suspense, visibility, the
        | grace-period editor line, the nav "Home" entry first for plan leagues.
MB-T146 | /leagues/[id]/home/edit + app/actions/league-home.ts saveLeagueHome: editor check, fieldsets, move up and
        | down, size radios, text areas with counts, links rows, logo upload through the avatar pipeline, slug
        | availability on blur, audit rows, focus to the status line.
MB-T147 | /api/og/league-home/[league_id].
MB-T148 | Wildcard subdomain: *.leagues.ffbeacon.com on Vercel and Cloudflare by hand (recorded); slug routing in
        | middleware; previous_slug 308 for 90 days.
MB-T149 | lib/domains/rdap.ts + lib/domains/policy.ts + the request form on /plus/league and in the editor's Address
        | block; sendDomainRequested.
MB-T150 | lib/domains/cloudflare.ts (zone lookup, DNS upsert, registrar read, DNS delete) + lib/domains/vercel.ts
        | (add, add www redirect, verify read, config read, delete); ten-second timeouts; reason vocabulary; tests
        | with recorded fixtures.
MB-T151 | connectLeagueDomain + reconcile sweep 9 (verify polling, 48-hour alert) + disconnect on grace expiry +
        | reconnect; sendDomainConnected / sendDomainDisconnected.
MB-T152 | middleware.ts host routing: SITE_HOST and preview passthrough, subdomain and custom lookups through the
        | public view with 60-second module-scope cache, the rewrite table, the two request headers, updateSession
        | skipped for league hosts; tests for a spoofed unknown host, a known host, and every rewrite.
MB-T153 | The League Home shell in the root layout: header, section nav, "Powered by FF Beacon" footer, no site nav,
        | no promotions, every session-bound action rendered as a link to ffbeacon.com; canonical tags both ways.
MB-T154 | /admin/billing/domains + the league-plans page link; the wildcard health check.
MB-T155 | /plus/league copy for the three parts of the plan; the three FAQ entries; Terms sentence on domain
        | ownership (Part 23.2).
MB-T156 | CLAUDE.md env section: the five new env vars; docs/billing/billing.md: the Cloudflare token scopes, the
        | Vercel token, the wildcard record, the purchase runbook.
MB-T157 | accessibility + security review sub-agents across Phase 7: the editor's every control native and labelled;
        | the layout validator drops unknown ids; the host table is the view and nothing else; no session is read
        | on a league host; the DNS and Vercel clients never log provider text; the accent contrast check.
```

### Phase 6: the gap-review additions (Part 31), each tagged with the phase it ships beside

```
MB-T110 | [P0] migration 0296 email_suppressions + email_bounce_counts; lib/email/suppression.ts; send.ts gains
        | `category` and the suppression check + tests (31.5).
MB-T111 | [P0] migration 0297 league_plans + view + memberships.league_plan_id + membership_tier_prices.kind (31.4).
MB-T112 | [P0] migration 0298 terms_acceptances + view; lib/legal/versions.ts; "Version <date>" under the three
        | legal H1s (31.12).
MB-T113 | [P0] migration 0299 the column additions of 31.20, one alter per concern with its comment.
MB-T114 | [P0] lib/billing/entitlement-fallback.ts + resolver step 6 + tests for degraded answers (31.10).
MB-T115 | [P0] lib/notifications/tokens.ts: HMAC-derived unsubscribe and calendar tokens, hash lookup, rotation
        | test; NOTIFICATIONS_TOKEN_SECRET in .env.local and CLAUDE.md (31.11).
MB-T116 | [P1] Tier archive, delete-refusal with count, "Move members to...", and the fully-editable tier rules of
        | Part 14.2 in /admin/billing/tiers + trigger test that only the default tier is protected.
MB-T117 | [P1] Pause: membership page control, Stripe pause_collection in the provider, paused status in the sync,
        | reconcile sweep 7 for PayPal resume, sendMembershipPaused / Resumed (31.1).
MB-T118 | [P1] Season pass: fulfilment 'tier' + grant_tier in the products admin, the sync branch, product page end
        | date in words (31.1).
MB-T119 | [P1] lib/notifications/league-mix.ts readerLeagueMix + the three type-aware sentences on the notifications
        | page, the pause control, the sales page and the FAQ; lib/notifications/copy.test.ts (no bare "offseason");
        | the products admin "Suits" field (31.1, 26.9).
MB-T120 | [P1] League plans: /plus/league, the seat price per tier, the pending-plan-then-checkout route, the sync,
        | lib/billing/league-seats.ts reconcileSeats + reconcile sweep 6, the three emails, the owner's seat list,
        | /admin/billing/league-plans (31.4). Split into one task per file in progress.md.
MB-T121 | [P1] Attribution: ?via on every promotion link, the bp_via cookie, metadata[via] on every checkout, the
        | sync writing attribution, converted counter, conversions on the promotions page (31.14).
MB-T122 | [P1] Terms acceptance writes in the checkout, purchase, redeem and league-plan routes; members page list
        | (31.12).
MB-T123 | [P1] Evidence pack server action + download (31.9).
MB-T124 | [P1] Price form net-of-fees note + settings.fees (31.18).
MB-T125 | [P1] cron-health billing checks + email sections (31.15, the billing half).
MB-T126 | [P1] The beta-cohort note tag and members-page filter (31.17).
MB-T127 | [P1] docs/billing/billing.md: the PayPal paperwork checklist (31.19), the mail.ffbeacon.com DNS records
        | (31.5), the Discord role and bot permission needs (31.2).
MB-T128 | [P2] Gift memberships: fulfilment 'gift_code', the mint-on-paid branch, recipient_email intake field,
        | sendGiftPurchased / sendGiftReceived (31.16).
MB-T129 | [P5] Resend webhook route with Svix verification, the four event handlers, soft-bounce counting,
        | master-off on hard bounce or complaint + tests with recorded fixtures (31.5).
MB-T130 | [P5] Sending subdomain: EMAIL_FROM_NOTIFICATIONS, the notification and membership builders use it; the
        | postal footer line and the validator that requires it; warm-up caps (31.5).
MB-T131 | [P5] Roll-ups: buildRollup per kind with two- and nine-league fixtures; dispatcher step 5 rewritten; the
        | cap holds instead of drops + tests (31.6).
MB-T132 | [P5] Time zone: the picker, per-reader window resolution, kickoff-aware lineup alert from nfl_game_odds
        | (31.7).
MB-T133 | [P5] Inbox-poll activity-based cadence (league status and recent transactions, never the month), waking
        | hours, per-reader backoff, maxPerTick + tests including a dynasty-league-in-March fixture and a rolled-league
        | fixture (31.8); reconcile sweep 8 pruning (31.8).
MB-T133a| [P5] Every scheduled producer gated on real rows (matchups present, Power Pulse fresh, waivers processing or
        | recently processed) with tests proving a dynasty league in March still receives trade, waiver and news kinds
        | and a redraft league in March receives nothing (26.9).
MB-T134 | [P5] Discord channel: lib/discord/dm.ts, channels on the preferences page, buildDiscordMessage per kind,
        | deliveries.channel, the failure reasons (31.2).
MB-T135 | [P5] Discord role: lib/discord/role-sync.ts syncDiscordRole with every state; discord_role_id per tier and
        | the tiers-page role picker with the bot-position check; sync on every granting transition in and out (31.2).
MB-T135a| [P5] Discord role on connect and disconnect: the post-link step and the read-id-then-remove-then-unlink step
        | in app/my-beacon/account/actions.ts; discord_role_orphans; the status line wording; tests for both paths.
MB-T135b| [P5] Discord role nightly: the two-pass sweep (entitled readers, then every guild member holding a managed
        | role) in the reconcile cron, paged; a test that a hand-added role on an unentitled member is removed.
MB-T135c| [P5] "Connect Discord to get your Plus role" on the membership page, the welcome page and /plus (31.2).
MB-T136 | [P5] Calendar feed route + notifications.calendar key + the page controls + reset (31.13).
MB-T137 | [P5] cron-health notification checks (31.15, the notification half).
MB-T138 | [P5] accessibility + security review sub-agents across Phase 6: the Resend webhook fails closed, no
        | address stored anywhere new, seat reconciliation cannot grant outside a plan's league, the calendar and
        | unsubscribe routes are constant-time and rate limited, the Discord DM path never logs a user id in clear.
```

---

## Part 33. Rules this feature adds, for CLAUDE.md

- Entitlement is decided on the server, at the point of use, every time,
  through `lib/billing/entitlements.ts`. A client component receives a
  boolean for rendering and nothing else; the action behind it re-checks.
  `lib/billing/gate-guard.test.ts` fails the build on an ungated action in a
  gated module.
- A feature gates a tool, a section, an action or a quota, never a column or
  a number a reader can already see. "No data hidden by tier" is checked
  beside "no data hidden at any breakpoint".
- The feature catalog is `lib/billing/feature-registry.ts`. Adding a feature
  is a registry entry plus a deploy; assigning it is an admin action in the
  panel, never a migration, except the launch seed (0287). A feature in no
  tier is granted to nobody.
- The default tier's slug is `free`, it holds every launch-day feature, and
  it cannot be deleted or deactivated. Day one of billing changes nothing for
  anybody.
- Every payment happens on a provider's hosted page. No card field, no wallet
  token, no payment iframe on this origin, and `Permissions-Policy: payment=()`
  stays. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unused by design.
- The webhook is a doorbell, not a letter: a handler fetches the object from
  the provider and writes THAT. Payloads are never applied as fact. Signature
  first, fail closed, one row per event id, claim before work, livemode
  checked.
- Provider objects are stored as allow-listed projections
  (`lib/billing/redact.ts`), never raw, under the documented exception to the
  raw-object rule. No table in `lib/billing` has an email, name or address
  column.
- Amounts and price ids never travel in a request from a browser. A request
  carries a tier slug and an interval, or a product slug; the server resolves
  the rest.
- `syncMembershipFromProvider` and `syncPurchaseFromProvider` are the only
  writers of membership and purchase state. Webhooks, success pages, the
  reconcile cron and admin resync all call them.
- Cancelling takes no more steps than joining. One page, one button, one
  confirm. No retention screen, no email-to-cancel.
- The renewal sentence is `renewalSentence()` and is used everywhere it
  appears; the four surfaces cannot disagree.
- One receipt per payment: ours for one-time purchases and donations,
  Stripe's for subscription invoices. The Dashboard toggles are recorded in
  `docs/billing/billing.md`.
- `billing_settings.enabled` off hides every selling surface and keeps every
  member a member. It is the emergency switch and it is safe to flip.
- Deliverables are plain text rendered as text nodes. No HTML, no markdown
  renderer.
- The reconcile cron iterates memberships and purchases, bounded and paged.
  It never iterates leagues and never touches an on-demand model.
- The product is Beacon Plus; the mark is Beacon+ and is used only where
  Part 12.1 allows. Both come from `lib/billing/constants.ts`.
- Paid capabilities are promoted INSIDE THE TOOLS at the point of use through
  `components/billing/plus-promo.tsx` and the placement registry, one per
  screen, never modal, dismissable, hidden the moment the feature cannot be
  bought. The header control and the tools-hub card are the only persistent
  marks.
- NOTHING ON THE SITE DESCRIBES HOW AN ACTION REACHES SLEEPER. Copy names the
  outcome and the place and stops. `lib/billing/promo-copy.ts` holds the
  denylist, the test runs over every pitch, story, placement, page string and
  notification template, and the admin save path refuses a violation.
- Beacon Link is included in Plus, listed on `/plus`, and never the headline
  there. The `headline` flag cannot be set on a `beacon_link.*` key.
- The notification system observes and never computes. It never calls a
  model refresh or imports `pulseLeagueDerived`; raw freshness comes from the
  existing budgeted `league_sync_jobs` queue. One email per (reader, kind,
  dedupe key) by unique index, row inserted before the send. Entitlement, the
  master switch, the kind switch, the league mute and the daily cap are
  re-checked at send time. Transactional emails ignore the master switch and
  live in a different file from notification emails.
- Every scheduled notification window is a setting in America/New_York; the
  cron expression carries no product meaning.
- A comp, a trial and a code are three different sentences and one table.
  All sales are final; no reader-facing control offers a refund; a refund is
  an admin action with a note. A cancelled membership runs to the end of its
  paid period. `/refund-policy` is the constant in
  `lib/billing/refund-policy.ts`.
- Tax is a block with a mode in `lib/billing/tax.ts`; the Stripe provider
  spreads `taxParamsForCheckout` and adds nothing tax-related of its own.
- Tiers are the admin's entirely. Only the default tier is protected; every
  other tier can be renamed, re-priced, re-featured, archived or deleted from
  the panel, and no code assumes what a tier contains beyond the seed's
  day-one rows.
- The free tools are not wired to feature gates. A gate is added to one
  surface the day that surface leaves Free, in its own task.
- A resolver failure returns the reader's last good answer for up to fifteen
  minutes, marked degraded; a degraded answer shows no promotion and is never
  written to the durable cache.
- Notifications ROLL UP and never drop: many events of one kind become one
  email with a section per league, and the daily cap holds an email for the
  morning rather than discarding it.
- Every send passes the suppression list; a hard bounce or a complaint turns
  the reader's master switch off and the address is stored only as a hash.
  Notifications and membership mail send from `mail.ffbeacon.com`; receipts
  keep the main domain.
- A notification email is the one surface rendered in the reader's chosen
  time zone. Every other display stays America/New_York.
- Unsubscribe and calendar tokens are HMAC-derived from
  `NOTIFICATIONS_TOKEN_SECRET`; the database holds hashes only; rotating the
  secret is the incident response.
- A seat in a league plan follows the roster, is reconciled from
  `rosters.owner_user_id`, and can never be granted to a roster outside the
  plan's league.
- The Discord role is a courtesy re-derived from our table on every sweep,
  never a source of truth. It is granted the moment Discord is connected,
  removed the moment it is disconnected or the membership stops granting, and
  the nightly sweep removes any managed role from anyone not entitled.
- NOTHING IS KEYED TO THE MONTH. Every notification fires on a real row in a
  real league; the inbox poll's cadence follows league activity; "offseason"
  is never written on its own, only "the redraft offseason" or "between the
  championship and the next draft", and a reader whose league mix is unknown
  is told about both calendars.
- League Home reads caches and never computes; its layout is validated
  against the module registry on every save; a custom-domain request is a
  guest request with no session, every session-bound action links back to
  ffbeacon.com, and the middleware host table is the `league_domain_routes`
  view and nothing else.
- A custom domain is registered and held by FF Beacon in the owner's
  Cloudflare account; the plan holder buys its use for the life of the plan;
  purchase is the one manual step and everything either side of it is
  automated.

---

## Part 34. Open decisions for the owner

Every gating decision is made (Part 12). What remains are numbers and
choices the owner makes in the panel after the build, listed so nobody
mistakes them for gaps in the spec:

1. The prices of the `plus` tier (monthly and yearly), set in
   `/admin/billing/tiers`. Until one exists the tier is not listed and no
   promotion renders (Part 14.2), which is the correct state for a site that
   is not yet selling.
2. Trial days and whether a trial needs a card (Part 28.2), global and per
   tier. Default 0 and yes.
3. Whether any existing feature ever leaves Free. The plan's position is
   none, and Part 12.6 records the owner's agreement; it stays a panel action
   if that changes.
4. Which promotion placements stay on, judged by the dismissal rate on
   `/admin/billing/promotions` (Part 25.7). All are on at launch.
5. The notification thresholds and windows (Part 26.7). The defaults are
   stated; the owner tunes them against the skipped-reason breakdown.
6. Which kinds a new reader gets by default (`kinds[key].defaultOn`).
7. Whether the one-time services launch with Phase 1 or after. They are
   independent of tiers and could go first.
8. Whether an existing member keeps an old price when a tier's price changes
   (the plan's default) or is migrated by the script.
9. The two Stripe tax codes (Part 29.1), confirmed against Stripe's list
   before launch.
10. The legal read of `/terms`, `/privacy` and `/refund-policy`, which the
    owner has taken on themselves; a lawyer's edits replace the Part 30 text
    in one constant.
11. Whether pausing is offered, and whether any season pass product is
    listed and for which league type (Part 31.1). Defaults: pausing on, no
    season pass until the owner creates one.
12. The per-seat league plan price per tier (Part 31.4), and which Discord
    role, if any, each tier maps to (Part 31.2).
13. The postal line for the email footer (Part 31.5), required before the
    dispatcher can be switched on.
14. How long the beta cohort runs before selling is switched on (Part 31.17).
15. The allowed domain endings and the price cap per domain (Part 31.4b),
    the home grace period after a plan ends, and which league-home modules
    are on by default for a new plan league (Part 31.4a). Defaults: com, net
    and org; $20; 30 days; hero, standings, this week, activity, odds.
