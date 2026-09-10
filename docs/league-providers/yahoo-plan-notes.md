# Yahoo plan notes (handoff file)

Working notes behind `docs/league-providers/league-providers-and-yahoo-plan.md`.
This file exists so a fresh session can continue the plan without redoing the
research. It is a scratch ledger, not a spec: the plan file is the spec.

Status line (update every time this file changes):
- 2026-09-08 session 1: research phase. Codebase inventory, Yahoo API brief and
  Yahoo developer-program brief were dispatched to three sub-agents. Live schema
  and player-id coverage were measured directly against Supabase. The plan
  file was then written in full (Parts 0 to 18 plus Appendix A). The artifact
  was NOT published and the docs/README.md row was NOT added.
- 2026-09-09 session 2: review and revision 2. Both files re-read in full;
  every repository claim in the plan re-checked against `main` at `277ddbf`
  (section 10 below lists what was checked and the three corrections);
  Yahoo facts re-verified against the live pages and the GitHub threads as of
  today (section 8a); the other hosts surveyed (Appendix C of the plan). Added
  to the plan: Part 4.8 (provider module contract and the third-provider
  checklist), Part 4.9 (capability matrix), Part 10.10 (public capabilities
  page), Appendix B (Yahoo setup walkthrough with a paste-ready application),
  Appendix C (other hosts), five capability keys, `auth_kind` widened to five
  values, tasks LP-T013 and LP-T014. The plain-language artifact was published
  (section 2 has the URL). docs/README.md row still NOT added; it is LP-T011.

Nothing in this folder has been built. Both sessions were PLANNING ONLY.

---

## 1. What the owner asked for (verbatim intent, condensed)

Session 1:
- Integrate Yahoo Fantasy Football leagues "just like Sleeper is".
- Refactor the code into PROVIDERS (Sleeper, Yahoo, future others) with
  separate components per provider.
- Each provider declares CAPABILITIES, because not every provider supplies the
  same data; every feature inside a tool must be gated on a capability.
- Every surface on the site should work for a Yahoo league or a Sleeper league.
  Would You Rather, for instance, pulls trades from both.
- ONE set of tables for leagues, trades and so on, unless there is a good reason
  to separate, and then explain why.
- Player lists: keep Sleeper's and Yahoo's player lists in SEPARATE tables,
  each carrying the provider's own player id, and an FF Beacon player id (uuid)
  that both point at. Must be "100% clean".
- Go through every edge case. No assumptions: confirm how things work against
  sources.
- Deliverables: one plan file in docs following the folder pattern, this notes
  file, and a plain-language artifact with the owner's own to-do list
  (developer access application and so on), returning paths and a summary.

Session 2 (2026-09-09), restated:
- Fully review both files first and pick up where session 1 left off.
- The plan must be fully fleshed out for a modular provider setup, with
  Sleeper and Yahoo as the two providers and new providers easy to add.
- Every provider needs a VIEWABLE list of capabilities, used to make sure no
  feature, component or section is shown for a provider that lacks it.
- Full instructions for setting up the Yahoo developer platform and account.
- Research and planning only; touch nothing but the plan files.
- An artifact at the end with the plan in layman's terms and in sales terms.

## 2. Files and folders

- Plan (spec): `docs/league-providers/league-providers-and-yahoo-plan.md`
- Notes (this file): `docs/league-providers/yahoo-plan-notes.md`
- Artifact (plain-language and sales explanation), published 2026-09-09,
  title "League Providers":
  https://claude.ai/code/artifact/d0d24f75-f358-46b6-acfb-f67dfec87561
  Source HTML lives in the session scratchpad only; republish by passing
  this URL to the Artifact tool from any session.
- `docs/README.md` needs a new row for the `league-providers` folder
  (LP-T011). Not added in either session, on purpose: the instruction was to
  touch only the plan files.

Written against `main` at `277ddbf` (2026-09-08, re-checked 2026-09-09). Next
free migration number is 0279 (0278 is `autovacuum_thresholds`, confirmed by
listing `supabase/migrations/` on 2026-09-09). The unbuilt Beacon Link plan
names 0271 for `sleeper_connections`; that number has since been consumed by
`0271_players_sleeper_slug_tail.sql`. Numbers are an ordering; whichever build
lands first takes the next free one.

Task prefix for progress.md: `LP-T###` (League Providers). Confirmed unused on
2026-09-09. Prefixes in use as of today (grep of progress.md): SS, RD, LA,
PE, ML, MP, PERF.

## 3. Facts verified against primary sources (with the URL)

Yahoo developer portal and access:
- The Fantasy API docs moved. `https://developer.yahoo.com/fantasysports/guide/`
  now 308-redirects to `https://sports.yahoo.com/developer`. The docs are at
  `https://sports.yahoo.com/developer/docs/`. The old OAuth flow URL with a
  capital C (`flows_AuthCode`) 404s; the live one is
  `https://developer.yahoo.com/oauth2/guide/flows_authcode/`.
