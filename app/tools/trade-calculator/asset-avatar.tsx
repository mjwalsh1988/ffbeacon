"use client";

import { PLAYER_PHOTO_RADIUS, PlayerHeadshot } from "@/components/player-headshot";

const ORDINALS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
};

/**
 * One avatar for any Signal Check asset. Players render the shared Sleeper-CDN
 * headshot (with the never-broken fallback); draft picks render a branded badge
 * ("1st", "2nd", ...). The badge takes the same square and the same corner
 * radius as the headshot, so player and pick rows line up cleanly in the
 * builder and the result.
 *
 * Pass `decorative` whenever the player/pick name is already rendered as text
 * next to the avatar (the builder rows and the result rows): the avatar is then
 * hidden from screen readers so the name is not announced two or three times.
 * The visible hover tooltip (title) is preserved for sighted users.
 */
export function AssetAvatar({
  kind,
  sleeperId,
  name,
  round,
  size = 44,
  decorative = false,
}: {
  kind: "player" | "pick";
  sleeperId?: string | null;
  name: string;
  round?: number | null;
  size?: number;
  decorative?: boolean;
}) {
  const inner =
    kind === "player" ? (
      <PlayerHeadshot sleeperId={sleeperId ?? null} name={name} size={size} />
    ) : (
      <span
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : name}
        title={name}
        style={{ width: size, height: size }}
        className={`inline-flex flex-shrink-0 items-center justify-center border border-brand-purple/40 bg-brand-purple/10 text-brand-cyan ${PLAYER_PHOTO_RADIUS}`}
      >
        <span className="text-[11px] font-semibold leading-none tracking-tight">
          {round ? (ORDINALS[round] ?? `R${round}`) : "PICK"}
        </span>
      </span>
    );

  // Hide the whole avatar subtree from assistive tech when the name is already
  // adjacent. aria-hidden on the wrapper removes the headshot's alt text too.
  return decorative ? (
    <span aria-hidden="true" className="inline-flex">
      {inner}
    </span>
  ) : (
    inner
  );
}
