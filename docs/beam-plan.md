# BEAM V1 implementation plan

BEAM: Beacon Engine for Answers and Metrics. An "Ask BEAM" natural-language
helper backed by FF Beacon's own data and tools. V1 uses no LLM.

Status: PLAN ONLY. Nothing in this document has been implemented.

## 0. What was inspected

`lib/` (all 140+ modules, deep on `beacon-breakdown.ts`, `breakdown/*`,
`player-profile.ts`, `player-search.ts`, `guide/*`, `rate-limit-actor.ts`,
`sleeper.ts`, `site.ts`, `on-the-clock/rationale.ts`), every `app/api` route
group, `app/tools/*`, `components/signal-guide/*`, `app/admin/*`, and the live
Supabase schema (98 tables, indexes, extensions, row counts, format and source
registries).

---

## 1. What BEAM can reuse (do not rebuild)

**Player identity and search**

- `lib/player-search.ts:81` `searchFantasyPlayers()` and `:56`
  `fantasyRelevantPlayerIds()`. Ranked-membership relevance filter, 90-day
  window.
- `idx_players_full_name_trgm` already exists (GIN, `gin_trgm_ops`) and
  `pg_trgm` is installed. Fuzzy matching needs no new extension.
- `players.metadata.sleeper.search_full_name` is populated on 10,403 of 10,435
  rows (Sleeper's own normalized name). Useful, but it lives in jsonb, so it is
  not indexable cheaply as-is.
- `lib/player-profile.ts:195` `readSleeperId()`, `:203` `sleeperMeta()`.

**Stats**

- `player_stats`: 283,835 rows, 2020 through 2025, three `season_type` values,
  and roughly 90 real columns (not jsonb). Passing, rushing, receiving, red
  zone, air yards, snaps, kicking, team defense, plus denormalized `pts_ppr` /
  `pts_half_ppr` / `pts_std` (migration 0141). Indexes:
  `idx_stats_player_season`, `idx_stats_season_type`.
- `app/tools/beacon-breakdown/stats-data.ts:46` `COMPARE_STATS` already carries
  label, group, direction, and formatter for 24 stats. BEAM's registry should
  extend this shape, not fork it.
- `components/player-profile/stat-shaping.tsx:485` `aggregateSeasons()`, `:210`
  `statColumns()`.
- `player_positional_finishes` (48,615 rows): season finish, total points,
  players ranked, per scoring key.

**Values, ranks, market**

- `player_value_trends` (12,122 rows) keyed by (player, format, source), with
  7/30/90d change, volatility, rank change, and `show_trend_*` gates.
- `rankings` for overall rank, position rank, tier.
- `player_market_latest` view and `player_market_snapshots` for ADP.
- `draft_value_targets` (4,138 rows): market ADP vs Beacon pick, `steal_score`,
  `category`, and a written `verdict` string per player.
- `player_projection_accuracy`: beat rate, availability rate, ratio stdev.

**Comparison intelligence**

- `lib/beacon-breakdown.ts:302` `loadBreakdown()`, `:488` `assembleBreakdown()`,
  `lib/breakdown/load-extras.ts:458` `loadBreakdownExtras()`,
  `lib/breakdown/verdict.ts:198` `buildVerdict()` and `:62` `buildTakeaways()`.
- `lib/breakdown/types.ts:32` `LENSES` gives exactly the three question framings
  in the brief: `dynasty`, `win-now`, `this-week`.
- `app/api/og/breakdown/[a]/[b]/route.tsx:113-153` is the working precedent for
  calling that stack from a non-page context. BEAM copies this three-call
  sequence verbatim.

**Format and source**

- `lib/preferences.ts` `resolveFormatSlug()` / `resolveSourceSlug()`,
  `lib/source.ts` `resolveSourceForFormat()` / `describeSource()`,
  `lib/format-fallback.ts`.
- `lib/player-profile.ts:42` `scoringKeyForType()` maps a format's
  `scoring_type` to `pts_ppr` / `pts_half_ppr` / `pts_std`.

**Season clock**

- `lib/sleeper.ts:392` `getNflState()`, memoised 60s, returns `season`,
  `previous_season`, `week`, `season_type`.
- `lib/breakdown/load-extras.ts:101` `resolveSeasonClock()`.

**Glossary content**

- `guide_entries`: 79 published `term` rows (30 global) and 87 published
  `question` rows. A real, admin-curated knowledge base BEAM can answer
  definition questions from with no new content work.

**The feedback workflow already exists**

- `app/api/guide/submit/route.ts` is the complete pattern: same-origin check,
  honeypot `company` field, server validation mirroring DB CHECKs, hashed-IP
  rate limit, `after()` for non-blocking email, dual email via
  `lib/email/send.ts` and `lib/email/guide-emails.ts`.
- `guide_question_submissions` table,
  `app/admin/signal-guide/submissions/page.tsx`,
  `components/admin/guide-submissions-manager.tsx`.

**Abuse control**

- `try_claim_rate_limit(p_bucket, p_key, p_max_requests, p_window_seconds)` RPC
  (migration 0137), service-role only, backed by `rate_limit_hits`.
- `lib/rate-limit-actor.ts:45` `resolveRateLimitActorKey()` returns
  `user:<uid>` or `ip:<salted sha256>`.
- Sibling routes gate on `x-requested-with: ff-beacon`.

**UI shell**

- `components/signal-guide/guide-panel.tsx` is a finished accessible slide-in:
  portal, focus trap, Esc, scroll lock, `inert` off-screen panes, debounced
  `aria-live` result count, 44px targets, mobile-up / desktop-right.
- `components/signal-guide/signal-guide-mount.tsx` mounted once in
  `app/layout.tsx:61`.
- Single-row JSONB settings + admin editor pattern: `faab_calculator_settings`,
  `on_the_clock_settings`, `draft_value_settings`, each with code fallbacks in
  `lib/*/default-settings.ts`.

---

## 2. Recommended architecture

The whole design rests on one boundary.

```
raw text -> INTERPRETER -> BeamRequest -> CAPABILITY -> CapabilityResult -> PRESENTER -> BeamAnswer
            (swappable)    (contract)     (deterministic)                   (templates)
```

`BeamRequest` is the seam. The interpreter is the only component that ever sees
raw user text. Capabilities receive typed, validated parameters and resolved
player UUIDs. Presenters receive typed results and never see text either.

```ts
// lib/beam/types.ts
export type BeamRequest = {
  capability: CapabilityId;
  params: Record<string, unknown>;   // validated by the capability's zod schema
  confidence: number;                // 0..1
  evidence: BeamEvidence[];          // what matched, for the debug view and the log
};

export interface BeamInterpreter {
  readonly id: string;               // "deterministic-v1" | "llm-v1"
  interpret(text: string, ctx: BeamContext): Promise<BeamInterpretation>;
}

export type BeamInterpretation =
  | { kind: "request"; request: BeamRequest }
  | { kind: "clarify"; clarification: BeamClarification }
  | { kind: "unsupported"; reason: BeamUnsupportedReason };

export interface BeamCapability<P, R> {
  readonly id: CapabilityId;
  readonly schema: ZodType<P>;
  readonly label: string;            // admin + debug
  run(params: P, ctx: BeamContext): Promise<R>;
  present(result: R, params: P, ctx: BeamContext): BeamAnswer;
}

export type BeamContext = {
  supabase: ServerClient;
  admin: SupabaseClient<Database>;   // only for settings + logging
  formatSlug: string;
  formatConfigId: string | null;
  formatDisplay: string;
  scoringKey: ScoringKey;
  sourceSlug: string | null;
  sourceDisplay: string | null;
  clock: BeamSeasonClock;
  settings: BeamSettings;
};

export type BeamOutcome =
  | { kind: "answer"; answer: BeamAnswer; capability: CapabilityId; confidence: number }
  | { kind: "clarify"; clarification: BeamClarification }
  | { kind: "unsupported"; message: string; reason: BeamUnsupportedReason };
```

Everything under `lib/beam/capabilities/` is pure data access plus a presenter.
Nothing in there imports the interpreter. That is the property that lets an LLM
slot in later.

---

## 3. How the deterministic interpreter works

Six ordered stages, all pure and unit-testable, in `lib/beam/interpret/`.

**Stage 1: normalize** (`normalize.ts`)

Lowercase, NFKD-fold accents, strip possessives (`purdys` and `purdy's` both
become `purdy`), collapse punctuation to spaces, collapse whitespace, expand a
small contraction map. Preserve digits. Cap input at 300 characters before any
of this.

**Stage 2: tokenize and strip filler** (`tokens.ts`)

Produce tokens with original spans (spans matter for evidence and for
highlighting in the debug view). Mark stopwords rather than deleting them,
because "how many" and "who is better" are intent signals, not noise. A separate
`FILLER` set covers "please", "hey beam", "can you tell me", "i wanted to know".

**Stage 3: lexicon match** (`lexicon/`)

A single trie built once at module load from four vocabularies, matched
longest-first over the token stream so "passing yards" beats "yards" and
"half ppr" beats "ppr":

- `stats.ts`: phrasings per stat id. `pass_yd` gets `passing yards, pass yards,
  pass yds, passing yds, yards passing, yds through the air, throwing yards,
  air yards passing`, plus the verb forms `threw for, throw for, thrown for,
  toss for, tossed for`. Roughly 30 stats x 6 to 12 phrasings.
- `seasons.ts`: `2024`, `'24`, `last year`, `last season`, `this year`,
  `this season`, `rookie year`, `career`, `since 2022`.
- `positions.ts`, `teams.ts`: reuse `POSITIONS` from `lib/site.ts` and
  `nfl_teams` (32 rows, abbreviation plus name).
- `intents.ts`: comparators (`vs`, `versus`, `or`, `better`, `more`,
  `who should i`), question heads (`how many`, `what were`, `where does`, `is`),
  and lens words (`dynasty`, `keeper`, `rebuild` -> dynasty; `win now`,
  `contending`, `competitive`, `this year` -> win-now; `this week`, `start` ->
  this-week).

Verb-driven stat inference matters here. "how many yards did purdy throw for"
has no stat phrase; `throw for` plus bare `yards` resolves to `pass_yd`. Same
shape for `rush for` -> `rush_yd`, `catch/caught` -> `rec_yd` or `rec`.

**Stage 4: entity extraction** (`entities.ts`)

Everything the lexicon did not claim becomes candidate name spans. Adjacent
unclaimed tokens merge into spans of one to four tokens. Comparator tokens split
the span list into sides.

**Stage 5: intent scoring** (`score.ts`)

Every capability declares a `matcher` with required and optional slots and a
base weight. Scoring is additive and explicit, never a black box:

```
score = base
      + 0.30 if every required slot filled
      + 0.15 per optional slot filled
      + 0.10 if a question head matches the capability's expected heads
      - 0.20 per unconsumed content token (filler excluded)
      - 0.25 if two players present but the capability is single-player
```

Take the top candidate. Accept at `>= settings.thresholds.intentAccept`
(default 0.55) with a margin of `>= 0.12` over the runner-up. Below that, if the
top capability is single-player-stat and the only weak slot is the stat, ask a
stat clarification. Otherwise unsupported.

**Stage 6: resolution and validation** (`resolve.ts`)

Player spans go through the resolver (section 5). Season resolves against the
clock. The assembled params are parsed by the capability's zod schema. A parse
failure is an unsupported outcome, never a thrown 500.

Why this rather than a grammar or a classifier: the vocabulary is small and
closed (about 30 stats, 6 seasons, 6 positions, 32 teams, roughly 12 intents),
the failure mode you care about most is a wrong confident answer, and every
stage here can explain itself in the log. A statistical classifier trained on
nothing would do worse and could not tell you why.

---

## 4. Request lifecycle

```
POST /api/beam/ask  { question }
  1. same-origin + x-requested-with guard
  2. length cap 300, character sanitize
  3. try_claim_rate_limit("beam_ask", actorKey, 30, 60)
  4. build BeamContext
       resolveFormatSlug / resolveSourceSlug          (lib/preferences.ts)
       resolveSourceForFormat for value-bearing reads (lib/source.ts)
       resolveBeamClock()                             (getNflState + max season in player_stats)
       loadBeamSettings(admin)                        (single-row, code fallback)
  5. interpreter.interpret(question, ctx)
  6. switch on interpretation
       request     -> capability.run() -> capability.present()
       clarify     -> return clarification (no capability runs)
       unsupported -> return the friendly copy
  7. after(): log to beam_queries (never blocks the response)
  8. respond BeamOutcome
```

Step 4 satisfies the CLAUDE.md source and format sync rule for every
value-bearing capability. Stat capabilities are format-agnostic except fantasy
points, which reads `ctx.scoringKey`.

---

## 5. Player resolution

This is the part most likely to embarrass the product, so it gets its own
module, `lib/beam/resolve/player.ts`, with a hard rule: **never answer for a
player we are not confident about.**

**A scope decision the existing code forces.** `searchFantasyPlayers()` filters
to players ranked within 90 days. That is correct for Signal Check and Beacon
Breakdown. It is wrong for BEAM stat questions: "how many yards did Derrick
Henry run for in 2021" must work for anyone with rows in `player_stats`,
including retired players. So the resolver takes a scope:

- `scope: "historical"` for stat capabilities. Search all players, no relevance
  gate.
- `scope: "current"` for value, rank, ADP, and comparison capabilities. Apply
  `fantasyRelevantPlayerIds()`, because a value question about a retired player
  has no answer.

**Six-tier ladder, highest tier wins, each returns a confidence.**

| Tier | Method | Confidence | Handles |
|---|---|---|---|
| 1 | Exact slug or Sleeper id (from a picker or a follow-up click) | 1.00 | Disambiguation clicks |
| 2 | Exact normalized full name against the new `search_name` column | 0.97 | "brock purdy", "ceedee lamb" |
| 3 | Alias hit in `beam_player_aliases` | 0.95 | "cmc", "cd lamb", "hollywood", "jj" |
| 4 | Exact last name, unique inside scope | 0.90 | "purdy", "gibbs" |
| 5 | Last name plus first initial or first-name prefix | 0.88 | "b purdy", "j allen" |
| 6 | Trigram `similarity(search_name, q) >= 0.42` plus Damerau-Levenshtein <= 2 on the last name | 0.55 to 0.85, scaled | "brock prudy", "jamyr gibs" |

Tier 6 uses the existing GIN trigram index. The Levenshtein re-check in
TypeScript is the guard against trigram's known weakness on short strings
("lamb" is trigram-similar to "lamm", "labm", and "lam"); a raw `%` match alone
would be too loose.

**Prominence tiebreak, not prominence override.** Candidates within a tier are
ordered by a prominence score: current overall rank in the active format (best
signal), then most recent season with stats, then career fantasy points. "brock"
alone returns Brock Purdy first and Brock Bowers second, and because the two are
close on prominence, BEAM asks rather than guessing.

**The accept rule.**

```
accept   if top.confidence >= 0.85 AND (top.confidence - second.confidence) >= 0.10
clarify  if top.confidence >= 0.50 AND up to 4 candidates within 0.20 of the top
reject   otherwise
```

Both thresholds live in `beam_settings` so they can be tuned from the admin
without a deploy.

**Two-player questions resolve jointly.** If side A resolves cleanly and side B
does not, BEAM clarifies only side B and keeps A. A clarification click returns
a slug, which re-enters at tier 1, so the second pass is exact.

**Aliases are content, not code.** `beam_player_aliases` is a real table with an
admin editor, because nicknames arrive faster than deploys and because the query
log will tell you exactly which ones to add. It seeds from three sources at
migration time: Sleeper's `metadata.sleeper.search_full_name`, first-initial-
plus-last-name for every ranked player, and a hand-written list of about 60
well-known nicknames.

---

## 6. Capability registry

One file per capability, one registry that imports them:

```
lib/beam/capabilities/
  index.ts                    // CAPABILITIES: BeamCapability[]  (the only registration point)
  player-season-stat.ts
  player-stat-line.ts
  player-compare-stat.ts
  player-compare-verdict.ts
  player-value.ts
  player-rank.ts
  player-bio.ts
  glossary-term.ts
```

Adding a question type is: write the capability file, add its phrasings to the
lexicon, add its matcher weights, register it, write the presenter test. No
changes to the route, the interpreter core, or the UI.

Each capability declares its own matcher so intent knowledge stays next to the
code that answers it:

```ts
export const playerSeasonStat: BeamCapability<Params, Result> = {
  id: "player.season.stat",
  label: "Player season statistic",
  schema: z.object({
    playerId: z.string().uuid(),
    statId: StatId,
    season: z.number().int().min(2020).max(2030),
    seasonType: z.enum(["regular", "post"]).default("regular"),
  }),
  matcher: {
    base: 0.40,
    required: ["player", "stat"],
    optional: ["season", "seasonType"],
    heads: ["how many", "what were", "how much"],
    playerCount: 1,
  },
  async run(p, ctx) { /* one aggregate query */ },
  present(r, p, ctx) { /* BeamAnswer */ },
};
```

---

## 7. Question types for V1

**Tier A, ship in V1**

1. `player.season.stat`. Single player, single stat, one season. Backed by one
   aggregate `SELECT sum(...)` over `player_stats` filtered on
   `(player_id, season, season_type)`, which hits `idx_stats_player_season`.
   Stat registry of about 32 entries: pass yards / TD / INT / attempts /
   completions / completion% / yards per attempt / sacks, rush attempts / yards
   / TD / YPC / red zone carries, targets / receptions / receiving yards / TD /
   catch% / yards per target / air yards / target share, fumbles lost, snap%,
   games played, and fantasy points in the viewer's scoring.
2. `player.stat.line`. "how did Gibbs do in 2025" returns a position-appropriate
   line via the existing `statColumns(position)`.
3. `player.compare.stat`. "who had more targets in 2025, Lamb or Wilson". Same
   query, two players, one comparison sentence.
4. `player.compare.verdict`. "who is better for dynasty, Garrett Wilson or Drake
   London". Section 8.
5. `player.value`. Current FF Beacon value, 30-day change, plus the format and
   source labels. Reads `player_value_trends` through the resolved
   (format, source).
6. `player.rank`. Overall rank, position rank, tier from `rankings`.
7. `player.bio`. Age, team, position, experience, college, draft slot, current
   injury designation.
8. `glossary.term`. "what is FAAB", "what does TEP mean". Reads published
   `guide_entries` where `kind='term'`, global first, then page-scoped. 79 rows
   already written.

**Tier B, cheap once the frame exists (V1.1)**

9. `player.finish`. "where did Gibbs finish in 2025" from
   `player_positional_finishes`.
10. `player.trend`. "is Puka trending up" from `player_value_trends`, gated on
    `show_trend_30d`.
11. `player.adp`. "where is Bijan going in drafts" from `player_market_latest`,
    plus the `draft_value_targets.verdict` string when a row exists.
12. `player.projection.ros`. Rest-of-season projection via
    `loadBreakdownExtras`.

**Explicitly out of V1**: anything touching a specific user's league (roster,
trade, waiver), multi-season aggregation, week-level questions, and any question
requiring a genuine opinion we have not already computed.

