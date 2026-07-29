-- Merge four sets of duplicate Beacon Brief articles into one canonical URL each.
--
-- WHY
-- An SEO audit found four pairs of published articles that cover the identical news
-- event, each pair published seconds apart:
--
--   37s   jacoby-brissett-cardinals-reworked-contract-2026  (survivor)
--         jacoby-brissett-new-deal-cardinals-2026-starter
--   47s   cardinals-ryan-gold-suspended-indefinitely-gambling-policy  (survivor)
--         nfl-suspends-cardinals-ryan-gold-gambling
--   89s   kyle-shanahan-car-accident-limited-49ers-training-camp-2026  (survivor)
--         kyle-shanahan-car-accident-chris-foerster-49ers-training-camp
--  130s   geno-smith-battery-investigation-closed-no-charges  (survivor)
--         geno-smith-case-inactive-no-charges
--
-- All eight came from the same X source (AdamSchefter). The follow-up matcher in
-- lib/beacon-brief/curate.ts (recentArticlesForSource) only considers ingestions that
-- already have a non-null article_id, so when two posts about one event arrive in the
-- same poll window, the second is curated before the first has produced an article and
-- no revision target exists. Both take the 'create' path. This migration cleans up the
-- articles; the matcher race itself is a separate fix.
--
-- Google resolves duplicates by indexing one URL and withholding the rest, which is a
-- direct contributor to pages sitting in "Discovered - currently not indexed".
--
-- WHAT THIS DOES
--   1. Rewrites each survivor to carry every fact from both articles. The prose was
--      written by hand for this migration, not generated through the Anthropic API.
--   2. Unions article_players and article_teams onto the survivor.
--   3. Repoints news_ingestions.article_id from the archived row to the survivor, so a
--      later follow-up post on the same story revises the live article.
--   4. Sets the archived rows to status 'archived'. Both the sitemap (app/sitemap.ts)
--      and the public feed (lib/beacon-brief-feed.ts) filter on status = 'published',
--      so the archived URLs leave the sitemap immediately.
--   5. last_updated is bumped on survivors because the content genuinely changed. The
--      article page surfaces an "Updated" line when last_updated exceeds published_at
--      by more than a minute, which is accurate here.
--
-- CANONICALS
-- canonical_url is deliberately left NULL. app/brief/[slug]/page.tsx already falls back
-- to `${SITE.url}/brief/${slug}`, which is the correct self-referencing canonical.
-- Hardcoding the string would create a stale-canonical footgun if a slug ever moved.
--
-- REDIRECTS
-- The four archived slugs are 308-redirected to their survivor in next.config.ts. Next's
-- `permanent: true` emits 308, which Google treats identically to 301. The redirect runs
-- in the routing layer, so an archived slug never reaches the page component.
--
-- ACCESS MATRIX (unchanged by this migration)
--   articles            SELECT public where status = 'published'; writes service_role only
--   article_players     SELECT public; writes service_role only
--   article_teams       SELECT public; writes service_role only
--   news_ingestions     service_role only
-- No DDL here, so no RLS policy changes and no type regeneration are required.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps the file in a single
-- transaction, so an error in any statement rolls back all of them.

-- ---------------------------------------------------------------------------
-- 1. Jacoby Brissett contract
-- ---------------------------------------------------------------------------

update articles set
  title = 'Jacoby Brissett contract: $15.5M guaranteed from Cardinals',
  meta_description = 'The Cardinals reworked Jacoby Brissett''s contract to $15.5 million fully guaranteed, up to $21 million with incentives. His 2026 fantasy outlook inside.',
  tl_dr = $tldr$Jacoby Brissett and the Arizona Cardinals agreed on a reworked contract worth $15.5 million fully guaranteed, with incentives that could push the total to $21 million. No new years were added, so he still reaches free agency after 2026. The deal ends a standoff that ran from voluntary OTAs through the first day of training camp and confirms him as Arizona's uncontested starter. Treat him as a low-end QB2 and a matchup-based streamer.$tldr$,
  tags = array['contract extension', 'contract', 'quarterback', 'Cardinals', 'salary rework'],
  content_md = $body$The Jacoby Brissett contract dispute is over. Brissett and the Arizona Cardinals agreed on a reworked deal worth $15.5 million fully guaranteed, with incentives that could push the total to $21 million, per Adam Schefter. ESPN's Jeremy Fowler first reported that an agreement had been reached. Brissett was previously set to earn a $4.88 million base salary with just $1.5 million guaranteed in 2026, the lowest guaranteed figure of any projected starter not on a rookie contract.