- Access is APPLICATION AND REVIEW, not self-serve. From
  `https://sports.yahoo.com/developer`: three steps, "Application Submission",
  "Application Review", "Access": "If you're approved, we'll follow up with
  next steps." The form is `https://sports.yahoo.com/developer/access/`.
- Form facts (`/developer/access/`): "Expected Users" is required with bands
  "Small (< 1,000 users)", "Medium (1,000 - 100,000 users)", "Large (100,000+
  users)". CORRECTION 2026-09-09: the "Client ID" field is OPTIONAL. The page
  says "Existing Yahoo Developer Network users, enter the Client ID from your
  YDN account. New users without a YDN account can leave this blank, access
  will be provisioned after approval." (Session 1 recorded it as required.)
  "Access to the Yahoo Fantasy Sports API is read-only by default. If
  your use case is unique and requires read/write access, please include
  additional details in the notes section below." "The Yahoo Fantasy Sports
  API currently provides read access only. Write access is not available at
  this time." "Applications must clearly identify the product being built,
  the Yahoo Fantasy Sports data required, and the intended user base,
  including where access is limited to personal or single league use."
  "Given current request volume, incomplete or insufficiently detailed
  submissions cannot be evaluated and will be closed without further
  correspondence." No cost stated. No timeline stated. Re-read 2026-09-09,
  unchanged apart from the correction.
- Policies on the portal page: "Developers may create only a single account
  and must not use automated tools or other means to create multiple
  accounts." "Yahoo monitors API usage ... we may temporarily throttle or limit
  access." "Developers may not modify, reverse engineer, decompile, or
  otherwise alter the API or separate its underlying data."
- Attribution (portal page): "Developers using the Yahoo Fantasy Sports API
  must provide clear attribution by including 'Fantasy data provided by Yahoo
  Fantasy' within their products."
- App creation URL `https://developer.yahoo.com/apps/create/` redirects to a
  Yahoo login, so the form itself was not readable without an account. The
  2026 field list is known only from developer reports (section 8a).

OAuth 2.0 (`https://developer.yahoo.com/oauth2/guide/flows_authcode/`):
- Authorization: `https://api.login.yahoo.com/oauth2/request_auth`, GET or
  POST, params client_id, redirect_uri, response_type=code, state (optional),
  language (optional, default en-us).
- Token: POST `https://api.login.yahoo.com/oauth2/get_token`, params
  client_id, client_secret, redirect_uri, code, grant_type=authorization_code;
  or `Authorization: Basic base64(client_id:client_secret)`.
- Response: access_token, token_type "bearer", expires_in "3600",
  refresh_token, xoauth_yahoo_guid.
- Refresh: same endpoint, grant_type=refresh_token, refresh_token.
- FAQ (`https://developer.yahoo.com/oauth2/guide/faq/`): "all your refresh
  tokens are revoked after you change your password"; "The best practice is to
  store the latest refresh token as the refresh token may change"; a browser
  login is always required.
- Re-checked 2026-09-09: the flow page does not mention PKCE, code_challenge
  or code_verifier; the discovery document has no
  code_challenge_methods_supported; grants are authorization_code and
  refresh_token; scopes_supported openid, openid2, profile, email.

Fantasy API (`https://sports.yahoo.com/developer/docs/`):
- Base `https://fantasysports.yahooapis.com/fantasy/v2`.
- Keys: game `{game_id}` or `{game_code}` (docs example "461" and "nfl");
  league `{game_id}.l.{league_id}`; team `{game_id}.l.{league_id}.t.{team_id}`;
  player `{game_id}.p.{player_id}` (docs example "461.p.30121"). The docs
  page states 461 is the 2025 NFL game id and 399 is 2020.
- "A particular user can only retrieve data for private leagues of which they
  are a member, or for public leagues."
- Game sub-resources: metadata, leagues, players, dates, game_weeks,
  stat_categories, position_types, roster_positions. League sub-resources:
  metadata, settings, standings, scoreboard, teams, players, draftresults,
  transactions. Team sub-resources: metadata, stats, standings, roster,
  draftresults, matchups. Roster `team/{key}/roster;week=N`.
  Users `users;use_login=1` with games, leagues, teams. `out=` gives one level
  of extra sub-resources. Responses are XML by default; every library uses
  `?format=json`.
- Docs do not state a rate limit, a page cap, or write syntax. The page shows
  "HTTP Operations Supported: GET" on the resources it lists and links a
  2019 PHP gist as "PUTs and POSTs" with no body examples. The 25-per-page
  cap was readable on 2026-09-09 only in the Go SDK's README.

Game ids per NFL season (yfpy docs via search, `https://yfpy.uberfastman.com/quickstart/`):
2014=331, 2015=348, 2016=359, 2017=371, 2018=380, 2019=390, 2020=399,
2021=406, 2022=414, 2023=423, 2024=449, 2025=461. 2026 UNKNOWN as of
2026-09-09 (searched the four SDKs and the issue trackers; the only 2026 id
found anywhere is MLB 469). The plan resolves it at runtime from
`games;game_codes=nfl;seasons=2026` rather than hardcoding.

