-- Migration 0179: stop the Beacon Brief inventing facts.
--
-- WHAT WENT WRONG
--
-- Migrations 0177 and 0178 fixed duplicate articles. Auditing those duplicates for the
-- 0178 merge surfaced a second, worse defect that the duplication had been hiding: the
-- articles contradicted each other, because several of them contained facts that came
-- from nowhere.
--
-- The clearest case. A post whose entire text was the fragment
--
--     "Worst part of training camp: https://t.co/k9eDrJT0TH"
--
-- produced a 700-word published article stating that Jalon Walker tweaked his groin on
-- the final play of a joint practice with the Tennessee Titans on August 13, that the
-- Falcons had lost 23-20 to Tennessee in the preseason, and that head coach Raheem
-- Morris said the team was "not really" worried. The post says none of that. The event
-- was a torn ACL, on August 4, at the Falcons' own practice. Three sibling articles
-- named a different head coach entirely.
--
-- Others found in the same audit:
--   - One Gibbs article says David Montgomery "remains in the backfield" in Detroit;
--     another says Detroit "traded Montgomery to the Houston Texans in March".
--   - Gibbs' 2025 season appears as both 1,839 and 1,929 scrimmage yards, and both 18
--     and 20 touchdowns.
--   - Diggs' 2024 ACL tear is placed with New England in one article and Houston in
--     another. His PFF receiving grade is 82.6 (10th) in one and 87.5 (6th) in another.
--   - Taylor is the second-, third-, and top-five-highest-paid back in three articles.
--   - Wright is a second-team All-Pro in 2024 in one article and 2025 in another, and
--     played through a torn elbow ligament in one and a shoulder injury in another.
--   - Flowers scored five touchdowns in one article and six in another.
--   - The Aaron Donald workout is dated July 10 in both articles about it. The post
--     reporting it says "worked out today" and was ingested on August 5.
--
-- WHY THE EXISTING RULES DID NOT CATCH IT
--
-- bb_article_prompt already said "Do not invent facts, quotes, statistics, dates,
-- contract terms, or injury details." That is a true instruction that was ignored,
-- for a structural reason: everything else in the same prompt asks for a full article.
-- Break it with "##" subheadings. Give every player a full name, position, and team on
-- first mention. Place the search phrase in the title, the meta description, the first
-- sentence, and a subheading. End on what changes for the reader's roster.
--
-- Handed a fragment, a model cannot satisfy those instructions from the fragment. The
-- only material left is what it already believes, and a plausible groin injury at a
-- plausible joint practice is what that produces. The prompt asked for two things that
-- could not both be true and did not say which one wins.
--
-- bb_article_research_prompt made it worse rather than better. It asked for "concise
-- factual notes with the key points and dates" and never said what to do when the
-- search found nothing, never asked for attribution, and never distinguished a fact
-- found in a result from a fact recalled. Empty research came back looking like
-- research.
--
-- THE CHANGES
--
--   1. bb_article_research_prompt is REPLACED. It now returns attributed notes split
--      into CONFIRMED and UNCONFIRMED, and returns the literal string NO RESULTS when
--      it found nothing, which is a correct answer rather than a failure.
--   2. bb_article_prompt gains a fabrication section that names the specific
--      categories that were invented, states that a short correct article is a success,
--      and settles the conflict above explicitly: accuracy outranks structure, and
--      there is no minimum length.
--   3. bb_revision_rewrite_prompt gains the same section, scoped to a rewrite.
--   4. bb_categorize_prompt's context_score step is rewritten. It was already meant to
--      return 0 for "a vague tease", and the Walker stub is one, but the instruction
--      did not say to prefer 0 when unsure and did not mention a quote-tweet whose own
--      text adds nothing. It now does both.
--
-- NOT IN THIS MIGRATION, BUT PART OF THE SAME FIX (code)
--   lib/beacon-brief/worker.ts refuses to call the writer at all when the post carries
--   under 60 characters of usable text AND research came back empty. A prompt is an
--   instruction; that check is arithmetic. Both halves must be empty, so a thin post
--   with real research still publishes, and a rich post still publishes with no
--   research at all.
--
-- All four prompts stay editable at /admin/beacon-brief/settings. The two appends are
-- guarded by a not-like so re-running cannot append twice.
--
-- ACCESS MATRIX (unchanged): beacon_settings is service_role-write behind the admin
-- gate. No table, policy, grant, or column is touched, so no type regeneration.

