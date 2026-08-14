-- Merge the three Beacon Brief duplicate pairs left live by the 2026-08-04 to
-- 2026-08-08 window, and repair the two slugs a Cyrillic lookalike broke.
--
-- WHY
-- Between 2026-08-04 and 2026-08-08 the pipeline published 31 near-duplicate article
-- pairs, measured as two articles inside 96 hours whose titles score above 0.5 on
-- pg_trgm similarity. The event key added in that window closed the hole: the count is
-- 14 on 08-06, 9 on 08-07, 2 on 08-08, and zero every day since. Most of the pairs were
-- cleaned up as they happened. Three were not, and both halves are still published:
--
--   26 min   peter-skoronski-extension-titans            (survivor)
--            peter-skoronski-titans-extension
--    9 min   jedrick-wills-first-team-lt-bears-camp      (survivor)
--            jedrick-wills-first-team-lt-bears
--    4 days  jak-bi-lane-ravens-training-camp            (survivor)
--            jakob-lane-ravens-training-camp
--
-- The first two are the same report written twice, minutes apart, from the same source
-- reporter. The Lane pair is four days apart and is the same story told twice: both
-- articles lead on the same one-handed sideline catch, the same 30-yard grab over
-- Marlon Humphrey and Malaki Starks, the same Eric DeCosta quote, and the same depth
-- chart. The later one adds new quotes, which the merge keeps.
--
-- Google resolves duplicates by indexing one URL and withholding the rest, which is a
-- direct contributor to pages sitting in "Discovered - currently not indexed".
--
-- THE SLUGS
-- jak-bi-lane-ravens-training-camp and jak-bi-lane-michael-thomas-comparison-ravens
-- both mangle Ja'Kobi. The writer returned a slug containing U+043E, the Cyrillic small
-- letter o, which is drawn like a Latin o and is not one, so slugify hyphenated it as
-- punctuation and split the name. lib/beacon-brief/slug.ts now folds lookalikes and
-- deletes apostrophes rather than breaking words on them; this migration repairs the
-- two URLs already published. The Michael Thomas article is a different story and is
-- NOT merged, only renamed.
--
-- WHAT THIS DOES
--   1. Rewrites each survivor to carry every fact from both articles. The prose was
--      written by hand for this migration, not generated through the Anthropic API.
--   2. Unions article_players and article_teams onto the survivor.
--   3. Repoints news_ingestions.article_id from the archived row to the survivor, so a
--      later follow-up post on the same story revises the live article.
--   4. Sets the archived rows to status 'archived'. Both the sitemap (app/sitemap.ts)
--      and the public feed (lib/beacon-brief-feed.ts) filter on status = 'published',
--      so those URLs leave the sitemap immediately.
--   5. Corrects the two Ja'Kobi slugs.
--   6. last_updated is bumped on survivors because the content genuinely changed. The
--      article page surfaces an "Updated" line when last_updated exceeds published_at
--      by more than a minute, which is accurate here.
--
-- REDIRECTS
-- Every retired slug, including the two that were only renamed, is 308-redirected in
-- next.config.ts. Next's `permanent: true` emits 308, which Google treats identically
-- to 301. The redirect runs in the routing layer, so a retired slug never reaches the
-- page component.
--
-- CANONICALS
-- canonical_url stays NULL. app/brief/[slug]/page.tsx falls back to
-- `${SITE.url}/brief/${slug}`, which is the correct self-referencing canonical and
-- cannot go stale when a slug moves.
--
-- ACCESS MATRIX (unchanged by this migration)
--   articles          SELECT public where status = 'published'; writes service_role only
--   article_players   SELECT public; writes service_role only
--   article_teams     SELECT public; writes service_role only
--   news_ingestions   service_role only
-- No DDL here, so no RLS policy changes and no type regeneration are required.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps the file in a single
-- transaction, so an error in any statement rolls back all of them.

-- ---------------------------------------------------------------------------
-- 1. Peter Skoronski extension
-- ---------------------------------------------------------------------------

