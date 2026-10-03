/**
 * Game cards for Season Pulse: a finished game, a game still to be played, and
 * the forecast block the second one carries.
 *
 * A RESULT CARD says what happened: the final with both logos, how the line
 * fared, the three best fantasy lines of the game in the reader's scoring and,
 * when the Beacon Brief has published the week, the desk's headline and the
 * opening sentence or two of its recap, with a link to the rest. The full
 * recap stays on the edition.
 *
 * AN UPCOMING CARD says what to expect: kickoff in Eastern time, who is
 * favoured and what each side is expected to score, the forecast and what it
 * means for a lineup, a short written preview, and the players projected to
 * score the most.
 *
 * THE FORECAST IS WORDS FIRST. The band ("Weather downgrade"), the forecast
 * sentence and the advice are text. The icon and the colour repeat the band.
 * A game with no forecast row says "No forecast yet"; it never borrows the
 * calm reading (lib/nfl-weather-impact.ts).
 *
 * Team logos and photos are decorative: the names are always the adjacent
 * text. The team colour strip is decoration. Nothing visible is aria-hidden.
 *
 * Heading levels: each card is an h3 under the panel's h2.
 *
 * Server components.
 */

import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  CloudOff,
  CloudRain,
  Home,
  Snowflake,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { formatEastern, formatEasternKickoff } from "@/lib/datetime";
import { readWeather, windDirectionWord, type WeatherBand, type WeatherRead } from "@/lib/nfl-weather-impact";
import type { GameResult, GameWeather, TeamSide, UpcomingGame } from "@/lib/season-pulse/types";
import { DiffChip, PULSE_LINK, PlayerAvatar, PlayerName, PositionBadge, TeamTag, points } from "./bits";

const HEX = /^#[0-9a-f]{6}$/i;

function strip(away: TeamSide, home: TeamSide): string {
  const a = away.color && HEX.test(away.color) ? away.color : "#A855F7";
  const h = home.color && HEX.test(home.color) ? home.color : "#22D3EE";
  return `linear-gradient(90deg, ${a} 0%, #A855F7 50%, ${h} 100%)`;
}

const CARD_BACKGROUND = "radial-gradient(120% 140% at 0% 0%, #1B1B33 0%, #12121F 45%, #0B0B14 100%)";

function TeamBlock({
  side,
  figure,
  figureLabel,
  strong,
  align,
}: {
  side: TeamSide;
  /** The big number: a score or an expected score. */
  figure: string | null;
  /** Said after the figure for a screen reader, e.g. "expected points". */
  figureLabel: string;
  strong: boolean;
  align: "left" | "right";
}) {
  return (
    <span
      className={`flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 ${
        align === "right" ? "items-end text-right sm:flex-row-reverse" : "items-start"
      }`}
    >
      <NflTeamLogo team={side.code} size={44} className="shrink-0" />
      <span className="min-w-0">
        {/* The nickname on a phone, the full name from sm up. One is displayed, so one is read. */}
        <span className="block break-words text-sm font-semibold text-ink sm:hidden">{side.nickname}</span>
        <span className="hidden break-words text-sm font-semibold text-ink sm:block">{side.name}</span>
        {figure !== null && (
          <span
            className={`block font-mono text-3xl font-bold tabular-nums ${strong ? "text-ink" : "text-ink-subtle"}`}
          >
            {figure}
            <span className="sr-only"> {figureLabel}</span>
          </span>
        )}
      </span>
    </span>
  );
}

/* ---------- Weather ---------- */

