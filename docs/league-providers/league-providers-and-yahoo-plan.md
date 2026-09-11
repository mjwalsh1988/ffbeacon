# League providers: Yahoo beside Sleeper, and every feature gated on what a provider can actually do

Status: PLAN ONLY. Nothing in this document has been built. Written
2026-09-08 against `main` at `277ddbf`; revised 2026-09-09 (revision 2,
same commit, see the revision note below). Task prefix for the build:
`LP-T###` in `progress.md` (no task with that prefix exists yet, checked
2026-09-09). The next free migration number is 0279 (0278 is
`autovacuum_thresholds`, re-checked 2026-09-09); every migration below is
numbered from there. Renumber if anything lands first; the numbers are an
ordering, not an identity.

Revision 2 (2026-09-09) added, without changing any decision of revision 1:
Part 4.8 (the provider module contract and the checklist for adding a
third provider), Part 4.9 (the capability matrix, every feature against
every key, which is also the guard test's allow-list), Part 10.10 (the
public capabilities page, so the list is viewable rather than buried in
admin), Appendix B (the Yahoo developer setup walkthrough with a
paste-ready application), Appendix C (how the design holds for ESPN, MFL,
Fleaflicker, Fantrax, NFL.com and CBS), five new capability keys in Part
4.3 that the matrix exposed as missing, and the corrections listed in
`yahoo-plan-notes.md` section 10 (a cron time stated in the wrong zone,
a README row recorded as done that was not, and a dev script that would
have replaced `next dev` rather than sitting beside it). Every file path,
line number and count cited from the repository was re-checked against
`277ddbf` on 2026-09-09; the notes file records what was checked.

THIS DOCUMENT IS THE SPEC. It carries every table, column, index, policy,
file, function, type, route, env var, copy string, state, test and task the
build needs, and the research behind each decision with the URL it was
checked against. The companion artifact is the plain-language and sales
explanation for the owner and carries none of this detail:
https://claude.ai/code/artifact/d0d24f75-f358-46b6-acfb-f67dfec87561
(published 2026-09-09). The working notes that produced
this document are `docs/league-providers/yahoo-plan-notes.md`; a session that
runs out of context continues from there.

Two research facts sit above everything else in this plan, so they come
first.

1. Yahoo's Fantasy Sports API is no longer self-serve. Since roughly May 2026
   access is granted through a human-reviewed application at
   https://sports.yahoo.com/developer/access/, it is READ-ONLY for new
   applicants ("Write access is not available at this time"), and unapproved
   apps receive HTTP 403 on every fantasy endpoint. Nothing in Part 7 can be
   exercised against live data until that application is approved, so the
   build is ordered to put every provider-neutral piece (Parts 4, 5, 6, 8, 9)
   before anything that needs a Yahoo token, and the Yahoo client is built
   against recorded fixtures until approval lands.
2. Yahoo's Developer API Terms of Use (REV 3-2022) section 2.1 forbids
   retaining Yahoo user data beyond 24 hours unless the API documents say it
   is storable indefinitely, and the Fantasy-specific terms page could not be
   fetched by any automated means during this research. The plan therefore
   carries a RETENTION SWITCH (Part 5.5) and is correct under either answer.
   Getting that answer in writing is item 5 of the owner's checklist
   (Part 16).

---

## Part 0. How to read this document

Parts 1 to 3 are the record: what was asked, what was verified, what exists.
Parts 4 to 9 are the design. Parts 10 to 13 are the surfaces and the reviews.
Parts 14 to 18 are the build order, the owner's own steps, the open questions
and the risk register. A reader who only wants the shape of the thing can
read Part 4 and Part 15.

Vocabulary used throughout:

- PROVIDER: a fantasy platform that hosts leagues. Sleeper and Yahoo are the
  two in this plan. ESPN, MFL, Fleaflicker and Fantrax are named only to show
  the design scales.
- SOURCE: a publisher of player VALUES, RANKINGS or PROJECTIONS (KTC,
  FantasyCalc, FF Beacon, Sleeper's projection feed). Sources are governed by
  `source_registry` and the Source and Format Sync rules in CLAUDE.md and are
  NOT changed by this plan. Sleeper is both a provider and a projection
  source; the two roles are kept apart on purpose (Part 4.1).
- CAPABILITY: one thing a provider can supply. Declared in the registry,
  some probed at sync time, read by every surface before it renders a panel.
- PROVIDER ID: an identifier minted by a provider (a Sleeper league id, a
  Yahoo league key, a Yahoo manager guid). Never an FF Beacon id.
- FF BEACON ID: a uuid we mint (`leagues.id`, `players.id`,
  `rosters.id`). Every model reads by these; nothing downstream of the sync
  reads a provider id.

---

## Part 1. What the owner asked for

Quoted intent, condensed, and the reading this plan takes of each:

- "integrate Yahoo Fantasy Football leagues into our system just like Sleeper
  is". Reading: a Yahoo league gets the same deep view, the same tools, the
  same models, and the same place in every league list, with any gap stated
  in words rather than hidden.
- "refactoring our code to have 'providers' able to be added in with
  separate components for each provider". Reading: one `LeagueProvider`
  interface, one directory per provider under `lib/providers/`, one
  component directory per provider under `components/providers/`, and a
  registry that lists them. Adding a third provider is a new directory plus
  one registry row, with no change to any model or page.
- "'capabilities' for each 'provider' so that we have records of what each
  provider supports ... each individual component / feature within a tool
  needs to be under 'capabilities'". Reading: a typed capability record per
  provider, stored on the registry row and probed per league where a fact
  is only knowable from data, and a rule that every panel which depends on
  a capability reads it and renders an honest empty state when it is absent
  (Part 4.3, Part 7.8).
- "everything on the website can utilize yahoo or sleeper, and all things
  like our would you rather game for example would simply pull from both
  providers". Reading: the models read FF Beacon ids, so once a Yahoo league
  is synced into the same tables, Would You Rather, Manager Ledger, Power
  Pulse and the rest see it with no provider branch. Part 11 walks every
  feature and says what changes.
- "we should be utilizing one table for things like leagues, trades, etc ...
  if you think there's a good reason to keep it all separated that's fine
  just explain why". Reading: one table set, with a `provider` column and
  provider-neutral column names (Part 4.7 explains why, and names the two
  things that ARE kept apart: connections and the player identity map).
- "keep sleeper player lists and yahoo player lists maybe in separate tables
  because the goal is to maintain sleeper player id and yahoo player id and
  then have a ffbeacon player id which is just a uuid". Reading: a per-
  provider player identity table keyed (provider, provider_player_id) that
  points at `players.id`, so every provider id is always recoverable and the
  FF Beacon uuid is the only key the models use. Part 4.7 explains why this
  is one table with a provider column rather than two tables, and why that
  satisfies the ask better than two would (the naming rule in CLAUDE.md
  literally lists `sleeper_players` as a name we must not use).
- "go through every possible edge case". Part 6 (identity), Part 7.4
  (entity mapping), Part 17 and Part 18 are the edge-case ledgers.
- "do not make changes, this is a planning task only". Nothing outside
  `docs/league-providers/` was touched in either session. The
  `docs/README.md` index row for this folder is NOT yet added (checked
  2026-09-09; revision 1 recorded it as done in error) and is LP-T011's
  first line of work.
- "always confirm with sources how to do something". Every Yahoo fact in
  Part 2 carries the URL it was read from; anything that could not be
  confirmed is marked UNVERIFIED and has a spike task that settles it before
  code depends on it.

---

## Part 2. Research record

Everything in this Part was checked on 2026-09-08. VERIFIED means read from
the cited page. UNVERIFIED means from a search snippet, a single third-party
report, or a library's behaviour rather than Yahoo's words.

### 2.1 The Yahoo developer program in 2026

- The Fantasy API documentation moved. `https://developer.yahoo.com/fantasysports/guide/`
  is a permanent 308 redirect to `https://sports.yahoo.com/developer`. The
  docs are `https://sports.yahoo.com/developer/docs/`. VERIFIED.
- Access is by application. From `https://sports.yahoo.com/developer`:
  "Application Submission", "Application Review", "Access": "If you're
  approved, we'll follow up with next steps." VERIFIED.
- The form at `https://sports.yahoo.com/developer/access/`: "Expected Users"
  is required with bands "Small (< 1,000 users)", "Medium (1,000 - 100,000
  users)", "Large (100,000+ users)". "Client ID: Existing Yahoo Developer
  Network users, enter the Client ID from your YDN account. New users
  without a YDN account can leave this blank, access will be provisioned
  after approval." "Access to the Yahoo Fantasy Sports API is read-only by
  default. If your use case is unique and requires read/write access, please
  include additional details in the notes section below." "The Yahoo Fantasy
  Sports API currently provides read access only. Write access is not
  available at this time." "Applications must clearly identify the product
  being built, the Yahoo Fantasy Sports data required, and the intended user
  base, including where access is limited to personal or single league use."
  "Given current request volume, incomplete or insufficiently detailed
  submissions cannot be evaluated and will be closed without further
  correspondence." No cost stated. No timeline stated. VERIFIED.
- Portal policies: "Developers may create only a single account and must not
  use automated tools or other means to create multiple accounts." "Yahoo
  monitors API usage to keep things running smoothly for all developers. If
  individual usage is excessive over the course of short periods of time or
  impacts performance, we may temporarily throttle or limit access."
  "Developers may not modify, reverse engineer, decompile, or otherwise
  alter the API or separate its underlying data." "To be granted access to
  the Yahoo Fantasy Sports API, Developers must agree to the API Access and
  Use Agreement." That agreement is named as plain text with no hyperlink on
  the page. VERIFIED.
- Attribution: "Developers using the Yahoo Fantasy Sports API must provide
  clear attribution by including 'Fantasy data provided by Yahoo Fantasy'
  within their products." The official logo is
  `https://763445962456-brand-assets.s3.us-west-2.amazonaws.com/brandwebsite/s3fs-public/Yahoo_Fantasy.svg`
  and must not be rotated, inverted, recoloured, given effects, reproportioned,
  combined with other brands or have graphics added. VERIFIED (portal page).
- YDN Attribution Policy `https://developer.yahoo.com/attribution/`:
  "Include an appropriate 'powered by Yahoo' logo from below along with any
  data from a Yahoo API." "All Yahoo logos must link to
  https://www.yahoo.com/?ilc=401 and content from Yahoo APIs must link to an
  appropriate page on the Yahoo network." Four logo variants, purple on
  light and white on dark, 134x20 and 72x31 px. VERIFIED.
- Brand guidelines `https://policies.yahoo.com/us/en/yahoo/permissions/branduseguidelines/index.htm`:
  every use of Yahoo Brand Features requires advance approval via
  `https://ipr.yahoo.com/permission`, "reviewed and responded to within ten
  (10) business days". VERIFIED.
- Sign in with Yahoo `https://developer.yahoo.com/sign-in-with-yahoo/`:
  "The Yahoo sign-in button must be displayed with equal prominence to other
  third party sign-in buttons." "Please do not alter the button art or
  logos." Call-to-action examples "Sign in with Yahoo", "Continue with
  Yahoo". Primary purple #7E1FFF. VERIFIED.
- Yahoo Developer API Terms of Use REV 3-2022
  `https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html`:
  section 2.1 "You may not retain or use, and must immediately remove from
  any Application and any data repository in your possession or under your
  control any Yahoo user data obtained through the Yahoo APIs that is not
  explicitly identified as being storable indefinitely in the API Documents
  within 24 hours after the time at which you obtained the data". Section
  1.7.4: you shall not "derive income from the use or provision of the Yahoo
  APIs, whether for direct commercial or monetary gain or otherwise, unless
  the API Documents specifically permit otherwise or Yahoo gives prior,
  express, written permission". Section 1.7.6: no use "in a product or
  service that competes with products or services offered by Yahoo" without
  written permission. Section 2.4: a privacy policy is required. Rate limits
  "at Yahoo's absolute and sole discretion". Yahoo "reserves the right to
  charge fees for future use". VERIFIED.
- Yahoo Fantasy Sports APIs Terms of Use
  `https://legal.yahoo.com/us/en/yahoo/terms/product-atos/fantasysportsapi/index.html`:
  NOT FETCHABLE (404 or 403 on five URL variants and via archives). Search
  snippets attribute to it the attribution sentence and the logo rules.
  Whether it relaxes the 24-hour clause for league data: UNVERIFIED.
- Write permission: the Write radio disappeared from the app-creation form
  around 2025-10-19 (yfpy issue 79, UNVERIFIED single report), consistent
  with the access page's VERIFIED "read access only".
- Fantasy Sports permission on `https://developer.yahoo.com/apps/create/`:
  a 2026-07-22 report (yfpy issue 84) says it is no longer selectable, and
  unapproved apps get 403 "This application is not authorized to perform
  this action" on every fantasy endpoint. A 2026-08-07 report (yfpy issue
  85) says an app showing "Approved" still got 403 for a while. UNVERIFIED
  (the create form is behind a Yahoo login). Design consequence either way:
  "approved but 403" is a first-class state (Part 7.3).
- Support: no channel beyond the application form. `https://developer.yahoo.com/forum/`
  renders an empty shell. Developers talk on GitHub (uberfastman/yfpy,
  whatadewitt/yahoo-fantasy-sports-api); Yahoo does not answer there.
  VERIFIED.
- Comparable products shipping Yahoo sync: FantasyPros My Playbook, 4for4
  LeagueSync, Fantasy Football Calculator, The Fantasy Footballers. Not
  shipping it: KeepTradeCut, DynastyProcess/ffscrapr. FantasyPros has a "Fix
  It" reconnect path because connections break. VERIFIED from each site.
- Why Yahoo before ESPN: ESPN has no official API; private ESPN leagues need
  the `espn_s2` and `SWID` browser cookies copied by hand (ffscrapr ESPN
  authentication vignette). Yahoo is the only one of the three big hosts
  with a documented OAuth 2.0 API and a licence to point at. VERIFIED.
  Appendix C carries the full survey of the other hosts.

Re-checked 2026-09-09 (revision 2). Everything above still reads as
stated, with these refinements and additions:

- Client ID on the access form is OPTIONAL, not required: "New users
  without a YDN account can leave this blank, access will be provisioned
  after approval." VERIFIED. The notes file's earlier "required" was a
  misreading; Part 16 still creates the app first because a Client ID
  makes the application concrete and lets the OpenID half of the flow be
  exercised before approval.
- The create-app form at `https://developer.yahoo.com/apps/create/`
  (behind a login) now offers only "OpenID Connect" and "TW Auction" as
  API permissions; the Fantasy Sports permission is "genuinely absent, not
  hidden" (yfpy issue 84, comments of 2026-07-22 and 2026-07-28;
  corroborated by fourteen other repositories reporting the same 403 gate
  since 2026-07-22, for example
  `https://github.com/derekrbreese/fantasy-football-mcp-public/issues/18`
  of 2026-08-11). UNVERIFIED first-hand, consistent across sources.
  Consequence: the permission is PROVISIONED BY YAHOO after approval; the
  owner does not tick it.
- The review process now includes a legal document sent by DocuSign to
  approved applicants (yfpy issue 84, comments of 2026-08-31 and
  2026-09-01). Yahoo's own reply email quotes "typically takes 1-2 weeks,
  depending on complexity" (same issue, 2026-07-29 comment;
  `https://github.com/kingspencerho/rosterxray-1/pull/94` of 2026-09-03
  quotes the same figure from its confirmation email). Developers on the
  same thread report a month or more after signing with no key issued and
  403 continuing. As of 2026-09-01 no commenter on that thread reports a
  fully working newly approved app. UNVERIFIED individually, consistent
  as a pattern. Consequence: Part 18's first risk is raised to "near
  certain delay", and Appendix B's timeline says so.
- A second not-authorized string exists: `additional_authorization_required`
  (yfpy issue 84, 2026-07-28). Part 7.3's classifier treats it as
  `not_authorized` beside "not authorized to perform this action".
- The out-of-band ("oob") redirect is gone (yfpy issue 79, comment of
  2026-06-14) and a loopback `https://localhost:PORT/` is what developers
  use locally now (rosterxray PR 94). Part 7.1's `https://localhost:3000`
  redirect stands; the "oob" sentence in 2.2 is historical.
- The "OAuth Client Type: Confidential Client" field named in the notes
  file is UNVERIFIED: no 2026 source lists a field by that name. Appendix
  B tells the owner to record the actual field list on the day.
- The docs page says "HTTP Operations Supported: GET" on every resource it
  shows, and the only write material is a 2019 PHP gist linked as "PUTs
  and POSTs" with no body examples. VERIFIED. The write shapes recorded in
  the notes file remain library-derived.
- The dedicated Fantasy Sports API terms page returns 404 today (the
  trailing-slash form 403s, and the policies.yahoo.com mirror redirects to
  the 404). The Wayback Machine could not be reached from the research
  environment, so pulling an archived copy is item 5a of the owner's
  checklist. VERIFIED (the 404), UNVERIFIED (the archived content).
