-- Migration 0035: best-ball dimension + new FF Beacon default preset formats
--
-- Access matrix (format_configs) unchanged from 0001:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Modeling decision: best ball is ORTHOGONAL to the redraft/dynasty horizon,
-- not a third value of league_type. "Best Ball Dynasty Superflex" is a
-- dynasty-horizon best-ball format; collapsing best ball into league_type would
-- make it unrepresentable as dynasty and would break the counterpart-baseline
-- lookup (a best-ball format finds its baseline by matching league_type +
-- scoring_type + is_superflex with is_bestball = false). So we add an
-- is_bestball boolean and leave league_type as the horizon.
--
-- Four new preset rows complete FF Beacon's 9-format default set:
--   dynasty-ppr-tep             (1QB dynasty TE-premium; the missing non-sflex TEP)
--   bestball-ppr-std            (redraft-horizon best ball, 1QB)
--   bestball-ppr-sflex          (redraft-horizon best ball, superflex)
--   bestball-dynasty-ppr-sflex  (dynasty-horizon best ball, superflex)

alter table public.format_configs
  add column if not exists is_bestball boolean not null default false;

comment on column public.format_configs.is_bestball is
  'Best-ball lineup style, orthogonal to league_type (redraft/dynasty horizon). '
  'A best-ball format baselines off the counterpart row matching league_type + '
  'scoring_type + is_superflex with is_bestball = false.';

insert into public.format_configs
  (slug, display_name, league_type, scoring_type, te_premium_bonus, is_superflex, is_bestball, is_default, display_order)
values
  ('dynasty-ppr-tep',            'Dynasty PPR TEP',                 'dynasty', 'ppr', 0.5, false, false, false, 9),
  ('bestball-ppr-std',           'Best Ball PPR',                   'redraft', 'ppr', 0,   false, true,  false, 10),
  ('bestball-ppr-sflex',         'Best Ball PPR Superflex',         'redraft', 'ppr', 0,   true,  true,  false, 11),
  ('bestball-dynasty-ppr-sflex', 'Best Ball Dynasty PPR Superflex', 'dynasty', 'ppr', 0,   true,  true,  false, 12)
on conflict (slug) do nothing;
