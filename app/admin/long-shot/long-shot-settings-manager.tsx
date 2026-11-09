"use client";

/**
 * The Long Shot control panel (plan 21 and 21.1). Every field in the settings
 * document, grouped by what it does, with its clamp range in the help text.
 * Save is validated server-side and the first error is announced in a polite
 * status region. The small one-off forms (regenerate, moderation, settle)
 * live here too, each with its own status region.
 *
 * Every control has a real label, every group is a fieldset with a legend,
 * and every action is a button, so nothing navigates.
 */

import { useId, useState, useTransition } from "react";
import { LONG_SHOT_SETTING_BOUNDS as B } from "@/lib/long-shot/default-settings";
import { TEMPLATE_LABELS } from "@/lib/long-shot/template-labels";
import { TEMPLATE_KEYS, TIERS, TIER_WORDS, type LongShotSettings } from "@/lib/long-shot/types";
import {
  hideUserFromBoards,
  regenerateDate,
  regenerateTomorrow,
  saveLongShotSettingsAction,
  settleNow,
  unhideUser,
  type ActionResult,
} from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const btnCls =
  "inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";
const primaryCls =
  "inline-flex min-h-11 items-center justify-center rounded-card bg-brand-cyan px-5 text-sm font-bold text-[#07070D] hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";

function Status({ result }: { result: ActionResult | null }) {
  return (
    <p role="status" aria-live="polite" className={`mt-2 text-sm ${result && !result.ok ? "text-signal-danger" : "text-ink-muted"}`}>
      {result ? (result.ok ? (result.message ?? "Done.") : result.error) : ""}
    </p>
  );
}

function NumberField({
  label,
  help,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        aria-describedby={`${id}-help`}
        className={inputCls}
      />
      <p id={`${id}-help`} className="mt-1 text-xs text-ink-subtle">
        {help}
      </p>
    </div>
  );
}

function Toggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-help`}
        className="mt-1 h-5 w-5 accent-[#22D3EE]"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <p id={`${id}-help`} className="text-xs text-ink-subtle">
          {help}
        </p>
      </div>
    </div>
  );
}

export function LongShotSettingsManager({ initialSettings }: { initialSettings: LongShotSettings }) {
  const [s, setS] = useState<LongShotSettings>(initialSettings);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const set = (fn: (draft: LongShotSettings) => void) =>
    setS((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveLongShotSettingsAction(s)));
      }}
      className="space-y-6"
    >
      <fieldset className="space-y-4 rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Switches</legend>
        <Toggle label="Game on" help="Off shows a paused panel and every route answers 503." checked={s.game_enabled} onChange={(v) => set((d) => void (d.game_enabled = v))} />
        <Toggle label="Film Room on" help="Off hides the Film Room button and refuses Film Room starts." checked={s.film_room_enabled} onChange={(v) => set((d) => void (d.film_room_enabled = v))} />
        <Toggle label="Boards on" help="Off shows 'Boards are paused.' and the boards route answers 503." checked={s.leaderboards.enabled} onChange={(v) => set((d) => void (d.leaderboards.enabled = v))} />
        <Toggle label="Hide admins from the boards" help="Keep on: an admin who opens Today's room has seen answers." checked={s.leaderboards.hide_admin_users} onChange={(v) => set((d) => void (d.leaderboards.hide_admin_users = v))} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-card border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-ink">Clock</legend>
        <NumberField label="Seconds per prompt" help={`${B.timer_seconds.min} to ${B.timer_seconds.max}. Frozen on each attempt when it starts.`} value={s.timer.seconds} onChange={(v) => set((d) => void (d.timer.seconds = v))} />
        <NumberField label="Grace seconds" help={`${B.grace_seconds.min} to ${B.grace_seconds.max}. Absorbs network latency; never shown to players.`} value={s.timer.grace_seconds} onChange={(v) => set((d) => void (d.timer.grace_seconds = v))} />
      </fieldset>

      <fieldset className="grid gap-4 rounded-card border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-ink">History pool</legend>
        <NumberField
          label="Oldest season asked about"
          help={`${B.history_floor_season.min} to ${B.history_floor_season.max}. The history families never ask about a season before this one. Rosters hold 1920 on; stats hold 1999 on.`}
          value={s.history.floor_season}
          onChange={(v) => set((d) => void (d.history.floor_season = v))}
        />
      </fieldset>

      <fieldset className="grid gap-4 rounded-card border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-ink">Tiers</legend>
        {(["long_shot", "sleeper", "deep", "field"] as const).map((k) => (
          <NumberField
            key={`band-${k}`}
            label={`${TIER_WORDS[k]} band`}
            help="Absolute roster rate (or prominence) under which an answer is this tier. Strictly increasing from Long Shot to Field; at or over the Field band is Chalk."
            step={0.01}
            value={s.tiers.bands[k]}
            onChange={(v) => set((d) => void (d.tiers.bands[k] = v))}
          />
        ))}
        {(["long_shot", "sleeper", "deep", "field"] as const).map((k) => (
          <NumberField
            key={k}
            label={`${TIER_WORDS[k]} spread cutoff`}
            help="Within-set percentile, used only to spread a set whose every answer landed in one band. Strictly increasing from Long Shot to Field."
            step={0.01}
            value={s.tiers.cutoffs[k]}
            onChange={(v) => set((d) => void (d.tiers.cutoffs[k] = v))}
          />
        ))}
        {TIERS.map((t) => (
          <NumberField
            key={t}
            label={`${TIER_WORDS[t]} points`}
            help={`${B.tier_points.min} to ${B.tier_points.max}, strictly increasing from Chalk to Long Shot.`}
            value={s.tiers.points[t]}
            onChange={(v) => set((d) => void (d.tiers.points[t] = v))}
          />
        ))}
        <NumberField
          label="Leagues before a roster-rate season counts"
          help={`${B.min_rate_leagues.min} to ${B.min_rate_leagues.max}. Below this, the previous season's rates are used.`}
          value={s.tiers.min_rate_leagues}
          onChange={(v) => set((d) => void (d.tiers.min_rate_leagues = v))}
        />
      </fieldset>

      <fieldset className="grid gap-4 rounded-card border border-line p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold text-ink">Lone Signal bonus</legend>
        <NumberField label="Smallest room" help={`${B.min_room.min} to ${B.min_room.max} finished Hurry-Ups before any bonus is paid.`} value={s.bonus.min_room} onChange={(v) => set((d) => void (d.bonus.min_room = v))} />
        <NumberField label="Share under" help="Between 0 and 1. An answer given by less than this share qualifies." step={0.01} value={s.bonus.lone_share} onChange={(v) => set((d) => void (d.bonus.lone_share = v))} />
        <NumberField label="Bonus points" help={`${B.bonus_points.min} to ${B.bonus_points.max} per qualifying answer.`} value={s.bonus.points} onChange={(v) => set((d) => void (d.bonus.points = v))} />
      </fieldset>

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Prompt families</legend>
        <p className="text-xs text-ink-subtle">
          Answer bounds: minimum {B.min_answers.min} to {B.min_answers.max}, maximum at least the minimum and at most {B.max_answers.max}. A set outside its bounds is redrawn, never truncated.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Prompt families, on or off, with answer bounds</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th scope="col" className="py-2 pr-3">Family</th>
                <th scope="col" className="py-2 pr-3">On</th>
                <th scope="col" className="py-2 pr-3">Min answers</th>
                <th scope="col" className="py-2">Max answers</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_KEYS.map((k) => (
                <tr key={k} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                    {TEMPLATE_LABELS[k]}
                  </th>
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`${TEMPLATE_LABELS[k]} on`}
                      checked={s.templates[k].enabled}
                      onChange={(e) => set((d) => void (d.templates[k].enabled = e.target.checked))}
                      className="h-5 w-5 accent-[#22D3EE]"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      aria-label={`${TEMPLATE_LABELS[k]} minimum answers`}
                      value={s.templates[k].min_answers}
                      onChange={(e) => set((d) => void (d.templates[k].min_answers = Number(e.target.value)))}
                      className={inputCls}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      aria-label={`${TEMPLATE_LABELS[k]} maximum answers`}
                      value={s.templates[k].max_answers}
                      onChange={(e) => set((d) => void (d.templates[k].max_answers = Number(e.target.value)))}
                      className={inputCls}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <div>
        <button type="submit" disabled={pending} className={primaryCls}>
          {pending ? "Saving" : "Save settings"}
        </button>
        <Status result={result} />
      </div>
    </form>
  );
}

