-- Migration 0307: ranking_builder_runs (Beacon Ranker runs in progress for
-- signed-in readers; plan section 8)
--
-- A run is an ANSWER LOG, not a state snapshot. The row holds the setup (the
-- seed ids in order, the second pass, the board as it stood, the start rank,
-- the depth, the prompt threshold and the tier lines) and an append-only list
-- of small typed answers. lib/ranking-boards/builder.ts folds the log into the
-- state the page shows, on the server before every write and on the client for
-- display. Undo pops the last answer; resume replays. The row is deleted when
-- the run finishes.
--
-- answer_count is the optimistic lock: an append is written `where answer_count
-- = <the count it read>`, so two tabs answering at once cannot both append to
-- the same log and fork it. checkpoint_count records how many answers the
-- board rows last reflected (they are flushed every N answers, on stop and on
-- finish, not per answer).
--
-- Guest runs do NOT live here: see migration 0308.
--
-- Access matrix
--   anon          : none
--   authenticated : SELECT / INSERT / UPDATE / DELETE own rows only
--                   (auth.uid() = user_id), and INSERT/UPDATE additionally
--                   require the board to belong to the same user
--   service_role  : ALL

create table if not exists public.ranking_builder_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  board_id uuid not null references public.user_ranking_boards(id) on delete cascade,
  setup jsonb not null check (jsonb_typeof(setup) = 'object'),
  answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) <= 20000),
  answer_count integer not null default 0 check (answer_count >= 0),
  checkpoint_count integer not null default 0 check (checkpoint_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One run in progress per board.
  unique (board_id)
);

create index if not exists idx_ranking_builder_runs_user
  on public.ranking_builder_runs(user_id);

alter table public.ranking_builder_runs enable row level security;

drop policy if exists ranking_builder_runs_select_own on public.ranking_builder_runs;
create policy ranking_builder_runs_select_own on public.ranking_builder_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists ranking_builder_runs_insert_own on public.ranking_builder_runs;
create policy ranking_builder_runs_insert_own on public.ranking_builder_runs
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.user_ranking_boards b
      where b.id = board_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists ranking_builder_runs_update_own on public.ranking_builder_runs;
create policy ranking_builder_runs_update_own on public.ranking_builder_runs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.user_ranking_boards b
      where b.id = board_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists ranking_builder_runs_delete_own on public.ranking_builder_runs;
create policy ranking_builder_runs_delete_own on public.ranking_builder_runs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists ranking_builder_runs_service_role_all on public.ranking_builder_runs;
create policy ranking_builder_runs_service_role_all on public.ranking_builder_runs
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.ranking_builder_runs from anon;
