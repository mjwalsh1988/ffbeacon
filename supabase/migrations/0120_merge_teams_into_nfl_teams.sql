-- Migration 0120: merge teams into nfl_teams (single NFL team dimension)
--
-- Two overlapping NFL-team dimension tables existed at the same grain (one row
-- per NFL team, keyed on abbreviation):
--   - public.teams      (0084): abbreviation, name, conference, division,
--                               discord_role_ids  -> The Beacon Brief tagging
--                               and team-based Discord pings
--   - public.nfl_teams  (0117): abbreviation, name, primary/secondary/tertiary
--                               _color, chant     -> player-profile branding
-- Both held all 32 teams with identical abbreviations and names. This merges
-- them into ONE canonical dimension named nfl_teams.
--
-- The only foreign key in play is article_teams.team_id -> teams.id, and nothing
-- references nfl_teams.id. So we keep teams' id values (preserving that FK),
-- absorb the branding columns into teams, drop the old nfl_teams, then rename
-- teams -> nfl_teams. The FK follows the rename automatically. Code that reads
-- nfl_teams does so by abbreviation (unchanged), so it keeps working.
--
-- Access matrix (unchanged, carried over from both source tables):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

-- 1. Add branding columns to teams (nullable for the copy step).
alter table public.teams add column if not exists primary_color text;
alter table public.teams add column if not exists secondary_color text;
alter table public.teams add column if not exists tertiary_color text;
alter table public.teams add column if not exists chant text;

-- 2. Copy branding data from nfl_teams, matched by abbreviation.
update public.teams t
set primary_color   = n.primary_color,
    secondary_color = n.secondary_color,
    tertiary_color  = n.tertiary_color,
    chant           = n.chant
from public.nfl_teams n
where t.abbreviation = n.abbreviation;

-- 3. Guard: abort before any destructive step if any team row is missing
--    branding, or if the row counts did not line up 1:1.
do $$
declare
  missing int;
  teams_ct int;
  nfl_ct int;
begin
  select count(*) into missing
  from public.teams
  where primary_color is null or secondary_color is null
     or tertiary_color is null or chant is null;
  if missing > 0 then
    raise exception 'Merge aborted: % teams row(s) missing branding after copy', missing;
  end if;

  select count(*) into teams_ct from public.teams;
  select count(*) into nfl_ct from public.nfl_teams;
  if teams_ct <> nfl_ct then
    raise exception 'Merge aborted: row count mismatch (teams=%, nfl_teams=%)', teams_ct, nfl_ct;
  end if;
end $$;

-- 4. Lock the branding columns down to match the original nfl_teams contract
--    (NOT NULL + hex-format CHECK). These pass because the copied values came
--    from nfl_teams, which already enforced these constraints.
alter table public.teams alter column primary_color set not null;
alter table public.teams alter column secondary_color set not null;
alter table public.teams alter column tertiary_color set not null;
alter table public.teams alter column chant set not null;

alter table public.teams
  add constraint nfl_teams_primary_color_check
  check (primary_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.teams
  add constraint nfl_teams_secondary_color_check
  check (secondary_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.teams
  add constraint nfl_teams_tertiary_color_check
  check (tertiary_color ~ '^#[0-9A-Fa-f]{6}$');

-- 5. Drop the now-redundant nfl_teams table. Nothing FK-references its id.
drop table public.nfl_teams;

-- 6. Rename teams -> nfl_teams. The article_teams.team_id FK follows the rename.
alter table public.teams rename to nfl_teams;

-- 7. Rename inherited constraints, indexes, and policies to the nfl_teams_*
--    convention. The old nfl_teams names were freed by the drop in step 5.
alter table public.nfl_teams rename constraint teams_pkey to nfl_teams_pkey;
alter table public.nfl_teams rename constraint teams_abbreviation_key to nfl_teams_abbreviation_key;
alter table public.nfl_teams rename constraint teams_conference_check to nfl_teams_conference_check;
alter table public.nfl_teams rename constraint teams_division_check to nfl_teams_division_check;

alter index public.idx_teams_conf_div rename to idx_nfl_teams_conf_div;
alter index public.idx_teams_name_trgm rename to idx_nfl_teams_name_trgm;

alter policy teams_select_public on public.nfl_teams rename to nfl_teams_select_public;
alter policy teams_service_role_all on public.nfl_teams rename to nfl_teams_service_role_all;

-- 8. Refresh the table comment for the unified dimension.
comment on table public.nfl_teams is
  'Canonical NFL teams dimension (merged from teams 0084 + nfl_teams 0117 in 0120). One row per NFL team, keyed on abbreviation which matches Sleeper-sourced players.team. Carries editorial fields (conference, division, discord_role_ids for Beacon Brief tagging and Discord pings) and branding fields (primary/secondary/tertiary_color, chant for player profiles). Public SELECT, service_role writes.';