const BAND_STYLE: Record<WeatherBand, { icon: LucideIcon; chip: string }> = {
  unknown: { icon: CloudOff, chip: "border-line bg-base/60 text-ink-muted" },
  indoors: { icon: Home, chip: "border-line bg-base/60 text-ink-muted" },
  clear: { icon: Sun, chip: "border-signal-success/40 bg-signal-success/10 text-signal-success" },
  watch: { icon: Wind, chip: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan" },
  downgrade: { icon: Wind, chip: "border-signal-warning/50 bg-signal-warning/10 text-signal-warning" },
  heavy: { icon: Wind, chip: "border-[#F87171]/50 bg-[#F87171]/10 text-[#F87171]" },
};

function bandIcon(read: WeatherRead, weather: GameWeather | null): LucideIcon {
  if (read.band === "unknown" || read.band === "indoors" || read.band === "clear") return BAND_STYLE[read.band].icon;
  if ((weather?.snowIn ?? 0) >= 0.5) return Snowflake;
  const windy = Math.max(weather?.windMph ?? 0, weather?.windMphMax3h ?? 0) >= 10 || (weather?.windGustMph ?? 0) >= 25;
  return windy ? Wind : CloudRain;
}

export function WeatherChip({ weather }: { weather: GameWeather | null }) {
  const read = readWeather(weather);
  const Icon = bandIcon(read, weather);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${BAND_STYLE[read.band].chip}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {read.label}
    </span>
  );
}

function WeatherStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line/80 bg-base/60 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

const PROVIDER_NAME: Record<string, string> = {
  nws: "National Weather Service",
  "met-norway": "MET Norway",
};

/**
 * The forecast for one game. `detail` adds the figure tiles and the source
 * line, for the weather page; a game card shows the band, the sentence and the
 * advice only.
 */