Player-id cross-reference:
- Sleeper's `/players/nfl` payload carries `yahoo_id`, `espn_id`, `gsis_id`,
  `sportradar_id`, `rotowire_id`, `fantasy_data_id`, `stats_id`, `swish_id`
  (seen in our stored `players.metadata.sleeper`). Christian McCaffrey:
  sleeper 4034, yahoo_id 30121, which is exactly the id in Yahoo's own doc
  example `461.p.30121`. So Sleeper's yahoo_id IS Yahoo's `player_id`.
- DynastyProcess `db_playerids.csv` header
  (`https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv`):
  mfl_id, sportradar_id, fantasypros_id, gsis_id, pff_id, sleeper_id, nfl_id,
  espn_id, yahoo_id, fleaflicker_id, cbs_id, pfr_id, cfbref_id, rotowire_id,
  rotoworld_id, ktc_id, stats_id, stats_global_id, fantasy_data_id, swish_id,
  name, merge_name, position, team, birthdate, age, draft_year, draft_round,
  draft_pick, draft_ovr, twitter_username, height, weight, college, db_season.
  Many recent rookies have yahoo_id "NA" there too. Confirmed 2026-09-09 via
  the nflreadr dictionary that it covers mfl, espn, fleaflicker, cbs, nfl,
  yahoo and sleeper, and not fantrax, underdog or draftkings.

## 4. Live database measurements (2026-09-08, project cilvpyivysjxpxbudkfa)

Counts: players 10,481; leagues 474; rosters 5,552; league_transactions
61,326; league_matchups 80,556; draft_selections 64,287.

`players.external_ids` keys in use: sleeper 10,481; fantasypros 714;
fantasycalc 526; ktc 519. No yahoo key anywhere yet.

Sleeper-supplied yahoo_id coverage (from `players.metadata.sleeper.yahoo_id`):
- All players: 5,448 of 10,481 have one.
- Active by position: QB 170/328, RB 324/659, WR 554/1211, TE 260/559,
  K 71/150, DEF 0/32.
- Players that appear in `rankings` (the ones that matter): QB 44/106,
  RB 52/208, WR 75/272, TE 39/136, K 29/58, DEF 0/32. Total 239 of 780.
  The gap is mostly recent-draft players. `players.draft_year` is null for
  every ranked player, so it cannot be used to characterise the gap.
- Sleeper DEF ids are team codes ("PIT", "IND", "LV"). Yahoo team defenses are
  ordinary player ids (UNVERIFIED which range; the API brief should say).

Conclusion: Sleeper's yahoo_id is a seed, not a mapping. The plan needs a
proper identity resolver (exact external id, then DynastyProcess csv, then
name+position+team match with a review queue).

Schema as it exists today (columns that carry Sleeper identity):
- leagues: id uuid, sleeper_league_id text NOT NULL UNIQUE
  (`leagues_sleeper_league_id_key`, plus `idx_leagues_sleeper_league_id` and
  `leagues_capture_state_idx(sleeper_league_id, capture_completed_at, status,
  season)`), name, season, sport, status, total_rosters, scoring_settings
  jsonb, roster_positions jsonb, format_config_id, last_pulsed_at,
  pulse_status, pulse_error, metadata, the three model status/detail/
  attempted/succeeded column sets, capture_completed_at, capture_error.
- rosters: sleeper_roster_id int NOT NULL, unique (league_id,
  sleeper_roster_id); owner_user_id text; co_owners jsonb; player_ids,
  starter_ids, reserve_ids, taxi_ids jsonb (Sleeper player id strings);
  draft_pick_assets jsonb; wins/losses/ties; points_for/against;
  waiver_position; waiver_budget; metadata.
- league_users: sleeper_user_id text NOT NULL, unique (league_id,
  sleeper_user_id); display_name, avatar, team_name, is_owner,
  is_commissioner, metadata.
- league_transactions: sleeper_transaction_id text NOT NULL, unique
  (league_id, sleeper_transaction_id); type, status, week, season, adds jsonb,
  drops jsonb, draft_picks jsonb, waiver_budget jsonb, roster_ids jsonb,
  created_at_sleeper timestamptz, metadata.
- league_matchups: sleeper_roster_id int NOT NULL, unique (league_id, week,
  sleeper_roster_id); matchup_id, points, starter_ids, starter_points,
  player_ids, player_points, is_final, metadata, synced_at, season.
- league_drafts: sleeper_draft_id text, slot_to_roster_id, draft_order,
  settings, metadata, picks_captured_at, pick_capture_attempts.
- draft_selections: sleeper_draft_id text NOT NULL, pick_no, round,
  draft_slot, roster_id, picked_by text, sleeper_player_id text, player_id
  uuid, is_keeper, sleeper_league_id text, season, draft_type, draft_status,
  format_slug, player_pool, teams, rounds, drafted_at, ingest_source, metadata.
- league_sync_jobs: sleeper_league_id text NOT NULL, unique active
  (user_id, sleeper_league_id) where status in (pending, processing);
  job_kind, manager_run_id, sleeper_calls, duration_ms.
