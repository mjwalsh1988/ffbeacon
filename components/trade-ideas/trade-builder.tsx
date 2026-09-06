"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check, Plus, Scale, X } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { SidePanel } from "@/components/side-panel";
import { PanelFilterField, FILTER_THRESHOLD } from "@/components/panel-filter-field";
import { PickTag } from "@/components/trade-ideas/pick-tag";
import { MAX_BUILD_ASSETS_PER_SIDE, proposalHref } from "@/lib/trade-impact/proposal-url";
import type { BuildAsset, PickSlot, TradeProposal } from "@/lib/trade-impact/types";

/**
 * Propose any trade you like, and get it graded on the same terms as a
 * suggestion.
 *
 * EVALUATE IS A LINK, NOT A FETCH
 *   The obvious build is a button that calls the server action and drops the
 *   result into local state. It is fewer moving parts and it is the wrong
 *   choice, because the answer would then live nowhere: a trade somebody spent
 *   two minutes assembling could not be sent to a leaguemate, could not be
 *   bookmarked, and would be destroyed by the back button. So the deal is
 *   encoded into the query string (lib/trade-impact/proposal-url.ts) and the
 *   page renders the evaluation on the server from it. Pressing Evaluate is an
 *   ordinary navigation. That also means there is exactly one code path that
 *   turns a proposal into a verdict, and it is the one that already runs the
 *   ownership check and the rate-limit claim in the right order.
 *
 *   The link carries `#trade-evaluation`, which is a real element on the page it
 *   navigates to and is rendered OUTSIDE the evaluation's Suspense boundary, so
 *   it exists at first paint rather than appearing later when the result streams
 *   in. That is what makes the jump land somewhere.
 *
 * THE RUNNING TOTALS ARE FREE
 *   Every value on screen is already in the browser, handed down with the team
 *   lists. Adding them up as you build costs nothing and it answers the question
 *   a person actually has while assembling a package, which is "am I close yet".
 *   Waiting for a server round trip to learn you are 2,000 short would make the
 *   builder useless for the thing it is for.
 *
 * WHAT AN UNRESOLVED ASSET DOES
 *   A link can outlive a roster. An asset in the URL that is no longer held by
 *   the team it is claimed for renders as a named row saying so and is left out
 *   of the totals, rather than silently vanishing or being counted at zero. The
 *   server rejects the same trade for the same reason; this is the client saying
 *   which piece went stale.
 */

/** One player, with every figure the rows and the totals need. */
export type BuilderPlayer = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  value: number;
  /** Projected points per week in this league's scoring. Null = unpublished. */
  projPoints: number | null;
};

/**
 * One tradeable pick, already placed and priced by lib/trade-finder-data.ts.
 *
 * `originalRosterId` is part of the identity, not decoration. A roster in a real
 * league holds nine different 2027 1sts, each landing wherever its ORIGINAL team
 * finishes and each therefore worth a different amount. Keyed on season and
 * round alone they are one asset: the picker offered one, eight could not be
 * traded, and the one that showed answered for all of them.
 */
export type BuilderPick = {
  season: number;
  round: number;
  pickPosition: PickSlot;
  originalRosterId: number;
  isOwnPick: boolean;
  originalOwnerHandle: string | null;
  originalTeamName: string | null;
  /** True when the pool is a projected finish rather than a published order. */
  positionEstimated: boolean;
  /** Full plain-text label. Used where there is no room to render the parts. */
  label: string;
  value: number;
};

export type BuilderTeam = {
  rosterId: number;
  teamName: string;
  ownerHandle: string | null;
  players: BuilderPlayer[];
  picks: BuilderPick[];
};

type Side = "in" | "out";
type PickerKind = "player" | "pick";

/**
 * Identity for deduping and for the remove button.
 *
 * A pick is identified by season, round and ORIGINAL OWNER. The slot bucket is
 * deliberately not in the key: it is our own estimate, and it can change under a
 * pick between one page load and the next when Power Pulse recomputes, which
 * would make the same pick look like a different asset.
 */
function assetKey(asset: BuildAsset): string {
  return asset.kind === "player"
    ? `p:${asset.playerId}`
    : `k:${asset.season}-${asset.round}-${asset.originalRosterId ?? "any"}`;
}