---

## 8. Interfacing with Beacon Breakdown

BEAM calls the existing stack. It writes no comparison logic of its own.

```ts
// lib/beam/capabilities/player-compare-verdict.ts
const lens = params.lens ?? DEFAULT_LENS;             // from the lens lexicon
const lookup = await loadBreakdown(ctx.supabase, slugA, slugB, { lens });
if (!lookup.ok) return unsupported("player-not-comparable");

const core = lookup.result;
const pulse = await loadPowerPulseSettings(ctx.admin);
const extras = await loadBreakdownExtras(ctx.supabase, sides, extrasCtx, pulse);
const result = assembleBreakdown({ ...core, extrasA, extrasB, lens, context: core.context });
```

That is the same three calls
`app/api/og/breakdown/[a]/[b]/route.tsx:113-153` makes. The answer then reads
`result.verdict` (already a written sentence from `lib/breakdown/verdict.ts:198`)
as the headline, the top two `result.takeaways` as supporting facts, and links to
`/tools/beacon-breakdown?a=...&b=...&lens=...` so the reader can see the full
table.

Lens mapping from question wording:

- "dynasty", "keeper", "long term", "rebuild", "rebuilding" -> `dynasty`
- "win now", "competitive", "contending", "rest of season", "this year" ->
  `win-now`
