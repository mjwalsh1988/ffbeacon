# FF Beacon — Granular Plan v4 (Final)


---


## 1. Founder Story Foundation


Background:
- 20 years playing fantasy football (started 2006)
- 3 years playing dynasty (started 2023)
- Year 1: 1 dynasty league
- Year 2: 50 dynasty leagues simultaneously
- Approach: heavy reliance on stats, underlying metrics, advanced analytics, and analyst tape breakdowns


Why FF Beacon exists:
- Massive gap in fantasy football accessibility
- Casual players don't understand analytics or how to use them
- Almost no fantasy sites/tools designed with accessibility as a core principle
- FF Beacon = the first fantasy resource built accessibility-first for everyone


Unique perspective:
- Blind fantasy player who relies on stats over visuals
- Every fantasy app available has accessibility friction
- Listens to audio broadcasts, analyst breakdowns, and uses advanced metrics as the primary evaluation framework


Persona:
- Real name and photo on the site
- Personal, accessible, conversational
- Reader = friend, not user
- Marketing + dev background woven in where relevant
- NO mention of JW Agency
- NO connection to Dynasty Pricecheck


Signature credibility hook:
"From 1 dynasty league to 50 in a single year — by learning how to actually use the data."


---


## 2. Brand Identity


Domain:        FFBeacon.com
Full name:     FF Beacon
Tagline:       "Your signal through the fantasy noise."
Voice:         Direct, conversational, no fluff, no em-dashes, friendly but analytical. Reader = friend.
Persona:       Michael, founder. Real photo, real name, real story.


### Visual System


Mode:
- Dark mode default
- Light mode available via toggle (header, top right)
- Theme preference stored per user (Supabase) and in localStorage for anonymous visitors
- System preference respected on first visit


Color palette (dark mode):
- Base background:    #07070D   (near-black with subtle purple tint)
- Surface:            #0F0F1A   (cards, panels)
- Surface elevated:   #16162A   (modals, dropdowns)
- Border:             #1F1F33   (subtle, low contrast)
- Border accent:      #2A2A47   (hover states)
- Text primary:       #F4F4F8
- Text secondary:     #A8A8B8
- Text muted:         #6B6B7D
- Brand purple:       #A855F7   (vibrant, primary accent)
- Brand purple deep:  #7C3AED
- Brand cyan:         #22D3EE   (vibrant, secondary accent)
- Brand cyan deep:    #06B6D4
- Success:            #10B981
- Warning:            #F59E0B
- Danger:             #EF4444


Gradient usage (sparingly, for impact):
- Beacon gradient: linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)
- Used on:
  - Hero "FF Beacon" wordmark
  - Primary CTA buttons
  - Trending/rising player indicators
  - Active format toggle
  - Tier dividers in rankings (top tier only)
  - Logo / beacon icon
  - Stats that exceed thresholds (breakout %, target share peaks)


Color discipline rules:
- Purple = primary action, brand moments, "buy" signals
- Cyan = secondary action, info, neutral highlights
- Gradient = ONLY for hero elements and critical CTAs
- Most of the UI = base, surface, text colors
- Vibrant colors must EARN their use


Typography:
- Primary:    'Geist Sans' — modern, clean, Vercel-built, free
- Mono:       'Geist Mono' — for stats, code, numbers
- Fallback:   system-ui, -apple-system, sans-serif
- Why: Geist is purpose-built for tech/dev sites, has the modern feel you described, and matches the aesthetic of sites like Claude, Linear, Vercel. Free via next/font.


Other visual rules:
- Generous whitespace
- Subtle borders, never heavy
- Rounded corners: 8px standard, 12px on cards, 16px on modals
- Soft shadows only in light mode
- Animations under 200ms, ease-out curves
- No drop shadows in dark mode (use border + glow instead)
- Hover states use subtle purple glow on interactive elements


---


## 3. Audience & Positioning


Primary: Casual-to-intermediate redraft players who want to understand the analytics
Secondary: Best ball players (growing fast, high engagement)
Tertiary: Dynasty players (basics covered, deep dynasty users funnel elsewhere)
Special audience: Fantasy players with accessibility needs — genuinely underserved niche FF Beacon will own
Not targeting: DFS players


