-- players.eligible_positions: every fantasy position a player can be started at.
--
-- Access matrix: unchanged. players keeps its existing policies (public SELECT,
-- service-role writes). No new table.
--
-- WHY. players.position is ONE label, picked by the players sync as the first
-- known entry in Sleeper's fantasy_positions (lib/sync-sleeper-players.ts
-- pickPrimaryPosition). That rule is deliberately NOT changed: it would relabel
-- thousands of players and their depth rooms for no product gain. But a lineup
-- optimiser that seats defenders needs the whole list, because Sleeper lets a
-- ["DL","LB"] player start in either slot. Until now that list lived only in
-- metadata.sleeper.fantasy_positions.
--
-- THE RULE. Sleeper's fantasy_positions, upper-cased, in Sleeper's order,
-- FILTERED to the nine positions League Pulse knows (QB RB WR TE K DEF DL LB
-- DB). Labels like OL, LS, LEO and OT are dropped. When nothing survives the
-- filter, the list is the primary position alone. The players sync fills the
-- column from here on (IDP-111); this backfills what is already stored.
--
-- Plan: docs/idp/idp-guide-and-data-plan.md, task IDP-105.

alter table public.players
  add column if not exists eligible_positions text[] not null default '{}';

update public.players p
set eligible_positions = coalesce(
  (
    select array_agg(fp.pos order by fp.ord)
    from (
      select distinct on (upper(value)) upper(value) as pos, ord
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(p.metadata -> 'sleeper' -> 'fantasy_positions') = 'array'
            then p.metadata -> 'sleeper' -> 'fantasy_positions'
          else '[]'::jsonb
        end
      ) with ordinality as t(value, ord)
      where upper(value) in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB')
      order by upper(value), ord
    ) fp
  ),
  array[p.position]
);
