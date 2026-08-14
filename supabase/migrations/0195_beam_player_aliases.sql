-- Migration 0195: beam_player_aliases
--
-- Access matrix:
--   anon          : SELECT  (the BEAM resolver reads it with the request client,
--                            exactly like it reads public.players)
--   authenticated : SELECT
--   service_role  : ALL     (admin alias editor behind requireAdmin)
--
-- WHY
-- BEAM's player resolver has six tiers. Five of them are algorithmic: exact
-- normalized name, exact last name, last name plus first initial, and trigram
-- similarity. This table is the one tier that is editorial, because no algorithm
-- turns "cmc" into Christian McCaffrey or "hollywood" into Marquise Brown.
--
-- Nicknames are CONTENT, not code. They arrive faster than deploys, they are
-- regional, and the BEAM query log (beam_queries, migration 0196) will name the
-- exact ones we are missing. Putting them in a table with an admin editor means
-- closing that loop is a two-minute job instead of a release.
--
-- WHAT IS DELIBERATELY NOT SEEDED
-- First-initial-plus-last-name ("b purdy", "j allen") is tier 5 of the resolver
-- and is computed, not stored. Seeding thousands of those rows would bloat the
-- table and add nothing: the algorithm already covers every player, including the
-- ones who sign next season.
--
-- COLLISIONS ARE FINE. Two players may legitimately share an alias. The unique
-- constraint is on (alias, player_id), not on alias alone. When an alias resolves
-- to more than one player the resolver's margin rule fails and BEAM asks which
-- one the reader meant, which is the correct outcome.
--
-- citext note: the length CHECK casts to ::text on purpose. A regex or format
-- CHECK applied directly to a citext column matches case-insensitively and would
-- silently accept input the constraint was written to reject.

create table if not exists public.beam_player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  -- citext so "CMC" and "cmc" are the same alias. The resolver normalizes its
  -- input the same way players.search_name is normalized (lower-cased,
  -- punctuation stripped, whitespace collapsed) before it looks here.
  alias citext not null check (char_length(alias::text) between 2 and 60),
  alias_kind text not null default 'nickname'
    check (alias_kind in ('nickname', 'shorthand', 'misspelling', 'initials')),
  is_active boolean not null default true,
  -- Provenance: 'seed' is this migration, 'admin' is hand-added, 'learned' is
  -- reserved for a future promote-from-query-log flow.
  source text not null default 'admin'
    check (source in ('seed', 'admin', 'learned')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (alias, player_id)
);

-- The resolver's only read: active rows for one normalized string.
create index if not exists idx_beam_player_aliases_alias_active
  on public.beam_player_aliases (alias)
  where is_active;

-- The admin editor lists a player's aliases.
create index if not exists idx_beam_player_aliases_player
  on public.beam_player_aliases (player_id);

alter table public.beam_player_aliases enable row level security;

drop policy if exists beam_player_aliases_select_public on public.beam_player_aliases;
create policy beam_player_aliases_select_public
  on public.beam_player_aliases
  for select to anon, authenticated using (true);

drop policy if exists beam_player_aliases_service_role_all on public.beam_player_aliases;
create policy beam_player_aliases_service_role_all
  on public.beam_player_aliases
  for all to service_role using (true) with check (true);

comment on table public.beam_player_aliases is
  'Editorial nickname and shorthand map for BEAM player resolution (tier 3 of the resolver). Public SELECT; writes via the admin editor with the service role. Algorithmic matches (exact name, last name, initials, trigram) are NOT stored here.';