export function RegenerateControls({ tomorrow }: { tomorrow: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [date, setDate] = useState(tomorrow);
  const id = useId();
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" disabled={pending} className={btnCls} onClick={() => start(async () => setResult(await regenerateTomorrow()))}>
          Regenerate tomorrow
        </button>
        <div>
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            Or a date (YYYY-MM-DD)
          </label>
          <input id={id} value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-44`} />
        </div>
        <button type="button" disabled={pending} className={btnCls} onClick={() => start(async () => setResult(await regenerateDate(date)))}>
          Regenerate that date
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-subtle">Refused once anyone has started that day in either mode. A regenerate draws a fresh set with the next seed salt.</p>
      <Status result={result} />
    </div>
  );
}

export function ModerationControls({ hidden }: { hidden: Array<{ userId: string; name: string; reason: string | null; hiddenAt: string }> }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const uid = useId();
  const rid = useId();
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor={uid} className="block text-sm font-medium text-ink">
            User id
          </label>
          <input id={uid} value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor={rid} className="block text-sm font-medium text-ink">
            Reason (required)
          </label>
          <input id={rid} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={pending} className={btnCls} onClick={() => start(async () => setResult(await hideUserFromBoards(userId, reason)))}>
          Hide from boards
        </button>
      </div>
      <Status result={result} />
      {hidden.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Nobody is hidden.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line">
          {hidden.map((h) => (
            <li key={h.userId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <span>
                <span className="font-semibold text-ink">{h.name}</span>
                <span className="ml-2 font-mono text-xs text-ink-subtle">{h.userId}</span>
                <span className="block text-xs text-ink-muted">
                  {h.reason ?? "No reason recorded"}, {h.hiddenAt}
                </span>
              </span>
              <button type="button" disabled={pending} className={btnCls} onClick={() => start(async () => setResult(await unhideUser(h.userId)))}>
                Unhide {h.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SettleControls({ yesterday }: { yesterday: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [date, setDate] = useState(yesterday);
  const id = useId();
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            Game date (Eastern, yesterday or earlier)
          </label>
          <input id={id} value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-44`} />
        </div>
        <button type="button" disabled={pending} className={btnCls} onClick={() => start(async () => setResult(await settleNow(date)))}>
          Settle now
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-subtle">Safe to run again; a settled attempt is never paid twice.</p>
      <Status result={result} />
    </div>
  );
}