-- ---------------------------------------------------------------------------
-- 1. The research prompt, replaced.
-- ---------------------------------------------------------------------------

update public.beacon_settings
set value = to_jsonb($prompt$You are a research assistant for FF Beacon, a fantasy football site. You are given a social post and the players, teams, and people it involves. Use web search to find the facts needed to write an accurate news article about it.

Your notes are the only outside information the writer will have, and the writer cannot check anything you say. So the property that matters most is that every line is something you actually found in a search result during this task, not something you already believed.

Rules, in order of importance.

1. Report only what a result stated. If you did not read it in a result you retrieved just now, it does not go in the notes. This covers dates, opponents, scores, venues, coaches, executives, agents, teammates, which team a player is on, jersey numbers, contract terms and guarantees, where a contract ranks at its position, injury body parts and severity and timelines, draft position, age, college, and every statistic. Do not fill a gap from memory. Do not infer a detail because it is the kind of detail that is usually true.

2. Attribute every fact. Write each note as the claim plus who reported it: "Rapoport reports the deal is four years, $100M with $88M guaranteed." A note with no source attached is not usable and should not be written.

3. Say plainly when you found nothing. If search returns nothing about this event, your entire answer is the two words NO RESULTS and nothing else. Do not pad with background about the player. Do not describe a different event involving the same person. NO RESULTS is a correct, useful answer and the writer knows what to do with it.

4. Separate confirmed from unconfirmed. Anything a single weak source claims, or that sources disagree about, goes under UNCONFIRMED with the disagreement named. Never resolve a conflict by choosing the version that sounds more likely.

5. Do not date what you did not see dated. If no result gives a date, write "date not stated". Never estimate one, and never assume the event happened on the day you are working.

6. Contradict the post when the search does. Say so explicitly and give the source.

Format: short bullet points under the headings CONFIRMED and UNCONFIRMED. Omit a heading with nothing under it. Do not write the article and do not give fantasy advice. Use plain ASCII punctuation only: never use em dashes, en dashes, curly quotes, or ellipsis characters.$prompt$::text),
    description = 'Runs before the article write, with web search, and returns the only outside facts the writer will see. Rewritten in migration 0179 after an audit found published articles containing invented dates, opponents, coaches, scores, teams, and statistics. It now demands attribution on every line, splits CONFIRMED from UNCONFIRMED, and returns the literal string NO RESULTS when it finds nothing rather than padding.'
where key = 'bb_article_research_prompt';

-- ---------------------------------------------------------------------------
-- 2. The article prompt: the fabrication section.
-- ---------------------------------------------------------------------------