update articles set
  meta_description = 'Peter Skoronski signed a four-year, $100 million Titans extension with $88 million guaranteed, making him the NFL''s highest-paid guard. What it means for Cam Ward.',
  tl_dr = $tldr$The Tennessee Titans signed left guard Peter Skoronski to a four-year, $100 million extension with $88 million guaranteed, roughly $25 million a year, which makes him the highest-paid guard in the NFL. He passes Cowboys guard Tyler Smith at the top of that market. Skoronski scores no fantasy points. He is the interior protection in front of Cam Ward, and Tennessee has now committed to keeping him there for four more years.$tldr$,
  tags = array['contract extension', 'contract', 'offensive line', 'guard', 'Peter Skoronski', 'Titans'],
  content_md = $body$Peter Skoronski is the highest-paid guard in the NFL. The Titans and Skoronski, G, Tennessee Titans, agreed to terms on a four-year, $100 million extension that includes $88 million guaranteed, per Ian Rapoport and Adam Schefter. Tom Davenport first reported the agreement. The Titans confirmed he is staying in Nashville on a multi-year deal.

At roughly $25 million a year, he passes Dallas Cowboys guard Tyler Smith, who had topped the guard market at $24 million.

## Who Skoronski is

Tennessee took Skoronski 11th overall in the 2023 draft out of Northwestern and moved him inside from college tackle. He has missed three games in his career, has started every available game since he entered the league, played every offensive snap in 2024, and played all 17 in each of the last two seasons.

Last season he posted an 84.5 pass-blocking grade at Pro Football Focus, second among all guards. The Titans had already exercised his fifth-year option in April 2026, worth $19.07 million for 2027, so this extension is a raise on top of a year they had already secured.

Neither side hid where this was heading. General manager Mike Borgonzi called the extension talks positive as far back as the 2026 combine and named them a priority. Skoronski had said publicly that he wanted to stay in Tennessee.

## Why this matters for Cam Ward

Skoronski is not draftable in any standard format. The reason to care is the quarterback standing behind him.

Cam Ward is Tennessee's franchise quarterback and the player the entire roster is being assembled around. Interior pressure is the kind a quarterback cannot step up to escape, and it is the single most reliable predictor of a young passer struggling. Tennessee just paid record money at the position to make sure that particular problem is not Ward's problem.

## What changes for your roster

Nothing directly, and be suspicious of anyone who tells you an offensive line signing moves a projection on its own.

What it does is narrow the range of outcomes for the Titans offense. Tennessee had real protection problems in 2025 and this does not fix all of them. It does settle the best part of that line for four more years. If you are holding Ward in dynasty, or weighing a Tennessee pass catcher or running back late in a draft, that is one reason to believe the floor is higher than last season's results suggest. The front office has now put its most expensive contract in front of its most important player.$body$,
  last_updated = now()
where slug = 'peter-skoronski-extension-titans';

-- ---------------------------------------------------------------------------
-- 2. Jedrick Wills first-team reps, and the Luther Burden III exit
--
-- The two articles disagreed about Burden. The earlier one said the source post was
-- truncated and it was unclear whether he stayed at practice; the later one said he
-- exited early with an apparent lower body injury. The later reading is the one the
-- 08-10 groin article confirms, so the merged text states it and links the follow-up.
-- ---------------------------------------------------------------------------

update articles set
  title = 'Jedrick Wills gets first-team LT reps, Luther Burden III exits Bears practice',
  meta_description = 'Jedrick Wills took first-team left tackle reps at Bears camp. Luther Burden III left Saturday''s practice early after a fall in red zone one-on-ones.',
  tl_dr = $tldr$Jedrick Wills, OT, Chicago Bears, worked with the first-team offense at left tackle in a red zone-heavy Saturday practice, per Courtney Cronin of ESPN. Wide receiver Luther Burden III and cornerback Tyrique Stevenson fell awkwardly on their final one-on-one rep. Burden left practice early with what looked like a lower body injury; Stevenson stayed after a trainer attended to him. Burden had already missed the start of camp with a hamstring problem, so his availability is the part of this with fantasy consequences.$tldr$,
  content_md = $body$Jedrick Wills Jr., OT, Chicago Bears, is getting first-team left tackle reps in a practice built around the red zone, across one-on-ones and 11-on-11s, according to Courtney Cronin of ESPN.

The Bears have a crowded left tackle competition. Multiple training camp reports have Braxton Jones, Wills, Kiran Amegadjie, and Theo Benedet rotating there this summer, with Jones described as the favorite. Head coach Ben Johnson has called Wills "firmly in the mix," per the Chicago Sun-Times. Wills is in his first season in Chicago after missing 2025 with an injury.

## Luther Burden III left practice early

Burden, WR, Chicago Bears, and cornerback Tyrique Stevenson got tangled on their final one-on-one red zone rep and both fell awkwardly, per Cronin. Stevenson stayed at practice after a trainer looked at him. Burden exited early with what appeared to be a lower body injury.

