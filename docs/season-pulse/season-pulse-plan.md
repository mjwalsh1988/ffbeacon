# Season Pulse plan

Written 2026-10-03. Owner decisions recorded here: the name (Season Pulse), the
position in the menu (directly before Games), fantasy first with NFL second, a
current-season positional rank finder, weather forecasts through the National
Weather Service, and a Chrome pass at every screen size before the build is
called done.

## 1. What it is

`/season`, menu label "Season Pulse". One hub for the current NFL season as a
fantasy manager sees it: who is scoring, where each player ranks at his
position, what happened last week, what is coming this week and what the
weather will be when it does.

League Pulse reads one league. Manager Pulse reads one manager. Season Pulse
reads the season.

The page is fantasy first. Fantasy performance sections come first and carry
the most space. NFL results, NFL stat leaders and team records follow as their
own block, because they explain the fantasy numbers and are not the reason a
reader came.

## 2. Keyword research (Google Ads Keyword Planner, US, 2026-10-03)

The account has no active spend, so Keyword Planner returns ranges.

| Term | Monthly searches |
| --- | --- |
| nfl stats | 100K to 1M |
| nfl weather | 10K to 100K |
| nfl stat leaders | 10K to 100K |
| nfl snap counts | 10K to 100K |
| nfl passing leaders, nfl rushing leaders, nfl receiving leaders | 10K to 100K each |
| nfl box scores, nfl scores this week, nfl schedule this week | 10K to 100K each |
| fantasy football stats | 1K to 10K (up 900 percent in three months) |
| fantasy football leaders, fantasy points leaders | 1K to 10K each |
| nfl game weather, nfl weather report, nfl weather forecast, nfl weather today | 1K to 10K each |
| nfl implied team totals | 1K to 10K |
| nfl target leaders, nfl touchdown leaders | 1K to 10K each |
| nfl season stats, nfl player stats | 1K to 10K each |
| nfl matchups this week, nfl upcoming games | 1K to 10K each |
| fantasy football weather, fantasy football weather report | 100 to 1K each |
| fantasy points allowed by position, defense vs position | 100 to 1K each |
| fantasy football weekly recap, studs and duds, boom or bust | 10 to 100 each |
| fantasy football pulse, season tracker, stat center | none measurable |

What follows from it:

- The name carries no search volume, so it is a brand and the keywords go in
  titles, headings and sub-pages.
- Weather and stat leaders are the two clusters large enough to deserve their
  own URL, so each gets a page under the hub.
- Fantasy leaders and positional ranks get their own page for the same reason,
  and because the full board is too long for the hub.
- One page per week, the same shape the waiver wire uses, for the week-numbered
  searches.

## 3. Routes

| Route | Title target | What it holds |
| --- | --- | --- |
| `/season` | Fantasy football stats this season | The hub: every section below, each cut to its top rows, with links to the full pages |
| `/season/leaders` | Fantasy football leaders and positional ranks | The full leaders board with search, every scoring player, the week by week grid |
| `/season/stats` | NFL stat leaders | Passing, rushing, receiving, touchdowns, targets, carries, snap share, team records, points allowed by position |
| `/season/weather` | NFL weather forecast this week | Every game this week with its forecast and fantasy read, the roof of every stadium, how weather moves scoring |
| `/season/week-N` | Week N fantasy football recap, or preview | Played week: results, spotlights, top scorers, projection grade. Live week: previews and weather for games not yet played, finals for the rest |

The week segment carries its own `week-` prefix for the reason the waiver wire
does: the App Router has no partial dynamic segment. A week past the live one is
a 404. The season stays out of the URL so the page keeps its authority across
years; the season is stated in the title and the structured data.

## 4. Sections on the hub, in order

Fantasy (primary):

1. Masthead: season, live week, scoring, four readouts (weeks played, top
   scorer, projection beat rate this season, games this week).
2. Jump bar to every section.
3. Positional ranks and leaders. Tabs for QB, RB, WR, TE, K and DEF plus an
   overall view. A search box that finds a player and shows his rank at his
   position ("WR7"). Sort by total points, points per game or last week. Each
   row carries total, per game, games, last week and a bar per week.
4. Week in the spotlight, for the most recent completed week: the best
   performances, the biggest beats of the projection, the surprises (a big week
   from a player projected for little) and the letdowns (a small week from a
   player projected for a lot).
5. Week by week grid. The top players at a position against every week played,
   each cell coloured by how good the week was at that position, the number
   always printed.
6. Starter weeks. How many of a player's weeks finished inside the starting
   range at his position (top 12 for QB, TE, K and DEF, top 24 for RB and WR),
   plus his best and worst week.
