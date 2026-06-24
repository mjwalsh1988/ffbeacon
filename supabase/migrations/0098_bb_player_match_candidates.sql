-- Migration 0098: bb_player_match_candidates (Beacon Brief reference matching)
--
-- The curation matcher needs the top trigram-similar players for an AI-returned
-- name, both to detect an exact-normalized match and to pre-attach ranked
-- suggestions to a moderation row when nothing confident is found. The Supabase
-- JS client cannot express `order by similarity(...)`, so this function does it.
--
-- It uses the `%` operator (GIN trigram index on players.full_name from
-- migration 0095) with the per-call threshold applied via a transaction-local
-- set_config, then ranks by similarity and prefers active players on ties.
--
-- SECURITY INVOKER (default): runs with the caller's privileges; players is
-- public-read so this is safe. Execute is restricted to service_role (the
-- curation pipeline uses the service-role client). No client-facing path.

create or replace function public.bb_player_match_candidates(
  p_name text,
  p_limit integer default 8,
  p_threshold real default 0.3
)
returns table (
  id uuid,
  full_name text,
  status text,
  team text,
  pos text,
  sim real
)
language plpgsql
stable
as $$
begin
  perform set_config('pg_trgm.similarity_threshold', p_threshold::text, true);
  return query
    select p.id, p.full_name, p.status, p.team, p.position,
           similarity(p.full_name, p_name) as sim
    from public.players p
    where p.full_name is not null
      and p.full_name % p_name
    order by similarity(p.full_name, p_name) desc, (p.status = 'active') desc
    limit greatest(p_limit, 0);
end;
$$;

revoke all on function public.bb_player_match_candidates(text, integer, real) from public;
revoke all on function public.bb_player_match_candidates(text, integer, real) from anon;
revoke all on function public.bb_player_match_candidates(text, integer, real) from authenticated;
grant execute on function public.bb_player_match_candidates(text, integer, real) to service_role;

comment on function public.bb_player_match_candidates(text, integer, real) is
  'Returns up to p_limit players whose full_name is trigram-similar to p_name above p_threshold, ranked by similarity (active first on ties). Used by the Beacon Brief reference matcher. service_role execute only.';
