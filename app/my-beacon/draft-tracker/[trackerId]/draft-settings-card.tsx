"use client";

/**
 * The answers from the wizard, settled, at the top of the board.
 *
 * Once the setup questions are answered they stop being questions: they become
 * four facts about this draft that the reader can glance at and stop thinking
 * about. This card is where they live, so the board underneath is only ever the
 * list and the buttons.
 *
 * ORDER IS THE ONE THAT STAYS LIVE. Rules, tracking and the room are decided
 * before the first pick and cannot change afterwards without invalidating the
 * picks already recorded. Ordering is a view of the same list, so it stays
 * editable, and it sits here with the other three rather than floating above the
 * table: the reader looks for "how is this sorted" among the draft's settings,
 * not among its controls.
 *
 * Reading and changing are separate states on purpose. The row reads as a fact
 * until the reader asks to change it, which keeps three buttons out of the
 * card for the ninety percent of drafts that never re-sort.
 */

import { useId, useState } from "react";
import { Pencil, Tag } from "lucide-react";
import { DRAFT_ORDERS, orderHelp, orderLabel } from "@/lib/draft-tracker/order";
import type { DraftOrder, TrackingMode } from "@/lib/draft-tracker/types";
import { TRACKING_TITLE } from "@/lib/draft-tracker/wizard";

export function DraftSettingsCard({
  formatLabel,
  sourceLabel,
  orderBy,
  trackingMode,
  teamCount,
  myTeamLabel,
  onChangeOrder,
  onNameTeams,
}: {
  formatLabel: string;
  sourceLabel: string;
  orderBy: DraftOrder;
  trackingMode: TrackingMode;
  teamCount: number;
  myTeamLabel: string;
  onChangeOrder: (order: DraftOrder) => void;
  /** Only passed when the reader is tracking the whole room. */
  onNameTeams?: () => void;
}) {
  const orderGroupId = useId();
  const [editingOrder, setEditingOrder] = useState(false);

  return (
    <div className="rounded-card border border-line bg-base/40 p-3">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label="Rules" value={formatLabel} hint={`Values from ${sourceLabel}`} />
        <Fact
          label="Tracking"
          value={TRACKING_TITLE[trackingMode]}
          hint={
            trackingMode === "all"
              ? `${teamCount} teams, you are ${myTeamLabel}`
              : `${teamCount} teams, yours is the only roster kept`
          }
        />

        {/* Order: a fact, with a way in. */}
        <div className="rounded-card border border-line bg-surface/40 px-3 py-2 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Order
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-brand-cyan">
                {orderLabel(orderBy, sourceLabel)}
              </dd>
            </div>
            <button
              type="button"
              onClick={() => setEditingOrder((open) => !open)}
              aria-expanded={editingOrder}
              aria-controls={orderGroupId}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line px-3 text-xs font-semibold text-ink-muted transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              Change order
            </button>
          </div>

          <div id={orderGroupId} hidden={!editingOrder}>
            <fieldset className="mt-3 border-t border-line pt-3">
              <legend className="sr-only">Order the board by</legend>
              <div className="flex flex-wrap gap-2">
                {DRAFT_ORDERS.map((value) => {
                  const active = orderBy === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeOrder(value)}
                      className={`min-h-11 rounded-card border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                        active
                          ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                          : "border-line bg-base text-ink-muted hover:text-ink"
                      }`}
                    >
                      {orderLabel(value, sourceLabel)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                {orderHelp(orderBy, sourceLabel)} Changing it loses no picks.
              </p>
            </fieldset>
          </div>
        </div>
      </dl>

      {onNameTeams && (
        <button
          type="button"
          onClick={onNameTeams}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Tag aria-hidden="true" className="h-4 w-4" />
          Name the teams
        </button>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface/40 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">
        {value}
        <span className="mt-0.5 block text-[11px] font-normal leading-tight text-ink-muted">
          {hint}
        </span>
      </dd>
    </div>
  );
}
