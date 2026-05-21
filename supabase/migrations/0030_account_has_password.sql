-- Expose whether the calling user has a password set on their auth.users
-- row. Needed because `supabase.auth.getUser()` does NOT surface
-- `encrypted_password`, and an OAuth-only user who later calls
-- `auth.updateUser({ password })` gets the password stored on the user row
-- WITHOUT a matching `email` identity being created. Counting password as
-- a sign-in method requires this server-side check.
--
-- Access matrix:
--   authenticated  → EXECUTE granted; returns boolean for auth.uid()
--   anon, public   → no access
CREATE OR REPLACE FUNCTION public.account_has_password()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.encrypted_password IS NOT NULL
      AND length(u.encrypted_password) > 0
  );
$$;

REVOKE ALL ON FUNCTION public.account_has_password() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.account_has_password() TO authenticated;

COMMENT ON FUNCTION public.account_has_password() IS
  'Returns true if the calling user has a password set on auth.users. Used by /my-beacon/account to detect OAuth-only accounts that added a password (which does NOT create an email identity row).';
