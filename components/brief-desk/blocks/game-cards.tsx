/**
 * game_cards: every game of the week as a card (plan section 23.2).
 *
 * A jump menu first, one link per game with both logos and the final, then one
 * <article> per game:
 *   the final, with both logos and the winner's score in full ink
 *   the line it was played under: the closing spread (and where it opened),
 *     who covered, the total and whether it went over, both moneylines, and
 *     the score the line implied against the score that happened
 *   the desk's headline and recap (draft.games), and its fun stat with the
 *     named player's real line under it
 *   the top fantasy lines on both sides, scored against the projection
 *   the value risers and fallers among that game's players
 *
 * EVERY NUMBER IS A DATASET CELL. The recap is the desk's words; nothing on
 * the card is computed from them. A game with no recap still renders its
 * figures, and a recap whose game is not in the dataset renders nowhere.
 *
 * Heading levels: the block caption is the h3 (BlockShell), each game is an
 * h4, and every sub-part is named by a table caption or a list label rather
 * than a fifth heading level.
 *
 * Nothing visible is aria-hidden. Logos and photos are decorative (alt="")
 * because the team and player names are always the adjacent text. The team
 * colour strip is decoration.
 *
 * Every piece of data shows at every breakpoint: the tables scroll sideways
 * inside a focusable region on a phone rather than dropping a column.
 *
 * Server component.
 */

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";
import { ArticleMarkdown } from "@/components/beacon-brief/article-markdown";
import { formatEastern } from "@/lib/datetime";
import type { BundleDataset, Draft } from "@/lib/brief-desk/types";
import { BLOCK_LINK_CLASS, BlockShell } from "./block-shell";
import { PlayerLineRow } from "./player-line-row";
import { grouped } from "@/lib/brief-desk/games";

type Row = BundleDataset["rows"][number];
type GameRecap = Draft["games"][number];

const HEX = /^#[0-9a-f]{6}$/i;

function text(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function signedText(n: number | null, digits = 1): string {
  if (n === null) return "n/a";
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  // Fixed decimals when there are any, so "+7.0" lines up under "+15.2".
  const body = digits > 0 ? Math.abs(r).toFixed(digits) : grouped(Math.abs(r));
  return r > 0 ? `+${body}` : r < 0 ? `-${body}` : body;
}

/** The anchor a jump link and an award tile point at. */
export function gameAnchor(key: string): string {
  return `game-${key.toLowerCase()}`;
}

function color(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v) ? v : fallback;
}

/**
 * A label and a figure in the line strip. A two-team figure is given as two
 * parts, one per line, so a narrow tile never parts a team from its number
 * ("Lions +200," on one line and "Bills -245" on the next). The comma stays in
 * the text so the pair still reads as one figure.
 */
function LineStat({ label, value, detail }: { label: string; value: string | [string, string]; detail?: string | null }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line/80 bg-base/60 px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{label}</dt>
      <dd className="mt-1 font-mono text-base font-bold tabular-nums text-ink sm:text-lg">
        {Array.isArray(value) ? (
          <>
            <span className="block">{`${value[0]},`}</span>
            <span className="block">{value[1]}</span>
          </>
        ) : (
          value
        )}
        {detail && <span className="mt-0.5 block font-sans text-[11px] font-normal leading-tight text-ink-muted">{detail}</span>}
      </dd>
    </div>
  );
}

function TeamScore({
  code,
  name,
  nickname,
  score,
  won,
  align,
}: {
  code: string;
  name: string;
  nickname: string;
  score: string;
  won: boolean;
  align: "left" | "right";
}) {
  return (
    // Stacked below sm: beside a 48px logo the name column is too narrow for
    // "Cleveland", and break-words then splits the word itself.
    <span
      className={`flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 ${
        align === "right" ? "items-end text-right sm:flex-row-reverse" : "items-start"
      }`}
    >
      <NflTeamLogo team={code} size={48} className="shrink-0" />
      <span className="min-w-0">
        {/* The nickname on a phone, so both names take one line and the two
            scores sit level; the full name from sm up. Only one is displayed,
            so a screen reader hears one. */}
        <span className="block break-words text-sm font-semibold text-ink sm:hidden">{nickname}</span>
        <span className="hidden break-words text-base font-semibold text-ink sm:block">{name}</span>
        <span className={`block font-mono text-3xl font-bold tabular-nums sm:text-4xl ${won ? "text-ink" : "text-ink-subtle"}`}>{score}</span>
      </span>
    </span>
  );
}

/** A player link on its own line in a list: the house 44px tap target. */
function ListPlayerName({ row }: { row: Row }) {
  const name = text(row.name) ?? "Unknown player";
  const slug = text(row.slug);
  return slug ? (
    <Link href={`/players/${slug}`} className={`inline-flex min-h-11 items-center ${BLOCK_LINK_CLASS}`}>
      {name}
    </Link>
  ) : (
    <span className="font-medium text-ink">{name}</span>
  );
}