- league_sync_attempts: actor_key, sleeper_league_id.
- manager_pulse_runs: sleeper_user_id text NOT NULL, sleeper_handle.
- manager_pulse_run_leagues: sleeper_league_id text NOT NULL.
- would_you_rather_trades: sleeper_transaction_id text NOT NULL,
  side_a_roster_id int, side_b_roster_id int.
- user_preferences.sleeper_league_settings jsonb keys seen live: username,
  sleeper_display_name, sleeper_user_id, sleeper_avatar, handle_verified_at,
  featured_league_id, shown_league_ids, signal_league_ids.
- players: id uuid, slug unique, external_ids jsonb (unique partial index on
  external_ids->>'sleeper' and ->>'ktc'; plain index on ->>'sleeper'),
  metadata jsonb keyed by source, source_synced_at jsonb, internal_attributes,
  search_name, search_last_name, sleeper_slug_tail.
- RLS on leagues and rosters: `{table}_select_public` for anon+authenticated,
  `{table}_service_role_all` for service_role.

Database extensions installed: pgcrypto 1.3, supabase_vault 0.3.1
(schema `vault`), uuid-ossp, pg_trgm, citext, pg_stat_statements. pgsodium is
available but not installed. Vault is the token-encryption answer.

## 5. Code facts read directly (not from an agent)

- `lib/sleeper-to-format.ts`: `deriveLeagueFormat(league: SleeperLeague)`
  (line 49) reads `settings.type` (0 redraft, 1 keeper, 2 dynasty, 3 chopped;
  only 2 is dynasty), `scoring_settings.rec` (>=0.95 ppr, >=0.4 half),
  `roster_positions` ("QB" count >= 2 or "SUPER_FLEX" => superflex),
  `bonus_rec_te` / `rec_te` >= 0.5 => TEP. `deriveKeeperStyle` (26),
  `deriveStatusVariant` (43), `mapToFormatSlug` (107), `describeDerivedFormat`
  (139), `pickClosestSupportedFormat` (171) all take `SleeperLeague` or its
  derivative. This is the file the provider abstraction has to turn into a
  provider-neutral `LeagueShape` input.
- `lib/league-scoring.ts`: `scoreStatMap(stats, scoring)` is a dot product
  over SLEEPER STAT KEYS (`rec`, `rec_yd`, `pass_yd`, `bonus_rec_te` ...).
  `isUsableScoring` requires one of pass_yd/rush_yd/rec_yd and one of
  pass_td/rush_td/rec_td. `closestScoringBase` reads `rec`. Every projection,
  Power Pulse, Positional WAR, Manager Ledger and Lineups number flows through
  this. DESIGN CONSEQUENCE: Yahoo `stat_modifiers` (stat_id => value) must be
  TRANSLATED INTO SLEEPER-KEYED `scoring_settings` at sync time so that every
  model downstream is untouched. The canonical scoring vocabulary of the
  product becomes "the Sleeper key set", documented as FF Beacon's own.
- `lib/league-category.ts`: `categorizeLeague(league: SleeperLeague)` (line
  52) reads `settings.best_ball === 1` and `settings.type === 2`. Yahoo has no
  dynasty type and no best ball flag, so the provider adapter must emit these
  as normalised fields.
- `progress.md` task format is in CLAUDE.md; phases are headed
  `## Phase N - name`.

## 6. Open questions the sub-agents were asked to settle

Answered in section 8 where the briefs settled them; still open where noted.

- Yahoo NFL stat_id table (4 pass yds, 5 pass td, ...): the docs' football
  sample settles the core ids (section 8); FG missed, PAT missed, IDP and
  bonus ids remain UNVERIFIED. Runtime read of `game/nfl/stat_categories` is
  the plan's source of truth; the spike records the table.
- Does the Yahoo scoreboard publish FUTURE weeks (the full schedule) or only
  current and past? CONFLICTING evidence; a probed capability in the plan.
- Are per-player weekly projections available: no. Only team_projected_points.
- Do trade transactions carry draft picks? Yes (a `picks` collection), with
  no season or slot. `can_trade_draft_picks` not found anywhere.
- Keeper flags: `is_keeper` on the player and `players;status=K`; nothing on
  draftresults.
- Historical depth: users;use_login=1/games lists every season the account
  played; game ids back to 2001.
- Rate limits: undocumented; community figures (HTTP 999, "Request denied").
- Whether a public league can be read with the APP's own token: there is no
  app-only token (no client-credentials grant), so every read is a user token.
