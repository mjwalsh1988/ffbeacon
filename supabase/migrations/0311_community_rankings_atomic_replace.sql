-- Migration 0311: community rankings, atomic rebuild and a publish threshold
-- counted in people (Beacon Ranker, plan section 9)
--
-- 1. community_ranking_formats.eligible_accounts: the number of distinct
--    accounts with a counted board in the format. eligible_boards stays the
--    number of counted boards. The nightly job decides `published` from
--    eligible_accounts, because one person's overall board and four position
--    boards are five boards and one opinion.
--
-- 2. public.replace_community_rankings(format, rows, format_row): the nightly
--    job used to delete a format's rows, insert them in chunks and then upsert
--    the format row, so a reader mid-build saw an empty or partial list and a
--    failed chunk left a truncated list published. This function does all three
--    in ONE transaction. The job passes an empty row set for a format that is
--    not published, so an unpublished format holds no public rows.
--
-- No table is created, so no new RLS policy is needed; the policies from 0309
-- still apply to both tables.
--
-- Access matrix
--   community_rankings / community_ranking_formats: unchanged from 0309
--     (anon + authenticated SELECT, service_role ALL, no client writes).
--   replace_community_rankings: EXECUTE for service_role only. Revoked from
--     public, anon and authenticated by name, because revoking from public
--     alone leaves Supabase's named grants in place.

alter table public.community_ranking_formats
  add column if not exists eligible_accounts integer not null default 0
    check (eligible_accounts >= 0);

create or replace function public.replace_community_rankings(
  p_format_config_id uuid,
  p_rows jsonb,
  p_format jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_format_config_id is null then
    raise exception 'replace_community_rankings: format id is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'replace_community_rankings: rows must be a json array';
  end if;
  if p_format is null or jsonb_typeof(p_format) <> 'object' then
    raise exception 'replace_community_rankings: format must be a json object';
  end if;

  delete from public.community_rankings
  where format_config_id = p_format_config_id;

  insert into public.community_rankings (
    format_config_id, player_id, position, strength, overall_rank,
    position_rank, previous_rank, boards_count, group_key, built_at
  )
  select
    p_format_config_id,
    r.player_id,
    r.position,
    r.strength,
    r.overall_rank,
    r.position_rank,
    r.previous_rank,
    r.boards_count,
    r.group_key,
    coalesce(r.built_at, now())
  from jsonb_to_recordset(p_rows) as r(
    player_id uuid,
    position text,
    strength double precision,
    overall_rank integer,
    position_rank integer,
    previous_rank integer,
    boards_count integer,
    group_key text,
    built_at timestamptz
  );
  get diagnostics v_inserted = row_count;

  insert into public.community_ranking_formats (
    format_config_id, eligible_boards, eligible_accounts, published,
    players_listed, groups, built_at, previous_built_at
  )
  values (
    p_format_config_id,
    coalesce((p_format->>'eligible_boards')::integer, 0),
    coalesce((p_format->>'eligible_accounts')::integer, 0),
    coalesce((p_format->>'published')::boolean, false),
    coalesce((p_format->>'players_listed')::integer, 0),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p_format->'groups', '[]'::jsonb))),
      '{}'::text[]
    ),
    coalesce((p_format->>'built_at')::timestamptz, now()),
    (p_format->>'previous_built_at')::timestamptz
  )
  on conflict (format_config_id) do update set
    eligible_boards = excluded.eligible_boards,
    eligible_accounts = excluded.eligible_accounts,
    published = excluded.published,
    players_listed = excluded.players_listed,
    groups = excluded.groups,
    built_at = excluded.built_at,
    previous_built_at = excluded.previous_built_at;

  return v_inserted;
end;
$$;

revoke all on function public.replace_community_rankings(uuid, jsonb, jsonb) from public;
revoke all on function public.replace_community_rankings(uuid, jsonb, jsonb) from anon;
revoke all on function public.replace_community_rankings(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.replace_community_rankings(uuid, jsonb, jsonb) to service_role;
