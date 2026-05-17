-- Migration 0008: user_preferences
--
-- Access matrix:
--   anon          : NONE
--   authenticated : SELECT/INSERT/UPDATE/DELETE OWN row only (auth.uid() = user_id)
--   service_role  : ALL

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_format_config_id uuid references public.format_configs(id),
  sleeper_username text,
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  email_digest_enabled boolean not null default false,
  favorite_players jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_preferences_delete_own on public.user_preferences;
create policy user_preferences_delete_own on public.user_preferences
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_preferences_service_role_all on public.user_preferences;
create policy user_preferences_service_role_all on public.user_preferences
  for all to service_role using (true) with check (true);