- "this week", "start", "who do i start" -> `this-week`
- Nothing matched -> `DEFAULT_LENS` (dynasty), and the answer says which lens it
  used

"Who should a rebuilding team prefer" and "who is more valuable" are the same
capability with a different lens and a different presenter sentence. That is the
whole point of routing through the existing engine.

One caveat worth flagging: `loadBreakdown` deliberately skips extras so the page
can paint fast. BEAM has no such constraint per answer, but the extras load is
the expensive part (projections plus reliability plus market). Budget roughly
400 to 900ms for this capability and show a real loading state.

---

## 9. Answer generation

Presenters return a structure, not a string:

```ts
export type BeamAnswer = {
  /** One sentence. The whole answer if the reader only reads one thing. */
  headline: string;
  /** What a screen reader announces. Usually headline, expanded where the
   *  visual layout carries meaning the sentence does not. */
  speech: string;
  facts: BeamFact[];             // { label, value, hint? }
  context: BeamAnswerContext;    // format + source labels, "as of" timestamp
  links: BeamLink[];             // player profile, breakdown, rankings
  caveats: string[];             // "2026 has not started", "small sample"
};
```

Formatting rules, matching how `lib/on-the-clock/rationale.ts` already writes:

- Name the number. "Brock Purdy threw for 3,864 yards in 2025." Not "Purdy had a
  strong passing season."