---


## 4. Revenue Model


Phase 1 — Months 1-3:
- No revenue. Build content, get indexed, hit AdSense threshold.


Phase 2 — Months 4-12:
- Google AdSense activated
- Donation button (Buy Me a Coffee — accessible widget)
- Estimated: $50-300/month seasonal


Phase 3 — Year 2+:
- Premium tier launches (Stripe)
- Candidate features:
  - Ad-free experience
  - Lineup optimizer (saved for v2 launch)
  - Multi-league Sleeper sync
  - Trade analyzer with stash recommendations
  - Weekly email digest
  - Player news push notifications
- Pricing: $5-9/month or $40-60/year
- Estimated: $200-1000/month combined


---


## 5. Content Architecture


### Layer A: Player Pages (~1,500 pages)
- URL: /players/[player-slug]
- Generated: Initially in batch, then on data change
- Refresh: Weekly minimum, on news event immediately


### Layer B: Start X or Y Vote Pages
- URL: /vs/[player1-slug]-vs-[player2-slug]
- Generated: On-demand from popular matchups
- Refresh: Vote counts live, AI analysis weekly
- Login: Required to vote (Google/Discord)
- Volume: Top 200 players × top matchups = ~2,000 pages


### Layer C: Weekly Content (seasonal)
URLs:
- /waivers/week-[N]
- /start-sit/week-[N]
- /sleepers/week-[N]
- /sit-em/week-[N]
- /matchups/week-[N]


### Layer D: Evergreen Guides + Accessibility Hub
URL: /guides/[topic-slug]
Examples:
- /guides/fantasy-analytics-101  (signature explainer)
- /guides/understanding-target-share
- /guides/yards-per-route-run-explained
- /guides/best-ball-strategy
- /guides/superflex-vs-standard


Accessibility sub-hub (the moat):
- /guides/accessible-fantasy-football
- /guides/best-fantasy-apps-screen-reader
- /guides/playing-fantasy-with-a-screen-reader


---


## 6. Tools (Phase 1)


### Tool 1: Sleeper League Pulse + Personal Dashboard
Path: /tools/league-pulse  +  /dashboard (logged in)


Anonymous flow:
- Input Sleeper username
- Fetch leagues + rosters live
- View results, no save


Logged-in flow:
- Save Sleeper username to user_preferences
- /dashboard shows all leagues automatically on visit
- One-click refresh
- Persistent across sessions
- Default landing page for logged-in users (configurable)


### Tool 2: Player Rankings Board
- Path: /rankings
- Function: Sortable, filterable rankings table
- Filters: Format, scoring type, position, tier, roster format
- SEO value: HIGHEST — owns "fantasy football rankings" long-tail


### Tool 3: Waiver Wire Bid Calculator
- Path: /tools/faab
- Function: Recommend FAAB bid amounts
- Inputs: Player name, league budget, team needs
- Output: Recommended bid range with reasoning


Skipped for v1 (built into DB for v2): Lineup Optimizer, Trade Analyzer, Mock Draft


---


## 7. Authentication & User System


Provider: Supabase Auth
Methods:
- Google OAuth
- Discord OAuth
- Email magic link (fallback)


Required for:
- Voting on Start X or Y pages
- Saving Sleeper username + dashboard
- Saving favorite players
- Theme preference persistence
- Premium features (later)


---


## 8. Database Design


### Core principle
- ONE player record per real-world player
- ALL external IDs in a single jsonb column (sleeper, ktc, espn, etc.)
- Format/scoring settings are explicit configs
- All ranking/value data references a config (never inline)
- Sleeper raw object preserved verbatim for future use
- Our own metadata layer separate from external data
- Stats sourced from Sleeper API (already proven in DPC)


### Players table


