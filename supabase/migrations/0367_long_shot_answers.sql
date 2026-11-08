-- Migration 0367: long_shot_answers (one row per served prompt inside a Long
-- Shot attempt). Plan: docs/completed/long-shot/long-shot-plan.md 15.5.
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT own rows through the parent attempt
--   service_role  : ALL (the /next route creates the pending row; the answer
--                   route and recordTimeout settle it)
--   client writes : BLOCKED
--
-- served_at is the server clock for Hurry-Up and is never reset. The row
-- carries ids only; nothing on it reveals another prompt's answers.

create table if not exists public.long_shot_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.long_shot_attempts(id) on delete cascade,
  prompt_id uuid not null references public.long_shot_prompts(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  state text not null default 'pending' check (state in ('pending','answered','timed_out','skipped')),
  served_at timestamptz not null default now(),
  answered_at timestamptz,
  player_id uuid references public.players(id) on delete set null,
  correct boolean,
  tier text check (tier in ('chalk','field','deep','sleeper','long_shot')),
  points integer not null default 0 check (points >= 0),
  lone_signal boolean not null default false,
  unique (attempt_id, position)
);

create index if not exists long_shot_answers_prompt on public.long_shot_answers (prompt_id);

alter table public.long_shot_answers enable row level security;

drop policy if exists long_shot_answers_select_own on public.long_shot_answers;
create policy long_shot_answers_select_own on public.long_shot_answers
  for select to authenticated using (
    exists (
      select 1 from public.long_shot_attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
    )
  );

drop policy if exists long_shot_answers_service_role_all on public.long_shot_answers;
create policy long_shot_answers_service_role_all on public.long_shot_answers
  for all to service_role using (true) with check (true);

revoke insert, update, delete, truncate on public.long_shot_answers from anon, authenticated;
revoke all on public.long_shot_answers from anon;

comment on table public.long_shot_answers is
  'One served prompt inside a Long Shot attempt. Owner may SELECT own rows through the attempt; every write is service-role.';
