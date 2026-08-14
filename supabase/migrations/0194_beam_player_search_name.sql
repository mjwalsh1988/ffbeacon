-- Migration 0194: players.search_name / players.search_last_name (BEAM resolution)
--
-- Access matrix: unchanged. These are generated columns on public.players, which
-- already carries its own RLS (public SELECT, service_role writes). Adding a
-- column does not change who can read the table.
--
-- WHY
-- BEAM ("Ask BEAM") has to turn free text a person typed into exactly one player
-- id, and be forgiving about how they typed it. Every tier of that resolver needs
-- a normalized name it can compare against:
--
--   "brock purdy"  -> exact match on search_name
--   "purdy"        -> exact match on search_last_name
--   "b purdy"      -> first initial + search_last_name
--   "brock prudy"  -> trigram similarity against search_name
--
-- We already store Sleeper's own normalized name at
-- players.metadata.sleeper.search_full_name, but it is unusable here: it lives
-- inside jsonb (so indexing it means an expression index over a jsonb extraction),
-- it is null on 32 rows, and it is Sleeper's normalization rather than ours. A
-- stored generated column costs nothing to maintain, stays correct automatically
-- when a name is corrected upstream, and can carry a real trigram index.
--
-- NORMALIZATION
--   lower-case, drop every character that is not a letter, digit, or space,
--   collapse runs of whitespace, trim.
-- So "A.J. Brown" -> "aj brown" and "Ja'Marr Chase" -> "jamarr chase", which is
-- exactly what someone types when they do not bother with punctuation.
--
-- search_last_name additionally strips a trailing generational suffix, because
-- Sleeper stores it on last_name ("Bailey II", "Harrison Jr."), and nobody types
-- the suffix when they mean the player.
--
-- There is already an idx_players_full_name_trgm on the raw full_name. It stays:
-- other surfaces (site search, Signal Check, Beacon Breakdown) match on full_name
-- via ilike and would lose their index if it were dropped.
--
-- NOTE: players.full_name is ITSELF a generated column (first_name || ' ' ||
-- last_name), and Postgres forbids one generated column referencing another, so
-- these expressions rebuild from first_name/last_name. Both are NOT NULL, so the
-- result is never null.

alter table public.players
  add column if not exists search_name text
  generated always as (
    btrim(
      regexp_replace(
        lower(
          regexp_replace(
            first_name || ' ' || last_name,
            '[^a-zA-Z0-9 ]',
            '',
            'g'
          )
        ),
        '\s+',
        ' ',
        'g'
      )
    )
  ) stored;

alter table public.players
  add column if not exists search_last_name text
  generated always as (
    btrim(
      regexp_replace(
        btrim(
          regexp_replace(
            lower(regexp_replace(last_name, '[^a-zA-Z0-9 ]', '', 'g')),
            '\s+',
            ' ',
            'g'
          )
        ),
        '\s+(jr|sr|ii|iii|iv|v)$',
        '',
        'g'
      )
    )
  ) stored;

-- Tier 6 of the resolver: similarity(search_name, q). GIN trigram so a fuzzy
-- match is an index scan rather than a sequential pass over 10k rows.
create index if not exists idx_players_search_name_trgm
  on public.players using gin (search_name gin_trgm_ops);

-- Tier 2: exact normalized full name.
create index if not exists idx_players_search_name
  on public.players (search_name);

-- Tiers 4 and 5: exact last name, and last name + first initial.
create index if not exists idx_players_search_last_name
  on public.players (search_last_name);

comment on column public.players.search_name is
  'Normalized full name for BEAM player resolution: lower-cased, punctuation stripped, whitespace collapsed. Generated; never write to it.';
comment on column public.players.search_last_name is
  'Normalized last name with any trailing generational suffix (Jr/Sr/II/III/IV/V) removed, for BEAM last-name matching. Generated; never write to it.';
