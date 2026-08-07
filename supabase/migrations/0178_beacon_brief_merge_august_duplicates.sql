-- Migration 0178: merge the duplicate articles the 2026-08 event-key bug produced.
--
-- WHY
--
-- Migration 0177 explains the defect. This is the cleanup. Between 2026-08-04 and
-- 2026-08-07 the Brief published thirty-six articles covering eleven news events:
--
--   6 -> 1  Jonathan Taylor's two-year Colts extension
--   6 -> 1  Jahmyr Gibbs' three-year Lions extension
--   5 -> 1  Jalon Walker's torn ACL
--   4 -> 1  Stefon Diggs signing with the Commanders
--   3 -> 1  Darnell Wright's Bears extension
--   2 -> 1  Bijan Robinson's Falcons extension
--   2 -> 1  the running back market reset (a genuine roundup, kept as its own article)
--   2 -> 1  Peter Skoronski's Titans extension
--   2 -> 1  O'Cyrus Torrence's Bills extension
--   2 -> 1  Zay Flowers' Ravens extension
--   2 -> 1  Aaron Donald's workout at the Rams facility
--
-- Google resolves duplicates by indexing one URL and withholding the rest, which is a
-- direct contributor to pages sitting in "Discovered - currently not indexed".
--
-- HOW THE REPLACEMENT PROSE WAS WRITTEN
--
-- By hand, for this migration. No Anthropic API call was made to produce any word
-- below, exactly as with migration 0151.
--
-- The duplicates within each cluster CONTRADICT EACH OTHER on matters of fact, which
-- is the part of this incident that matters beyond the SEO. A sample of what was live:
--
--   - Gibbs: one article says David Montgomery "remains in the backfield" on a Lions
--     extension; another says Detroit "traded Montgomery to the Houston Texans in
--     March". His 2025 line is given as both 1,839 and 1,929 scrimmage yards, and both
--     18 and 20 touchdowns.
--   - Jalon Walker: the first article describes a "groin tweak" on August 13 at joint
--     practices with Tennessee under coach Raheem Morris, following a 23-20 preseason
--     loss. None of that is in the source post, which was a quote-tweet stub about the
--     ACL injury on August 4. Three other articles name Kevin Stefanski as head coach.
--   - Taylor: he is called the second-, third-, and top-five-highest-paid back in three
--     different articles. The source post that lists new-money averages puts him third
--     at $22M, behind Gibbs at $22.5M and Robinson at $22.25M.
--   - Diggs: one article places his 2024 ACL tear with New England, another with
--     Houston. His 2025 PFF receiving grade is given as both 82.6 (10th) and 87.5 (6th).
--   - Wright: second-team All-Pro in 2024 in one article and 2025 in another; a torn
--     UCL in one and a shoulder injury in another.
--   - Flowers: five touchdowns in one article, six in another.
--
-- Every merged article below is therefore written from the SOURCE POSTS, which are
-- verbatim reporter statements stored in news_ingestions.text, plus only those
-- supporting details that agree across the duplicates and are contradicted by none of
-- them. Where the duplicates disagree and the posts do not settle it, the detail is
-- left out rather than guessed. Several articles are shorter than the versions they
-- replace for that reason, and that is the correct trade.
--
-- WHAT THIS DOES, PER CLUSTER
--   1. Rewrites the survivor to carry every fact worth keeping from the whole cluster.
--   2. Sets the survivor's event_key (migration 0177) so a future post about the same
--      event folds into it instead of starting the cycle again.
--   3. Unions article_players and article_teams onto the survivor.
--   4. Repoints news_ingestions.article_id from the archived rows to the survivor.
--   5. Archives the duplicates and drops their entity links.
--
-- The event_key is set to the single primary subject of each story, not to every player
-- the article links, because that is what a future post about the same event will
-- resolve to. The Taylor article links Quenton Nelson and DeForest Buckner as well; its
-- key names only Taylor.
--
-- REDIRECTS
-- The 25 archived slugs are 308-redirected to their survivor in next.config.ts. Next's
-- `permanent: true` emits 308, which Google treats identically to 301. The redirect
-- runs in the routing layer, so an archived slug never reaches the page component.
--
-- CANONICALS
-- canonical_url is left NULL. app/brief/[slug]/page.tsx already falls back to
-- `${SITE.url}/brief/${slug}`, the correct self-referencing canonical.
--
-- DISCORD
-- Untouched. Nothing is deleted or edited in the channel.
--
-- ACCESS MATRIX (unchanged by this migration)
--   articles            SELECT public where status = 'published'; writes service_role only
--   article_players     SELECT public; writes service_role only
--   article_teams       SELECT public; writes service_role only
--   news_ingestions     service_role only
-- No DDL, so no RLS policy changes and no type regeneration are required.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps the file in a single
-- transaction, so an error in any statement rolls back all of them.

-- ---------------------------------------------------------------------------
-- The cluster map. Repeated as an inline VALUES list per statement rather than held
-- in a temp table, so each statement stands alone.
-- ---------------------------------------------------------------------------

