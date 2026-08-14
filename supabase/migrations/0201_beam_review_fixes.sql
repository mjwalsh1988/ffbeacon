-- Migration 0201: BEAM review fixes
--
-- Access matrix: unchanged. This alters seeded data in beam_player_aliases and
-- replaces the beam_search_players function created in 0199.
--
-- Three problems found in review, all in code and data shipped by 0195 and 0199.
--
-- ------------------------------------------------------------------------
-- 1. SURNAME ALIASES DEFEATED THE SAFETY RULE THEY WERE SUPPOSED TO RESPECT
-- ------------------------------------------------------------------------
-- The resolver groups candidates by tier and lets only the best tier compete,
-- so a single alias hit at 0.95 wins outright and the surname collision that
-- should have forced a clarification never gets to argue.
--
-- Migration 0195 seeded ~48 aliases that were nothing but the player's own
-- surname, and 23 of those surnames are shared with other fantasy-position
-- players. "cook" resolved to James Cook at 0.95 with six other Cooks in the
-- table and no question asked. "evans" beat eleven other Evanses.
--
-- Those rows are deleted here. Nothing is lost: tier 4 of the resolver already
-- matches a bare surname algorithmically, for EVERY player, including the ones
-- who sign next season. It answers when the surname is unique and asks when it
-- is not, which is the behaviour the alias rows were overriding.
--
-- Genuine nicknames stay. "cmc", "hollywood", "sun god", and "jsn" are not
-- surnames and no algorithm produces them.
--
-- ------------------------------------------------------------------------
-- 2. THE SEARCH FUNCTION WAS NEVER INLINED, COSTING 4x ON EVERY QUESTION
-- ------------------------------------------------------------------------
-- `SET search_path = public` puts a proconfig entry on the function, and
-- Postgres refuses to inline any SQL function that carries one. So the body was
-- planned at execution time on every call: 5.4 ms warm and 43-62 ms on a cold
-- backend, against 1.3 ms for the identical body inlined. Under a
-- transaction-mode pooler, cold is the common case.
--
-- The SET clause is dropped and every reference is schema-qualified instead,
-- including the pg_trgm operator and function, so the body cannot be captured by
-- a hostile search_path. The function is SECURITY INVOKER over a table with a
-- public SELECT policy, so it grants nothing the caller did not already have.
--
-- ------------------------------------------------------------------------
-- 3. NO INPUT LENGTH CAP MADE IT AN UNAUTHENTICATED CPU AMPLIFIER
-- ------------------------------------------------------------------------
-- The only guard was a minimum of two characters. PostgREST exposes the function
-- to anyone holding the publishable key, which ships to every browser, so the
-- application rate limit on /api/beam/ask did not bound it. A 1 MB p_query cost
-- 750 ms against 5 ms for a real name: a 150x multiplier the caller chose for
-- free. The resolver never sends more than a four-token name span, so 80
-- characters is generous.

/* ---------------------------------------------------------------- */
/* 1. Drop the surname aliases                                       */
/* ---------------------------------------------------------------- */

delete from public.beam_player_aliases a
using public.players p
where p.id = a.player_id
  and a.source = 'seed'
  and a.alias::text = p.search_last_name;

/* ---------------------------------------------------------------- */
/* 2 and 3. Replace the search function                              */
/* ---------------------------------------------------------------- */

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
    and p.position = any (array['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
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

comment on function public.beam_search_players(text, int, real) is
  'Trigram player search for BEAM resolver tier 6 (typo tolerance). SECURITY INVOKER over the already-public players table. Inlinable (no SET clause, everything schema-qualified); p_query capped at 80 characters and results at 25 rows.';

comment on table public.beam_player_aliases is
  'Editorial nickname and shorthand map for BEAM player resolution (tier 3 of the resolver). Public SELECT; writes via the admin editor with the service role. An alias must NOT be a bare surname: tier 4 matches those algorithmically and asks when the surname is shared, whereas an alias would answer outright for one of them. The admin editor rejects surname aliases for that reason.';