- Terms of use: the Developer API terms (24-hour clause) are readable; the
  Fantasy-specific terms page is a 404 as of 2026-09-09 (owner's item 5a).
- Yahoo `guid` versus `xoauth_yahoo_guid`, and the openid scopes: openid,
  openid2, profile, email supported; `xoauth_yahoo_guid` labelled deprecated;
  the fantasy `guid` is read from users;use_login=1 after the exchange.
- Best ball on Yahoo: no flag found (UNVERIFIED as a negative). IDP: yes
  (position type D with DL, LB, DB).
- Position tokens Yahoo uses: QB, WR, RB, TE, K, DEF, W/R/T, BN, IR, NA seen;
  W/R, W/T, Q/W/R/T, D, DL, LB, DB UNVERIFIED as exact labels until the spike.

## 7. Architecture decisions made so far (written into the plan)

- One `league_providers` registry table (slug, display_name, is_active,
  capabilities jsonb, auth_kind), mirroring `source_registry`'s role.
  `auth_kind` admits five values from the first migration (public_handle,
  oauth2, credentials, api_key, session_cookie) so later providers never
  alter the registry; only the first two are used in this build.
- One set of league tables. Add `provider text not null default 'sleeper'`
  and rename `sleeper_league_id` to `provider_league_id` (and so on), with
  the unique keys widened to (provider, provider_league_id). Generated
  compatibility columns with the old names during the transition. Reason
  for one set: every model reads these tables by `league_id` uuid and never
  by provider id, so a second table set would double every model's read
  path for nothing.
- Player identity: keep `players` as the FF Beacon dimension, and add a
  per-provider identity table `provider_players` keyed (provider,
  provider_player_id) with `player_id uuid` FK, plus a review queue for
  unmatched. Sleeper's own list goes in the same table so the two providers
  are symmetric, while `players.external_ids.sleeper` stays for compatibility.
- Roster and matchup player arrays store PROVIDER ids as today (the raw
  capture rule), and every read resolves through the provider_players map.
- Scoring: translate Yahoo stat_modifiers to Sleeper keys at sync time
  (`lib/providers/yahoo/scoring-map.ts`), store the raw settings in metadata.
- Auth: Yahoo needs OAuth. Tokens live in Vault (`vault.create_secret`) with
  a `provider_connections` table holding the secret id, the provider user id
  (GUID), scopes, expiry, and status. Refresh on the server only. One
  connection per (user, provider). The table is designed for any secret, so
  MFL or Fantrax credentials fit it later.
- Capability gating: a `ProviderCapabilities` type with one boolean or
  "probe" per feature the site has. Every surface reads `capabilities`
  before rendering a panel and renders an honest "not available on Yahoo"
  line instead of a fabricated zero. Revision 2 added the feature-by-feature
  matrix (`lib/providers/capability-matrix.ts`), which is the guard test's
  allow-list and the content of the public `/providers` page.
- Provider module contract (revision 2): a fixed file set per provider under
  `lib/providers/<slug>/` and `components/providers/<slug>/`, checked by
  `lib/providers/contract.test.ts`, and a 14-step checklist for adding one.

## 8. Findings from the three sub-agent briefs (received 2026-09-08)

The points below are the ones that CHANGE THE DESIGN. The plan file carries
the full detail with sources.

Yahoo program:
- Write access is gone for new applicants. The access page says "read access
  only. Write access is not available at this time." The Write radio vanished
  from the app form around 2025-10-19 (yfpy issue 79). Consequence: Beacon
  Link style actions (set lineup, claim waiver) are NOT a Yahoo capability.
- A 2026-07-22 report (yfpy issue 84) says the Fantasy Sports permission is no
  longer selectable on developer.yahoo.com/apps/create; unapproved apps get
  403 "This application is not authorized to perform this action" even on
  public game resources. A 2026-08-07 report (yfpy issue 85) says an app
  showing "Approved" still got 403 for a while. Consequence: "approved but
  403" is a first-class state with a retry banner.
- Yahoo Developer API Terms of Use (REV 3-2022,
  legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/) section 2.1:
  "You may not retain or use, and must immediately remove ... any Yahoo user
  data obtained through the Yahoo APIs that is not explicitly identified as
  being storable indefinitely in the API Documents within 24 hours after the
  time at which you obtained the data". The Fantasy-specific terms page could
  not be fetched (404/403 on five variants). CONSEQUENCE: the plan carries a
  retention posture with one switch, designed for both outcomes. Default:
  Yahoo-derived rows are a re-fetchable cache purged 24 hours after fetch
  unless the owner gets a written answer from Yahoo.
- Section 1.7.4 bars deriving income "from the use or provision of the Yahoo
  APIs" without written permission. State the donation and membership model
  in the application.
- Attribution is mandatory: "Fantasy data provided by Yahoo Fantasy" plus the
  Yahoo Fantasy SVG, and the YDN attribution policy's "powered by Yahoo"
  mark linking to https://www.yahoo.com/?ilc=401. Brand use is subject to
  approval at https://ipr.yahoo.com/permission (ten business days).
- Sign in with Yahoo button: equal prominence, unaltered art, purple
  #7E1FFF, call-to-action "Continue with Yahoo".
- No support channel beyond the application form. YDN forum is empty.
- Access policy changed three times in ten months with no announcement
  channel. Budget for an unknown approval wait.
- Refresh tokens rotate ("New refresh tokens invalidate old ones"); the FAQ
  says a password change revokes them. Serialise refreshes per connection.
  Revocation endpoint https://api.login.yahoo.com/oauth2/revoke. Discovery
  document: grants authorization_code and refresh_token only, auth methods
  client_secret_basic and client_secret_post, no PKCE advertised.
- Redirect URI must be https; http://localhost refused; "Redirect URI(s)" is
  plural. The "OAuth Client Type: Confidential Client" field reported in
  session 1 is UNVERIFIED: no 2026 source lists a field by that name.
- FantasyPros, 4for4, Fantasy Football Calculator, The Fantasy Footballers
  ship Yahoo sync; KTC and DynastyProcess do not. FantasyPros has a "Fix It"
  reconnect path because connections break.
- ESPN has no official API (browser cookies copied by hand), which is why
  Yahoo comes first.

Yahoo API:
- Per-reader OAuth only. No lookup of another user's leagues by name or
  guid. No client-credentials grant. Consequence: Manager Pulse's "type any
  handle" flow cannot exist for Yahoo; a Yahoo Manager Pulse is the
  connected reader's own history only.
- Game ids per season, 2001 = 57 through 2025 = 461; 2026 unknown; resolve
  at runtime via `games;game_codes=nfl;seasons=YYYY`.
- Numeric player_id is season-independent; key the mapping on it.
- `renew` and `renewed` chain seasons. `draft_status` predraft / postdraft.
  `scoring_type` head / point.
- Roster sample: QB 1, WR 2, RB 2, TE 1, W/R/T 1, K 1, DEF 1 (position_type
  DT), BN 6, IR 1. Tokens seen: QB, WR, RB, TE, K, DEF, W/R/T, W/R,
  Q/W/R/T, BN, IR, IR+ (not football), NA. Every roster player carries
  `selected_position.position` and `is_flex`: positional BY FIELD, not by
  array index. No "0" placeholder problem, no ordering guarantee.
- Statuses (football): IR-eligible IR, NFI-R, NFI-A, O, PUP; not eligible D,
  NA, P, Q, CEL, SUSP. `is_keeper` on the player. No taxi squad on Yahoo.
- stat_ids verified from the docs' football settings sample: 4 pass yds,
  5 pass td, 6 int, 8 rush att (display), 9 rush yds, 10 rush td, 78 targets
  (display), 11 rec, 12 rec yds, 13 rec td, 15 ret td, 16 2pt, 18 fum lost,
  57 off fum ret td; K 19 to 23 FG buckets 0-19/20-29/30-39/40-49/50+,
  29 PAT made; DT 31 pts allowed (display), 32 sack, 33 int, 34 fum rec,
  35 td, 36 safety, 37 blk kick, 49 kick/punt ret td, 50 to 56 points-allowed
  buckets 0/1-6/7-13/14-20/21-27/28-34/35+, 82 XP returned (display). FG
  missed, PAT missed, IDP and bonus ids UNVERIFIED; read
  `/game/nfl/stat_categories` per season and store it.
- NO per-player projections in the API. Only `team_projected_points` and
  `win_probability`. Every Yahoo projection therefore comes from OUR
  projection source keyed by FF Beacon player id, which is why the player
  mapping must be clean.
- Future schedule: CONFLICTING evidence (spilchen: "at most one week in the
  future"; whatadewitt: "retrieves all season matchups"). UNVERIFIED.
  Consequence: `futureSchedule` is a RUNTIME-PROBED capability recorded per
  league; Power Pulse needs a "schedule unknown beyond week N" branch.
- Historical per-player points per week: yes, via
  `team/{key}/roster;week=N/players/stats` or league players with
  `player_keys` in batches of 25 and `/stats;type=week;week=N`.
- Transactions: types add, drop, add/drop, trade, commish, plus waiver and
  pending_trade with team_key; statuses pending, approved, rejected,
  successful. Per-player transaction_data with source/destination team keys
  (team/freeagents/waivers); `faab_bid`. Draft picks in trades: YES, a
  `picks` collection with round, original_team_key, source and destination
  team keys, and NO season or slot. timestamp epoch (seconds vs ms
  unverified). Pagination start/count 25.
- Draft results: pick, round, team_key, player_key, cost. Keepers via
  `players;status=K` and `is_keeper`, not on draft results.
- Players: 25 per page hard cap on every collection; filters position,
  status A/FA/W/T/K, search, sort, sort_type, player_keys. Full universe via
  `/game/nfl/players;start=N;count=25` (about 70 requests for the relevant
  pool). Fields include editorial_team_abbr, bye_weeks, headshot, image_url,
  display_position, primary_position, eligible_positions, status,
  injury_note, percent_owned, draft_analysis, ownership.
- Rate limits: none published. Community: HTTP 999, non-JSON "Request
  denied" body keyed to the app id, dropped connections on long loops. One
  token bucket per provider app, back off minutes on any non-JSON body.
- JSON quirk: collections are numeric-keyed objects with `count`; numbers
  arrive as strings; metadata and sub-resources split across [0] and [1].
- Token expiry: 401 with `oauth_problem="token_expired"`; refresh, retry once.

Codebase inventory:
- `pulseLeagueCore` (lib/league-pulse.ts:208) order: league, rosters, users,
  drafts, THEN stamp `last_pulsed_at` and `pulse_status` (:391, :440).
- `captureLeagueRawData` (lib/league-pulse.ts:695) is the one door into
  transactions, brackets, draft selections and matchups;
  `lib/league-capture-set.test.ts` enforces it.
- `normalizeDraftPicks` is lib/sleeper-draft-picks.ts:21-34; `validPlayerId`
  league-pulse.ts:1503 rejects "0". `lib/league-matchups.ts normalizeIdList`
  (:104-107) preserves "0" placeholders.
- Queue: `lib/league-bulk-sync.ts` is the worker; job kinds 'pulse' and
  'footprint' (dispatch at :503 and :537; migration 0255); a job identifies a
  league by `sleeper_league_id` TEXT (migration 0172:84, unique (user_id,
  sleeper_league_id) 0172:121-122, cross-user index 0263:57). "The single
  largest schema assumption a provider abstraction must break."
- Sleeper budget: `lib/sleeper-budget.ts:135 new TokenBucket(600)` singleton.
- `getNflState()` is the site's clock with 24 code callers (27 files match
  including this folder and progress.md): a DATA dependency, stays outside
  the provider abstraction.
- Repo-wide guard tests, all present on 2026-09-09: league-capture-set,
  league-matchups, sleeper-handle/guard, players/sleeper-lookup-guard,
  client-sleeper-import (no client component may import @/lib/sleeper),
  projections/source-guard, projections/raw-column-guard,
  positional-war/naming, security/sleeper-size-guard.
- Patterns to copy: `source_registry` (0010, 0011), `lib/projections/source.ts`
  (leaf constants, pure resolver, impure availability, one read module,
  guard test). Migration 0120: "Sleeper deliberately has no source_registry
  row".
- Auth: Supabase Auth, Google and Discord (app/login/login-form.tsx:67),
  callback app/auth/callback/route.ts. NO token table, NO encryption helper
  today. Beacon Link plan Part 3.2 (docs/beacon-link/beacon-link-plan.md:356
  onward) proposes `sleeper_connections` with AES-256-GCM ciphertext, key
  version, status enum, owner-readable status VIEW, service_role-only base
  table, env key. The provider plan generalises it to `provider_connections`
  on Vault.
- Copy: 82 component files and the legal pages name Sleeper; identity card,
  save-handle form and notice, League Pulse form, Manager Pulse search form,
  On The Clock username gate, Signal Check import panel and
  /my-beacon/sleeper-leagues are the surfaces to make provider-aware. Two
  strings live in the DATABASE (migrations 0078, 0167 seed guide copy).
- Files mentioning sleeper: lib 454/814, app 175/426, components 109/327,
  scripts 21/65, migrations 92/286.
- `lib/sleeper.ts` exports 26 functions (line 104 readCapped through line
  896 getSleeperPlayers); the league-graph ones are 211 to 569, the
  source-side ones 632 to 896.
- `lib/security-headers.ts:88` img-src allows only sleepercdn.com and the
  Supabase host; `next.config.ts:7-9` remotePatterns likewise. Both gain the
  Yahoo image hosts (plan Part 12).
- `vercel.json` cron expressions are UTC; `sync-sleeper-players` is
  `0 6 * * *`.
- `package.json` dev script is plain `next dev`; the plan adds `dev:https`
  beside it rather than changing it.

### 8a. Re-verification of 2026-09-09 (session 2)

Checked live by a research sub-agent against the pages named; quotes are
page text. archive.org and archive.ph were unreachable from that
environment.

- sports.yahoo.com/developer and /developer/access/: unchanged from section
  3, with the Client ID correction (optional). No cost, no timeline on
  either page. "Each application is reviewed by the Yahoo Fantasy Sports
  team."
- yfpy issue 84 (opened 2026-07-22, updated 2026-09-01): every endpoint
  403 for unapproved apps; the create-app form offers only OpenID Connect
  and TW Auction; one commenter approved 2026-05-30 after about three weeks
  still gets 403; "Revoke + re-auth did NOT fix it"; Yahoo's reply email
  says review "typically takes 1-2 weeks, depending on complexity"; two
  commenters received and signed a DocuSign legal document in late August
  and still error; one says "a bit over a month and still nothing". No
  commenter reports a fully working newly approved app as of 2026-09-01.
- yfpy issue 85 (2026-08-07): app approved through manual review, OAuth
  works, every fantasy endpoint 403 "This application is not authorized".
- yfpy issue 79: Write removed 2025-10-19; a 2026-06-14 comment says the
  OOB redirect is also gone.
- Fourteen other repositories report the same 403 gate since 2026-07-22;
  three quote the "1-2 weeks" figure from their confirmation email;
  derekrbreese/fantasy-football-mcp-public issue 18 (2026-08-11) quotes the
  error string `additional_authorization_required`.
- OAuth flow page and discovery document: as in section 3; no PKCE.
- apiforydn terms: REV 3-2022, sections 2.1 and 1.7.4 read as quoted.
- fantasysportsapi terms: 404 (trailing slash 403; policies.yahoo.com
  mirror redirects to the 404). Search engines still index the title.
  Owner's item 5a: pull the Wayback copy.
- docs page: base URL and key formats as stated; "HTTP Operations Supported:
  GET"; the "PUTs and POSTs" link is a 2019 PHP gist with no bodies; the
  25-per-page cap was not readable on the official page (fetcher
  truncation) and is community-attested.
- 2026 NFL game id: not published anywhere found.
- No 2026 pricing, sunset or new-terms announcement found; every change is
  known from developer reports only.

### 8b. Other hosts survey (2026-09-09, session 2)

The full table is Appendix C of the plan. The points that shaped the design:
- Fleaflicker is the only other host that behaves like Sleeper (public,
  keyless, lookup by email or user id, taxi group, future picks with a
  traded flag). It fits `auth_kind = 'public_handle'` unchanged.
- MFL is the richest and the only one documenting writes; needs credentials
  or a per-league API key, a registered User-Agent validated by SMS, one
  second between requests, and forbids harvesting.
- ESPN: no official API, `espn_s2` and `SWID` cookies, and Disney's terms
  forbid automated access. Not a provider under this design.
- Fantrax: an external API keyed by a per-user Secret ID; internal API needs
  a Selenium-captured session. External only, later.
- NFL.com, CBS, Underdog, DraftKings: no usable league API, or terms that
  forbid it.
- DynastyProcess ids cover mfl, espn, fleaflicker, cbs, nfl, yahoo, sleeper.

## 9. Spike record (LP-T060) and the owner's dated entries

Empty until the owner has access. Entries to make here, each with a date:
- App created: Client ID (not the secret), the exact field list on the
  create-app form, the redirect URIs registered.
- Application submitted: the full text, the date, the Expected Users band.
- Yahoo's replies: dates, the retention answer, any conditions, the DocuSign
  document's clauses that touch retention, attribution or income.
- Archived Fantasy Sports API terms (owner's item 5a): the retention,
  attribution and commercial-use clauses, quoted.
- Spike results, one line per UNVERIFIED item in the plan (Part 14.4 lists
  them): stat_categories ids; slot labels for W/T, Q/W/R/T, D, DL, LB, DB;
  the renew/renewed format; whether picks[] carries a season; the timestamp
  unit; the in-draft draft_status; the live scoreboard status; how many
  preevent weeks the scoreboard returns; editorial_team_abbr casing; the
  co-manager object; where is_keeper sits; the 999 rate; whether PKCE is
  honoured; the exact scope string; whether public leagues are readable by a
  non-member's token.

Write shapes for the day write access returns (library-derived, unverified
against Yahoo): PUT `team/{team_key}/roster` with an XML body
`<fantasy_content><roster><coverage_type>week</coverage_type><week>N</week><players><player><player_key>..</player_key><position>..</position></player></players></roster></fantasy_content>`;
POST `league/{league_key}/transactions` with `<transaction><type>add/drop</type><players>...` carrying `transaction_data` per player. Not in this build.

## 10. Session 2 verification ledger and corrections

Every repository claim in the plan was re-checked on 2026-09-09 against
`277ddbf`. Confirmed as cited: migration numbering (next free 0279); no
LP-T tasks in progress.md; `lib/sleeper-budget.ts:135`;
`PULSE_SLOT_ELIGIBILITY` at `lib/power-pulse/types.ts:21` and
`NON_STARTING_SLOTS` at :40; every `lib/sleeper-to-format.ts` signature;
`pulseLeagueCore` :208, `captureLeagueRawData` :695, `validPlayerId` :1503,
the `last_pulsed_at` stamp at :391; `app/leagues/[league_id]/page.tsx:81`;
the three `next.config.ts` redirects at :45, :55, :72; the nine guard tests;
`app/my-beacon/sleeper-leagues/page.tsx`; `docs/beacon-link/beacon-link-plan.md:356`;
`lib/sleeper-league-settings.ts:88`; `lib/league-category.ts:52`;
migrations 0010, 0011, 0137 (`try_claim_rate_limit`), 0143
(`find_player_trade_transactions`), 0271 (`sleeper_slug_tail`);
`lib/projections/source.ts`, `components/sleeper-avatar.tsx`,
`components/league-logo.tsx`, `components/league-choice-list.tsx`; the
`league-bulk-sync.ts` job_kind dispatch; `lib/nav-tree.ts:195` for the About
entry; the admin page set under `app/admin/*`.

Three corrections made to the plan:
1. Cron times were given in Eastern; `vercel.json` is UTC. Parts 6.2 and
   11.12 now give cron expressions.
2. Part 1 said the docs/README.md row was touched; it was not. Now stated as
   LP-T011's work.
3. Part 7.1 would have replaced `next dev`; it now adds `dev:https` beside it.

Not built and not started: nothing under `lib/providers/`, `lib/http/`,
`lib/league-lookup.ts`, `app/providers/`, or `app/admin/providers/` exists.

## 11. What the next session does

If the owner approves the plan: open `progress.md`, add a `## Phase N -
League providers` heading with the LP-T tasks of Part 15 (Phase 1 first),
and start LP-T001. Nothing in Phases 1 to 3 needs Yahoo.

Owner's own steps, in order, none of which need code: Part 16 items 1 to 5a
(account, app, test leagues, application, the replies, the archived terms).
Appendix B is the screen-by-screen version.
