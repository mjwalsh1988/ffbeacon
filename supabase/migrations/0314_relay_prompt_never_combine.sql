-- The relay prompt gains a NEVER COMBINE rule. On 2026-09-27 a relay built
-- from "Chargers TE Patrick Herbert ... will make his NFL debut today in
-- Buffalo" published the fact "Brother Justin Herbert plays for Buffalo
-- Chargers": the model joined a team from the post to a city from the post into
-- a team that does not exist, and moved a detail about one brother onto the
-- other. lib/relays/grounding.ts now holds back a city and nickname pair that is
-- not a real team; this rule asks the model not to write one in the first place,
-- so a correct relay is not held for review.
--
-- TWO rows, on purpose. The classify call reads bb_categorize_prompt, which has
-- carried its own copy of the RELAY section since migration 0285;
-- bd_relay_extract_prompt is appended only to a prompt that has lost the marker
-- line (lib/relays/extract.ts withRelaySection). Updating one row alone would
-- change either nothing live or nothing the fallback uses.
--
-- Data only. Access matrix unchanged: beacon_settings keeps its existing policies.
-- An insert after one anchor sentence rather than a whole-text overwrite, so any
-- other edit the owner has made survives. If the owner has reworded the anchor,
-- this is a no-op for that row and the rule is added in the admin by hand. The
-- NOT LIKE guard makes a rerun a no-op.
-- Mirrors lib/relays/extract.ts RELAY_PROMPT_SECTION.

update beacon_settings
set value = to_jsonb(replace(
      value #>> '{}',
      $old$a right figure changed by you is our error and nobody can find it.$old$,
      $new$a right figure changed by you is our error and nobody can find it.

NEVER COMBINE. A place is not a team. When the post says a team is playing in, at or against a city, keep the team and the city apart as the post does: "Chargers" and "in Buffalo" never become "Buffalo Chargers". Put a city in front of a team name only when the post writes those two words together. The same goes for people: a detail the post gives about one player (his team, his game, his injury, his contract) is never moved onto another player it mentions. If the post does not say which team a second player is on, the relay does not say it either. A relay carrying a team name that does not exist is held back from Discord automatically, so a relay that combines is a relay nobody sees.$new$
    )),
    updated_at = now()
where key in ('bb_categorize_prompt', 'bd_relay_extract_prompt')
  and position($old$a right figure changed by you is our error and nobody can find it.$old$ in value #>> '{}') > 0
  and value #>> '{}' not like '%NEVER COMBINE.%';