```sql
create table players (
  -- Our identifiers
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  
  -- External IDs (jsonb for flexibility + indexed for speed)
  external_ids jsonb default '{}',
  -- Structure:
  -- { 
  --   "sleeper": "4017",
  --   "ktc": 5678,
  --   "espn": "16800",
  --   "nfl": "abc123",
  --   "yahoo": "..."
  -- }
  
  -- Core attributes
  first_name text not null,
  last_name text not null,
  full_name text generated always as (first_name || ' ' || last_name) stored,
  position text not null,
  team text,
  status text default 'active',  -- active, ir, suspended, retired, inactive
  
  -- Bio
  birth_date date,
  age integer generated always as (
    extract(year from age(birth_date))::integer
  ) stored,
  height_inches integer,
  weight_lbs integer,
  college text,
  draft_year integer,
  draft_round integer,
  draft_pick integer,
  years_experience integer,
  
  -- Our editorial layer (we control, no sync overwrites)
  our_metadata jsonb default '{}',
  -- Examples:
  -- { 
  --   "playstyle_tags": ["red_zone_threat", "deep_threat"],
  --   "injury_history": [...],
  --   "editorial_notes": "...",
  --   "breakout_year": 2023
  -- }
  
  -- Raw external objects preserved verbatim
  sleeper_raw jsonb,   -- Full Sleeper player object
  ktc_raw jsonb,       -- Full KTC payload when integrated
  
  -- Sync tracking
  last_sleeper_sync timestamptz,
  last_ktc_sync timestamptz,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- Indexes for fast lookups
create index idx_players_position on players(position);
create index idx_players_team on players(team);
create index idx_players_status on players(status);
create index idx_players_slug on players(slug);


-- Fast external ID lookups (extract from jsonb)
create unique index idx_players_sleeper_id 
  on players ((external_ids->>'sleeper')) 
  where external_ids ? 'sleeper';


create unique index idx_players_ktc_id 
  on players ((external_ids->>'ktc')) 
  where external_ids ? 'ktc';


-- GIN index for general jsonb querying
create index idx_players_external_ids_gin 
  on players using gin (external_ids);
```


### Format configurations


```sql
create table format_configs (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  display_name text not null,
  
  league_type text not null,           -- 'redraft' | 'dynasty' | 'keeper'
  scoring_type text not null,           -- 'standard' | 'half_ppr' | 'ppr'
  te_premium_bonus numeric default 0,   -- 0, 0.5, 1.0
  is_superflex boolean default false,
  
  is_default boolean default false,
  display_order integer,
  is_active boolean default true,
  
  created_at timestamptz default now()
);


insert into format_configs 
  (slug, display_name, league_type, scoring_type, te_premium_bonus, is_superflex, is_default, display_order)
values
  ('redraft-ppr-std',       'Redraft PPR',           'redraft', 'ppr',       0,   false, true,  1),
  ('redraft-half-std',      'Redraft Half PPR',      'redraft', 'half_ppr',  0,   false, false, 2),
  ('redraft-std-std',       'Redraft Standard',      'redraft', 'standard',  0,   false, false, 3),
  ('redraft-ppr-sflex',     'Redraft PPR Superflex', 'redraft', 'ppr',       0,   true,  false, 4),
  ('redraft-ppr-tep',       'Redraft PPR TEP',       'redraft', 'ppr',       0.5, false, false, 5),
  ('dynasty-ppr-std',       'Dynasty PPR',           'dynasty', 'ppr',       0,   false, false, 6),
  ('dynasty-ppr-sflex',     'Dynasty PPR Superflex', 'dynasty', 'ppr',       0,   true,  false, 7),
  ('dynasty-ppr-tep-sflex', 'Dynasty Superflex TEP', 'dynasty', 'ppr',       0.5, true,  false, 8);
```


### Rankings, trade values, projections (same pattern)


