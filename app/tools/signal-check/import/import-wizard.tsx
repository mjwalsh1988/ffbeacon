"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";
import { ResultPanel } from "../signal-check-builder";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import {
  listLeagueTrades,
  importAndAnalyze,
  type ImportLeague,
  type ImportTrade,
} from "./actions";

export function ImportWizard({
  initialLeagues,
}: {
  initialLeagues: ImportLeague[];
}) {
  const [leagueId, setLeagueId] = useState("");
  const [trades, setTrades] = useState<ImportTrade[]>([]);
  const [tradeId, setTradeId] = useState("");
  const [view, setView] = useState<BuilderView | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [loadingTrades, startLoadTrades] = useTransition();
  const [analyzing, startAnalyze] = useTransition();

  function onPickLeague(id: string) {
    setLeagueId(id);
    setTrades([]);
    setTradeId("");
    setView(null);
    setShareUrl(null);
    setError(null);
    if (!id) return;
    startLoadTrades(async () => {
      const res = await listLeagueTrades(id);
      if (res.ok) {
        setTrades(res.trades);
        setStatus(`${res.trades.length} completed ${res.trades.length === 1 ? "trade" : "trades"} found.`);
      } else {
        setError(res.error);
      }
    });
  }

  function analyze(makePublic: boolean) {
    if (!leagueId || !tradeId) return;
    setError(null);
    startAnalyze(async () => {
      const res = await importAndAnalyze({
        sleeperLeagueId: leagueId,
        sleeperTransactionId: tradeId,
        makePublic,
      });
      if (res.ok) {
        setView(res.view);
        setEvidence(res.evidence);
        setNotices(res.notices);
        if (makePublic) setShareUrl(res.shareUrl);
        setStatus("Analysis ready.");
      } else {
        setError(res.error);
        setView(null);
      }
    });
  }

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback: input is selectable */
    }
  }

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      <div>
        <label htmlFor="imp-league" className="block text-sm font-medium text-ink">
          League
        </label>
        <select
          id="imp-league"
          value={leagueId}
          onChange={(e) => onPickLeague(e.target.value)}
          className="mt-2 min-h-11 w-full max-w-md rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <option value="">Select a league</option>
          {initialLeagues.map((l) => (
            <option key={l.sleeperLeagueId} value={l.sleeperLeagueId}>
              {l.name} ({l.season})
            </option>
          ))}
        </select>
      </div>

      {leagueId && (
        <div>
          <label htmlFor="imp-trade" className="block text-sm font-medium text-ink">
            Completed trade
          </label>
          <select
            id="imp-trade"
            value={tradeId}
            onChange={(e) => {
              setTradeId(e.target.value);
              setView(null);
              setShareUrl(null);
            }}
            disabled={loadingTrades || trades.length === 0}
            className="mt-2 min-h-11 w-full max-w-md rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <option value="">
              {loadingTrades ? "Loading trades..." : trades.length === 0 ? "No completed trades found" : "Select a trade"}
            </option>
            {trades.map((t) => (
              <option key={t.sleeperTransactionId} value={t.sleeperTransactionId}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => analyze(false)}
          disabled={analyzing || !tradeId}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Scale aria-hidden="true" className="h-4 w-4" />
          {analyzing ? "Analyzing..." : "Analyze trade"}
        </button>
        {view && (
          <button
            type="button"
            onClick={() => analyze(true)}
            disabled={analyzing}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Create share link
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
          {error}
        </p>
      )}

      {notices.length > 0 && (
        <ul role="list" className="space-y-1 text-sm text-ink-muted">
          {notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <div aria-live="polite">
        {view && (
          <div className="space-y-5">
            <ResultPanel view={view} shareUrl={shareUrl} copied={copied} onCopy={copyShare} />
            {evidence.length > 0 && (
              <details className="rounded-card border border-line bg-surface/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  Format detection details
                </summary>
                <ul role="list" className="mt-2 space-y-1 text-sm text-ink-muted">
                  {evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-ink-subtle">
        Imported league and team details stay private. They are only shared if you create a public
        link, and even then only the trade summary is shown.
      </p>
    </div>
  );
}

export function NeedsUsername({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-surface/40 p-6">
      <p className="text-sm text-ink-muted">{message}</p>
      <Link
        href="/my-beacon/sleeper-leagues"
        className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Save your Sleeper username
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
