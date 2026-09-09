import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/server";
import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";
import {
  loadMatchupDetail,
  resolveScheduleWeek,
} from "@/lib/league-schedule/data";
import {
  buildShareCard,
  type ShareCard,
  type ShareCardCell,
  type ShareCardRow,
  type ShareCardSide,
} from "@/lib/league-schedule/share-card";
import type { SlotGroup } from "@/lib/league-schedule/types";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar-url";
import {
  loadRemoteImage,
  loadRemoteImages,
  sleeperPlayerImageUrl,
  OG_FONTS,
  OG_FONT_FAMILY,
  OG_LOGO_DATA_URI,
  OG_WORDMARK,
} from "@/lib/og/assets";

export const runtime = "nodejs";

/**
 * GET /api/og/matchup/[league_id]/[week]/[roster_id]/share
 *
 * THE TALL ONE. A portrait scoreboard built to be dropped into a group chat and
 * read on a phone without opening anything: both starting lineups slot against
 * slot, the two totals, and one word saying what state the week is in.
 *
 * IT IS A SEPARATE ROUTE FROM THE OG CARD BESIDE IT, and that is the point. The
 * sibling `route.tsx` is 1200x630 because that is the shape Open Graph crops to,
 * and a link preview has room for five starters. This one is as tall as the
 * league's lineup needs and shows every slot, which is unusable as a link
 * preview and is exactly right as a picture somebody sends. Two shapes, two
 * routes, one view model underneath, so the two can never disagree about a
 * score.
 *
 * ONCE THE GAMES START, THE SCORES ARE THE HEADLINE. That decision is made in
 * `MatchupView.resultsVisible` upstream and applied by `buildShareCard`, so
 * this card and the page it was shared from lead with the same number on the
 * same afternoon.
 *
 * NO VALUE DATA APPEARS HERE, which is why `resolveLeagueContext` is not called:
 * every figure is a projection or a result scored under the league's own Sleeper
 * settings, and neither moves when a reader changes their value source.
 *
 * NOTHING IS SYNCED BY THIS ROUTE either. It reads the rows the deep view
 * already wrote. A crawler fetching an image is not a reason to hit Sleeper, and
 * a share card that triggered a league sync would let anyone with a URL schedule
 * work on our side.
 */

const WIDTH = 1080;
const BG = "#0F0F1A";
const BG_BASE = "#07070D";
const INK = "#F4F4F8";
const INK_MUTED = "#A8A8B8";
const INK_SUBTLE = "#6B6B7D";
const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const LINE = "#1F1F33";
const PANEL = "#0B0B14";
const PANEL_SOFT = "#12121F";

/** Same hues the roster columns use on the site (tailwind.config.ts `position.*`). */
const GROUP_COLOR: Record<SlotGroup, string> = {
  QB: "#F87171",
  RB: "#34D399",
  WR: "#60A5FA",
  TE: "#FBBF24",
  FLEX: "#C084FC",
  SUPERFLEX: "#F472B6",
  IDP: "#94A3B8",
  K: "#A3E635",
  DEF: "#FB923C",
};

/**
 * Row height, and it is set by the PHOTO rather than by the text.
 *
 * A 46px headshot with breathing room above and below is what makes a row read
 * as a person rather than as a line of a table, which is the whole reason the
 * reference card this is modelled on is legible at thumbnail size in a chat.
 */
const ROW_HEIGHT = 100;
const PHOTO_SIZE = 46;
const AVATAR_SIZE = 74;
const HEADER_HEIGHT = 132;
/**
 * Two heights, because an unpaired roster has no second column and no strip
 * under it. One height for both left a third of the box empty on a bye.
 */
const SCOREBOARD_HEIGHT = 296;
const SCOREBOARD_HEIGHT_SOLO = 196;
const FOOTER_HEIGHT = 96;
const BODY_PADDING = 28;

/**
 * The largest roster number this route will look up.
 *
 * Same ceiling the page and the OG card enforce, for the same reason: every
 * distinct (league, week, roster) triple is a distinct cache key and the
 * response carries an hour of edge cache, so an unbounded id is an unlimited
 * supply of 404 images that each stay parked.
 */
const MAX_ROSTER_ID = 64;