function pickKey(pick: { season: number; round: number; originalRosterId: number }): string {
  return `k:${pick.season}-${pick.round}-${pick.originalRosterId}`;
}

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function TradeBuilder({
  sleeperLeagueId,
  linkUsername,
  source,
  myRosterId,
  teams,
  isDynasty,
  allowPicks,
  initialProposal,
}: {
  sleeperLeagueId: string;
  linkUsername: string | null;
  source: string | null;
  myRosterId: number;
  /** Every team in the league, the reader's own included. */
  teams: BuilderTeam[];
  isDynasty: boolean;
  /** False in redraft, where no pick has a published value. */
  allowPicks: boolean;
  /** The trade already in the URL, if there is one. Prefills both sides. */
  initialProposal: TradeProposal | null;
}) {
  const baseId = useId();
  const myTeam = useMemo(
    () => teams.find((t) => t.rosterId === myRosterId) ?? null,
    [teams, myRosterId],
  );
  const otherTeams = useMemo(
    () => teams.filter((t) => t.rosterId !== myRosterId),
    [teams, myRosterId],
  );

  const [theirRosterId, setTheirRosterId] = useState<number>(
    initialProposal?.theirRosterId ?? otherTeams[0]?.rosterId ?? -1,
  );
  const [incoming, setIncoming] = useState<BuildAsset[]>(initialProposal?.incoming ?? []);
  const [outgoing, setOutgoing] = useState<BuildAsset[]>(initialProposal?.outgoing ?? []);
  const [picker, setPicker] = useState<{ side: Side; kind: PickerKind } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Stable identity on purpose. An inline arrow changes on every keystroke in
  // the panel's filter box, and a panel that treats a new handler as a new
  // dialog would hand focus back to the button behind it and then drag focus to
  // the close button, mid-typing.
  const closePicker = useCallback(() => setPicker(null), []);

  const theirTeam = useMemo(
    () => otherTeams.find((t) => t.rosterId === theirRosterId) ?? null,
    [otherTeams, theirRosterId],
  );

  const teamOf = useCallback(
    (side: Side) => (side === "in" ? theirTeam : myTeam),
    [myTeam, theirTeam],
  );

  /** Every asset on either side, so nothing can be added twice. */
  const usedKeys = useMemo(
    () => new Set([...incoming, ...outgoing].map(assetKey)),
    [incoming, outgoing],
  );

  const resolvePlayer = useCallback(
    (side: Side, playerId: string): BuilderPlayer | null =>
      teamOf(side)?.players.find((p) => p.playerId === playerId) ?? null,
    [teamOf],
  );

  const resolvePick = useCallback(
    (side: Side, asset: Extract<BuildAsset, { kind: "pick" }>): BuilderPick | null => {
      const team = teamOf(side);
      if (!team) return null;
      // Season, round and ORIGINAL OWNER, the same three the server matches on
      // in lib/trade-impact/evaluate.ts. The slot bucket is left out on purpose:
      // it is our own estimate rather than the league's fact, so requiring it to
      // agree would reject a real pick over a label we chose.
      //
      // An asset with no original owner came out of a link written before that
      // field existed. It falls back to the first pick of that season and round,
      // which is what it has always resolved to.
      const match = team.picks.filter(
        (p) => p.season === asset.season && p.round === asset.round,
      );
      if (match.length === 0) return null;
      if (asset.originalRosterId === undefined) return match[0];
      return match.find((p) => p.originalRosterId === asset.originalRosterId) ?? null;
    },
    [teamOf],
  );

  const sideTotal = useCallback(
    (side: Side, assets: BuildAsset[]): number => {
      let total = 0;
      for (const asset of assets) {
        const found =
          asset.kind === "player"
            ? resolvePlayer(side, asset.playerId)
            : resolvePick(side, asset);
        if (found) total += found.value;
      }
      return total;
    },
    [resolvePlayer, resolvePick],
  );

  const valueIn = sideTotal("in", incoming);
  const valueOut = sideTotal("out", outgoing);
  const gap = valueIn - valueOut;

  /** The sentence the live region says after every add, remove, or team swap. */
  const totalsSentence = useCallback((inValue: number, outValue: number): string => {
    const diff = inValue - outValue;
    const direction =
      Math.abs(diff) < 1
        ? "The two sides are level."
        : diff > 0
          ? `You are up ${fmtValue(Math.abs(diff))}.`
          : `You are down ${fmtValue(Math.abs(diff))}.`;
    return `You receive ${fmtValue(inValue)} in value and send ${fmtValue(outValue)}. ${direction}`;
  }, []);

  const setSide = useCallback(
    (side: Side, next: BuildAsset[], prefix: string) => {
      const nextIn = side === "in" ? next : incoming;
      const nextOut = side === "out" ? next : outgoing;
      if (side === "in") setIncoming(next);
      else setOutgoing(next);
      setAnnouncement(
        `${prefix} ${totalsSentence(sideTotal("in", nextIn), sideTotal("out", nextOut))}`,
      );
    },
    [incoming, outgoing, sideTotal, totalsSentence],
  );

  const addAsset = useCallback(
    (side: Side, asset: BuildAsset, label: string) => {
      const current = side === "in" ? incoming : outgoing;
      if (current.length >= MAX_BUILD_ASSETS_PER_SIDE) return;
      if (usedKeys.has(assetKey(asset))) return;
      setSide(
        side,
        [...current, asset],
        `${label} added to what you ${side === "in" ? "receive" : "send"}.`,
      );
    },
    [incoming, outgoing, setSide, usedKeys],
  );

  const removeAsset = useCallback(
    (side: Side, key: string, label: string) => {
      const current = side === "in" ? incoming : outgoing;
      setSide(
        side,
        current.filter((a) => assetKey(a) !== key),
        `${label} removed from what you ${side === "in" ? "receive" : "send"}.`,
      );
    },
    [incoming, outgoing, setSide],
  );

  /**
   * What this side already holds, keyed the way the picker keys its rows, and
   * mapped to the key that removes it.
   *
   * TWO KEYS, NOT ONE, because they can differ. A row in the picker is keyed by
   * the pick's real identity; an asset that arrived in a link written before the
   * original owner was encoded is stored under a vaguer key ("k:2027-1-any").
   * Resolving each stored asset back to the pick it actually points at is what
   * lets such a row show as added, and returning the STORED key is what lets it
   * be removed again. Keying both ends the same way would break one or the other.
   */
  const addedOnSide = useCallback(
    (side: Side): Map<string, string> => {
      const assets = side === "in" ? incoming : outgoing;
      const map = new Map<string, string>();
      for (const asset of assets) {
        const stored = assetKey(asset);
        if (asset.kind === "player") {
          map.set(`p:${asset.playerId}`, stored);
          continue;
        }
        const found = resolvePick(side, asset);
        map.set(found ? pickKey(found) : stored, stored);
      }
      return map;
    },
    [incoming, outgoing, resolvePick],
  );

  const changeTeam = useCallback(
    (rosterId: number) => {
      const team = otherTeams.find((t) => t.rosterId === rosterId) ?? null;
      setTheirRosterId(rosterId);
      // What you receive belonged to the previous team, so it cannot survive the
      // swap. Clearing it is the honest move; carrying it over would leave rows
      // on screen that the server is about to reject as not on that roster.
      setIncoming([]);
      setAnnouncement(
        `Trading with ${team?.teamName ?? "another team"}. What you receive has been cleared. ${totalsSentence(
          0,
          sideTotal("out", outgoing),
        )}`,
      );
    },
    [otherTeams, outgoing, sideTotal, totalsSentence],
  );

  const proposal: TradeProposal | null =
    theirTeam === null || (incoming.length === 0 && outgoing.length === 0)
      ? null
      : { myRosterId, theirRosterId, incoming, outgoing };

  const evaluateHref = proposal
    ? `${proposalHref(sleeperLeagueId, proposal, {
        searchedUsername: linkUsername,
        source,
      })}#trade-evaluation`
    : null;

  const canAddPicks = isDynasty && allowPicks;
  const emptyNoteId = `${baseId}-empty`;

  if (myTeam === null || otherTeams.length === 0) {
    return (
      <Panel eyebrow="Not ready" title="Nothing to build with">
        <p className="text-sm leading-relaxed text-ink-muted">
          We could not read the rosters in this league, so there is nothing to put on
          either side of a deal. See the Overview tab.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      eyebrow="Build"
      title="Build a trade"
      helper="Put anything on either side. Graded the same as a suggestion."
    >
      {/* Every add, remove, and team change lands here. Polite, so it waits for
          whatever the reader was already hearing to finish. role="status" for
          the implicit aria-atomic: the whole sentence is replaced on every
          change, and without it a reader can hear only the words that differ,
          which is "send 3,900" with nothing to attach it to. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <DealSide
          side="out"
          heading="You send"
          teamName={myTeam.teamName}
          assets={outgoing}
          resolvePlayer={resolvePlayer}
          resolvePick={resolvePick}
          total={valueOut}
          canAddPicks={canAddPicks && myTeam.picks.length > 0}
          onAdd={(kind) => setPicker({ side: "out", kind })}
          onRemove={removeAsset}
          idPrefix={`${baseId}-out`}
        />

        <DealSide
          side="in"
          heading="You receive"
          teamName={theirTeam?.teamName ?? ""}
          assets={incoming}
          resolvePlayer={resolvePlayer}
          resolvePick={resolvePick}
          total={valueIn}
          canAddPicks={canAddPicks && (theirTeam?.picks.length ?? 0) > 0}
          onAdd={(kind) => setPicker({ side: "in", kind })}
          onRemove={removeAsset}
          idPrefix={`${baseId}-in`}
          teamSelect={
            <div>
              <label
                htmlFor={`${baseId}-team`}
                className="block text-xs font-semibold text-ink"
              >
                Trading with
              </label>
              <select
                id={`${baseId}-team`}
                value={theirRosterId}
                onChange={(e) => changeTeam(Number.parseInt(e.target.value, 10))}
                className="mt-1 min-h-11 w-full rounded-card border border-ink-subtle bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {/* teamName is already formatTeamLabel output, so it carries
                    the handle when there is one to carry: "Sir Chuddy kid Cudi
                    (@jnesselhauf)". Appending ownerHandle here as well printed
                    it twice. */}
                {otherTeams.map((team) => (
                  <option key={team.rosterId} value={team.rosterId}>
                    {team.teamName}
                  </option>
                ))}
              </select>
            </div>
          }
        />
      </div>

      {/* The gap, spelled out. The two side totals are already above; this is
          the subtraction a reader would otherwise do in their head on every
          change, and it is the number that decides whether the deal is worth
          sending at all. */}
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-card border border-line bg-base/50 p-3">
        <Total label="You receive" value={fmtValue(valueIn)} accent="cyan" />
        <Total label="You send" value={fmtValue(valueOut)} accent="purple" />
        <Total
          label="Gap"
          value={`${gap > 0 ? "+" : gap < 0 ? "-" : ""}${fmtValue(Math.abs(gap))}`}
          accent="ink"
          spoken={totalsSentence(valueIn, valueOut)}
        />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {evaluateHref ? (
          <Link
            href={evaluateHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2 text-sm font-bold text-black shadow-[0_0_24px_-10px_rgba(168,85,247,0.9)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <Scale aria-hidden="true" className="h-4 w-4" />
            Evaluate trade
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled
              aria-describedby={emptyNoteId}
              className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-card border border-line px-4 py-2 text-sm font-bold text-ink-subtle"
            >
              <Scale aria-hidden="true" className="h-4 w-4" />
              Evaluate trade
            </button>
            <p id={emptyNoteId} className="text-xs text-ink-muted">
              Add at least one player or pick to either side first.
            </p>
          </>
        )}
        {evaluateHref && (
          <p className="text-xs text-ink-muted">
            The review appears below, at its own address, so you can send it to whoever
            you are trading with.
          </p>
        )}
      </div>

      {/* Keyed on the side and kind so switching from "Add player" on one side
          to "Add pick" on the other rebuilds the panel rather than reusing it
          with a stale filter still typed into the box. */}
      {picker && (
        <AssetPickerPanel
          key={`${picker.side}-${picker.kind}`}
          side={picker.side}
          kind={picker.kind}
          team={teamOf(picker.side)}
          added={addedOnSide(picker.side)}
          atCap={
            (picker.side === "in" ? incoming.length : outgoing.length) >=
            MAX_BUILD_ASSETS_PER_SIDE
          }
          onClose={closePicker}
          onAdd={(asset, label) => addAsset(picker.side, asset, label)}
          onRemove={(key, label) => removeAsset(picker.side, key, label)}
        />
      )}
    </Panel>
  );
}

/**
 * One side of the deal.
 *
 * A real section with a real heading, so the two halves are two places a screen
 * reader user can jump between rather than one long run of buttons.
 *
 * Named DealSide rather than SidePanel because the shared drawer component is
 * called SidePanel and this file now uses both. One is a half of the trade; the
 * other is the thing that slides in from the right.
 */
function DealSide({
  side,
  heading,
  teamName,
  assets,
  resolvePlayer,
  resolvePick,
  total,
  canAddPicks,
  onAdd,
  onRemove,
  idPrefix,
  teamSelect,
}: {
  side: Side;
  heading: string;
  teamName: string;
  assets: BuildAsset[];
  resolvePlayer: (side: Side, playerId: string) => BuilderPlayer | null;
  resolvePick: (
    side: Side,
    asset: Extract<BuildAsset, { kind: "pick" }>,
  ) => BuilderPick | null;
  total: number;
  canAddPicks: boolean;
  onAdd: (kind: PickerKind) => void;
  onRemove: (side: Side, key: string, label: string) => void;
  idPrefix: string;
  teamSelect?: ReactNode;
}) {
  const incoming = side === "in";
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const headingId = `${idPrefix}-heading`;
  const capId = `${idPrefix}-cap`;
  const atCap = assets.length >= MAX_BUILD_ASSETS_PER_SIDE;
  const capReason = `${MAX_BUILD_ASSETS_PER_SIDE} assets is the most one side can hold. Remove one to add another.`;

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-card border p-3 ${
        incoming
          ? "border-brand-cyan/30 bg-brand-cyan/[0.04]"
          : "border-brand-purple/30 bg-brand-purple/[0.04]"
      }`}
    >
      <h3
        id={headingId}
        className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] ${
          incoming ? "text-brand-cyan" : "text-brand-purple"
        }`}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {heading}
      </h3>

      {teamSelect ? (
        <div className="mt-2">{teamSelect}</div>
      ) : (
        <p className="mt-1 text-xs text-ink-muted">{teamName}</p>
      )}

      {assets.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          Nothing here yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {assets.map((asset) => {
            const key = assetKey(asset);
            const found =
              asset.kind === "player"
                ? resolvePlayer(side, asset.playerId)
                : resolvePick(side, asset);
            const label =
              found === null ? "This asset" : "name" in found ? found.name : found.label;
            return (
              <li key={key}>
                <AssetRow
                  side={side}
                  asset={asset}
                  found={found}
                  onRemove={() => onRemove(side, key, label)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 border-t border-line pt-2 text-xs font-semibold text-ink-muted">
        Total value {fmtValue(total)}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <AddButton
          disabled={atCap}
          reason={atCap ? capReason : null}
          onClick={() => onAdd("player")}
        >
          Add player
        </AddButton>
        {canAddPicks && (
          <AddButton
            disabled={atCap}
            reason={atCap ? capReason : null}
            onClick={() => onAdd("pick")}
          >
            Add draft pick
          </AddButton>
        )}
      </div>
      {/* The cap is stated as a real paragraph rather than only as a description
          on the button. A disabled button leaves the tab order, so a description
          hung off it is never read; a sentence in the flow of the panel is. */}
      {atCap && (
        <p id={capId} className="mt-2 text-xs text-ink-muted">
          {capReason}
        </p>
      )}
    </section>
  );
}

function AddButton({
  disabled,
  reason,
  onClick,
  children,
}: {
  disabled: boolean;
  reason: string | null;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={reason ? `${children}. ${reason}` : undefined}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:border-dashed disabled:text-ink-subtle disabled:hover:border-line"
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
      {children}
    </button>
  );
}

/**
 * One asset in a side, with its figures and a way to take it back out.
 *
 * The remove button's accessible name is the whole instruction, not the word
 * "Remove". A screen reader user pulling up the list of buttons on this page
 * would otherwise find eight of them all called the same thing, with no way to
 * tell which piece each one drops.
 */
function AssetRow({
  side,
  asset,
  found,
  onRemove,
}: {
  side: Side;
  asset: BuildAsset;
  found: BuilderPlayer | BuilderPick | null;
  onRemove: () => void;
}) {
  const sideWords = side === "in" ? "what you receive" : "what you send";
  const shell =
    "flex items-center gap-2.5 rounded-card border border-line bg-surface-elevated p-2";

  if (found === null) {
    const name =
      asset.kind === "player"
        ? "A player in this link"
        : `The ${asset.season} round ${asset.round} pick`;
    return (
      <div className={shell}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{name}</span>
          <span className="block text-xs text-signal-danger">
            No longer held by that team, so it is not counted in the total.
          </span>
        </span>
        <RemoveButton label={`Remove this asset from ${sideWords}`} onClick={onRemove} />
      </div>
    );
  }

  if (!("name" in found)) {
    // Same three facts as the picker row, in the same order, so a pick a reader
    // just added is recognisable as the one they chose rather than as a
    // shortened version of it.
    return (
      <div className={shell}>
        <span className="min-w-0 flex-1">
          <PickTag pick={found} estimated={found.positionEstimated} />
          <span className="mt-0.5 block text-xs text-ink-muted">
            Draft pick, value {fmtValue(found.value)}
          </span>
        </span>
        <RemoveButton
          label={`Remove ${found.label} from ${sideWords}`}
          onClick={onRemove}
        />
      </div>
    );
  }

  const detail = [found.position, found.team].filter(Boolean).join(", ");
  const figures = [
    `value ${fmtValue(found.value)}`,
    found.projPoints !== null ? `${found.projPoints.toFixed(1)} pts/wk` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={shell}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{found.name}</span>
        <span className="block text-xs text-ink-muted">
          {detail ? `${detail}. ` : ""}
          {figures.join(", ")}
        </span>
      </span>
      <RemoveButton label={`Remove ${found.name} from ${sideWords}`} onClick={onRemove} />
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-signal-danger/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

function Total({
  label,
  value,
  accent,
  spoken,
}: {
  label: string;
  value: string;
  accent: "cyan" | "purple" | "ink";
  spoken?: string;
}) {
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      {/* Steps down a size on a phone so three totals fit one row at 320px
          rather than any of them being dropped to a breakpoint. */}
      <dd
        className={`mt-0.5 font-mono text-sm font-bold tabular-nums sm:text-base ${color}`}
      >
        {spoken ? (
          <>
            <span className="sr-only">{spoken}</span>
            <span aria-hidden="true">{value}</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * Picking assets out of a roster, as a drawer.
 *
 * WHY A DRAWER AND WHY IT STAYS OPEN
 *   It used to be a dialog holding one select and one confirm button, which
 *   meant a three-for-one offer cost three round trips through open, filter,
 *   choose, confirm, close. The list itself is the interaction now: every row
 *   carries its own button, and adding closes nothing. Building a package is one
 *   open and one press per piece.
 *
 *   SidePanel is the shared drawer: it comes in from the right on desktop and up
 *   from the bottom on a phone, and it already handles the focus trap, Escape,
 *   the backdrop, and the scroll lock. Right-hand entry is what lets the deal
 *   stay visible beside the list on a wide screen, so a reader can watch the
 *   totals move as they add.
 *
 * WHY AN ADDED ROW STAYS PUT
 *   It used to leave the list, which read as the row being deleted rather than
 *   moved: the thing you just pressed vanished from under the cursor, the rows
 *   below jumped up, and pressing the wrong name meant closing the drawer to
 *   undo it. A row now stays exactly where it was, lights up, and its button
 *   turns into Remove. Nothing moves, the mistake is visible, and the fix is the
 *   same button you just pressed.
 *
 *   That also means Remove keeps working when the side is full. Add disables at
 *   the cap; Remove is how you make room without leaving the drawer.
 *
 * WHICH ROSTER IT SHOWS
 *   Whichever team owns that side. The counterparty is chosen before any of this
 *   is reachable, so the panel never has to ask again, and the list can never
 *   contain a player the server would reject as not on that roster.
 *
 * WHY THE PICK ROWS LOOK LIKE THAT
 *   See components/trade-ideas/pick-tag.tsx. Which pick, where in the round as a
 *   pill, and whose it originally was. The last one decides the second, and it
 *   is the question a manager actually asks out loud.
 */
function AssetPickerPanel({
  side,
  kind,
  team,
  added,
  atCap,
  onClose,
  onAdd,
  onRemove,
}: {
  side: Side;
  kind: PickerKind;
  team: BuilderTeam | null;
  /** Row key of everything already on this side, mapped to the key that removes
   *  it. See addedOnSide for why those two are not always the same string. */
  added: Map<string, string>;
  /** True when this side is full. Rows stay visible; only Add goes dead. */
  atCap: boolean;
  onClose: () => void;
  onAdd: (asset: BuildAsset, label: string) => void;
  onRemove: (key: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const sideWords = side === "in" ? "receive" : "send";
  const title = kind === "player" ? "Add a player" : "Add a draft pick";

  const players = useMemo(() => {
    if (!team || kind !== "player") return [];
    const q = query.trim().toLowerCase();
    return team.players
      .filter(
        (p) =>
          q === "" ||
          p.name.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          (p.team ?? "").toLowerCase().includes(q),
      )
      // Most valuable first. A package is nearly always assembled from the top
      // of a roster down, and alphabetical buried the best player on the team
      // somewhere in the middle of thirty names.
      //
      // Deliberately NOT re-sorted by whether a row is in the deal. Moving a row
      // the moment it is pressed is the thing this list stopped doing.
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [kind, team, query]);

  const picks = useMemo(() => {
    if (!team || kind !== "pick") return [];
    const q = query.trim().toLowerCase();
    return team.picks
      .filter(
        (p) =>
          q === "" ||
          p.label.toLowerCase().includes(q) ||
          String(p.season).includes(q) ||
          (p.originalOwnerHandle ?? "").toLowerCase().includes(q) ||
          (p.originalTeamName ?? "").toLowerCase().includes(q),
      )
      // Soonest first, then round, then value. A 2027 1st is a different
      // conversation to a 2029 4th, and the year is how managers group them.
      .sort((a, b) => a.season - b.season || a.round - b.round || b.value - a.value);
  }, [kind, team, query]);

  const shown = kind === "player" ? players.length : picks.length;
  const roster = kind === "player" ? (team?.players.length ?? 0) : (team?.picks.length ?? 0);
  const showFilter = roster > FILTER_THRESHOLD;

  const noun = kind === "player" ? "player" : "pick";
  const nouns = shown === 1 ? noun : `${noun}s`;
  const filterStatus = query.trim()
    ? `${shown} ${nouns} match ${query.trim()}.`
    : `${shown} ${nouns} to choose from.`;

  /** Add or remove, from one press, with the right sentence spoken after it. */
  const toggle = (
    rowKey: string,
    label: string,
    build: () => BuildAsset,
  ) => {
    const storedKey = added.get(rowKey);
    if (storedKey !== undefined) {
      onRemove(storedKey, label);
      setAnnouncement(`${label} removed from what you ${sideWords}.`);
      return;
    }
    onAdd(build(), label);
    setAnnouncement(`${label} added to what you ${sideWords}.`);
  };

  return (
    <SidePanel
      open
      onClose={onClose}
      title={title}
      subtitle={
        team ? `${team.teamName}, to what you ${sideWords}` : `To what you ${sideWords}`
      }
    >
      {/* Every press announces here rather than through the parent's region. The
          parent's sits outside this drawer, and a live region inside the open
          dialog is the one a screen reader is listening to while focus is in it.
          The parent still announces too, because it owns the running totals. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {atCap && (
        <p className="mb-4 rounded-card border border-line bg-base/50 px-3 py-2 text-sm text-ink-muted">
          That side already holds {MAX_BUILD_ASSETS_PER_SIDE} assets, which is the most
          one side can carry. Remove one below to add another.
        </p>
      )}

      {showFilter && (
        <PanelFilterField
          label={kind === "player" ? "Filter players" : "Filter picks"}
          placeholder={kind === "player" ? "Name, position, or team" : "Year or owner"}
          value={query}
          onChange={setQuery}
          status={filterStatus}
        />
      )}

      {shown === 0 ? (
        <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-sm text-ink-muted">
          {query.trim()
            ? "Nothing on this roster matches that."
            : kind === "player"
              ? "We hold no values for that roster, so there is nobody to offer."
              : "That team has no tradeable picks."}
        </p>
      ) : (
        <ul role="list" className="space-y-2">
          {kind === "player"
            ? players.map((player) => {
                const rowKey = `p:${player.playerId}`;
                return (
                  <li key={player.playerId}>
                    <PickerRow
                      added={added.has(rowKey)}
                      atCap={atCap}
                      name={player.name}
                      sideWords={sideWords}
                      onToggle={() =>
                        toggle(rowKey, player.name, () => ({
                          kind: "player",
                          playerId: player.playerId,
                        }))
                      }
                    >
                      <span className="block text-sm font-bold text-ink">{player.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {[player.position, player.team].filter(Boolean).join(", ")}
                        {". "}
                        {fmtValue(player.value)}
                        {player.projPoints !== null
                          ? `, ${player.projPoints.toFixed(1)} pts/wk`
                          : ""}
                      </span>
                    </PickerRow>
                  </li>
                );
              })
            : picks.map((pick) => {
                const rowKey = pickKey(pick);
                return (
                  <li key={rowKey}>
                    <PickerRow
                      added={added.has(rowKey)}
                      atCap={atCap}
                      name={pick.label}
                      sideWords={sideWords}
                      onToggle={() =>
                        toggle(rowKey, pick.label, () => ({
                          kind: "pick",
                          season: pick.season,
                          round: pick.round,
                          pickPosition: pick.pickPosition,
                          originalRosterId: pick.originalRosterId,
                        }))
                      }
                    >
                      <PickTag pick={pick} estimated={pick.positionEstimated} />
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {fmtValue(pick.value)}
                      </span>
                    </PickerRow>
                  </li>
                );
              })}
        </ul>
      )}

      {kind === "pick" && shown > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
          Early, Mid and Late come from where the pick&apos;s original owner is projected
          to finish, not from who holds it: a team near the bottom of the standings sends
          an early pick and a contender sends a late one. Where a league has already
          published its draft order we use that instead.
        </p>
      )}
    </SidePanel>
  );
}

/**
 * One row in the picker: what it is on the left, one press to put it in or take
 * it back out on the right.
 *
 * THE ROW SAYS IT IS IN, THREE WAYS
 *   A cyan border and wash on the whole card, a check on the button, and the
 *   word Remove where Add was. Colour is never the only signal, so the state
 *   survives with no colour perception at all, and the button's accessible name
 *   spells it out for a reader who sees neither.
 *
 *   The name is the whole instruction rather than "Add" or "Remove". A screen
 *   reader user pulling up the button list of an open panel would otherwise find
 *   thirty of them with the same name and no way to tell which is which.
 *
 * WHY THE BUTTON IS NOT aria-pressed
 *   A toggle button announces "pressed" and leaves the reader to work out what
 *   pressed means. The label changing from "Add X to what you send" to "Remove X
 *   from what you send" says the state and the next action in the same breath,
 *   which is the thing a toggle state cannot do on its own.
 */
function PickerRow({
  added,
  atCap,
  name,
  sideWords,
  onToggle,
  children,
}: {
  added: boolean;
  atCap: boolean;
  /** Plain name of the asset, for the button's accessible name. */
  name: string;
  sideWords: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  // The cap stops you adding a tenth thing. It has no business stopping you
  // taking one back out, which is how you get under the cap in the first place.
  const disabled = atCap && !added;
  return (
    <div
      className={`flex items-center gap-3 rounded-card border p-2.5 transition-colors ${
        added
          ? "border-brand-cyan/60 bg-brand-cyan/10 shadow-[0_0_20px_-10px_rgba(34,211,238,0.9)]"
          : "border-line bg-surface"
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-label={
          added
            ? `Remove ${name} from what you ${sideWords}`
            : disabled
              ? `Add ${name} to what you ${sideWords}. That side is full, so remove something first.`
              : `Add ${name} to what you ${sideWords}`
        }
        className={`inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-card border px-3 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:border-dashed disabled:border-line disabled:bg-transparent disabled:text-ink-subtle ${
          added
            ? "border-brand-cyan/70 bg-brand-cyan/20 text-brand-cyan hover:border-signal-danger/70 hover:bg-signal-danger/10 hover:text-signal-danger"
            : "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20"
        }`}
      >
        {added ? (
          <Check aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Plus aria-hidden="true" className="h-4 w-4" />
        )}
        <span aria-hidden="true">{added ? "Remove" : "Add"}</span>
      </button>
    </div>
  );
}