-- 1. Jonathan Taylor contract
update articles set
  title = 'Jonathan Taylor extension: 2 years, $44M with Colts',
  meta_description = 'Jonathan Taylor signed a two-year, $44 million Colts extension worth up to $47 million with $39 million guaranteed. What it means for his 2026 fantasy value.',
  tl_dr = $tldr$Jonathan Taylor and the Indianapolis Colts agreed on a two-year extension worth $44 million, up to $47 million with incentives, including $39 million guaranteed. He signed it the same day. At $22 million a year in new money he is the third-highest-paid running back in the league, and there is no holdout or trade risk left to price into his draft cost.$tldr$,
  tags = array['contract extension', 'running back', 'Jonathan Taylor', 'Colts', 'contract'],
  content_md = $body$The Jonathan Taylor extension is done. Taylor, RB, Indianapolis Colts, and the team agreed on a two-year deal worth $44 million, worth up to $47 million with incentives, that includes $39 million guaranteed, per Adam Schefter and Ian Rapoport. Taylor signed it later the same day. His agent is Malki Kawa.

Taylor is a three-time Pro Bowl selection.

## Where the contract sits in the running back market

At $22 million a year in new money, Taylor is third among running backs. Jahmyr Gibbs reset the top of the market at $22.5 million with Detroit two days later, and Bijan Robinson sits between them at $22.25 million with Atlanta. Behind those three: Saquon Barkley at $20.6 million, Christian McCaffrey at $19 million, De'Von Achane at $16 million, Derrick Henry at $15 million, and Breece Hall at $14.5 million.

Before this run of deals, one running back in the league earned $20 million a year. Three joined him inside a week.

## What Taylor has produced

Over his last two seasons Taylor has 626 carries, 3,026 rushing yards, and 32 total touchdowns.

## The rest of the Colts offense is paid too

Indianapolis has now handed out major contracts to its quarterback, running back, and receiver in the same offseason: Daniel Jones at two years and $88 million, Taylor at two years and $44 million, and Alec Pierce at four years and $114 million.

Two other Colts starters are entering the final year of their contracts, G Quenton Nelson and DT DeForest Buckner. Neither scores fantasy points, but Nelson's situation is worth a passive watch for anyone counting on Indianapolis to keep blocking the way it has.

## What changes for your roster

Very little, which is the point. Taylor was going to be the lead back in Indianapolis either way; what the contract removes is the tail risk. No holdout, no trade request, no contract-year distraction. Draft him where his workload says to draft him and stop discounting for uncertainty that no longer exists.

For dynasty managers, the two added years mean his situation is settled well past the current window.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Jonathan Taylor'),
  last_updated = now()
where slug = 'jonathan-taylor-colts-extension';

-- 2. Jahmyr Gibbs contract
update articles set
  title = 'Jahmyr Gibbs extension: 3 years, $67.5M with Lions',
  meta_description = 'Jahmyr Gibbs signed a three-year, $67.5 million Lions extension with $51.5 million guaranteed, making him the NFL''s highest-paid running back. Fantasy impact inside.',
  tl_dr = $tldr$Jahmyr Gibbs and the Detroit Lions agreed on a three-year extension worth $67.5 million, up to $75.75 million with incentives, including $51.5 million guaranteed. At $22.5 million a year he is the highest-paid running back in the NFL. He signed it the following day, ending the only open question about his 2026 season.$tldr$,
  tags = array['contract extension', 'running back', 'Jahmyr Gibbs', 'Lions', 'contract'],
  content_md = $body$Jahmyr Gibbs is the highest-paid running back in the NFL. Gibbs, RB, Detroit Lions, and the team agreed on a three-year extension worth $67.5 million, worth up to $75.75 million with incentives, that includes $51.5 million guaranteed, per Adam Schefter. He signed it the following day.

Gibbs is a three-time Pro Bowl selection.

## What $22.5 million a year buys at running back

The Gibbs extension pays $22.5 million a year in new money, which is $250,000 more than Bijan Robinson agreed to with Atlanta two days earlier and $500,000 more than Jonathan Taylor got from Indianapolis. Here is the position by new-money average after the three deals:

- Jahmyr Gibbs, $22.5 million
- Bijan Robinson, $22.25 million
- Jonathan Taylor, $22 million
- Saquon Barkley, $20.6 million
- Christian McCaffrey, $19 million
- De'Von Achane, $16 million
- Derrick Henry, $15 million
- Breece Hall, $14.5 million

Gibbs was always going to be the one who set the number. Once Taylor and Robinson signed, Schefter reported that Gibbs was next and knew exactly what it would take to pass them.

## Detroit has now paid everyone

The Lions have handed out seven major extensions on this roster: Jared Goff at four years and $212 million, Aidan Hutchinson at four years and $180 million, Amon-Ra St. Brown at four years and $120.01 million, Penei Sewell at four years and $112 million, Jack Campbell at four years and $81 million, Jameson Williams at three years and $80 million, and now Gibbs.

That is a front office that has decided who it is building around and paid to keep the group together. For a fantasy manager, it means the offensive environment Gibbs plays in is not about to be dismantled for cap reasons.

## What changes for your roster

Nothing about the role, everything about the certainty. Gibbs had been away from full practice while the deal was negotiated, and that overhang is now gone. He is the featured back in an offense that just spent more than half a billion dollars keeping its skill players and its line intact.

Draft him on his workload. In dynasty, three added years at the top of the position is about as settled as a running back situation gets.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Jahmyr Gibbs'),
  last_updated = now()
where slug = 'jahmyr-gibbs-extension-lions';

