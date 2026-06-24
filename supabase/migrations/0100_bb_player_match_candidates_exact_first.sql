-- Migration 0100: bb_player_match_candidates exact-match tie-break
--
-- Fixes a correctness gap: the function returns only the top p_limit rows by
-- trigram similarity. For a common surname, many trigram-similar names can crowd
-- the list and push the TRUE exact-name player below the limit, so the matcher
-- (which only confirms an auto-link from the returned slice) silently downgrades
-- a confident match to manual moderation.
--
-- Fix: order any case-insensitive exact full_name match FIRST, so an exact match
-- is always returned within the limit. similarity() still ranks the remainder,
-- and active players still win ties among non-exacts. (Punctuation/suffix-only
-- differences keep a high similarity score and are caught by the normalized
-- equality re-check in lib/beacon-brief/match.ts, so they remain within range.)

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
    order by (lower(p.full_name) = lower(p_name)) desc,
             similarity(p.full_name, p_name) desc,
             (p.status = 'active') desc
    limit greatest(p_limit, 0);
end;
$$;

comment on function public.bb_player_match_candidates(text, integer, real) is
  'Returns up to p_limit players whose full_name is trigram-similar to p_name above p_threshold, exact case-insensitive matches first, then by similarity (active first on ties). Used by the Beacon Brief reference matcher. service_role execute only.';