- Thousands separators on counting stats, one decimal on rates and fantasy
  points, and the season always stated even when the user did not say one.
- Never claim what we did not measure. A missing stat produces "We do not have
  receiving yards for him in 2025", not zero.
- Fantasy points always name the scoring: "290.4 PPR points". Value always names
  format and source: "1,847 in Dynasty PPR SF, per FF Beacon values."
- Any rendered timestamp goes through `formatEastern()` from `lib/datetime.ts`.
- Plural agreement is handled by the presenter, never by string concatenation at
  the call site: "1 touchdown" and "12 touchdowns".

Sentence shapes live in `lib/beam/answers/templates.ts` as functions, not
template strings in the capability, so a copy pass is one file. Every presenter
gets a snapshot test.

---

## 10. Ambiguous questions

Three distinct ambiguity kinds, three distinct clarification shapes:

**Ambiguous player.** Render up to four candidate buttons with name, position,
team, and last active season. Clicking sends the slug, which resolves at tier 1.
The prompt names what was typed: `We found more than one player matching "lamb".`

**Ambiguous stat.** "how many yards did Gibbs have" is genuinely three questions
for a running back. Offer rushing yards, receiving yards, and scrimmage yards as
buttons. Do not silently pick.

**Ambiguous season.** In August 2026, "how many yards did Purdy throw for" with
no season is the trap. The clock resolves it to the most recent season with data
(2025) and the answer says so explicitly, with a caveat line: `The 2026 season
has not started. This is his 2025 total.` No clarification prompt needed,
because there is one defensible default and BEAM states which one it took.