-- 3. Bijan Robinson contract
update articles set
  title = 'Bijan Robinson extension: $75M deal with the Falcons',
  meta_description = 'Bijan Robinson signed a three-year Falcons extension worth up to $75 million with a record $51 million guaranteed. What the deal means for his 2026 fantasy value.',
  tl_dr = $tldr$Bijan Robinson and the Atlanta Falcons agreed on a three-year extension worth up to $75 million, including $51 million guaranteed, the most ever guaranteed to a running back outside a rookie contract. It made him the highest-paid back in the league at $22.25 million a year until Jahmyr Gibbs passed him two days later. The deal ended Robinson's hold-in at training camp.$tldr$,
  tags = array['contract extension', 'running back', 'Bijan Robinson', 'Falcons', 'contract'],
  content_md = $body$The Bijan Robinson extension is the deal that reset the running back market. Robinson, RB, Atlanta Falcons, agreed to a three-year extension worth up to $75 million, per ESPN sources reported by Adam Schefter. The $51 million guaranteed, $37 million of it at signing, is the most any running back has been guaranteed outside a rookie contract. Nicole Lynn of Klutch Sports negotiated it.

Robinson is a two-time Pro Bowl selection.

## He held the record for two days

At $22.25 million a year in new money, Robinson passed Saquon Barkley's $20.6 million to become the highest-paid running back in NFL history. Jahmyr Gibbs took the title back from him two days later at $22.5 million with Detroit, and Jonathan Taylor signed at $22 million with Indianapolis in the same stretch.

Schefter said at the time that Robinson's contract would help pave the way for both of them, and it did. All three were done inside a week.

## The hold-in is over

Robinson had been holding in at Falcons training camp, present at the facility but not practicing, while the sides negotiated. He returned to the field once the deal was announced, which means the reps he missed are measured in days rather than weeks.

Matthew McConaughey, who has been in Robinson's corner since his Texas days, texted him as soon as the news broke. The Falcons posted the exchange.

## Atlanta is keeping the offense together

Robinson joins a group of Falcons the front office has already committed to: WR Drake London at four years and $141 million, TE Kyle Pitts at three years and $54 million, and G Matthew Bergeron at four years and $96 million.

## What changes for your roster

The workload was never the question. Robinson is Atlanta's every-down back and the contract confirms it in the plainest way a front office can. What the deal removes is the small but real chance that a hold-in stretched into the regular season.

Draft him accordingly. In dynasty, the guarantee is the number that matters: teams do not guarantee $51 million to a back they intend to phase out.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Bijan Robinson'),
  last_updated = now()
where slug = 'bijan-robinson-contract-extension-falcons';

-- 4. The running back market roundup (kept as its own article, not a duplicate)
update articles set
  title = 'Gibbs, Robinson, Taylor all clear $20M a year at RB',
  meta_description = 'Three running backs signed extensions above $20 million a year in one week. Here is the new market by average salary and what it means for fantasy value.',
  tl_dr = $tldr$Jahmyr Gibbs, Bijan Robinson, and Jonathan Taylor all signed extensions worth more than $20 million a year inside a single week. One running back in the league was earning at that level before it started. All three are now tied to their teams long term, which takes contract risk off the table for the three most expensive backs in fantasy drafts.$tldr$,
  tags = array['running back', 'contract', 'Jahmyr Gibbs', 'Bijan Robinson', 'Jonathan Taylor'],
  content_md = $body$Three running backs cleared $20 million a year in one week. Jahmyr Gibbs of the Detroit Lions, Bijan Robinson of the Atlanta Falcons, and Jonathan Taylor of the Indianapolis Colts all signed extensions above that line inside seven days, per Adam Schefter. Entering the offseason, one running back in the league was earning at that level.

## The running back market by new-money average

- Jahmyr Gibbs, Lions, $22.5 million
- Bijan Robinson, Falcons, $22.25 million
- Jonathan Taylor, Colts, $22 million
- Saquon Barkley, Eagles, $20.6 million
- Christian McCaffrey, 49ers, $19 million
- De'Von Achane, $16 million
- Derrick Henry, $15 million
- Breece Hall, $14.5 million

## How one deal set up the other two

Robinson signed first, on a three-year extension worth up to $75 million with $51 million guaranteed, which was then the largest guarantee any running back had received outside a rookie contract. Schefter noted immediately that it gave Gibbs and Taylor a number to negotiate against.

Taylor went next at two years and $44 million with $39 million guaranteed. Gibbs finished the run at three years and $67.5 million with $51.5 million guaranteed, taking the top of the market by $250,000 a year.

## What changes for your roster

For the three players involved, the contract questions are closed. None of them can realistically be cut or traded inside the window a redraft manager cares about, and none has a reason to hold out. That is worth something on draft day, because contract-year running backs are exactly the players whose availability you cannot fully model.

The wider signal matters more for dynasty. Teams have spent the last several years arguing that running backs are replaceable. Three front offices just guaranteed a combined $141.5 million saying otherwise, and they did it for backs who catch passes rather than backs who only run. Value the pass-catching profile accordingly.$body$,
  event_key = 'transaction:' || (
    select string_agg(p.id::text, ',' order by p.id::text)
    from players p
    where p.full_name in ('Jahmyr Gibbs', 'Bijan Robinson', 'Jonathan Taylor')
  ),
  last_updated = now()
where slug = 'gibbs-robinson-taylor-20m-rb-extensions';

