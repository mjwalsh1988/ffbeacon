"use client";

import { useId, useMemo, useState } from "react";

export type FaabPlayer = {
  slug: string;
  name: string;
  position: string;
  team: string | null;
  overall_rank: number;
  value: number | null;
};

type NeedLevel = "low" | "medium" | "high";

const NEED_MULTIPLIER: Record<NeedLevel, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.5,
};

const NEED_LABEL: Record<NeedLevel, string> = {
  low: "Bench depth (low need)",
  medium: "Streamer / FLEX (medium need)",
  high: "Starter you need now (high need)",
};

export function FaabForm({
  players,
  formatName,
}: {
  players: FaabPlayer[];
  formatName: string;
}) {
  const datalistId = useId();
  const [playerInput, setPlayerInput] = useState("");
  const [budget, setBudget] = useState(100);
  const [need, setNeed] = useState<NeedLevel>("medium");

  const selectedPlayer = useMemo(() => {
    const exact = players.find((p) => p.name.toLowerCase() === playerInput.toLowerCase());
    return exact ?? null;
  }, [playerInput, players]);

  const recommendation = useMemo(() => {
    if (!selectedPlayer) return null;
    const value = selectedPlayer.value;
    const rank = selectedPlayer.overall_rank;
    // Base percentage of remaining budget based on rank tier
    let basePct = 0;
    if (rank <= 24) basePct = 0.4;
    else if (rank <= 48) basePct = 0.25;
    else if (rank <= 96) basePct = 0.12;
    else if (rank <= 150) basePct = 0.05;
    else basePct = 0.02;

    // Adjust by market value relative to top
    const valueAdj = value && value > 0 ? Math.min(1.4, value / 6500) : 1;
    const needMult = NEED_MULTIPLIER[need];

    const center = budget * basePct * valueAdj * needMult;
    const low = Math.max(1, Math.floor(center * 0.7));
    const high = Math.max(low + 1, Math.ceil(center * 1.3));

    return {
      low,
      high,
      reasoning: [
        `${selectedPlayer.name} is ranked #${rank} for ${formatName}.`,
        value ? `Market value ${value.toLocaleString()}.` : null,
        `${NEED_LABEL[need]}.`,
        `Budget remaining ${budget} FAAB.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }, [selectedPlayer, budget, need, formatName]);

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="space-y-6 rounded-card border border-line bg-surface p-6"
      aria-labelledby="faab-form-heading"
    >
      <h2 id="faab-form-heading" className="sr-only">
        FAAB calculator inputs
      </h2>
      <div>
        <label htmlFor="faab-player" className="block text-sm font-medium">
          Player
        </label>
        <input
          id="faab-player"
          list={datalistId}
          autoComplete="off"
          value={playerInput}
          onChange={(event) => setPlayerInput(event.target.value)}
          placeholder="Start typing a player name"
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
          aria-describedby="faab-player-help"
        />
        <datalist id={datalistId}>
          {players.map((p) => (
            <option key={p.slug} value={p.name}>
              {p.position} {p.team ? `• ${p.team}` : ""} • #{p.overall_rank}
            </option>
          ))}
        </datalist>
        <p id="faab-player-help" className="mt-1 text-xs text-ink-subtle">
          Pull from the top 300 ranked players. {formatName} format.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="faab-budget" className="block text-sm font-medium">
            FAAB budget remaining
          </label>
          <input
            id="faab-budget"
            type="number"
            min={1}
            max={1000}
            value={budget}
            onChange={(event) => setBudget(Number.parseInt(event.target.value || "0", 10))}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
          />
        </div>
        <fieldset>
          <legend className="block text-sm font-medium">Roster need</legend>
          <div className="mt-2 flex flex-col gap-1 text-sm">
            {(["low", "medium", "high"] as NeedLevel[]).map((level) => (
              <label key={level} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="need"
                  value={level}
                  checked={need === level}
                  onChange={() => setNeed(level)}
                />
                <span>{NEED_LABEL[level]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div aria-live="polite" className="rounded-card border border-line bg-base p-4">
        {!selectedPlayer ? (
          <p className="text-sm text-ink-muted">
            Pick a player to see a recommended bid range.
          </p>
        ) : recommendation ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm uppercase tracking-wide text-ink-subtle">Recommended bid</p>
            <p className="font-mono text-3xl font-semibold text-ink">
              {recommendation.low} – {recommendation.high} FAAB
            </p>
            <p className="text-sm text-ink-muted">{recommendation.reasoning}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            We could not compute a bid for that player. Make sure the name matches an option in the
            suggestion list.
          </p>
        )}
      </div>
    </form>
  );
}