A clarification is not an error state. It renders as a normal BEAM message with
choices, keeps the original question visible above it, and moves focus to the
first choice.

---

## 11. Unsupported questions

Distinct reasons produce distinct copy, because "we could not find that player"
and "we do not answer that kind of question yet" call for different next
actions:

| Reason | Message shape |
|---|---|
| `no-player` | "We could not find a player called X. Check the spelling, or try their full name." |
| `no-intent` | "BEAM does not know how to answer that one yet." |
| `unsupported-stat` | "We do not track X yet. Here is what BEAM can look up." |
| `no-data` | "We have no 2019 stats. BEAM's stat history starts in 2020." |
| `out-of-scope` | "BEAM cannot see your league yet. League Pulse can." |

Every one of them renders the same two affordances underneath: a short list of
example questions BEAM does handle (drawn from the capability registry, so it
stays honest as capabilities are added), and the **Help BEAM learn this** button.

Copy stays plain. No apology paragraph.

---

## 12. The "Help BEAM learn this" workflow

Model it on `app/api/guide/submit/route.ts`, because that route already solved
this exact problem correctly.

**Form**: name (required), email (optional), message (optional, 1,000 chars),
plus the original question rendered read-only above the fields with a visible
label so it is obvious what is attached. Hidden `company` honeypot. The question
travels in the POST body but is re-validated server-side against the logged
`beam_queries` row id so a caller cannot attach arbitrary text to someone else's
submission.

**Route**: `POST /api/beam/learn`

1. Same-origin check (Origin, then Referer, fail closed).
2. Honeypot, generic rejection message.
3. `validateBeamLearningRequest()` mirroring the DB CHECKs, in
   `lib/beam/validate.ts`.
4. `try_claim_rate_limit("beam_learn", actorKey, 3, 600)`.
5. Insert into `beam_learning_requests` via the service-role client, linking
   `query_id`.
6. `after()`: notify the team, confirm to the submitter when an address was
   given. New `lib/email/beam-emails.ts` following `guide-emails.ts`.

**Confirmation**: replaces the form in place, moves focus to the confirmation
heading, announces via `aria-live="polite"`. Copy: "Got it. We read every one of
these, and the ones people ask most are the ones BEAM learns next."

**Where submissions go**: `/admin/beam/requests`, mirroring
`/admin/signal-guide/submissions`. Status values `pending`, `planned`,
`shipped`, `declined`. Each row links to the query log entry so you can see the
parse that failed.

**Separately, log every question.** `beam_queries` records the question, the
normalized form, the chosen capability or null, confidence, outcome kind,
failure reason, latency, and a hashed actor key. This is the table that tells
you what to build next, and it needs no user action. Privacy handling in section
15.

An admin view `/admin/beam/gaps` groups unanswered questions by a coarse
signature (extracted entity kinds plus the head phrase) with counts, so "37
people asked a week-level stat question" surfaces as one row instead of 37.

---

## 13. Schema changes

Five migrations, numbered from 0194 (latest applied is 0193). Each ships its RLS
policies in the same file per the auto-RLS rule.

**0194: player search name**

```sql
alter table public.players
  add column search_name text
  generated always as (
    lower(regexp_replace(coalesce(full_name, first_name || ' ' || last_name),
                         '[^a-zA-Z0-9 ]', '', 'g'))
  ) stored;
create index idx_players_search_name_trgm
  on public.players using gin (search_name gin_trgm_ops);
create index idx_players_search_last on public.players (lower(last_name));
```

Why a column and not the existing jsonb key:
`metadata.sleeper.search_full_name` is not indexable without an expression index
over jsonb extraction, it is null on 32 rows, and it is Sleeper's normalization
rather than ours. A generated column costs nothing to maintain and the trigram
index makes tier-6 matching an index scan.

**0195: `beam_player_aliases`**

