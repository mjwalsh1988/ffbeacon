-- Migration 0352: order_customer_identities and search_order_customers
--
-- Access matrix:
--   anon          : EXECUTE refused
--   authenticated : EXECUTE refused
--   service_role  : EXECUTE
--
-- Both exist so the admin order pages never page the whole Auth user list. The
-- caller (lib/commerce/customers.ts) passes the ids on the current page to the
-- first and the typed search to the second. Security definer because auth.users
-- is not readable otherwise, which is exactly why both are revoked from everyone
-- but the service role: exposed, either one is an account enumeration oracle.

create or replace function public.order_customer_identities(p_user_ids uuid[])
returns table (user_id uuid, email text, meta_display_name text, created_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email::text,
         nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', '')), ''),
         u.created_at
  from auth.users u
  where u.id = any(p_user_ids)
$$;

create or replace function public.search_order_customers(p_query text, p_limit integer default 20)
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email::text
  from auth.users u
  where length(p_query) >= 2
    and u.email ilike '%' || replace(replace(p_query, '%', '\%'), '_', '\_') || '%'
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

revoke all on function public.order_customer_identities(uuid[]) from public, anon, authenticated;
grant execute on function public.order_customer_identities(uuid[]) to service_role;

revoke all on function public.search_order_customers(text, integer) from public, anon, authenticated;
grant execute on function public.search_order_customers(text, integer) to service_role;
