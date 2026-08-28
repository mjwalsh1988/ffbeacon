"use client";

/**
 * The Would You Rather control panel.
 *
 * Grouped by what each setting does rather than by the shape of the JSON, and
 * every group states the consequence of changing it, which is the difference
 * between a form an admin can use and one they have to remember.
 *
 * THE SCHEDULE IS THE INTERESTING PART. The cron ticks hourly; these checkboxes
 * decide which of those ticks actually post. So the frequency is whatever is
 * ticked: three boxes is three posts a day, one box is one. Every time is
 * labelled in America/New_York, which is what the cron reads, so the label and
 * the behaviour cannot drift apart at a daylight-saving boundary.
 *
 * EACH LEAGUE TYPE CAN HAVE ITS OWN CHANNEL. Dynasty trades to the dynasty
 * room, redraft to the redraft room, best ball to the best ball room. The trade
 * is picked first and the channel follows from it, so this is a map of where
 * things land rather than a set of slots that each have to be filled: a
 * scheduled time still posts one trade, into whichever room matches it.
 *
 * Accessibility: every control has a real label tied by id, each group is a
 * fieldset with a legend, the save result is announced through a polite live
 * region, and both the save and the two one-off actions are buttons rather than
 * links so nothing navigates.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { AlertTriangle, Check, RotateCcw, Send, Sprout } from "lucide-react";
import { formatEastern } from "@/lib/datetime";
import {
  DEFAULT_WOULD_YOU_RATHER_SETTINGS,
  WYR_SETTING_BOUNDS,
  type WouldYouRatherSettings,
} from "@/lib/would-you-rather/default-settings";
import { describePostHour, describeSchedule } from "@/lib/would-you-rather/schedule";
import {
  describeRouting,
  WYR_CATEGORY_HINT,
  WYR_CATEGORY_LABEL,
  WYR_ROUTE_CATEGORIES,
} from "@/lib/would-you-rather/routing";
import {
  growPoolAction,
  postDiscordPollNowAction,
  saveWouldYouRatherSettingsAction,
} from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export interface WebhookOption {
  id: string;
  label: string;
  isActive: boolean;
}

export function WouldYouRatherSettingsManager({
  initialSettings,
  webhooks,
  lastUpdated,
}: {
  initialSettings: WouldYouRatherSettings;
  webhooks: WebhookOption[];
  lastUpdated: string | null;
}) {
  const [settings, setSettings] = useState<WouldYouRatherSettings>(initialSettings);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [running, startRunning] = useTransition();
  const [poolPasses, setPoolPasses] = useState(3);

  const dirty = JSON.stringify(settings) !== JSON.stringify(initialSettings);

  function patch(next: Partial<WouldYouRatherSettings>) {
    setSettings((s) => ({ ...s, ...next }));
    setStatus(null);
  }

  function save() {
    startSaving(async () => {
      const result = await saveWouldYouRatherSettingsAction(settings);
      setStatus(
        result.ok
          ? { tone: "ok", text: "Saved. New rounds and the next cron tick use these." }
          : { tone: "bad", text: result.error },
      );
    });
  }

  return (
    <div className="space-y-8">
      {/* One live region for the whole form. Every action writes its outcome
          here, so a screen reader is told what happened rather than having to
          go looking for a change somewhere on the page. */}
      <p aria-live="polite" className="sr-only">
        {status?.text ?? ""}
      </p>

      {/* ---------- The game ---------- */}
      <Group
        legend="The game"
        note="Turning the game off leaves the page up and shows a plain 'paused' state. Nothing else on the site is affected, and no vote already cast is touched."
      >
        <Toggle
          label="Would You Rather is live at /games/would-you-rather"
          checked={settings.game_enabled}
          onChange={(v) => patch({ game_enabled: v })}
          hint="Off shows a paused state and stops the Discord poll too."
        />
        <Toggle
          label="Let signed-out visitors play"
          checked={settings.guest_play_enabled}
          onChange={(v) => patch({ guest_play_enabled: v })}
          hint="Off sends every visitor straight to the sign-in state."
        />
        <NumberField
          label="Free votes before sign-in"
          value={settings.guest_vote_limit}
          onChange={(n) => patch({ guest_vote_limit: n })}
          min={WYR_SETTING_BOUNDS.guest_vote_limit.min}
          max={WYR_SETTING_BOUNDS.guest_vote_limit.max}
          hint="How many trades a visitor can call before an account is required. Zero means an account is needed from the first vote."
        />
      </Group>

      {/* ---------- The pool ---------- */}
      <Group
        legend="Which trades get played"
        note="A trade only enters the pool if Signal Check can actually grade it, so these rules narrow an already-filtered set. Changing them affects trades pooled from now on; anything already in the pool stays until it is retired."
      >
        <NumberField
          label="Minimum assets each side must receive"
          value={settings.pool.min_assets_per_side}
          onChange={(n) => patch({ pool: { ...settings.pool, min_assets_per_side: n } })}
          min={WYR_SETTING_BOUNDS.min_assets_per_side.min}
          max={WYR_SETTING_BOUNDS.min_assets_per_side.max}
          hint="One-sided deals are not a question, so both sides have to receive something."
        />
        <Toggle
          label="Include dynasty startup draft trades"
          checked={settings.pool.include_startup_trades}
          onChange={(v) => patch({ pool: { ...settings.pool, include_startup_trades: v } })}
          hint="Startup picks are shown as the player taken at that seat, and the round is labelled as a startup trade."
        />
        <Toggle
          label="Require at least one real player in the trade"
          checked={settings.pool.require_player_asset}
          onChange={(v) => patch({ pool: { ...settings.pool, require_player_asset: v } })}
          hint="Keeps pick-for-pick swaps out. They grade fine and play badly: there is nothing to recognise."
        />
        <Toggle
          label="Prefer leagues that already have Positional WAR curves"
          checked={settings.pool.prefer_leagues_with_war}
          onChange={(v) => patch({ pool: { ...settings.pool, prefer_leagues_with_war: v } })}
          hint="Makes the reveal richer. It only reads existing curves and never causes one to be computed."
        />
        <NumberField
          label="Trades graded per pool pass"
          value={settings.pool.candidate_batch_size}
          onChange={(n) => patch({ pool: { ...settings.pool, candidate_batch_size: n } })}
          min={WYR_SETTING_BOUNDS.candidate_batch_size.min}
          max={WYR_SETTING_BOUNDS.candidate_batch_size.max}
          hint="Grading is the expensive half. This bounds the work one top-up can do."
        />
      </Group>

      {/* ---------- The reveal ---------- */}
      <Group
        legend="What the reveal shows"
        note="Everything here appears only after a vote is recorded. Switching one off removes that block from the reveal; it does not change what is computed."
      >
        <Toggle
          label="Community vote graph"
          checked={settings.reveal.show_community_results}
          onChange={(v) => patch({ reveal: { ...settings.reveal, show_community_results: v } })}
        />
        <Toggle
          label="Full Signal Check verdict"
          checked={settings.reveal.show_signal_check}
          onChange={(v) => patch({ reveal: { ...settings.reveal, show_signal_check: v } })}
        />
        <Toggle
          label="Power Pulse standing for both teams"
          checked={settings.reveal.show_team_context}
          onChange={(v) => patch({ reveal: { ...settings.reveal, show_team_context: v } })}
        />
        <Toggle
          label="Positional WAR for every player in the deal"
          checked={settings.reveal.show_positional_war}
          onChange={(v) => patch({ reveal: { ...settings.reveal, show_positional_war: v } })}
        />
        <Toggle
          label="30-day value movement"
          checked={settings.reveal.show_value_trends}
          onChange={(v) => patch({ reveal: { ...settings.reveal, show_value_trends: v } })}
        />
      </Group>

      {/* ---------- Discord ---------- */}
      <Group
        legend="The Discord poll"
        note="A cron job ticks every hour and asks this schedule whether to post. So the frequency is whatever you tick below, not the cron: three times is three posts a day, once is once. Every time is Eastern, and holds its Eastern time across daylight saving."
      >
        <Toggle
          label="Post a trade to Discord on this schedule"
          checked={settings.discord.enabled}
          onChange={(v) => patch({ discord: { ...settings.discord, enabled: v } })}
          hint="Off by default. Nothing is posted anywhere until this is on and a webhook is chosen."
        />

        <WebhookSelect
          label="Fallback channel"
          value={settings.discord.webhook_id}
          options={webhooks}
          emptyLabel="No webhook selected"
          hint="Used by any league type below that has no channel of its own. Leave it empty and only the types you route explicitly get picked at all."
          onChange={(id) => patch({ discord: { ...settings.discord, webhook_id: id } })}
        />

        <fieldset className="rounded-card border border-line bg-base/40 p-4">
          <legend className="px-1 text-xs font-medium text-ink">
            A channel per league type
          </legend>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-subtle">
            Point each type at the room that plays it. A redraft manager reading a
            dynasty trade has no way to price it. Each scheduled time still posts
            one trade; this only decides where that trade lands. A type with no
            channel here and no fallback is never picked.
          </p>
          <div className="space-y-4">
            {WYR_ROUTE_CATEGORIES.map((category) => (
              <WebhookSelect
                key={category}
                label={WYR_CATEGORY_LABEL[category]}
                value={settings.discord.routes[category]}
                options={webhooks}
                emptyLabel="Same as the fallback channel"
                hint={WYR_CATEGORY_HINT[category]}
                onChange={(id) =>
                  patch({
                    discord: {
                      ...settings.discord,
                      routes: { ...settings.discord.routes, [category]: id },
                    },
                  })
                }
              />
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
            Webhooks are added and edited at{" "}
            <span className="text-ink">/admin/system/webhooks</span>. The URL itself
            is a secret and is never sent to this page. A webhook switched off there
            stops the types pointed at it.
          </p>
        </fieldset>

        <PostHours
          hours={settings.discord.post_hours}
          onChange={(hours) => patch({ discord: { ...settings.discord, post_hours: hours } })}
        />

        <NumberField
          label="How long each poll stays open (hours)"
          value={settings.discord.poll_hours}
          onChange={(n) => patch({ discord: { ...settings.discord, poll_hours: n } })}
          min={WYR_SETTING_BOUNDS.poll_hours.min}
          max={WYR_SETTING_BOUNDS.poll_hours.max}
          hint="Discord closes the poll after this. The results are read back once, within an hour of it closing, and added to that trade's tally. Discord's own cap is 768 hours."
        />

        <RoleIds
          ids={settings.discord.mention_role_ids}
          onChange={(ids) => patch({ discord: { ...settings.discord, mention_role_ids: ids } })}
        />

        <p className="rounded-card border border-line bg-base/50 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
          <span className="font-medium text-ink">Current schedule: </span>
          {settings.discord.enabled
            ? describeSchedule(settings.discord.post_hours)
            : "Posting is off, so nothing will post."}
          {settings.discord.enabled && (
            <>
              {" "}
              <span className="font-medium text-ink">Where it goes: </span>
              {describeRouting(settings)}
            </>
          )}
        </p>
      </Group>

      {/* ---------- Save ---------- */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {/*
          Disabled only while the request is in flight, never merely because
          nothing has changed. Disabling on `!dirty` meant a successful save
          disabled the button that had just been pressed, browsers blurred it,
          and focus fell to the top of the document. A press with nothing to
          save is a harmless no-op instead.
        */}
        <button
          type="button"
          onClick={() => {
            if (!dirty) {
              setStatus({ tone: "ok", text: "Nothing has changed since the last save." });
              return;
            }
            save();
          }}
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          {saving ? "Saving" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSettings(DEFAULT_WOULD_YOU_RATHER_SETTINGS);
            setStatus(null);
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset the form to defaults
        </button>
        {lastUpdated && (
          <span className="text-xs text-ink-subtle">
            Last saved {formatEastern(lastUpdated)}
          </span>
        )}
      </div>

      {status && (
        <p
          className={`flex items-start gap-2 rounded-card border px-3.5 py-3 text-sm leading-relaxed ${
            status.tone === "ok"
              ? "border-signal-success/40 bg-signal-success/10 text-ink"
              : "border-signal-danger/40 bg-signal-danger/10 text-ink"
          }`}
        >
          {status.tone === "ok" ? (
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-success" />
          ) : (
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-signal-danger"
            />
          )}
          {status.text}
        </p>
      )}

      {/* ---------- One-off actions ---------- */}
      <Group
        legend="Run something now"
        note="These act immediately and are not part of saving. Both run the real code paths rather than a rehearsal of them."
      >
        <div className="flex flex-wrap items-end gap-3">
          <NumberField
            label="Pool passes"
            value={poolPasses}
            onChange={setPoolPasses}
            min={1}
            max={10}
            hint="Each pass samples a window of trades and grades one league's worth."
            compact
          />
          <button
            type="button"
            disabled={running}
            onClick={() =>
              startRunning(async () => {
                const result = await growPoolAction(poolPasses);
                setStatus(
                  result.ok
                    ? { tone: "ok", text: result.message ?? "Done." }
                    : { tone: "bad", text: result.error },
                );
              })
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sprout aria-hidden="true" className="h-4 w-4" />
            {running ? "Working" : "Add trades to the pool"}
          </button>
        </div>

        <div className="pt-1">
          <button
            type="button"
            disabled={running}
            onClick={() =>
              startRunning(async () => {
                const result = await postDiscordPollNowAction();
                setStatus(
                  result.ok
                    ? { tone: "ok", text: result.message ?? "Posted." }
                    : { tone: "bad", text: result.error },
                );
              })
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            {running ? "Working" : "Post a poll to Discord now"}
          </button>
          <p className="mt-1.5 max-w-xl text-[11px] leading-relaxed text-ink-subtle">
            For checking a webhook. It skips only the clock: the once-per-Eastern-hour
            guard still applies, so a second press inside the same hour is refused,
            and it needs posting turned on and saved first.
          </p>
        </div>
      </Group>
    </div>
  );
}

/* ---------- Field primitives ---------- */

function Group({
  legend,
  note,
  children,
}: {
  legend: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-modal border border-line bg-surface/40 p-5">
      <legend className="px-1 text-sm font-semibold text-ink">{legend}</legend>
      {note && <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-muted">{note}</p>}
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 shrink-0 rounded border-line bg-base text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
        <span className="text-sm text-ink">{label}</span>
      </label>
      {hint && (
        <p id={hintId} className="ml-8 text-[11px] leading-relaxed text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  compact?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <div className={compact ? "w-32" : "max-w-xs"}>
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step="1"
        min={min}
        max={max}
        value={text}
        aria-describedby={hint ? hintId : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = Number(text);
          if (Number.isFinite(n)) onChange(Math.round(n));
          else setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(Math.round(n));
        }}
        className={inputCls}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * One webhook picker: the fallback channel, or one league type's channel.
 *
 * The empty option is not the same sentence in the two places it appears, which
 * is why it is a prop. On the fallback it means "nothing is posted unless a
 * type has its own channel"; on a league type it means "use the fallback". A
 * shared "None" would have read as the first thing in both places and been
 * wrong in one of them.
 */
function WebhookSelect({
  label,
  value,
  options,
  emptyLabel,
  hint,
  onChange,
}: {
  label: string;
  value: string | null;
  options: WebhookOption[];
  emptyLabel: string;
  hint: string;
  onChange: (id: string | null) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="max-w-md">
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputCls}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
            {option.isActive ? "" : " (switched off)"}
          </option>
        ))}
      </select>
      <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
        {hint}
      </p>
    </div>
  );
}

/**
 * The schedule.
 *
 * Twenty four checkboxes, one per Eastern hour, rather than a free text field:
 * the cron fires on the hour, so a half-past time would silently never post,
 * and a setting that cannot happen is worse than one that is coarse.
 */
function PostHours({
  hours,
  onChange,
}: {
  hours: number[];
  onChange: (hours: number[]) => void;
}) {
  const groupId = useId();
  const selected = new Set(hours);

  function toggle(hour: number) {
    const next = new Set(selected);
    if (next.has(hour)) next.delete(hour);
    else next.add(hour);
    onChange(Array.from(next).sort((a, b) => a - b));
  }

  return (
    <fieldset>
      <legend className="text-xs font-medium text-ink-subtle">
        Times of day to post, Eastern
      </legend>
      <p id={`${groupId}-hint`} className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
        Tick as many as you want. How many you tick is the frequency: three ticks is
        three posts a day, one tick is once a day at that time.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => {
          const on = selected.has(hour);
          return (
            <label
              key={hour}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-2.5 text-xs transition-colors ${
                on
                  ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                  : "border-line bg-base text-ink-muted hover:border-line-accent"
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(hour)}
                aria-describedby={`${groupId}-hint`}
                className="h-4 w-4 shrink-0 rounded border-line bg-base text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              />
              <span className="tabular-nums">{describePostHour(hour)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Role ids permitted to be pinged.
 *
 * Digits only, and validated again on the server. Anything here goes straight
 * into the message's `allowed_mentions`, which is the one list that decides who
 * Discord is allowed to notify.
 */
function RoleIds({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [text, setText] = useState(ids.join(", "));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState<string | null>(null);

  // The reset is skipped while the field is invalid. Without that guard, blur
  // fired this effect, `ids` was unchanged (commit refused to accept the bad
  // input), and the typed text was replaced by the last accepted value. The
  // reader was then left with an error naming a string that was no longer on
  // screen, and nothing to correct.
  useEffect(() => {
    if (!focused && !bad) setText(ids.join(", "));
  }, [ids, focused, bad]);

  function commit(raw: string) {
    const parts = raw
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const invalid = parts.filter((p) => !/^\d{1,25}$/.test(p));
    if (invalid.length > 0) {
      setBad(`Not a Discord role id: ${invalid.join(", ")}. Role ids are digits only.`);
      return;
    }
    setBad(null);
    onChange(Array.from(new Set(parts)));
  }

  return (
    <div className="max-w-md">
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        Role ids to ping (optional)
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={text}
        // The error is named here as well as the hint, so a reader who tabs
        // back to the field hears WHY it is invalid rather than only that it is.
        aria-describedby={bad ? `${hintId} ${errorId}` : hintId}
        aria-invalid={bad ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(text);
        }}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 123456789012345678"
        className={inputCls}
      />
      <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
        Comma separated. Only the roles listed here can be pinged; @everyone and
        @here are refused by the client no matter what the message says.
      </p>
      {bad && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-[11px] leading-relaxed text-signal-danger"
        >
          {bad}
        </p>
      )}
    </div>
  );
}