```sql
create table rankings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  format_config_id uuid not null references format_configs(id),
  
  overall_rank integer not null,
  position_rank integer not null,
  tier integer,
  
  source text not null,                -- 'ffbeacon' | 'ktc' | 'expert_consensus'
  week integer,                         -- null = full season ranking
  season integer not null,
  
  confidence text,
  trend text,
  notes text,
  
  generated_at timestamptz default now(),
  
  unique(player_id, format_config_id, source, week, season)
);


create index idx_rankings_format on rankings(format_config_id);
create index idx_rankings_player on rankings(player_id);
create index idx_rankings_week on rankings(season, week);


create table trade_values (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  format_config_id uuid not null references format_configs(id),
  
  value numeric not null,
  normalized_value numeric,
  
  change_7d numeric,
  change_30d numeric,
  change_90d numeric,
  
  signal text,                          -- 'buy' | 'sell' | 'hold'
  bollinger_position numeric,
  
  source text not null,                 -- 'ktc' | 'fantasycalc' | 'ffbeacon'
  captured_at timestamptz default now(),
  
  unique(player_id, format_config_id, source, captured_at)
);


create index idx_values_format on trade_values(format_config_id);
create index idx_values_player_captured on trade_values(player_id, captured_at desc);


create table projections (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  format_config_id uuid not null references format_configs(id),
  
  week integer not null,
  season integer not null,
  
  projected_points numeric not null,
  floor_points numeric,
  ceiling_points numeric,
  start_sit_verdict text,               -- 'start' | 'sit' | 'flex' | 'borderline'
  confidence text,
  
  reasoning text,
  
  generated_at timestamptz default now(),
  
  unique(player_id, format_config_id, week, season)
);


create index idx_projections_week on projections(season, week, format_config_id);
```


### Player stats (Sleeper-sourced, scalable)


```sql
create table player_stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  
  week integer not null,
  season integer not null,
  season_type text default 'regular',   -- 'regular' | 'post' | 'pre'
  
  -- FULL Sleeper stats object (source of truth, future-proof)
  sleeper_stats jsonb,
  
  -- Common stats extracted for fast querying + scoring math
  pass_yd integer default 0,
  pass_td integer default 0,
  pass_int integer default 0,
  pass_2pt integer default 0,
  
  rush_yd integer default 0,
  rush_td integer default 0,
  rush_2pt integer default 0,
  
  rec integer default 0,
  rec_yd integer default 0,
  rec_td integer default 0,
  rec_2pt integer default 0,
  
  fum_lost integer default 0,
  
  -- Sleeper-provided fantasy points (pre-calculated, trustworthy)
  pts_standard numeric default 0,
  pts_half_ppr numeric default 0,
  pts_ppr numeric default 0,
  
  -- Usage / advanced
  snap_count integer,
  snap_pct numeric,
  targets integer,
  carries integer,
  air_yards numeric,
  target_share numeric,
  
  -- Game context
  opponent text,
  game_id text,
  
  ingested_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(player_id, week, season, season_type)
);


create index idx_stats_player_season on player_stats(player_id, season);
create index idx_stats_week on player_stats(season, week);
create index idx_stats_season_type on player_stats(season, season_type);
```


### Scoring helper: TE Premium & custom formats


TE Premium is computed at query time from raw stats:
- pts_ppr_tep_0.5 = pts_ppr + (rec * 0.5)  [for TE only]
- pts_ppr_tep_1.0 = pts_ppr + (rec * 1.0)  [for TE only]


Any future custom scoring can be calculated on the fly from:
- sleeper_stats jsonb (full raw object)
- extracted column values
- format_configs settings


### Content tables


```sql
create table articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  meta_description text,
  
  article_type text not null,           -- 'waiver' | 'start_sit' | 'sleeper' | 'guide' | 'player_outlook'
  format_config_id uuid references format_configs(id),
  
  tl_dr text,
  content_md text,
  
  week integer,
  season integer,
  author_id uuid references auth.users(id),
  
  schema_jsonld jsonb,
  canonical_url text,
  
  view_count integer default 0,
  
  status text default 'draft',          -- 'draft' | 'published' | 'archived'
  published_at timestamptz,
  last_updated timestamptz default now(),
  
  created_at timestamptz default now()
);


create table article_players (
  article_id uuid references articles(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  primary key (article_id, player_id)
);


create table vote_matchups (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  player_a_id uuid not null references players(id),
  player_b_id uuid not null references players(id),
  format_config_id uuid not null references format_configs(id),
  week integer,
  season integer not null,
  
  votes_a integer default 0,
  votes_b integer default 0,
  
  analysis_md text,
  analysis_generated_at timestamptz,
  
  is_active boolean default true,
  created_at timestamptz default now()
);


create table votes (
  id uuid primary key default gen_random_uuid(),
  matchup_id uuid not null references vote_matchups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chose text not null,                  -- 'a' | 'b'
  voted_at timestamptz default now(),
  
  unique(matchup_id, user_id)
);


create table news_items (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id),
  headline text not null,
  body text,
  source_url text,
  source_name text,
  impact_score integer,
  ai_summary text,
  published_at timestamptz,
  ingested_at timestamptz default now()
);


create table user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_format_config_id uuid references format_configs(id),
  sleeper_username text,                -- saved for dashboard
  theme text default 'dark',            -- 'dark' | 'light' | 'system'
  email_digest_enabled boolean default false,
  favorite_players jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```


