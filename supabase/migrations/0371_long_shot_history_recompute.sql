-- Migration 0371: long_shot_history_recompute, the aggregate pass behind the
-- monthly history sync. Plan: docs/completed/long-shot/long-shot-plan.md 31.3.
--
-- The sync (lib/long-shot/history/sync.ts) upserts only the seasons it read,
-- so a person's career-wide columns (first and last season, seasons played,
-- franchises, 1999-on career totals) are recomputed here from the season and
-- stat rows for everyone touched since p_since, or for everyone when p_since
-- is null. Prominence is recomputed in TypeScript afterwards, because its
-- formula lives in one place (lib/long-shot/history/prominence.ts).
--
-- Access matrix: service_role EXECUTE only (revoked from public, anon and
-- authenticated by name, since Supabase grants them separately).

create or replace function public.long_shot_history_recompute(p_since integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with affected as (
    select hp.id
    from public.history_players hp
    where p_since is null
       or exists (
         select 1 from public.history_player_seasons s
         where s.history_player_id = hp.id and s.season >= p_since
       )
       or exists (
         select 1 from public.history_player_season_stats st
         where st.history_player_id = hp.id and st.season >= p_since
       )
  ),
  seasons as (
    select a.id,
           min(x.season) as first_season,
           max(x.season) as last_season,
           count(distinct x.season) as seasons_played
    from affected a
    join (
      select history_player_id, season from public.history_player_seasons
      union
      select history_player_id, season from public.history_player_season_stats
    ) x on x.history_player_id = a.id
    group by a.id
  ),
  franchises as (
    select a.id,
           array_remove(array_agg(f.franchise_key order by f.first_season, f.franchise_key), null) as franchise_keys
    from affected a
    left join (
      select history_player_id, franchise_key, min(season) as first_season
      from public.history_player_seasons
      where franchise_key is not null
      group by history_player_id, franchise_key
    ) f on f.history_player_id = a.id
    group by a.id
  ),
  totals as (
    select a.id,
           sum(st.games)::integer as games,
           sum(st.pass_yd)::integer as pass_yd,
           sum(st.pass_td)::integer as pass_td,
           sum(st.rush_yd)::integer as rush_yd,
           sum(st.rush_td)::integer as rush_td,
           sum(st.rec)::integer as rec,
           sum(st.rec_yd)::integer as rec_yd,
           sum(st.rec_td)::integer as rec_td
    from affected a
    join public.history_player_season_stats st on st.history_player_id = a.id
    group by a.id
  )
  update public.history_players hp
  set first_season = coalesce(s.first_season, hp.first_season),
      last_season = coalesce(s.last_season, hp.last_season),
      seasons_played = coalesce(s.seasons_played, hp.seasons_played)::integer,
      franchise_keys = coalesce(f.franchise_keys, '{}'),
      career_games = t.games,
      career_pass_yd = t.pass_yd,
      career_pass_td = t.pass_td,
      career_rush_yd = t.rush_yd,
      career_rush_td = t.rush_td,
      career_rec = t.rec,
      career_rec_yd = t.rec_yd,
      career_rec_td = t.rec_td
  from affected a
  left join seasons s on s.id = a.id
  left join franchises f on f.id = a.id
  left join totals t on t.id = a.id
  where hp.id = a.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.long_shot_history_recompute(integer) from public, anon, authenticated;
grant execute on function public.long_shot_history_recompute(integer) to service_role;

comment on function public.long_shot_history_recompute(integer) is
  'Recomputes the career-wide columns of history_players from its season and stat rows, for people with a row in or after p_since (all when null). Service role only; the history sync calls it after every run.';