7. Projection report. Beat rate, average miss and lean by position for the
   season, beat rate by week, the players who beat their number most often and
   least often. The heading names the projection engine in force.
8. Usage. Targets, target share, carries and snap share leaders.
9. Points allowed by position. Thirty-two defenses against QB, RB, WR and TE
   as a heat grid, read from `nfl_defense_vs_position`.

NFL (secondary):

10. Last week's results. One card per game: logos, final, how the line fared,
    the top three fantasy lines in the reader's scoring, and the Beacon Brief's
    headline for the game with a link to its recap when an edition is published.
11. NFL stat leaders. Passing, rushing and receiving yards, touchdowns.
12. Team records and scoring.

This week:

13. Upcoming games. Kickoff in Eastern time, the spread and the two implied
    team totals, the forecast, a short written preview and the players
    projected to score the most.
14. FAQ and the method notes.

## 5. Data

Nothing here needs a new stats source. Every figure comes from a table the site
already fills.

| Need | Source | Notes |
| --- | --- | --- |
| Weekly fantasy points and stat lines | `player_stats` | Regular season, offense plus K and DEF, `gp > 0`. Read one week at a time and cached per week |
| Scoring | `lib/league-scoring.ts` | `scoringSettingsForFormat` then `scoreWithFallback`, so TE premium formats add their bonus |
| Projections | `lib/projections/read.ts loadAdjustedProjections` | `rawPoints`, the engine's own published number, graded against what happened. The source is resolved there and named in every heading |
| Finals | `lib/brief-desk/week-results.ts` | Derived from the two team defense lines |
| Lines | `nfl_game_lines`, falling back to `nfl_game_odds` | `loadGameLines` is exported from `lib/brief-desk/game-data.ts` for this |
| Schedule and kickoffs | `nfl_game_odds` | |
| Recaps | `brief_editions.draft_payload.games` | Published editions only, headline and link |
| Points allowed by position | `nfl_defense_vs_position` | |
| Season and week | `lib/start-sit/clock.ts resolveSeasonClock` | |
| Weather | `nfl_game_weather`, new | Section 6 |

Format: the page resolves the reader's format through `resolveFormatSlug` (URL,
saved preference, cookie, default). Only the scoring half of a format changes
anything here (PPR, half PPR, standard, and the TE premium), and the page says
which scoring it is showing. No value source is read anywhere on these pages,
so the value source toggle has nothing to change and is not resolved.

Positional rank is the rank within a position by total fantasy points for the
regular season to date, ties sharing a rank, which is the rule
`player_positional_finishes` uses. A test holds the two in agreement.

A week still in progress counts toward season totals and is said to be
incomplete. Spotlights, the projection report and results use completed weeks
only.

## 6. Weather

This builds sections 2.1 and 2.4 of
`docs/projection-engine/projection-engine-v2-plan.md` ahead of the rest of that
plan, as data and display only. No projection is adjusted for weather. That
stays with the engine plan and its ablation rule.

Two tables:

- `nfl_stadiums`: a seed of the 38 venues on the 2026 schedule, with
  coordinates, our own roof class (`outdoors`, `dome`, `retractable`), time
  zone, country and the venue id the stored schedule carries. The National
  Weather Service grid for each US venue is cached on its row.
- `nfl_game_weather`: append-only forecast snapshots, one per game per fetch.
  An indoor game gets one row saying so and no provider call.

`nfl_games` does not exist yet, so a snapshot carries `game_key` in the nflverse
form the engine plan uses (`2026_04_GB_TB`) with no foreign key, plus the
season, week and both teams so a page can read it without a join. When
`nfl_games` lands the key is already the right one.

Providers, both free and keyless:

- National Weather Service (`api.weather.gov`) for games in the United States.
  Public domain. It asks for a User-Agent naming the site and a contact.
- MET Norway Locationforecast for games abroad. It needs an attribution line,
  which goes on `/terms` and under every forecast it supplies. It publishes no
  gusts and no rain probability outside the Nordic region, so those are blank
  for international games.

A retractable roof is treated as closed, the engine plan's rule, and the page
says that in words.

`lib/nfl-weather.ts` is the only file that names either host. A guard test
holds that.

Sync: `/api/cron/sync-nfl-weather`. Nightly at 13:45 UTC after the odds sync,
and three game-day refreshes that skip themselves when no game kicks off within
a day. A failed request writes nothing and leaves the last snapshot standing. A
missing forecast is never shown as calm.

