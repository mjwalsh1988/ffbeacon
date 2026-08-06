-- Migration 0176: manual pick signals cover a season + round across every slot
--
-- Access matrix (unchanged from 0040):
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; the value engine reads)
--   client writes : BLOCKED
--
-- Before: a target='pick' signal had to name one slot (early | mid | late), so
-- adjusting a whole round meant creating three rows and deactivating three rows.
-- After: pick_position may be NULL, meaning "every slot in this season+round".
-- A season is now required on a pick signal, because a modifier that spans every
-- future draft year is not a thing the owner ever wants to say by accident.
--
-- Slot semantics on a pick signal:
--   pick_position = 'early' | 'mid' | 'late'  -> that one slot
--   pick_position = NULL                      -> all three slots
-- Format scope keeps the same shape it has for player signals:
--   format_config_id = NULL -> every format the engine writes picks for
--
-- Player signals are also tightened here: they may not carry stray pick
-- coordinates, and pick signals may not carry a player_id. Both were possible
-- before and neither is meaningful.

alter table public.beacon_manual_signals
  drop constraint if exists beacon_manual_signals_check;

alter table public.beacon_manual_signals
  drop constraint if exists beacon_manual_signals_target_fields_check;

alter table public.beacon_manual_signals
  add constraint beacon_manual_signals_target_fields_check check (
    (
      target = 'player'
      and player_id is not null
      and pick_season is null
      and pick_round is null
      and pick_position is null
    )
    or
    (
      target = 'pick'
      and player_id is null
      and pick_season is not null
      and pick_round is not null
      and pick_round > 0
    )
  );

alter table public.beacon_manual_signals
  drop constraint if exists beacon_manual_signals_pick_position_check;

alter table public.beacon_manual_signals
  add constraint beacon_manual_signals_pick_position_check check (
    pick_position is null or pick_position in ('early', 'mid', 'late')
  );

create index if not exists idx_beacon_manual_signals_pick
  on public.beacon_manual_signals (pick_season, pick_round)
  where target = 'pick';

comment on column public.beacon_manual_signals.pick_position is
  'Draft slot the signal applies to: early, mid, or late. NULL means all three slots in this season and round.';

comment on table public.beacon_manual_signals is
  'Owner one-time nudges read ONLY by the FF Beacon engine. Player signals: silent=true changes value but is hidden from trends via formula_offset. Pick signals: season + round, with pick_position NULL covering every slot; they stack on top of the global pick_value_multiplier setting. Admin-managed.';
