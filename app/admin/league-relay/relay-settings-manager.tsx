"use client";

/**
 * The League Relay control panel.
 *
 * Grouped by what each setting does rather than by the shape of the JSON, and
 * every group states the consequence of changing it, which is the difference
 * between a form an admin can use and one they have to remember.
 *
 * FOUR MESSAGE TYPES, FOUR INDEPENDENT SWITCHES, FOUR CHANNELS. That is the
 * whole design: trades and waivers can go to different rooms, previews and
 * recaps to a third, and any of them can be off while the others run. A type
 * switched on with no channel is refused on save rather than saved as a
 * configuration that silently never posts.
 *
 * THE WINDOWS ARE EASTERN AND THE LABELS SAY SO. The cron ticks every fifteen
 * minutes; these weekdays and hours decide which of those ticks post. Every
 * time is resolved in America/New_York, which is what the cron reads, so the
 * label and the behaviour cannot drift apart at a daylight-saving boundary.
 *
 * Accessibility: every control has a real label tied by id, each group is a
 * fieldset with a legend, the save result is announced through a polite live
 * region, and every action is a button rather than a link so nothing navigates.
 */

import { useEffect, useId, useState, useTransition } from "react";
import { Check } from "lucide-react";
import {
  DEFAULT_LEAGUE_RELAY_SETTINGS,
  RELAY_MESSAGE_HINT,
  RELAY_MESSAGE_LABEL,
  RELAY_MESSAGE_TYPES,
  RELAY_SETTING_BOUNDS,
  WEEKDAY_LABELS,
  type LeagueRelaySettings,
  type RelayChannelSettings,
  type RelayMessageType,
} from "@/lib/league-relay/default-settings";
import {
  describeHour,
  describePreviewSchedule,
  describeRecapSchedule,
} from "@/lib/league-relay/schedule";
import { saveRelaySettingsAction } from "./actions";

const inputCls =
  "mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export interface WebhookOption {
  id: string;
  label: string;
  isActive: boolean;
}