The fantasy read (`lib/nfl-weather-impact.ts`, pure) puts a forecast into one of
four bands and writes one sentence. The bands are ours and the page says so; the
measurements behind them are cited by name on the weather page:

- Wind is what matters. Under 10 mph sustained, nothing. 10 to 14, a small
  downgrade to deep passing and long field goals. 15 to 19, a real one. 20 and
  over, heavy.
- Rain likely and measurable, a modest downgrade to passing and a small lift to
  rushing volume.
- Snow expected, heavy.
- Cold alone moves nothing.
- Indoors is the absence of a penalty.

## 7. Written previews

Each upcoming game gets two to four sentences built from templates, every one
citing a figure on the same card: the implied totals and where they rank this
week, the spread, the softest matchup by points allowed to a position, the
forecast and its band. A sentence whose figure is missing is not written.

They are templates and not a language model for the reason the trade verdicts
are: every sentence can be checked against the numbers beside it. Desk-written
previews in the style of the Brief's recaps would need a new desk prompt, a
schema and a review step, and are a separate piece of work.

## 8. Accessibility

- One h1 per page. Sections are h2, cards h3.
- Every bar has its figure printed beside it, and every grid is a real table.
  Nothing on these pages is a chart whose numbers live only in the graphic, so
  the disclosure pattern in `components/chart-kit.tsx` was not needed.
- The heat grids print the number in every cell. Colour repeats it and never
  replaces it.
- Position and sort controls are buttons with `aria-pressed`. The search field
  is labelled and its result count is announced through a polite live region.
- Nothing visible is `aria-hidden` except icons and chart graphics.
- Team logos and headshots are decorative; the name is always adjacent text.
- No data is dropped at any width. A column hidden on a phone has its figures
  in the row's second line.
- Every time shown is Eastern, through `lib/datetime.ts`.

## 9. SEO

- Titles and descriptions per section 3, with the season and week in them
  where it helps.
- Canonical on the bare path. `?pos=` and `?format=` views carry it.
- JSON-LD: breadcrumbs everywhere, an ItemList of the leaders, FAQPage on the
  hub and the weather page.
- Sitemap: the hub, the three sub-pages and every week from 1 to the live one.
- Every registry a top-level route belongs in: the menu, the stored menu order,
  the footer, header search, breadcrumbs, share cards, llms.txt, reserved
  handles.

## 10. Screen sizes

Checked in Chrome on the running app before the build is called done, on every
route: 360, 390, 768, 1024, 1440 and 1920 pixels wide. For each: no sideways
page scroll, no clipped text, every control at least 44 pixels, tables that
scroll inside their own region, and the layout looking deliberate rather than
merely not broken.

## 11. Build order

1. Migrations: `nfl_stadiums`, `nfl_game_weather`, the stored menu order, the
   reserved handle.
2. Weather adapter, sync, cron and first run.
3. `lib/season-pulse/`: context, loaders, the pure board, spotlights,
   projection report, results, previews.
4. Components and the five routes.
5. Registries.
6. The gate: typecheck, lint, test, build.
7. Chrome pass at every width.
8. Review sub-agents: implementation, accessibility, security. Fix what they
   find.

## 12. What changed while building

- The hub's order is fantasy, then this week's games, then the NFL block. The
  upcoming games carry the forecast and the projections, which is lineup
  material, so they sit above the results and the NFL leaders.
- Starter weeks is a column of the week by week view and a sort option, not
  its own section. The week by week grid lives inside the leaders board as a
  second view, so position, sort and search carry across both.
- No `loading.tsx`. With a loading boundary the page starts streaming before
  the week is validated, and a week that does not exist answered 200 with the
  not-found page inside it. Without one it is a real 404, which is what the
  waiver wire's weekly pages do.
- Two-column card layouts start at the 2xl breakpoint. The content column
  sits between the navigation rail and the page rail, so at 1440 pixels it is
  about 720 wide and two cards side by side were cramped.
- Screen sizes checked in Chrome: 500, 768, 1024, 1440 and the widest the
  monitor allows (1568). Chrome will not make a window narrower than 500
  pixels and the site refuses to be framed, so 360 was checked by
  constraining the page body to 360 pixels at the 500 pixel breakpoint set,
  which is the same set of rules a 360 pixel phone gets.

## 13. Not in this build

- Weather effects inside the projection engine.
- Players to watch before week 1. The list is drawn from players with a game
  this season, so it is empty until the first games are played, and a player
  returning from injury who has not played yet is not on it.
- The historical weather backfill.
- Desk-written previews.
- Live in-game scoring.
- Defensive players on the leaders board.
