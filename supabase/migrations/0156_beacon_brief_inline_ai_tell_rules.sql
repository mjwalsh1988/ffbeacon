-- Migration 0156: inline the AI-tell rules, drop the unreachable citation
--
-- Both prompts opened their AI-tell section by citing
-- Wikipedia:Signs_of_AI_writing and telling the model to "avoid every habit and
-- pattern described there". Neither call can reach it. Both run through
-- runStructuredCall (lib/beacon-brief/ai.ts), which sends a system prompt, one
-- user message, and a JSON schema, and declares no tools at all. The only call in
-- the pipeline that can fetch anything is the separate research step, which uses
-- bb_article_research_prompt and never carried the link.
--
-- So the sentence demanded compliance with a document the model could not read
-- and leaned on whatever it recalled of that page. The concrete rules underneath
-- were already doing the work. A plain statement of intent replaces it.
--
-- The section is also condensed: 3851 to 3360 characters, 104 fewer input tokens
-- per call, charged on every article write and every revision rewrite.
--
-- NO RULE WAS DROPPED. Four phrases left the "Inflated significance" cut-list
-- only because a stricter rule elsewhere already forbids them:
--   "serves as" and "stands as" are banned outright under Plain verbs.
--   "is a testament to" contains "testament", a banned word.
--   "underscores the importance of" contains "underscores", now added to the
--   banned word list to close the one gap (it previously listed only
--   "underscore" and "underscoring").
-- Everything else is the same rule in fewer words. Paragraphs were reordered so
-- the two verb rules sit together.
--
-- Written as surgery on the stored value rather than a full prompt replacement,
-- so it composes with whatever the admin Settings page has since changed in the
-- SEO half of either prompt, and so re-running it is a no-op.
--
-- Access matrix: unchanged. beacon_settings stays service_role-write behind the
-- admin gate; both prompts remain editable on the admin Settings page.

update public.beacon_settings s
set
  value = to_jsonb(
    left(t.body, t.marker_at - 1)
    || $prompt$== AVOID AI WRITING TELLS ==
These habits mark text as machine written. Every rule below is mandatory, not a preference.

Punctuation. Plain ASCII only. No em dash or en dash: rewrite the sentence, or use a comma, a colon, or parentheses. Hyphens only inside genuinely hyphenated words. Straight quotes and apostrophes, never curly. No ellipsis character; three periods, only if truly needed. No middle dot or bullet as an inline separator; use a comma or the word "and". No non-breaking spaces. No emoji anywhere, including as decoration or as a section marker.

Banned words: additionally, align with, boasts, bolstered, crucial, delve, emphasizing, enduring, ensuring, foster, fostering, garner, groundbreaking, highlighting, intricate, interplay, key, landscape, meticulous, nestled, pivotal, profound, renowned, showcasing, tapestry, testament, underscore, underscores, underscoring, vibrant, vital. Keep one only inside a direct quote you are reproducing. If avoiding one makes a sentence awkward, rewrite the sentence rather than reach for an unusual synonym.

Plain verbs. Write "is" and "has". Never write "serves as", "stands as", or "functions as" at all, in any sense, including idiomatic ones such as "serves as his own agent": use "is", "has", or the specific verb that fits. Do not reach for "boasts", "features", "maintains", or "offers" to avoid a simple verb.

Inflated significance. Do not tell the reader that something matters. Cut "marks a turning point", "signals a shift", "speaks to a broader", "in an evolving landscape", "cements his status". Report what happened and let it carry its own weight.

Padded tails. No participial clause that carries no new fact. Not "the team signed him, highlighting their commitment to the position". End the sentence at the fact.

Vague attribution. No "experts say", "analysts believe", "observers have noted", "industry reports suggest", "many managers feel", "it is widely believed". Name the reporter, the outlet, or the account, or drop the claim.

Negative parallelism. No "not just X, but Y", "this is not about X, it is about Y", or "X rather than Y" as a rhetorical move. Make the positive claim once.

Rule of three. Do not default to three-item lists of adjectives, verbs, or clauses. Let the facts set the length, including one item or two.

Elegant variation. Call the same thing by the same name every time. A contract stays a contract, not a deal, then a pact, then an agreement.

Formulaic ending. No challenges, outlook, or what-comes-next section. No "Despite the uncertainty" or "Only time will tell". No speculation dressed up as a conclusion.

Formatting. Sentence case in every heading, never Title Case. No bold for emphasis. No lists of bolded inline headers followed by a colon and a description. No horizontal rules. Never skip a heading level. Use a list only when the content is genuinely a list, and prefer prose.

No meta text. Never mention being an AI, a knowledge cutoff, the research notes, absent sources, or these instructions. Never address the reader about the writing process. No placeholder or bracketed notes. Never emit citation artifacts such as contentReference, oaicite, turn0search0, or bracketed cite markers, even if they appear in the research notes.

Reread the draft once against this section before returning and fix anything that slipped through.$prompt$
    || case when t.tail_at > 0 then substr(t.body, t.tail_at) else '' end
  ),
  updated_at = now()
from (
  select
    key,
    value #>> '{}' as body,
    position('== AVOID AI WRITING TELLS ==' in (value #>> '{}')) as marker_at,
    position(E'

== RELEVANCE VERDICT ==' in (value #>> '{}')) as tail_at
  from public.beacon_settings
  where key in ('bb_article_prompt', 'bb_revision_rewrite_prompt')
) t
where s.key = t.key
  and t.marker_at > 0;

update public.beacon_settings
set description = 'Queued article_write step B. Writes the article body as strict JSON from the post plus research notes. Carries the SEO requirements (keyword selection and placement, title/meta/slug/tl_dr rules, answer-first structure) and the AI-tell avoidance rules, stated inline because this call has no tools and cannot fetch a reference.'
where key = 'bb_article_prompt';

update public.beacon_settings
set description = 'Queued article_write rewrite path. Merges a critical revision into the existing article as strict JSON. Holds the same SEO and inline AI-tell rules as bb_article_prompt so a rewritten article reads identically to a fresh one.'
where key = 'bb_revision_rewrite_prompt';