-- Seed. Joined on players.search_name so a name we got wrong inserts nothing
-- rather than attaching a nickname to the wrong person, and restricted to the six
-- fantasy positions so a same-named lineman never picks up a skill player's
-- nickname. This is a starting point, not a complete list; the query log is what
-- fills it out.
insert into public.beam_player_aliases (player_id, alias, alias_kind, source, note)
select p.id, s.alias, s.kind, 'seed', 'Seeded by migration 0195.'
from (values
  ('christian mccaffrey', 'cmc', 'shorthand'),
  ('ceedee lamb', 'ceedee', 'nickname'),
  ('ceedee lamb', 'cd lamb', 'shorthand'),
  ('ceedee lamb', 'cee dee lamb', 'misspelling'),
  ('jamarr chase', 'jamarr', 'nickname'),
  ('jamarr chase', 'ja marr chase', 'misspelling'),
  ('justin jefferson', 'jjettas', 'nickname'),
  ('justin jefferson', 'jettas', 'nickname'),
  ('amonra st brown', 'amon ra', 'nickname'),
  ('amonra st brown', 'amonra', 'nickname'),
  ('amonra st brown', 'st brown', 'shorthand'),
  ('amonra st brown', 'sun god', 'nickname'),
  ('marquise brown', 'hollywood', 'nickname'),
  ('marquise brown', 'hollywood brown', 'nickname'),
  ('deebo samuel', 'deebo', 'nickname'),
  ('bijan robinson', 'bijan', 'nickname'),
  ('saquon barkley', 'saquon', 'nickname'),
  ('jahmyr gibbs', 'jahmyr', 'nickname'),
  ('puka nacua', 'puka', 'nickname'),
  ('travis etienne', 'etn', 'shorthand'),
  ('travis kelce', 'kelce', 'shorthand'),
  ('travis kelce', 'trav kelce', 'shorthand'),
  ('lamar jackson', 'lamar', 'nickname'),
  ('lamar jackson', 'lj8', 'nickname'),
  ('patrick mahomes', 'mahomes', 'shorthand'),
  ('patrick mahomes', 'pat mahomes', 'shorthand'),
  ('josh allen', 'jallen', 'shorthand'),
  ('joe burrow', 'burrow', 'shorthand'),
  ('joe burrow', 'joe brrr', 'nickname'),
  ('jalen hurts', 'hurts', 'shorthand'),
  ('brock purdy', 'purdy', 'shorthand'),
  ('brock purdy', 'mr irrelevant', 'nickname'),
  ('kyren williams', 'kyren', 'nickname'),
  ('breece hall', 'breece', 'nickname'),
  ('deandre hopkins', 'nuk', 'nickname'),
  ('deandre hopkins', 'dhop', 'shorthand'),
  ('davante adams', 'tae', 'nickname'),
  ('davante adams', 'davante', 'nickname'),
  ('stefon diggs', 'diggs', 'shorthand'),
  ('mike evans', 'evans', 'shorthand'),
  ('chris godwin', 'godwin', 'shorthand'),
  ('cooper kupp', 'kupp', 'shorthand'),
  ('tyreek hill', 'cheetah', 'nickname'),
  ('tyreek hill', 'reek', 'nickname'),
  ('nico collins', 'nico', 'nickname'),
  ('garrett wilson', 'gwil', 'shorthand'),
  ('drake london', 'london', 'shorthand'),
  ('malik nabers', 'nabers', 'shorthand'),
  ('marvin harrison', 'mhj', 'shorthand'),
  ('brian thomas', 'btj', 'shorthand'),
  ('rome odunze', 'rome', 'nickname'),
  ('ladd mcconkey', 'ladd', 'nickname'),
  ('jaxon smithnjigba', 'jsn', 'shorthand'),
  ('jaxon smithnjigba', 'smith njigba', 'misspelling'),
  ('jayden daniels', 'jayden', 'nickname'),
  ('caleb williams', 'caleb', 'nickname'),
  ('drake maye', 'maye', 'shorthand'),
  ('bo nix', 'nix', 'shorthand'),
  ('anthony richardson', 'ar15', 'nickname'),
  ('anthony richardson', 'arich', 'shorthand'),
  ('trey mcbride', 'mcbride', 'shorthand'),
  ('brock bowers', 'bowers', 'shorthand'),
  ('sam laporta', 'laporta', 'shorthand'),
  ('mark andrews', 'andrews', 'shorthand'),
  ('george kittle', 'kittle', 'shorthand'),
  ('kyle pitts', 'pitts', 'shorthand'),
  ('de von achane', 'achane', 'shorthand'),
  ('devon achane', 'achane', 'shorthand'),
  ('bucky irving', 'bucky', 'nickname'),
  ('jonathon brooks', 'brooks', 'shorthand'),
  ('james cook', 'cook', 'shorthand'),
  ('isiah pacheco', 'pacheco', 'shorthand'),
  ('rachaad white', 'rachaad', 'nickname'),
  ('najee harris', 'najee', 'nickname'),
  ('derrick henry', 'king henry', 'nickname'),
  ('alvin kamara', 'kamara', 'shorthand'),
  ('aaron jones', 'ajones', 'shorthand'),
  ('josh jacobs', 'jacobs', 'shorthand'),
  ('tj hockenson', 'hock', 'nickname'),
  ('dallas goedert', 'goedert', 'shorthand'),
  ('dk metcalf', 'dk', 'nickname'),
  ('aj brown', 'ajb', 'shorthand'),
  ('terry mclaurin', 'scary terry', 'nickname'),
  ('terry mclaurin', 'terry', 'nickname'),
  ('calvin ridley', 'ridley', 'shorthand'),
  ('zay flowers', 'zay', 'nickname'),
  ('jordan addison', 'addison', 'shorthand'),
  ('tank dell', 'tank', 'nickname'),
  ('christian kirk', 'kirk', 'shorthand'),
  ('courtland sutton', 'sutton', 'shorthand'),
  ('jerry jeudy', 'jeudy', 'shorthand'),
  ('george pickens', 'pickens', 'shorthand'),
  ('keenan allen', 'keenan', 'nickname'),
  ('amari cooper', 'coop', 'nickname'),
  ('kenneth walker', 'kwalk', 'shorthand'),
  ('kenneth walker', 'k9', 'nickname'),
  ('rhamondre stevenson', 'rhamondre', 'nickname'),
  ('tony pollard', 'pollard', 'shorthand'),
  ('joe mixon', 'mixon', 'shorthand'),
  ('david montgomery', 'monty', 'nickname'),
  ('nick chubb', 'chubb', 'shorthand'),
  ('travis hunter', 'hunter', 'shorthand'),
  ('ashton jeanty', 'jeanty', 'shorthand'),
  ('omarion hampton', 'hampton', 'shorthand'),
  ('tetairoa mcmillan', 'tet', 'nickname'),
  ('tetairoa mcmillan', 'mcmillan', 'shorthand'),
  ('cam ward', 'ward', 'shorthand'),
  ('justin herbert', 'herbert', 'shorthand'),
  ('justin herbert', 'herbo', 'nickname'),
  ('dak prescott', 'dak', 'nickname'),
  ('kyler murray', 'kyler', 'nickname'),
  ('trevor lawrence', 'tlaw', 'nickname'),
  ('cj stroud', 'stroud', 'shorthand'),
  ('jared goff', 'goff', 'shorthand'),
  ('baker mayfield', 'baker', 'nickname'),
  ('matthew stafford', 'stafford', 'shorthand'),
  ('aaron rodgers', 'arod', 'nickname'),
  ('aaron rodgers', 'rodgers', 'shorthand'),
  ('brandon aiyuk', 'aiyuk', 'shorthand'),
  ('jaylen waddle', 'waddle', 'shorthand'),
  ('tua tagovailoa', 'tua', 'nickname')
) as s(search_name, alias, kind)
join public.players p
  on p.search_name = s.search_name
 and p.position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
on conflict (alias, player_id) do nothing;