### Why this design works


1. Players are players. One row per person.
2. external_ids jsonb = flexible, future-proof, indexed for speed.
3. format_configs is the SOURCE OF TRUTH for unique league setups.
4. Rankings, values, projections all follow the SAME PATTERN.
5. Stats are RAW from Sleeper, extracted for speed, jsonb preserved.
6. our_metadata is your editorial layer — no sync overwrites it.
7. Schema accommodates v2 features (lineup optimizer, trade analyzer) without restructuring.


---


## 9. Format/Scoring Toggle UX


- Location: Persistent header dropdown, top right
- Mobile: Bottom of mobile menu drawer
- Default: Redraft PPR
- Logged in: Saved default loads automatically
- Logged out: localStorage remembers last selection


When user switches format:
- All rankings re-fetch with new format_config_id
- All player page values update
- URL appends ?format=dynasty-ppr-sflex for shareability


---


## 10. Theme Toggle UX


- Location: Header, next to format toggle
- Mobile: Top of mobile menu drawer
- Default: Dark
- Options: Dark | Light | System
- Persistence: Supabase if logged in, localStorage if not


---


## 11. Data Ingestion Schedule


DAILY (5am ET):
- Sleeper player metadata sync (full player object refresh)
- News RSS ingestion
- KTC value refresh (for all 8 format_configs)


TUESDAY 6am ET (post Monday Night):
- Sleeper stats API: pull previous week stats for all players
- Trigger player page regeneration for stat-changed players
- Generate waiver wire article


THURSDAY 6am ET:
- Refresh projections for upcoming week
- Generate start/sit and sleepers articles
- Update injury report


SUNDAY 11am ET:
- Process inactives
- Final lineup verdict updates


---


## 12. Content Generation Pipeline


Step 1: Data assembly
- Pull player record, stats, news, projections, values
- Pull comparable players for context


Step 2: Template selection
- Rotate between 5+ content frameworks
- Variable opening structures
- Different analytical angles


Step 3: Claude generation
- Structured prompt with all data
- JSON output (tl_dr, body, faq)
- Banned phrases enforced (no em-dashes, no AI tells)
- Voice tuned to Michael's persona


Step 4: Validation
- Retired/inactive player checks
- Fact-check stats against database
- AI tell detection


Step 5: Enrichment
- Schema markup injection
- Internal linking to related players
- Author byline (Michael)
- FAQ schema


Step 6: Publication
- Insert into articles table
- Ping IndexNow
- Update sitemap


---


## 13. SEO/AEO Checklist


Per-page:
- Unique H1 matching primary keyword
- TL;DR box (60 words max) directly answering query
- Last-updated timestamp visible
- Author byline → /author/michael
- Single canonical URL
- Meta description (155 chars)
- OpenGraph + Twitter card tags
- Schema markup (Article + secondary)
- Internal links to 3+ related pages
- Breadcrumb navigation with schema
- Mobile-optimized images with alt text


Site-wide:
- XML sitemap (segmented by type)
- robots.txt
- IndexNow integration
- Search Console verified
- Analytics installed (GA4 + Plausible)
- Core Web Vitals targets met
- Accessibility audit (100 Lighthouse)
- Person schema on /author/michael


---


## 14. Frontend Architecture


- Framework: Next.js 15 App Router
- Styling: Tailwind CSS, mobile-first, custom theme tokens
- Components: shadcn/ui (accessible by default, themed to brand)
- Forms: React Hook Form + Zod
- State: Zustand for client state, URL params for filters
- Auth: Supabase Auth helpers for Next.js
- Database: Supabase client (publishable key client, secret key server only)
- Images: next/image with Cloudflare loader
- Fonts: next/font loading Geist Sans + Geist Mono
- Theme: next-themes for dark/light toggle