/** "Falcons" from "Atlanta Falcons": the word a listener hears as the team. */
export function teamNickname(name: string): string {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1] || name;
}

/** Text for figures that fall below zero on the dark card: brighter than signal-danger, about 6:1. */
const NEGATIVE_TEXT = "text-[#F87171]";

/** Each format's move, leaving out a format with no value for the player rather than printing "n/a". */
function valueLine(row: Row, formats: Array<{ slug: string; display: string }>): string {
  return formats
    .flatMap((f) => {
      const change = numberOrNull(row[`${f.slug}.change`]);
      return change === null ? [] : [`${f.display} ${signedText(change, 0)}`];
    })
    .join(", ");
}

/** Points and projections to one decimal everywhere on the card, so "26.0" lines up under "31.3". */
function points(v: unknown): string | null {
  const n = numberOrNull(typeof v === "string" ? Number(v) : v);
  return n === null ? null : n.toFixed(1);
}

function GameCard({
  game,
  recap,
  players,
  formats,
}: {
  game: Row;
  recap: GameRecap | null;
  players: Row[];
  formats: Array<{ slug: string; display: string }>;
}) {
  const key = String(game.game_key);
  const anchor = gameAnchor(key);
  const away = String(game.away);
  const home = String(game.home);
  const awayName = text(game.away_name) ?? away;
  const homeName = text(game.home_name) ?? home;
  const awayScore = text(game.away_score) ?? "n/a";
  const homeScore = text(game.home_score) ?? "n/a";
  const winner = text(game.winner);
  const kickoff = text(game.kickoff_at);
  const headingId = `${anchor}-h`;
  const strip = `linear-gradient(90deg, ${color(game.away_color, "#A855F7")} 0%, #A855F7 50%, ${color(game.home_color, "#22D3EE")} 100%)`;

  const spread = text(game.spread_text);
  const openSpread = text(game.open_spread_text);
  const total = numberOrNull(game.close_total);
  const openTotal = numberOrNull(game.open_total);
  const combined = numberOrNull(game.combined_points);
  const ou = text(game.total_result);
  const awayMl = text(game.away_moneyline_text);
  const homeMl = text(game.home_moneyline_text);
  const homeImplied = numberOrNull(game.home_implied);
  const awayImplied = numberOrNull(game.away_implied);
  // The line strip names teams by nickname: "Bills covered -7" is read as
  // words, "BUF covered -7" letter by letter. The dataset's own strings carry
  // the codes, so they are swapped here, whole words only.
  const awayNick = teamNickname(awayName);
  const homeNick = teamNickname(homeName);
  const named = (s: string | null) =>
    s === null ? null : s.replace(/\b[A-Z]{2,4}\b/g, (code) => (code === away ? awayNick : code === home ? homeNick : code));

  // The top three on each side by PPR points, then the rest of the card's
  // figures read from the same rows.
  const side = (team: string) => players.filter((p) => p.team === team).slice(0, 3);
  const top = [...side(away), ...side(home)].sort((a, b) => Number(b.pts_ppr ?? 0) - Number(a.pts_ppr ?? 0));
  const funPlayer = recap?.fun_stat ? (players.find((p) => p.player_id === recap.fun_stat!.player_id) ?? null) : null;

  const lead = formats[0];
  const changeOf = (r: Row) => numberOrNull(r[`${lead?.slug}.change`]);
  const moved = lead ? players.filter((r) => (changeOf(r) ?? 0) !== 0) : [];
  const risers = [...moved].filter((r) => (changeOf(r) ?? 0) > 0).sort((a, b) => (changeOf(b) ?? 0) - (changeOf(a) ?? 0)).slice(0, 2);
  const fallers = [...moved].filter((r) => (changeOf(r) ?? 0) < 0).sort((a, b) => (changeOf(a) ?? 0) - (changeOf(b) ?? 0)).slice(0, 2);

  return (
    <li>
      <article id={anchor} aria-labelledby={headingId} className="scroll-mt-24 rounded-3xl p-px" style={{ backgroundImage: strip }}>
        <div
          className="rounded-[calc(1.5rem-1px)] p-4 sm:p-6"
          style={{ background: "radial-gradient(120% 140% at 0% 0%, #1B1B33 0%, #12121F 45%, #0B0B14 100%)" }}
        >
          <h4 id={headingId} className="text-lg font-bold tracking-tight text-ink sm:text-xl">
            {recap?.headline ? (
              <>
                <span className="sr-only">{`${awayName} at ${homeName}: `}</span>
                {recap.headline}
              </>
            ) : (
              `${awayName} at ${homeName}`
            )}
          </h4>
          {kickoff && <p className="mt-1 text-xs text-ink-subtle">Kickoff {formatEastern(kickoff)}</p>}

          <p className="mt-4 flex items-center gap-3">
            <span className="sr-only">Final: </span>
            <TeamScore code={away} name={awayName} nickname={awayNick} score={awayScore} won={winner === away} align="left" />
            <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">at</span>
            <TeamScore code={home} name={homeName} nickname={homeNick} score={homeScore} won={winner === home} align="right" />
          </p>

          {/* Two columns until lg: three columns of mono figures in a 768px
              card split a pair across lines. */}
          <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-3">
            <LineStat label="Closing spread" value={named(spread) ?? "No line"} detail={openSpread && openSpread !== spread ? `Opened ${named(openSpread)}` : null} />
            {/* The label already says "against the spread", so a push is one word. */}
            <LineStat label="Against the spread" value={String(game.cover_text ?? "").startsWith("Push") ? "Push" : (named(text(game.cover_text)) ?? "No line")} />
            <LineStat
              label="Total"
              value={total === null ? "No line" : String(total)}
              detail={
                total === null || combined === null
                  ? null
                  : `${ou === "over" ? "Over" : ou === "under" ? "Under" : "Push"}, ${combined} scored${openTotal !== null && openTotal !== total ? `; opened ${openTotal}` : ""}`
              }
            />
            <LineStat label="Moneyline" value={awayMl && homeMl ? [`${awayNick} ${awayMl}`, `${homeNick} ${homeMl}`] : "No line"} />
            <LineStat
              label="Expected score"
              value={awayImplied !== null && homeImplied !== null ? [`${awayNick} ${awayImplied}`, `${homeNick} ${homeImplied}`] : "No line"}
              detail={awayImplied !== null ? "Implied by the closing line" : null}
            />
            <LineStat label="Actual score" value={[`${awayNick} ${awayScore}`, `${homeNick} ${homeScore}`]} detail={game.upset === "yes" ? "The underdog won outright" : null} />
          </dl>

          {recap && (
            <div className="mt-5 text-ink">
              <ArticleMarkdown content={recap.recap_md} />
            </div>
          )}

          {recap?.fun_stat && (
            // A note, not an aside: sixteen named complementary landmarks
            // crowded a screen reader's landmark list for no gain.
            <div role="note" aria-labelledby={`${anchor}-fun`} className="mt-4 flex items-start gap-3 rounded-2xl border border-brand-purple/50 bg-brand-purple/10 p-3 sm:p-4">
              {funPlayer ? <PlayerHeadshot sleeperId={text(funPlayer.sleeper_id)} name="" size={48} className="shrink-0" /> : <Sparkles aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-purple" />}
              <div className="min-w-0">
                <p id={`${anchor}-fun`} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-purple-light">
                  Fun stat<span className="sr-only">{`, ${awayName} at ${homeName}`}</span>
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{recap.fun_stat.text}</p>
                {funPlayer && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {/* Inside a sentence, so it keeps the prose-link underline (WCAG 1.4.1). */}
                    {text(funPlayer.slug) ? (
                      <Link
                        href={`/players/${text(funPlayer.slug)}`}
                        className="text-ink underline decoration-brand-cyan/70 underline-offset-[3px] hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                      >
                        {text(funPlayer.name)}
                      </Link>
                    ) : (
                      text(funPlayer.name)
                    )}
                    {`: ${[text(funPlayer.stat_line), `${points(funPlayer.pts_ppr) ?? "n/a"} PPR points`].filter(Boolean).join(", ")}.`}
                  </p>
                )}
              </div>
            </div>
          )}

          {top.length > 0 && (
            <div className="mt-5">
              <p id={`${anchor}-lines`} className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                Top fantasy lines<span className="sr-only">{`, ${awayName} at ${homeName}, against the projection`}</span>
              </p>
              <ol role="list" aria-labelledby={`${anchor}-lines`} className="mt-1 divide-y divide-line/60">
                {top.map((r) => {
                  const vs = numberOrNull(r.vs_projection);
                  const projected = points(r.projected);
                  return (
                    <PlayerLineRow
                      key={String(r.player_id)}
                      name={text(r.name) ?? "Unknown player"}
                      slug={text(r.slug)}
                      sleeperId={text(r.sleeper_id)}
                      meta={[text(r.position), text(r.team)].filter(Boolean).join(", ") || null}
                      line={text(r.stat_line)}
                      figure={points(r.pts_ppr) ?? "n/a"}
                      figureLabel="PPR"
                      sub={projected ? `Projected ${projected}` : "No projection"}
                      aside={
                        vs === null ? null : (
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${vs >= 0 ? "bg-signal-success/15 text-signal-success" : `bg-[#F87171]/15 ${NEGATIVE_TEXT}`}`}
                          >
                            {signedText(vs)}
                            <span className="sr-only"> against the projection</span>
                          </span>
                        )
                      }
                    />
                  );
                })}
              </ol>
            </div>
          )}

          {lead && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div>
                <p id={`${anchor}-up`} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-signal-success">
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                  Value risers
                </p>
                {risers.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">Nobody in this game gained value over the week.</p>
                ) : (
                  <ul aria-labelledby={`${anchor}-up`} role="list" className="mt-2 space-y-2">
                    {risers.map((r) => (
                      <li key={String(r.player_id)} className="flex items-start gap-2 text-sm">
                        <PlayerHeadshot sleeperId={text(r.sleeper_id)} name="" size={28} className="mt-2 shrink-0" />
                        <span className="min-w-0">
                          <ListPlayerName row={r} />
                          {/* Pulled up under the name: the name keeps its 44px tap target, and the line sits in the target's empty lower half. */}
                          <span className="-mt-2 block text-xs text-ink-muted">{valueLine(r, formats)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p id={`${anchor}-down`} className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${NEGATIVE_TEXT}`}>
                  <ArrowDownRight aria-hidden="true" className="h-4 w-4" />
                  Value fallers
                </p>
                {fallers.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">Nobody in this game lost value over the week.</p>
                ) : (
                  <ul aria-labelledby={`${anchor}-down`} role="list" className="mt-2 space-y-2">
                    {fallers.map((r) => (
                      <li key={String(r.player_id)} className="flex items-start gap-2 text-sm">
                        <PlayerHeadshot sleeperId={text(r.sleeper_id)} name="" size={28} className="mt-2 shrink-0" />
                        <span className="min-w-0">
                          <ListPlayerName row={r} />
                          {/* Pulled up under the name: the name keeps its 44px tap target, and the line sits in the target's empty lower half. */}
                          <span className="-mt-2 block text-xs text-ink-muted">{valueLine(r, formats)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-ink-subtle">
            <a href="#game-jump" className={`inline-flex min-h-11 items-center ${BLOCK_LINK_CLASS}`}>
              Back to every game
            </a>
          </p>
        </div>
      </article>
    </li>
  );
}

export function GameCardsBlock({
  id,
  caption,
  conclusion,
  games,
  playerLines,
  recaps,
  formats,
}: {
  id: string;
  caption: string;
  conclusion: string;
  games: BundleDataset;
  playerLines: BundleDataset | null;
  recaps: GameRecap[];
  formats: Array<{ slug: string; display: string }>;
}) {
  const recapByKey = new Map(recaps.map((r) => [r.game_key, r]));
  const playersByGame = new Map<string, Row[]>();
  for (const r of playerLines?.rows ?? []) {
    const key = String(r.game_key);
    playersByGame.set(key, [...(playersByGame.get(key) ?? []), r]);
  }
  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={games}>
      {/* tabIndex -1 so "Back to every game" moves focus here, not only the scroll. */}
      <nav id="game-jump" aria-label="Jump to a game" tabIndex={-1} className="scroll-mt-24 rounded-card focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan/50">
        <ul role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {games.rows.map((g) => {
            const key = String(g.game_key);
            // Nicknames rather than codes: "Falcons 35 at Packers 14" is read
            // as words, where "ATL 35 at GB 14" is spelled letter by letter.
            const awayNick = teamNickname(text(g.away_name) ?? String(g.away));
            const homeNick = teamNickname(text(g.home_name) ?? String(g.home));
            return (
              <li key={key}>
                <a
                  href={`#${gameAnchor(key)}`}
                  className="flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface/60 px-3 py-2 text-sm text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <NflTeamLogo team={String(g.away)} size={22} />
                  <span className={`tabular-nums ${g.winner === g.away ? "font-semibold text-ink" : "text-ink-muted"}`}>{`${awayNick} ${g.away_score}`}</span>{" "}
                  <span className="text-ink-subtle">at</span>{" "}
                  <NflTeamLogo team={String(g.home)} size={22} />
                  <span className={`tabular-nums ${g.winner === g.home ? "font-semibold text-ink" : "text-ink-muted"}`}>{`${homeNick} ${g.home_score}`}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <ol role="list" className="mt-6 space-y-6">
        {games.rows.map((g) => {
          const key = String(g.game_key);
          return (
            <GameCard key={key} game={g} recap={recapByKey.get(key) ?? null} players={playersByGame.get(key) ?? []} formats={formats} />
          );
        })}
      </ol>
      {playerLines && <p className="mt-4 text-xs leading-relaxed text-ink-subtle">{playerLines.source_note}</p>}
    </BlockShell>
  );
}