No new years were added. Brissett, QB, Arizona Cardinals, remains on track to become an unrestricted free agent after the 2026 season.

## How the standoff played out

Brissett, 33, negotiates his own contracts without an agent. After Arizona told him he was the QB1 entering 2026, he pushed back on a paycheck that ranked him behind several veteran backups in guaranteed money. Gardner Minshew, signed as Arizona's backup at $5.75 million per year, carried $5.14 million guaranteed on his own deal.

Brissett skipped all voluntary OTAs and was limited to individual drills at mandatory minicamp in June. The two sides were described as significantly far apart as recently as May. On July 22, the day before camp opened, Ian Rapoport of NFL Network reported they were still apart on a number, though both agreed Brissett deserved a raise. He reported on time, took reps last in every drill on Day 1 on July 23, and the contract was finished shortly after. Arizona Sports reporter John Gambadoro had pegged his ask at roughly $15 million for the season, which is close to where it landed.

## How he became the starter

Brissett originally signed a two-year, $12.5 million contract with Arizona in March 2025 as Kyler Murray's backup. When Murray suffered a season-ending foot injury, Brissett took over in Week 6 and never gave the job back. Across 12 starts he completed 64.9% of his passes for 3,366 yards, 23 touchdowns, and 8 interceptions, the best statistical season of his career. He ranked among the better quarterbacks in the league on a per-dropback basis from Week 6 onward.

Arizona went 1-11 in those starts, but the offense averaged 284.1 passing yards per game, nearly 100 more than it managed with Murray. This offseason the Cardinals released Murray, who later signed with the Vikings, drafted Carson Beck in the third round, and brought in Minshew as the veteran backup. Naming Brissett the starter in March 2026 is what triggered the compensation dispute.

## What this means for your fantasy roster

The clarity is real. The uncertainty that gave Minshew first-team reps through the offseason is gone, and Brissett is the uncontested starter heading into 2026.

Four things still cap his ceiling:

- First-year head coach Mike LaFleur is installing a new offense, and Brissett missed all voluntary OTAs and most of minicamp. His time to absorb the system has been compressed.
- Rookie running back Jeremiyah Love is in the backfield mix. If Arizona leans on the run, Brissett's pass volume gets capped.
- Beck is not expected to push for the job immediately, but he is on the roster.
- Arizona has gone 15-36 in the Ossenfort era and carries a tough early schedule.

Brissett is a low-end QB2 and a streaming option in 2026, much as he was in 2025. His 23-touchdown, 8-interception line is a reasonable baseline for what to expect. Add him in deeper leagues if he is available and start him against weak pass defenses.

For dynasty managers, the structure matters more than the money. No new years means his long-term hold value in Arizona is essentially zero. Beck is the presumptive franchise quarterback. Treat Brissett as a one-year bridge and roster him accordingly.$body$,
  last_updated = now()
where slug = 'jacoby-brissett-cardinals-reworked-contract-2026';

-- ---------------------------------------------------------------------------
-- 2. Ryan Gold gambling suspension
-- ---------------------------------------------------------------------------

update articles set
  title = 'Ryan Gold suspended indefinitely for NFL gambling violations',
  meta_description = 'The NFL suspended Cardinals scouting director Ryan Gold indefinitely for parlay betting and leaking 2026 draft plans. He is appealing the ruling.',
  tl_dr = $tldr$The NFL suspended Arizona Cardinals Director of College Scouting Ryan Gold indefinitely for two gambling policy violations: placing parlay bets on NFL and college games, and sharing confidential information about the team's 2026 draft selections before those picks were announced. Gold has filed an appeal and his attorney calls the accusations blatantly false. No Cardinals players are implicated, so there is nothing actionable for your roster.$tldr$,
  content_md = $body$## Ryan Gold suspended indefinitely for gambling policy violations

The NFL has suspended Arizona Cardinals Director of College Scouting Ryan Gold indefinitely for violating the league's gambling policy, per Rob Maaddi of the Associated Press, with Adam Schefter amplifying the report. The league has confirmed the suspension.

The investigation found two violations. Gold placed parlay bets on NFL and college games, which is prohibited for all NFL personnel. He also shared confidential, non-public information about the Cardinals' 2026 draft selections with third parties before those picks were publicly announced. The NFL did not identify who received that information.

The league addressed the integrity question directly in its statement: "Although there is no reason to believe the integrity of any NFL game was affected, the League takes any violation of the Gambling Policy with the utmost seriousness."