-- 5. Jalon Walker ACL
update articles set
  title = 'Jalon Walker ACL tear ends his 2026 Falcons season',
  meta_description = 'Jalon Walker tore his ACL at Falcons practice and will miss the 2026 season, the team confirmed. What it means for Atlanta''s edge rotation and your IDP roster.',
  tl_dr = $tldr$Falcons edge rusher Jalon Walker tore his ACL during a Tuesday practice and will miss the 2026 season, which Atlanta confirmed the following day. He was carted off and an MRI confirmed the tear. Walker is an IDP-only asset, and in IDP leagues he comes off your roster now with a realistic return window of 2027.$tldr$,
  tags = array['injury', 'ACL', 'Jalon Walker', 'Falcons', 'IDP'],
  content_md = $body$The Jalon Walker ACL tear is confirmed, and the Falcons have said he will miss the 2026 season. Walker, EDGE, Atlanta Falcons, went down during a Tuesday practice and was carted off. Ian Rapoport and Steve Wyche first reported that a torn ACL was feared and that an MRI would confirm it. Tests confirmed the tear, and Atlanta ruled him out for the year the next day.

The injury drew an emotional reaction from his teammates on the field.

## What Atlanta loses

Walker was the 15th overall pick in the 2025 draft out of Georgia and recorded 5.5 sacks as a rookie. He was Atlanta's most likely defensive breakout heading into a second season.

The bigger problem is that he was half of a pair. James Pearce Jr., the Falcons' other first-round edge rusher from the same draft class, led all 2025 rookies with 10.5 sacks. Atlanta built its pass rush plan around the two of them, and one of them is now gone before Week 1.

## Who is left on the edge

Samson Ebukam, Azeez Ojulari, Cameron Thomas, and Bralen Trice are the edge rushers on the roster behind Pearce. None of them was projected for the role Walker was about to take.

## What changes for your roster

In redraft and PPR leagues this changes nothing directly, because edge rushers do not score points in those formats.

In IDP leagues, drop Walker. There is no return inside 2026, and a standard ACL recovery puts him back at spring practices in 2027 at the earliest. If you have a deep dynasty bench and can afford the roster spot, he is worth stashing at his lowest possible price, because the talent that made him a top-15 pick has not gone anywhere.

If you stream team defenses, Atlanta's projection takes a real hit. The Falcons were interesting in 2026 largely because of what Walker and Pearce were expected to do together. Reprice that unit until the edge rotation settles.$body$,
  event_key = 'injury:' || (select id::text from players where full_name = 'Jalon Walker'),
  last_updated = now()
where slug = 'jalon-walker-acl-tear-falcons';

-- 6. Stefon Diggs signing
update articles set
  title = 'Stefon Diggs signs one-year Commanders contract',
  meta_description = 'Stefon Diggs signed a one-year Commanders contract worth up to $12 million. He is the clear WR2 behind Terry McLaurin in a Jayden Daniels offense. Fantasy outlook inside.',
  tl_dr = $tldr$Stefon Diggs signed a one-year contract with the Washington Commanders worth up to $12 million, filling the WR2 job behind Terry McLaurin. He caught 85 passes for 1,013 yards and four touchdowns for New England last season, 99 for 1,123 and five including their playoff run. He is a mid-round PPR target with a real role, and McLaurin's target share should hold.$tldr$,
  tags = array['free agency', 'wide receiver', 'Stefon Diggs', 'Commanders', 'contract'],
  content_md = $body$The Stefon Diggs contract is signed. Diggs, WR, has agreed to a one-year deal with the Washington Commanders worth up to $12 million, per Adam Schefter, and put pen to paper the morning it became official. He was released by New England earlier in the offseason.

This is close to a homecoming. Diggs grew up in Gaithersburg, Maryland, and played his college football at Maryland.

## What he did last season

Diggs caught 85 passes for 1,013 yards and four touchdowns in 17 regular-season games with the Patriots. Including their playoff run, the line was 99 catches for 1,123 yards and five scores. That season came after the ACL tear he suffered in 2024, so the durability question about his knee has already been answered on the field.

## The job he walks into

Terry McLaurin is the WR1 in Washington and that is not changing. The problem the Commanders had was everything after him: Treylon Burks, Luke McCaffrey, and rookie Antonio Williams were the depth chart, and none of them projects as a starter. Diggs slots straight into the WR2 role opposite McLaurin in an offense run by Jayden Daniels.

Washington felt the absence of a second option last season, when McLaurin missed time with a quad injury and the team cycled through receivers who had not been on the roster in September.

## Other Commanders returning to practice

Three Washington players came off the physically unable to perform list the same day: CB Trey Amos, DE Dorance Armstrong, and P Tress Way all passed their physicals and returned to practice. Armstrong is the only one of the three with any fantasy relevance, and only at the margins for IDP and team defense managers.

## What changes for your roster

Diggs is a mid-round PPR target with a defined role, which is more than most receivers at that cost can say. Take the one-year contract and his age into account before spending anything meaningful in dynasty, but for 2026 he is a usable WR2 or flex in a functional offense.

McLaurin managers should not worry. A credible second receiver pulls coverage rather than volume, and Washington's problem last season was that nobody made defenses account for anyone but McLaurin.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Stefon Diggs'),
  last_updated = now()
where slug = 'stefon-diggs-signs-commanders';

