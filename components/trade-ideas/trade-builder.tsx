"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Plus, Scale, X } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { PlayerPicker, type PlayerOption } from "@/components/player-picker";
import { SlideUpDialog } from "@/components/slide-up-dialog";
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

/** One tradeable pick, already labelled and priced by lib/trade-finder-data.ts. */
export type BuilderPick = {
  season: number;
  round: number;
  pickPosition: PickSlot;
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

function assetKey(asset: BuildAsset): string {
  return asset.kind === "player"
    ? `p:${asset.playerId}`
    : `k:${asset.season}-${asset.round}-${asset.pickPosition}`;
}

function pickKey(pick: {
  season: number;
  round: number;
  pickPosition: PickSlot;
}): string {
  return `k:${pick.season}-${pick.round}-${pick.pickPosition}`;
}

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** A player option as the picker wants it: name, position, team, grouped by team. */
function toOption(player: BuilderPlayer, teamName: string): PlayerOption {
  return {
    playerId: player.playerId,
    label: `${player.name} (${player.position}${player.team ? `, ${player.team}` : ""})`,
    group: teamName,
  };
}

export function TradeBuilder({
  sleeperLeagueId,
  searchedUsername,
  source,
  myRosterId,
  teams,
  isDynasty,
  allowPicks,
  initialProposal,
}: {
  sleeperLeagueId: string;
  searchedUsername: string | null;
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
  const [pickerValue, setPickerValue] = useState("");
  const [announcement, setAnnouncement] = useState("");

  // Stable identity on purpose. An inline arrow here changes on every keystroke
  // in the picker, and SlideUpDialog treats a new handler as a new dialog: it
  // would hand focus back to the button behind the modal and then pull it to
  // the close button. SlideUpDialog now holds the handler in a ref so this
  // cannot happen, but a memoized handler is the right shape regardless.
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
      // Matched on season and round only, the same way
      // lib/trade-impact/evaluate.ts matches a proposed pick against a roster:
      // the slot bucket is our own estimate rather than the league's fact, so
      // requiring it to agree would reject a real pick over a label we chose.
      return (
        team.picks.find((p) => p.season === asset.season && p.round === asset.round) ??
        null
      );
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
        searchedUsername,
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
      helper="Put anything you like on either side. It is graded exactly like a suggestion."
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
        <SidePanel
          side="out"
          heading="You send"
          teamName={myTeam.teamName}
          assets={outgoing}
          resolvePlayer={resolvePlayer}
          resolvePick={resolvePick}
          total={valueOut}
          canAddPicks={canAddPicks && myTeam.picks.length > 0}
          onAdd={(kind) => {
            setPickerValue("");
            setPicker({ side: "out", kind });
          }}
          onRemove={removeAsset}
          idPrefix={`${baseId}-out`}
        />

        <SidePanel
          side="in"
          heading="You receive"
          teamName={theirTeam?.teamName ?? ""}
          assets={incoming}
          resolvePlayer={resolvePlayer}
          resolvePick={resolvePick}
          total={valueIn}
          canAddPicks={canAddPicks && (theirTeam?.picks.length ?? 0) > 0}
          onAdd={(kind) => {
            setPickerValue("");
            setPicker({ side: "in", kind });
          }}
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
                {otherTeams.map((team) => (
                  <option key={team.rosterId} value={team.rosterId}>
                    {team.teamName}
                    {team.ownerHandle && team.ownerHandle !== team.teamName
                      ? ` (${team.ownerHandle})`
                      : ""}
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
            The result gets its own address, so you can send it to whoever you are trading
            with.
          </p>
        )}
      </div>

      {picker && (
        <AddDialog
          side={picker.side}
          kind={picker.kind}
          team={teamOf(picker.side)}
          usedKeys={usedKeys}
          value={pickerValue}
          onValueChange={setPickerValue}
          onClose={closePicker}
          onAdd={(asset, label) => {
            addAsset(picker.side, asset, label);
            setPicker(null);
          }}
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
 */
function SidePanel({
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
            Add pick
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
    return (
      <div className={shell}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{found.label}</span>
          <span className="block text-xs text-ink-muted">
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
 * Picking one asset out of a roster.
 *
 * WHY A DIALOG AT EVERY WIDTH
 *   The picker is a filter over several hundred names. Inline, it would push the
 *   other side of the deal off the screen on a phone and leave a tall empty
 *   column on a desktop. In a dialog it is one interaction to learn, it works
 *   the same on both, and SlideUpDialog already handles the focus trap, the
 *   Escape key, and returning focus to the button that opened it.
 *
 * WHY THERE IS A SEPARATE ADD BUTTON
 *   Committing on the select's change event would be fewer clicks and would also
 *   fire while a keyboard user arrows through the list, closing the dialog on
 *   whichever name they happened to pass. The select changes a pending choice;
 *   the button is what puts it in the deal.
 */
function AddDialog({
  side,
  kind,
  team,
  usedKeys,
  value,
  onValueChange,
  onClose,
  onAdd,
}: {
  side: Side;
  kind: PickerKind;
  team: BuilderTeam | null;
  usedKeys: Set<string>;
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onAdd: (asset: BuildAsset, label: string) => void;
}) {
  const baseId = useId();
  const sideWords = side === "in" ? "receive" : "send";
  const title =
    kind === "player"
      ? `Add a player to what you ${sideWords}`
      : `Add a pick to what you ${sideWords}`;
  const chooseNoteId = `${baseId}-choose`;

  const options = useMemo(() => {
    if (!team || kind !== "player") return [];
    return team.players
      .filter((p) => !usedKeys.has(`p:${p.playerId}`))
      .map((p) => toOption(p, team.teamName))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [kind, team, usedKeys]);

  const picks = useMemo(() => {
    if (!team || kind !== "pick") return [];
    return team.picks.filter((p) => !usedKeys.has(pickKey(p)));
  }, [kind, team, usedKeys]);

  // Nothing to pick from is a different state to nothing picked yet, and only
  // the second one is the reader's to fix. The empty-roster message above
  // already covers the first, so the note below stays off for it.
  const hasChoices = kind === "player" ? options.length > 0 : picks.length > 0;
  const nothingChosen = hasChoices && !value;
  const chooseNote =
    kind === "player" ? "Choose a player first." : "Choose a pick first.";

  const commit = useCallback(() => {
    if (!team || !value) return;
    if (kind === "player") {
      const player = team.players.find((p) => p.playerId === value);
      if (!player) return;
      onAdd({ kind: "player", playerId: player.playerId }, player.name);
      return;
    }
    const pick = picks.find((p) => pickKey(p) === value);
    if (!pick) return;
    onAdd(
      {
        kind: "pick",
        season: pick.season,
        round: pick.round,
        pickPosition: pick.pickPosition,
      },
      pick.label,
    );
  }, [kind, onAdd, picks, team, value]);

  return (
    <SlideUpDialog open onClose={onClose} label={title} closeLabel="Close without adding">
      <div className="px-4 pb-4 sm:px-5">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 text-xs text-ink-muted">{team?.teamName ?? "This team"}</p>

        <div className="mt-4">
          {kind === "player" ? (
            options.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Every player we can price on that roster is already in the deal.
              </p>
            ) : (
              <PlayerPicker
                filterLabel="Find a player"
                label="Player to add"
                hint="Only players we hold a value for appear here."
                options={options}
                value={value}
                onChange={onValueChange}
                anyLabel="Nobody chosen yet"
              />
            )
          ) : picks.length === 0 ? (
            <p className="text-sm text-ink-muted">
              That team has no tradeable picks left to add.
            </p>
          ) : (
            <>
              <label
                htmlFor={`${baseId}-pick`}
                className="block text-sm font-semibold text-ink"
              >
                Pick to add
              </label>
              <p id={`${baseId}-pick-hint`} className="mt-0.5 text-xs text-ink-muted">
                Values come from the draft pick source named in the rail.
              </p>
              <select
                id={`${baseId}-pick`}
                aria-describedby={`${baseId}-pick-hint`}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-card border border-ink-subtle bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <option value="">No pick chosen yet</option>
                {picks.map((pick) => (
                  <option key={pickKey(pick)} value={pickKey(pick)}>
                    {pick.label}, value {fmtValue(pick.value)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!value}
            aria-describedby={nothingChosen ? chooseNoteId : undefined}
            onClick={commit}
            className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add to the deal
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-card border border-line px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Cancel
          </button>
        </div>
        {/* Why the confirm button is greyed out, as a real paragraph. Same
            reason the asset cap states itself in the panel body: a disabled
            button is out of the tab order, so somebody tabbing Close, filter,
            select, Cancel never reaches the description hung off it and never
            learns the button is there at all. */}
        {nothingChosen && (
          <p id={chooseNoteId} className="mt-2 text-xs text-ink-muted">
            {chooseNote}
          </p>
        )}
      </div>
    </SlideUpDialog>
  );
}
