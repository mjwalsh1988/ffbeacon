-- 0283_site_layout_settings_revoke_grants
--
-- Supabase grants anon and authenticated every table privilege on a new public
-- table by default. On site_layout_settings RLS already blocked every row
-- operation (0282 has no policy for either role), but TRUNCATE is not subject
-- to RLS, and the access matrix in 0282 says NONE for both roles. This makes
-- the grants say the same thing. Same step, same reason, as
-- 0249_manager_pulse_settings.sql.
--
-- Access matrix (unchanged in effect):
--   site_layout_settings
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL

revoke all on table public.site_layout_settings from anon, authenticated;
