-- IDP-214 (plan R-20): BEAM resolver tier 6 (trigram typo tolerance) searches
-- individual defensive players too, so a question about a defender resolves
-- through the same tiers as one about an offensive player. The direct lookup
-- in lib/beam/resolve/player.ts widens to the same nine positions in the same
-- change, so every tier sees one pool.
--
-- The body is 0201 lines 66 to 118 unchanged apart from the positions array:
-- SECURITY INVOKER over the already-public players table, inlinable, p_query
-- capped at 80 characters, results at 25 rows. Access matrix unchanged: EXECUTE
-- for anon, authenticated and service_role, all three named in the revoke.

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
  "position" text,
  team text,
  status text,
  search_name text,
  search_last_name text,
  match_similarity real
)
language sql
stable
security invoker
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
    public.similarity(p.search_name, p_query) as match_similarity
  from public.players p
  where char_length(coalesce(p_query, '')) between 2 and 80
    and p.position = any (array['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'])
    and p.search_name operator(public.%) p_query
    and public.similarity(p.search_name, p_query)
        >= greatest(coalesce(p_min_similarity, 0.42), 0.2)
  order by public.similarity(p.search_name, p_query) desc, p.search_name asc
  limit least(greatest(coalesce(p_limit, 8), 1), 25);
$$;

-- Name all three roles. Revoking from PUBLIC alone leaves Supabase's own named
-- grants to anon and authenticated in place.
revoke all on function public.beam_search_players(text, int, real)
  from public, anon, authenticated, service_role;
grant execute on function public.beam_search_players(text, int, real)
  to anon, authenticated, service_role;
