-- 0361: one Discord card per news story.
--
-- Access matrix: no new table. news_ingestions, relays and beacon_settings keep
-- the policies they already have; the two columns below inherit them.
--
-- Why. On 2026-11-04 the Jacoby Brissett trade went out as four Discord cards in
-- one minute. Three were posts that quoted or edited one another, and each got a
-- card of its own because a follow-up with any new fact always posted a new
-- card, and the duplicate check only compared a post against ORIGINAL stories,
-- never against follow-ups. The code change keeps a story on one card; this
-- migration gives it the two things it needs to do that.
--
-- 1. news_ingestions.source_external_ids: every native id this row stands for,
--    its own plus every earlier version in its X edit history. A quote or reply
--    names the id of the version it quoted, and an edited post's earlier ids
--    exist nowhere else in a column a query can reach, so without this a quote
--    of a post that was later edited cannot be linked to it. Kept by a trigger
--    rather than by each insert path, so no path can forget it, and indexed for
--    the overlap lookup.
--
-- 2. relays.discord_card_ingestion_id: the ingestion whose Discord message
--    carries this Relay, when that is not its own. Null means the Relay has (or
--    would have) a card of its own, which is every Relay before this migration.
--    Set only on a published follow-up folded into an existing card.
--
-- 3. Three settings, admin-edited on the Beacon Brief settings page:
--    bb_discord_hold_seconds, bb_discord_edit_window_minutes and
--    bb_discord_coalesce_minutes.

alter table public.news_ingestions
  add column if not exists source_external_ids text[] not null default '{}';

create or replace function public.news_ingestions_set_source_external_ids()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.source_external_ids := array(
    select distinct ids.x
    from (
      select new.source_external_id as x
      union all
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(new.metadata -> 'edit_history_tweet_ids') = 'array'
            then new.metadata -> 'edit_history_tweet_ids'
          else '[]'::jsonb
        end
      )
    ) ids
    where ids.x is not null and ids.x <> ''
  );
  return new;
end;
$$;

-- A trigger function is not callable through the API, but nothing outside the
-- trigger needs it, so no role keeps EXECUTE.
revoke execute on function public.news_ingestions_set_source_external_ids() from public, anon, authenticated;

drop trigger if exists news_ingestions_source_external_ids on public.news_ingestions;
create trigger news_ingestions_source_external_ids
  before insert or update of source_external_id, metadata
  on public.news_ingestions
  for each row
  execute function public.news_ingestions_set_source_external_ids();

update public.news_ingestions n
set source_external_ids = array(
  select distinct ids.x
  from (
    select n.source_external_id as x
    union all
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(n.metadata -> 'edit_history_tweet_ids') = 'array'
          then n.metadata -> 'edit_history_tweet_ids'
        else '[]'::jsonb
      end
    )
  ) ids
  where ids.x is not null and ids.x <> ''
);

create index if not exists news_ingestions_source_external_ids_idx
  on public.news_ingestions using gin (source_external_ids);

alter table public.relays
  add column if not exists discord_card_ingestion_id uuid
    references public.news_ingestions (id) on delete set null;

create index if not exists relays_discord_card_ingestion_id_idx
  on public.relays (discord_card_ingestion_id)
  where discord_card_ingestion_id is not null;

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_discord_hold_seconds', '120'::jsonb, 'number',
   'Hold a new story''s Discord card (seconds)',
   'A new story waits this long before its card posts, so posts that arrive together (a quote, a correction, the version with the photo) go out as one card. Set 0 to post at once.'),
  ('beacon_brief', 'bb_discord_edit_window_minutes', '30'::jsonb, 'number',
   'Edit window for a linked follow-up (minutes)',
   'A follow-up that quotes, replies to or retweets the story''s post, or carries the exact same event key, is added to the story''s card when the card is younger than this. Older cards get a new card instead, because a Discord edit sends no notification. Set 0 to always post a new card.'),
  ('beacon_brief', 'bb_discord_coalesce_minutes', '3'::jsonb, 'number',
   'Combine window for a model-matched follow-up (minutes)',
   'A follow-up the model matched to a story is added to the story''s card only when that card has not posted yet or posted less than this long ago. Past it the follow-up gets its own card, so a wrong match can never hide news. Set 0 to always post a new card.')
on conflict (key) do nothing;