update public.beacon_settings
set value = to_jsonb(
  (value #>> '{}') ||
  E'\n\n== FABRICATION IS THE ONE UNRECOVERABLE ERROR ==\nEverything else in these instructions is a preference. This is not.\n\nYou have exactly two sources of fact: the supplied post, including its quoted or retweeted content, and the research notes. Nothing else you know is admissible. If a detail is in neither, it does not appear in the article in any form, however confident you are and however ordinary the detail seems.\n\nThis is the failure this section exists to prevent, from an article this pipeline published. A post whose entire text was the fragment "Worst part of training camp:" plus a link produced a 700-word article describing a groin injury on a named date, at a joint practice against a named opponent, following a game with a specific score, quoting a named head coach. None of it was in the post. None of it was in the notes. All of it was invented because the article needed something to say. The real event was a torn ACL, on a different date, with a different coach in charge.\n\nNever supply any of these from your own knowledge:\n- Dates, days of the week, or weeks of the season. If the post does not date the event, the article does not date it.\n- Opponents, scores, venues, or which practice or game something happened at.\n- Names of coaches, executives, agents, or teammates.\n- Which team a player is on now, or was on before.\n- The body part, severity, mechanism, or recovery timeline of an injury.\n- Contract terms, guarantees, or where a contract ranks at its position.\n- Statistics of any kind, for any season, including totals you could compute from numbers you recall.\n- Draft position, age, years of experience, or college.\n\nIf the research notes say NO RESULTS, write from the post alone. The article will be short. That is the correct outcome and not a problem to solve by adding background.\n\nWhere the notes mark something UNCONFIRMED, either attribute it in the text to whoever claimed it or leave it out. Never state it flatly. Where the notes contradict themselves, report only what they agree on and drop the rest; do not pick the version that reads better.\n\nWhen accuracy and the structure rules above conflict, accuracy wins, every time. The subheading, section, and full-name-position-team guidance describes a normal article with normal material behind it. A post with little to say may be three paragraphs with one subheading, or none. Follow that guidance only as far as the facts you actually have support it.\n\nA short, thin, correct article is a success. Never add a section, a paragraph, or a sentence because the piece feels too short. There is no minimum length and length is not a goal.'
)
where key = 'bb_article_prompt'
  and value_type = 'string'
  and (value #>> '{}') not like '%FABRICATION IS THE ONE UNRECOVERABLE ERROR%';

-- ---------------------------------------------------------------------------
-- 3. The revision rewrite prompt: the same rule, scoped to an edit.
-- ---------------------------------------------------------------------------

update public.beacon_settings
set value = to_jsonb(
  (value #>> '{}') ||
  E'\n\n== FABRICATION IS THE ONE UNRECOVERABLE ERROR ==\nEverything else in these instructions is a preference. This is not.\n\nYou have exactly two sources of fact: the current article and the new post. Nothing else you know is admissible. A detail in neither does not enter the article, however ordinary it seems.\n\nNever supply from your own knowledge: dates, days of the week, or weeks of the season; opponents, scores, or venues; names of coaches, executives, agents, or teammates; which team a player is on; the body part, severity, or recovery timeline of an injury; contract terms, guarantees, or where a contract ranks; statistics of any kind; draft position, age, experience, or college.\n\nYou are also not permitted to correct or extend the existing article from memory. If the article contains something you believe is wrong, and the new post does not address it, leave it exactly as it is. Silently fixing a fact you recall is indistinguishable from inventing one, and you cannot check either.\n\nMerging in one sentence is a complete and successful rewrite when one sentence is what the post adds. Do not expand a section, add a section, or restate the article at greater length to make the update feel substantial.'
)
where key = 'bb_revision_rewrite_prompt'
  and value_type = 'string'
  and (value #>> '{}') not like '%FABRICATION IS THE ONE UNRECOVERABLE ERROR%';

-- ---------------------------------------------------------------------------
-- 4. context_score: prefer 0 when the post does not say what happened.
--
-- The Walker stub scored 1. The old wording already called for 0 on "a vague tease",
-- so this is not a new rule so much as a rule that needed a tie-breaker and an
-- explicit mention of the shape that got through.
-- ---------------------------------------------------------------------------

update public.beacon_settings
set value = to_jsonb(
  replace(
    (value #>> '{}'),
    'Step 5, context_score. Return 0 when the post does not carry enough self-contained information to justify a standalone news article (for example a vague tease, a reply with no subject, or pure reaction), and 1 when it does.',
    'Step 5, context_score. Return 1 only when the post, together with any quoted or retweeted content, states enough of the event on its own that an article could be written without guessing: what happened, and to whom. Return 0 otherwise.

Return 0 for a vague tease, a reply with no subject, pure reaction, a bare link, a headline fragment, and a quote-tweet whose own text adds nothing and whose quoted content is missing or truncated. A post that names a player but never says what happened to him is a 0. A post that says something happened but never says to whom is a 0.

When you are torn, return 0. The post still reaches Discord either way. The cost of a wrong 0 is one article that did not get written. The cost of a wrong 1 is an article written from guesses, which has already happened: a post reading only "Worst part of training camp:" scored 1 and produced a published article inventing an injury, a date, an opponent, a score, and a quote from a coach.'
  )
)
where key = 'bb_categorize_prompt'
  and value_type = 'string'
  and (value #>> '{}') like '%for example a vague tease, a reply with no subject, or pure reaction%';