`id, player_id (fk, cascade), alias citext, alias_kind (nickname|initials|
shorthand|misspelling), is_active, source (seed|admin|learned), note,
created_at`. Unique on `(alias, player_id)`. Public SELECT, service-role writes.
Note the citext CHECK gotcha: any format CHECK on `alias` must cast `::text`.

**0196: `beam_queries`**

`id, question text, question_normalized text, capability_id text null, outcome
text, failure_reason text null, confidence numeric null, player_ids uuid[] null,
format_slug text, source_slug text, latency_ms int, actor_hash text null,
user_id uuid null, created_at`. Service-role only, no client policies. Plus
`cleanup_beam_queries(retain_days int)` following the `cleanup_rate_limit_hits`
pattern.

**0197: `beam_learning_requests`**

`id, query_id (fk to beam_queries, set null), question text, name text, email
text null, message text null, status text check in (pending, planned, shipped,
declined), ip_hash text, submitted_user_id uuid null, created_at, updated_at,
resolved_at`. Service-role only. Mirrors `guide_question_submissions`.

**0198: `beam_settings`**

Single row `id='global'`, `settings jsonb`, service-role only, code fallbacks in
`lib/beam/default-settings.ts`. Holds resolver thresholds, intent thresholds,
the enabled-capability list, the max input length, rate-limit ceilings, and
(reserved) the future LLM interpreter config. This matches
`faab_calculator_settings`, `on_the_clock_settings`, and `draft_value_settings`
exactly.

Regenerate `lib/database.types.ts` via MCP after each, per the workflow rule.

---

## 14. File map

**New**

```
lib/beam/
  types.ts                       BeamRequest, BeamOutcome, BeamAnswer, capability interface
  context.ts                     buildBeamContext(): format + source + clock + settings
  clock.ts                       resolveBeamClock(): getNflState + max season in player_stats
  settings.ts                    loadBeamSettings(admin)
  default-settings.ts            code fallbacks
  validate.ts                    ask + learning-request input validation
  engine.ts                      ask(): interpret -> run -> present -> log
  interpret/
    index.ts                     DeterministicInterpreter (implements BeamInterpreter)
    normalize.ts
    tokens.ts
    entities.ts
    score.ts
    trie.ts
    lexicon/stats.ts
    lexicon/seasons.ts
    lexicon/positions.ts
    lexicon/teams.ts
    lexicon/intents.ts
  resolve/
    player.ts                    the six-tier ladder + accept rule
    distance.ts                  Damerau-Levenshtein, Jaro-Winkler
    season.ts
    stat.ts
  stats/
    registry.ts                  BeamStat[]: id, label, phrasings, column, agg, positions, fmt
    query.ts                     one aggregate read per (players, season, statset)
  capabilities/
    index.ts
    player-season-stat.ts
    player-stat-line.ts
    player-compare-stat.ts
    player-compare-verdict.ts
    player-value.ts
    player-rank.ts
    player-bio.ts
    glossary-term.ts
  answers/
    templates.ts
    format.ts                    numbers, plurals, ordinals
  log.ts                         logBeamQuery(), scrubbing
  examples.ts                    suggestion chips, derived from the registry

app/api/beam/ask/route.ts
app/api/beam/learn/route.ts

app/tools/ask-beam/
  page.tsx
  ask-beam-client.tsx
  beam-answer-card.tsx
  beam-clarify.tsx
  beam-unsupported.tsx
  beam-learn-form.tsx
  beam-suggestions.tsx

components/beam/
  beam-mark.tsx                  BEAM glyph, matching components/beacon-mark.tsx
  ask-beam-pane.tsx              embeddable pane, used by the Guide panel

app/admin/beam/
  page.tsx                       settings editor
  requests/page.tsx              learning requests queue
  gaps/page.tsx                  grouped unanswered questions
  aliases/page.tsx               player alias editor
  actions.ts

lib/email/beam-emails.ts
lib/beam/*.test.ts               interpreter, resolver, presenters, registry
supabase/migrations/0194..0198
```

**Modified**

```
app/layout.tsx                            no change if BEAM rides in the Guide panel
components/signal-guide/guide-panel.tsx   two-pane track becomes three-pane
components/signal-guide/signal-guide-mount.tsx   mount when a guide exists OR always (see 19)
lib/site.ts                               TOOLS_NAV, SEARCHABLE_TOOLS, FOOTER_COLUMNS
app/tools/page.tsx                        a sixth TOOLS entry
lib/guide/registry.ts                     new page key "ask-beam"
lib/beacon-admin-nav.ts                   admin nav entry
lib/database.types.ts                     regenerated
app/sitemap.ts                            /tools/ask-beam
progress.md                               atomic tasks
```

**Read, never modified**: `lib/beacon-breakdown.ts`, `lib/breakdown/*`,
`lib/player-profile.ts`, `lib/player-search.ts`, `lib/preferences.ts`,
`lib/source.ts`, `lib/sleeper.ts`, `lib/rate-limit-actor.ts`,
`lib/email/send.ts`.

---

## 15. Security, abuse, privacy

- **No user text ever reaches SQL as structure.** Stat ids index a closed
  registry to get a column name. There is no path from input to a column
  identifier, a table name, or an order-by.
- **ilike safety.** The resolver sanitizes to `[\p{L}\p{N} '.\-]` and escapes
  `%` and `_`, matching `app/api/search/route.ts:76` and
  `lib/player-search.ts:86`.
- **Input cap** at 300 characters, enforced before normalization so a megabyte
  body is rejected on length, not parsed.