## Who is Ryan Gold?

Gold is in his 13th season with the Cardinals. He was promoted to Director of College Scouting in June 2025 after three seasons as Assistant Director of College Scouting from 2022 through 2024.

## Gold is appealing and his attorney disputes the findings

Gold's attorney has called the NFL's accusations "blatantly false." Gold has filed an appeal, as the policy entitles him to do.

## What this means for your fantasy roster

This is a front-office matter. Gold is a scout, not a player or a coach, and no Cardinals players or coaches are implicated. No Arizona player is suspended or injured as a result, so there is nothing actionable in redraft formats and nothing about current Cardinals depth charts or workloads changes today.

Dynasty managers tracking Arizona's incoming rookie pipeline have a reason for a passive watch. The Cardinals are a rebuilding team heading into the 2026 draft cycle, and losing the executive who runs college scouting mid-cycle adds uncertainty to an already unsettled front office. The leak of non-public information about Arizona's draft intentions is the part worth following. Watch how the team fills or redistributes Gold's responsibilities as draft season builds.$body$,
  last_updated = now()
where slug = 'cardinals-ryan-gold-suspended-indefinitely-gambling-policy';

-- ---------------------------------------------------------------------------
-- 3. Kyle Shanahan car accident
--
-- Category moves from Injuries to Coaching & Scheme. The merged article is a
-- coaching-staff and camp-operations story about a head coach, not a player injury,
-- and the Injuries filter should stay player-focused for fantasy managers.
-- ---------------------------------------------------------------------------

update articles set
  title = 'Kyle Shanahan car accident limits him at 49ers camp',
  meta_description = 'Kyle Shanahan broke his nose, three ribs, and his hand in a mid-July car accident. He attended the first 49ers camp practice but Chris Foerster ran it.',
  tl_dr = $tldr$Kyle Shanahan broke his nose, three ribs, and his hand and needed more than 40 stitches in a mid-July car accident. He attended the first 49ers training camp practice but stood nearby while assistant head coach Chris Foerster ran the session. Play-calling stays with Klay Kubiak, so there is no immediate fantasy impact, but Shanahan's limited on-field time matters for scheme installation with San Francisco's new receivers.$tldr$,
  article_type = 'coaching-scheme',
  category_id = 'eac46698-d712-464e-989f-1fb516323be8',
  tags = array['Kyle Shanahan', 'Chris Foerster', '49ers', 'injury', 'training camp', 'coaching'],
  content_md = $body$## Kyle Shanahan car accident: what we know

San Francisco 49ers head coach Kyle Shanahan broke his nose, three ribs, and his hand in a car accident during his summer break in mid-July, and needed more than 40 stitches in his face. ESPN's Adam Schefter reported the injuries on July 25, the day veterans reported to the SAP Performance Facility in Santa Clara, with Nick Wagoner adding details. Schefter's original post was truncated, so the confirmed injury list may not be complete.

Paramedics took Shanahan to a local hospital, where he spent much of the day before being released. The other driver was not injured. Palo Alto lieutenant Nicholas Martinez confirmed that drugs and alcohol were not involved and that both drivers were cooperative.

Shanahan informed his assistant coaches on Tuesday. Players received the news around the time the team opened camp.

Shanahan later said the crash was his fault. See [Kyle Shanahan admits fault in car crash that nearly cost him his eye](/brief/kyle-shanahan-car-crash-eye-injury) for what he said on July 28.

## Foerster ran the first practice with Shanahan standing nearby

Chris Foerster, the 49ers' assistant head coach and offensive line coach, led the first training camp practice as a fired-up presence on the field. Shanahan attended but stood nearby rather than running the session himself.

Foerster has been with the 49ers since 2019 and was promoted to assistant head coach in 2025. He and Shanahan worked together on the Washington coaching staff from 2010 to 2013.

Offensive coordinator Klay Kubiak already holds play-calling responsibilities, so the offensive chain of command stays intact. Shanahan is expected to be limited during camp rather than absent from it.

## What this means for your fantasy roster

This is a team operations story, not a player injury, so there is no immediate fantasy impact. Shanahan's presence at practice is a good sign, but standing on the sideline rather than coaching confirms he is not yet fully operational.

Scheme-wise, not much should change. Shanahan's system is deeply installed and his staff knows it well. Play-calling philosophy is not going to shift because the head coach has a broken hand and bruised ribs.