/**
 * The most slots this route will draw.
 *
 * `roster_positions` is stored verbatim from Sleeper and `alignedStartingSlots`
 * keeps every token it does not recognise, so the height of this image is a
 * function of a value that originates outside our control, and any visitor can
 * get a league of their choosing synced simply by opening its deep view. Real
 * leagues sit well under this. A league over it gets a message rather than a
 * silently shortened lineup, because dropping four starters off a scoreboard
 * produces a picture of a matchup nobody played.
 */
const MAX_ROWS = 30;

/**
 * ONE CACHE POLICY, USED ON BOTH PATHS.
 *
 * next/og supplies its own default when a response carries no cache-control,
 * and that default is `public, immutable, max-age=31536000`. On the failure
 * path that is a live bug rather than a tuning question: a league whose week has
 * not been written yet answers "no game stored", and `immutable` then pins that
 * message at the edge for a YEAR, so the share link keeps serving it long after
 * Sleeper publishes the week. A conditional revalidate is not even attempted.
 * Failures get a much shorter window than successes for the same reason.
 */
const CACHE_OK =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const CACHE_MISS = "public, max-age=0, s-maxage=60";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ league_id: string; week: string; roster_id: string }>;
  },
) {
  // THE QUERY STRING IS PART OF THE CDN CACHE KEY, and this route reads none of
  // it: the week and the roster are the whole key. Left accepted, `?a=1`, `?a=2`
  // and so on are an unlimited supply of distinct cache entries against ONE real
  // league, each one a full miss costing eight queries and a satori render. It
  // is a cheaper hole than an unbounded roster id because nothing else rejects
  // it. Refusing it costs a reader nothing, because nothing legitimate sends one.
  if (new URL(request.url).search !== "") {
    return new Response("This route takes no query parameters", { status: 400 });
  }

  const {
    league_id: sleeperLeagueId,
    week: weekParam,
    roster_id: rosterParam,
  } = await params;

  const week = Number.parseInt(weekParam, 10);
  const sleeperRosterId = Number.parseInt(rosterParam, 10);
  if (
    !sleeperLeagueId ||
    sleeperLeagueId.length > 64 ||
    !Number.isFinite(week) ||
    week < 1 ||
    week > MAX_MATCHUP_WEEK ||
    !Number.isFinite(sleeperRosterId) ||
    sleeperRosterId < 1 ||
    sleeperRosterId > MAX_ROSTER_ID
  ) {
    // A 400 with no image body, so a rejected id never reaches the renderer and
    // never becomes something worth caching.
    return new Response("Invalid params", { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  // THE ID IS NOT ECHOED BACK. Up to 64 characters chosen by whoever wrote the
  // URL would land as a text node on an FF Beacon wordmark, served from our own
  // domain and cached at the edge: a small defacement primitive, and a plausible
  // one to paste somewhere. The reader who needs this message already knows
  // which link they followed.
  if (!league) return notFoundImage("That league is not on FF Beacon yet");

  const season = Number(league.season);
  if (!Number.isFinite(season))
    return notFoundImage("This league has no season on file");

  const playoffWeekStart = resolvePlayoffWeekStart(league.metadata);
  const currentWeek = await resolveScheduleWeek(season, playoffWeekStart);

  const result = await loadMatchupDetail(supabase, supabase, {
    leagueRowId: league.id,
    season,
    week,
    sleeperRosterId,
    currentWeek,
  });
  if (!result.ok) {
    return notFoundImage(`No week ${week} game stored for this roster`);
  }

  const card = buildShareCard(result.view, league.name);
  if (card.rows.length > MAX_ROWS) {
    return notFoundImage("This league's lineup is too long to draw");
  }

  // EVERY PHOTO AT ONCE, in one wave, and none of them able to fail the card.
  //
  // A full lineup is about twenty headshots plus two manager avatars. Fetched in
  // sequence that is twenty round trips of latency stacked end to end; fetched
  // together it is one, and `loadRemoteImages` keeps the order so the results zip
  // straight back onto the cells. Everything is memoised per process, so the
  // second card out of the same league pays for almost none of it, and the route
  // itself carries an hour of edge cache on top.
  const cells = card.rows.flatMap((row) => [row.home, row.away]);
  const photoUrls = cells.map((cell) =>
    cell ? sleeperPlayerImageUrl(cell.sleeperId, cell.position) : null,
  );

  const [homeAvatar, awayAvatar, photos] = await Promise.all([
    loadRemoteImage(sleeperAvatarUrl(card.home.avatarId, "thumb")),
    loadRemoteImage(sleeperAvatarUrl(card.away?.avatarId ?? null, "thumb")),
    loadRemoteImages(photoUrls),
  ]);

  // Keyed by the cell's own identity rather than by index, so the lookup inside
  // the row components cannot drift out of step with the flattened list above.
  const photoBySleeperId = new Map<string, string>();
  cells.forEach((cell, i) => {
    const photo = photos[i];
    if (cell && photo) photoBySleeperId.set(cell.sleeperId, photo);
  });

  const height =
    HEADER_HEIGHT +
    (card.away ? SCOREBOARD_HEIGHT : SCOREBOARD_HEIGHT_SOLO) +
    card.rows.length * ROW_HEIGHT +
    FOOTER_HEIGHT +
    BODY_PADDING * 2;

  return new ImageResponse(
    <Card
      card={card}
      homeAvatar={homeAvatar}
      awayAvatar={awayAvatar}
      photos={photoBySleeperId}
    />,
    {
      width: WIDTH,
      height,
      fonts: OG_FONTS,
      headers: { "cache-control": CACHE_OK },
    },
  );
}

function Card({
  card,
  homeAvatar,
  awayAvatar,
  photos,
}: {
  card: ShareCard;
  homeAvatar: string | null;
  awayAvatar: string | null;
  /** Sleeper id to data URI. A miss is a placeholder, never a broken box. */
  photos: Map<string, string>;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(180deg, ${BG} 0%, ${BG_BASE} 100%)`,
        color: INK,
        fontFamily: OG_FONT_FAMILY,
        fontWeight: 500,
        padding: BODY_PADDING,
      }}
    >
      <Header card={card} />
      <Scoreboard card={card} homeAvatar={homeAvatar} awayAvatar={awayAvatar} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 16,
          borderRadius: 20,
          border: `1px solid ${LINE}`,
          background: PANEL,
          overflow: "hidden",
        }}
      >
        {card.rows.map((row, index) => (
          <Row
            key={row.key}
            row={row}
            hasAway={card.away !== null}
            zebra={index % 2 === 1}
            photos={photos}
          />
        ))}
      </div>

      <Footer card={card} />
    </div>
  );
}

/** The wordmark, the league, and one word for the state of the week. */
function Header({ card }: { card: ShareCard }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: HEADER_HEIGHT,
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* The real mark, inlined at module load, not a gradient square standing
            in for one. It is the thing somebody recognises in a chat thread
            before they have read a word of the card. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={OG_LOGO_DATA_URI}
          alt=""
          width={46}
          height={46}
          style={{ width: 46, height: 46 }}
        />
        <p style={{ fontSize: 36, fontWeight: 900, margin: 0, letterSpacing: -0.8 }}>
          {OG_WORDMARK}
        </p>
      </div>
      <p
        style={{
          fontSize: 20,
          fontWeight: 500,
          color: INK_MUTED,
          margin: "12px 0 0 0",
          maxWidth: WIDTH - BODY_PADDING * 2 - 40,
        }}
      >
        {clip(card.leagueName, 34)}, week {card.week}, {card.stateLabel.toLowerCase()}
      </p>
    </div>
  );
}

/**
 * The two team names, the two totals, and the strip under them.
 *
 * The strip is a WIN CHANCE before the games start and a MARGIN once they have,
 * never a bar of one quantity relabelled as the other. Both ends of the win
 * chance are printed as numbers, because a still image cannot be interrogated
 * and a bar on its own says nothing to anybody who cannot see it.
 */
function Scoreboard({
  card,
  homeAvatar,
  awayAvatar,
}: {
  card: ShareCard;
  homeAvatar: string | null;
  awayAvatar: string | null;
}) {
  const { home, away } = card;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: away ? SCOREBOARD_HEIGHT : SCOREBOARD_HEIGHT_SOLO,
        borderRadius: 22,
        border: `1px solid ${LINE}`,
        borderTop: `3px solid ${CYAN}`,
        background: PANEL_SOFT,
        padding: "22px 26px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <TeamBlock side={home} avatar={homeAvatar} align="left" accent={CYAN} basis={card.basisLabel} />
        {away ? (
          <TeamBlock side={away} avatar={awayAvatar} align="right" accent={PURPLE} basis={card.basisLabel} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 400 }}>
            <p style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>No opponent</p>
            <p
              style={{
                fontSize: 17,
                fontWeight: 500,
                color: INK_MUTED,
                margin: "8px 0 0 0",
                textAlign: "right",
              }}
            >
              An odd number of teams, so one roster sits out this week.
            </p>
          </div>
        )}
      </div>

      {away !== null && (
        <div style={{ display: "flex", marginTop: "auto" }}>
          {home.winPct !== null && away.winPct !== null ? (
            <WinChance home={home} away={away} />
          ) : (
            <MarginStrip card={card} />
          )}
        </div>
      )}
    </div>
  );
}

function TeamBlock({
  side,
  avatar,
  align,
  accent,
  basis,
}: {
  side: ShareCardSide;
  avatar: string | null;
  align: "left" | "right";
  accent: string;
  basis: string;
}) {
  const right = align === "right";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: right ? "row-reverse" : "row",
        alignItems: "flex-start",
        gap: 16,
        width: 460,
      }}
    >
      <Avatar src={avatar} name={side.teamName} accent={accent} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: right ? "flex-end" : "flex-start",
          minWidth: 0,
        }}
      >
        <p
          style={{
            fontSize: 28,
            fontWeight: 900,
            margin: 0,
            letterSpacing: -0.6,
            textAlign: right ? "right" : "left",
          }}
        >
          {clip(side.teamName, 20)}
        </p>
        <p
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: INK_SUBTLE,
            margin: "4px 0 0 0",
          }}
        >
          {side.record}
          {side.leading ? ", ahead" : ""}
        </p>
        <p
          style={{
            fontSize: 66,
            fontWeight: 900,
            margin: "8px 0 0 0",
            lineHeight: 1,
            letterSpacing: -1.5,
            color: side.leading ? accent : INK,
          }}
        >
          {fmt(side.total)}
        </p>
        <p
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: INK_SUBTLE,
            margin: "8px 0 0 0",
          }}
        >
          {basis.toLowerCase()}
          {side.projected === null ? "" : `, projected ${fmt(side.projected)}`}
        </p>
      </div>
    </div>
  );
}

/**
 * The owner's avatar, or their team's first letter.
 *
 * Square-cornered would be the league-logo rule; this is a PERSON's avatar, so
 * it is a circle, matching `components/sleeper-avatar.tsx` on the site.
 */
function Avatar({
  src,
  name,
  accent,
}: {
  src: string | null;
  name: string;
  accent: string;
}) {
  const size = AVATAR_SIZE;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{
          // The SIZE HAS TO BE IN THE STYLE, not only in the attributes. Satori
          // lays an <img> out from its computed style, so width and height as
          // bare attributes leave it at zero by zero and the avatar renders as
          // an empty ring.
          width: size,
          height: size,
          objectFit: "cover",
          borderRadius: size / 2,
          border: `2px solid ${accent}`,
        }}
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `2px solid ${accent}`,
        background: PANEL,
      }}
    >
      {/* WRAPPED, not a bare string. Satori lays out elements, and a raw text
          child of a flex container renders as nothing: the first version of
          this drew an empty circle for every manager with no avatar. */}
      <p style={{ fontSize: 30, fontWeight: 900, color: accent, margin: 0 }}>
        {(name.trim()[0] ?? "?").toUpperCase()}
      </p>
    </div>
  );
}

function WinChance({ home, away }: { home: ShareCardSide; away: ShareCardSide }) {
  const homePct = home.winPct ?? 50;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {/* A ROW WITH justifyContent, not textAlign on the text itself. Satori
          sizes a text node to its own content inside a column and neither
          textAlign nor a 100% width moves it, so the label sat pinned to the
          left edge under the home team's total. A one-child flex row is the
          thing satori actually centres. */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <p
          style={{
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: 2,
            color: INK_SUBTLE,
            margin: 0,
          }}
        >
          WIN CHANCE
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <p style={{ fontSize: 25, fontWeight: 900, margin: 0, width: 78, color: CYAN }}>
          {homePct}%
        </p>
        <div
          style={{
            display: "flex",
            flex: 1,
            height: 16,
            borderRadius: 8,
            background: "#1A1A2E",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", width: `${homePct}%`, background: CYAN }} />
          <div style={{ display: "flex", flex: 1, background: PURPLE }} />
        </div>
        <p
          style={{
            fontSize: 25,
            fontWeight: 900,
            margin: 0,
            width: 78,
            textAlign: "right",
            color: PURPLE,
          }}
        >
          {away.winPct ?? 100 - homePct}%
        </p>
      </div>
    </div>
  );
}

/**
 * The gap, once there is one to report.
 *
 * Deliberately NOT a bar. A bar split by the two scores looks exactly like the
 * win chance it replaced and is a different quantity, and nothing on a still
 * image tells a reader which of the two they are looking at.
 */
function MarginStrip({ card }: { card: ShareCard }) {
  const text = card.margin
    ? `${clip(card.margin.teamName, 24)} ahead by ${card.margin.points.toFixed(1)}`
    : "Level, with nothing between the two totals";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: 52,
        borderRadius: 12,
        border: `1px solid ${LINE}`,
        background: "#15152A",
      }}
    >
      <p style={{ fontSize: 21, fontWeight: 900, margin: 0, color: INK }}>{text}</p>
    </div>
  );
}

/** One slot: player, number, badge, number, player. */
function Row({
  row,
  hasAway,
  zebra,
  photos,
}: {
  row: ShareCardRow;
  hasAway: boolean;
  zebra: boolean;
  photos: Map<string, string>;
}) {
  const color = GROUP_COLOR[row.group] ?? INK_MUTED;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: ROW_HEIGHT,
        padding: "0 20px",
        background: zebra ? "rgba(255, 255, 255, 0.018)" : "transparent",
        borderTop: `1px solid rgba(31, 31, 51, 0.7)`,
      }}
    >
      <PlayerSide cell={row.home} align="left" accent={CYAN} photos={photos} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 76,
          height: 46,
          borderRadius: 10,
          border: `1px solid ${color}55`,
          background: `${color}18`,
          margin: "0 12px",
        }}
      >
        <p style={{ fontSize: 18, fontWeight: 900, margin: 0, color, letterSpacing: 0.5 }}>
          {row.slotLabel}
        </p>
      </div>
      {hasAway ? (
        <PlayerSide cell={row.away} align="right" accent={PURPLE} photos={photos} />
      ) : (
        <div style={{ display: "flex", flex: 1 }} />
      )}
    </div>
  );
}

/**
 * One half of a row.
 *
 * The number sits on the INNER edge on both sides, so two names and two numbers
 * read as one comparison down a single axis rather than as four separate
 * readings. That falls out of the flex direction: the number is the last child
 * either way, and the right-hand side is row-reverse.
 */
function PlayerSide({
  cell,
  align,
  accent,
  photos,
}: {
  cell: ShareCardCell | null;
  align: "left" | "right";
  /** Sleeper id to data URI. A miss draws the position instead. */
  photos: Map<string, string>;
  /**
   * This side's colour, cyan on the left and purple on the right, matching the
   * two ends of the scoreboard above. It marks the higher of the two numbers in
   * a row. Painting both sides' winners cyan said "home" on an away player and
   * broke the one pairing the card asks a reader to carry down the page.
   */
  accent: string;
}) {
  const right = align === "right";

  if (!cell) {
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          justifyContent: right ? "flex-start" : "flex-end",
          minWidth: 0,
        }}
      >
        <p style={{ fontSize: 17, fontWeight: 500, color: INK_SUBTLE, margin: 0 }}>
          Empty
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        flexDirection: right ? "row-reverse" : "row",
        alignItems: "center",
        gap: 14,
        minWidth: 0,
      }}
    >
      {/* THE PHOTO SITS ON THE OUTSIDE EDGE on both sides, which the
          row-reverse gives for free, so the two portraits frame the row and the
          two numbers meet in the middle where the comparison is. Same placement
          as the on-page matchup table. */}
      <PlayerPhoto
        src={photos.get(cell.sleeperId) ?? null}
        position={cell.position}
        accent={accent}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          alignItems: right ? "flex-end" : "flex-start",
        }}
      >
        <p
          style={{
            fontSize: 25,
            fontWeight: 900,
            margin: 0,
            letterSpacing: -0.4,
            color: cell.leading ? INK : "#DCDCE6",
          }}
        >
          {cell.name}
        </p>
        <p
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: INK_SUBTLE,
            margin: "4px 0 0 0",
          }}
        >
          {cell.meta}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: right ? "flex-start" : "flex-end",
          width: 92,
        }}
      >
        <p
          style={{
            fontSize: 28,
            fontWeight: 900,
            margin: 0,
            lineHeight: 1,
            // A dash, never a zero. A slot with no published number on a
            // screenshot is the one that gets argued about.
            color: cell.points === null ? INK_SUBTLE : cell.leading ? accent : INK,
          }}
        >
          {fmt(cell.points)}
        </p>
        {cell.projected !== null && (
          <p
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: INK_SUBTLE,
              margin: "5px 0 0 0",
            }}
          >
            {cell.projected.toFixed(1)} proj
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One player's photo, or the position where the photo would have been.
 *
 * SQUARE-CORNERED, deliberately. Circles are reserved on this site for PEOPLE:
 * a Sleeper manager, a Signal profile. A player photo is a player photo, and the
 * two reading as different kinds of thing at a glance is the same rule
 * `components/player-headshot.tsx` enforces on the page.
 *
 * A miss is not a broken box and not an empty one. A team defence has no
 * headshot at all (Sleeper answers 403 on the player path, so the logo path is
 * tried instead and can still come back empty), a photo can time out, and a
 * player Sleeper has no picture for is ordinary. The position code in the same
 * frame keeps the row's rhythm and still says something true.
 */
function PlayerPhoto({
  src,
  position,
  accent,
}: {
  src: string | null;
  position: string;
  accent: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={PHOTO_SIZE}
        height={PHOTO_SIZE}
        style={{
          // The size has to be in the STYLE, not only in the attributes: satori
          // lays an img out from its computed style, so bare attributes leave it
          // at zero by zero and the photo renders as nothing at all.
          width: PHOTO_SIZE,
          height: PHOTO_SIZE,
          objectFit: "cover",
          borderRadius: 10,
          border: `1px solid ${LINE}`,
          background: PANEL,
        }}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: PHOTO_SIZE,
        height: PHOTO_SIZE,
        borderRadius: 10,
        border: `1px solid ${LINE}`,
        background: PANEL,
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 900, margin: 0, color: accent }}>
        {position.slice(0, 3).toUpperCase() || "?"}
      </p>
    </div>
  );
}

function Footer({ card }: { card: ShareCard }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: FOOTER_HEIGHT,
        paddingTop: 6,
      }}
    >
      <p
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: INK_SUBTLE,
          margin: 0,
          maxWidth: 760,
        }}
      >
        {card.footnote}
      </p>
      <p style={{ fontSize: 18, fontWeight: 900, color: INK_MUTED, margin: 0 }}>
        {OG_WORDMARK}
      </p>
    </div>
  );
}

/** One decimal, or a dash. Never a zero standing in for a missing number. */
function fmt(n: number | null): string {
  return n === null ? "--" : n.toFixed(1);
}

function notFoundImage(reason: string): Response {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
        color: INK,
        fontFamily: OG_FONT_FAMILY,
        fontWeight: 500,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OG_LOGO_DATA_URI}
        alt=""
        width={72}
        height={72}
        style={{ width: 72, height: 72 }}
      />
      <p style={{ fontSize: 52, fontWeight: 900, margin: "18px 0 0 0" }}>
        {OG_WORDMARK}
      </p>
      <p style={{ fontSize: 26, fontWeight: 500, color: INK_MUTED, marginTop: 14 }}>
        {reason}
      </p>
    </div>,
    {
      width: WIDTH,
      height: 720,
      status: 404,
      fonts: OG_FONTS,
      // See CACHE_MISS. Without this next/og pins the failure for a year.
      headers: { "cache-control": CACHE_MISS },
    },
  );
}

/**
 * The league's own playoff cut line.
 *
 * Sleeper writes `playoff_week_start: 0` on a league whose bracket has not been
 * set up, and zero is a number, so a plain `?? 15` never fires. Same guard as
 * lib/power-pulse/load.ts, for the same reason.
 */
function resolvePlayoffWeekStart(metadata: unknown): number {
  const settings = (metadata as { settings?: Record<string, unknown> } | null)
    ?.settings;
  const configured = Number(settings?.playoff_week_start);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : 15;
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 3)}...`;
}
