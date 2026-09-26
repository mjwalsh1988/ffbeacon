"use client";

/**
 * Beacon Ranker's setup (plan sections 5.1 and 13.2): Start, Players, Depth,
 * Build, one step at a time under a step rail.
 *
 * THE SOURCE AND FORMAT HERE ARE BOARD-LOCAL. A choice is written to the board
 * and never to the reader's cookie, user_preferences or the URL: picking KTC to
 * seed one board must not switch the whole site to KTC. The gating rules match
 * the header's: the Format list hides formats the source does not rank, and a
 * source that would change the format says so BEFORE it is picked, in visible
 * words, in its accessible name, and in a tooltip wired by aria-describedby.
 *
 * Focus moves to each step's heading as the step changes, so a screen reader
 * hears where it is rather than landing in silence.
 */

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, Clock, Pencil, Play } from "lucide-react";
import { PositionChip } from "@/components/position-chip";
import { pickFallbackFormat } from "@/lib/format-fallback";
import {
  BOARD_SCOPES,
  isSinglePositionScope,
  scopeDescription,
  scopeLabel,
  type BoardScope,
} from "@/lib/ranking-boards";
import { IDP_POSITIONS, positionHeading } from "@/lib/site";
import type { RunPayload } from "@/lib/ranking-boards/run-payload";
import { startRunAction } from "./actions";
import type { WizardBoard, WizardFormat, WizardLimits, WizardSource } from "./types";

const STEPS = [
  { n: 1, label: "Start", hint: "Rankings to start from" },
  { n: 2, label: "Players", hint: "Who you rank" },
  { n: 3, label: "Depth", hint: "How many" },
  { n: 4, label: "Build", hint: "Answer two at a time" },
] as const;

type Step = 1 | 2 | 3 | 4;

function supports(source: WizardSource | undefined, formatSlug: string): boolean {
  if (!source) return false;
  return source.supportedFormatSlugs === null || source.supportedFormatSlugs.includes(formatSlug);
}

const buttonPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";
const buttonQuiet =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function Wizard({
  signedIn,
  formats,
  sources,
  defaultSourceSlug,
  defaultFormatSlug,
  limits,
  boards,
  presetBoardId,
  hasGuestBoard,
  onStarted,
}: {
  signedIn: boolean;
  formats: WizardFormat[];
  sources: WizardSource[];
  defaultSourceSlug: string | null;
  defaultFormatSlug: string;
  limits: WizardLimits;
  boards: WizardBoard[];
  /** A board picked before the page opened (the editor's Build by comparing). */
  presetBoardId: string | null;
  /** A guest already holding a board is told a new run replaces it. */
  hasGuestBoard: boolean;
  onStarted: (payload: RunPayload) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  // ---- Step 1: what, and from which rankings.
  const presetBoard = boards.find((b) => b.id === presetBoardId) ?? null;
  const [target, setTarget] = useState<"new" | "board">(presetBoard ? "board" : "new");
  const [boardId, setBoardId] = useState<string>(presetBoard?.id ?? boards[0]?.id ?? "");
  const board = target === "board" ? boards.find((b) => b.id === boardId) ?? null : null;

  const initialSource =
    sources.find((s) => s.slug === defaultSourceSlug)?.slug ?? sources[0]?.slug ?? "";
  const [sourceSlug, setSourceSlug] = useState(initialSource);
  const [formatSlug, setFormatSlug] = useState(() => {
    const src = sources.find((s) => s.slug === initialSource);
    if (supports(src, defaultFormatSlug)) return defaultFormatSlug;
    return (
      pickFallbackFormat(formats, defaultFormatSlug, src?.supportedFormatSlugs ?? null)?.slug ??
      formats[0]?.slug ??
      defaultFormatSlug
    );
  });
  const [changing, setChanging] = useState(false);
  const [formatNote, setFormatNote] = useState("");

  // A saved board that already means a format keeps it (decision 5).
  const lockedFormat = board?.formatSlug ?? null;
  const effectiveFormat = lockedFormat ?? formatSlug;
  const source = sources.find((s) => s.slug === sourceSlug);
  const formatName = (slug: string) => formats.find((f) => f.slug === slug)?.display_name ?? slug;

  const chooseSource = (slug: string) => {
    setSourceSlug(slug);
    const next = sources.find((s) => s.slug === slug);
    if (!lockedFormat && !supports(next, formatSlug)) {
      const fallback = pickFallbackFormat(formats, formatSlug, next?.supportedFormatSlugs ?? null);
      if (fallback) {
        setFormatSlug(fallback.slug);
        setFormatNote(
          `${next?.displayName ?? slug} does not rank ${formatName(formatSlug)}, so the format changed to ${fallback.display_name}.`,
        );
        return;
      }
    }
    setFormatNote("");
  };

  // ---- Step 2: who.
  const [scope, setScope] = useState<BoardScope>(presetBoard?.scope ?? "overall");
  const [includesDefenders, setIncludesDefenders] = useState(presetBoard?.includesDefenders ?? false);
  const effectiveScope = board?.scope ?? scope;
  const effectiveDefenders = board ? board.includesDefenders : scope === "overall" && includesDefenders;

  // ---- Step 3: how deep.
  const single = isSinglePositionScope(effectiveScope);
  const cap = signedIn ? null : single ? limits.capSingle : limits.capMulti;
  const defaultDepth = single ? limits.defaultDepthSingle : limits.defaultDepthMulti;
  const [depthChoice, setDepthChoice] = useState<number | "more">(defaultDepth);
  const [moreDepth, setMoreDepth] = useState(String(defaultDepth + 50));
  useEffect(() => {
    setDepthChoice(defaultDepth);
  }, [defaultDepth]);
  const depth =
    cap ??
    (depthChoice === "more"
      ? Math.min(Math.max(1, Math.trunc(Number(moreDepth)) || defaultDepth), limits.maxDepth)
      : depthChoice);
  const [startFrom, setStartFrom] = useState<"top" | "rank">("top");
  const [startRank, setStartRank] = useState("1");

  // ---- Step 4: build.
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await startRunAction({
        mode: board ? "board" : "new",
        boardId: board?.id,
        scope: effectiveScope,
        includesDefenders: effectiveDefenders,
        formatSlug: effectiveFormat,
        sourceSlug: sourceSlug || null,
        depth,
        startRank: startFrom === "rank" ? Math.trunc(Number(startRank)) || 1 : 1,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onStarted(result.payload);
    });
  };

  const depthOptions = useMemo(() => {
    const base = single ? [12, 24, 36] : [48, 100, 150];
    return Array.from(new Set([...base, defaultDepth])).sort((a, b) => a - b);
  }, [single, defaultDepth]);

  const headingId = useId();
  const stepTitle = {
    1: "Where do you want to start?",
    2: "Which players are you ranking?",
    3: "How deep should it go?",
    4: "Ready to build",
  }[step];

  return (
    <div className="space-y-6">
      <div>
        <ol aria-label="Setup progress" className="flex flex-wrap items-stretch gap-2 sm:gap-3">
          {STEPS.map((s) => {
            const done = s.n < step;
            const active = s.n === step;
            return (
              <li
                key={s.n}
                aria-current={active ? "step" : undefined}
                className={`flex min-w-[8rem] flex-1 items-center gap-2.5 rounded-card border px-3 py-2 ${
                  active
                    ? "border-brand-cyan/60 bg-brand-cyan/10"
                    : done
                      ? "border-line bg-surface/60"
                      : "border-line bg-base/40"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    active
                      ? "border-brand-cyan bg-brand-cyan/20 text-brand-cyan"
                      : done
                        ? "border-brand-purple/50 bg-brand-purple/15 text-brand-purple"
                        : "border-line text-ink-subtle"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : s.n}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-ink">{s.label}</span>
                  <span className="block truncate text-[11px] text-ink-subtle">{s.hint}</span>
                </span>
                <span className="sr-only">
                  ({done ? "Completed" : active ? "Current step" : "Upcoming"})
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <section
        aria-labelledby={headingId}
        className="relative overflow-hidden rounded-modal border border-line bg-surface p-5 sm:p-6"
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-beacon" />
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold tracking-tight text-ink focus:outline-none"
        >
          <span className="sr-only">Step {step} of 4: </span>
          {stepTitle}
        </h2>

        {step === 1 && (
          <div className="mt-4 space-y-5">
            {signedIn && boards.length > 0 && (
              <fieldset>
                <legend className="text-sm font-medium text-ink">What are you building?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <RadioTile
                    name="ranker-target"
                    checked={target === "new"}
                    onChange={() => setTarget("new")}
                    title="A new board"
                    description="Start fresh from a set of rankings."
                  />
                  <RadioTile
                    name="ranker-target"
                    checked={target === "board"}
                    onChange={() => setTarget("board")}
                    title="One of your saved boards"
                    description="Re-check it by comparing, then bring in new players."
                  />
                </div>
                {target === "board" && (
                  <BoardSelect boards={boards} value={boardId} onChange={setBoardId} />
                )}
              </fieldset>
            )}

            <div className="rounded-card border border-line bg-base/40 p-4">
              <p className="text-sm text-ink">
                Starting from{" "}
                <span className="font-semibold">{source?.displayName ?? "our rankings"}</span>,{" "}
                <span className="font-semibold">{formatName(effectiveFormat)}</span>.
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                This choice belongs to this board only. Your site-wide source and format stay as
                they are.
                {lockedFormat ? " The saved board already has its format." : ""}
              </p>
              {!changing ? (
                <button type="button" onClick={() => setChanging(true)} className={`${buttonQuiet} mt-3`}>
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                  Change
                </button>
              ) : (
                <SourceFormatPickers
                  sources={sources}
                  formats={formats}
                  sourceSlug={sourceSlug}
                  formatSlug={effectiveFormat}
                  lockedFormat={lockedFormat}
                  onSource={chooseSource}
                  onFormat={(slug) => {
                    setFormatSlug(slug);
                    setFormatNote("");
                  }}
                  formatName={formatName}
                />
              )}
              <p aria-live="polite" className="mt-2 text-xs text-signal-warning">
                {formatNote}
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4">
            {board ? (
              <p className="text-sm text-ink-muted">
                {board.name} ranks {scopeDescription(board.scope, board.includesDefenders).replace(/^Ranks /, "").replace(/\.$/, "")}.
                A saved board keeps its players.
              </p>
            ) : (
              <ScopePicker
                scope={scope}
                includesDefenders={includesDefenders}
                onScope={setScope}
                onDefenders={setIncludesDefenders}
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="mt-4 space-y-5">
            {cap !== null ? (
              <p className="text-sm text-ink-muted">
                Guests can rank their top {cap}. Sign up or log in to go deeper, add tiers and share
                your board.
              </p>
            ) : (
              <DepthPicker
                options={depthOptions}
                value={depthChoice}
                more={moreDepth}
                max={limits.maxDepth}
                onValue={setDepthChoice}
                onMore={setMoreDepth}
              />
            )}
            {board && board.playerCount > 0 && (
              <fieldset>
                <legend className="text-sm font-medium text-ink">
                  Your board already has {board.playerCount} players.
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <RadioTile
                    name="ranker-start"
                    checked={startFrom === "top"}
                    onChange={() => setStartFrom("top")}
                    title="Start from the top"
                    description="Every player is re-checked in the current order, then new players come in."
                  />
                  <RadioTile
                    name="ranker-start"
                    checked={startFrom === "rank"}
                    onChange={() => setStartFrom("rank")}
                    title="Start from a rank"
                    description="The players above it stay as they are."
                  />
                </div>
                {startFrom === "rank" && (
                  <NumberField
                    label="Re-check from rank"
                    value={startRank}
                    min={1}
                    max={board.playerCount}
                    onChange={setStartRank}
                    hint={`Ranks 1 to ${Math.max(0, (Math.trunc(Number(startRank)) || 1) - 1)} are kept. A player from lower down can still climb above them.`}
                  />
                )}
              </fieldset>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="mt-4 space-y-4">
            <ul className="space-y-1 text-sm text-ink-muted">
              <li>
                Board: {board ? board.name : `a new ${scopeLabel(effectiveScope, effectiveDefenders)} board`}
              </li>
              <li>
                Starting from {source?.displayName ?? "our rankings"}, {formatName(effectiveFormat)}
              </li>
              <li>
                {scopeDescription(effectiveScope, effectiveDefenders)} Up to {depth} players.
              </li>
            </ul>
            <p className="text-sm text-ink-muted">
              You will be asked about two players at a time. Choose the one you would rather have.
              Press 1 or 2 to choose with the keyboard.
            </p>
            {!signedIn && (
              <p className="flex items-start gap-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 p-3 text-sm text-ink">
                <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-warning" />
                <span>
                  Guest boards are deleted {limits.retentionHours} hours after your last change.
                  Sign in to keep yours.
                  {hasGuestBoard ? " Starting a new run replaces the guest board you have now." : ""}
                </span>
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-signal-danger">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => (s - 1) as Step)} className={buttonQuiet}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </button>
          )}
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 1 && target === "board" && !board}
              className={buttonPrimary}
            >
              Next
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={start} disabled={pending} className={buttonPrimary}>
              <Play aria-hidden="true" className="h-4 w-4" />
              {pending ? "Loading players..." : "Start ranking"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function RadioTile({
  name,
  checked,
  onChange,
  title,
  description,
  adornment,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
  adornment?: React.ReactNode;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors ${
        checked ? "border-brand-purple/70 bg-brand-purple/10" : "border-line bg-base/40 hover:border-line-accent"
      }`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 shrink-0 accent-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          {adornment}
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
      </span>
    </label>
  );
}

function BoardSelect({
  boards,
  value,
  onChange,
}: {
  boards: WizardBoard[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        Board
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:text-sm"
      >
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({scopeLabel(b.scope, b.includesDefenders)}, {b.playerCount} players)
          </option>
        ))}
      </select>
    </div>
  );
}

function SourceFormatPickers({
  sources,
  formats,
  sourceSlug,
  formatSlug,
  lockedFormat,
  onSource,
  onFormat,
  formatName,
}: {
  sources: WizardSource[];
  formats: WizardFormat[];
  sourceSlug: string;
  formatSlug: string;
  lockedFormat: string | null;
  onSource: (slug: string) => void;
  onFormat: (slug: string) => void;
  formatName: (slug: string) => string;
}) {
  const formatId = useId();
  const source = sources.find((s) => s.slug === sourceSlug);
  const available = formats.filter((f) => supports(source, f.slug));
  return (
    <div className="mt-3 space-y-4 rounded-card border border-brand-purple/30 p-3 shadow-[0_0_24px_rgba(168,85,247,0.12)]">
      <fieldset>
        <legend className="text-sm font-medium text-ink">Source</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {sources.map((s) => {
            const covers = supports(s, formatSlug) || lockedFormat !== null && supports(s, lockedFormat);
            const fallback = covers
              ? null
              : pickFallbackFormat(formats, formatSlug, s.supportedFormatSlugs);
            const tipId = `ranker-src-tip-${s.slug}`;
            return (
              <SourceRadio
                key={s.slug}
                source={s}
                checked={s.slug === sourceSlug}
                onChange={() => onSource(s.slug)}
                warning={
                  fallback && !lockedFormat
                    ? `Warning: selecting this will switch your format from ${formatName(formatSlug)} to ${fallback.display_name} because ${s.displayName} doesn't provide values for ${formatName(formatSlug)}.`
                    : null
                }
                tipId={tipId}
                fallbackName={fallback?.display_name ?? null}
                disabled={Boolean(lockedFormat) && !supports(s, lockedFormat!)}
                disabledReason={
                  lockedFormat && !supports(s, lockedFormat)
                    ? `This board is for ${formatName(lockedFormat)}, and ${s.displayName} has no ${formatName(lockedFormat)} rankings.`
                    : null
                }
              />
            );
          })}
        </div>
      </fieldset>
      <div>
        <label htmlFor={formatId} className="block text-sm font-medium text-ink">
          Format
        </label>
        <select
          id={formatId}
          value={formatSlug}
          onChange={(e) => onFormat(e.target.value)}
          disabled={lockedFormat !== null}
          className="mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none disabled:opacity-60 sm:text-sm"
        >
          {available.map((f) => (
            <option key={f.slug} value={f.slug}>
              {f.display_name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-subtle">
          Only formats {source?.displayName ?? "this source"} ranks are listed.
        </p>
      </div>
    </div>
  );
}

function SourceRadio({
  source,
  checked,
  onChange,
  warning,
  tipId,
  fallbackName,
  disabled,
  disabledReason,
}: {
  source: WizardSource;
  checked: boolean;
  onChange: () => void;
  warning: string | null;
  tipId: string;
  fallbackName: string | null;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const id = useId();
  const reasonId = useId();
  return (
    <label
      htmlFor={id}
      className={`relative flex min-h-11 flex-wrap items-center gap-3 rounded-card border p-3 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${checked ? "border-brand-purple/70 bg-brand-purple/10" : "border-line bg-base/40"}`}
    >
      <input
        id={id}
        type="radio"
        name="ranker-source"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={warning ? `${source.displayName}. ${warning}` : undefined}
        aria-describedby={warning ? tipId : disabledReason ? reasonId : undefined}
        className="h-4 w-4 shrink-0 accent-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      <span className="text-sm font-medium text-ink">
        {source.displayName}
        {warning && <span className="ml-1 text-xs font-normal text-signal-warning">(changes format)</span>}
      </span>
      {disabledReason && (
        <span id={reasonId} className="block w-full text-xs text-ink-subtle">
          {disabledReason}
        </span>
      )}
      {warning && (
        <span id={tipId} role="tooltip" className="sr-only">
          Picking {source.displayName} switches this board to {fallbackName}.
        </span>
      )}
    </label>
  );
}

function ScopePicker({
  scope,
  includesDefenders,
  onScope,
  onDefenders,
}: {
  scope: BoardScope;
  includesDefenders: boolean;
  onScope: (s: BoardScope) => void;
  onDefenders: (v: boolean) => void;
}) {
  const idpId = useId();
  const idpHintId = useId();
  const offense = BOARD_SCOPES.filter((s) => s !== "defense" && !(IDP_POSITIONS as readonly string[]).includes(s));
  const defense = BOARD_SCOPES.filter((s) => s === "defense" || (IDP_POSITIONS as readonly string[]).includes(s));
  const title = (s: BoardScope) =>
    s === "overall" ? "Overall" : s === "defense" ? "All defenders" : positionHeading(s, "plural");
  return (
    <div role="radiogroup" aria-label="Players to rank" className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {offense.map((s) => (
          <RadioTile
            key={s}
            name="ranker-scope"
            checked={scope === s}
            onChange={() => onScope(s)}
            title={title(s)}
            description={scopeDescription(s)}
            adornment={s === "overall" ? null : <PositionChip position={s} />}
          />
        ))}
      </div>
      {scope === "overall" && (
        <div className="rounded-card border border-line bg-base/40 p-3">
          <label htmlFor={idpId} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input
              id={idpId}
              type="checkbox"
              checked={includesDefenders}
              onChange={(e) => onDefenders(e.target.checked)}
              aria-describedby={idpHintId}
              className="h-5 w-5 shrink-0 rounded border-line bg-base accent-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            />
            Include defensive players (IDP)
          </label>
          <p id={idpHintId} className="mt-1 text-xs text-ink-subtle">
            Defenders join after the offensive players: each starts at the bottom and climbs.
          </p>
        </div>
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">Defense</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {defense.map((s) => (
          <RadioTile
            key={s}
            name="ranker-scope"
            checked={scope === s}
            onChange={() => onScope(s)}
            title={title(s)}
            description={scopeDescription(s)}
            adornment={s === "defense" ? null : <PositionChip position={s} />}
          />
        ))}
      </div>
    </div>
  );
}

function DepthPicker({
  options,
  value,
  more,
  max,
  onValue,
  onMore,
}: {
  options: number[];
  value: number | "more";
  more: string;
  max: number;
  onValue: (v: number | "more") => void;
  onMore: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">Players to rank</legend>
      <p className="mt-1 text-xs text-ink-subtle">
        A starting point, not a limit: you can keep going at the end. Players you leave off do not
        count toward it.
      </p>
      <div className="mt-2 inline-flex flex-wrap gap-1 rounded-card border border-line bg-base p-1">
        {options.map((n) => (
          <SegmentRadio key={n} checked={value === n} onChange={() => onValue(n)} label={`Top ${n}`} />
        ))}
        <SegmentRadio checked={value === "more"} onChange={() => onValue("more")} label="More" />
      </div>
      {value === "more" && (
        <NumberField label="How many players" value={more} min={1} max={max} onChange={onMore} hint={`Up to ${max}.`} />
      )}
    </fieldset>
  );
}

function SegmentRadio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`relative inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm font-medium ${
        checked ? "bg-brand-purple/20 text-ink" : "text-ink-muted hover:text-ink"
      }`}
    >
      <input
        id={id}
        type="radio"
        name="ranker-depth"
        checked={checked}
        onChange={onChange}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span className="rounded-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand-cyan">
        {label}
      </span>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
  hint: string;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
        className="mt-1 min-h-11 w-32 rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:text-sm"
      />
      <p id={hintId} className="mt-1 text-xs text-ink-subtle">
        {hint}
      </p>
    </div>
  );
}