What is worth watching is his hands-on time with skill-position players during a camp where that time actually matters. Shanahan runs one of the most system-dependent offenses in the league, and early camp is when scheme installation and rep quality get set. Wide receivers Mike Evans and Christian Kirk are learning the offense from scratch this summer, and Shanahan's ability to work with them directly on the field may be limited.

Assets to track as camp continues:

- QB Brock Purdy
- RB Christian McCaffrey, with Shanahan having publicly discussed reducing his 413-touch workload from 2025
- WR Mike Evans and WR Christian Kirk, both new to the system
- WR Brandon Aiyuk, whose status remains uncertain

San Francisco also carries a long recovery list. TE George Kittle (torn Achilles), DE Nick Bosa (torn ACL), and LB Fred Warner (fractured ankle) are all working back.

The 49ers' 2026 camp window runs July 26 to August 12. Watch the receiver depth chart through the first week. If Evans or Kirk emerges as a clear target-share option early, that is the signal to act on the waiver wire before the rest of your league catches on. If Shanahan's recovery limits his involvement deeper into camp, this becomes a more pressing story for anyone holding San Francisco offensive pieces.$body$,
  last_updated = now()
where slug = 'kyle-shanahan-car-accident-limited-49ers-training-camp-2026';

-- ---------------------------------------------------------------------------
-- 4. Geno Smith battery investigation
-- ---------------------------------------------------------------------------

update articles set
  title = 'Geno Smith battery investigation closed, no charges filed',
  meta_description = 'Davie police closed the Geno Smith battery investigation with no charges filed. He remains the Jets QB1 for 2026 with the legal overhang cleared.',
  tl_dr = $tldr$The Davie, Florida police department has closed its battery investigation into Jets quarterback Geno Smith and confirmed he will not be charged. Smith was never arrested and the case has been formally declared inactive. The NFL could still review the matter under its personal conduct policy, but no suspension appears imminent. Smith remains New York's starter on a one-year, $3.3 million deal, so the legal overhang on his 2026 outlook is gone.$tldr$,
  tags = array['Geno Smith', 'battery investigation', 'investigation', 'cleared', 'New York Jets', 'legal'],
  content_md = $body$## Geno Smith battery investigation is over

The Davie, Florida police department has closed its battery investigation into New York Jets quarterback Geno Smith (QB, NYJ), and Smith will not be charged. ESPN's Rich Cimini reported the closure, with Adam Schefter amplifying. The case has been formally declared inactive.

The matter stemmed from a June 21 incident at Smith's home in Davie. A woman who identified herself as his ex-girlfriend called 911 the following day, alleged she had been battered, and posted a video to Instagram Stories saying Smith "ran outside and attacked me." Officers responded around 4:40 p.m. and found no grounds for an arrest at the scene. Smith was never arrested.

The investigation took an uneven path. Davie police initially said the case was not active, then reversed course and confirmed it had been assigned to a detective and was under investigation. It has now concluded without charges. Further investigative action would only follow if additional information surfaces.

## What this means for NFL discipline

The NFL had been monitoring the situation under its personal conduct policy, which lets the league act independent of criminal proceedings. With no charges filed, the likelihood of league discipline has dropped significantly, though whether the NFL takes any further step is still unclear.

Cimini had said that even in a hypothetical where Smith was charged and a case was adjudicated, he would be "very, very surprised if something impacts his availability" for the current season.

## Fantasy outlook for Geno Smith in 2026

This clears the biggest off-field cloud over Smith's season. His hold on the starting job was never in roster doubt, but the legal uncertainty was a real wildcard for redraft and dynasty managers.

Smith was acquired from the Las Vegas Raiders in March 2026 and named the starter immediately. He heads into 2026 as Jets QB1 on a one-year, $3.3 million contract, and New York opens against the Tennessee Titans in Week 1.

The football questions are the ones that remain. Smith is 35 and two years removed from a 4,320-yard season with Seattle in 2024. His 2025 run with the Raiders was rough: 17 interceptions in 15 starts and just 12.7 fantasy points per game. The Jets are a better situation, with Garrett Wilson as his top target, first-round rookie pass catchers Kenyon Sadiq and Omar Cooper Jr., and a solid offensive line.

Watch for any NFL communication over the coming weeks, but there is no reason to downgrade Smith's standing on this matter. Whether he is worth rostering in 2026 redraft leagues comes down to your confidence in a bounce-back at 35 in a new system.$body$,
  last_updated = now()
where slug = 'geno-smith-battery-investigation-closed-no-charges';

