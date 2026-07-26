-- Migration 0147: close a loophole in the bb_article_prompt "Plain verbs" rule
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes blocked).
-- No schema change. Targeted text replacement inside one existing row.
--
-- Why: migration 0146 phrased the rule as "Write is and has. Do not substitute
-- serves as ... to avoid a simple verb." A generated article then produced "he serves
-- as his own agent", which is idiomatic English rather than a substitution for "is",
-- so the model read the rule as not applying. "serves as" and "stands as" are two of
-- the most recognisable AI tells on the Wikipedia guide, so the ban needs to be
-- unconditional rather than conditional on intent.
--
-- Separate migration (not an edit to 0146) because 0146 is already recorded in the
-- remote migration history; rewriting an applied migration would put the file and
-- the database history out of step.

update public.beacon_settings
set value = to_jsonb(
      replace(
        value #>> '{}',
        'Plain verbs. Write "is" and "has". Do not substitute "serves as", "functions as", "boasts", "features", "maintains", or "offers" to avoid a simple verb.',
        'Plain verbs. Write "is" and "has". Never write the phrases "serves as", "stands as", or "functions as" at all, in any sense, including idiomatic ones such as "serves as his own agent": rewrite with "is", "has", or the specific verb that fits. Do not substitute "boasts", "features", "maintains", or "offers" to avoid a simple verb.'
      )
    ),
    updated_at = now()
where key = 'bb_article_prompt';