- **Rate limits** through the existing durable RPC: `beam_ask` at 30 per 60s per
  actor, `beam_learn` at 3 per 600s. Actor key from
  `resolveRateLimitActorKey()`, so signed-in users are limited by uid and guests
  by salted IP hash they cannot rotate.
- **Same-origin** `x-requested-with: ff-beacon` on `/api/beam/ask`; full
  Origin-then-Referer fail-closed check plus honeypot on `/api/beam/learn`,
  because it sends email.
- **Cost of an answer is bounded.** Each capability makes a fixed, small number
  of indexed reads. `player.compare.verdict` is the expensive one; cap the
  interpreter at two resolved players so no question can fan out.
- **No private data.** V1 reads only tables that are already public-read and
  already rendered to anonymous visitors. No league, roster, or user data.
  `beam_queries` and `beam_learning_requests` are service-role only.
- **Privacy on the log.** Never store a raw IP; store the salted hash from the
  same helper. Scrub the question through a redactor before insert (email
  pattern, phone pattern, long digit runs replaced with `[redacted]`). Truncate
  to 300. Retain 180 days, dropped by `cleanup_beam_queries`. `user_id` is
  stored only when a session exists, and only for provenance.
- **Answers are text, rendered as text.** No `dangerouslySetInnerHTML` anywhere
  in the BEAM surface. Glossary bodies from `guide_entries` render with
  `whitespace-pre-line`, matching `guide-panel.tsx:381`.
- **The debug view is admin-only.** The parse trace (tokens, candidate scores,
  resolver tiers) is genuinely useful and is gated behind `requireAdmin`, never
  exposed in the public response.

---

## 16. Accessibility

The whole feature is a conversation, which is the case where the wrong ARIA
choice is loudest.

- **The transcript is a `<ul>` of messages in a `role="log"` region with
  `aria-live="polite"` and `aria-relevant="additions"`.** Not `assertive`: an
  answer arriving should not interrupt someone mid-sentence. Not `role="status"`,
  which reannounces the whole region.
- **Announce the answer once.** The `speech` field is what lands in the live
  region. The visual card carries the same content structured as a definition
  list, marked `aria-hidden` only where it would duplicate the announcement
  verbatim.
- **Loading state announces.** "BEAM is looking that up" in the live region,
  replaced by the answer. A spinner alone is silence.
- **Clarification is a real choice list.** A group of buttons inside a
  `<fieldset>` with a `<legend>` naming the ambiguity, focus moved to the first
  option, each button labelled with everything that distinguishes it: "Drake
  London, wide receiver, Atlanta Falcons".
- **The input** is a labelled `<textarea>` (not an input, so long questions
  wrap), with `aria-describedby` pointing at the character counter and the
  example hint. Enter submits, Shift+Enter adds a line, and that is stated in
  the description.
- **Suggestion chips** are buttons in a `role="list"`, each with a full
  `aria-label` since the visible text is truncated on narrow screens.
- **Focus management**: after an answer renders, focus stays in the input so a
  follow-up question needs no tabbing. After a clarification, focus moves to the
  first choice. After the learning form submits, focus moves to the confirmation
  heading.
- **Every interactive element is at least 44 by 44 CSS px**, matching the site
  rule.
- **Mobile keeps every field.** The answer card shows headline, facts, context,
  and links at every breakpoint. Facts stack into label-over-value rows below
  `sm` rather than being dropped. No `hidden md:` on any data.
- **Heading hierarchy**: the page has one `h1` ("Ask BEAM"), the transcript
  region is `h2`, each answer card's headline is `h3`.
- **Reduced motion** respected on the pane slide, matching `guide-panel.tsx`.
- Sub-agent accessibility review before any task is marked complete, per the
  project workflow.

---

## 17. Adding the LLM later without a rewrite

The seam is `BeamInterpreter`. Phase 2 is one new file:

```ts
// lib/beam/interpret/llm.ts
export const LlmInterpreter: BeamInterpreter = {
  id: "llm-v1",
  async interpret(text, ctx) {
    // Anthropic structured output; the schema is generated from CAPABILITIES,
    // so the model can only emit a capability that exists with params that parse.
    // Player names come back as strings and go through the SAME resolver.
  },
};
```

What makes that a one-file change:

1. **Capabilities never see text.** They take validated params. Nothing in
   `capabilities/` cares who filled them in.
2. **The tool schema is derived, not hand-written.**
   `CAPABILITIES.map(c => zodToJsonSchema(c.schema))` becomes the tool list. A
   capability added in V1 is automatically available to the model in V2.
3. **Player resolution stays deterministic.** The model proposes a name string;
   `resolve/player.ts` turns it into a UUID with the same ladder and the same
   accept rule. An LLM must never be allowed to assert a player id, because it
   will hallucinate one confidently.
4. **The two interpreters compose.** Run the deterministic one first; on
   `unsupported`, fall through to the LLM. That is cheaper, faster on the common
   path, and gives a measurable comparison. `beam_settings.interpreter` picks
   the strategy (`deterministic`, `llm`, `deterministic-then-llm`), so it can be
   flipped without a deploy.
5. **The infrastructure already exists.** `lib/beacon-brief/ai.ts` has
   `runStructuredCall`, per-call logging of the exact prompt and response, token
   accounting, prompt caching, and never-throws semantics. BEAM's LLM
   interpreter should use that module's shape, and the system prompt belongs in
   `beam_settings` per the "AI prompts must be editable" rule.
6. **The query log is training data.** Every question with its deterministic
   outcome is already recorded, which gives an evaluation set the day the model
   is turned on.