Rendering strategy:
- Static (SSG) for evergreen guides and rankings landing
- ISR for player pages (revalidate: 3600)
- SSR for tools requiring fresh data
- Client-side for interactive filters


---


## 15. Performance Targets


- Lighthouse Performance:   95+
- Lighthouse Accessibility: 100   (non-negotiable)
- Lighthouse SEO:           100
- LCP (3G mobile):          under 2.5s
- INP:                      under 200ms
- CLS:                      under 0.1
- Total above-fold weight:  under 500KB


---


## 16. About + Author Page (Story Integration)


/about — site mission
- Why FF Beacon exists
- The accessibility gap in fantasy
- Analytics for everyone, not just hardcore players
- Michael's photo + brief intro
- Link to /author/michael for full bio


/author/michael — full founder bio
- Photo
- 20 years playing fantasy
- 1 dynasty league to 50 in a single year
- How being blind shaped his analytics-first approach
- Marketing + dev background
- Why accessibility matters in fantasy
- Social links
- Person schema markup


Every article byline:
"By Michael — [link to /author/michael]"


Every player page footer:
"Built and maintained by Michael at FF Beacon"


---


## 17. Launch Timeline


Days 1-7:   Foundation
- Next.js scaffold with Geist fonts + theme system
- Supabase setup + schema migration
- Auth integration (Google + Discord)
- Layout, navigation, dark/light toggle, format toggle
- About + Author pages with story


Days 8-21:  Data pipeline
- Sleeper player sync (using DPC pipeline)
- Sleeper stats import
- KTC integration (port from DPC)
- Player database populated
- Initial rankings generated
- Stats backfill (last 2 seasons)


Days 22-35: Core tools
- Rankings board
- Sleeper league pulse + dashboard
- Waiver wire calculator


Days 36-50: Player pages
- Player page template
- Programmatic generation
- First 200 pages indexed and verified


Days 51-65: Vote matchups + weekly content
- Vote system live
- First waiver article generated
- Start/sit pages
- Content cadence established


Days 66-80: Polish + SEO
- Schema audit
- Performance optimization
- Search Console submission
- Internal linking audit


Days 81-90: AdSense prep + soft launch
- 90 days of content live
- Apply for AdSense
- Add donation button (Buy Me a Coffee)


---

## Source registry (added 2026-05-17)

Header now exposes a registry-driven **Source:** dropdown next to the
**Format:** dropdown. Schema and behavior live in:

- `supabase/migrations/0010_source_registry.sql` — `source_registry` table
  (`slug` PK, `display_name`, `description`, `priority`, `is_active`,
  `data_type text[]`) with public SELECT RLS, service-role-only writes, and a
  new nullable `user_preferences.default_source_slug` FK column.
- `lib/source.ts` — `readSourceSlug`, `getAvailableSources`,
  `resolveSourceForFormat`, `describeSource`.
- `components/source-toggle.tsx` — UI mirrors `FormatToggle`, hides itself
  when only one source is active, announces selections via `aria-live`.
- `app/actions/preferences.ts` — `saveSourcePreference` server action
  upserts `user_preferences.default_source_slug` for the signed-in user
  after validating the slug against the registry.
- `docs/data-sources.md` — taxonomy, fallback rules, "how to add a source",
  and the never-display-attribution rule (which the dropdown
  intentionally exempts — *display_name* is the only user-visible source
  reference).

Adding a new source is now data-only: `INSERT INTO source_registry …` and
backfill `rankings`/`trade_values` with the new slug. The dropdown picks it
up automatically. No code changes required.

---

## Source/format gating + KTC cleanup (added 2026-05-17)

Built on top of the source registry. Two new gating behaviors plus a data
cleanup. Live state:

- `source_registry.supported_format_slugs text[]` — `NULL` means the source
  supports every active format; an explicit array restricts it. Migration
  `supabase/migrations/0011_source_registry_supported_formats_and_ktc_cleanup.sql`
  adds the column.