- 2026 NFL game id: still not stated anywhere (the Go SDK's static map and
  yfpy's quickstart end at 2025 = 461; the only 2026 id found is MLB 469).
  Runtime discovery stands.

### 2.2 OAuth 2.0

From `https://developer.yahoo.com/oauth2/guide/flows_authcode/` (note the
lowercase path; the CamelCase `flows_AuthCode` 404s), the FAQ, the
troubleshooting page and the discovery document
`https://api.login.yahoo.com/.well-known/openid-configuration`. All VERIFIED.

- Authorization endpoint `https://api.login.yahoo.com/oauth2/request_auth`,
  GET or POST, parameters `client_id`, `redirect_uri`, `response_type=code`,
  `state` (optional), `language` (optional, default `en-us`). `scope` is
  where `fspt-r` goes; that scope string is community-attested (kenjdavidson
  Postman guide, yfpy) and UNVERIFIED as an official string, though the
  2026 yfpy report used exactly `scope=fspt-r`.
- Token endpoint `https://api.login.yahoo.com/oauth2/get_token`, POST,
  `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`,
  `client_secret`, or `Authorization: Basic base64(client_id:client_secret)`.
  Discovery lists `client_secret_basic` and `client_secret_post`.
- Response: `access_token`, `token_type` "bearer", `expires_in` "3600",
  `refresh_token`, `xoauth_yahoo_guid` (labelled deprecated on the flow
  page), `id_token` when `openid` was requested.
- Refresh: same endpoint, `grant_type=refresh_token`, `refresh_token`. "New
  refresh tokens invalidate old ones automatically" (flow page); "The best
  practice is to store the latest refresh token as the refresh token may
  change" (FAQ). The FAQ says "all your refresh tokens are revoked after you
  change your password"; the flow page says the opposite. Treat revocation
  as possible.
- Revocation endpoint `https://api.login.yahoo.com/oauth2/revoke`.
  Introspection `/oauth2/introspect`. Grants supported: `authorization_code`
  and `refresh_token` only. No client-credentials grant, so there is no
  app-only token. No `code_challenge_methods_supported` in discovery, so
  PKCE is not advertised; next-auth users report it accepted (UNVERIFIED).
- Redirect URI must be https; plain `http://localhost` is refused by the
  form; `https://localhost:8080` is accepted. The field is "Redirect
  URI(s)". "oob" is accepted as a redirect_uri for out-of-band use.
- Troubleshooting page: a 401 `invalid_grant` is fixed by leaving the app's
  callback field empty or recreating the app with it blank; a 401 from a
  browser rather than code; `redirect_uri` misspelled as `redirect_url`.
- OpenID scopes supported: `openid`, `openid2`, `profile`, `email`. Claims
  include `sub`, `email`, `email_verified`, `name`. Userinfo at
  `https://api.login.yahoo.com/openid/v1/userinfo`.
- A browser login is always required ("No, an user must log in to the
  browser").

### 2.3 The Fantasy API

From `https://sports.yahoo.com/developer/docs/` unless a library is named.
Library facts come from uberfastman/yfpy (`query.py`, `models.py`),
spilchen/yahoo_fantasy_api (`league.py`, `team.py`, `yhandler.py`),
whatadewitt/yahoo-fantasy-sports-api and its docs site, and
n-ae/yahoo-fantasy-sports-api-go.

- Base `https://fantasysports.yahooapis.com/fantasy/v2`. XML by default;
  every library appends `?format=json`. VERIFIED.
- Keys: game `{game_id}` or `{game_code}` ("461", "nfl"); league
  `{game_id}.l.{league_id}`; team `{game_id}.l.{league_id}.t.{team_id}`;
  player `{game_id}.p.{player_id}` (example `461.p.30121`). VERIFIED.
- Game ids per NFL season (yfpy docs, Go SDK map, YFAR vignette; VERIFIED as
  a consistent set across three sources, UNVERIFIED against a Yahoo page):
  2001 57, 2002 49, 2003 79, 2004 101, 2005 124, 2006 153, 2007 175,
  2008 199, 2009 222, 2010 242, 2011 257, 2012 273, 2013 314, 2014 331,
  2015 348, 2016 359, 2017 371, 2018 380, 2019 390, 2020 399, 2021 406,
  2022 414, 2023 423, 2024 449, 2025 461. 2026 UNKNOWN. The plan resolves
  the id at runtime from `games;game_codes=nfl;seasons=YYYY` and never
  hardcodes it (Part 7.5).
- The numeric `player_id` is season-independent (Mahomes is 30123 on
  `https://sports.yahoo.com/nfl/players/30123/`; `editorial_player_key` is
  `nfl.p.{id}`). Sleeper's `yahoo_id` for Christian McCaffrey is 30121,
  the exact id in Yahoo's own doc example. VERIFIED by cross-check.
- Access rule: "A particular user can only retrieve data for private
  leagues of which they are a member, or for public leagues." VERIFIED.
  There is no lookup of another user's leagues by name or guid; the users
  collection documents only `use_login=1`. Every read is under a user
  token.
- Game sub-resources: metadata, leagues, players, dates, game_weeks,
  stat_categories, position_types, roster_positions. League: metadata,
  settings, standings, scoreboard, teams, players, draftresults,
  transactions. Team: metadata, stats, standings, roster, draftresults,
  matchups. `out=` gives one level of extra sub-resources. VERIFIED.
- League metadata: league_key, league_id, name, url, logo_url,
  draft_status (predraft, postdraft; an in-draft value UNVERIFIED),
  num_teams, scoring_type (head, point), league_type (private, public),
  is_finished, current_week, start_week, end_week, is_pro_league,
  is_cash_league, renew, renewed (chain prior and next season, format
  UNVERIFIED, libraries treat it as `{game_id}_{league_id}`), plus from
  yfpy: edit_key, end_date, start_date, entry_fee, felo_tier, game_code,
  is_plus_league, league_update_timestamp, matchup_week, season,
  weekly_deadline, allow_add_to_dl_extra_pos. VERIFIED (docs plus yfpy).
- Settings: roster_positions (position, position_type, count; sample QB 1,
  WR 2, RB 2, TE 1, W/R/T 1, K 1, DEF 1 with position_type DT, BN 6, IR 1),
  stat_categories (stat_id, name, display_name, position_type, sort_order,
  is_only_display_stat, bonuses), stat_modifiers (stat_id, value),
  waiver_type, waiver_rule, uses_faab, draft_type, is_auction_draft,
  uses_playoff, num_playoff_teams, playoff_start_week,
  uses_playoff_reseeding, uses_lock_eliminated_teams,
  has_multiweek_championship, uses_fractional_points, uses_negative_points,
  max_teams, trade_end_date, trade_ratify_type, trade_reject_time,
  post_draft_players, waiver_time, uses_median_score, pickem_enabled,
  cant_cut_list, divisions, player_pool. NOT FOUND anywhere:
  `can_trade_draft_picks`, `uses_roster_import`. VERIFIED (docs plus yfpy).
- stat_ids verified from the docs' own football settings sample: 4 Passing
  Yards, 5 Passing Touchdowns, 6 Interceptions, 8 Rushing Attempts
  (display only), 9 Rushing Yards, 10 Rushing Touchdowns, 78 Targets
  (display only), 11 Receptions, 12 Receiving Yards, 13 Receiving
  Touchdowns, 15 Return Touchdowns, 16 2-Point Conversions, 18 Fumbles
  Lost, 57 Offensive Fumble Return TD; kicker 19 FG 0-19, 20 FG 20-29,
  21 FG 30-39, 22 FG 40-49, 23 FG 50+, 29 PAT Made; team defense 31 Points
  Allowed (display only), 32 Sack, 33 Interception, 34 Fumble Recovery,
  35 Touchdown, 36 Safety, 37 Block Kick, 49 Kickoff and Punt Return
  Touchdowns, 50 Points Allowed 0, 51 1-6, 52 7-13, 53 14-20, 54 21-27,
  55 28-34, 56 35+, 82 Extra Point Returned (display only). VERIFIED.
  UNVERIFIED and to be read from `/game/nfl/stat_categories`: FG missed
  buckets, PAT missed, every IDP id, every bonus id, 40+ yard TD ids.
- Team: team_key, team_id, name, url, team_logos, waiver_priority,
  faab_balance, number_of_moves, number_of_trades, roster_adds,
  clinched_playoffs, draft_position, draft_grade, managers (manager_id,
  nickname, guid, is_commissioner, is_current_login, email, image_url,
  felo_score, felo_tier, is_comanager), team_standings (rank,
  playoff_seed, outcome_totals wins/losses/ties/percentage, streak,
  points_for, points_against), team_points, team_projected_points,
  win_probability, is_owned_by_current_login. VERIFIED (docs plus yfpy).
- Roster `team/{key}/roster;week=N`: each player carries
  `selected_position.position` and `is_flex`. Rosters are positional BY
  FIELD, not by array index; there is no "0" placeholder and no ordering
  guarantee. Tokens seen: QB, WR, RB, TE, K, DEF, W/R/T, BN, IR, IR+, NA;
  Yahoo Help says IR+ is hockey and basketball, football uses IR. Player
  statuses for football (Yahoo Help SLN8846): IR-eligible IR, NFI-R, NFI-A,
  O, PUP; not eligible D, NA, P, Q, CEL, SUSP. `is_keeper` numeric boolean
  on the player. No taxi squad exists on Yahoo. VERIFIED.
- Scoreboard `league/{key}/scoreboard;week=N`: matchups with week,
  week_start, week_end, status (preevent, postevent; midevent UNVERIFIED),
  is_playoffs, is_consolation, is_tied, winner_team_key, teams with
  team_points, team_projected_points, win_probability. Per-team
  `team/{key}/matchups;weeks=1,3,6` for head-to-head leagues. VERIFIED.
- FUTURE WEEKS: evidence conflicts. spilchen: "Can only request the date
  range at most one week in the future. This restriction exists because
  Yahoo! only provides the week range when the matchups are known" and
  "During the playoffs, the matchup is only known for the current week".
  whatadewitt: team matchups "retrieves all season matchups". UNVERIFIED.
  Consequence: `futureSchedule` is a PROBED capability (Part 4.3) and Power
  Pulse gains a branch for an unknown remaining schedule (Part 7.8).
- Historical per-player points per week: yes, via
  `team/{key}/roster;week=N/players/stats` or the league players collection
  with `player_keys` in batches of 25 and `/stats;type=week;week=N`.
  VERIFIED (yfpy, spilchen).
- Transactions `league/{key}/transactions;types=add,drop,trade,commish;count=N`
  plus `team_key` with `type=waiver|pending_trade`. Fields transaction_key,
  transaction_id, type (add, drop, add/drop, trade, commish), status
  (pending, approved, rejected, successful; vetoed UNVERIFIED), timestamp
  (epoch; seconds versus milliseconds UNVERIFIED), trader_team_key,
  tradee_team_key, faab_bid, players with transaction_data (type,
  source_type, destination_type, source_team_key, destination_team_key;
  types team, freeagents, waivers), and `picks` for trades involving draft
  picks (round, original_team_key, source_team_key, destination_team_key;
  NO season and NO slot in the model). Pagination by start and count of 25
  (Go SDK). VERIFIED (docs plus yfpy plus whatadewitt).
- Draft results `league/{key}/draftresults`: pick, round, team_key,
  player_key, cost. No keeper marker; keepers via `players;status=K` and
  `is_keeper`. Available mid-draft for what has been picked. VERIFIED.
- Players: every collection is capped at 25 per page ("maximum 25 results
  per page"; on 2026-09-09 that sentence could be read only in the Go
  SDK's README, the official docs page having truncated in the fetcher, so
  the cap is community-attested and the client treats a shorter page as
  the end of the collection either way). Filters position, status A/FA/W/T/K, search, sort
  NAME/OR/AR/PTS/stat_id, sort_type, sort_season, sort_week, player_keys.
  Full universe via `game/nfl/players;start=N;count=25`. Fields include
  name (full, first, last, ascii_first, ascii_last), editorial_player_key,
  editorial_team_abbr, editorial_team_full_name, uniform_number, headshot,
  image_url, bye_weeks, display_position, primary_position,
  eligible_positions, position_type (O, K, DT, and D for IDP), status,
  status_full, injury_note, is_undroppable, percent_owned, ownership,
  draft_analysis (average_pick, average_round, average_cost,
  percent_drafted). VERIFIED.
- Projections: NONE per player. "No 'projected' parameters exist in URLs"
  (yfpy). Only `team_projected_points` and `win_probability` exist. VERIFIED.
- Users: `users;use_login=1/games`, `.../games;game_keys=nfl/leagues`,
  `.../games;game_keys=449,423/leagues`, `.../games;codes=nfl/teams`.
  Teams there carry `is_owned_by_current_login`. VERIFIED.
- Rate limits: none published. Community: HTTP 999 (yfpy), a non-JSON
  "Request denied" body keyed to the app id (whatadewitt issue 81), dropped
  connections on long loops (yfpy issue 51). UNVERIFIED numbers.
- Errors: expired token is a 401 whose description contains
  `oauth_problem="token_expired"`; refresh and retry once. VERIFIED
  (whatadewitt source).
- JSON shape: collections are numeric-keyed objects with a `count`;
  numbers arrive as strings; a resource's metadata and its sub-resources
  are split across `[0]` and `[1]`. VERIFIED (every library's parser).
- Write operations: XML bodies on PUT `team/{key}/roster` and POST
  `league/{key}/transactions`; shapes recorded in
  `yahoo-plan-notes.md` for the day write access returns. Not in this build.

### 2.4 Cross-reference data for player identity

- Sleeper's `/players/nfl` payload carries `yahoo_id`, `espn_id`,
  `gsis_id`, `sportradar_id`, `rotowire_id`, `rotoworld_id`, `stats_id`,
  `swish_id`, `fantasy_data_id`, `oddsjam_id`, `pandascore_id`
  (docs.sleeper.com plus ffscrapr's column list). Our `players.metadata.sleeper`
  already stores the whole object per the metadata rule. VERIFIED, and
  VERIFIED live: 5,448 of our 10,481 players carry a yahoo_id.
- Live coverage where it matters, measured 2026-09-08 against
  `cilvpyivysjxpxbudkfa`: among players that appear in `rankings`, QB
  44/106, RB 52/208, WR 75/272, TE 39/136, K 29/58, DEF 0/32 carry a
  Sleeper-supplied yahoo_id (239 of 780). Sleeper DEF ids are team codes
  ("PIT") and carry no yahoo_id. The gap is recent players. So Sleeper's
  yahoo_id is a SEED, not a mapping.
- DynastyProcess `db_playerids.csv`
  (`https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv`),
  header VERIFIED: mfl_id, sportradar_id, fantasypros_id, gsis_id, pff_id,
  sleeper_id, nfl_id, espn_id, yahoo_id, fleaflicker_id, cbs_id, pfr_id,
  cfbref_id, rotowire_id, rotoworld_id, ktc_id, stats_id, stats_global_id,
  fantasy_data_id, swish_id, name, merge_name, position, team, birthdate,
  age, draft_year, draft_round, draft_pick, draft_ovr, twitter_username,
  height, weight, college, db_season. Rebuilt weekly (nflreadr dictionary).
  2025 rookies had yahoo_id NA there too. So the csv is the second seed and
  a name match is the third (Part 6).

### 2.5 The three findings that changed the design

1. Per-reader OAuth with no public lookup means the "type any Sleeper
   handle" flows (League Pulse entry, Manager Pulse for someone else, On
   The Clock's username gate) have no Yahoo equivalent. A Yahoo league is
   reachable only through the connected reader's own account.
2. No per-player projections and a possibly unknown future schedule mean
   Power Pulse, Positional WAR, Lineups and the Schedules board cannot be
   fed by Yahoo. They are fed by OUR projection source keyed on the FF
   Beacon player id, which is why Part 6 is as long as it is.
3. Read-only access means Beacon Link style actions are not a Yahoo
   capability, and the 24-hour retention clause means the schema has to be
   able to run in a purge mode.

---

## Part 3. How the site is coupled to Sleeper today

Measured 2026-09-08. Files mentioning "sleeper" (case-insensitive): lib
454 of 814, app 175 of 426, components 109 of 327, scripts 21 of 65,
migrations 92 of 286. The coupling falls into seven kinds, and the build
addresses each in its own phase.

### 3.1 The client: `lib/sleeper.ts` (908 lines)

`safeFetch<T>(url, timeoutMs, maxBytes)` (`:53-100`) acquires a token from
`lib/sleeper-budget.ts` before every attempt (`:62`), retries once inside a
job on 429/503, returns null on anything else, and caps the body via
`readCapped` (`:104`). The budget is a singleton `new TokenBucket(600)`
(`lib/sleeper-budget.ts:135`) configured from
`manager_pulse_settings.sync.sleeperCallsPerMinute` by
`lib/league-bulk-sync.ts:881`. Twenty-six exported functions, listed with
their null-versus-empty semantics in `yahoo-plan-notes.md` section 8 and
the inventory. The ones that matter for the provider interface:

- League graph: `getSleeperUser`, `getSleeperLeagues` / `OrNull`,
  `getSleeperLeague`, `getSleeperRosters`, `getSleeperLeagueUsers`,
  `getSleeperTradedPicks`, `getSleeperLeagueDrafts`, `getSleeperDraft`,
  `getSleeperDraftPicksOrNull`, `getAllSleeperTransactions` (throws on a
  failed week, `:348`), `getSleeperMatchups` (null versus [] `:406`),
  `getSleeperWinnersBracket` / `Losers` (null versus []),
  `getSleeperDraftAutopickers`.
- Site clock and NFL data, NOT league-provider work: `getNflState()`
  (26 callers), `getNflHomeAwayMap`, `getWeeklyStats`,
  `getSleeperSeasonProjections`, `getSleeperWeeklyProjections`,
  `getSleeperPlayers`, `currentNflSeason`. These stay where they are. Sleeper
  the projection SOURCE and Sleeper the league PROVIDER are separate roles.

`lib/client-sleeper-import.test.ts` forbids any client component from
importing `@/lib/sleeper` (it pulls `node:async_hooks`). The provider layer
inherits that rule: `lib/providers/**` is server-only except the leaf
modules named in Part 4.6.

### 3.2 The sync: `lib/league-pulse.ts` (1,545 lines) and its guards

`pulseLeagueCore` fetches league, rosters, users and drafts, upserts them,
and only then stamps `last_pulsed_at` and `pulse_status` (`:380-396`).
`captureLeagueRawData` (`:695`) is the one door into transactions, brackets,
draft selections and matchups; `lib/league-capture-set.test.ts` scans all
of `lib/` to enforce it. `lib/league-matchups.ts normalizeIdList`
(`:104-107`) preserves Sleeper's positional "0" placeholders, and
`lib/league-matchups.test.ts` fails if a filter comes back.
`normalizeDraftPicks` is `lib/sleeper-draft-picks.ts:21-34`;
`validPlayerId` is `lib/league-pulse.ts:1503`.

### 3.3 The schema

Every league table keys on a Sleeper identifier by name:
`leagues.sleeper_league_id` (unique, and the URL segment),
`rosters.sleeper_roster_id` (unique with league_id), `rosters.owner_user_id`
and `co_owners` (Sleeper user ids), `league_users.sleeper_user_id`,
`league_transactions.sleeper_transaction_id`, `created_at_sleeper`,
`league_matchups.sleeper_roster_id`, `league_drafts.sleeper_draft_id`,
`draft_selections.sleeper_draft_id` / `sleeper_player_id` /
`sleeper_league_id`, `league_sync_jobs.sleeper_league_id` (the job's
identity, no FK; migration 0172:84), `league_sync_attempts`,
`manager_pulse_runs.sleeper_user_id`, `manager_pulse_run_leagues`,
`manager_pulse_cache`, `manager_pulse_tendencies` (PK is the Sleeper user
id), `manager_pulse_live_reports`, `would_you_rather_trades.sleeper_transaction_id`,
`player_weekly_projections.sleeper_player_id`, `player_market_snapshots`,
`player_roster_exposure` (PK), the six `on_the_clock_*` tables,
`draft_pick_observations`. Player ids inside jsonb: `rosters.player_ids`,
`starter_ids`, `reserve_ids`, `taxi_ids`; `league_matchups.starter_ids`,
`player_ids`, `player_points` keys; `league_transactions.adds` and `drops`
keys. Full column lists with types are in `yahoo-plan-notes.md` section 4.

`players` is keyed by uuid with `external_ids->>'sleeper'` under a unique
partial index (migration 0002:51-53 and 0227:192). `players.slug` embeds the
Sleeper id as a trailing `-<digits>` and is assigned once (`lib/sync-sleeper-players.ts:45-48`);
`sleeper_slug_tail` (migration 0271) is the second lookup key.

### 3.4 Player id resolution

Two chokepoints, both guard-tested: `resolveSleeperPlayers`
(`lib/sleeper-player-lookup.ts:105`; two passes, numeric-only filter at
`:111`, 14 callers) and `mapSleeperToPlayerIds` (`lib/players/sleeper-map.ts:38`;
handles DST codes, never throws, 3 callers).
`lib/players/sleeper-lookup-guard.test.ts` forbids the slug-LIKE scan
everywhere but the one file. `resolveExistingBySleeperId`
(`lib/sync-sleeper-players.ts:261`) is the reverse map the nightly player
sync uses to survive renames.

### 3.5 Routes

`app/leagues/[league_id]/**` (ten pages) reads `[league_id]` straight into
`.eq("sleeper_league_id", ...)` (`app/leagues/[league_id]/page.tsx:81`).
`[roster_id]` is the Sleeper roster id (`teams/[roster_id]/page.tsx:45`),
`[transaction_id]` on the trade OG route is the Sleeper transaction id
(`app/api/og/trade/[transaction_id]/route.tsx:53`), `[handle]` under
manager-pulse is a Sleeper handle. Three permanent redirects in
`next.config.ts` (`:45-47`, `:55-57`, `:72-74`) carry `/leagues/:league_id`.
`app/my-beacon/sleeper-leagues/` is the one route whose path segment names
the provider. Full inventory in `yahoo-plan-notes.md`.

### 3.6 Identity

`user_preferences.sleeper_league_settings` jsonb holds `username`,
`sleeper_user_id`, `sleeper_display_name`, `sleeper_avatar`,
`handle_verified_at`, `featured_league_id`, `shown_league_ids`,
`signal_league_ids` (parser `lib/sleeper-league-settings.ts:31-40`). The
five identity keys are written only by `app/actions/sleeper-handle.ts
saveSleeperHandle` and read only through `lib/sleeper-handle/resolve.ts`;
`lib/sleeper-handle/guard.test.ts` enforces both. The four gate states
(`guest`, `member-unsaved`, `member-saved`, `member-overridden`) live in
`lib/sleeper-handle/types.ts:58-68`. There is NO token storage table and NO
encryption helper in the repo today. Supabase Auth offers Google and Discord
(`app/login/login-form.tsx:67`).

### 3.7 Format, scoring and slots

`lib/sleeper-to-format.ts deriveLeagueFormat(league: SleeperLeague)` reads
`settings.type` (0 redraft, 1 keeper, 2 dynasty, 3 chopped), `scoring.rec`,
`roster_positions` (QB count or SUPER_FLEX), `bonus_rec_te` / `rec_te`.
`lib/league-category.ts categorizeLeague` reads `settings.best_ball` and
`settings.type`. `lib/league-scoring.ts scoreStatMap` is a dot product over
SLEEPER STAT KEYS; the 160-odd keys in use across our 474 leagues were
listed live and the core ones are the ones the Yahoo translation targets
(Part 7.4.2). Slot vocabulary: `PULSE_SLOT_ELIGIBILITY` in
`lib/power-pulse/types.ts:21-37` (QB, RB, WR, TE, K, DEF, DST, FLEX,
REC_FLEX, WR_TE, WRRB_FLEX, WRRB_WRT, SUPER_FLEX, Q_FLEX, IDP_FLEX) and
`NON_STARTING_SLOTS = {BN, IR, TAXI, NA}` (`:40`); labels, groups and
descriptions in `lib/league-schedule/slots.ts:86-152`; `startingSlots`
drops unprojectable tokens, `alignedStartingSlots` keeps them, and the two
must not be unified (`slots.ts:13-19`).

### 3.8 Provider-shaped patterns already in the repo

`source_registry` (migrations 0010, 0011) is the registry pattern: a slug,
a display name, an active flag, a priority, and a declaration of what the
row supports (`supported_format_slugs`). `lib/projections/source.ts` is the
resolver pattern: constants in a leaf module, a pure resolver, an impure
availability query, one read module, and a repo-wide guard test. Migration
0120 records that "Sleeper deliberately has no source_registry row": it is
a platform, not a value source. That is the seam the new registry sits in.

---

## Part 4. The provider model

### 4.1 Vocabulary and the two Sleepers

There are two Sleeper roles and they stay separate:

- Sleeper the PROVIDER hosts leagues. It becomes `lib/providers/sleeper/`
  and a `league_providers` row.
- Sleeper the SOURCE publishes projections, stats, ADP and the player
  universe. It stays in `lib/sleeper.ts` (`getNflState`, `getWeeklyStats`,
  `getSleeperWeeklyProjections`, `getSleeperPlayers`, `getNflHomeAwayMap`)
  and in `player_weekly_projections.source = 'sleeper'`.

A Yahoo league is scored with projections from the resolved PROJECTION
source (Sleeper's feed or the FF Beacon engine, per
`lib/projections/source.ts`), because Yahoo publishes none. That is not a
cross-wiring; it is the same thing Power Pulse does for a Sleeper league
today, and it works because both sides are keyed on `players.id`.

### 4.2 The registry: `league_providers`

One row per provider, service-role writes, public reads (there is nothing
secret in it).

```sql
create table public.league_providers (
  slug               text primary key
                       check (slug ~ '^[a-z][a-z0-9_]{1,31}$'),
  display_name       text not null,
  short_name         text not null,          -- "Sleeper", "Yahoo"
  is_active          boolean not null default false,
  display_order      integer not null default 100,
  auth_kind          text not null
                       check (auth_kind in (
                         'public_handle',   -- Sleeper, Fleaflicker: a public id, no credential
                         'oauth2',          -- Yahoo
                         'credentials',     -- MFL, CBS: username and password exchanged for a session
                         'api_key',         -- MFL APIKEY, Fantrax secret id
                         'session_cookie'   -- ESPN, NFL.com: cookies the reader pastes (see Appendix C on why this is not built)
                       )),
  capabilities       jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(capabilities) = 'object'),
  retention_policy   text not null default 'indefinite'
                       check (retention_policy in ('indefinite', 'rolling_24h')),
  attribution        jsonb not null default '{}'::jsonb,
  system_connection_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

- `auth_kind` decides which entry flow a tool renders: `public_handle`
  (Sleeper: type a username) or `oauth2` (Yahoo: Continue with Yahoo).
  The other three values are admitted by the constraint now, unused, so
  that a future provider phase never has to alter the registry (Appendix
  C says which host needs which). `provider-gate.tsx` throws on a value it
  has no card for, which the registry validation (`lib/providers/validate.ts`)
  prevents from being saved for an ACTIVE provider.
- `capabilities` is the DECLARED capability record (Part 4.3). It is
  validated server-side by `lib/providers/capabilities.ts
  parseCapabilities` on every read, the same way `parseSleeperLeagueSettings`
  validates its jsonb, so a hand-edited row cannot crash a page.
- `retention_policy` is the switch of Part 5.5.
- `attribution` holds the sentence, the logo asset path and the required
  link for providers that require attribution: for Yahoo
  `{"sentence": "Fantasy data provided by Yahoo Fantasy", "logo": "/brand/yahoo-fantasy.svg", "poweredBy": "/brand/powered-by-yahoo-white.png", "href": "https://www.yahoo.com/?ilc=401"}`.
  Sleeper's is `{}`.
- `system_connection_user_id` names the account whose connection runs
  provider-wide jobs that need a token but belong to no reader (the Yahoo
  player-universe sync, the stat-categories read). For Yahoo this is the
  owner's own account, because Yahoo has no app-only token. Null for
  Sleeper.

Seed rows: `('sleeper', 'Sleeper', 'Sleeper', true, 10, 'public_handle',
<Part 4.3 sleeper record>, 'indefinite', '{}', null)` and `('yahoo',
'Yahoo Fantasy', 'Yahoo', false, 20, 'oauth2', <Part 4.3 yahoo record>,
'rolling_24h', <attribution above>, null)`. Yahoo ships INACTIVE and is
flipped by an admin after approval and after the retention answer.

Admin surface: `/admin/providers` (Part 10.9) edits `is_active`,
`retention_policy`, `system_connection_user_id` and the capability
overrides, validated by `lib/providers/validate.ts`.

### 4.3 Capabilities

The record is one TypeScript type, `ProviderCapabilities` in
`lib/providers/capabilities.ts` (a LEAF module with no imports so client
components can read it). Every key is a boolean or a small enum. Keys are
grouped by the surface that reads them. A DECLARED capability is set on the
registry row. A PROBED capability is declared as `"probe"` on the row and
resolved per league at sync time into `leagues.capabilities_observed`
(Part 5.1), because the fact is only knowable from data.

```ts
export type Tri = boolean | "probe";

export type ProviderCapabilities = {
  // Identity and discovery
  publicLookupByHandle: boolean;   // Sleeper true, Yahoo false
  listOwnLeagues: boolean;         // both true (Yahoo via the connection)
  listLeaguesForOtherUser: boolean; // Sleeper true, Yahoo false
  historicalSeasons: boolean;      // both true
  leagueLineage: boolean;          // previous/next season link: both true

  // League shape
  scoringSettings: boolean;        // both true (Yahoo via translation)
  rosterPositions: boolean;        // both true (Yahoo via translation)
  dynastyType: boolean;            // Sleeper true, Yahoo false (Part 7.6)
  keeperFlag: boolean;             // both true (Yahoo via is_keeper / status=K)
  bestBall: boolean;               // Sleeper true, Yahoo false
  taxiSquad: boolean;              // Sleeper true, Yahoo false
  injuredReserveSlot: boolean;     // both true
  idpSlots: boolean;               // both true
  faab: boolean;                   // both true
  waiverPriority: boolean;         // both true
  coOwners: boolean;               // both true (Yahoo is_comanager)
  commissionerFlag: boolean;       // both true
  leagueLogo: boolean;             // both true
  teamLogo: boolean;               // Sleeper via user avatar, Yahoo team_logos

  // Rosters and lineups
  rosters: boolean;                // both true
  positionalStarters: boolean;     // both true (Yahoo built from selected_position)
  historicalWeeklyRosters: boolean; // Sleeper via matchups rows, Yahoo via roster;week=N

  // Results
  matchupsSettled: boolean;        // both true
  perPlayerWeeklyPoints: boolean;  // both true
  futureSchedule: Tri;             // Sleeper true, Yahoo "probe"
  playoffBracket: boolean;         // Sleeper true, Yahoo false (is_playoffs flags only)
  officialTeamTotals: boolean;     // both true

  // Transactions
  transactions: boolean;           // both true
  transactionWeek: boolean;        // Sleeper true, Yahoo false (timestamp only; Part 7.4.5)
  tradedPicksInTrades: boolean;    // both true
  tradedPickSeason: Tri;           // Sleeper true, Yahoo "probe"
  tradedPickAssetsOnRoster: boolean; // Sleeper true (traded_picks), Yahoo false
  faabBids: boolean;               // both true
  waiverOrderChanges: boolean;     // Sleeper true, Yahoo false

  // Draft
  draftResults: boolean;           // both true
  draftOrder: boolean;             // both true (Yahoo draft_position)
  auctionCosts: boolean;           // both true
  liveDraft: boolean;              // Sleeper true (On The Clock), Yahoo false
  draftAutopickers: boolean;       // Sleeper true, Yahoo false

  // Projections and market
  perPlayerProjections: boolean;   // Sleeper true (source feed), Yahoo false
  teamProjectedPoints: boolean;    // Sleeper false, Yahoo true (display only)
  percentOwned: boolean;           // Yahoo true, Sleeper false
  adp: boolean;                    // Sleeper true (source feed), Yahoo true (draft_analysis)
  freeAgentList: boolean;          // both true (Yahoo via players;status=FA, paged at 25)

  // Live and links (added in revision 2; the matrix in Part 4.9 exposed them)
  livePoints: Tri;                 // in-progress scores: Sleeper true, Yahoo "probe" (midevent UNVERIFIED)
  standingsPublished: boolean;     // the provider states rank and seed: Sleeper false (we derive), Yahoo true
  providerLeagueUrl: boolean;      // a link back to the league on the provider: both true

  // Writes
  writeLineup: boolean;            // both false in this build
  writeWaiverClaim: boolean;       // both false in this build
  writeTrade: boolean;             // both false in this build
  writeChat: boolean;              // both false in this build

  // Operational
  publicData: boolean;             // Sleeper true, Yahoo false
  requiresUserToken: boolean;      // Sleeper false, Yahoo true
  maxPageSize: number | null;      // Sleeper null, Yahoo 25
};
```

`lib/providers/capabilities.ts` also exports:

- `SLEEPER_CAPABILITIES` and `YAHOO_CAPABILITIES`, the code fallbacks
  (the same pattern as `lib/power-pulse/default-settings.ts`). The registry
  row wins where it differs, so an admin can turn a capability off without
  a deploy, but can never turn one ON that the code says is false (the
  parser clamps: `row && code`). That asymmetry is deliberate: a row can
  only make us more honest.
- `parseCapabilities(raw: unknown, fallback: ProviderCapabilities)`.
- `resolveCapability(key, declared, observed)`: for a `Tri`, the observed
  boolean wins when present; a `"probe"` with nothing observed yet reads as
  false, never as true.
- `derivedCapabilities(row)`: the keys that are NOT stored on the registry
  row because they follow from another column. Today there is one,
  `historyRetained`, which is `retention_policy === 'indefinite'` (Part
  5.5). A derived key is read through the same `resolveCapability` call so
  a surface cannot tell the difference, and it can never be overridden by
  the admin checklist because it is not on the row.

ABSOLUTE RULE: a surface that depends on a capability reads it through
`resolveCapability` and renders `components/providers/capability-notice.tsx`
(Part 10.2) when it is false. It never renders a zero, an empty chart or a
100% figure in its place. `lib/providers/capability-guard.test.ts` (Part
14.2) scans every page under `app/leagues/` and every component under
`components/` that names one of the capability-bearing panels (the list is
the guard's allow-list) and asserts the read is present.

### 4.4 The `LeagueProvider` interface

`lib/providers/types.ts` (server-only shapes; the leaf types the client
needs are in `lib/providers/capabilities.ts` and `lib/providers/refs.ts`).

```ts
export type ProviderSlug = "sleeper" | "yahoo";

/** How a caller identifies itself to a provider that needs a token. */
export type ProviderActor =
  | { kind: "anonymous" }
  | { kind: "connection"; connectionId: string; userId: string }
  | { kind: "system" };   // the registry's system connection

export type ProviderFailure =
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "reconnect_required"; detail: string }
  | { ok: false; reason: "not_authorized"; detail: string }   // Yahoo 403
  | { ok: false; reason: "not_member" }
  | { ok: false; reason: "throttled"; retryAfterMs: number }
  | { ok: false; reason: "unavailable"; detail: string }      // network, 5xx
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "unsupported"; capability: keyof ProviderCapabilities };

export type ProviderResult<T> = { ok: true; value: T } | ProviderFailure;

export interface LeagueProvider {
  readonly slug: ProviderSlug;
  readonly capabilities: ProviderCapabilities;

  /** Discovery */
  resolveHandle(handle: string): Promise<ProviderResult<ProviderUser | null>>;
  listLeagues(actor: ProviderActor, args: { season: number; providerUserId?: string })
    : Promise<ProviderResult<ProviderLeagueSummary[]>>;

  /** The capture set, one call each, all normalised */
  getLeague(actor, ref: ProviderLeagueRef): Promise<ProviderResult<ProviderLeague>>;
  getRosters(actor, ref): Promise<ProviderResult<ProviderRoster[]>>;
  getMembers(actor, ref): Promise<ProviderResult<ProviderMember[]>>;
  getTransactions(actor, ref, args: { fromWeek?: number; maxWeek?: number })
    : Promise<ProviderResult<ProviderTransaction[]>>;
  getDrafts(actor, ref): Promise<ProviderResult<ProviderDraft[]>>;
  getDraftPicks(actor, draftRef: ProviderDraftRef): Promise<ProviderResult<ProviderDraftPick[]>>;
  getMatchups(actor, ref, week: number): Promise<ProviderResult<ProviderMatchup[]>>;
  getBrackets(actor, ref): Promise<ProviderResult<ProviderBracket | null>>;
  getTradedPicks(actor, ref): Promise<ProviderResult<ProviderTradedPick[]>>;

  /** Player universe (system actor) */
  listPlayers(actor, args: { season: number }): AsyncIterable<ProviderPlayer[]>;

  /** Clock */
  getWeekCalendar(actor, season: number): Promise<ProviderResult<ProviderWeek[]>>;
}
```

Every method returns a `ProviderResult` and NEVER throws for a provider
condition. That is the same null-versus-empty discipline `lib/sleeper.ts`
already enforces, made into a type: `{ ok: true, value: [] }` means the
provider answered with nothing, and any `ok: false` means the provider did
not answer, so no caller can mistake the two. This matters most for the
matchups path, where CLAUDE.md records that collapsing them once cached a
whole league at 0.0 wins.

The Sleeper implementation wraps the existing functions (Part 8) and does
not change their behaviour. The Yahoo implementation is Part 7.

`lib/providers/registry.ts` exports `getProvider(slug): LeagueProvider`,
`listActiveProviders(supabase)` (the impure read of `league_providers`,
cached per request with `react.cache`) and `providerForLeague(league)`. The
registry is the ONLY place a provider implementation is imported;
`lib/providers/registry-guard.test.ts` fails on any other import of
`lib/providers/sleeper/*` or `lib/providers/yahoo/*` outside `lib/providers/`
and their own tests.

### 4.5 Normalised shapes

`lib/providers/types.ts`. Every shape carries `raw: unknown`, the provider's
original object, which the sync writes to the row's `metadata` column
unchanged (the Original Source Object rule). The normalised fields are what
the sync writes to named columns.

```ts
export type ProviderLeagueRef = { provider: ProviderSlug; providerLeagueId: string };
export type ProviderDraftRef  = { provider: ProviderSlug; providerDraftId: string };

export type ProviderUser = {
  providerUserId: string;       // Sleeper user_id, Yahoo guid
  handle: string | null;        // Sleeper username; Yahoo null (no public handle)
  displayName: string | null;   // Sleeper display_name; Yahoo nickname
  avatarUrl: string | null;     // absolute URL, already validated
  raw: unknown;
};

export type ProviderLeagueSummary = {
  ref: ProviderLeagueRef;
  name: string;
  season: number;
  status: "pre_draft" | "drafting" | "in_season" | "complete";
  totalRosters: number;
  logoUrl: string | null;
  shape: LeagueShape;           // enough to categorise without a full sync
  raw: unknown;
};

/** The provider-neutral input to deriveLeagueFormat and categorizeLeague. */
export type LeagueShape = {
  keeperStyle: "redraft" | "keeper" | "dynasty" | "unknown";
  isBestBall: boolean;
  scoringSettings: Record<string, number>;   // SLEEPER-KEYED, always
  rosterPositions: string[];                 // SLEEPER TOKENS, always
  totalRosters: number;
  playoffWeekStart: number | null;
  currentWeek: number | null;
  lastScoredWeek: number | null;
  seasonStartWeek: number;                   // Yahoo start_week, Sleeper 1
  seasonEndWeek: number;                     // Yahoo end_week, Sleeper 17/18
  visibility: "public" | "members";          // Yahoo league_type, Sleeper public
};

export type ProviderLeague = ProviderLeagueSummary & {
  previousProviderLeagueId: string | null;   // Sleeper previous_league_id, Yahoo renew
  nextProviderLeagueId: string | null;       // Sleeper null, Yahoo renewed
  draftRefs: ProviderDraftRef[];
  observed: Partial<Record<keyof ProviderCapabilities, boolean>>; // probes
};

export type ProviderRoster = {
  providerRosterId: number;                   // Sleeper roster_id, Yahoo team_id
  ownerProviderUserId: string | null;
  coOwnerProviderUserIds: string[];
  playerIds: string[];                        // PROVIDER player ids
  starterIds: string[];                       // positional, "0" for an empty slot
  reserveIds: string[];
  taxiIds: string[];
  record: { wins: number; losses: number; ties: number };
  pointsFor: number; pointsAgainst: number;
  waiverPosition: number | null;
  waiverBudgetRemaining: number | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  draftPickAssets: ProviderTradedPick[];      // Yahoo []
  raw: unknown;
};

export type ProviderMember = ProviderUser & {
  isOwner: boolean; isCommissioner: boolean; teamName: string | null;
  providerRosterId: number | null;
};

export type ProviderTransaction = {
  providerTransactionId: string;
  type: "trade" | "waiver" | "free_agent" | "commissioner";
  status: "complete" | "pending" | "failed";
  week: number | null;                        // Yahoo null (Part 7.4.5)
  season: number;
  occurredAt: string;                         // ISO, UTC
  adds: Record<string, number>;               // providerPlayerId -> providerRosterId
  drops: Record<string, number>;
  draftPicks: ProviderTradedPick[];
  waiverBudget: { sender: number; receiver: number; amount: number }[];
  faabBid: number | null;
  rosterIds: number[];
  raw: unknown;
};

export type ProviderTradedPick = {
  season: number | null;                      // Yahoo may be null (probe)
  round: number;
  originalProviderRosterId: number;
  previousProviderRosterId: number | null;
  ownerProviderRosterId: number;
  raw: unknown;
};

export type ProviderDraft = {
  ref: ProviderDraftRef;
  season: number;
  status: "pre_draft" | "drafting" | "complete";
  type: "snake" | "linear" | "auction" | "unknown";
  startedAt: string | null;
  slotToProviderRosterId: Record<string, number>;
  rounds: number | null;
  raw: unknown;
};

export type ProviderDraftPick = {
  pickNo: number; round: number; draftSlot: number | null;
  providerRosterId: number; pickedByProviderUserId: string | null;
  providerPlayerId: string; isKeeper: boolean; cost: number | null;
  raw: unknown;
};

export type ProviderMatchup = {
  providerRosterId: number;
  matchupId: number | null;
  points: number;
  starterIds: string[];                       // positional, "0" for empty
  starterPoints: number[];
  playerIds: string[];
  playerPoints: Record<string, number>;
  isFinal: boolean;
  isPlayoff: boolean | null;
  raw: unknown;
};

export type ProviderWeek = { week: number; startsOn: string; endsOn: string };

export type ProviderPlayer = {
  providerPlayerId: string;
  fullName: string; firstName: string; lastName: string;
  asciiName: string | null;
  position: string;                           // normalised: QB RB WR TE K DEF DL LB DB
  eligiblePositions: string[];
  teamAbbr: string | null;                    // NORMALISED to nfl_teams.abbreviation
  status: string | null;
  jerseyNumber: number | null;
  headshotUrl: string | null;
  externalIds: Record<string, string>;        // whatever the provider offers
  raw: unknown;
};
```

The two invariants to hold on to: `LeagueShape.scoringSettings` is always
Sleeper-keyed and `LeagueShape.rosterPositions` is always Sleeper tokens.
Every model and every derivation (`deriveLeagueFormat`, `categorizeLeague`,
`scoreStatMap`, `startingSlots`, `alignedStartingSlots`) keeps working
unchanged because the translation happens once, at the provider boundary,
and is stored on the `leagues` row. The raw Yahoo settings live in
`leagues.metadata` for audit.

### 4.6 Absolute rules for the provider layer

- The registry is the only importer of a provider implementation
  (Part 4.4). Guard: `lib/providers/registry-guard.test.ts`.
- Nothing under `app/`, `components/` or the models imports
  `@/lib/sleeper` for LEAGUE data once Phase 3 lands; they import
  `@/lib/providers/registry`. `lib/sleeper.ts` keeps its SOURCE functions
  and the client-import guard keeps forbidding it in client components.
  Guard: `lib/providers/league-import-guard.test.ts` lists the Sleeper
  league functions by name and fails on any import outside
  `lib/providers/sleeper/` and `lib/league-pulse.ts` during the transition
  (the allow-list is the debt ledger and shrinks to empty by Phase 3's end).
- A `ProviderResult` failure is never collapsed into an empty value. Guard:
  a type; `ok: false` has no `value`.
- A provider id is never read by a model. Models read `leagues.id`,
  `rosters.id`, `players.id`. Guard: `lib/providers/model-id-guard.test.ts`
  greps `lib/power-pulse/`, `lib/positional-war/`, `lib/manager-ledger/`,
  `lib/trade-impact/`, `lib/faab/`, `lib/would-you-rather/`,
  `lib/manager-pulse/` for `provider_league_id`, `provider_roster_id`,
  `provider_user_id`, `sleeper_league_id`, `sleeper_roster_id`,
  `sleeper_user_id` in a SELECT or a filter; every hit must be in the
  allow-list with a reason (today: `lib/manager-pulse/*` reads
  `provider_league_id` to link job rows, which is discovery, not a model).
- The translation to Sleeper keys and Sleeper slot tokens happens in the
  provider and nowhere else. Guard: `lib/providers/yahoo/scoring-map.test.ts`
  asserts every key the map emits is in the live scoring vocabulary of
  Part 7.4.2, and `lib/providers/yahoo/slot-map.test.ts` asserts every
  emitted token has an entry in `PULSE_SLOT_ELIGIBILITY` or
  `NON_STARTING_SLOTS` or the IDP set in `lib/league-schedule/slots.ts`.
- Provider copy never leaks. Every user-facing string that names a
  provider goes through `providerCopy(provider)` in
  `lib/providers/copy.ts` (Part 10.1). Guard: `lib/providers/copy-guard.test.ts`
  greps `components/` and `app/` for the literal "Sleeper" outside the
  allow-list (legal pages, the Sleeper-only tools named in Part 11, the
  copy module itself).
- A Yahoo token never leaves the server, is never logged, and is never in
  a prompt. Guard: Part 12.

### 4.7 Why one table set, and the two things kept apart

One table set for leagues, rosters, members, transactions, matchups,
drafts and draft selections, with a `provider` column and provider-neutral
column names. The reasons, in order of weight:

1. Every model reads these tables by `league_id` uuid and never by provider
   id (verified by the inventory: `league_power_pulse_cache`,
   `league_positional_war_cache`, `league_manager_ledger_cache`,
   `would_you_rather_trades`, `league_activity`, `league_power_rankings_cache`
   all key on `leagues.id`). A second table set would double every read
   path in seven models for no information gain.
2. The CLAUDE.md naming rule forbids source names in table names and gives
   `sleeper_players` as the example of what not to do. The existing
   columns (`sleeper_league_id`, `sleeper_roster_id`) already violate the
   spirit of that rule; this plan is the moment to fix them.
3. Would You Rather, Manager Pulse and the cross-league features the owner
   wants "to simply pull from both providers" become a single query with no
   UNION.
4. RLS visibility (Part 5.2) is one policy per table instead of two.

The two things that ARE kept in their own tables, and why:

- `provider_connections` (Part 5.3): a Yahoo connection holds secrets and
  has a lifecycle (refresh, revoke, reconnect) that the saved Sleeper handle
  does not. Putting a Vault secret id in `user_preferences` jsonb would put
  a secret reference in a column the account owner can PATCH (the same
  reason `lib/sleeper-league-settings.ts:88-89` says the jsonb is "NOT an
  authorization boundary"). Connections are service-role-only with an
  owner-readable status view.
- `provider_players` (Part 5.4): the owner asked for the provider id lists
  to be separate from the FF Beacon dimension, and that is right: `players`
  is a merged dimension with one row per human, and a provider's list is an
  edge table from that provider's id to ours. It is ONE table with a
  `provider` column rather than a table per provider, for the same naming
  reason as above and because the identity resolver, the review queue and
  the consistency check are then written once. Sleeper's list goes into the
  same table (backfilled from `players.external_ids->>'sleeper'`) so the
  two providers are symmetric and a third costs no DDL.

### 4.8 The provider module contract, and adding a third provider

A provider is a directory, a registry row, a capability record, a copy
entry, a fixture set and a test set. Nothing else in the repository
changes when one is added. The contract below is what
`lib/providers/contract.test.ts` (LP-T014) checks by walking
`lib/providers/*/` and asserting every required file exists for every
slug in `ProviderSlug`, so a half-built provider cannot be registered.

```
lib/providers/<slug>/
  README.md        What the provider is, the auth model, the URLs, the
                   known quirks, the UNVERIFIED list, and the date each
                   fact was last checked. Written before any code.
  constants.ts     LEAF. Base URL, slug, page size, timeout. No imports.
  provider.ts      Implements LeagueProvider (Part 4.4). The only export
                   the registry imports.
  client.ts        The HTTP layer: budget token, timeout, size cap, and
                   the response classifier to ProviderFailure. Sleeper's
                   is a thin wrapper over lib/sleeper.ts safeFetch.
  json.ts          Provider-specific response normalisation (Yahoo). May
                   be absent where the provider returns plain JSON; then
                   the contract test accepts a comment in provider.ts
                   saying so.
  map-league.ts    Pure functions from the provider's raw object to the
  map-roster.ts    Part 4.5 shapes. Each carries `raw` through untouched.
  map-member.ts
  map-transaction.ts
  map-draft.ts
  map-matchup.ts
  map-player.ts
  scoring-map.ts   Raw scoring to Sleeper-keyed scoringSettings (Part
                   7.4.2). Sleeper's is the identity function, kept as a
                   file so the contract is uniform.
  slot-map.ts      Raw roster positions to Sleeper tokens. Sleeper's is
                   the identity function.
  oauth.ts         Only for auth_kind = 'oauth2'.
  fixtures/        One JSON per response shape, scrubbed (Part 14.3),
                   with `_fixture_source` on each.
  *.test.ts        One per map file, client.test.ts against the fixtures,
                   and provider.test.ts for null-versus-empty on every
                   method of the interface.

components/providers/<slug>/
  connect-button.tsx   Only for oauth2 (the provider's own button art).
  mark.tsx             The monochrome wordmark that provider-mark.tsx
                       renders.
```

A provider-specific COMPONENT beyond those two is a smell, because every
surface is provider-neutral and reads capabilities. Sleeper's component
directory holds only `mark.tsx`.

Outside the directory, exactly these change when a provider is added:

- `lib/providers/capabilities.ts`: a `<SLUG>_CAPABILITIES` record with
  every key filled, and a comment on each key that is false or `"probe"`
  naming the URL or fixture that proves it. A key nobody can prove is
  `"probe"` or false, never true.
- `lib/providers/types.ts`: the slug added to `ProviderSlug`.
- `lib/providers/registry.ts`: one line in the slug-to-implementation map.
- `lib/providers/copy.ts`: one `ProviderCopy` entry.
- `lib/providers/capability-copy.ts`: a sentence for every key that is
  false or `"probe"` for the new provider and not already covered.
- One migration inserting the `league_providers` row, inactive. Nothing
  else in the schema: provider ids are `text` everywhere, on purpose.
- `scripts/sync-<slug>-players.ts` for the universe, its cron route, and
  a `match_method` value in Part 6.1 if the provider ships its own
  cross-reference.
- `vercel.json`: the universe sync cron and nothing that iterates leagues.
- `public/brand/<slug>/` if the provider requires attribution art, and
  the `attribution` jsonb on the registry row.
- `next.config.ts images.remotePatterns` and the CSP `img-src` in
  `lib/security-headers.ts` for the provider's image host (Part 12).
- `docs/league-providers/<slug>-notes.md`: the research record.

The checklist, in order. This is the shape of every future provider phase:

1. Research record: auth model, access programme, terms (retention,
   attribution, commercial use), rate limits, every resource the capture
   set needs, id schemes, the cross-reference to Sleeper ids. A URL per
   fact; UNVERIFIED on anything else.
2. Capability record, filled from that record.
3. Registry row migration, inactive.
4. Fixtures from the docs, replaced from a real account on day one.
5. `json.ts`, `client.ts` and the classifier, against the fixtures.
6. `scoring-map.ts` and `slot-map.ts` with the two vocabulary tests.
7. The seven map files with tests.
8. `provider.ts` and `provider.test.ts`.
9. Universe sync and the identity resolver's new seed, if any.
10. The entry flow: the connect flow for oauth2, the gate branch for
    public_handle, or a new `auth_kind` (Appendix C names the two more
    that ESPN and MFL would need, and 4.2's check constraint is widened
    in 0279 to admit them now so no later migration touches the registry).
11. Copy entry, capability sentences, mark, attribution art.
12. Three test leagues, the spike, the UNVERIFIED list closed.
13. The Sleeper model regression (Part 14.5) still empty.
14. Flip active. The public capabilities page (Part 10.10) shows the new
    column with no code change.

Steps 5 to 8 are the bulk, and they are pure functions with fixtures. The
Yahoo build in Part 15 is the first walk through this list and is the
longest on purpose: it also builds the shared pieces (Parts 4 to 6) that
every later provider inherits.

### 4.9 The capability matrix

Every feature on the site, the capability keys it reads, what each
provider answers, and what renders when a key is false. This table has
three consumers and one source. The source is
`lib/providers/capability-matrix.ts`, which exports `CAPABILITY_MATRIX`,
an array of `{ group, feature, component, keys, whenAbsent }` rows. The
consumers are `lib/providers/capability-guard.test.ts` (for each row, the
named component must contain a `resolveCapability(` call for each listed
key, or an allow-list line with a reason), the public page in Part 10.10
(renders the rows), and this document (the rows at planning time; the
build report records any drift). A feature that reads no key is listed
too, with "none", so the guard can tell a deliberate omission from a
forgotten one.

Sleeper and Yahoo columns give the DECLARED answer from Part 4.3; "probe"
means the answer is per league (Part 7.7). "Write" keys are false for both
in this build.

Discovery and identity:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| League Pulse entry, the search form | `components/league-pulse-form.tsx` | publicLookupByHandle, listLeaguesForOtherUser | yes, yes | no, no | The form is not rendered for that provider; the connect card is (10.3). |
| Identity card versus connection card | `components/providers/provider-gate.tsx` | requiresUserToken | no | yes | Chooses the card variant; never absent. |
| Dashboard and tool league lists | `components/providers/provider-league-list.tsx` | listOwnLeagues | yes | yes | Never absent. |
| Season lineage link ("last season", "next season") | league switcher | leagueLineage | yes | yes | Link hidden. |
| Manager Pulse: search another handle | `components/manager-pulse/search-form.tsx` | publicLookupByHandle, listLeaguesForOtherUser, historicalSeasons | yes, yes, yes | no, no, yes | Search box is Sleeper-only; the card offers "Open my Yahoo history" (11.4). |
| Manager Pulse: retention sentence | report header | historyRetained (derived) | yes | per policy | Sentence from 10.2. |

League overview:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Masthead line and link back to the league | `components/league-masthead.tsx` | providerLeagueUrl | yes | yes | Plain text name, no link. |
| Rankings table, value mode, picks column | `components/league-rankings-table.tsx` | rosters, tradedPickAssetsOnRoster | yes, yes | yes, no | Picks column header carries the sentence once, in the caption, never per row. |
| Rankings table, Power Pulse mode | same | matchupsSettled, futureSchedule | yes, yes | yes, probe | `scheduleMode = 'unknown_beyond_week'` and the notice (7.8). |
| Record and playoff seed | standings block | standingsPublished | no | yes | When false we derive the record from rosters as today; when true the provider's seed is shown as a "seed" chip. |
| Teams tab: starters, bench, IR, taxi | `components/league-teams-tab.tsx` | rosters, positionalStarters, injuredReserveSlot, taxiSquad | yes x4 | yes, yes, yes, no | Taxi section absent with no sentence (4.3). |
| Team logos and member avatars | `components/providers/member-avatar.tsx` | teamLogo, coOwners | yes, yes | yes, yes | Placeholder. |
| Activity panel and its week filter | `components/league-activity-panel.tsx` | transactions, transactionWeek | yes, yes | yes, no | Week filter offered only where derived weeks exist (7.4.5). |
| Format override control | `components/league-format-override.tsx` | dynastyType | yes | no | INVERSE gate: the control appears only when the key is false (7.6). |

Schedules:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Week view, future weeks | `components/league-schedule/week-board.tsx` | futureSchedule | yes | probe | Empty state with the notice instead of "no games on file". |
| Live scores on the board | same | livePoints | yes | probe | Board shows "upcoming" and "final" only until a week settles. |
| Matchup detail projections footnote | `components/league-schedule/matchup-detail.tsx` | perPlayerProjections | yes | no | Footnote: projections are FF Beacon's (10.2). Numbers unchanged: they come from the projection SOURCE either way. |
| Playoff bracket panel | `components/league-bracket.tsx` | playoffBracket | yes | no | Panel replaced by playoff-week labels from `is_playoff` and the notice. |

Power Pulse and Positional WAR:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Projected wins and playoff odds | `components/power-pulse/panel.tsx` | futureSchedule, matchupsSettled, officialTeamTotals | yes x3 | probe, yes, yes | `scheduleMode` unknown plus notice. |
| Lineup realism correction | same | perPlayerWeeklyPoints | yes | yes | Never absent; off by default regardless. |
| Positional WAR curves | `components/positional-war/chart.tsx` | scoringSettings, rosterPositions | yes, yes | yes, yes | Never absent; translation gaps are listed in the "how this was calculated" disclosure. |

Decisions (Manager Ledger):

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Lineup ledger | `components/manager-ledger/lineups.tsx` | matchupsSettled, perPlayerWeeklyPoints, positionalStarters | yes x3 | yes x3 | Never absent. |
| Waiver ledger | `components/manager-ledger/waivers.tsx` | transactions, faabBids, transactionWeek | yes x3 | yes, yes, no | Week is derived; the page says so (7.4.5). |
| Trade ledger | `components/manager-ledger/trades.tsx` | transactions, tradedPicksInTrades | yes, yes | yes, yes | `trade_any_picks` flag as today. |
| Draft ledger | `components/manager-ledger/draft.tsx` | draftResults, keeperFlag, auctionCosts | yes x3 | yes x3 | Never absent. |
| Retention sentence | page header | historyRetained | yes | per policy | Sentence from 10.2. |

Lineups:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Optimiser and the what-if | `components/league-lineups/board.tsx` | rosters, positionalStarters | yes, yes | yes, yes | Never absent. |
| Free agent panel | `components/league-lineups/waivers-panel.tsx` | freeAgentList | yes | yes (25 per page, top 100) | Panel renders "not available on {provider}". |
| Cut list dynasty guard | `components/league-lineups/cut-list.tsx` | dynastyType (or the override) | yes | via override | Guard reads `keeperStyle` off `LeagueShape`, which the override feeds. |
| Taxi section | same board | taxiSquad | yes | no | Absent, no sentence. |
| Projection column footnote | same board | perPlayerProjections | yes | no | Footnote (10.2). |

Trade Ideas, Signal Check and the trade builder:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Asset picker: future picks | `components/trade-ideas/asset-picker.tsx` | tradedPickAssetsOnRoster | yes | no | Picks not offered; the empty state says why. |
| Pick season in a verdict | `components/trade-verdict.tsx` | tradedPickSeason | yes | probe | "Priced as {season}" sentence (11.3). |
| Win side of the verdict | same | futureSchedule | yes | probe | `scheduleMode` unknown. |
| Signal Check import list | `components/signal-check/import-panel.tsx` | transactions, listOwnLeagues | yes, yes | yes, yes | Never absent. |

Transactions feed:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Type, team, week and season filters | `components/transactions-filters.tsx` | transactions, transactionWeek | yes, yes | yes, no | Week filter present only where derived weeks exist. |
| Waiver order change rows | `components/transaction-row.tsx` | waiverOrderChanges | yes | no | Those rows are simply absent. |
| FAAB amounts on a row | same | faabBids | yes | yes | Never absent. |

Games, tools and the rest:

| Feature | Component | Keys | Sleeper | Yahoo | When absent |
| --- | --- | --- | --- | --- | --- |
| Would You Rather pool admission | `lib/would-you-rather/pool.ts` | transactions, tradedPicksInTrades, plus the visibility rule of 11.2 | yes, yes | yes, yes | Never absent; a members-only league is excluded by the setting, not by a key. |
| Would You Rather reveal | `components/would-you-rather/review.tsx` | none (reads the two caches) | | | "Not built yet" line as today. |
| On The Clock draft room | `app/tools/on-the-clock/**` | liveDraft, draftAutopickers | yes, yes | no, no | The tool index says it is a Sleeper draft room; no Yahoo entry is offered (11.6). |
| Beacon Link actions | unbuilt | writeLineup, writeWaiverClaim, writeTrade, writeChat | no x4 | no x4 | The connect page says Yahoo is read-only (10.3). |
| FAAB tool free agents | `components/faab/free-agents.tsx` | freeAgentList, faab | yes, yes | yes, yes | Never absent. |
| Beacon Breakdown matchup header | `components/breakdown/matchup-header.tsx` | matchupsSettled, futureSchedule | yes, yes | yes, probe | Header shows the settled weeks only. |
| Player profile trades tab | `components/player-profile/trades-tab.tsx` | none (uuid RPC, 11.10) | | | Never absent. |
| Player exposure panel | `components/player-exposure-panel.tsx` | publicData | yes | no | "Across synced Sleeper leagues" (11.10). |
| League Relay to Discord | `lib/league-relay/relay.ts` | transactions, matchupsSettled | yes, yes | yes, yes | Never absent; a Yahoo league relays only under a member's connection (11.9). |
| Signal profile league block | `components/signal-profile/leagues-block.tsx` | none (RLS hides members-only leagues) | | | The editor says why a league is not shown. |
| OG images, all routes | `app/api/og/**` | as the page they mirror, plus the attribution band | | | Attribution band for Yahoo (10.6, 11.11). |
| Public capabilities page | `app/providers/page.tsx` | every key | | | The page itself (10.10). |
| Admin providers page | `app/admin/providers/page.tsx` | every key, plus overrides | | | The admin view (10.9). |

Three things the matrix made visible that revision 1 had not written down:
the free agent panel had no key and would have called Yahoo's paged
endpoint unguarded (`freeAgentList`); the Schedules board's live scores
column assumed Sleeper's in-progress points and Yahoo's mid-week scoreboard
status is unverified (`livePoints`, a probe); and the masthead link back to
the league had no key while Yahoo's attribution rule requires exactly that
link (`providerLeagueUrl`). `standingsPublished` was added because Yahoo
states a playoff seed that Sleeper does not, and hiding a fact a provider
publishes is the mirror image of the mistake this plan exists to prevent.

---

## Part 5. Data model changes

Every migration in this Part ships its RLS policies in the same file, is
applied via MCP, saved under `supabase/migrations/`, followed by a types
regeneration into `lib/database.types.ts`, and verified with the sequence in
CLAUDE.md. The access matrix is written as a comment at the top of each
file. Column comments are updated where the meaning changes.

### 5.1 Provider columns and renames on the league tables

The renames are done in TWO steps so nothing is ever broken between
deploys: step one adds the new column as a generated alias, step two flips
the code, step three drops the old name. Postgres cannot make a generated
column that is also the base of a unique index the app upserts on, so the
mechanism is: rename the column, then create a VIEW-free compatibility
shim by adding the OLD name back as a generated column
(`sleeper_league_id text generated always as (case when provider = 'sleeper'
then provider_league_id end) stored`) for the transition, and drop the
generated column in the cleanup migration once `lib/providers/league-import-guard.test.ts`'s
allow-list is empty. `onConflict` targets in the code move to the new
column name in the same deploy as the rename.

`leagues`:
- add `provider text not null default 'sleeper' references league_providers(slug)`.
- rename `sleeper_league_id` to `provider_league_id`.
- drop `leagues_sleeper_league_id_key`; add `unique (provider, provider_league_id)`
  as `leagues_provider_league_key`.
- drop `idx_leagues_sleeper_league_id` (redundant with the unique index, as
  it was before). Recreate `leagues_capture_state_idx` on
  `(provider, provider_league_id, capture_completed_at, status, season)`.
- add `visibility text not null default 'public' check (visibility in ('public','members'))`.
- add `capabilities_observed jsonb not null default '{}'::jsonb` (the probe
  results, Part 4.3).
- add `previous_provider_league_id text`, `next_provider_league_id text`
  (Sleeper's `previous_league_id` is copied here from metadata by the
  Sleeper provider so the two providers read alike; Manager Pulse discovery
  keeps NOT following it, per `lib/manager-pulse/discover.ts:18-23`).
- add `season_start_week integer not null default 1`, `season_end_week
  integer` (Yahoo `start_week`/`end_week`; Sleeper derives from
  `settings.playoff_week_start` and 17 or 18).
- add `scoring_translation jsonb` (Part 7.4.2: the stat_id to key map that
  was applied, with any Yahoo stat ids that had no key, so a reader can be
  told what the translation could not express).
- add `provider_synced_at timestamptz` (the fetch time the retention purge
  keys on; `last_pulsed_at` keeps its cache-TTL meaning).
- `metadata` stays the verbatim provider object.

`rosters`: rename `sleeper_roster_id` to `provider_roster_id`; rename
`owner_user_id` to `owner_provider_user_id` and `co_owners` keeps its name
with a comment that it holds provider user ids; add `team_name text`,
`team_logo_url text` (Yahoo `name` and `team_logos`; Sleeper keeps reading
`league_users.team_name`, and the sync copies it here so both providers
read alike). Unique becomes `(league_id, provider_roster_id)`. `player_ids`,
`starter_ids`, `reserve_ids`, `taxi_ids` keep holding PROVIDER player ids;
the comment says so and says which provider's via `leagues.provider`.

`league_users`: rename `sleeper_user_id` to `provider_user_id`; unique
`(league_id, provider_user_id)`; index renamed. `avatar` becomes
`avatar_url text` holding an absolute URL (Sleeper's is built by
`sleeperAvatarUrl` at sync time; Yahoo's `image_url` is stored as given
after host validation, Part 12). `components/sleeper-avatar.tsx` becomes
`components/providers/member-avatar.tsx` and takes a URL.

`league_transactions`: rename `sleeper_transaction_id` to
`provider_transaction_id`; rename `created_at_sleeper` to `occurred_at`;
add `faab_bid integer`; `week` becomes nullable already (it is); add
`week_source text check (week_source in ('provider','derived'))` so a
week derived from a timestamp (Yahoo, Part 7.4.5) is never mistaken for one
the provider stated. Unique `(league_id, provider_transaction_id)`. Index
`idx_league_transactions_league_created` becomes `(league_id, occurred_at desc)`.
The RPC `find_player_trade_transactions(p_sleeper_id text, p_limit int)`
(migration 0143) is replaced by `find_player_trade_transactions(p_player_id
uuid, p_limit int)` which joins through `provider_players` (Part 5.4); the
old signature is dropped in the cleanup migration after
`lib/player-trades.ts` moves.

`league_matchups`: rename `sleeper_roster_id` to `provider_roster_id`;
unique `(league_id, week, provider_roster_id)`; add `is_playoff boolean`.
`starter_ids` stays positional with "0" placeholders for BOTH providers
(Part 7.4.6 builds Yahoo's positional array).

`league_drafts`: rename `sleeper_draft_id` to `provider_draft_id`; unique
`(league_id, provider_draft_id)` replaces the global unique on the id,
because a synthesised Yahoo draft id is the league key plus a suffix and is
unique only within the league.

`draft_selections`: rename `sleeper_draft_id` to `provider_draft_id`,
`sleeper_player_id` to `provider_player_id`, `sleeper_league_id` to
`provider_league_id`; add `provider text not null default 'sleeper'`;
`draft_selections_unique_pick` becomes `(provider, provider_draft_id, pick_no)`.
`player_id uuid` stays and is now REQUIRED to be filled by the sync via
Part 6 (nullable column, but a null is a review-queue entry, never silent).

`would_you_rather_trades`: rename `sleeper_transaction_id` to
`provider_transaction_id`; `side_a_roster_id` and `side_b_roster_id`
comments say provider roster ids. Add `provider text not null default
'sleeper'` (denormalised from the league for the serving index, so the
Discord router and the admin panel can filter without a join).

`league_activity`: `roster_ids` and `player_ids` arrays hold provider ids;
comment only. `dedupe_key` already includes the league uuid.

`player_weekly_projections`, `player_market_snapshots`,
`player_market_latest`, `player_roster_exposure`, `draft_pick_observations`,
`on_the_clock_*`: NOT renamed in this plan. They belong to Sleeper the
SOURCE (projections, market, ADP) or to On The Clock, which is a Sleeper-
only tool in this plan (Part 11.6). `player_roster_exposure` is rebuilt by
`lib/player-exposure.ts` from `rosters`; it gains a `provider` dimension
only if the exposure panel is asked to show Yahoo (Part 11.10 says it is
not, in this build).

`nfl_teams`: add `aliases text[] not null default '{}'` and seed Yahoo's
codes there (Part 7.4.8) instead of a new table.

Migration: `0279_league_providers_registry.sql` (Part 4.2 table, seed
rows, RLS: `league_providers_select_public` for anon and authenticated,
`league_providers_service_role_all`), then
`0280_league_tables_provider_columns.sql` (every add and rename above, the
generated compatibility columns, the recreated indexes, the comments, the
unique constraints; RLS on these tables is REPLACED in 0283 so this file
only re-creates the existing public policies under the same names so the
verification sequence passes between the two), then
`0281_league_sync_jobs_provider.sql` (Part 5.6), then
`0282_would_you_rather_provider.sql`.

### 5.2 Visibility and RLS

Today `leagues_select_public` is `using (true)` for anon and authenticated,
and every child table matches. That stays true for Sleeper, whose API is
public. A Yahoo private league was read under one member's token, and the
docs say only members may read it, so the row must not be world-readable.

`0283_league_visibility_rls.sql`:

```sql
create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leagues l
    join public.league_users lu on lu.league_id = l.id
    join public.provider_connections pc
      on pc.provider = l.provider
     and pc.provider_user_id = lu.provider_user_id
     and pc.status = 'active'
    where l.id = p_league_id
      and pc.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_league_member(uuid) from public, anon, authenticated;
grant execute on function public.is_league_member(uuid) to authenticated, anon, service_role;

create or replace function public.can_read_league(p_league_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leagues l
    where l.id = p_league_id
      and (l.visibility = 'public' or public.is_league_member(l.id))
  );
$$;
```

Then for each of `leagues`, `rosters`, `league_users`,
`league_transactions`, `league_matchups`, `league_drafts`,
`draft_selections` (via its `provider_league_id` join to `leagues`),
`league_activity`, `league_power_pulse_cache`,
`league_positional_war_cache`, `league_manager_ledger_cache`,
`league_power_rankings_cache`: drop `{table}_select_public`, create
`{table}_select_visible` for anon and authenticated with
`using (public.can_read_league(league_id))` (on `leagues` itself,
`using (visibility = 'public' or public.is_league_member(id))`).
`{table}_service_role_all` is unchanged. Grants on the two functions name
all three roles per the SECURITY DEFINER memory rule. The `(select
auth.uid())` form is the initplan pattern from migration 0274.

Performance: `can_read_league` is one indexed lookup on `leagues.id` for
public rows and short-circuits before the member join. Add
`idx_league_users_league_provider_user (league_id, provider_user_id)` (the
unique index already covers it) and
`idx_provider_connections_lookup (provider, provider_user_id) where status = 'active'`.
Every existing query on these tables already filters by `league_id`, so
the policy predicate is satisfied from the same index. Verification: run
`explain (analyze)` on the league overview's roster read as `anon` and as
an authenticated member before and after, and record both in the migration
comment; the budget is no more than one extra index lookup per query.

`would_you_rather_trades` keeps its existing policy shape (it is served by
service role through the vote route, and its board carries no names), but
the pool builder (Part 11.2) only admits Yahoo trades when the registry's
`wyr_include_members_only_leagues` setting is on. `signal_check_analyses`
is unchanged (its `sleeper_context` column is renamed `provider_context`
and stays out of `public_payload`).

Sleeper rows are written with `visibility = 'public'` and are unaffected.
A Yahoo league whose `league_type` is `public` is also `public`.

### 5.3 Connections and Vault

`0284_provider_connections.sql`:

```sql
create table public.provider_connections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  provider              text not null references league_providers(slug),
  provider_user_id      text not null,               -- Yahoo guid / OIDC sub
  provider_handle       text,                        -- Yahoo nickname (display only)
  provider_avatar_url   text,
  scopes                text[] not null default '{}',
  access_secret_id      uuid,                        -- vault.secrets.id
  refresh_secret_id     uuid,                        -- vault.secrets.id
  access_expires_at     timestamptz,
  status                text not null default 'active'
                          check (status in ('active','reconnect_required','revoked')),
  status_detail         text,
  refresh_lock_until    timestamptz,                 -- Part 7.2 serialisation
  last_used_at          timestamptz,
  last_refreshed_at     timestamptz,
  connected_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  metadata              jsonb not null default '{}'::jsonb,  -- userinfo claims, raw
  unique (user_id, provider),
  unique (provider, provider_user_id)
);
```

- Tokens are stored in Supabase Vault (`supabase_vault` 0.3.1 is installed
  on the project; verified via the extensions list). `vault.create_secret(
  secret, name, description)` returns the id stored in `access_secret_id`
  and `refresh_secret_id`; reads go through `vault.decrypted_secrets` under
  service role only; rotation is `vault.update_secret(id, new_secret)`.
  Vault is chosen over the Beacon Link plan's env-key AES-GCM because the
  key never lives in Vercel's environment, and because it is already
  installed. The Beacon Link plan's `sleeper_connections` should adopt
  this table when it is built (its `token_ciphertext` column becomes a
  Vault id and its `platform` is `'sleeper'`).
- `unique (provider, provider_user_id)`: one Yahoo account links to one
  FF Beacon account. Linking a Yahoo account already linked elsewhere fails
  with a message saying so (Part 10.4), because two FF Beacon accounts
  reading one Yahoo account would double-count the reader's own leagues in
  every per-user budget.
- RLS: `revoke all on provider_connections from anon, authenticated`;
  `provider_connections_service_role_all`. An owner-readable view
  `provider_connection_status (id, provider, provider_user_id,
  provider_handle, provider_avatar_url, status, status_detail,
  connected_at, last_used_at)` with `security_invoker = true` and a policy
  `using (user_id = (select auth.uid()))` on the base table for SELECT of
  those columns only is NOT possible in Postgres (column-level RLS does not
  exist), so the view is `security_definer` with `where user_id = (select
  auth.uid())` baked in, granted to authenticated only. This is the Beacon
  Link plan's shape (docs/beacon-link/beacon-link-plan.md Part 3.2), kept.
- `metadata` holds the OpenID userinfo claims verbatim. The email claim is
  NOT copied to any other table (Part 12).

All writes go through `lib/providers/connections.ts` (server-only):
`upsertConnection`, `loadConnectionForUser(userId, provider)`,
`loadSystemConnection(provider)`, `markReconnectRequired(id, detail)`,
`revokeConnection(id)` (calls Yahoo's revoke endpoint, then deletes the
Vault secrets, then sets `status = 'revoked'`, in that order so a failed
revoke leaves a row that still says active and can be retried).
`lib/providers/connections-guard.test.ts` fails on any other read of
`provider_connections` or `vault.` outside that module and its tests.

### 5.4 Player identity tables

`0285_provider_players.sql`:

```sql
create table public.provider_players (
  provider            text not null references league_providers(slug),
  provider_player_id  text not null,
  player_id           uuid references players(id) on delete set null,
  match_method        text not null
                        check (match_method in (
                          'provider_external_id',  -- Sleeper: its own id
                          'sleeper_yahoo_id',      -- players.metadata.sleeper.yahoo_id
                          'dynastyprocess_csv',
                          'name_position_team',
                          'team_defense_code',
                          'admin',
                          'unmatched')),
  match_confidence    numeric(4,3) not null default 1.000
                        check (match_confidence between 0 and 1),
  full_name           text not null,
  position            text not null,
  team_abbr           text,                          -- normalised to nfl_teams.abbreviation
  status              text,
  is_active           boolean not null default true, -- still in the provider's universe
  superseded_by       text,                          -- another provider_player_id, Part 6.6
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  matched_at          timestamptz,
  metadata            jsonb not null default '{}'::jsonb,  -- the provider's raw player object
  primary key (provider, provider_player_id)
);
create unique index provider_players_one_per_player
  on public.provider_players (provider, player_id)
  where player_id is not null and superseded_by is null;
create index provider_players_unmatched_idx
  on public.provider_players (provider, last_seen_at desc)
  where player_id is null;
create index provider_players_by_player_idx
  on public.provider_players (player_id) where player_id is not null;
```

- The partial unique `provider_players_one_per_player` is the "100% clean"
  guarantee the owner asked for: one active provider id per (provider,
  player). A second Yahoo id for the same human (Yahoo has issued duplicate
  legacy ids; UNVERIFIED how often) is recorded with `superseded_by`
  pointing at the surviving id and stays out of the unique index, so the
  history is kept and the join is unambiguous.
- `players.external_ids` is NOT extended with a `yahoo` key. It keeps
  holding the SOURCE ids it holds today (sleeper, ktc, fantasypros,
  fantasycalc). Sleeper's id is written to BOTH `external_ids->>'sleeper'`
  and `provider_players` by `lib/sync-sleeper-players.ts` inside one RPC
  `upsert_sleeper_player_identity(p_player_id uuid, p_sleeper_id text)`
  so they cannot drift, and `scripts/check-provider-player-consistency.ts`
  (run by the nightly `recalculate-derived` cron as a read-only check that
  logs and alerts, never repairs) counts any disagreement. The 14 callers
  of `resolveSleeperPlayers` are untouched.
- `provider_player_review` is the queue for unmatched and low-confidence
  rows:

```sql
create table public.provider_player_review (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null,
  provider_player_id  text not null,
  candidates          jsonb not null default '[]'::jsonb,  -- [{player_id, score, reasons[]}]
  reason              text not null,                       -- 'no_candidate' | 'ambiguous' | 'low_confidence' | 'position_conflict'
  status              text not null default 'open'
                        check (status in ('open','resolved','ignored')),
  resolved_player_id  uuid references players(id),
  resolved_by         uuid references auth.users(id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (provider, provider_player_id),
  foreign key (provider, provider_player_id) references provider_players(provider, provider_player_id) on delete cascade
);
```

  RLS on both: service_role ALL; NO anon or authenticated SELECT on the
  review table (candidate names are ours, but the queue is an admin
  surface); `provider_players_select_public` for anon and authenticated on
  `provider_players` restricted by a policy `using (player_id is not null)`
  so the public can resolve a provider id to a player but never sees the
  unmatched backlog. Admin writes through server actions that re-check
  `is_admin`.

- `provider_stat_map`:

```sql
create table public.provider_stat_map (
  provider        text not null references league_providers(slug),
  season          integer not null,
  stat_id         text not null,           -- Yahoo numeric id as text
  provider_name   text not null,           -- Yahoo display_name
  scoring_key     text,                    -- Sleeper-keyed canonical key, null = no equivalent
  position_type   text,                    -- O, K, DT, D
  is_display_only boolean not null default false,
  note            text,
  metadata        jsonb not null default '{}'::jsonb,
  primary key (provider, season, stat_id)
);
```

  Seeded per season by `scripts/sync-yahoo-stat-categories.ts` from
  `/game/{game_id}/stat_categories` under the system connection, with the
  `scoring_key` column filled from the code table in Part 7.4.2 and left
  null for anything the code table does not know. A null `scoring_key` on a
  stat a league actually scores is recorded on `leagues.scoring_translation`
  and surfaced in the league's "how this was calculated" disclosure. Public
  SELECT, service role writes.

- `nfl_teams.aliases` (in 0280): Yahoo's `editorial_team_abbr` values that
  differ from ours. The seed list is in Part 7.4.8 and is marked UNVERIFIED
  until the spike records the real strings.

### 5.5 Retention posture

`league_providers.retention_policy` is the switch.

- `indefinite` (Sleeper today; Yahoo if Yahoo confirms league data is
  storable): nothing changes.
- `rolling_24h` (Yahoo's default until confirmed): a purge is part of the
  nightly `recalculate-derived` cron and ALSO of an hourly
  `/api/cron/provider-retention` route, because 24 hours is measured from
  the fetch, not from midnight. The purge deletes, for every league whose
  provider is on `rolling_24h` and whose `provider_synced_at` is older than
  24 hours: `rosters`, `league_users`, `league_transactions`,
  `league_matchups`, `league_drafts`, `draft_selections`, `league_activity`
  rows for that league, the three model caches and the power-rankings
  cache, the `would_you_rather_trades` rows for it (votes are kept, the
  trade row is retired to `status = 'retired'` rather than deleted, because
  the vote tally is OUR data), and finally sets `leagues.pulse_status =
  'pending'`, `capture_completed_at = null`, keeps `name`, `season`,
  `provider_league_id`, `visibility`, `format_config_id` and the derived
  `scoring_settings`/`roster_positions` (a league's RULES are not user
  data; UNVERIFIED reading of the clause, stated in the application notes
  for Yahoo to correct), and clears `metadata` to `{}`.
- Under `rolling_24h`, a member opening a league deep view re-syncs it
  under their own connection, so the reader always sees a live league at
  the cost of a sync per day per league, bounded by the 60-minute
  `pulseLeagueCore` TTL. Manager Ledger and Manager Pulse, which need a
  season of settled weeks, re-capture the season on each visit (about 18
  scoreboard reads plus 18 roster reads per team, Part 7.3 budgets it) and
  the page says in words that Yahoo history is fetched fresh because Yahoo's
  terms do not let us keep it. `capabilities.historyRetained` is derived
  from the policy and read by those two surfaces for that sentence.
- The provider-wide tables `provider_players` and `provider_stat_map` are
  NOT user data (a player id is Yahoo's public editorial id) and are kept
  under either policy; `provider_connections.metadata` (userinfo claims) is
  kept because it is the reader's own account data held with their
  consent, and it is deleted on disconnect.

Guard: `lib/providers/retention.test.ts` asserts the purge touches exactly
the table list above and nothing keyed on a Sleeper league, by running it
against a fixture with one league per provider.

### 5.6 The queue and Manager Pulse tables

`0281_league_sync_jobs_provider.sql`: add `provider text not null default
'sleeper'` and `connection_id uuid references provider_connections(id) on
delete set null` to `league_sync_jobs`; rename `sleeper_league_id` to
`provider_league_id`; rename `sleeper_calls` to `provider_calls`;
`league_sync_jobs_active_unique` becomes `(user_id, provider,
provider_league_id) where status in ('pending','processing')`;
`league_sync_jobs_league_active_idx` becomes `(provider,
provider_league_id, created_at)`. `league_sync_attempts.sleeper_league_id`
to `provider_league_id` plus `provider`. `manager_pulse_run_leagues`:
`provider`, `provider_league_id`, unique `(run_id, provider,
provider_league_id, season)`. `manager_pulse_runs`: `provider`,
`provider_user_id`, `provider_handle`; `manager_pulse_cache`,
`manager_pulse_tendencies`, `manager_pulse_live_reports`: `provider` added
to every key that has `sleeper_user_id` in it, renamed `provider_user_id`.
The RPCs `enqueue_bulk_league_sync`, `enqueue_manager_pulse_capture`,
`try_claim_manager_pulse`, `claim_league_sync_jobs` gain `p_provider` and
read `provider_league_id`. `league_sync_tick` is unchanged.

The worker (`lib/league-bulk-sync.ts`) dispatches on `job.provider`: a
Sleeper job runs exactly as today; a Yahoo job loads the connection named
by `connection_id`, and if the connection is not `active` the job fails
with `last_error = 'reconnect_required'` and is not retried (the reader is
shown a reconnect card, Part 10.4). The budget becomes one bucket per
provider (`lib/providers/budget.ts`, Part 7.3), and
`manager_pulse_settings.sync` gains `yahooCallsPerMinute`.

### 5.7 Identity keys on `user_preferences`

`sleeper_league_settings` keeps its name and shape in this plan (renaming
a column the owner can PATCH, that eleven files parse, that
`guard.test.ts` protects, buys nothing here). It continues to describe the
Sleeper public handle. A Yahoo identity is a `provider_connections` row,
never a jsonb key. The three list keys (`featured_league_id`,
`shown_league_ids`, `signal_league_ids`) hold Sleeper league ids today;
they become LEAGUE REF strings (Part 9.1's `sleeper:123` / `yahoo:461.l.5`
form, with a bare numeric string still read as Sleeper for every row
already saved), and `parseSleeperLeagueSettings` learns the ref grammar.
The rename of the column to `league_settings` is listed as a follow-up in
Part 17, not in this build.

### 5.8 Migration list

| Number | File | What | RLS in file |
| --- | --- | --- | --- |
| 0279 | `league_providers_registry.sql` | registry table, two seed rows, `nfl_teams.aliases` | public select, service all |
| 0280 | `league_tables_provider_columns.sql` | adds and renames on leagues, rosters, league_users, league_transactions, league_matchups, league_drafts, draft_selections; generated compat columns; indexes; comments | re-creates existing public policies under the same names |
| 0281 | `league_sync_jobs_provider.sql` | queue, attempts, manager pulse tables and RPCs | unchanged service-role policies restated |
| 0282 | `would_you_rather_provider.sql` | `provider` column, `provider_transaction_id` rename, serving index | unchanged |
| 0283 | `league_visibility_rls.sql` | `is_league_member`, `can_read_league`, `{table}_select_visible` on 12 tables | the whole point |
| 0284 | `provider_connections.sql` | connections table, status view, Vault usage comment | service all, owner view |
| 0285 | `provider_players.sql` | identity, review, stat map tables, `upsert_sleeper_player_identity` RPC, Sleeper backfill from `external_ids` | as stated in 5.4 |
| 0286 | `find_player_trade_transactions_v2.sql` | uuid-keyed RPC, old one kept | grants restated |
| 0287 | `signal_guide_provider_copy.sql` | rewrite the two seeded guide strings that name Sleeper (0078:100,112 and 0167:34) | unchanged |
| 0288 | `provider_cleanup.sql` | drop generated compat columns, old RPC signature, old index names; ONLY after the import guard's allow-list is empty | none |

Verification for 0283 includes reading the league overview as anon, as a
non-member authenticated user, and as a member with an active Yahoo
connection, against a fixture Yahoo league inserted under service role
with `visibility = 'members'`, and confirming zero rows, zero rows, and the
full row set respectively.

---

## Part 6. Player identity resolution

The goal the owner stated: every provider id is always recoverable, the FF
Beacon uuid is the only key the models use, and there are no holes. This
Part is the pipeline and its edge cases.

### 6.1 Sources of truth, in precedence order

1. A previous decision: an existing `provider_players` row with
   `match_method` in (`admin`, `provider_external_id`) is never overwritten
   by an automatic pass.
2. Sleeper's cross-reference: `players.metadata.sleeper.yahoo_id`.
   Deterministic, one-to-one where present (a unique check is run: if two
   `players` rows carry the same Sleeper yahoo_id, both go to review with
   reason `ambiguous`).
3. DynastyProcess `db_playerids.csv`: `yahoo_id` to `sleeper_id`, then
   `sleeper_id` to `players` via `external_ids->>'sleeper'`. Fetched by
   `scripts/sync-playerid-crossref.ts` weekly (the file is rebuilt weekly)
   into `player_id_crossref (source, season, row jsonb)` under the raw-
   object rule, and read by the resolver. Also carries `gsis_id`, which
   Sleeper supplies too, giving a second deterministic path
   (`yahoo_id -> gsis_id -> players.metadata.sleeper.gsis_id`).
4. Team defense by code: a Yahoo player with `position_type = 'DT'` (or
   `display_position = 'DEF'`) maps to the Sleeper DEF whose
   `external_ids->>'sleeper'` equals the normalised team abbreviation.
5. Name, position and team: `search_name` (the existing normalised column
   on `players`) equality on Yahoo's `ascii_first + ascii_last`, with
   position agreement (after Yahoo-to-Sleeper position normalisation) AND
   team agreement (after alias normalisation). Confidence 0.9. Name and
   position agreement with a team mismatch where the Sleeper row's
   `metadata.sleeper.team_changed_at` is within 45 days: confidence 0.7,
   review. Name only, or any case with two candidates: review, reason
   `ambiguous`. Suffixes (Jr., III) are stripped on both sides before
   comparing, and `search_last_name` is used as the blocking key so the
   comparison is not a table scan.
6. Nothing matched: `provider_players` row with `player_id = null`,
   `match_method = 'unmatched'`, and a review entry with reason
   `no_candidate`. The row exists so rosters can still name the player
   (`full_name` and `position` are on the row) instead of showing an id.

The resolver is `lib/providers/players/resolve-identity.ts
resolveProviderPlayer(input: ProviderPlayer, ctx): IdentityDecision`, pure,
with the candidate fetches done by the caller and passed in, so the unit
tests are fixtures, not a database. Decisions are `{ playerId, method,
confidence } | { review: reason, candidates }`.

### 6.2 When it runs

- The universe sync `scripts/sync-yahoo-players.ts` (cron
  `/api/cron/sync-provider-players?provider=yahoo`, `30 6 * * *`, which is
  06:30 UTC because Vercel cron expressions are UTC; `sync-sleeper-players`
  is `0 6 * * *` in `vercel.json`, so this runs 30 minutes after it and
  Sleeper's cross-reference is fresh first): pages `/game/{game_id}/players;start=N;count=25` under the
  system connection for positions QB, RB, WR, TE, K, DEF, and additionally
  DL, LB, DB when any synced league has an IDP slot (`leagues.roster_positions`
  contains one of the IDP tokens). About 70 requests for the offensive
  pool; the IDP pages are skipped until needed. Upserts `provider_players`
  (`last_seen_at`, `status`, `team_abbr`, `metadata`), runs the resolver on
  new or changed rows only.
- Inline during a league sync: any provider player id on a roster, a
  matchup, a transaction or a draft pick that has no `provider_players`
  row is inserted from the payload's own name and position (a Yahoo roster
  carries `name`, `display_position`, `editorial_team_abbr`) and resolved
  at once, so a page never waits on the nightly job. The inline path never
  fetches the player resource separately; it uses what the roster payload
  already carries.
- The Sleeper nightly sync gains one step: before inserting a NEW
  `players` row, it looks for a `provider_players` row where `provider =
  'yahoo'` and `metadata->>'yahoo_id'`-style keys match the incoming
  Sleeper object's `yahoo_id`, `gsis_id` or `sportradar_id`, and if that
  Yahoo row already created a `players` row (Part 6.4), the Sleeper sync
  ATTACHES its id to that row instead of creating a second human. The slug
  is assigned once and never recomputed, exactly as today.

### 6.3 Reading provider ids back

`lib/providers/players/lookup.ts resolveProviderPlayers(supabase,
provider, ids, options)` returns the same `PlayerLookup` shape
`resolveSleeperPlayers` returns today. For `provider = 'sleeper'` it
DELEGATES to `resolveSleeperPlayers` unchanged (the two-pass lookup with
its measured 0.3 ms index path stays). For `provider = 'yahoo'` it is one
`in()` on `provider_players (provider, provider_player_id)` joined to
`players`, chunked at 200. It carries `throwOnError` for the same caller
`resolveSleeperPlayers` carries it for (`lib/league-power-rankings.ts`,
which must not cache a roster valued as if half of it did not exist).

Every read path that today calls `resolveSleeperPlayers` with roster or
matchup ids switches to `resolveProviderPlayers(league.provider, ...)`.
The 14 call sites are listed in Part 15 phase 3. Reads that resolve
projection or market rows (`player_weekly_projections.sleeper_player_id`)
keep calling `resolveSleeperPlayers` because those are SOURCE ids.

### 6.4 A player Yahoo has that we do not

Create a `players` row: `slug` from `slugifyPlayer` with the Yahoo id as
the trailing digits (the existing slug grammar is `name-<digits>`; the
`sleeper_slug_tail` generated column will then hold the YAHOO id for that
row, which is wrong by name, so the column is renamed `slug_tail` in 0280
with its index, and `resolveSleeperPlayers`' second pass is narrowed to
rows where `external_ids ? 'sleeper'` so a Yahoo-tailed slug can never
answer a Sleeper lookup), `external_ids = '{}'`, `metadata = {"yahoo":
{...}}`, `source_synced_at = {"yahoo": now}`, `status` from Yahoo's status,
`position` normalised. `internal_attributes` empty. Rankings, values and
projections for such a row are simply absent, which every surface already
tolerates for an unranked player.

### 6.5 A player we have that Yahoo does not

Nothing to do. `provider_players` has no row; a roster cannot reference
them because Yahoo's roster payload only names Yahoo players.

### 6.6 Yahoo changes or duplicates an id

- A retired or renamed player: Yahoo's numeric id is season-independent
  (Part 2.3); a name change on Yahoo's side arrives as the same id with a
  new `name`, and the row updates in place. The `players` row's name is
  owned by the Sleeper sync where a Sleeper id exists, and by the Yahoo sync
  otherwise.
- Two Yahoo ids resolve to one `players` row: the second insert violates
  `provider_players_one_per_player`. The resolver catches the unique
  violation, writes the second row with `superseded_by = <first id>`, and
  opens a review entry with reason `ambiguous` so an admin can decide which
  id is live. Rosters carrying the superseded id still resolve, because
  `resolveProviderPlayers` follows `superseded_by` one hop.
- One Yahoo id for two humans (a Yahoo data error): cannot be represented,
  and should not be; the review queue is where an admin sees it, and the
  row points at whichever human Yahoo's current payload names.

### 6.7 Team defenses

Sleeper's DEF ids are team codes (`PIT`), Yahoo's are ordinary numeric
player ids with `position_type = 'DT'` and an `editorial_team_abbr`. Match
by team code through `nfl_teams.aliases`. A franchise move or rename
(Oakland to Las Vegas, Washington's rename) is handled by the alias list,
which is seeded from every code Sleeper has ever used in `player_stats`
(the `opponent` column back to 2020) plus Yahoo's, and a Yahoo DEF whose
code is not in the aliases goes to review rather than to a guess.

### 6.8 Positions

Yahoo `display_position` can be compound (`WR,RB`); `primary_position` is
single. Normalise: `primary_position` first; `DEF` and `DT` to `DEF`; `D`
position type with `DL`, `LB`, `DB` kept; anything else (`OL`, `P`, `LS`)
kept as-is with no `PULSE_SLOT_ELIGIBILITY` entry, so it is unprojectable
and renders as such. Position disagreement between Yahoo and Sleeper (a
Taysom Hill case) is NOT a review reason on its own when every other
signal agrees; the `players.position` stays Sleeper's, and
`provider_players.position` records Yahoo's.

### 6.9 The review surface

`/admin/providers/players`: the open queue ordered by how many synced
rosters reference the id (a player on twelve rosters outranks one on
none), each row showing Yahoo's name, position, team, the candidate
`players` rows with their scores and reasons, a search box over
`players.search_name`, and three actions: Match (writes `match_method =
'admin'`, confidence 1, resolves the entry), Create new player (Part 6.4),
Ignore (for a non-player row such as a coach, sets `status = 'ignored'`
and `is_active = false`). Every action re-checks `is_admin` server-side.
Accessible as every admin table: a real `<table>`, row headers, the action
buttons named with the player, a live region announcing the outcome.

### 6.10 Consistency and coverage checks

`scripts/check-provider-player-consistency.ts`, run nightly, reports: the
count of `provider_players` rows per provider by `match_method`; the count
of unmatched ids referenced by at least one roster in a synced league
(this is the number that matters and it is shown on `/admin/system/league-health`);
any `players` row whose `external_ids->>'sleeper'` disagrees with its
`provider_players` Sleeper row; any `provider_players_one_per_player`
near-miss (two rows on one player where one is superseded). None of these
repair anything. The target before Yahoo is flipped active: every player
on a ranked board (`rankings`) has a Yahoo row, and unmatched-and-rostered
is zero across the spike leagues.

---

## Part 7. The Yahoo provider

Directory `lib/providers/yahoo/`. Every file is server-only except
`constants.ts`. Nothing here is imported outside `lib/providers/` (Part
4.6). Until the Yahoo application is approved, every module is built and
tested against recorded fixtures in `lib/providers/yahoo/fixtures/`
(Part 14.3), and the spike task LP-T060 replaces the fixtures with real
responses on the first day of access.

### 7.1 OAuth flow

Env vars (added to `.env.local.example` with empty values; never read
outside `lib/providers/yahoo/oauth.ts` and, for the app name only,
`lib/providers/yahoo/client.ts`): `YAHOO_CLIENT_ID`,
`YAHOO_CLIENT_SECRET`, `YAHOO_APP_NAME` (the registered application
name, sent as the User-Agent so Yahoo's usage monitoring can attribute
requests; Appendix B.6), `YAHOO_REDIRECT_URI` (must match the registered
one byte for byte; production `https://ffbeacon.com/api/providers/yahoo/callback`,
and for local work `https://localhost:3000/api/providers/yahoo/callback`
because Yahoo refuses plain http localhost, so the OAuth flow is exercised
locally under a second script, `"dev:https": "next dev --experimental-https"`,
added to `package.json` beside the existing `"dev": "next dev"`, which is
left as it is. Next.js 15 supports the flag and mints a local certificate
on first run.)

Routes:

- `GET /api/providers/yahoo/connect`: requires a signed-in Supabase user
  (redirects to `/login?next=/my-beacon/connections` otherwise). Mints a
  `state` of 32 random bytes, stores `{ state, userId, next, pkceVerifier,
  createdAt }` in a `provider_oauth_states` row (a small service-role table
  in 0284 with a 10-minute expiry and a nightly prune, rather than a
  cookie, because the callback must bind the state to the user id the
  server issued it for, and a cookie could be replayed into another
  session). Redirects to
  `https://api.login.yahoo.com/oauth2/request_auth?client_id=...&redirect_uri=...&response_type=code&scope=openid%20fspt-r&state=...&code_challenge=...&code_challenge_method=S256&language=en-us`.
  PKCE is sent because it is harmless if ignored and protective if
  honoured (Part 2.2). `openid` is requested so the token response carries
  an `id_token` with a stable `sub`; `email` and `profile` are NOT
  requested (we have no use for the reader's Yahoo email, and asking for
  less is what the consent screen shows).
- `GET /api/providers/yahoo/callback?code=...&state=...`: loads and
  deletes the state row (one use), rejects if expired or if the current
  session's user id differs from the stored one, exchanges the code at
  `get_token` with `Authorization: Basic` (Part 2.2), verifies the
  `id_token` signature against `https://api.login.yahoo.com/openid/v1/certs`
  (cached 24 hours) and its `iss`, `aud`, `exp` and `nonce`, then calls
  `users;use_login=1` once to learn the fantasy `guid` (the id every
  manager object carries, which is what `is_league_member` joins on) and
  stores the connection (Part 5.3) with `provider_user_id = guid`,
  `metadata = { sub, guid, nickname }`. On `unique (provider,
  provider_user_id)` violation: revoke the just-issued tokens at Yahoo,
  store nothing, and redirect to `/my-beacon/connections?error=already-linked`.
  On success redirect to `next` (validated as a same-origin path, the same
  check `app/auth/callback/route.ts` applies) or `/my-beacon/connections`.
- `POST /api/providers/yahoo/disconnect`: signed-in user, CSRF-protected
  server action rather than a bare route (`app/actions/provider-connections.ts
  disconnectProvider('yahoo')`), calls `revokeConnection` (Part 5.3), and
  under `rolling_24h` also purges that reader's private Yahoo leagues where
  no other active connection is a member.
- Rate limits: `connect` and `callback` claim from `try_claim_rate_limit`
  bucket `provider_oauth` at 10 per hour per user, and `callback` also 30
  per hour per IP hash (the existing `SIGNAL_SCOUT_IP_SALT` hashing
  helper), so a redirect loop cannot burn Yahoo's goodwill.

The consent button: `components/providers/yahoo/connect-button.tsx`
renders Yahoo's official button art (Part 2.1, Sign in with Yahoo
guidelines) at equal prominence with the existing Google and Discord
buttons wherever it appears, with the visible text "Continue with Yahoo"
and `aria-label="Continue with Yahoo to connect your Yahoo Fantasy
leagues"`. The image asset is downloaded from Yahoo's kit and committed
under `public/brand/yahoo/`; it is never restyled.

### 7.2 Token lifecycle

`lib/providers/yahoo/oauth.ts`:

- `exchangeCode(code, verifier)`, `refreshAccessToken(connection)`,
  `revokeTokens(connection)`. All three are the only callers of
  `api.login.yahoo.com`.
- `withAccessToken(connectionId, fn)`: the one entry every Yahoo API call
  uses. It loads the connection, and if `access_expires_at` is within 120
  seconds it refreshes FIRST. Refreshes are serialised per connection with
  a database lock: `update provider_connections set refresh_lock_until =
  now() + interval '30 seconds' where id = $1 and (refresh_lock_until is
  null or refresh_lock_until < now()) returning id`; a caller that does not
  win the lock waits (poll at 250 ms, up to 10 s) and re-reads the row,
  which by then holds the new token. This is what stops two workers from
  both refreshing and orphaning one rotated refresh token (Part 2.2).
- On a refresh response: `vault.update_secret` for both tokens (Yahoo may
  or may not rotate the refresh token; the newest one is always stored),
  `access_expires_at = now() + expires_in - 60s`, `last_refreshed_at`.
- On `invalid_grant` or any 400 from `get_token`: `status =
  'reconnect_required'`, `status_detail` = the Yahoo `error_description`
  string with any token material stripped, and `ProviderFailure
  reconnect_required` returned to the caller. Nothing retries a dead
  refresh token; the reader reconnects (Part 10.4).
- A 401 from the fantasy API whose body contains `token_expired`: refresh
  once and retry once. Any other 401: `reconnect_required`.
- Disconnect and account deletion: `provider_connections` cascades on
  `auth.users` delete, and a trigger `provider_connections_delete_secrets`
  (security definer, in 0284) deletes the two Vault secrets when a row is
  deleted, so a deleted account leaves no token behind. The Yahoo-side
  revoke is best-effort at disconnect time.

### 7.3 HTTP client, budget, errors, JSON

`lib/providers/yahoo/client.ts`:

- `yahooGet<T>(actor, path, opts)`: builds
  `https://fantasysports.yahooapis.com/fantasy/v2/{path}?format=json`,
  resolves the actor to a connection (`connection` or the registry's
  `system` connection; `anonymous` returns `not_connected` immediately
  because Yahoo has no anonymous read), wraps the call in
  `withAccessToken`, acquires a token from the Yahoo budget bucket, sends
  `User-Agent: ${YAHOO_APP_NAME} (https://ffbeacon.com)` on every request
  (Appendix B.6), applies a 20-second timeout and the existing `readCapped`
  size guard
  (`MAX_RESPONSE_BYTES` is reused from `lib/sleeper.ts`, moved to
  `lib/http/size-guard.ts` with its test), and classifies the response.
- Budget: `lib/providers/budget.ts` generalises `lib/sleeper-budget.ts`
  into `getProviderBudget(provider)` returning a `TokenBucket` per provider;
  the Sleeper bucket keeps its 600 default and its
  `manager_pulse_settings.sync.sleeperCallsPerMinute` wiring, Yahoo starts
  at 60 per minute (`yahooCallsPerMinute`, admin-editable) because Yahoo
  publishes no number and the community reports app-wide blocks. The
  `AsyncLocalStorage` job context, `countCalls`, `pause` and the
  interactive deadline all carry over unchanged; `acquireSleeperToken`
  becomes `acquireProviderToken('sleeper')` with a re-export under the old
  name until the allow-list is empty.
- Error taxonomy, in the order the classifier checks: network error or
  timeout: `unavailable`; HTTP 999 or any non-JSON body (the "Request
  denied" case): `throttled` with `retryAfterMs` 5 minutes and
  `pauseProviderBudget('yahoo', 5 min)`; 429 with Retry-After: `throttled`
  with that value; 401 with `token_expired`: refresh path; other 401:
  `reconnect_required`; 403 with "not authorized to perform this action"
  or a body containing `additional_authorization_required` (Part 2.1,
  2026-09-09 addendum): `not_authorized` (the approved-but-403 state,
  which pauses the budget for 15 minutes and flips a registry health flag
  read by the admin panel and the connect page banner); 403 otherwise:
  `not_member`; 404:
  `not_found`; 5xx: `unavailable`; 200 with `fantasy_content`: parse.
- JSON normalisation: `lib/providers/yahoo/json.ts` turns Yahoo's
  numeric-keyed collections into arrays and merges the `[0]`/`[1]` split
  (metadata array of single-key objects plus the sub-resource object) into
  one plain object per resource, converting numeric strings on a known
  allow-list of fields (`team_id`, `player_id`, `week`, `count`, points,
  `value`, `stat_id`) and leaving everything else as strings. It is pure
  and fixture-tested against every response shape in Part 14.3. The raw
  parsed JSON, not the normalised form, is what goes into `metadata`.
- Request budget per league sync (used by the freshness and queue
  estimates): league with `out=settings,standings,teams` 1; teams with
  rosters 1 per team (12); scoreboard 1 per week needed; roster per week
  per team for a full-season capture 18 x 12 = 216; transactions 1 per 25;
  draftresults 1. A first-time full-season capture of a 12-team league is
  therefore about 260 calls, which at 60 per minute is under five minutes,
  and is the number the Manager Pulse estimate uses for Yahoo.

### 7.4 Entity mapping

Each mapping is a pure function in `lib/providers/yahoo/map-*.ts` from
the normalised JSON to the Part 4.5 shape, fixture-tested.

#### 7.4.1 League

`map-league.ts`. `providerLeagueId = league_key` (the full
`{game_id}.l.{league_id}`, because the game id is the season and a Yahoo
league renews into a NEW key each season, exactly as a Sleeper league gets
a new id each season). `name`, `season` (from `season`), `status`:
`draft_status = 'predraft'` to `pre_draft`; `is_finished = 1` to
`complete`; `draft_status = 'postdraft'` and not finished to `in_season`;
anything else `drafting` (UNVERIFIED in-draft value, recorded by the spike).
`totalRosters = num_teams`. `logoUrl = logo_url` after host validation
(Part 12). `previousProviderLeagueId` from `renew` and
`nextProviderLeagueId` from `renewed`, converted from Yahoo's
`{game_id}_{league_id}` form to a league key (UNVERIFIED format; the spike
records it and the converter has a test per observed form).
`visibility`: `league_type = 'public'` to `public`, else `members`.
`seasonStartWeek = start_week`, `seasonEndWeek = end_week`,
`currentWeek = current_week`, `playoffWeekStart =
settings.playoff_start_week` when `uses_playoff`, `lastScoredWeek` =
the highest week whose scoreboard status is `postevent` (filled by the
matchup sync, not the league read).

#### 7.4.2 Scoring settings to Sleeper keys

`scoring-map.ts` and `provider_stat_map` (Part 5.4). The code table below
is the initial `scoring_key` column. It targets keys that exist in our
live scoring vocabulary (all 474 leagues carry the first 41 keys listed in
`yahoo-plan-notes.md`; the bonus keys are present on 60 to 180 leagues).
Yahoo stat ids marked VERIFIED are from the docs sample (Part 2.3); every
other row is UNVERIFIED until the spike reads `stat_categories` and is
left with `scoring_key = null` in the seed so it can never mis-score
silently.

| Yahoo stat_id | Yahoo name | Sleeper key | Note |
| --- | --- | --- | --- |
| 4 | Passing Yards | pass_yd | VERIFIED |
| 5 | Passing Touchdowns | pass_td | VERIFIED |
| 6 | Interceptions | pass_int | VERIFIED |
| 9 | Rushing Yards | rush_yd | VERIFIED |
| 10 | Rushing Touchdowns | rush_td | VERIFIED |
| 11 | Receptions | rec | VERIFIED |
| 12 | Receiving Yards | rec_yd | VERIFIED |
| 13 | Receiving Touchdowns | rec_td | VERIFIED |
| 15 | Return Touchdowns | kr_td AND pr_td | VERIFIED id; Sleeper splits kick and punt, so one Yahoo value is written to both keys |
| 16 | 2-Point Conversions | pass_2pt AND rush_2pt AND rec_2pt | VERIFIED id; one Yahoo value written to all three |
| 18 | Fumbles Lost | fum_lost | VERIFIED |
| 57 | Offensive Fumble Return TD | fum_rec_td | VERIFIED id; nearest Sleeper key, noted in scoring_translation |
| 19 | FG 0-19 Yards | fgm_0_19 | VERIFIED |
| 20 | FG 20-29 Yards | fgm_20_29 | VERIFIED |
| 21 | FG 30-39 Yards | fgm_30_39 | VERIFIED |
| 22 | FG 40-49 Yards | fgm_40_49 | VERIFIED |
| 23 | FG 50+ Yards | fgm_50p | VERIFIED |
| 29 | Point After Attempt Made | xpm | VERIFIED |
| 32 | Sack (team) | sack | VERIFIED |
| 33 | Interception (team) | int | VERIFIED |
| 34 | Fumble Recovery (team) | fum_rec | VERIFIED |
| 35 | Touchdown (team) | def_td | VERIFIED |
| 36 | Safety | safe | VERIFIED |
| 37 | Block Kick | blk_kick | VERIFIED |
| 49 | Kickoff and Punt Return TD (team) | def_st_td | VERIFIED id; Sleeper's combined special-teams key |
| 50 | Points Allowed 0 | pts_allow_0 | VERIFIED |
| 51 | Points Allowed 1-6 | pts_allow_1_6 | VERIFIED |
| 52 | Points Allowed 7-13 | pts_allow_7_13 | VERIFIED |
| 53 | Points Allowed 14-20 | pts_allow_14_20 | VERIFIED |
| 54 | Points Allowed 21-27 | pts_allow_21_27 | VERIFIED |
| 55 | Points Allowed 28-34 | pts_allow_28_34 | VERIFIED |
| 56 | Points Allowed 35+ | pts_allow_35p | VERIFIED |
| ? | Field Goal Missed (any bucket) | fgmiss or fgmiss_0_19 ... | UNVERIFIED id |
| ? | PAT Missed | xpmiss | UNVERIFIED id |
| ? | Passing Attempts / Completions / Incompletions | pass_att / pass_cmp / pass_inc | UNVERIFIED ids |
| ? | Rushing Attempts (8 is display-only) | rush_att | id 8 VERIFIED as display-only; scoring use UNVERIFIED |
| ? | Targets (78 display-only) | none | display only |
| ? | 40+ Yard Completions / TDs / Rushes / Receptions | pass_cmp_40p, pass_td_40p, rush_40p, rush_td_40p, rec_40p, rec_td_40p | UNVERIFIED ids |
| ? | Pick Sixes Thrown | pass_int_td | UNVERIFIED id |
| ? | Fumble (not lost) | fum | UNVERIFIED id |
| ? | Return Yards (offense) | kr_yd AND pr_yd | UNVERIFIED id |
| ? | Times Sacked | pass_sack | UNVERIFIED id |
| ? | Defensive Yards Allowed buckets | yds_allow_0_100 ... yds_allow_550p | UNVERIFIED ids; bucket edges must match Sleeper's or the row is null |
| ? | Tackles for Loss, 3 and Outs, 4th Down Stops, Blocked kicks returned | tkl_loss, def_3_and_out, def_4_and_stop | UNVERIFIED ids |
| ? | IDP: Solo Tackles, Assisted, Sacks, Int, FF, FR, PD, TD, Safety, Block | idp_tkl_solo, idp_tkl_ast, idp_sack, idp_int, idp_ff, idp_fum_rec, idp_pass_def, idp_def_td, idp_safe, idp_blk_kick | UNVERIFIED ids |

Rules of the translation:

- `scoringSettings[key] = Number(stat_modifiers.value)` for each mapped
  stat; a stat with `is_only_display_stat = 1` is skipped; an unmapped stat
  with a non-zero modifier is recorded in
  `leagues.scoring_translation.unmapped[]` with its Yahoo name and value,
  and the league's "how this was calculated" disclosure lists them in
  words ("Yahoo also scores Tackles for Loss, which our projections do not
  model"). `isUsableScoring` (`lib/league-scoring.ts:85`) then decides
  usability exactly as it does for Sleeper.
- TE premium: Yahoo expresses it as a per-position modifier on Receptions
  (`stat_position_types` on the stat, UNVERIFIED shape). When the
  reception modifier for TE exceeds the modifier for the other positions,
  `bonus_rec_te = difference` is emitted, which is the key
  `deriveLeagueFormat` and `tePremiumPerReception` already read.
- Bonuses (`Stat.bonuses`, e.g. 100-yard rushing bonus): mapped to
  `bonus_rush_yd_100` and siblings when the threshold matches Sleeper's
  (100, 200, 300, 400); any other threshold goes to `unmapped`.
- `uses_fractional_points = 0`: Yahoo rounds; our dot product does not.
  Recorded on `scoring_translation.rounding = 'whole'` and the disclosure
  says totals may differ by rounding. `uses_negative_points = 0`: Yahoo
  floors a player at zero; recorded the same way. Neither changes the
  model; both are stated.
- The raw `settings` object is in `leagues.metadata.settings`.

#### 7.4.3 Roster positions to Sleeper tokens

`slot-map.ts`. Yahoo `roster_positions[]` entries `{ position, count,
position_type }` expand to a flat token list in Yahoo's own order, `count`
times each:

| Yahoo position | Sleeper token | Note |
| --- | --- | --- |
| QB, RB, WR, TE, K | same | |
| DEF | DEF | position_type DT |
| W/R | WRRB_FLEX | |
| W/T | REC_FLEX | Yahoo label UNVERIFIED |
| W/R/T | FLEX | VERIFIED label |
| Q/W/R/T | SUPER_FLEX | community-attested label, UNVERIFIED |
| D, DL, LB, DB | DL, LB, DB (D to IDP_FLEX) | UNVERIFIED labels |
| BN | BN | |
| IR, IR+ | IR | |
| NA | NA | |

Any token not in the table is passed through UNCHANGED (so
`alignedStartingSlots` keeps it and `slotGroupOf` files it under IDP, the
existing behaviour for exotic Sleeper tokens) and recorded on
`leagues.scoring_translation.unknownSlots[]`. `lib/providers/yahoo/slot-map.test.ts`
asserts every emitted token is known to Part 3.7's maps.

#### 7.4.4 Teams to rosters and managers to members

`map-roster.ts`, `map-member.ts`. One `team` becomes one `ProviderRoster`
with `providerRosterId = team_id`, record and points from
`team_standings`, `waiverPosition = waiver_priority`,
`waiverBudgetRemaining = faab_balance` (null when `uses_faab = 0`),
`teamName = name`, `teamLogoUrl = team_logos[0].url` after host
validation. Players come from `team/{key}/roster` (current week):
`playerIds` every player; `reserveIds` those with
`selected_position.position = 'IR'`; `taxiIds` always `[]`; `starterIds`
built positionally (Part 7.4.6). The first manager with `is_commissioner
= 1` is the commissioner; `ownerProviderUserId` is the manager with the
lowest `manager_id` where `is_comanager` is not 1, and the rest are
`coOwnerProviderUserIds`. Each manager becomes a `ProviderMember` with
`providerUserId = guid`, `displayName = nickname`, `avatarUrl =
image_url`, `handle = null`. `email` is never read. A team with no
manager (an orphaned team) has `ownerProviderUserId = null`, which
`rosters.owner_provider_user_id` already allows.

#### 7.4.5 Transactions

`map-transaction.ts`. `providerTransactionId = transaction_key`. Type:
`trade` to `trade`; `add`, `drop`, `add/drop` with `source_type =
'waivers'` on any player to `waiver`, otherwise `free_agent`; `commish` to
`commissioner`. Status: `successful` and `approved` to `complete`;
`pending` to `pending`; `rejected` (and `vetoed` if it exists) to `failed`.
`occurredAt` from `timestamp` (seconds versus milliseconds decided by
magnitude, the same check `lib/datetime.ts` style helpers make elsewhere,
and recorded by the spike). `adds`/`drops`: for each player, by
`transaction_data.type` and `destination_team_key`/`source_team_key` to a
team id. `faabBid` from `faab_bid`. `draftPicks` from `picks[]` with
`season = null` unless the payload carries one (probe `tradedPickSeason`).
`rosterIds` = the distinct team ids involved.

WEEK: Yahoo transactions carry no week. `week = null`,
`week_source = 'derived'` when the sync can place the timestamp inside a
`ProviderWeek` from the game_weeks calendar (Part 7.5), else `week = null`
and `week_source = null`. The Manager Ledger's waiver ledger, which
credits a claim "from the week of the claim", reads `week` and treats a
null as "from the next week whose start is after `occurred_at`"; that rule
already exists for the derived case and is stated on the page. The
transactions feed's week filter is offered only when
`capabilities.transactionWeek` or a derived week is present for the league
(it will be, for any league with a calendar).

#### 7.4.6 Scoreboard to matchups, and the positional starters array

`map-matchup.ts`. For each week in the window, `league/{key}/scoreboard;week=N`
gives pairings and team totals; `team/{key}/roster;week=N` (one call per
team per week; on the current week this is the same call as 7.4.4) gives
each player's `selected_position` and `player_points.total` for that week.
One `ProviderMatchup` per team per week: `matchupId` = the index of the
pairing in the scoreboard for that week (stable within a week, which is
all `league_matchups.matchup_id` needs), `points = team_points.total`,
`isFinal = status == 'postevent'`, `isPlayoff = is_playoffs == 1`,
`playerIds` every rostered player that week, `playerPoints` from each
player's `player_points.total` (Yahoo's OWN scoring, which is what the
Manager Ledger grades against, exactly as Sleeper's `players_points` is
Sleeper's own scoring), and the POSITIONAL `starterIds` and
`starterPoints`.

The positional array: walk the league's `rosterPositions` tokens in order;
for each starting token, take the next roster player whose
`selected_position.position` maps to that token (players are consumed in
`player_id` order for determinism); a slot with no player gets `"0"` and
`starterPoints` gets `0`. Because Yahoo's roster is positional by FIELD,
this array is a faithful reconstruction and satisfies the contract
`lib/league-matchups.ts` and every reader already hold (Part 3.2). The
reconstruction is fixture-tested with a roster whose flex holds a RB and a
roster with an empty IR.

A week whose scoreboard call fails is a `failedWeeks` entry and Power
Pulse's "a failed request is not evidence" rule applies unchanged.

#### 7.4.7 Draft results

`map-draft.ts`. One synthesised `ProviderDraft` per league:
`providerDraftId = league_key + ".draft"`, `type` from `draft_type` and
`is_auction_draft`, `status` from `draft_status`, `startedAt = draft_time`
when present, `slotToProviderRosterId` from each team's `draft_position`
(`{ "1": team_id, ... }`), `rounds` = max round in draftresults.
`draftresults[]` to `ProviderDraftPick`: `pickNo = pick`, `round`,
`draftSlot = ((pick - 1) % num_teams) + 1` for a snake or linear draft
(null for auction), `providerRosterId` from `team_key`,
`pickedByProviderUserId` = that team's owner, `providerPlayerId` from
`player_key`'s numeric tail, `isKeeper` from the player's `is_keeper` on
the league players collection (one extra `players;status=K` read per
league, which returns exactly the keepers), `cost` from `cost`. A league
whose draft has not happened yields zero picks and `draft_status =
'pre_draft'`, which `league_drafts` already represents.

#### 7.4.8 Players

`map-player.ts`. `providerPlayerId = player_id` (numeric tail), names
from `name`, `position` per Part 6.8, `teamAbbr` normalised through
`nfl_teams.aliases`, `status`, `jerseyNumber = uniform_number`,
`headshotUrl = headshot.url` after host validation, `externalIds = {}`
(Yahoo publishes none). The seed alias list for `nfl_teams.aliases`,
UNVERIFIED as to Yahoo's exact casing and recorded by the spike: Yahoo is
believed to use mixed case ("Jax", "Was", "Ari", "Atl", "Bal", "Buf",
"Car", "Chi", "Cin", "Cle", "Dal", "Den", "Det", "GB", "Hou", "Ind", "KC",
"LV", "LAC", "LAR", "Mia", "Min", "NE", "NO", "NYG", "NYJ", "Phi", "Pit",
"SF", "Sea", "TB", "Ten") where Sleeper uses upper case; the normaliser
upper-cases first and then consults the alias list, so only genuinely
different codes need a row.

### 7.5 Season, game id and the week clock

`lib/providers/yahoo/games.ts`: `resolveGameId(actor, season)` reads
`games;game_codes=nfl;seasons={season}` once, caches it in
`provider_seasons (provider, season, provider_season_id, weeks jsonb,
fetched_at)` (in 0284), and falls back to the static table of Part 2.3
for seasons before 2026 if the read fails. `getWeekCalendar` reads
`game/{game_id}/game_weeks` into `weeks`. The site's clock stays
`getNflState()` (Part 3.1); the Yahoo calendar is used only to derive
transaction weeks (7.4.5) and to bound the matchup window.

### 7.6 Format derivation for a Yahoo league

Yahoo has no dynasty type and no best-ball flag. `LeagueShape` for Yahoo:
`keeperStyle = 'keeper'` when the league has any player with `is_keeper =
1` or when `renew` is present AND the settings carry a keeper deadline
(UNVERIFIED field; spike), else `'redraft'`; never `'dynasty'` from data
alone. `isBestBall = false`. `deriveLeagueFormat` therefore prices every
Yahoo league off a redraft board, which is right for what Yahoo leagues
overwhelmingly are, and `deriveKeeperStyle` says Keeper where it can.

Because a long-running Yahoo keeper league can be a dynasty league in
everything but name, `leagues` gains an OWNER OVERRIDE: `league_format_override
jsonb` (`{ keeperStyle: 'dynasty' }`) settable by a commissioner or admin
from the league overview (Part 10.7), read by the Yahoo provider's
`LeagueShape` builder before the data rule. `capabilities.dynastyType =
false` is what makes the override control appear; on Sleeper it never
does. The override is the only user-written input to format derivation
anywhere in the product and it is validated to that one key.

### 7.7 Probes at sync time

After the first successful capture the provider writes
`leagues.capabilities_observed`:

- `futureSchedule`: true when the scoreboard for `current_week + 2`
  returned pairings with `status = 'preevent'`, false otherwise. Re-probed
  on every full sync (the answer may change at playoff time, per spilchen).
- `tradedPickSeason`: true when any `picks[]` entry in the captured
  transactions carried a season field; left absent when no trade with picks
  has been seen.

### 7.8 What each model does when a capability is missing

- Power Pulse with `futureSchedule = false`: the engine gains a
  `scheduleMode: 'known' | 'unknown_beyond_week'` input. In the unknown
  mode, every remaining week beyond the last known pairing is simulated as
  an all-play against the league average (each team's weekly distribution
  against the mean of the others'), the playoff bracket is simulated from
  the standings with `num_playoff_teams` and `playoff_start_week` (which
  Yahoo does publish), and the page states, above the table, that the
  remaining opponents are not yet published by Yahoo so the odds assume an
  average schedule. `lib/power-pulse/engine.ts` stays pure; the mode is a
  parameter, and `lib/power-pulse/simulate.test.ts` gains a case where the
  two modes agree on a league whose schedule is fully known.
- Positional WAR: unaffected (it reads no schedule and no roster).
- Manager Ledger: unaffected in principle (settled weeks, actual points,
  the same optimiser). Two Yahoo specifics: the IR list is the current
  roster's, exactly as for Sleeper; and `taxiIds` is always empty.
- Lineups: renders every panel; the free-agent panel reads
  `lib/faab/free-agents.ts`, which needs a "who is unowned" answer, and
  for Yahoo that is `league/{key}/players;status=FA` under the reader's
  connection (a capability `freeAgentList`, true for both, but Yahoo's is
  paged at 25 and limited to the top 100 by `sort=OR`).
- Trade Ideas and Signal Check: value side unchanged; the win side uses
  Power Pulse's mode. `tradedPickAssetsOnRoster = false` means the trade
  builder offers no future picks for a Yahoo league and says why in the
  asset picker's empty state.
- Schedules: the week view renders known weeks; unknown future weeks
  render the empty state with the capability sentence instead of "Sleeper
  has no games on file".
- Manager Pulse: only the connected reader's own history
  (`publicLookupByHandle = false`); Part 11.4.
- On The Clock: Sleeper only in this build (`liveDraft = false`); Part 11.6.
- Beacon Link: `writeLineup = false`; the Yahoo connect page says so in
  one sentence.

---

## Part 8. The Sleeper provider

`lib/providers/sleeper/` wraps the existing functions without changing a
line of their behaviour:

- `provider.ts` implements `LeagueProvider` by calling the `lib/sleeper.ts`
  league functions and converting their null-versus-empty returns to
  `ProviderResult`: `null` from `getSleeperLeague` becomes `not_found`;
  `null` from `getSleeperMatchups` becomes `unavailable`; a thrown
  `getAllSleeperTransactions` becomes `unavailable` with the week in
  `detail`; `[]` stays `{ ok: true, value: [] }`.
- `map-*.ts` convert `SleeperLeague`, `SleeperRoster`, `SleeperLeagueUser`,
  `SleeperTransaction`, `SleeperDraft`, `SleeperDraftPick`,
  `SleeperMatchup`, `SleeperTradedPick` to the Part 4.5 shapes. These are
  the existing inline conversions in `lib/league-pulse.ts` (`upsertRosters`
  `:1196`, `upsertLeagueUsers` `:1275`, `upsertTransactions` `:1330`,
  `upsertLeagueDrafts` `:1420`) lifted into pure functions with the same
  tests. `LeagueShape` for Sleeper is `settings.type`, `settings.best_ball`,
  `scoring_settings` as-is, `roster_positions` as-is, which is exactly what
  `deriveLeagueFormat` and `categorizeLeague` read today, so those two
  functions change their parameter type from `SleeperLeague` to
  `LeagueShape` and nothing else.
- `resolveHandle` wraps `getSleeperUser`; `listLeagues` wraps
  `getSleeperLeaguesOrNull` for the OrNull semantics; `listPlayers` wraps
  `getSleeperPlayers`.
- `avatarUrl` is built with `sleeperAvatarUrl` at map time, so
  `league_users.avatar_url` holds a URL for both providers.

`lib/league-pulse.ts` becomes provider-neutral: `pulseLeagueCore(supabase,
ref: ProviderLeagueRef, opts)` looks up the provider, calls the interface,
and upserts the Part 4.5 shapes. The write ORDER, the `last_pulsed_at`
stamp AFTER child rows, the 60-minute TTL, the coalescing, the capture set
door and every guard test are unchanged; `lib/league-capture-set.test.ts`
keeps passing because the three stage functions are still called only from
`captureLeagueRawData`. `pulseLeague(supabase, sleeperLeagueId)` keeps its
signature as a thin wrapper `pulseLeague(supabase, { provider: 'sleeper',
providerLeagueId })` for the scripts and the refresh endpoint until they
move.

The Sleeper handle flows (`lib/sleeper-handle/*`,
`app/actions/sleeper-handle.ts`, the gate states, the identity card) are
unchanged in behaviour and keep their names. They gain a sibling for
OAuth providers (Part 10.3), and the two are composed by one
`components/providers/provider-gate.tsx` that asks the registry which
`auth_kind` the provider has.

---

## Part 9. Routing and URLs

### 9.1 The league ref grammar

`lib/providers/refs.ts` (LEAF module, client-safe):

```ts
export function parseLeagueRefSegment(segment: string): ProviderLeagueRef | null
export function leagueRefSegment(ref: ProviderLeagueRef): string
```

- A bare `^\d{1,32}$` segment is `{ provider: 'sleeper', providerLeagueId }`.
  Every existing URL, OG path, share link and the three permanent
  redirects keep working forever, unchanged.
- `^([a-z][a-z0-9_]{1,31})-(.+)$` where the prefix is a registered
  provider slug other than `sleeper` is `{ provider, providerLeagueId }`.
  A Yahoo league is `/leagues/yahoo-461.l.12345` and its team page
  `/leagues/yahoo-461.l.12345/teams/3`. Dots and digits are valid path
  characters and Yahoo's key contains no hyphen, so the split is
  unambiguous; the parser splits on the FIRST hyphen only.
- `sleeper-123` is accepted and canonicalised to `/leagues/123` with a
  308, so nobody ever publishes two URLs for one Sleeper league.
- Anything else is `null` and the page returns `notFound()`.

The same grammar is used for the three list keys in
`user_preferences.sleeper_league_settings` (Part 5.7), for the `?league=`
parameters on the FAAB, Signal Check and Beacon Breakdown tools, for
`league_sync_jobs` enqueue payloads, and for the Would You Rather admin
filters. `lib/providers/refs.test.ts` covers every branch including the
canonicalisation and a Yahoo key with an unexpected extra segment.

### 9.2 Pages

`app/leagues/[league_id]/**` (ten pages), the three OG routes under
`/api/og/{league,team,matchup,war}/`, and the three API routes under
`/api/leagues/[league_id]/` replace `.eq("sleeper_league_id", league_id)`
with `parseLeagueRefSegment` plus `.eq("provider", ref.provider).eq("provider_league_id",
ref.providerLeagueId)`, through one helper
`lib/league-lookup.ts loadLeagueByRef(supabase, ref)` wrapped in
`react.cache`. `[roster_id]` stays the provider roster id (Yahoo's
`team_id` is a small integer exactly like Sleeper's). The trade OG route's
`[transaction_id]` becomes the `league_transactions.id` uuid for NEW
links, with the Sleeper transaction id still accepted (`^\d+$`) for links
already shared.

A Yahoo league page visited by a reader who cannot read it (RLS returns
no row) renders the same `notFound()` as a bad id, and never a "this
league is private" page, because confirming a league's existence to a
non-member is itself a leak. A signed-in reader with NO Yahoo connection
who follows a Yahoo league link gets the connect card (Part 10.4) instead,
because the page cannot know whether they are a member until they connect.

### 9.3 Sync on view

For a Sleeper league the deep view calls `pulseLeagueCore` as today. For a
Yahoo league it passes `{ kind: 'connection', connectionId }` for the
viewing reader, and if the reader has no active connection it renders
without syncing (cached rows only, under RLS). Under `rolling_24h` a
league older than 24 hours has no cached rows, so the page shows the
connect card and, once connected, syncs.

`/api/leagues/[league_id]/warm` (hover warm-up) passes the same actor and
is a no-op for a Yahoo league when the reader is not connected.

### 9.4 The tools' entry points

`/tools/league-pulse`, `/tools/faab`, `/tools/who-should-i-start`,
`/tools/trade-calculator` (import panel) and `/dashboard` list leagues from
EVERY active provider the reader can reach: Sleeper via the saved handle
or `?username=`, Yahoo via the connection. The lists are grouped as today
by `categorizeLeague` and each row shows its provider mark
(`components/providers/provider-mark.tsx`, a small monochrome wordmark
with `alt="Yahoo"` or `alt="Sleeper"`, plus the same word in the row's
visible text so the mark is never the only signal). The `league-logo`
column renders Yahoo's `logo_url` through the same `components/league-logo.tsx`.

---

## Part 10. Surfaces and copy

### 10.1 Provider copy

`lib/providers/copy.ts` (leaf, client-safe) exports `providerCopy(slug)`
returning the strings every surface needs, so a provider is named in one
place:

```ts
type ProviderCopy = {
  name: "Sleeper" | "Yahoo Fantasy";
  short: "Sleeper" | "Yahoo";
  possessive: "Sleeper's" | "Yahoo's";
  handleNoun: "Sleeper username" | null;        // null: no public handle
  connectVerb: "Save your Sleeper username" | "Connect your Yahoo account";
  identitySentence: (name: string) => string;   // "Sleeper shows you as X." / "Yahoo shows you as X."
  syncError: string;                            // "Something went wrong while syncing from Sleeper." etc.
  noGamesOnFile: (season: string) => string;
  attribution: { sentence: string; logo: string; poweredBy: string; href: string } | null;
};
```

The 15 surfaces in Part 3.6's inventory (identity card, save-handle form
and notice, League Pulse form, Manager Pulse search form, On The Clock
username gate, Signal Check import panel, `/my-beacon/sleeper-leagues`,
`league-sync-all`, `schedule-empty`, `league-load-error`,
`pre-draft-notice`, the avatar components, the legal pages, the two
database-seeded guide strings) switch to `providerCopy`. The legal pages
(`/privacy`, `/terms`) gain a Yahoo paragraph (Part 16 item 9) and are on
the copy guard's allow-list because they name both providers on purpose.

Writing rule for every new string: plain sentences, no em-dashes, no
puffery, straight quotes, the provider's short name where a reader would
say it. The attribution sentence is Yahoo's exact wording and is not
paraphrased.

### 10.2 The capability notice

`components/providers/capability-notice.tsx`: a `<p>` (not a card) with
the provider's short name and one sentence per capability, from a fixed
table in `lib/providers/capability-copy.ts`:

- `futureSchedule`: "Yahoo has not published the remaining schedule yet,
  so these odds assume an average slate from here."
- `perPlayerProjections`: "Yahoo publishes no player projections. These
  are FF Beacon's, scored under this league's rules."
- `tradedPickAssetsOnRoster`: "Yahoo does not list future draft picks on
  a roster, so picks are not offered here."
- `taxiSquad`: never shown (an absent taxi section needs no sentence).
- `publicLookupByHandle`: "Yahoo leagues can only be read by their own
  members, so this report covers your leagues only."
- `historyRetained` (false under `rolling_24h`): "Yahoo's terms do not
  let us keep league history, so this was fetched fresh just now."
- `writeLineup`: "Yahoo's API is read-only, so lineup changes are made on
  Yahoo."

Rendered inside the panel it explains, before the panel's content, with
no icon and no `aria-live` (it is static page content). The guard in Part
4.6 checks it is wired.

### 10.3 The identity card and the connect card

`components/providers/provider-gate.tsx` composes the two identity
patterns:

- `auth_kind = 'public_handle'`: the existing `SleeperHandleGate`,
  unchanged.
- `auth_kind = 'oauth2'`: `components/providers/connection-card.tsx`,
  which mirrors the identity card's shape ("Yahoo shows you as {nickname}.
  Change" becomes "Connected to Yahoo as {nickname}. Disconnect"), and
  `components/providers/connect-card.tsx` for a reader with no connection
  (heading "Connect your Yahoo account", one sentence, the official
  button, and the notice sentence "Connecting lets FF Beacon read the
  leagues you belong to. We never post anything to Yahoo, and you can
  disconnect at any time from My Beacon."). The connect card is rendered
  where the save-handle notice is rendered today, under the Sleeper form,
  so a reader sees both routes to their leagues on one screen.
- `member-overridden` has no Yahoo equivalent (no `?username=` for a
  provider with no public handle). A `?league=yahoo-...` parameter is the
  Yahoo shareable form, and the card says "Showing a league from this
  link" exactly as the Sleeper card does for a URL handle.

Keyboard and screen reader: the connect button is a real `<a>` to the
connect route (a navigation, not a form), named as in 7.1; the disconnect
control is a `<button>` inside a `<form>` posting the server action, with
a confirm dialog via `components/slide-up-dialog.tsx` with
`desktopPlacement="center"` because it is a decision, not a detail view.

### 10.4 Connection states

`provider_connections.status` drives four states on every surface that
uses the connection:

- `active`: normal.
- `reconnect_required`: the connection card shows "Yahoo needs you to
  connect again. This happens after a password change or when Yahoo
  revokes access." with the connect button; every Yahoo league row in a
  list shows "Reconnect to refresh" in place of its sync status; a queued
  job for it fails fast (Part 5.6).
- `revoked` (the reader disconnected): the card is the connect card again.
- Registry health `not_authorized` (the approved-but-403 state, Part 7.3):
  a banner on the connect card and on every Yahoo league page, "Yahoo is
  not accepting requests from FF Beacon right now. We keep trying; nothing
  is wrong with your account.", and the admin panel shows the last 403
  time and body.

### 10.5 `/my-beacon/connections`

The existing `/my-beacon/sleeper-leagues` page becomes
`/my-beacon/connections` with a permanent 308 from the old path (added to
`next.config.ts` beside the others, kept forever). It shows one section
per active provider: the Sleeper section is the existing page body; the
Yahoo section is the connection card or connect card, then the reader's
Yahoo leagues for the season in the same table shape, with the same logo
column and "Open league" links. `signal_guide` row `sleeper-leagues`
(migration 0078:112) is rewritten in 0287 to point at the new path with
copy "Your connected league accounts."

### 10.6 Attribution footer

`components/providers/attribution.tsx` renders, on EVERY page that shows
Yahoo-derived data (the ten league pages for a Yahoo league, the tool
panels showing a Yahoo league, the Would You Rather reveal for a Yahoo
trade, the Manager Pulse report when any Yahoo season is included, the OG
images for a Yahoo league), the sentence "Fantasy data provided by Yahoo
Fantasy" as visible text linking to the league's own Yahoo `url` when we
have one and to `https://www.yahoo.com/?ilc=401` otherwise, beside the
Yahoo Fantasy SVG (`alt=""`, decorative because the sentence carries the
meaning) and the "powered by Yahoo" white mark on our dark ground linking
to the `ilc=401` address. It sits directly under the page's main content,
above the site footer, in body text size, never in a `<footer>` landmark
of its own (the site footer is the landmark). On the OG images it is
rendered as text in the existing footer band beside "ffbeacon.com". The
component reads `league_providers.attribution`; Sleeper's is `{}` and
renders nothing.

### 10.7 The league overview additions

- Provider mark and name in the masthead under the league name ("On
  Yahoo Fantasy" / "On Sleeper"), as visible text.
- The format override control (Part 7.6) for a Yahoo league, visible to a
  commissioner or admin: a `<details>` disclosure "This league is a keeper
  league on Yahoo. If it is played as dynasty, say so and we will price it
  that way." with a single radio group (Keeper, Dynasty) and a Save
  button; the change re-runs `resolveLeagueContext` and is logged to
  `league_activity` as a `format_override` event so the audit trail shows
  who changed the pricing.
- Rankings table, Teams tab, Transactions tab: unchanged; they read FF
  Beacon ids.

### 10.8 Empty and error states, per provider

Every string that today says "Sleeper" in an empty state goes through
`providerCopy`. Three states are new for Yahoo:

- No connection: the connect card (10.3).
- Not a member (RLS returned nothing for a signed-in connected reader):
  `notFound()` (Part 9.2).
- History purged under `rolling_24h` and the reader is connected: the
  loading boundary shows "Fetching this league from Yahoo" and the sync
  runs; the capability notice for `historyRetained` sits on the Decisions
  and Manager Pulse pages.

### 10.9 Admin

`/admin/providers`: the registry table with `is_active`,
`retention_policy`, `system_connection_user_id` (a picker over users
that have an active connection for that provider), the capability
overrides as a checklist that can only turn declared capabilities OFF
(Part 4.3), the health block (last 403, last 999, calls in the last hour
from the budget counter), and a "Post a test read" button that fetches
`users;use_login=1/games` under the system connection and shows the
classification. `/admin/providers/players` is Part 6.9.
`/admin/system/league-health` gains a provider column and the
unmatched-and-rostered count. All behind `is_admin`, server-checked.

### 10.10 The public capabilities page: `/providers`

The owner asked for a viewable list of what each provider supports. It is
a PUBLIC page rather than an admin one, for two reasons: a reader deciding
whether to connect Yahoo should know what they will and will not get
before they press the button, and the support question "why does my Yahoo
league not show playoff odds" should have a link as its answer.

Route `app/providers/page.tsx`, a server component with `revalidate =
3600`, title "What works with each league platform". Linked from the
tools index, the connect card ("See what works with Yahoo"), every
capability notice (a "Why?" link at the end of the sentence), and the
About page. Added to `lib/nav-tree.ts` under the About branch (the About
entry is the object at `lib/nav-tree.ts:195`).

Content, in order:

1. One paragraph: leagues come from a platform; FF Beacon reads them and
   never writes to them; platforms differ in what they publish, and this
   page says exactly how.
2. One section per active provider, in registry order: the mark and the
   name, how you connect (from `auth_kind`, in words: "type your Sleeper
   username" or "sign in with Yahoo and allow read access"), the
   attribution line for providers that require one, and a link to the
   connect page or the tool.
3. The matrix of Part 4.9, one real `<table>` per group with a
   `<caption>` naming the group, a `<th scope="row">` on the feature name,
   one column per active provider, and cells that say a WORD: "Yes", "No",
   "Depends on the league" (a probe), "Not in this build" (a write key).
   Never a tick or a cross alone; a glyph may sit beside the word with
   `aria-hidden="true"`. Where the cell is "No" or a probe, it also carries
   the capability sentence from `lib/providers/capability-copy.ts`, so the
   page and the notice on the feature itself can never disagree.
4. A "Depends on the league" section explaining the probes: what is
   probed, when, and that the answer is shown on the league's own page.
5. A last-checked line: the registry row's `updated_at` through
   `formatEastern`.

It renders from `listActiveProviders`, `CAPABILITY_MATRIX` and
`capabilityCopy`. It has no state, no client component and no
provider-specific code, so a third provider appears as a third column
with no change to the page, and a capability turned off in admin (Part
4.3) reads "No" here within the hour.

Mobile: each table scrolls inside its own container, the feature column
is sticky, and nothing is hidden by breakpoint. Screen reader: each
caption names the group and each column header names the provider, so a
cell is announced as "Yahoo, Playoff bracket, No, Yahoo publishes playoff
flags on weeks but no bracket." The admin page (10.9) links here rather
than duplicating the matrix, and adds only the override checklist and the
health block.

---

## Part 11. Every feature, and what changes

The rule for this Part: a feature that reads FF Beacon ids from the league
tables gets Yahoo for free once the sync lands, and the only work is the
capability notice where a capability is missing. Features that START from
a Sleeper handle need an entry-flow change. Features that are Sleeper the
SOURCE do not change.

### 11.1 League Pulse deep view and its ten pages

Free, plus: provider mark (10.7), attribution (10.6), capability notices
on Power Pulse (`futureSchedule`), Schedules (`futureSchedule`), Lineups
(`perPlayerProjections` sentence on the projection column header
footnote), Trade Ideas (`tradedPickAssetsOnRoster`), Decisions
(`historyRetained`). The Teams tab's taxi section renders only when the
league has a TAXI token, which it already does by reading
`roster_positions`.

### 11.2 Would You Rather

The pool builder (`lib/would-you-rather/pool.ts`) samples
`league_transactions` joined to `leagues` with no provider filter, so
Yahoo trades enter the pool as soon as they are graded. Three rules:

- Only leagues with `visibility = 'public'` OR the registry setting
  `would_you_rather.includeMembersOnlyLeagues = true` (default false)
  contribute. The board is anonymised (Team A, Team B, no league name),
  so a private league's trade is not identifying, but the default stays
  off until the owner decides.
- Under `rolling_24h`, a pooled Yahoo trade's `graded` jsonb and its
  vote rows are OUR derived data and are kept; the trade row is retired
  when its league is purged (Part 5.5) and never re-served, because the
  reveal reads `league_positional_war_cache` and `league_power_pulse_cache`,
  which are purged too.
- The Discord poll's question line (`poll-text.ts`) reads the league's
  format from `LeagueShape`, so a Yahoo keeper league reads "Keeper 12T
  PPR, start 9" exactly as a Sleeper one; the reveal page carries the
  attribution line.

`league_category` on the pool row comes from `categorizeLeague(LeagueShape)`
and is never null for a Yahoo league (there is always a shape), so the
routing rule "a null type routes to the fallback or nowhere" is unchanged.

### 11.3 Signal Check

The import panel lists leagues from both providers (Part 9.4) and imports
completed trades from `league_transactions` by FF Beacon id; the analyzer
reads `player_value_trends` by `players.id` and `draft_pick_values` by
season and round, so a Yahoo pick with `season = null` (probe false) is
priced as the NEXT season's pick and the verdict says "Yahoo does not say
which year this pick is; priced as {season}". `signal_check_analyses.provider_context`
(renamed) stores the ref.

### 11.4 Manager Pulse

- Entry: the search form stays for Sleeper handles. A connected Yahoo
  reader gets an "Open my Yahoo history" control on the identity card,
  which runs discovery under their connection: `users;use_login=1/games`
  for the seasons, then `.../games;game_keys={ids}/leagues` for each, then
  enqueues `footprint` jobs with `provider = 'yahoo'` and the
  `connection_id`. The subject key becomes `(provider, provider_user_id)`
  everywhere (Part 5.6).
- A combined report (the reader's Sleeper AND Yahoo history) is a
  follow-up (Part 17); in this build a report is one provider, chosen on
  the card, because the tendencies model keys samples by provider user id.
- The freshness rule (`lib/manager-pulse/freshness.ts`) is unchanged for
  `indefinite` providers. Under `rolling_24h` a settled Yahoo league-season
  is NOT "never captured again"; it is re-captured on each report request
  after purge, and the estimate on the progress panel uses the Yahoo call
  budget of Part 7.3. The page states it (10.2).
- `publicLookupByHandle = false`: the URL `/tools/manager-pulse/[handle]`
  never resolves a Yahoo subject; a Yahoo report lives at
  `/tools/manager-pulse/me?provider=yahoo` for the connected reader only,
  and is never shareable, because Yahoo data cannot be shown to a non-
  member.

### 11.5 FAAB tool and Beacon Breakdown

Both start from a league list and read the synced tables; both gain the
provider-aware list (9.4). FAAB's free-agent read for Yahoo is Part 7.8's
`players;status=FA` under the reader's connection, metered by the existing
`lib/league-lineups/rate-limit.ts` bucket. Beacon Breakdown's matchup
header reads `league_matchups`, which for Yahoo is populated for the
current week plus whatever the probe allowed.

### 11.6 On The Clock

Sleeper only in this build. `liveDraft = false` for Yahoo. The username
gate is unchanged. The tools index page describes it as a Sleeper draft
room in words. A Yahoo live draft is a follow-up that would need
`draftresults` polling under a member's token and is listed in Part 17
with its budget cost.

### 11.7 Beacon Link

Unbuilt today. The connections table in Part 5.3 is the one Beacon Link
should adopt for Sleeper; nothing in Beacon Link applies to Yahoo because
Yahoo is read-only.

### 11.8 Saved handle and the tools' identity gate

Unchanged for Sleeper. The gate composes the OAuth card (10.3). The
`?username=` override rule (D2) applies only to `public_handle`
providers; the Yahoo equivalent is `?league=`.

### 11.9 League Relay, Beacon Brief, Signal profiles

League Relay posts a league's activity to Discord from `league_activity`,
which is provider-neutral; the relay header (`lib/league-relay/header.ts`)
takes `LeagueShape`. A Yahoo league can be relayed only if the relaying
admin's connection is a member (the relay's own sync runs as a job with a
connection). Beacon Brief is unrelated. Signal profiles' league lists read
`signal_league_ids` as refs (Part 5.7) and render provider marks; a
members-only Yahoo league is never shown on a public profile (the profile
page runs as anon, so RLS hides it, and the editor says why).

### 11.10 Player profile, exposure, trades tab

The profile's trades tab (`components/player-profile/trades-tab.tsx`)
reads `find_player_trade_transactions` by uuid after 0286 and so shows
Yahoo trades from public Yahoo leagues; members-only leagues are hidden
by RLS. `player_roster_exposure` stays Sleeper-only in this build (its
cron would otherwise need a token per league); the panel says "Across
synced Sleeper leagues".

### 11.11 OG images

All routes take the league ref (9.2), render values through
`resolveLeagueContext` unchanged, and add the attribution text band for
Yahoo. The brand rule is unchanged: FF Beacon colours, Geist, no gold, no
DPC background. A members-only Yahoo league's OG image is served only when
the request carries a signed token minted by the page for the sharer
(`lib/og-token.ts`, HMAC over league ref plus expiry with `CRON_SECRET`
as the key), because OG routes run as anon and RLS would otherwise return
nothing; the page renders the share control only for members.

### 11.12 Crons

`vercel.json` gains `/api/cron/sync-provider-players?provider=yahoo`
(`30 6 * * *`), `/api/cron/sync-playerid-crossref` (`0 9 * * 2`, Tuesday
09:00 UTC), `/api/cron/provider-retention` (`30 * * * *`, hourly), and
`/api/cron/sync-provider-stat-categories?provider=yahoo` (`0 5 * * 1`,
Monday 05:00 UTC, which also covers a new season's first read). Every
schedule in that file is UTC, as the existing entries are; the times in
this document are given as cron expressions for that reason. None of them iterates leagues. `league-sync-worker`
gains the Yahoo bucket. Nothing new touches the nightly
`recalculate-derived` except the consistency check and the purge.

---

## Part 12. Security review items

Every item is a checklist line for the security sub-agent that closes
each phase.

- Tokens: only `lib/providers/yahoo/oauth.ts` and
  `lib/providers/connections.ts` touch Vault or `api.login.yahoo.com`;
  the connections guard test enforces it. No token, code, state or
  `client_secret` is ever logged (a `redactProviderSecrets` helper wraps
  every `console` call in those two files, and a test asserts the log
  output of a failed exchange contains none of the fixture's secret
  strings). No token appears in a prompt to any model (Beacon Brief and
  BEAM never receive league rows with connection data because none is on a
  league row).
- OAuth: `state` bound to the issuing user id, single-use, 10-minute
  expiry; PKCE sent; `id_token` verified against the JWKS with `iss`,
  `aud`, `exp`, `nonce`; `redirect_uri` fixed from env; the `next`
  parameter validated as a same-origin path.
- CSRF: disconnect and format override are server actions with Next's
  origin check; connect is a GET that only mints state (idempotent, no
  side effect beyond a state row).
- IDOR: every Yahoo read uses the caller's own connection; `connectionId`
  never comes from the client, it is resolved from `auth.uid()` server-
  side. League reads are under RLS (Part 5.2); the deep view never uses
  the admin client for a members-only league's rows.
- SSRF and host validation: `logo_url`, `image_url`, `headshot.url`,
  `team_logos[].url` are accepted only when their host is on an allow-list
  (`s.yimg.com`, `yimg.com` subdomains, `sleepercdn.com`) and the scheme
  is https; otherwise stored as null. The image hosts are added to
  `next.config.ts images.remotePatterns` and the CSP `img-src` in
  `lib/security-headers.ts`.
- Rate limits: the OAuth routes (7.1), the free-agent panel (existing
  bucket), the Yahoo provider budget, and the per-league 60-second refresh
  limit unchanged.
- Secrets in the repo: `YAHOO_CLIENT_SECRET` is server-only; the build-time
  leakage guard from the Beacon Link plan (Part 3A there) is adopted as
  `lib/security/env-leak.test.ts`, asserting no `NEXT_PUBLIC_` name
  contains `YAHOO` and no client bundle string contains the secret's env
  name.
- Information disclosure: a members-only league that the reader cannot
  read 404s; error messages from Yahoo are stored in `status_detail` with
  token material stripped and shown to the reader only as our own copy.
- Dependencies: no new runtime dependency is required (native `fetch`,
  `crypto.subtle` for PKCE and JWKS verification via `jose` ONLY if the
  hand-rolled ES256 check is judged too risky in review; `jose` is the one
  permitted addition and `npm audit` runs in the phase gate).
- Session: connecting Yahoo does not sign the reader in; Supabase Auth
  remains the only login. A Yahoo connection on a deleted account is
  cascaded and its secrets deleted by trigger.
- RLS verification on 0283, 0284, 0285 follows the seven-step sequence in
  CLAUDE.md, with the three-persona test in Part 5.8.

---

## Part 13. Accessibility items

- The connect button is Yahoo's art with a text alternative and a visible
  label; it is a link, focus visible, 44 px tall.
- The provider mark is always accompanied by the provider's name in text
  in the same row; the mark is `aria-hidden`.
- The capability notice is a paragraph in reading order before the panel
  it qualifies, not a tooltip and not `aria-live`.
- The connection card and connect card reuse the identity card's heading
  level and structure so the tools' heading hierarchy does not change.
- The format override is a `<fieldset>` with a `<legend>`, native radios,
  and a save button whose result is announced in the existing tool-level
  live region.
- The review queue is a real table with `scope="row"` on the Yahoo name,
  and every action button's accessible name includes the player's name.
- Attribution is body text with links whose names say where they go
  ("Yahoo Fantasy", "Yahoo"), never an image-only link.
- Every date shown (connected_at, last_used_at, occurred_at) goes through
  `lib/datetime.ts formatEastern`.
- Mobile: every league list row keeps the logo column, the provider name,
  the league name and the season at every breakpoint; nothing is hidden
  by a responsive utility without a stacked equivalent.
- The accessibility sub-agent's checklist for each phase includes: no
  data hidden at any breakpoint; the capability notice is read before the
  panel; the connect flow is completable with keyboard only, including the
  return from Yahoo.

---

## Part 14. Testing strategy

### 14.1 Existing guards that must keep passing, unchanged

`lib/league-capture-set.test.ts`, `lib/league-matchups.test.ts`,
`lib/sleeper-handle/guard.test.ts`, `lib/players/sleeper-lookup-guard.test.ts`,
`lib/client-sleeper-import.test.ts`, `lib/projections/source-guard.test.ts`,
`lib/projections/raw-column-guard.test.ts`, `lib/positional-war/naming.test.ts`,
`lib/security/sleeper-size-guard.test.ts`, and every model test listed in
the inventory. The refactor is behaviour-preserving for Sleeper and these
are the proof.

### 14.2 New guards

`lib/providers/registry-guard.test.ts`, `league-import-guard.test.ts`,
`model-id-guard.test.ts`, `capability-guard.test.ts`, `copy-guard.test.ts`,
`connections-guard.test.ts`, `retention.test.ts` (Parts 4.6, 5.3, 5.5).
Each follows the shape of `lib/sleeper-handle/guard.test.ts`: scan the
roots, a forbidden pattern, an allow-list that is a debt ledger with a
reason per line.

### 14.3 Fixtures

`lib/providers/yahoo/fixtures/` holds one JSON file per response shape,
recorded from the API on the spike day and SCRUBBED by
`scripts/scrub-yahoo-fixture.ts` (manager guids replaced with sequential
fakes, nicknames with "Manager N", emails removed, image URLs replaced
with a placeholder on an allowed host). Until the spike, hand-written
fixtures built from the docs' samples and the library models stand in,
marked `"_fixture_source": "docs-sample"` so the spike knows which to
replace. Shapes: league with settings, teams with rosters (current week
and a past week with an empty IR), scoreboard for a played week and a
preevent week, transactions (add, drop, add/drop with FAAB, trade with
picks, commish), draftresults (snake and auction), players page,
stat_categories, game_weeks, games list, users;use_login=1 with games and
leagues, a `token_expired` 401, a 403 not-authorized, a 999.

### 14.4 The spike (LP-T060)

On the first day of approved access, under the owner's own connection, in
a throwaway branch, record and commit to `yahoo-plan-notes.md` section 9:
the exact `stat_categories` table with ids; the roster position labels
for a superflex league, a W/T league and an IDP league (three test leagues
the owner creates on Yahoo for the purpose, which Yahoo allows); the
`renew`/`renewed` format; whether `picks[]` carries a season; the
transaction timestamp unit; the in-draft `draft_status` value; the
scoreboard status for a live week; how many preevent weeks the scoreboard
returns in September and in December; the exact `editorial_team_abbr`
strings; the JSON of a manager object for a co-manager; the `is_keeper`
placement; the rate at which 999 appears when paging the full player pool.
Every UNVERIFIED in this document has a line there.

### 14.5 Model regression

Before Phase 3 ships, `scripts/compare-provider-refactor.ts` pulses ten
existing Sleeper leagues on `main` and on the branch and diffs every row
of `leagues`, `rosters`, `league_users`, `league_transactions`,
`league_matchups`, `league_drafts`, `draft_selections`, the three model
caches and the power-rankings cache (excluding timestamps and the new
columns). The diff must be empty. This is the proof that "just like
Sleeper is" still holds for Sleeper.

---

## Part 15. Build order and tasks

Phases are ordered so that everything provider-neutral ships and is
verified on Sleeper BEFORE any code needs a Yahoo token. Phases 0 to 3 can
be built while the Yahoo application is pending. Phase 4 is built against
fixtures. Phase 5 needs approval. Each phase closes with the three
sub-agent reviews (implementation, accessibility, security) and the guard
tests green. Tasks are atomic per CLAUDE.md: one file, one migration, one
feature each.

Effort is given as the number of atomic tasks; the owner's artifact turns
that into weeks.

### Phase 0. Applications and decisions (owner, Part 16)

No code. LP-T000 records in `yahoo-plan-notes.md` the application date,
the answer, the retention answer and the brand approval.

### Phase 1. Registry, capabilities, refs (14 tasks)

- LP-T001 migration 0279 `league_providers` plus `nfl_teams.aliases`,
  seeds, RLS, types regen.
- LP-T002 `lib/providers/capabilities.ts` with `SLEEPER_CAPABILITIES`,
  `YAHOO_CAPABILITIES`, `parseCapabilities`, `resolveCapability`, test.
- LP-T003 `lib/providers/refs.ts` and test (Part 9.1).
- LP-T004 `lib/providers/types.ts` (Part 4.4, 4.5).
- LP-T005 `lib/providers/copy.ts`, `capability-copy.ts`, tests.
- LP-T006 `lib/providers/registry.ts` with `getProvider`,
  `listActiveProviders`, `providerForLeague`; `registry-guard.test.ts`.
- LP-T007 `lib/providers/budget.ts` generalising the bucket; re-exports;
  `lib/sleeper-budget.test.ts` still green.
- LP-T008 `components/providers/capability-notice.tsx`,
  `provider-mark.tsx`, `attribution.tsx`, a11y audit.
- LP-T009 `/admin/providers` page, actions, `lib/providers/validate.ts`.
- LP-T010 `lib/providers/capability-guard.test.ts`, `copy-guard.test.ts`
  with their initial allow-lists.
- LP-T011 `docs/README.md` row and `CLAUDE.md` section "League
  providers" (the rules of Part 4.6, written for the next session).
- LP-T013 `lib/providers/capability-matrix.ts` (Part 4.9) and the public
  page `app/providers/page.tsx` (Part 10.10) with its nav entry; the
  capability guard of LP-T010 switches to reading the matrix; a11y audit
  of the tables.
- LP-T014 `lib/providers/contract.test.ts` (Part 4.8) and
  `lib/providers/README.md`, the directory-level statement of the
  contract and the checklist, so a future provider phase starts from a
  file in the tree rather than from this document.
- LP-T012 Phase reviews.

### Phase 2. Schema (14 tasks)

- LP-T020 migration 0280 (Part 5.1), types regen, the compat generated
  columns, comments.
- LP-T021 migration 0281 queue and Manager Pulse tables and RPCs.
- LP-T022 migration 0282 Would You Rather.
- LP-T023 migration 0284 connections, oauth states, provider_seasons,
  the secret-deleting trigger, the status view; RLS verification with the
  three personas.
- LP-T024 migration 0285 provider_players, review, stat map, the Sleeper
  backfill from `external_ids`, `upsert_sleeper_player_identity`.
- LP-T025 migration 0286 `find_player_trade_transactions` v2.
- LP-T026 migration 0283 visibility RLS on 12 tables, `is_league_member`,
  `can_read_league`, explain-analyze before and after recorded in the
  file.
- LP-T027 `lib/providers/connections.ts` and `connections-guard.test.ts`.
- LP-T028 `lib/providers/players/lookup.ts` delegating to
  `resolveSleeperPlayers` for Sleeper; test.
- LP-T029 `lib/providers/players/resolve-identity.ts` pure resolver with
  fixture tests for every branch of Part 6.1.
- LP-T030 `scripts/sync-playerid-crossref.ts` and `player_id_crossref`
  table (in 0285), cron route, `vercel.json`.
- LP-T031 `scripts/check-provider-player-consistency.ts` and its wiring
  into `recalculate-derived` as a read-only step.
- LP-T032 `/admin/providers/players` review queue (Part 6.9), a11y audit.
- LP-T033 Phase reviews, including the security sub-agent's explicit RLS
  verification of 0283, 0284, 0285.

### Phase 3. Sleeper behind the interface (18 tasks)

- LP-T040 `lib/providers/sleeper/map-league.ts` and `LeagueShape`; change
  `deriveLeagueFormat`, `deriveKeeperStyle`, `deriveStatusVariant`,
  `categorizeLeague` to take `LeagueShape`; every type-only
  `SleeperLeague` importer (25 files, listed in the inventory) re-typed.
- LP-T041 `map-roster.ts`, `map-member.ts` lifted from `upsertRosters`
  and `upsertLeagueUsers` with tests.
- LP-T042 `map-transaction.ts`, `map-draft.ts`, `map-matchup.ts` lifted
  with tests; `normalizeDraftPicks` stays in `lib/sleeper-draft-picks.ts`.
- LP-T043 `lib/providers/sleeper/provider.ts` implementing
  `LeagueProvider`; `ProviderResult` conversions; tests for null-versus-
  empty on every method.
- LP-T044 `lib/league-pulse.ts` takes `ProviderLeagueRef`; upserts write
  `provider` and `provider_*` columns; `pulseLeague` wrapper kept; all
  existing tests green.
- LP-T045 `lib/league-matchups.ts` takes the provider; positional rule
  unchanged; test unchanged.
- LP-T046 `lib/league-draft-selections.ts` writes `provider_*` columns.
- LP-T047 `lib/league-bulk-sync.ts` dispatches on `job.provider`;
  `enqueue` payloads carry refs; `lib/league-bulk-sync.test.ts` extended.
- LP-T048 `lib/manager-pulse/capture.ts`, `discover.ts`, `load.ts`,
  `freshness.ts`, `service.ts`, `finalize.ts` on `(provider,
  provider_user_id)`; all 13 Manager Pulse test files green.
- LP-T049 `lib/league-lookup.ts loadLeagueByRef`; the ten league pages,
  three API routes and five OG routes switch to it; `sleeper-123`
  canonicalisation redirect.
- LP-T050 The 14 `resolveSleeperPlayers` roster/matchup call sites switch
  to `resolveProviderPlayers(league.provider, ...)` (the projection and
  market call sites do not).
- LP-T051 `lib/player-trades.ts`, `components/player-profile/trades-tab.tsx`
  on the uuid RPC.
- LP-T052 `user_preferences.sleeper_league_settings` list keys as refs;
  `parseSleeperLeagueSettings` grammar; `guard.test.ts` green.
- LP-T053 `components/providers/provider-gate.tsx` composing the Sleeper
  gate; the 15 copy surfaces on `providerCopy`; migration 0287 for the two
  seeded strings.
- LP-T054 `/my-beacon/connections` with the Sleeper section, the 308 from
  `/my-beacon/sleeper-leagues`.
- LP-T055 `scripts/compare-provider-refactor.ts` run on ten leagues; diff
  empty; result recorded in `yahoo-plan-notes.md`.
- LP-T056 Import guard allow-list emptied; migration 0288 cleanup applied.
- LP-T057 Phase reviews. This phase ships to production on its own: the
  site is provider-shaped with one provider.

### Phase 4. Yahoo provider against fixtures (16 tasks)

- LP-T060 The spike (Part 14.4). Blocked on approval; every later task
  in this phase is built on the docs-sample fixtures and re-run against
  the recorded ones when LP-T060 lands.
- LP-T061 `lib/providers/yahoo/constants.ts`, `json.ts` with fixture
  tests for every shape in Part 14.3.
- LP-T062 `oauth.ts`: exchange, refresh with the lock, revoke, JWKS
  verification, the redaction wrapper and its log test.
- LP-T063 `client.ts`: `yahooGet`, the classifier, the budget, the size
  guard moved to `lib/http/size-guard.ts`.
- LP-T064 `games.ts` and `provider_seasons`; `getWeekCalendar`.
- LP-T065 `scoring-map.ts` and the `provider_stat_map` seed; test that
  every emitted key is in the live vocabulary.
- LP-T066 `slot-map.ts` and test.
- LP-T067 `map-league.ts`, `map-roster.ts`, `map-member.ts` with the
  positional starters reconstruction test.
- LP-T068 `map-transaction.ts` (week derivation), `map-draft.ts`,
  `map-matchup.ts`.
- LP-T069 `map-player.ts`, `scripts/sync-yahoo-players.ts`, cron route,
  inline resolution during a league sync.
- LP-T070 `scripts/sync-yahoo-stat-categories.ts`, cron route.
- LP-T071 `provider.ts` implementing `LeagueProvider`; probes (7.7).
- LP-T072 OAuth routes (7.1), `provider_oauth_states` prune, rate limits,
  the connect button component with Yahoo's art, the connection and
  connect cards, disconnect action.
- LP-T073 Retention purge (5.5) and `retention.test.ts`; hourly cron.
- LP-T074 Power Pulse `scheduleMode` (7.8) with the agreement test;
  Schedules and Lineups notices.
- LP-T075 Phase reviews (security: the OAuth checklist of Part 12 in
  full).

### Phase 5. Yahoo live (12 tasks)

- LP-T080 Registry row `is_active = true` for Yahoo only on a staging
  toggle; the owner connects; `/admin/providers` test read passes.
- LP-T081 Player universe sync run; unmatched-and-rostered driven to zero
  on the three test leagues via the review queue.
- LP-T082 The three test leagues synced end to end; every deep-view page
  rendered by the accessibility sub-agent with a screen reader pass.
- LP-T083 Would You Rather pool admits a Yahoo trade from a public test
  league; the reveal carries attribution.
- LP-T084 Manager Pulse "Open my Yahoo history" end to end.
- LP-T085 Signal Check import from a Yahoo league.
- LP-T086 FAAB and Beacon Breakdown on a Yahoo league.
- LP-T087 OG images for a Yahoo league with attribution band and the
  signed token for members-only leagues.
- LP-T088 Legal pages updated (Part 16 item 9); brand placement submitted
  to Yahoo's permission form; attribution live.
- LP-T089 `/admin/system/league-health` provider column; alerts for 403
  and 999.
- LP-T090 Public flip of `is_active`; announcement copy; the tools index
  updated.
- LP-T091 Phase reviews and a `docs/league-providers/league-providers-build-report.md`
  recording what shipped differently.

---

## Part 16. The owner's checklist (everything outside the code)

In order. Items 1 to 5 can all start today and none needs any code.

1. Create or choose the Yahoo account that will own the app. It must be a
   real account the owner controls, because Yahoo allows one developer
   account per person ("Developers may create only a single account") and
   because the owner's own Yahoo Fantasy leagues are the test leagues.
   Turn on two-factor authentication on it.
2. Create the YDN app at `https://developer.yahoo.com/apps/create/`
   (sign in first). Fill: Application Name "FF Beacon", Description (a
   short version of item 4), Homepage URL `https://ffbeacon.com`, Redirect
   URI(s) `https://ffbeacon.com/api/providers/yahoo/callback`, and under
   API Permissions tick OpenID Connect. As of 2026-09-09 the form offers
   only "OpenID Connect" and "TW Auction"; the Fantasy Sports permission
   is not on the form and is provisioned by Yahoo after approval (Part
   2.1 addendum). Record the exact field list you see, because no 2026
   source agrees on it. Save the Client ID and Client Secret in the
   password manager only; never in chat, never in a file in the repo. The
   `.env.local` variable names are `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`,
   `YAHOO_REDIRECT_URI`. Appendix B walks this screen by screen.
3. Create three test leagues on Yahoo Fantasy (free): one standard 12-team
   PPR with a W/R/T flex, one with a Q/W/R/T superflex slot and a TE
   reception premium, one with IDP slots. They only need the owner and a
   second account of the owner's as members and can be drafted by autopick.
   These are what the spike (LP-T060) reads.
4. Submit the access application at `https://sports.yahoo.com/developer/access/`.
   Write it in full; incomplete submissions are closed without reply. It
   should state: the product (FF Beacon, an accessibility-first fantasy
   football site at ffbeacon.com, with a screen-reader-first design as the
   differentiator); the exact data required (the signed-in user's games and
   leagues; for each league its settings, standings, teams, rosters by
   week, scoreboard by week, transactions, draft results, and player
   metadata and weekly stats for players in those leagues); read-only; the
   expected users band (Small, under 1,000, for the first year); that
   access is for each user's own leagues only, never single-league or
   personal use; the retention question in plain words ("Our league tools
   grade a season's decisions after the fact, which needs each week's
   results kept for the season. The Developer API Terms section 2.1 limits
   retention of user data to 24 hours unless the API documents say
   otherwise. Please confirm whether league results, rosters and
   transactions read on a member's behalf may be kept for the season, or
   whether we must re-fetch them within 24 hours."); the monetisation
   facts ("The site is free. It accepts donations, and plans a paid
   membership for features unrelated to Yahoo data. No Yahoo data is
   sold, resold or used for advertising."); and the Client ID from item 2
   (the field is optional; fill it anyway). Appendix B.3 is the full
   text, ready to paste. Keep a copy of what was submitted and the date in
   `yahoo-plan-notes.md` (LP-T000).
5. When Yahoo replies, record the answer, the retention answer and any
   conditions in `yahoo-plan-notes.md`. Expect a legal agreement by
   DocuSign before any key is issued (Part 2.1 addendum); read it for a
   retention clause before signing, because it may be the "API Access and
   Use Agreement" the portal names and the answer to item 5a. If Yahoo
   confirms league data is storable, the registry row's `retention_policy`
   becomes `indefinite` and the purge never runs. If Yahoo says 24 hours,
   it stays `rolling_24h`. If Yahoo does not answer the question, it stays
   `rolling_24h`.
5a. Pull the archived "Yahoo Fantasy Sports APIs Terms of Use" from the
   Wayback Machine (search `web.archive.org` for
   `legal.yahoo.com/us/en/yahoo/terms/product-atos/fantasysportsapi`),
   save the PDF to the password manager's document store, and paste the
   retention, attribution and commercial-use clauses into
   `yahoo-plan-notes.md` section 9. The live page is a 404 and the
   research environment could not reach the archive, so this is the
   owner's five minutes.
6. Download Yahoo's Sign in with Yahoo button kit from
   `https://developer.yahoo.com/sign-in-with-yahoo/` and the Yahoo Fantasy
   logo from the URL in Part 2.1, and place them in `public/brand/yahoo/`
   (a code task once received; the download is the owner's).
7. Submit the brand permission request at `https://ipr.yahoo.com/permission`
   with screenshots of the connect button placement and the attribution
   line as they will appear (the build produces these in LP-T088). Ten
   business days.
8. Decide the three Part 17 questions that are the owner's to decide:
   Would You Rather from members-only leagues (default off), the per-
   minute Yahoo budget to start at (60), and whether the format override
   is offered to commissioners or admins only.
9. Update the legal pages (`/privacy`, `/terms`) with a Yahoo paragraph:
   what is read, that it is read only with the reader's consent through
   Yahoo's login, that it can be disconnected at any time, how long it is
   kept (per item 5), and Yahoo's attribution. This is copy the owner
   approves; the code task inserts it.
10. Add the four env vars to Vercel for production and preview (the
    preview redirect URI is a second entry in the app's Redirect URI(s)
    field; the owner adds it in the Yahoo app form).
11. On launch day: connect the owner's Yahoo account first, run the admin
    test read, set the owner's account as the registry's system
    connection, and only then flip Yahoo active.

Time expectations, stated honestly: Yahoo publishes no review timeline
and the community reports weeks with no reply. Phases 1 to 3 are around
46 atomic tasks of code that do not depend on Yahoo; if the approval
arrives while they are in progress nothing is lost, and if it never
arrives the site is still better shaped for the next provider.

---

## Part 17. Open questions and decisions

Owner decisions (the plan proceeds under the default in brackets):

- Would You Rather from members-only Yahoo leagues [off until decided].
- Yahoo calls per minute to start [60].
- Format override offered to [commissioners and admins].
- Whether a combined Sleeper-plus-Yahoo Manager Pulse report is wanted in
  this build [no; one provider per report].
- Whether On The Clock should ever poll a Yahoo live draft [no; noted as
  a follow-up with its budget: one `draftresults` read every 20 seconds
  for the length of a draft, per room].
- Whether `player_roster_exposure` should include Yahoo leagues [no in
  this build].

Facts the spike settles (every UNVERIFIED in Parts 2 and 7): the
stat_categories ids; the slot labels for W/T, Q/W/R/T, D, DL, LB, DB; the
`renew` format; picks with a season; the timestamp unit; the in-draft
`draft_status`; the live scoreboard status; how many preevent weeks are
returned; `editorial_team_abbr` casing; the co-manager object; where
`is_keeper` sits; the 999 rate; whether PKCE is honoured; whether
`fspt-r` is the exact scope string; whether public leagues are readable
by a non-member's token in practice.

Facts only Yahoo can settle: the retention clause; whether donations and
a membership are "deriving income from the use or provision of the Yahoo
APIs"; the review timeline; the approval-to-working gap.

Follow-ups deliberately not in this build: renaming
`user_preferences.sleeper_league_settings`; a third provider; Beacon
Link adopting `provider_connections`; write access if Yahoo ever restores
it (the XML shapes are in the notes file).

---

## Part 18. Risk register

| Risk | Likelihood | Effect | Mitigation in this plan |
| --- | --- | --- | --- |
| Yahoo never approves, or takes months | Near certain delay (Yahoo quotes one to two weeks; the 2026-09-01 thread shows a month or more after the DocuSign step with no key) | Phase 5 never runs, or runs late | Phases 1 to 3 ship value alone (a provider-shaped site, cleaner names, the identity map); Phase 4 is fixture-built; nothing is gated on Yahoo until LP-T080; Appendix B gives the owner a follow-up cadence |
| Approved but 403 for days or weeks | High (yfpy issues 84 and 85; no working newly approved app reported as of 2026-09-01) | Readers see errors | `not_authorized` is a first-class state with a banner, a budget pause, and an admin health flag; the flip to active (LP-T090) waits for a green admin test read, never for the approval email |
| 24-hour retention is binding | Medium | Ledger and Manager Pulse must re-fetch a season on each visit | `rolling_24h` mode designed in from day one; call budget per league is about 260 |
| Rate limiting with no published number | High | App-wide blocks | One bucket per provider starting at 60 per minute, 999 and non-JSON bodies pause for five minutes, `out=` reduces calls |
| Future schedule not published | Medium (conflicting evidence) | Power Pulse odds less precise | Probed capability, `scheduleMode`, an honest sentence on the page |
| Player mapping gaps | Certain for rookies | Unresolved players on rosters | Three seeds, a review queue ranked by roster references, a hard target of zero unmatched-and-rostered before flip |
| Refresh-token races | Medium | Readers forced to reconnect | Per-connection lock, newest token always stored, reconnect state with copy |
| RLS change slows public pages | Low | Latency on every league read | `can_read_league` short-circuits on `visibility = 'public'`; explain-analyze recorded in 0283; the budget is one index lookup |
| A rename breaks a scheduled job mid-deploy | Medium | Failed syncs for minutes | Generated compat columns during the transition; cleanup only after the allow-list is empty |
| Brand use without permission | Low | A takedown request | Attribution exact, permission requested with screenshots before flip |
| Monetisation clause | Low to medium | Yahoo objects later | Stated in the application; the reply is kept; Yahoo features are never behind a paywall in this build |
| Yahoo changes the API again | Medium (three changes in ten months) | Breakage with no notice | Fixtures per shape, the classifier, the health page, and GitHub issues on yfpy as the early-warning channel |

---

## Appendix A. Sources

Yahoo, read directly on 2026-09-08:
- https://sports.yahoo.com/developer (portal, policies, attribution, logo)
- https://sports.yahoo.com/developer/access/ (application form)
- https://sports.yahoo.com/developer/docs/ (API reference, football sample)
- https://developer.yahoo.com/fantasysports/guide/ (308 redirect)
- https://developer.yahoo.com/oauth2/guide/ and /flows_authcode/ and /faq/ and /troubleshooting/ and /openid_connect/getting_started.html
- https://api.login.yahoo.com/.well-known/openid-configuration
- https://developer.yahoo.com/attribution/
- https://developer.yahoo.com/sign-in-with-yahoo/
- https://policies.yahoo.com/us/en/yahoo/permissions/branduseguidelines/index.htm
- https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html
- https://help.yahoo.com/kb/SLN8846.html, SLN6490.html, SLN37135.html, SLN6111.html
- https://developer.yahoo.com/apps/create/ (login wall observed)
- https://legal.yahoo.com/us/en/yahoo/terms/product-atos/fantasysportsapi/index.html (NOT reachable)

Libraries and community, for shapes and behaviour Yahoo does not document:
- https://github.com/uberfastman/yfpy (query.py, models.py, issues 51, 79, 84, 85)
- https://github.com/spilchen/yahoo_fantasy_api (league.py, team.py, yhandler.py) and https://yahoo-fantasy-api.readthedocs.io/
- https://github.com/whatadewitt/yahoo-fantasy-sports-api (README, YahooFantasy.mjs, issues 81, 118, 123) and https://y-fantasy-node-docs.vercel.app/
- https://github.com/n-ae/yahoo-fantasy-sports-api-go (games.go)
- https://github.com/mattdodge/yahoofantasy
- https://rdrr.io/github/macraesdirtysocks/YFAR/ (vignette, y_players)
- https://yfpy.uberfastman.com/quickstart/ and /readme/
- https://github.com/nextauthjs/next-auth/discussions/769 (PKCE report)
- https://kenjdavidson.com/writing/2020/02/10/yahoo-oauth-in-postman/ (scope strings)

Cross-reference data:
- https://docs.sleeper.com/ (players endpoint fields)
- https://ffscrapr.ffverse.com/reference/sleeper_players.html
- https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv
- https://archive.linux.duke.edu/cran/web/packages/nflreadr/vignettes/dictionary_ff_playerids.html
- https://cran.r-project.org/web/packages/ffscrapr/vignettes/espn_authentication.html (why not ESPN)

Comparable products:
- https://support.fantasypros.com/ (three articles, snippets only)
- https://www.4for4.com/leaguesync, https://fantasyfootballcalculator.com/leagues, https://help.thefantasyfootballers.com/en/articles/3156929, https://keeptradecut.com/frequently-asked-questions, https://ffscrapr.ffverse.com/

This repository (read on 2026-09-08 at `277ddbf`): the files cited inline
in Parts 3, 5, 6, 8 and 9, and the live schema and counts measured through
the Supabase MCP against project `cilvpyivysjxpxbudkfa`.

Revision 2 sources, read 2026-09-09 by the research pass recorded in
`yahoo-plan-notes.md` section 10:
- https://github.com/uberfastman/yfpy/issues/84 and /85 (comments through 2026-09-01)
- https://github.com/derekrbreese/fantasy-football-mcp-public/issues/18 and its INSTALLATION.md
- https://github.com/kingspencerho/rosterxray-1/pull/94
- https://raw.githubusercontent.com/n-ae/yahoo-fantasy-sports-api-go/main/pkg/yahoo/games.go
- https://ffscrapr.ffverse.com/articles/espn_authentication.html, /espn_getendpoint.html, /espn_basics.html, /reference/ff_transactions.html, /reference/mfl_connect.html, /reference/fleaflicker_connect.html, /reference/fleaflicker_userleagues.html
- https://api.myfantasyleague.com/2026/api_info and ?STATE=details
- https://www.fleaflicker.com/api-docs/index.html and https://www.fleaflicker.com/forums/help/topics/fleaflicker-api-22951
- https://pkg.go.dev/github.com/pmurley/go-fantrax, https://github.com/meisnate12/FantraxAPI, https://fantraxapi.kometa.wiki/
- https://github.com/cwendt94/espn-api and its wiki; https://k5cents.github.io/fflr/
- https://disneytermsofuse.com/english/ (via https://support.espn.com/hc/en-us/articles/360035445091-Terms-of-Use)
- https://github.com/geoffharcourt/cbs_fantasy_sports_api_token_fetcher
- https://legal.underdogsports.com/?g=42203
- https://nflreadr.nflverse.com/articles/dictionary_ff_playerids.html
- https://support.fantasypros.com/hc/en-us/articles/115000540814 and /115001316707; https://support.4for4.com/support/solutions/articles/19000129872-espn-leaguesync-2023; https://help.thefantasyfootballers.com/en/articles/3156929; https://keeptradecut.com/frequently-asked-questions; https://www.draftsharks.com/kb/fantasy-football-league-sync; https://ftnfantasy.com/fantasy/nfl/league-sync

---

## Appendix B. Setting up the Yahoo side, screen by screen

This is Part 16 items 1 to 7 and 10 to 11 expanded to the level of "what
do I click", for the owner. Everything here happens on Yahoo's sites, not
in the repository, and none of it needs code. Where a screen could not be
read without logging in, the appendix says what to expect and asks the
owner to record what is actually there.

### B.1 Before you start

- Pick the Yahoo account. It should be the one whose Yahoo Fantasy
  leagues will be the test leagues, because the API only ever reads the
  leagues of the signed-in person. One developer account per person is
  the rule. Turn on two-step verification on it.
- Have a password manager entry ready called "Yahoo Developer, FF Beacon".
  Two secrets will go in it and nowhere else.
- Decide the production callback address now, because it is typed into a
  form that is awkward to edit later:
  `https://ffbeacon.com/api/providers/yahoo/callback`. A second entry for
  Vercel previews and one for local work are added in B.5.

### B.2 Create the app (gets you a Client ID and Client Secret)

1. Sign in at `https://login.yahoo.com/` with the chosen account.
2. Open `https://developer.yahoo.com/apps/create/`. It will bounce you
   through the login page if you are not signed in.
3. Fill the form. Fields reported in 2026 (record the real list; the
   plan's sources disagree on the exact set):
   - Application Name: `FF Beacon`
   - Description: `Accessibility-first fantasy football tools at
     ffbeacon.com. Reads a signed-in user's own Yahoo Fantasy Football
     leagues (settings, rosters, results, transactions, draft results) to
     show them in FF Beacon's league tools. Read-only. Screen reader
     first.`
   - Homepage URL: `https://ffbeacon.com`
   - Redirect URI(s): `https://ffbeacon.com/api/providers/yahoo/callback`
     (one per line if the field takes several; add the two from B.5 now
     if it does).
   - Application Type, if asked: `Web Application` (a server holds the
     secret; the older "Installed Application" choice is for desktop
     tools).
   - API Permissions: tick `OpenID Connect`. There is no Fantasy Sports
     box on the 2026 form; do not look for one, and do not tick
     `TW Auction`.
4. Submit. The next screen shows the Client ID (also called Consumer Key)
   and Client Secret (Consumer Secret). Copy both into the password
   manager entry. Close the tab. If you ever paste either into a chat, a
   file, an issue or a screenshot, rotate it from the app's page.
5. Write the Client ID, and the date, into `yahoo-plan-notes.md` section
   9 under "App created". The Client ID is not a secret; the Secret is.

### B.3 Submit the access application (the part Yahoo reviews)

Open `https://sports.yahoo.com/developer/access/`. Fill every field.
Yahoo says incomplete submissions are closed without reply, so
over-explain rather than under-explain. Suggested content, ready to
paste; edit anything that is not true on the day:

- Organization or developer name: `FF Beacon (Michael Walsh)`.
- Website: `https://ffbeacon.com`.
- Contact email: the address you will actually watch; Yahoo's follow-up
  has arrived by email and by DocuSign in 2026.
- Expected Users: `Small (< 1,000 users)`.
- Client ID: the one from B.2 (optional on the form; fill it).
- Product description:

```
FF Beacon (ffbeacon.com) is a free fantasy football website built
screen-reader first. Its League Pulse tools read a manager's own leagues
and explain them in plain words: projected wins and playoff odds, which
positions are scarce in this specific league, a review of the lineups the
manager actually set against the best lineup they had, trade evaluation,
a transaction feed, and weekly matchup pages. Today those tools work for
Sleeper leagues. We are asking for read access so a Yahoo Fantasy Football
manager can sign in with Yahoo and see the same tools for their own Yahoo
leagues.

Data required, all read-only, all limited to leagues the signed-in user is
a member of: the user's games and leagues (users;use_login=1); for each
league its settings (roster positions, stat categories and modifiers),
standings, teams and managers, rosters by week, scoreboard by week,
transactions and draft results; and, for players on those rosters, player
metadata and weekly stats. We also read the game-level stat_categories,
game_weeks and players collections so that our own player records can be
matched to Yahoo's player ids.

Intended users: individual fantasy managers reading their own leagues.
Access is never limited to a single league or to personal use; each user
authorizes their own account through Yahoo's OAuth login and can
disconnect at any time from their account page. We do not look up other
people's leagues, and there is no way to on this API.

Attribution: every page that shows Yahoo data will carry the text
"Fantasy data provided by Yahoo Fantasy" with the Yahoo Fantasy logo and
a link to the league on Yahoo, and the "powered by Yahoo" mark linking to
yahoo.com, per the attribution policy. We will submit the placement for
brand approval before launch.

Retention question: two of our tools grade a season's decisions after
the fact (lineup efficiency and a decision ledger), which needs each
week's results kept for the season. The Yahoo Developer API Terms of Use
section 2.1 limits retention of user data to 24 hours unless the API
documents say otherwise. Please confirm whether league results, rosters
and transactions read on a member's behalf may be kept for the season, or
whether we must re-fetch them within 24 hours. We have designed for
either answer and will comply with whichever you state.

Monetization: the site is free. It accepts voluntary donations and plans
a paid membership for features unrelated to Yahoo data. No Yahoo data is
sold, resold, shared with third parties or used for advertising. If this
counts as deriving income under section 1.7.4, please tell us what
written permission you need us to hold.

Technical: server-side Next.js on Vercel; OAuth 2.0 authorization code
flow with tokens stored encrypted (Supabase Vault) and refreshed on the
server; one request budget for the whole application, starting at 60
requests per minute and reducible on request; no scraping, no automated
account creation, no writes.
```

- Notes field: repeat the retention question in one sentence and the
  "read-only, no write access requested" sentence.

Submit, then paste the whole submission and the date into
`yahoo-plan-notes.md` section 9 under "Application submitted" (LP-T000).

### B.4 What happens next, and the follow-up cadence

Reported in 2026 (Part 2.1 addendum): an automated confirmation quoting
"typically takes 1-2 weeks, depending on complexity"; then, for approved
applicants, a legal document by DocuSign; then, some time later, the
Fantasy Sports permission appearing on the app and the 403s stopping. The
last step has taken weeks with no visible progress for several
developers, and some report approval without a working key a month on.

- Day 0: submit; record the date.
- Day 14: if there has been no reply, reply to the confirmation email
  (not a new submission; "Developers may create only a single account"
  and a duplicate application is the easiest way to be closed) asking for
  status, quoting the application date and the Client ID.
- On the DocuSign: read the whole document before signing. Look for a
  retention clause (it may answer item 5 of Part 16), an attribution
  clause, and a commercial-use clause. Save the signed copy to the
  password manager's document store. Record the date and any clause that
  changes this plan in `yahoo-plan-notes.md` section 9.
- After signing: run the admin test read (Part 10.9) once a day. Green
  means the key works. A 403 with "not authorized" after approval is the
  known state (yfpy issue 85); reply to the approval email with the
  Client ID and the exact error body, and keep running the test read.
- Nothing in the build waits on any of this until LP-T080 (Part 15).

### B.5 Callback addresses for previews and local work

- Production: `https://ffbeacon.com/api/providers/yahoo/callback`.
- Vercel preview deployments have per-branch hostnames, and Yahoo needs
  the exact address in advance, so previews use a FIXED preview alias:
  add a Vercel domain alias such as `preview.ffbeacon.com` pointed at the
  preview branch you test on, and register
  `https://preview.ffbeacon.com/api/providers/yahoo/callback` as the
  second Redirect URI. Random `*.vercel.app` preview URLs cannot be
  registered.
- Local: `https://localhost:3000/api/providers/yahoo/callback`, run with
  `npm run dev:https` (Part 7.1). Plain `http://localhost` is refused by
  the form.
- All three go in the app's Redirect URI(s) field. If the field takes one
  value only, register production first and add the others by editing
  the app; record which it was.

### B.6 Environment variables

Four names, set in Vercel for Production and Preview and in `.env.local`
for local work, never committed:

```
YAHOO_CLIENT_ID
YAHOO_CLIENT_SECRET
YAHOO_REDIRECT_URI
YAHOO_APP_NAME
```

`YAHOO_APP_NAME` is the registered application name, sent as the
User-Agent so Yahoo's monitoring can identify the app (Part 7.3 adds it to
`yahooGet`). `.env.local.example` gains the four names with empty values
(LP-T062).

### B.7 Test leagues

Create three free Yahoo Fantasy Football leagues from the chosen account
(League, Create a league, Custom): a 12-team PPR with a W/R/T flex; one
with a Q/W/R/T slot and a TE reception bonus; one with DL, LB and DB
slots. Set each to public if the option is offered, so the visibility
branch is exercised too. Invite a second account you control as the
other manager; the rest can be autopick teams. Draft them by autopick.
These leagues are what the spike (LP-T060) reads, and they are the
"personal or single league use" the application says we are NOT limited
to, so name them as test leagues in the application's notes field.

### B.8 Brand assets and permission

1. Download the Sign in with Yahoo button kit from
   `https://developer.yahoo.com/sign-in-with-yahoo/` and the Yahoo Fantasy
   logo from the URL in Part 2.1. Do not restyle either.
2. After LP-T088 produces screenshots of the connect button beside the
   Google and Discord buttons and of the attribution line under a league
   page, submit `https://ipr.yahoo.com/permission` with those screenshots.
   Yahoo says ten business days. The attribution text is live before
   approval (it is required by the API terms); the button art waits for
   the permission reply only if the reply asks for a change.

### B.9 Launch day, in order

1. Connect the owner's own Yahoo account on `/my-beacon/connections`.
2. Run the admin test read on `/admin/providers`. Must be green.
3. Set the owner's connection as the registry's system connection.
4. Run the Yahoo player universe sync; drive unmatched-and-rostered to
   zero on the three test leagues (LP-T081).
5. Flip `is_active`. The public capabilities page shows the Yahoo column.

---

## Appendix C. The other hosts, and what each would need

Surveyed 2026-09-09 so the abstraction in Part 4 is checked against real
hosts rather than imagined ones. Every fact carries its source in the
revision 2 source list above; UNVERIFIED means no primary page could be
read. Nothing here is scheduled; it is the proof that Part 4.8's contract
holds, and the order a future phase would take.

| Host | Official API | auth_kind | Can look up someone else's leagues | Public leagues without a credential | Writes | Cross-reference id | Terms that matter |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sleeper | yes, documented | public_handle | yes | yes | no | sleeper_id (ours) | none published |
| Yahoo | yes, documented, by application | oauth2 | no | no (a user token is still needed) | no (2025 onward) | yahoo_id | 24-hour retention clause, attribution, income clause |
| Fleaflicker | yes, public since 2019 | public_handle (email or numeric user id) | yes, by email or id | yes | no (documented) | fleaflicker_id | none published; ffscrapr suggests under 1,000 calls per minute |
| MFL | yes, documented, registered clients | credentials (username and password) or api_key (per user, franchise and league) | no; harvesting is forbidden by the terms | yes for the public subset (league, rules, rosters, live scoring, players); results, transactions, drafts and picks are owners-only | YES (lineup, waivers, IR, taxi, trade proposals) | mfl_id | one second between requests, 429 on throttle, registered User-Agent by SMS validation, no harvesting, raw NFL stats withheld |
| Fantrax | partial (an external API keyed by a per-user Secret ID; the fuller data is internal) | api_key (Secret ID) for the external API; session_cookie for the internal one | no | yes for leagues set public | no | none in the public cross-references | terms page returned 403; UNVERIFIED |
| ESPN | no (undocumented reads endpoint) | session_cookie (`espn_s2` and `SWID`, copied by hand) | no public lookup found | yes for leagues set public | no | espn_id | Disney Terms of Use forbid automated access, data mining and scraping; a 2025-08-01 change restricted historical data |
| NFL.com | no league API found | credentials or session_cookie (UNVERIFIED which) | no | UNVERIFIED | UNVERIFIED | nfl_id | none found |
| CBS | deprecated but reachable, per-league token | credentials (user, password, league name) | no | no | UNVERIFIED | cbs_id | docs host unreachable; UNVERIFIED |
| Underdog | no; a daily exposure CSV | none (file upload) | no | no | n/a | none | terms forbid any non-browser access |

What each would cost against Part 4.8, and the order a future phase would
take them:

1. Fleaflicker first. It is the one host that behaves like Sleeper:
   public, keyless, another person's leagues by email or id, taxi and
   injured groups on the roster, future picks with a traded flag, box
   scores with per-player points, transactions and trades as separate
   resources. `auth_kind = 'public_handle'` fits as it stands (the
   "handle" is an email or an id; `resolveHandle` accepts both). No
   connection table involvement, no retention question, no attribution
   rule found. It exercises the provider contract with almost no new
   infrastructure, which is exactly what a second walk through Part 4.8
   should do. Capability record: everything Sleeper has except
   `liveDraft`, `draftAutopickers` and the write keys; `dynastyType`,
   `bestBall` and `keeperFlag` are UNVERIFIED and start as false.
2. MFL second. The richest data of any host, including everything the
   Manager Ledger and the pick valuation want, and the only host that
   documents writes, so it is also where Beacon Link could work with a
   licence to point at. It needs `auth_kind = 'credentials'` (a username
   and password exchanged for an `MFL_USER_ID` cookie that we hold as a
   secret exactly as a Yahoo refresh token, in Vault, under
   `provider_connections`) or `'api_key'` for the read-only export path,
   a registered User-Agent validated by SMS (the owner's step), a
   one-second spacing rule (a budget of 60 per minute, which
   `lib/providers/budget.ts` already expresses), and a `rolling` reading
   of "harvesting": we read only the connected reader's leagues, as with
   Yahoo. Public leagues are readable without a credential for the
   subset listed, so `publicData` becomes per-resource rather than a
   single boolean; that is the one change to `ProviderCapabilities` a
   future phase would make, and it is additive.
3. Fantrax third, external API only, `auth_kind = 'api_key'`: the reader
   pastes the Secret ID from their profile page. The internal API and
   its Selenium login are not something this site will run.
4. ESPN and NFL.com: NOT as providers under this design. ESPN's terms
   forbid the only access method that exists, the cookies are the
   reader's whole ESPN session (far more than a scoped token), and the
   endpoint changes without notice. `'session_cookie'` is admitted by the
   registry constraint so the question is recorded, and the answer today
   is no. If ESPN ever publishes an API with a licence, it re-enters the
   list at step 1's cost.
5. CBS and Underdog: not worth the contract. CBS's API is deprecated and
   per-league; Underdog's terms forbid it and best ball has no lineups or
   matchups for most of the site to read.

Three consequences for the current build:

- `auth_kind` admits five values from migration 0279 (Part 4.2) so no
  later phase alters the registry.
- `provider_connections` is designed for any secret, not only OAuth
  tokens: `access_secret_id` and `refresh_secret_id` hold "the credential
  we present" and "the credential we renew with", which for MFL are the
  session cookie and the password (or nothing, if the reader re-enters
  it), and for Fantrax the Secret ID and nothing. `scopes` is `{}` for
  them. No column is Yahoo-shaped.
- The DynastyProcess cross-reference (Part 6.1 step 3) already carries
  `mfl_id`, `fleaflicker_id`, `espn_id`, `cbs_id` and `nfl_id`, so the
  identity resolver gains a seed for Fleaflicker and MFL with no new
  source; Fantrax would start from name matching alone, which Part 6.1
  step 5 and the review queue already handle.

Writing check: this document was reread against the AI-pattern list in
the global instructions after both revisions. In revision 1 two "not just
X, Y" constructions were rewritten as plain statements (Part 4.1 and Part
6.4) and one trailing participle was cut from Part 7.8. In revision 2 the
new sections (4.8, 4.9, 10.10, Appendices B and C, the 2.1 addendum) were
reread against the same list and nothing on it was found; a grep of the
folder for em-dashes, en-dashes, curly quotes and ellipsis characters
returned no matches. No emoji are used. Headings
and tables are used because the docs folder's existing plans use them
and a spec is navigated by heading.
