-- Expose the calling user's own rows from auth.sessions through a
-- SECURITY DEFINER function so the JS client can read them. PostgREST
-- only exposes the `public` schema, so direct .schema('auth').from('sessions')
-- calls fail silently with an empty result. This function is the
-- supported bridge.
--
-- Access matrix:
--   authenticated  → EXECUTE granted, returns only rows where user_id = auth.uid()
--   anon, public   → no access (REVOKED below)
--
-- Filters out expired rows (not_after <= now()) since they're tombstones.
CREATE OR REPLACE FUNCTION public.get_my_active_sessions()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  refreshed_at timestamp,
  not_after timestamptz,
  user_agent text,
  ip inet
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.created_at, s.updated_at, s.refreshed_at, s.not_after, s.user_agent, s.ip
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
    AND (s.not_after IS NULL OR s.not_after > now())
  ORDER BY s.refreshed_at DESC NULLS LAST, s.created_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_sessions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_sessions() TO authenticated;

COMMENT ON FUNCTION public.get_my_active_sessions() IS
  'Returns the calling user''s own auth.sessions rows (non-expired, limit 20). Used by /my-beacon/account.';