That is the part with fantasy consequences. Burden had already missed the start of camp with a hamstring issue he picked up in spring OTAs, and a young receiver in a Bears offense with questions at the position cannot afford the lost reps.

The injury turned out to be a groin strain that is expected to cost him the preseason, with Chicago still expecting him back for the opener. See [Luther Burden III groin injury: expected back for Week 1](/brief/luther-burden-iii-groin-injury-week-1).

## What to watch

Wills taking first-team reps matters to the extent that the left tackle job affects Caleb Williams' protection and the Bears' run game. For fantasy purposes, Burden is the more immediate thing to track. Check the injury report before you lock in any Bears skill player.$body$,
  last_updated = now()
where slug = 'jedrick-wills-first-team-lt-bears-camp';

-- ---------------------------------------------------------------------------
-- 3. Ja'Kobi Lane at Ravens camp
--
-- The survivor is the earlier article, so the published date stays honest, but its
-- slug is replaced with a correctly spelled one. Both retired spellings redirect.
-- The Michael Thomas comparison is a separate live article and is linked, not folded
-- in, so the merge does not swallow a story that stands on its own.
-- ---------------------------------------------------------------------------

update articles set
  slug = 'jakobi-lane-ravens-training-camp',
  meta_description = 'Rookie WR Ja''Kobi Lane is the standout of Ravens 2026 training camp, with a highlight catch nearly every day and the WR3 job behind Zay Flowers in reach.',
  tl_dr = $tldr$Ravens rookie wide receiver Ja'Kobi Lane (WR, Baltimore) has been the story of 2026 training camp, with a one-handed sideline catch, a leaping 30-yard grab over Marlon Humphrey and Malaki Starks, and praise from Lamar Jackson and offensive coordinator Declan Doyle. ESPN's Jamison Hensley, who has covered the team for 27 years, says he has never seen a rookie camp like it. The 6-foot-4 third-round pick out of USC is the leading candidate for the WR3 role behind Zay Flowers and Rashod Bateman, which makes him a dynasty add now and a redraft name to watch through the preseason.$tldr$,
  tags = array['training camp', 'depth chart', 'rookie', 'wide receiver', 'Ja''Kobi Lane', 'Baltimore Ravens'],
  content_md = $body$## Ja'Kobi Lane is making Ravens training camp his own

Rookie wide receiver Ja'Kobi Lane (WR, Baltimore Ravens) has been the standout player at Ravens 2026 training camp. ESPN's Jamison Hensley, retweeted by Adam Schefter, reported that Lane cemented that status on Tuesday with another highlight-reel showing. Hensley, who has covered the Ravens for 27 years, says he has never seen a rookie camp quite like it, and that Lane produces a highlight catch every single day.

The play getting the most attention is a one-handed sideline catch that The Athletic's Jeff Zrebiec described as "one of the better practice catches you'll ever see," made while Lane was falling down and well covered. Head coach Jesse Minter said the catch would go a long way with Lamar Jackson and the offense, adding that Lane has "continued to flash and make those type of plays."

On Day 2 of camp, Lane elevated over four-time Pro Bowl cornerback Marlon Humphrey and safety Malaki Starks to haul in a 30-yard pass from Jackson, drawing loud cheers from the crowd. At the first padded practice he beat veteran cornerback Chidobe Awuzie on a fly route for a long touchdown in one-on-ones. Per the Ravens' official site, he also made a third-down catch in 11-on-11s that sparked a drive Derrick Henry finished with a rushing touchdown, and soared for a deep ball down the middle in a 7-on-7 period. One catch was good enough that Henry leapt to celebrate it.

## What Lane brings to the depth chart

Lane is a 2026 third-round pick (80th overall) out of USC. He is 6-foot-4, 200 pounds, with a reported 40-inch vertical, and the catches look like it. Ravens GM Eric DeCosta said at the draft that he expected Lane to "earn the trust of Lamar" and "be a player that can be counted on to make big plays." Early camp suggests DeCosta is getting exactly that.

