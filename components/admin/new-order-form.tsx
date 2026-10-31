"use client";

/**
 * A complimentary order for a customer: paid and queued the moment it is created.
 * The league must already have been opened in League Pulse, because nothing here
 * syncs one.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  createComplimentaryOrderAction,
  loadLeagueTeamsAction,
  searchCustomersAction,
  type CustomerMatch,
  type LeagueTeams,
} from "@/app/admin/orders/actions";
import { RosterSelect } from "@/components/league-lineups/roster-select";
import { formatMoney } from "@/lib/commerce/constants";
import { ADMIN_BUTTON, ADMIN_FIELD, ADMIN_LABEL, ADMIN_PRIMARY } from "./order-action";

type ProductChoice = { slug: string; name: string; family: string; price_cents: number };

export function NewOrderForm({ products }: { products: ProductChoice[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[] | null>(null);
  const [userId, setUserId] = useState("");
  const [slug, setSlug] = useState(products[0]?.slug ?? "");
  const [leagueId, setLeagueId] = useState("");
  const [league, setLeague] = useState<Extract<LeagueTeams, { ok: true }> | null>(null);
  const [leagueError, setLeagueError] = useState("");
  const [rosterId, setRosterId] = useState<number | null>(null);
  const [customerNote, setCustomerNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const find = () => {
    startTransition(async () => {
      setMatches(await searchCustomersAction(query));
      setUserId("");
    });
  };

  const loadTeams = () => {
    setLeagueError("");
    startTransition(async () => {
      const result = await loadLeagueTeamsAction(leagueId.trim(), userId);
      if (result.ok) {
        setLeague(result);
        setRosterId(result.matchedRosterId ?? result.teams[0]?.sleeperRosterId ?? null);
      } else {
        setLeague(null);
        setRosterId(null);
        setLeagueError(result.error);
      }
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createComplimentaryOrderAction({
        userId,
        productSlug: slug,
        sleeperLeagueId: leagueId.trim(),
        rosterId,
        customerNote,
        internalNote,
      });
      if (result.ok) router.push(`/admin/orders/${result.orderId}` as Route);
      else setError(result.error);
    });
  };

  return (
    <form onSubmit={submit} className="mt-6 max-w-2xl space-y-6">
      <fieldset className="min-w-0">
        <legend className="text-sm font-bold text-ink">Customer</legend>
        <label htmlFor="customer-email" className={`${ADMIN_LABEL} mt-2`}>
          Customer email
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id="customer-email"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`${ADMIN_FIELD} mt-0 min-h-11 min-w-0 flex-1`}
          />
          <button type="button" onClick={find} disabled={pending || query.trim().length < 2} className={ADMIN_BUTTON}>
            Find
          </button>
        </div>
        <div role="status" className="mt-2">
          {matches?.length === 0 && (
            <p className="text-sm text-ink-muted">No account has an email containing that.</p>
          )}
        </div>
        {matches && matches.length > 0 && (
          <div role="radiogroup" aria-label="Matching accounts" className="mt-1 grid gap-2">
            {matches.map((match) => (
              <label
                key={match.userId}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-line bg-surface/60 p-3 has-[:checked]:border-brand-cyan has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan"
              >
                <input
                  type="radio"
                  name="customer"
                  value={match.userId}
                  checked={userId === match.userId}
                  onChange={() => setUserId(match.userId)}
                  className="h-4 w-4 shrink-0 accent-brand-cyan"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{match.displayName}</span>
                  <span className="block break-all text-xs text-ink-muted">{match.email}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <label htmlFor="new-order-product" className={ADMIN_LABEL}>
          Product
        </label>
        <select
          id="new-order-product"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className={`${ADMIN_FIELD} min-h-11`}
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}, {formatMoney(p.price_cents)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="new-order-league" className={ADMIN_LABEL}>
          Sleeper league id
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id="new-order-league"
            type="text"
            inputMode="numeric"
            value={leagueId}
            onChange={(event) => setLeagueId(event.target.value)}
            className={`${ADMIN_FIELD} mt-0 min-h-11 min-w-0 flex-1 font-mono`}
          />
          <button type="button" onClick={loadTeams} disabled={pending || !leagueId.trim()} className={ADMIN_BUTTON}>
            Load teams
          </button>
        </div>
        <p role={leagueError ? "alert" : "status"} className="mt-1 text-sm text-ink-muted">
          {leagueError || (league ? `${league.leagueName}: ${league.teams.length} teams` : "")}
        </p>
      </div>

      {league && rosterId != null && (
        <div>
          <RosterSelect
            id="new-order-team"
            rosterId={rosterId}
            teams={league.teams}
            onChange={setRosterId}
            visibleLabel
          />
        </div>
      )}

      <div>
        <label htmlFor="new-order-customer-note" className={ADMIN_LABEL}>
          Note to the customer, optional
        </label>
        <textarea
          id="new-order-customer-note"
          rows={3}
          maxLength={1000}
          value={customerNote}
          onChange={(event) => setCustomerNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>

      <div>
        <label htmlFor="new-order-internal-note" className={ADMIN_LABEL}>
          Internal note, optional
        </label>
        <textarea
          id="new-order-internal-note"
          rows={3}
          maxLength={5000}
          value={internalNote}
          onChange={(event) => setInternalNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-signal-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !userId || rosterId == null}
        className={`${ADMIN_PRIMARY} w-full sm:w-auto`}
      >
        {pending ? "Working..." : "Create the complimentary order"}
      </button>
    </form>
  );
}
