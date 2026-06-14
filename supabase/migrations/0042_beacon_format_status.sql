-- Migration 0042: beacon_format_status (placeholder / baseline labeling)
--
-- Access matrix:
--   anon          : SELECT  (the placeholder badge is shown to public users)
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Best-ball presets are baselined off their redraft/dynasty counterpart's
-- consensus and must be labeled placeholder / low-confidence until manually
-- diverged, not presented as real best-ball reads. This table drives that badge.
-- Public SELECT because the rankings UI renders the badge for everyone.

create table if not exists public.beacon_format_status (
  format_config_id uuid primary key references public.format_configs(id) on delete cascade,
  is_placeholder boolean not null default false,
  baseline_format_config_id uuid references public.format_configs(id) on delete set null,
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.beacon_format_status enable row level security;

drop policy if exists beacon_format_status_select_public on public.beacon_format_status;
create policy beacon_format_status_select_public on public.beacon_format_status
  for select to anon, authenticated using (true);

drop policy if exists beacon_format_status_service_role_all on public.beacon_format_status;
create policy beacon_format_status_service_role_all on public.beacon_format_status
  for all to service_role using (true) with check (true);

-- Seed: the 3 best-ball presets start as placeholders, baselined off the
-- counterpart that matches league_type + scoring_type + is_superflex with
-- is_bestball = false.
insert into public.beacon_format_status (format_config_id, is_placeholder, baseline_format_config_id, note)
select
  bb.id,
  true,
  base.id,
  'Baselined from ' || base.display_name || ' until manually diverged for best ball.'
from public.format_configs bb
join public.format_configs base
  on base.is_bestball = false
 and base.league_type = bb.league_type
 and base.scoring_type = bb.scoring_type
 and base.is_superflex = bb.is_superflex
 and base.te_premium_bonus = bb.te_premium_bonus
where bb.is_bestball = true
on conflict (format_config_id) do nothing;

comment on table public.beacon_format_status is
  'Drives the placeholder / baseline badge for FF Beacon formats (best-ball presets start placeholder until diverged). Public SELECT for the UI badge.';
