-- Migration 0365: long_shot_prompts (up to five prompts per Long Shot puzzle,
-- each carrying its frozen, tiered answer set). Plan:
-- docs/completed/long-shot/long-shot-plan.md 15.3.
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL
--   client writes : BLOCKED
--
-- The answers column is the anti-cheat boundary. No client role ever reads
-- this table; the game routes read it server-side and return only the prompt
-- text, and the room figures after an answer is recorded.

create table if not exists public.long_shot_prompts (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.long_shot_puzzles(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  template_key text not null,
  prompt_text text not null,
  params jsonb not null default '{}'::jsonb,
  answers jsonb not null,
  answer_count integer not null check (answer_count > 0),
  answered_total integer not null default 0 check (answered_total >= 0),
  unique (puzzle_id, position)
);

alter table public.long_shot_prompts enable row level security;

drop policy if exists long_shot_prompts_service_role_all on public.long_shot_prompts;
create policy long_shot_prompts_service_role_all on public.long_shot_prompts
  for all to service_role using (true) with check (true);

revoke all on public.long_shot_prompts from anon, authenticated;

comment on table public.long_shot_prompts is
  'Long Shot prompts with their frozen answer sets (answers jsonb: player_id, tier, rate). Service-role only; never readable by a client role.';