export function RelaySettingsManager({
  initialSettings,
  webhooks,
  lastUpdated,
}: {
  initialSettings: LeagueRelaySettings;
  webhooks: WebhookOption[];
  lastUpdated: string | null;
}) {
  const [settings, setSettings] = useState<LeagueRelaySettings>(initialSettings);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const dirty = JSON.stringify(settings) !== JSON.stringify(initialSettings);

  function patch(next: Partial<LeagueRelaySettings>) {
    setSettings((s) => ({ ...s, ...next }));
    setStatus(null);
  }

  function patchChannel(type: RelayMessageType, next: Partial<RelayChannelSettings>) {
    setSettings((s) => ({
      ...s,
      channels: { ...s.channels, [type]: { ...s.channels[type], ...next } },
    }));
    setStatus(null);
  }

  function save() {
    startSaving(async () => {
      const result = await saveRelaySettingsAction(settings);
      setStatus(
        result.ok
          ? { tone: "ok", text: result.message ?? "Saved." }
          : { tone: "bad", text: result.error },
      );
    });
  }

  return (
    <div className="space-y-8">
      {/* One live region for the whole form, so a screen reader is told what
          happened rather than having to go looking for a change on the page. */}
      <p aria-live="polite" className="sr-only">
        {status?.text ?? ""}
      </p>

      <Group
        legend="The relay"
        note="Off leaves every community league synced on its own schedule and posts nothing. Nothing already posted is affected."
      >
        <Toggle
          label="League Relay is running"
          checked={settings.enabled}
          onChange={(v) => patch({ enabled: v })}
          hint="Off means the cron reads one settings row every fifteen minutes and returns."
        />
        <NumberField
          label="Leagues per 15-minute run"
          value={settings.sync.max_leagues_per_run}
          onChange={(n) => patch({ sync: { ...settings.sync, max_leagues_per_run: n } })}
          min={RELAY_SETTING_BOUNDS.max_leagues_per_run.min}
          max={RELAY_SETTING_BOUNDS.max_leagues_per_run.max}
          hint="Least recently synced first, so a capped run rotates through the list instead of starving the tail."
        />
        <NumberField
          label="Oldest move worth posting, in hours"
          value={settings.sync.max_transaction_age_hours}
          onChange={(n) =>
            patch({ sync: { ...settings.sync, max_transaction_age_hours: n } })
          }
          min={RELAY_SETTING_BOUNDS.max_transaction_age_hours.min}
          max={RELAY_SETTING_BOUNDS.max_transaction_age_hours.max}
          hint="After an outage, this is what stops forty hours of backlog arriving at once. Anything older is passed over silently."
        />
        <NumberField
          label="Messages per league per run"
          value={settings.sync.max_messages_per_league_per_run}
          onChange={(n) =>
            patch({ sync: { ...settings.sync, max_messages_per_league_per_run: n } })
          }
          min={RELAY_SETTING_BOUNDS.max_messages_per_league_per_run.min}
          max={RELAY_SETTING_BOUNDS.max_messages_per_league_per_run.max}
          hint="A Wednesday with eleven waiver claims sends this many now and the rest on the next tick, oldest first."
        />
      </Group>

      <Group
        legend="How busy waiver days are covered"
        note="Sleeper processes a league's claims all at once, so a Wednesday morning is one event with eleven results in it. A quiet run gets a real review per claim; a busy one gets a single message listing every move, because eleven separate embeds is a wall nobody reads. Nothing is ever left off the list."
      >
        <NumberField
          label="Full reviews up to this many moves in a run"
          value={settings.waivers.digest_threshold}
          onChange={(n) => patch({ waivers: { ...settings.waivers, digest_threshold: n } })}
          min={RELAY_SETTING_BOUNDS.digest_threshold.min}
          max={RELAY_SETTING_BOUNDS.digest_threshold.max}
          hint={`At or under this, each claim gets its own writeup. Above it, the whole run becomes one digest. Currently: ${settings.waivers.digest_threshold} or fewer means ${settings.waivers.digest_threshold} separate messages, ${
            settings.waivers.digest_threshold + 1
          } or more means one.`}
        />
        <Toggle
          label="Cover a move that drops somebody and adds nobody"
          checked={settings.waivers.include_bare_drops}
          onChange={(v) => patch({ waivers: { ...settings.waivers, include_bare_drops: v } })}
          hint="Cutting a startable player is news. Off means bare drops are passed over silently; they still appear inside a digest when the run is busy."
        />
      </Group>

      {RELAY_MESSAGE_TYPES.map((type) => (
        <ChannelGroup
          key={type}
          type={type}
          channel={settings.channels[type]}
          webhooks={webhooks}
          onChange={(next) => patchChannel(type, next)}
        />
      ))}

      <Group
        legend="When the matchup posts go out"
        note="Both windows are read in America/New_York, so they hold their local time across daylight saving. Previews land three days before the first game of the week; recaps land the morning after the week settles."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <WeekdaySelect
            label="Preview day"
            value={settings.matchups.preview_weekday}
            onChange={(n) => patch({ matchups: { ...settings.matchups, preview_weekday: n } })}
            hint="Wednesday by default: the first game of an NFL week is usually Thursday night, so lineups are still movable."
          />
          <HourSelect
            label="Preview time"
            value={settings.matchups.preview_hour}
            onChange={(n) => patch({ matchups: { ...settings.matchups, preview_hour: n } })}
            hint="One post per selected game, on that day."
          />
        </div>
        <Toggle
          label="Post the headline game"
          checked={settings.matchups.preview_headline}
          onChange={(v) => patch({ matchups: { ...settings.matchups, preview_headline: v } })}
          hint="The best two teams still playing, weighted towards a game the model cannot call."
        />
        <Toggle
          label="Post an undercard"
          checked={settings.matchups.preview_undercard}
          onChange={(v) => patch({ matchups: { ...settings.matchups, preview_undercard: v } })}
          hint="The weakest game on the slate. Without it, only the top of the table is ever written about."
        />
        <p className="text-xs text-ink-muted">{describePreviewSchedule(settings.matchups)}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <WeekdaySelect
            label="Recap day"
            value={settings.matchups.recap_weekday}
            onChange={(n) => patch({ matchups: { ...settings.matchups, recap_weekday: n } })}
            hint="Tuesday by default, once Monday night has settled every score."
          />
          <HourSelect
            label="First recap"
            value={settings.matchups.recap_start_hour}
            onChange={(n) => patch({ matchups: { ...settings.matchups, recap_start_hour: n } })}
            hint="One game an hour from here."
          />
          <HourSelect
            label="Last recap"
            value={settings.matchups.recap_end_hour}
            onChange={(n) => patch({ matchups: { ...settings.matchups, recap_end_hour: n } })}
            hint="The run stops here even if games are left; they are not carried over."
          />
        </div>
        <p className="text-xs text-ink-muted">{describeRecapSchedule(settings.matchups)}</p>
      </Group>

      <Group
        legend="The voice"
        note="Every sentence in every writeup is a hand-written template with a real figure in it. Nothing is generated by a language model, so a reader can check any claim against the numbers printed under it. This dial only decides how sharp those templates are allowed to be."
      >
        <SnarkSlider
          value={settings.voice.snark}
          onChange={(n) => patch({ voice: { ...settings.voice, snark: n } })}
        />
        <Toggle
          label="Show the numbers under the prose"
          checked={settings.voice.show_numbers}
          onChange={(v) => patch({ voice: { ...settings.voice, show_numbers: v } })}
          hint="The stat block: lineup points, projected wins, playoff and title odds, value and age."
        />
        <Toggle
          label="Link back to the league page on FF Beacon"
          checked={settings.voice.link_back}
          onChange={(v) => patch({ voice: { ...settings.voice, link_back: v } })}
        />
      </Group>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex min-h-11 items-center gap-2 rounded-card bg-brand-purple px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-purple/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          {saving ? "Saving" : dirty ? "Save settings" : "Saved"}
        </button>
        {status && (
          <p
            className={`text-sm ${status.tone === "ok" ? "text-signal-success" : "text-signal-danger"}`}
          >
            {status.text}
          </p>
        )}
        {lastUpdated && (
          <p className="text-xs text-ink-subtle">Last saved {lastUpdated}</p>
        )}
      </div>
    </div>
  );
}