-- 7. Darnell Wright contract
update articles set
  title = 'Darnell Wright extension: 4 years, $116M with Bears',
  meta_description = 'Darnell Wright signed a four-year, $116 million Bears extension with $93 million guaranteed, a record for an offensive lineman. What it means for Chicago''s skill players.',
  tl_dr = $tldr$The Chicago Bears signed right tackle Darnell Wright to a four-year, $116 million extension with $93 million guaranteed, the largest guarantee ever given to an offensive lineman. The deal runs through 2031. Wright scores no fantasy points himself, but locking down the right side of the line matters for Caleb Williams and the Chicago backfield.$tldr$,
  tags = array['contract extension', 'offensive line', 'Darnell Wright', 'Bears', 'contract'],
  content_md = $body$The Darnell Wright extension is the richest contract a right tackle has signed. Wright, OT, Chicago Bears, agreed to terms on a four-year, $116 million deal that includes $93 million guaranteed, per Ian Rapoport and Jeremy Fowler, negotiated by his agents at Octagon Football. The Bears announced the signing the same day, and the contract runs through 2031.

The $93 million guaranteed is the most any offensive lineman has been given.

## Who Wright is

Chicago took Wright 10th overall in the 2023 draft out of Tennessee. He has started 49 games across three seasons and is a second-team All-Pro. At roughly $29 million a year he sits near the top of the tackle market.

The Bears had already picked up his fifth-year option. This extension replaces that and keeps him under contract several years past it.

## Why an offensive lineman is on a fantasy football site

Wright will not score you a point. He matters because of what he protects.

Chicago has spent heavily on the interior line alongside him, and the run game has been the strength of the offense. A right tackle who plays every snap at a high level is a large part of why. Continuity there is worth something concrete to anyone rostering Caleb Williams, the Bears backfield, or Chicago's pass catchers.

There is also the negotiation itself. An unresolved extension for a starting tackle is the kind of thing that turns into a training camp story and occasionally into missed practice time. That possibility is now closed.

## What changes for your roster

Nothing today. Wright was already on the roster and already playing.

What it changes is the confidence interval on everyone around him. If you were treating the Bears offense as a work in progress that might not hold together, the front office has now committed real guaranteed money to keeping the line intact through the back half of the decade. Price Chicago's skill players as members of a stable offense rather than a speculative one.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Darnell Wright'),
  last_updated = now()
where slug = 'darnell-wright-bears-extension';

-- 8. O'Cyrus Torrence contract
update articles set
  title = 'O''Cyrus Torrence extension: 4 years, $78.4M, Bills',
  meta_description = 'O''Cyrus Torrence signed a four-year, $78.4 million Bills extension with $46 million guaranteed. What the guard''s new deal means for Josh Allen and James Cook.',
  tl_dr = $tldr$The Buffalo Bills signed right guard O'Cyrus Torrence to a four-year, $78.4 million extension with $46 million guaranteed, making him the seventh-highest-paid guard in the NFL. The deal runs through 2030. Torrence has no fantasy value of his own, but a settled interior line is a quiet positive for Josh Allen and James Cook.$tldr$,
  tags = array['contract extension', 'offensive line', E'O\'Cyrus Torrence', 'Bills', 'contract'],
  content_md = $body$The O'Cyrus Torrence extension keeps Buffalo's right guard in place through 2030. The Bills reached agreement with Torrence, OG, on a four-year, $78.4 million deal that includes $46 million guaranteed, per Adam Schefter and Alaina Getzenberg, negotiated by agents Jon Perzley, Brian Mackler, and Daniel Scardigno. At $19.6 million a year he is the seventh-highest-paid guard in the league.

## Who Torrence is

Torrence is 26 and was entering the final year of his rookie contract after Buffalo drafted him in the second round in 2023. He played every offensive snap last season.

That availability is the whole argument for the contract. Guards who never come off the field are rarer than the position's reputation suggests, and Buffalo chose to pay for it a year early rather than negotiate against a deadline.

## What it means for the Buffalo offense

Torrence does not score fantasy points, catch passes, or carry the ball. The reason to read past the headline is what a settled interior line does for the players who do.

Josh Allen takes fewer hits behind a line that is not rotating. James Cook runs behind the same right side he has been running behind. Neither of those is a dramatic change, because Torrence was already the starter, but the alternative was an unsigned starting guard heading into the season with a contract to play for.

## What changes for your roster

Nothing immediate, and that is the honest answer. This is front-office news, not depth chart news.

If you roster Allen or Cook, treat it as one fewer variable rather than an upgrade. The line that blocked for them last season will be the same line this season, which is the sort of continuity that shows up in a floor rather than a ceiling.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = E'O\'Cyrus Torrence'),
  last_updated = now()
where slug = 'ocyrus-torrence-extension-bills';

-- 9. Zay Flowers contract
update articles set
  title = 'Zay Flowers extension: 4 years, $140M with Ravens',
  meta_description = 'Zay Flowers signed a four-year, $140 million Ravens extension with $108 million guaranteed. At $35 million a year he ties Justin Jefferson. Fantasy impact inside.',
  tl_dr = $tldr$Zay Flowers and the Baltimore Ravens agreed on a four-year, $140 million extension including $108 million guaranteed, which at $35 million a year ties him with Justin Jefferson near the top of the receiver market. Flowers finished seventh in the NFL in receiving yards last season on 86 catches for 1,211. He is a locked-in WR1 with no reason to move him.$tldr$,
  tags = array['contract extension', 'wide receiver', 'Zay Flowers', 'Ravens', 'contract'],
  content_md = $body$The Zay Flowers extension is done at four years and $140 million. Flowers, WR, Baltimore Ravens, reached agreement with the team on a deal that includes $108 million guaranteed, per his agency Win Sports Group, reported by Adam Schefter. It runs through 2031.