Jackson told SI.com: "Oh man, this guy is different. He is different, long arms, strong hands. I am going to say he is a physical receiver." Offensive coordinator Declan Doyle went further and compared Lane's hands to Michael Thomas's, which carries some weight given where Doyle worked before Baltimore. See [Ja'Kobi Lane hands compared to Michael Thomas by Ravens OC](/brief/jakobi-lane-michael-thomas-comparison-ravens). Flowers, the team's No. 1 receiver, says Lane works every day, listens, and applies coaching quickly.

Flowers is locked in at the top after signing a four-year, $140 million extension. Rashod Bateman holds the No. 2 role coming off a disappointing 2025. Behind them, Lane is competing with Devontez Walker, Chris Moore, and fellow rookie Elijah Sarratt for the WR3 spot and a roster place, and per SI.com the Ravens are expected to run more 11 personnel under Doyle this season, which puts a third receiver on the field more often.

Minter said consistency is what he is watching for now: "The confidence has to come when you do it day after day, period after period. Then the teammates gain confidence in them when they do that."

## What this means for your roster

Lane's size and catch radius give Jackson something Baltimore has not had in recent years: a real contested-catch and red zone target on the outside. If he holds the WR3 role, volume may be limited in a run-heavy offense, but the touchdown upside in a Lamar Jackson system is real.

In dynasty leagues, Lane is worth adding now if he is available. In redraft, monitor his preseason snaps. If he is seeing starter reps alongside Flowers, he is a speculative add before the season opens.$body$,
  last_updated = now()
where slug = 'jak-bi-lane-ravens-training-camp';

-- ---------------------------------------------------------------------------
-- 4. Repair the second broken Ja'Kobi slug. Different story, rename only.
-- ---------------------------------------------------------------------------

update articles set slug = 'jakobi-lane-michael-thomas-comparison-ravens'
where slug = 'jak-bi-lane-michael-thomas-comparison-ravens';

-- ---------------------------------------------------------------------------
-- 5. Carry entity links and ingestion pointers onto the survivors
--
-- The pair mapping is repeated as an inline VALUES list per statement rather than held
-- in a temp table, so each statement stands alone. Survivor slugs are the NEW ones,
-- because step 3 has already renamed the Lane row.
--
-- article_revisions is deliberately NOT repointed. Its UNIQUE (article_id,
-- revision_number) constraint would collide, and the revision log is an audit trail of
-- what happened to one specific row, so it stays with the row it describes.
-- ---------------------------------------------------------------------------

insert into article_players (article_id, player_id)
select s.id, ap.player_id
from (values
  ('peter-skoronski-extension-titans', 'peter-skoronski-titans-extension'),
  ('jedrick-wills-first-team-lt-bears-camp', 'jedrick-wills-first-team-lt-bears'),
  ('jakobi-lane-ravens-training-camp', 'jakob-lane-ravens-training-camp')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
join article_players ap on ap.article_id = d.id
on conflict (article_id, player_id) do nothing;

insert into article_teams (article_id, team_id)
select s.id, at2.team_id
from (values
  ('peter-skoronski-extension-titans', 'peter-skoronski-titans-extension'),
  ('jedrick-wills-first-team-lt-bears-camp', 'jedrick-wills-first-team-lt-bears'),
  ('jakobi-lane-ravens-training-camp', 'jakob-lane-ravens-training-camp')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
join article_teams at2 on at2.article_id = d.id
on conflict (article_id, team_id) do nothing;

update news_ingestions ni set article_id = s.id
from (values
  ('peter-skoronski-extension-titans', 'peter-skoronski-titans-extension'),
  ('jedrick-wills-first-team-lt-bears-camp', 'jedrick-wills-first-team-lt-bears'),
  ('jakobi-lane-ravens-training-camp', 'jakob-lane-ravens-training-camp')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
where ni.article_id = d.id;

-- ---------------------------------------------------------------------------
-- 6. Archive the duplicate rows and drop their entity links, so the sidebar's
--    "players and teams in the news" scan and the /brief/player and /brief/team
--    filter pages count only live coverage.
-- ---------------------------------------------------------------------------

delete from article_players
where article_id in (
  select id from articles where slug in (
    'peter-skoronski-titans-extension',
    'jedrick-wills-first-team-lt-bears',
    'jakob-lane-ravens-training-camp'
  )
);

delete from article_teams
where article_id in (
  select id from articles where slug in (
    'peter-skoronski-titans-extension',
    'jedrick-wills-first-team-lt-bears',
    'jakob-lane-ravens-training-camp'
  )
);

update articles set status = 'archived', last_updated = now()
where slug in (
  'peter-skoronski-titans-extension',
  'jedrick-wills-first-team-lt-bears',
  'jakob-lane-ravens-training-camp'
) and status = 'published';