-- ---------------------------------------------------------------------------
-- 5. Carry entity links and ingestion pointers onto the survivors
--
-- The pair mapping is repeated as an inline VALUES list per statement rather than
-- held in a temp table, so each statement stands alone and the migration does not
-- depend on how the runner wraps it in a transaction.
--
-- article_revisions is deliberately NOT repointed. Its UNIQUE (article_id,
-- revision_number) constraint would collide: every article in these four pairs
-- already carries revision numbers starting at 1. The revision log is an internal
-- audit trail of what happened to one specific article row, so it stays attached to
-- the row it describes. The archived rows remain in the table, just not published.
-- ---------------------------------------------------------------------------

-- Union the archived article's players onto the survivor.
insert into article_players (article_id, player_id)
select s.id, ap.player_id
from (values
  ('jacoby-brissett-cardinals-reworked-contract-2026', 'jacoby-brissett-new-deal-cardinals-2026-starter'),
  ('cardinals-ryan-gold-suspended-indefinitely-gambling-policy', 'nfl-suspends-cardinals-ryan-gold-gambling'),
  ('kyle-shanahan-car-accident-limited-49ers-training-camp-2026', 'kyle-shanahan-car-accident-chris-foerster-49ers-training-camp'),
  ('geno-smith-battery-investigation-closed-no-charges', 'geno-smith-case-inactive-no-charges')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
join article_players ap on ap.article_id = d.id
on conflict (article_id, player_id) do nothing;

-- Union the archived article's teams onto the survivor.
insert into article_teams (article_id, team_id)
select s.id, at2.team_id
from (values
  ('jacoby-brissett-cardinals-reworked-contract-2026', 'jacoby-brissett-new-deal-cardinals-2026-starter'),
  ('cardinals-ryan-gold-suspended-indefinitely-gambling-policy', 'nfl-suspends-cardinals-ryan-gold-gambling'),
  ('kyle-shanahan-car-accident-limited-49ers-training-camp-2026', 'kyle-shanahan-car-accident-chris-foerster-49ers-training-camp'),
  ('geno-smith-battery-investigation-closed-no-charges', 'geno-smith-case-inactive-no-charges')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
join article_teams at2 on at2.article_id = d.id
on conflict (article_id, team_id) do nothing;

-- Repoint the archived article's source ingestion at the survivor so a later
-- follow-up post on the same story revises the live article instead of the
-- archived one.
update news_ingestions ni set article_id = s.id
from (values
  ('jacoby-brissett-cardinals-reworked-contract-2026', 'jacoby-brissett-new-deal-cardinals-2026-starter'),
  ('cardinals-ryan-gold-suspended-indefinitely-gambling-policy', 'nfl-suspends-cardinals-ryan-gold-gambling'),
  ('kyle-shanahan-car-accident-limited-49ers-training-camp-2026', 'kyle-shanahan-car-accident-chris-foerster-49ers-training-camp'),
  ('geno-smith-battery-investigation-closed-no-charges', 'geno-smith-case-inactive-no-charges')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
where ni.article_id = d.id;

-- ---------------------------------------------------------------------------
-- 6. Archive the duplicate rows. The 308 redirects in next.config.ts mean these
--    slugs never reach the page component; archiving removes them from the
--    sitemap and the public feed.
--
--    The archived rows' own entity links are dropped afterwards so the sidebar's
--    "players and teams in the news" scan and the /brief/player and /brief/team
--    filter pages count only live coverage.
-- ---------------------------------------------------------------------------

delete from article_players
where article_id in (
  select id from articles where slug in (
    'jacoby-brissett-new-deal-cardinals-2026-starter',
    'nfl-suspends-cardinals-ryan-gold-gambling',
    'kyle-shanahan-car-accident-chris-foerster-49ers-training-camp',
    'geno-smith-case-inactive-no-charges'
  )
);

delete from article_teams
where article_id in (
  select id from articles where slug in (
    'jacoby-brissett-new-deal-cardinals-2026-starter',
    'nfl-suspends-cardinals-ryan-gold-gambling',
    'kyle-shanahan-car-accident-chris-foerster-49ers-training-camp',
    'geno-smith-case-inactive-no-charges'
  )
);

update articles set status = 'archived', last_updated = now()
where slug in (
  'jacoby-brissett-new-deal-cardinals-2026-starter',
  'nfl-suspends-cardinals-ryan-gold-gambling',
  'kyle-shanahan-car-accident-chris-foerster-49ers-training-camp',
  'geno-smith-case-inactive-no-charges'
) and status = 'published';
