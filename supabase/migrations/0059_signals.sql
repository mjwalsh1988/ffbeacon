-- Migration 0059: signals (public creator profile root) + handle support
--
-- Signal is FF Beacon's public creator-profile feature. `signals` is the public
-- projection layer for a creator's profile: it is deliberately SEPARATE from the
-- owner-only user_preferences table because this data is read by anonymous
-- visitors when the profile is published and public. One row per user.
--
-- Access matrix:
--   signals
--     anon          : SELECT only published+public+not-hidden rows
--     authenticated : SELECT own row (any state) OR published+public+not-hidden;
--                     INSERT/UPDATE own row, restricted to owner-writable columns
--                     (hidden/hidden_*/follower_count are NOT client-writable);
--                     DELETE own row
--     service_role  : ALL (admin moderation, follower-count maintenance)
--   signal_reserved_handles : SELECT public; writes service_role only
--   signal_handle_history   : SELECT public (drives 301 redirects); writes service_role
--
-- hidden / hidden_reason / hidden_at : admin takedown of an entire Signal. Only
--   service_role can set these (enforced by the column-level GRANTs below).
-- follower_count : denormalized public counter, maintained by the trigger in
--   migration 0063. Not client-writable (column GRANTs).

create extension if not exists citext;

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  handle citext not null unique
    check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 50),
  headline text check (headline is null or char_length(headline) <= 120),
  bio text check (bio is null or char_length(bio) <= 2000),
  accent text not null default 'beacon'
    check (accent in ('beacon','purple','cyan','emerald','amber','rose','sky','slate')),
  layout text not null default 'feed'
    check (layout in ('feed','sidebar','spotlight')),
  avatar_path text,
  banner_path text,
  favorite_team text
    check (favorite_team is null or favorite_team in (
      'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB',
      'HOU','IND','JAX','KC','LV','LAC','LAR','MIA','MIN','NE','NO','NYG',
      'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS')),
  favorite_player_id uuid references public.players(id) on delete set null,
  links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array'),
  layout_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(layout_config) = 'object'),
  status text not null default 'draft' check (status in ('draft','published')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  hidden boolean not null default false,
  hidden_reason text,
  hidden_at timestamptz,
  follower_count integer not null default 0 check (follower_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_signals_user on public.signals(user_id);
create index if not exists idx_signals_public
  on public.signals(handle)
  where status = 'published' and visibility = 'public' and hidden = false;

create table if not exists public.signal_reserved_handles (
  handle citext primary key
);

create table if not exists public.signal_handle_history (
  old_handle citext primary key,
  signal_id uuid not null references public.signals(id) on delete cascade,
  changed_at timestamptz not null default now()
);
create index if not exists idx_signal_handle_history_signal
  on public.signal_handle_history(signal_id);

-- Seed reserved handles: route collisions plus common reserved/abuse words.
insert into public.signal_reserved_handles (handle) values
  ('rankings'),('leagues'),('league'),('tools'),('tool'),('my-beacon'),
  ('mybeacon'),('author'),('about'),('api'),('admin'),('administrator'),
  ('signal'),('signals'),('u'),('user'),('users'),('login'),('logout'),
  ('signup'),('signin'),('register'),('settings'),('setting'),('account'),
  ('help'),('support'),('contact'),('terms'),('privacy'),('legal'),('faq'),
  ('dashboard'),('faab'),('home'),('explore'),('search'),('feed'),('og'),
  ('static'),('assets'),('public'),('app'),('www'),('mail'),('root'),
  ('moderator'),('mod'),('staff'),('team'),('official'),('ffbeacon'),
  ('beacon'),('null'),('undefined'),('me'),('you')
on conflict (handle) do nothing;

alter table public.signals enable row level security;
alter table public.signal_reserved_handles enable row level security;
alter table public.signal_handle_history enable row level security;

-- signals policies -----------------------------------------------------------
drop policy if exists signals_select_public on public.signals;
create policy signals_select_public on public.signals
  for select to anon, authenticated
  using (status = 'published' and visibility = 'public' and hidden = false);

drop policy if exists signals_select_own on public.signals;
create policy signals_select_own on public.signals
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists signals_insert_own on public.signals;
create policy signals_insert_own on public.signals
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists signals_update_own on public.signals;
create policy signals_update_own on public.signals
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists signals_delete_own on public.signals;
create policy signals_delete_own on public.signals
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists signals_service_role_all on public.signals;
create policy signals_service_role_all on public.signals
  for all to service_role using (true) with check (true);

-- Column-level write protection. The owner can edit profile content but can
-- NEVER set the moderation columns (hidden/hidden_reason/hidden_at) or the
-- denormalized follower_count. Those are service_role + trigger territory. We
-- revoke the blanket INSERT/UPDATE and re-grant only owner-writable columns.
revoke insert, update on public.signals from anon, authenticated;
grant insert (
  user_id, handle, display_name, headline, bio, accent, layout,
  avatar_path, banner_path, favorite_team, favorite_player_id,
  links, layout_config, status, visibility, published_at,
  created_at, updated_at
) on public.signals to authenticated;
grant update (
  handle, display_name, headline, bio, accent, layout,
  avatar_path, banner_path, favorite_team, favorite_player_id,
  links, layout_config, status, visibility, published_at, updated_at
) on public.signals to authenticated;

-- reserved handles + history: public read, service-role writes ---------------
drop policy if exists signal_reserved_handles_select_public on public.signal_reserved_handles;
create policy signal_reserved_handles_select_public on public.signal_reserved_handles
  for select to anon, authenticated using (true);

drop policy if exists signal_reserved_handles_service_role_all on public.signal_reserved_handles;
create policy signal_reserved_handles_service_role_all on public.signal_reserved_handles
  for all to service_role using (true) with check (true);

drop policy if exists signal_handle_history_select_public on public.signal_handle_history;
create policy signal_handle_history_select_public on public.signal_handle_history
  for select to anon, authenticated using (true);

drop policy if exists signal_handle_history_service_role_all on public.signal_handle_history;
create policy signal_handle_history_service_role_all on public.signal_handle_history
  for all to service_role using (true) with check (true);
