-- 0282_site_layout_settings
--
-- The admin-edited site layout: the order of the navigation menu (its
-- sections and its Tools submenu, which the footer Tools column follows), the
-- order of the sections on /tools, and the homepage tool cards (order, width,
-- tag and highlight). Edited at /admin/site-layout.
--
-- One global jsonb row, the same shape as would_you_rather_settings and
-- league_power_pulse_settings. The code carries the same values as fallbacks in
-- lib/site-layout/default-settings.ts, and lib/site-layout/parse.test.ts fails
-- if the seed below and those defaults ever disagree.
--
-- The seed is the layout the site carried on the day this shipped, so applying
-- this migration changes nothing a reader can see.
--
-- Read server-side with the service-role client (every page reads it through
-- Next's data cache, tagged and revalidated on save; lib/site-layout/settings.ts),
-- written only by the admin server action after requireAdmin() and a strict
-- validation. 0283 revokes the default anon and authenticated grants.
--
-- Access matrix:
--   site_layout_settings
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL

create table if not exists public.site_layout_settings (
  id text primary key default 'global',
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint site_layout_settings_singleton check (id = 'global')
);

alter table public.site_layout_settings enable row level security;

drop policy if exists site_layout_settings_service_role_all
  on public.site_layout_settings;
create policy site_layout_settings_service_role_all
  on public.site_layout_settings
  for all to service_role
  using (true)
  with check (true);

insert into public.site_layout_settings (id, settings)
values (
  'global',
  $seed${
    "menu": {
      "sectionOrder": ["home", "tools", "rankings", "games", "brief", "guides", "my-beacon", "about", "admin"],
      "toolOrder": [
        "/tools/league-pulse",
        "/tools/trade-calculator",
        "/tools/who-should-i-start",
        "/tools/faab",
        "/tools/manager-pulse",
        "/tools/on-the-clock"
      ]
    },
    "toolsPage": {
      "toolOrder": [
        "/tools/league-pulse",
        "/tools/trade-calculator",
        "/tools/who-should-i-start",
        "/tools/faab",
        "/tools/manager-pulse",
        "/tools/on-the-clock"
      ]
    },
    "homepage": {
      "cards": [
        { "href": "/tools/league-pulse", "width": 1, "badge": "new-features", "highlight": "green" },
        { "href": "/tools/trade-calculator", "width": 1, "badge": null, "highlight": null },
        { "href": "/tools/who-should-i-start", "width": 1, "badge": "new-features", "highlight": "green" },
        { "href": "/tools/faab", "width": 1, "badge": null, "highlight": null },
        { "href": "/tools/manager-pulse", "width": 1, "badge": "new-tool", "highlight": "cyan" },
        { "href": "/tools/on-the-clock", "width": 1, "badge": null, "highlight": null }
      ]
    }
  }$seed$::jsonb
)
on conflict (id) do nothing;