- Migration 0011 also **deleted** the duplicate KTC data the original sync
  script wrote when KTC's redraft scoring/TEP query params turned out to be
  client-side JavaScript filters rather than server variants:
  - 948 `trade_values` rows (`redraft-half-std`, `redraft-std-std`,
    `redraft-ppr-tep` for `source='ktc'`)
  - 897 `rankings` rows for the same three formats.
  KTC is now pinned to the 5 formats it genuinely publishes:
  `dynasty-ppr-std`, `dynasty-ppr-sflex`, `dynasty-ppr-tep-sflex`,
  `redraft-ppr-std`, `redraft-ppr-sflex`. All 8 `format_configs` remain
  active for future sources to populate.
- `components/format-toggle.tsx` accepts `supportedFormatSlugs` and filters
  its option list to that array (null = show all).
- `components/source-toggle.tsx` accepts `currentFormatSlug` + `allFormats`
  and (a) filters its source list to sources that support the current
  format and (b) when the user picks a source that doesn't support the
  current format, calls `pickFallbackFormat()` to swap to the source's
  best-matching format and persists the swap to cookie/DB.
- `lib/format-fallback.ts` — `pickFallbackFormat()`: picks a substitute
  format using the chain `league_type → scoring_type → is_superflex →
  display_order`.
- `lib/source.ts` — `reconcileFormatWithSource()`: pages call this after
  resolving `(source, format)` so URL-driven mismatches (shareable links
  with a stale `?format=…`) fall through to a supported format with a
  one-line banner. URL is transient → reconcile does NOT touch cookie or
  DB.
- `scripts/sync-ktc.ts` — hardened: hard-coded
  `ALLOWED_KTC_FORMAT_SLUGS` allow list; refuses to write rows for any
  format not on the list; pairwise byte-for-byte `MUST_DIFFER_PAIRS` sanity
  check that throws if two datasets that should differ come back
  identical. Header comment documents why the redraft scoring/TEP params
  don't work.

---

## Future: User Custom Scoring Formats

Logged-in users will be able to define **custom scoring rules** and have
their entire experience (rankings, trade values, projections) recompute
against those rules. This is the long-term differentiator vs. competitors
who only support the canonical PPR/Half/Std/TEP grid.

Constraints when this ships:
- Custom formats only work with `source='ffbeacon'` (FF Beacon's native
  rankings pipeline, not yet built). External sources like KTC don't
  expose their underlying weights, so we can't recompute their values
  against arbitrary scoring rules.
- The Source dropdown becomes **locked to FF Beacon** whenever a custom
  format is selected. The Format dropdown surfaces a new **"My Leagues"**
  group above the canonical format list for logged-in users.
- Premium feature candidate (gated behind subscription tier yet to be
  defined).

Database additions needed when implemented:
- `user_custom_formats` table — `(id, user_id, name, scoring_rules jsonb,
  created_at, updated_at)`. `scoring_rules` mirrors the structure
  `player_stats` exposes (per-yard, per-TD, PPR weight, TE bonus, etc.).
- Optional `user_custom_rankings` cache table to avoid recomputing
  rankings on every page load — `(user_id, custom_format_id, player_id,
  overall_rank, position_rank, value, generated_at)`.
- Rankings calculated on-the-fly from raw `player_stats` using the user's
  `scoring_rules`. The cache table is invalidated whenever
  `scoring_rules` changes or new `player_stats` arrive for the season.

UI integration when implemented:
- Format dropdown surfaces a `My Leagues` group above the canonical
  formats, listing each `user_custom_formats` row by `name`.
- Selecting a custom format forces `source` to `'ffbeacon'` and disables
  the Source dropdown (with an `aria-describedby` explaining why).
- A `Manage formats…` link in the dropdown opens a settings page where
  users can add/edit/delete custom formats.

Real differentiator: every other fantasy site forces the user to map
their league into one of N canonical formats. FF Beacon would let users
keep their actual league rules and see numbers that match the league
they're playing in. Strong fit with the accessibility mission too —
fewer cognitive translation steps between "my league" and "what the
site is telling me".
- Soft launch to Michael's audience