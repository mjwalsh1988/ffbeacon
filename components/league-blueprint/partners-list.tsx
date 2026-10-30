/**
 * Ideal trade partners (plan 9.13, 6.11): two ruled entries, the team, the
 * handle, the status and one sentence naming why, each linking to the
 * builder with that team on the other side. The first carries the one beacon
 * top bar the design allows here.
 */

import Link from "next/link";
import type { Route } from "next";
import { withUsername } from "@/components/league-schedule/format";
import { NO_PARTNERS } from "@/lib/league-blueprint/partners";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { LINK } from "./bits";

export function PartnersList({ view, linkUsername }: { view: BlueprintView; linkUsername: string | null }) {
  if (view.partners.length === 0) return <p className="mt-2 text-sm text-ink-muted">{NO_PARTNERS}</p>;
  return (
    <ul role="list" className="mt-2 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {view.partners.map((p, i) => {
        const qs = new URLSearchParams({ mode: "build", with: String(p.rosterId), roster: String(view.rosterId) });
        if (view.header.sourceSlug) qs.set("source", view.header.sourceSlug);
        const href = withUsername(`/leagues/${view.sleeperLeagueId}/trade-ideas?${qs.toString()}`, linkUsername);
        return (
          <li key={p.rosterId} className={`border-t-2 pt-3 ${i === 0 ? "border-brand-cyan/60" : "border-line"}`}>
            <p className="text-sm font-semibold text-ink">
              <span className="mr-2 font-mono text-xs text-ink-subtle">{i + 1}.</span>
              {p.teamName}
            </p>
            <p className="text-xs text-ink-muted">
              {[
                p.ownerHandle && !p.teamName.includes(`@${p.ownerHandle}`) ? `@${p.ownerHandle}` : null,
                p.statusLabel,
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.reason}</p>
            <Link href={href as Route} className={LINK}>
              Build a trade<span className="sr-only"> with {p.teamName}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
