-- Migration 0199: beam_search_players() RPC
--
-- Access matrix:
--   anon          : EXECUTE
--   authenticated : EXECUTE
--   service_role  : EXECUTE
--
-- SECURITY INVOKER on purpose: the function reads public.players, which already
-- has a public SELECT policy, so the caller's own RLS applies and the function
-- grants no access the caller did not already have.
--
-- WHY AN RPC AT ALL
-- Tier 6 of BEAM's player resolver is trigram similarity: it is what turns
-- "brock prudy" into Brock Purdy. PostgREST cannot express similarity() in a
-- select, and it cannot ORDER BY it, so the alternative would be pulling all
-- 10,435 player rows into the Node process and scoring them there on every
-- fuzzy lookup. This keeps the work in the database, on the GIN index added in
-- migration 0194.
--
-- ABUSE NOTE
-- This is callable by anon, like every other read of public.players. It exposes
-- nothing new: the same rows are already reachable through PostgREST with an
-- ilike filter, and that path is a sequential scan while this one is an index
-- scan, so this function is the CHEAPER way to ask. The result set is clamped to
-- 25 and queries under two characters return nothing, so it cannot be used to
-- page the table out. The BEAM endpoint that calls it is separately rate
-- limited.
--
-- The % operator is what selects the index; it uses pg_trgm's session
-- similarity threshold (0.3 by default). The explicit similarity() predicate
-- then applies BEAM's own, stricter floor (0.42 by default, admin-tunable in
-- beam_settings). Both are needed: % alone would be too loose, and similarity()
-- alone would not use the index.

create or replace function public.beam_search_players(
  p_query text,
  p_limit int default 8,
  p_min_similarity real default 0.42
)
returns table (
  id uuid,
  slug text,
  first_name text,
  last_name text,
  full_name text,
  -- Quoted: `position` is a reserved word in a RETURNS TABLE column list.
  "position" text,
  team text,
  status text,
  search_name text,
  search_last_name text,
  -- Not named `similarity`: an output column of that name shadows the pg_trgm
  -- function of the same name inside the body.
  match_similarity real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.slug,
    p.first_name,
    p.last_name,
    p.full_name,
    p.position,
    p.team,
    p.status,
    p.search_name,
    p.search_last_name,
    similarity(p.search_name, p_query) as match_similarity
  from public.players p
  where char_length(coalesce(p_query, '')) >= 2
    and p.position = any (array['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
    and p.search_name % p_query
    and similarity(p.search_name, p_query) >= greatest(coalesce(p_min_similarity, 0.42), 0.2)
  order by similarity(p.search_name, p_query) desc, p.search_name asc
  limit least(greatest(coalesce(p_limit, 8), 1), 25);
$$;

-- Name all three roles explicitly. Revoking from PUBLIC alone leaves Supabase's
-- own named grants to anon and authenticated in place.
revoke all on function public.beam_search_players(text, int, real) from public, anon, authenticated, service_role;
grant execute on function public.beam_search_players(text, int, real) to anon, authenticated, service_role;

comment on function public.beam_search_players(text, int, real) is
  'Trigram player search for BEAM resolver tier 6 (typo tolerance). SECURITY INVOKER over the already-public players table; result clamped to 25 rows. Uses idx_players_search_name_trgm.';