The presenters stay deterministic even in V2. The model routes; it does not
write the answer. That keeps numbers unhallucinatable.

---

## 18. Phased order

Each phase is independently shippable and testable.

**Phase 1: foundation, no UI.** Migrations 0194 to 0198, types regenerated,
`lib/beam/types.ts`, context, clock, settings, and the player resolver with its
full test suite. Deliverable: a test file proving "brock prudy", "purdy",
"b purdy", and "ceedee" resolve correctly and that "brock" asks.

**Phase 2: interpreter and two capabilities.** Normalize through score, the stat
lexicon, `player.season.stat` and `player.bio`. Deliverable: a Vitest table of
60 phrasings mapping to expected `BeamRequest` objects, including all five
example questions from the brief.

**Phase 3: the route and the page.** `/api/beam/ask`, `/tools/ask-beam`,
transcript, answer card, suggestions, loading and error states. Accessibility
audit here, not later.

**Phase 4: unsupported path and learning requests.** `beam_queries` logging,
`/api/beam/learn`, the form, emails, `/admin/beam/requests`, `/admin/beam/gaps`.

**Phase 5: comparison and value capabilities.** `player.compare.verdict` through
Beacon Breakdown, `player.compare.stat`, `player.value`, `player.rank`,
`glossary.term`. This is where format and source sync gets its own review pass.

**Phase 6: placement and admin polish.** Ask BEAM pane inside the Guide panel,
nav and footer entries, `/admin/beam` settings editor, alias editor, and an
alias seed run driven by the first weeks of real query-log data.

**Phase 7 (separate project): LLM interpreter.**

---

## 19. Concerns, tradeoffs, open questions

1. **"Last year" is genuinely ambiguous right now.** It is August 2026. Sleeper
   reports season 2026, and `player_stats` has nothing past 2025. Taken
   literally, "last year" means 2025 and "this year" means a season with zero
   rows. Recommendation: the clock exposes `currentSeason` and
   `latestStatSeason` separately, a bare stat question defaults to
   `latestStatSeason`, and the answer states the season it used. "this year"
   during the offseason returns a caveat plus the 2025 answer rather than an
   empty result.

2. **The relevance filter is wrong for stat questions.** Flagged in section 5.
   It is the single most likely source of "BEAM cannot find a player it
   obviously should find" if the resolver is built on `searchFantasyPlayers()`
   without a scope parameter.

3. **DEF and K coverage is uneven.** `player_stats` carries team-defense buckets
   and kicking columns, but `players` rows for team defenses behave differently
   from skill players (no birth date, position `DEF`). V1 should support K and
   DEF for fantasy points and their own stat groups, and the stat registry
   should gate every stat by position so "how many targets did the Ravens
   defense have" returns `unsupported-stat`, not zero.

4. **`pts_ppr` is nullable.** Migration 0141 backfilled it, but null means
   Sleeper never published that base, not zero. Coalescing to zero in an
   aggregate silently understates a season. The aggregate query should count
   non-null weeks and the presenter should caveat when coverage is partial.

5. **The comparison capability is the slow one.** `loadBreakdown` plus
   `loadBreakdownExtras` plus `assembleBreakdown` is meaningfully heavier than a
   stat lookup. Options: accept it with a good loading state (recommended for
   V1), or cache by `(slugA, slugB, format, source, lens)` for an hour. Caching
   is not recommended in V1; a one-hour cache on a verdict that reads as current
   is a small correctness risk for a small latency win.

6. **Alias quality is a cold-start problem.** The seed list is a guess until
   real queries arrive. Phase 6 exists specifically to close that loop, and the
   gaps admin view is what makes it a ten-minute task rather than a research
   project.

7. **Where BEAM lives is partly a product call.** Recommendation:
   `/tools/ask-beam` is the home, and BEAM becomes a third pane in the Signal
   Guide panel. But the Guide launcher currently renders only on pages that have
   published guide entries (`signal-guide-mount.tsx:63`). If BEAM should be
   reachable everywhere, that mount condition has to change to "has guide
   content OR BEAM is enabled", and the launcher label needs to stop saying only
   "Guide". That is a visible change to an existing shipped surface, so it needs
   sign-off before anything touches it.

8. **Suggestion chips must not oversell.** If the examples shown include a
   question type BEAM cannot answer, every other answer loses credibility.
   Generating them from the registry (`lib/beam/examples.ts`) rather than
   hand-writing them keeps that honest automatically.

9. **Confidence should probably be visible.** A quiet "Matched: Brock Purdy"
   line under the answer, with a "not who you meant?" link that reopens the
   candidate list, costs one line and converts a wrong-player answer from a
   trust failure into a one-click correction. Recommended for V1.

10. **Naming.** "BEAM" reads cleanly, `beam_` table prefix is FF Beacon-native,
    and it does not collide with anything in the schema. One caution: the tokens
    "beam" and "beacon" are close enough that Signal Guide search and the site
    search palette may want to match both.

---

## 20. Decisions needed before implementation

1. Route: `/tools/ask-beam`, or `/beam` as a top-level surface?
2. Should the Signal Guide launcher change so BEAM is reachable on every page
   (item 7 above)?
3. Is the Tier A capability list right for V1, or should any Tier B item be
   pulled forward?
4. Should the "Matched: Brock Purdy" confidence line ship in V1 (item 9)?
5. Do learning-request notifications go to `ADMIN_NOTIFICATION_EMAIL`, to a
   Discord webhook through the existing `discord_webhooks` row, or both?