export function WeatherBlock({
  weather,
  venue,
  detail = false,
}: {
  weather: GameWeather | null;
  venue: string | null;
  detail?: boolean;
}) {
  const read = readWeather(weather);
  const where = [venue, weather?.city].filter(Boolean).join(", ");
  const outdoor = weather !== null && !weather.isIndoor;
  const from = windDirectionWord(weather?.windDirDeg ?? null);

  return (
    <div className="rounded-2xl border border-line bg-base/50 p-3 sm:p-4">
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Weather</span>
        <WeatherChip weather={weather} />
        {where && <span className="text-xs text-ink-subtle">{where}</span>}
      </p>
      {read.forecast && <p className="mt-2 text-sm leading-relaxed text-ink">{read.forecast}</p>}
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{read.advice}</p>

      {!detail && outdoor && weather?.provider && PROVIDER_NAME[weather.provider] && (
        <p className="mt-1.5 text-xs text-ink-subtle">Forecast from {PROVIDER_NAME[weather.provider]}.</p>
      )}

      {detail && outdoor && weather && (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <WeatherStat label="Temperature" value={weather.tempF === null ? "n/a" : `${Math.round(weather.tempF)} F`} />
            <WeatherStat
              label="Feels like"
              value={weather.feelsLikeF === null ? "n/a" : `${Math.round(weather.feelsLikeF)} F`}
            />
            <WeatherStat
              label={from ? `Wind, from the ${from}` : "Wind"}
              value={weather.windMph === null ? "n/a" : `${Math.round(weather.windMph)} mph`}
            />
            <WeatherStat
              label="Gusts"
              value={weather.windGustMph === null ? "Not published" : `${Math.round(weather.windGustMph)} mph`}
            />
            <WeatherStat
              label="Chance of rain or snow"
              value={weather.precipProbPct === null ? "Not published" : `${Math.round(weather.precipProbPct)}%`}
            />
            <WeatherStat
              label="Expected, kickoff plus 3 hours"
              value={
                weather.snowIn !== null && weather.snowIn >= 0.1
                  ? `${weather.snowIn.toFixed(1)} in snow`
                  : weather.precipIn === null
                    ? "n/a"
                    : `${weather.precipIn.toFixed(2)} in rain`
              }
            />
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
            {weather.provider && PROVIDER_NAME[weather.provider]
              ? `Forecast from ${PROVIDER_NAME[weather.provider]}`
              : "Forecast"}
            {weather.fetchedAt ? `, read ${formatEastern(weather.fetchedAt)}` : ""}.
            {weather.provider === "met-norway"
              ? " MET Norway publishes no gusts and no rain probability for this location."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}

/* ---------- A finished game ---------- */

export function ResultCard({ game, scoringLabel }: { game: GameResult; scoringLabel: string }) {
  const headingId = `result-${game.gameKey.toLowerCase()}`;
  const awayScore = game.away.score === null ? "n/a" : String(game.away.score);
  const homeScore = game.home.score === null ? "n/a" : String(game.home.score);
  const combined =
    game.away.score !== null && game.home.score !== null ? game.away.score + game.home.score : null;
  // "Bills covered -7" is read as words; "BUF covered -7" letter by letter.
  const named = (text: string | null) =>
    text === null
      ? null
      : text.replace(/\b[A-Z]{2,4}\b/g, (code) =>
          code === game.away.code ? game.away.nickname : code === game.home.code ? game.home.nickname : code,
        );
  const totalText =
    game.total === null || combined === null || game.totalResult === null
      ? null
      : `${game.totalResult === "over" ? "Over" : game.totalResult === "under" ? "Under" : "Push on"} ${game.total}, ${combined} scored`;

  return (
    <article
      id={headingId}
      aria-labelledby={`${headingId}-h`}
      className="scroll-mt-32 rounded-3xl p-px xl:scroll-mt-28"
      style={{ backgroundImage: strip(game.away, game.home) }}
    >
      <div className="flex h-full flex-col rounded-[calc(1.5rem-1px)] p-4 sm:p-5" style={{ background: CARD_BACKGROUND }}>
        <h3 id={`${headingId}-h`} className="text-base font-bold leading-snug tracking-tight text-ink sm:text-lg">
          {game.recapHeadline ? (
            <>
              <span className="sr-only">{`${game.away.name} at ${game.home.name}: `}</span>
              {game.recapHeadline}
            </>
          ) : (
            `${game.away.name} at ${game.home.name}`
          )}
        </h3>
        {game.kickoffAt && <p className="mt-1 text-xs text-ink-subtle">{formatEasternKickoff(game.kickoffAt)}</p>}

        <p className="mt-3 flex items-center gap-3">
          <span className="sr-only">Final: </span>
          <TeamBlock
            side={game.away}
            figure={awayScore}
            figureLabel="points"
            strong={game.winner === game.away.code}
            align="left"
          />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">at</span>
          <TeamBlock
            side={game.home}
            figure={homeScore}
            figureLabel="points"
            strong={game.winner === game.home.code}
            align="right"
          />
        </p>

        {(game.coverText || totalText) && (
          <ul role="list" className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {game.spreadText && (
              <li className="rounded-full border border-line bg-base/60 px-2.5 py-1 text-ink-muted">
                Closed {named(game.spreadText)}
              </li>
            )}
            {game.coverText && (
              <li className="rounded-full border border-line bg-base/60 px-2.5 py-1 text-ink-muted">
                {named(game.coverText)}
              </li>
            )}
            {totalText && (
              <li className="rounded-full border border-line bg-base/60 px-2.5 py-1 text-ink-muted">{totalText}</li>
            )}
          </ul>
        )}

        {game.topLines.length > 0 && (
          <div className="mt-4">
            <p
              id={`${headingId}-lines`}
              className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
            >
              Top fantasy lines<span className="sr-only">{`, ${game.away.name} at ${game.home.name}`}</span>
            </p>
            <ol role="list" aria-labelledby={`${headingId}-lines`} className="mt-1 divide-y divide-line/60">
              {game.topLines.map((p) => (
                <li key={p.id} className="flex items-start gap-2.5 py-2">
                  <span className="mt-1.5">
                    <PlayerAvatar position={p.position} sleeperId={p.sleeperId} team={p.gameTeam} size={32} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <PlayerName slug={p.slug} name={p.name} />
                      <PositionBadge position={p.position} rank={p.weekRank} size="sm" when="that week" />
                    </span>
                    <span className="-mt-1.5 block text-xs leading-snug text-ink-muted">{p.line}.</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-base font-bold tabular-nums text-ink">
                      {points(p.points)}
                      <span className="sr-only"> {scoringLabel} points</span>
                    </span>
                    {p.diff !== null && <DiffChip value={p.diff} />}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {game.recapTeaser && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{game.recapTeaser}</p>}

        {game.recapHref && (
          <p className="mt-auto pt-3">
            <Link
              href={game.recapHref as Route}
              className={`inline-flex min-h-11 items-center gap-1.5 text-sm ${PULSE_LINK}`}
            >
              Read the recap in the Beacon Brief
              <span className="sr-only">{`, ${game.away.name} at ${game.home.name}`}</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </p>
        )}
      </div>
    </article>
  );
}

/* ---------- A game still to be played ---------- */

function spreadWords(game: UpcomingGame): string | null {
  if (game.homeSpread === null) return null;
  if (game.homeSpread === 0) return "Rated even";
  return game.homeSpread < 0
    ? `${game.home.nickname} favoured by ${Math.abs(game.homeSpread)}`
    : `${game.away.nickname} favoured by ${game.homeSpread}`;
}

export function UpcomingCard({
  game,
  now,
  detail = false,
}: {
  game: UpcomingGame;
  /** Request time, so "kicked off" is decided once for the whole page. */
  now: number;
  /** The weather page shows the forecast figures; a hub card does not. */
  detail?: boolean;
}) {
  const headingId = `game-${game.gameKey.toLowerCase()}`;
  const kickedOff = game.kickoffAt !== null && Date.parse(game.kickoffAt) <= now;
  const favourite = spreadWords(game);

  return (
    <article
      id={headingId}
      aria-labelledby={`${headingId}-h`}
      className="scroll-mt-32 rounded-3xl p-px xl:scroll-mt-28"
      style={{ backgroundImage: strip(game.away, game.home) }}
    >
      <div className="flex h-full flex-col rounded-[calc(1.5rem-1px)] p-4 sm:p-5" style={{ background: CARD_BACKGROUND }}>
        <h3 id={`${headingId}-h`} className="text-base font-bold leading-snug tracking-tight text-ink sm:text-lg">
          {game.away.name} at {game.home.name}
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          {game.kickoffAt ? formatEasternKickoff(game.kickoffAt) : "Kickoff time not set"}
          {kickedOff ? ". Kicked off; the final is not in yet." : ""}
        </p>

        <p className="mt-3 flex items-center gap-3">
          <span className="sr-only">Expected score: </span>
          <TeamBlock
            side={game.away}
            figure={game.away.implied === null ? null : String(game.away.implied)}
            figureLabel="expected points"
            strong={(game.away.implied ?? 0) >= (game.home.implied ?? 0)}
            align="left"
          />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">at</span>
          <TeamBlock
            side={game.home}
            figure={game.home.implied === null ? null : String(game.home.implied)}
            figureLabel="expected points"
            strong={(game.home.implied ?? 0) >= (game.away.implied ?? 0)}
            align="right"
          />
        </p>

        <ul role="list" className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <li className="rounded-full border border-line bg-base/60 px-2.5 py-1 text-ink-muted">
            {favourite ?? "No line published yet"}
          </li>
          {game.total !== null && (
            <li className="rounded-full border border-line bg-base/60 px-2.5 py-1 text-ink-muted">
              Combined {game.total} expected
            </li>
          )}
        </ul>

        <div className="mt-4">
          <WeatherBlock weather={game.weather} venue={game.venue} detail={detail} />
        </div>

        {game.preview.length > 0 && (
          <div className="mt-4 space-y-2">
            {game.preview.map((sentence) => (
              <p key={sentence} className="text-sm leading-relaxed text-ink-muted">
                {sentence}
              </p>
            ))}
          </div>
        )}

        {game.toWatch.length > 0 && (
          <div className="mt-4">
            <p id={`${headingId}-watch`} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Projected to score the most
              <span className="sr-only">{`, ${game.away.name} at ${game.home.name}, ${game.projectedBy} projections with our adjustments`}</span>
            </p>
            <ul role="list" aria-labelledby={`${headingId}-watch`} className="mt-1 grid gap-x-4 sm:grid-cols-2">
              {game.toWatch.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 border-b border-line/60 py-1.5">
                  <PlayerAvatar position={p.position} sleeperId={p.sleeperId} team={p.gameTeam} size={28} />
                  <span className="min-w-0 flex-1">
                    <PlayerName slug={p.slug} name={p.name} />
                    <span className="-mt-2 block text-xs">
                      <TeamTag team={p.gameTeam} size={12} />
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-ink">
                    {points(p.projected)}
                    <span className="sr-only"> projected points</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}
