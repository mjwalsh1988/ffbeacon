# Beacon Link: acting on a reader's real Sleeper account

Status: PLAN ONLY. Nothing in this document has been built. Written 2026-09-05
against `main` at `bca707d`. Task prefix for the build: `BL-T###` in
`progress.md`. Next available migration number after the Manager Pulse speed
plan's block (which reserves 0261 to 0266) is 0267; this plan starts there.

THIS DOCUMENT IS THE SPEC. It carries every file, function, migration, RPC,
env var, header and test the build needs, so nothing is left to
interpretation. The companion artifact is the plain-language pitch; it carries
none of this detail.

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

Migration `0267_sleeper_connections.sql`:

```sql
-- Migration 0267: sleeper_connections (a reader's linked Sleeper session)
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
   0268, keyed by user, holding the Sleeper-side handle to the pending
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

Migration `0269_sleeper_action_log.sql`: one row per attempted action, owner and
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
admin-editable in a `beacon_link_settings` row (migration 0270, the same
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

1. Signed out: none of this exists. No nav entry, no card, no button, no route
   that renders anything (the routes 404-or-redirect to login exactly as the
   Manager Pulse report route does).
2. Signed in, not connected: the "Connect Sleeper" card and the connect prompt
   on a league the reader is in. No action buttons anywhere.
3. Signed in and connected: action buttons on leagues the reader is a member of,
   the Trades inbox, the My Team controls, chat.

Not advertised: no tools-hub card, no marketing page, no footer link. Beacon
Link is discoverable from the account page and from a league you are in, and
nowhere else, per the owner's instruction. A `beacon_link_settings.enabled`
kill switch (default false until launch) hides every surface at once, so the
whole feature can be turned off without a deploy if Sleeper objects.

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
BL-T004 | migration 0267 sleeper_connections + the status view; RLS sequence verified.
BL-T005 | migration 0268 sleeper_link_challenges (short-lived link challenges).
BL-T006 | migration 0269 sleeper_action_log.
BL-T007 | migration 0270 beacon_link_settings (buckets, consent_version, enabled kill switch).
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