Flowers is a two-time Pro Bowl selection.

## Where $35 million a year puts him

The new-money average of $35 million ties Flowers with Justin Jefferson and puts him just above CeeDee Lamb at $34 million. Drake London is marginally ahead at $35.25 million, and the top of the market belongs to Jaxon Smith-Njigba at $42.15 million and Ja'Marr Chase at $40.25 million.

For a receiver who has been his team's leading target every season he has played, that is a reasonable place to land.

## What he produced last season

Flowers finished seventh in the NFL in receiving yards with 1,211 on 86 catches across 17 games. No other Baltimore receiver topped 25 catches or 400 yards. His share of the team's receiving yards was the second-highest of any player in the league.

That concentration is the number that matters for fantasy. Flowers is not splitting a passing game; he is most of one.

## What he said about Lamar Jackson

Asked about the deal, Flowers made clear he wants Lamar Jackson throwing to him for the rest of it. "I'd love for him to be my quarterback to I'm done playing," he said, per ESPN's Jamison Hensley. "No matter whether 12 years, 13. It don't matter how long. I want him to be my quarterback because, to me, he's the best in the world."

Jackson has two years left on his own contract, and that is the one open variable in this picture.

## What changes for your roster

The role was already there. What changes is that you are no longer holding a player who could have been negotiating his way out of Baltimore in two years.

In dynasty, that turns Flowers from a very good asset into a foundational one: a top-10 receiver by target share, signed through 2031, entering his prime. In redraft, treat him as a borderline WR1 whose ceiling moves with Jackson's health.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Zay Flowers'),
  last_updated = now()
where slug = 'zay-flowers-ravens-extension';

-- 10. Aaron Donald workout
update articles set
  title = 'Aaron Donald works out for the Rams, no deal yet',
  meta_description = 'Aaron Donald worked out at the Rams facility in a helmet, forcing the team to report it to the NFL. No contract is signed and he remains retired. What it means.',
  tl_dr = $tldr$Aaron Donald worked out for the Los Angeles Rams at their facility, wearing a helmet but no pads. Because he used team equipment during training camp, the Rams had to report the session to the NFL. No contract has been signed and Donald is still retired, so there is nothing to act on outside IDP leagues.$tldr$,
  tags = array['Aaron Donald', 'Rams', 'comeback', 'workout', 'IDP'],
  content_md = $body$Aaron Donald worked out for the Los Angeles Rams, per the NFL wire. He is not signed, and he is still retired.

The detail that made it official business: Donald wanted to do the workout in a football helmet. He did not wear pads, but he used the Rams' own equipment at their facility during training camp, which required the team to report his activity to the league. That report is why a private session became public.

## What the workout was and was not

This was Donald testing his body, not a contract negotiation. He is 35 and has been retired since after the 2023 season, and he has said publicly that the Rams trading for Myles Garrett is what got him thinking about playing again.

An hour of drills at a facility he knows well is a long way from a signature. Treat it as the first step of a decision rather than the decision.

## What changes for your roster

In redraft and PPR leagues, nothing. Interior defensive linemen do not score points in those formats and never have.

In IDP, this is worth a bookmark and nothing more. Donald at his peak was the most valuable interior defensive lineman the format has ever had, and a return would make him an immediate waiver priority. A workout is not a return.

The downstream case for Rams skill players is thinner than it looks. A better Los Angeles defense would help game scripts for the offense over a full season, but that is an argument you can make after a signing, not before one. Wait for a contract.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Aaron Donald'),
  last_updated = now()
where slug = 'aaron-donald-rams-workout-comeback';

-- 11. Peter Skoronski contract
update articles set
  title = 'Peter Skoronski extension: 4 years, $100M with Titans',
  meta_description = 'Peter Skoronski signed a four-year, $100 million Titans extension with $88 million guaranteed, making him the highest-paid guard in the NFL. What it means for Cam Ward.',
  tl_dr = $tldr$The Tennessee Titans agreed to terms with guard Peter Skoronski on a four-year, $100 million extension including $88 million guaranteed, making him the highest-paid guard in the NFL at $25 million a year. Skoronski scores no fantasy points, but he is the interior protection in front of Cam Ward, and Tennessee has now committed to keeping him there.$tldr$,
  tags = array['contract extension', 'offensive line', 'Peter Skoronski', 'Titans', 'contract'],
  content_md = $body$Peter Skoronski is the highest-paid guard in the NFL. The Titans and Skoronski, G, Tennessee Titans, agreed to terms on a four-year, $100 million extension that includes $88 million guaranteed, per Adam Schefter and Ian Rapoport. The Titans confirmed he is staying in Nashville on a multi-year deal.

At $25 million a year he passes the previous top of the guard market, which sat at $24 million.

## Who Skoronski is

Tennessee took Skoronski 11th overall in the 2023 draft and moved him inside from college tackle. He has missed three games in his career and played all 17 in each of the last two seasons.

Last season he posted an 84.5 pass-blocking grade at Pro Football Focus, second among all guards. The Titans had already exercised his fifth-year option at roughly $19.07 million, so this extension is a raise on top of a year they had already secured.

## Why this matters for Cam Ward

Skoronski is not draftable in any standard format. The reason to care is the quarterback standing behind him.