/* ---------- One message type ---------- */

function ChannelGroup({
  type,
  channel,
  webhooks,
  onChange,
}: {
  type: RelayMessageType;
  channel: RelayChannelSettings;
  webhooks: WebhookOption[];
  onChange: (next: Partial<RelayChannelSettings>) => void;
}) {
  return (
    <Group legend={RELAY_MESSAGE_LABEL[type]} note={RELAY_MESSAGE_HINT[type]}>
      <Toggle
        label={`Post ${RELAY_MESSAGE_LABEL[type].toLowerCase()}`}
        checked={channel.enabled}
        onChange={(v) => onChange({ enabled: v })}
        hint="Saving this on without a channel below is refused, because it would look like it was working."
      />
      <WebhookSelect
        label="Channel"
        value={channel.webhook_id}
        options={webhooks}
        emptyLabel="No channel chosen"
        hint="Manage the list at System Settings, Discord webhooks. Each message type can use a different room."
        onChange={(id) => onChange({ webhook_id: id })}
      />
      <Toggle
        label="Attach a poll"
        checked={channel.poll}
        onChange={(v) => onChange({ poll: v })}
        hint="Trades and previews have something to vote on. Waivers and recaps do not, and a poll on a settled result is only an invitation to pile on."
      />
      {channel.poll && (
        <NumberField
          label="Poll stays open, in hours"
          value={channel.poll_hours}
          onChange={(n) => onChange({ poll_hours: n })}
          min={RELAY_SETTING_BOUNDS.poll_hours.min}
          max={RELAY_SETTING_BOUNDS.poll_hours.max}
          compact
        />
      )}
      <RoleIds ids={channel.mention_role_ids} onChange={(ids) => onChange({ mention_role_ids: ids })} />
    </Group>
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

function WeekdaySelect({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={hintId}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputCls}
      >
        {WEEKDAY_LABELS.map((day, index) => (
          <option key={day} value={index}>
            {day}
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
 * An hour picker, not a time field.
 *
 * The cron ticks four times an hour, so a half-past setting would fire on
 * whichever tick happened to be closest and read as unreliable. Hours only is
 * coarser and honest.
 */
function HourSelect({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={hintId}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputCls}
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={hour}>
            {describeHour(hour)} Eastern
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
 * The snark dial.
 *
 * A slider with a spoken value, because the numbers mean nothing on their own:
 * an admin needs to know that 0.8 is "will call a team a catastrophe with a
 * logo" and 0.2 is "will not". The value is announced as text so a screen
 * reader hears the register rather than a decimal.
 */
function SnarkSlider({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describe = (v: number): string => {
    if (v < 0.2) return "Straight report. Numbers and nothing else.";
    if (v < 0.45) return "Dry. The occasional raised eyebrow.";
    if (v < 0.7) return "Properly sarcastic, but nobody gets called names.";
    if (v < 0.9) return "Sharp. Bad teams are told they are bad, with the rank to prove it.";
    return "Full hyperbole. A last-place team is an argument for contraction.";
  };
  return (
    <div className="max-w-md">
      <label htmlFor={id} className="block text-xs font-medium text-ink-subtle">
        How sharp the writeups are
      </label>
      <input
        id={id}
        type="range"
        min={RELAY_SETTING_BOUNDS.snark.min}
        max={RELAY_SETTING_BOUNDS.snark.max}
        step={0.05}
        value={value}
        aria-describedby={hintId}
        aria-valuetext={describe(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 min-h-11 w-full accent-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
        {describe(value)} Lines above the setting are never drawn, so turning it down
        yields a straight report built from the same figures, not a different feature.
      </p>
    </div>
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

  // The reset is skipped while the field is invalid, or blur would replace the
  // typed text with the last accepted value and leave the reader with an error
  // naming a string no longer on screen.
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
        Comma separated. Only the roles listed here can be pinged; @everyone and @here
        are refused by the client no matter what the message says.
      </p>
      {bad && (
        <p id={errorId} role="alert" className="mt-1 text-[11px] leading-relaxed text-signal-danger">
          {bad}
        </p>
      )}
    </div>
  );
}

export { DEFAULT_LEAGUE_RELAY_SETTINGS };
