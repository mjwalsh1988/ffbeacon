-- Migration 0014: rename remaining legacy "trade_values" constraints
--
-- Migration 0012 renamed the table and its policies/indexes, but Postgres
-- did NOT auto-rename the implicit PK/FK constraint names. As a result
-- pg_constraint still shows trade_values_pkey, trade_values_player_id_fkey,
-- trade_values_format_config_id_fkey on the renamed player_value_history
-- table. These names leak through generated TypeScript types and contradict
-- the FF Beacon-native naming rule.
--
-- This migration is read-only on data — it only renames constraints.

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.player_value_history'::regclass
      and conname like 'trade_values_%'
  loop
    execute format(
      'alter table public.player_value_history rename constraint %I to %I',
      rec.conname,
      replace(rec.conname, 'trade_values', 'player_value_history')
    );
  end loop;
end$$;