Cam Ward is Tennessee's franchise quarterback and the player the entire roster is being assembled around. Interior pressure is the kind a quarterback cannot step up to escape, and it is the single most reliable predictor of a young passer struggling. Tennessee just paid record money at the position to make sure that particular problem is not Ward's problem.

## What changes for your roster

Nothing directly, and be suspicious of anyone who tells you an offensive line signing moves a projection on its own.

What it does is narrow the range of outcomes for the Titans offense. If you are holding Ward in dynasty, or weighing a Tennessee pass catcher or running back late in a draft, this is one of the reasons to believe the floor is higher than last season's results suggest. The front office has now put its most expensive contract in front of its most important player.$body$,
  event_key = 'transaction:' || (select id::text from players where full_name = 'Peter Skoronski'),
  last_updated = now()
where slug = 'peter-skoronski-extension-titans';

-- ---------------------------------------------------------------------------
-- Union the archived articles' players onto the survivors.
-- ---------------------------------------------------------------------------

insert into article_players (article_id, player_id)
select s.id, ap.player_id
from (values
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-a38a2'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-e6a73'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-65193'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-4219a'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-alec-pierce-colts-extensions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-rb-contract-lions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-extension-lions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-rb-contract-lions-11d5c'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-extension-lions-66e1d'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-contract-extension'),
  ('bijan-robinson-contract-extension-falcons', 'bijan-robinson-contract-extension'),
  ('gibbs-robinson-taylor-20m-rb-extensions', 'bijan-robinson-deal-gibbs-taylor'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-injury-falcons-camp'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-acl-injury-falcons'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-torn-acl'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-acl-tear-2026'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-commanders-signing'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-washington-commanders'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-signs-commanders-a909f'),
  ('darnell-wright-bears-extension', 'darnell-wright-bears-extension-431cc'),
  ('darnell-wright-bears-extension', 'darnell-wright-extension-bears'),
  ('ocyrus-torrence-extension-bills', 'ocyrus-torrence-extension-bills-53b1b'),
  ('zay-flowers-ravens-extension', 'zay-flowers-ravens-extension-3f586'),
  ('aaron-donald-rams-workout-comeback', 'aaron-donald-rams-workout'),
  ('peter-skoronski-extension-titans', 'peter-skoronski-extension-titans-c6e5c')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
join article_players ap on ap.article_id = d.id
on conflict (article_id, player_id) do nothing;

-- ---------------------------------------------------------------------------
-- Union the archived articles' teams onto the survivors.
-- ---------------------------------------------------------------------------

insert into article_teams (article_id, team_id)
select s.id, at2.team_id
from (values
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-a38a2'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-e6a73'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-65193'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-4219a'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-alec-pierce-colts-extensions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-rb-contract-lions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-extension-lions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-rb-contract-lions-11d5c'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-extension-lions-66e1d'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-contract-extension'),
  ('bijan-robinson-contract-extension-falcons', 'bijan-robinson-contract-extension'),
  ('gibbs-robinson-taylor-20m-rb-extensions', 'bijan-robinson-deal-gibbs-taylor'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-injury-falcons-camp'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-acl-injury-falcons'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-torn-acl'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-acl-tear-2026'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-commanders-signing'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-washington-commanders'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-signs-commanders-a909f'),
  ('darnell-wright-bears-extension', 'darnell-wright-bears-extension-431cc'),
  ('darnell-wright-bears-extension', 'darnell-wright-extension-bears'),
  ('ocyrus-torrence-extension-bills', 'ocyrus-torrence-extension-bills-53b1b'),
  ('zay-flowers-ravens-extension', 'zay-flowers-ravens-extension-3f586'),
  ('aaron-donald-rams-workout-comeback', 'aaron-donald-rams-workout'),
  ('peter-skoronski-extension-titans', 'peter-skoronski-extension-titans-c6e5c')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
join article_teams at2 on at2.article_id = d.id
on conflict (article_id, team_id) do nothing;

-- ---------------------------------------------------------------------------
-- Repoint the archived articles' source posts at the survivor, and stamp them as
-- revisions of it, so the audit trail reads correctly and a later follow-up revises
-- the live article rather than an archived one.
-- ---------------------------------------------------------------------------

update news_ingestions ni
set article_id = s.id,
    is_revision = true,
    event_key = coalesce(s.event_key, ni.event_key)
from (values
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-a38a2'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-e6a73'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-65193'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-colts-extension-4219a'),
  ('jonathan-taylor-colts-extension', 'jonathan-taylor-alec-pierce-colts-extensions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-rb-contract-lions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-extension-lions'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-record-rb-contract-lions-11d5c'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-extension-lions-66e1d'),
  ('jahmyr-gibbs-extension-lions', 'jahmyr-gibbs-contract-extension'),
  ('bijan-robinson-contract-extension-falcons', 'bijan-robinson-contract-extension'),
  ('gibbs-robinson-taylor-20m-rb-extensions', 'bijan-robinson-deal-gibbs-taylor'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-injury-falcons-camp'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-acl-injury-falcons'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-torn-acl'),
  ('jalon-walker-acl-tear-falcons', 'jalon-walker-acl-tear-2026'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-commanders-signing'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-washington-commanders'),
  ('stefon-diggs-signs-commanders', 'stefon-diggs-signs-commanders-a909f'),
  ('darnell-wright-bears-extension', 'darnell-wright-bears-extension-431cc'),
  ('darnell-wright-bears-extension', 'darnell-wright-extension-bears'),
  ('ocyrus-torrence-extension-bills', 'ocyrus-torrence-extension-bills-53b1b'),
  ('zay-flowers-ravens-extension', 'zay-flowers-ravens-extension-3f586'),
  ('aaron-donald-rams-workout-comeback', 'aaron-donald-rams-workout'),
  ('peter-skoronski-extension-titans', 'peter-skoronski-extension-titans-c6e5c')
) as m(survivor_slug, archived_slug)
join articles s on s.slug = m.survivor_slug
join articles d on d.slug = m.archived_slug
where ni.article_id = d.id;

-- The surviving articles' own source posts get the key too, so the late duplicate
-- guard can match against them.
update news_ingestions ni
set event_key = s.event_key
from articles s
where ni.article_id = s.id
  and s.event_key is not null
  and ni.event_key is null;

-- ---------------------------------------------------------------------------
-- Archive the duplicates. The 308 redirects in next.config.ts mean these slugs never
-- reach the page component; archiving removes them from the sitemap and the feed.
--
-- Entity links are dropped afterwards so the sidebar's "players and teams in the news"
-- scan and the /brief/player and /brief/team filter pages count only live coverage.
-- ---------------------------------------------------------------------------

delete from article_players
where article_id in (select id from articles where slug in (
  'jonathan-taylor-colts-extension-a38a2',
  'jonathan-taylor-colts-extension-e6a73',
  'jonathan-taylor-colts-extension-65193',
  'jonathan-taylor-colts-extension-4219a',
  'jonathan-taylor-alec-pierce-colts-extensions',
  'jahmyr-gibbs-record-rb-contract-lions',
  'jahmyr-gibbs-record-extension-lions',
  'jahmyr-gibbs-record-rb-contract-lions-11d5c',
  'jahmyr-gibbs-extension-lions-66e1d',
  'jahmyr-gibbs-contract-extension',
  'bijan-robinson-contract-extension',
  'bijan-robinson-deal-gibbs-taylor',
  'jalon-walker-injury-falcons-camp',
  'jalon-walker-acl-injury-falcons',
  'jalon-walker-torn-acl',
  'jalon-walker-acl-tear-2026',
  'stefon-diggs-commanders-signing',
  'stefon-diggs-washington-commanders',
  'stefon-diggs-signs-commanders-a909f',
  'darnell-wright-bears-extension-431cc',
  'darnell-wright-extension-bears',
  'ocyrus-torrence-extension-bills-53b1b',
  'zay-flowers-ravens-extension-3f586',
  'aaron-donald-rams-workout',
  'peter-skoronski-extension-titans-c6e5c'
));

delete from article_teams
where article_id in (select id from articles where slug in (
  'jonathan-taylor-colts-extension-a38a2',
  'jonathan-taylor-colts-extension-e6a73',
  'jonathan-taylor-colts-extension-65193',
  'jonathan-taylor-colts-extension-4219a',
  'jonathan-taylor-alec-pierce-colts-extensions',
  'jahmyr-gibbs-record-rb-contract-lions',
  'jahmyr-gibbs-record-extension-lions',
  'jahmyr-gibbs-record-rb-contract-lions-11d5c',
  'jahmyr-gibbs-extension-lions-66e1d',
  'jahmyr-gibbs-contract-extension',
  'bijan-robinson-contract-extension',
  'bijan-robinson-deal-gibbs-taylor',
  'jalon-walker-injury-falcons-camp',
  'jalon-walker-acl-injury-falcons',
  'jalon-walker-torn-acl',
  'jalon-walker-acl-tear-2026',
  'stefon-diggs-commanders-signing',
  'stefon-diggs-washington-commanders',
  'stefon-diggs-signs-commanders-a909f',
  'darnell-wright-bears-extension-431cc',
  'darnell-wright-extension-bears',
  'ocyrus-torrence-extension-bills-53b1b',
  'zay-flowers-ravens-extension-3f586',
  'aaron-donald-rams-workout',
  'peter-skoronski-extension-titans-c6e5c'
));

update articles set status = 'archived', last_updated = now()
where slug in (
  'jonathan-taylor-colts-extension-a38a2',
  'jonathan-taylor-colts-extension-e6a73',
  'jonathan-taylor-colts-extension-65193',
  'jonathan-taylor-colts-extension-4219a',
  'jonathan-taylor-alec-pierce-colts-extensions',
  'jahmyr-gibbs-record-rb-contract-lions',
  'jahmyr-gibbs-record-extension-lions',
  'jahmyr-gibbs-record-rb-contract-lions-11d5c',
  'jahmyr-gibbs-extension-lions-66e1d',
  'jahmyr-gibbs-contract-extension',
  'bijan-robinson-contract-extension',
  'bijan-robinson-deal-gibbs-taylor',
  'jalon-walker-injury-falcons-camp',
  'jalon-walker-acl-injury-falcons',
  'jalon-walker-torn-acl',
  'jalon-walker-acl-tear-2026',
  'stefon-diggs-commanders-signing',
  'stefon-diggs-washington-commanders',
  'stefon-diggs-signs-commanders-a909f',
  'darnell-wright-bears-extension-431cc',
  'darnell-wright-extension-bears',
  'ocyrus-torrence-extension-bills-53b1b',
  'zay-flowers-ravens-extension-3f586',
  'aaron-donald-rams-workout',
  'peter-skoronski-extension-titans-c6e5c'
) and status = 'published';
