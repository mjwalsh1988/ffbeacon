import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { formatEastern } from "@/lib/datetime";
import { addDays, currentEasternGameDate } from "@/lib/game-date";
import type { TryLog } from "@/lib/long-shot/generate";
import { loadLongShotSettings } from "@/lib/long-shot/settings";
import { loadPlayerInfo } from "@/lib/long-shot/tallies";
import { TEMPLATE_LABELS } from "@/lib/long-shot/template-labels";
import type { AnswerEntry, TemplateKey } from "@/lib/long-shot/types";
import { resolveUserIdentities } from "@/lib/user-identity";
import { createAdminClient } from "@/lib/supabase/server";
import { LongShotSettingsManager, ModerationControls, RegenerateControls, SettleControls } from "./long-shot-settings-manager";
import { PuzzlePreview, type PreviewPrompt } from "./puzzle-preview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Long Shot" };

/**
 * The Long Shot admin surface (plan 21.1): status, tomorrow's prompts, today's
 * room behind a closed disclosure, every setting, the family try log,
 * moderation and settlement. Service-role reads only.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface/40 px-3.5 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

type Puzzle = { id: string; game_date: string; status: string; prompt_count: number; seed_salt: number; completed_attempts: number; settled_at: string | null; generated_by: string };

export default async function LongShotAdminPage() {
  await requireAdmin("/admin/long-shot");
  const admin = createAdminClient();
  const settings = await loadLongShotSettings(admin);
  const today = currentEasternGameDate();
  const tomorrow = addDays(today, 1);

  const puzzleCols = "id, game_date, status, prompt_count, seed_salt, completed_attempts, settled_at, generated_by";
  const [todayRes, tomorrowRes, genRuns, settleRun, hiddenRes] = await Promise.all([
    admin.from("long_shot_puzzles").select(puzzleCols).eq("game_date", today).maybeSingle(),
    admin.from("long_shot_puzzles").select(puzzleCols).eq("game_date", tomorrow).maybeSingle(),
    admin
      .from("cron_runs")
      .select("status, started_at, finished_at, error, result")
      .eq("job_name", "long-shot-generate")
      .order("started_at", { ascending: false })
      .limit(14),
    admin
      .from("cron_runs")
      .select("status, started_at, finished_at, error")
      .eq("job_name", "long-shot-settle")
      .order("started_at", { ascending: false })
      .limit(1),
    admin
      .from("long_shot_user_stats")
      .select("user_id, hidden_reason, hidden_at")
      .eq("hidden_from_leaderboards", true)
      .order("hidden_at", { ascending: false })
      .limit(200),
  ]);
  const todayPuzzle = todayRes.data as Puzzle | null;
  const tomorrowPuzzle = tomorrowRes.data as Puzzle | null;

  async function loadPrompts(puzzleId: string) {
    const { data } = await admin
      .from("long_shot_prompts")
      .select("id, position, template_key, prompt_text, answers, answered_total")
      .eq("puzzle_id", puzzleId)
      .order("position", { ascending: true });
    return (data ?? []) as unknown as Array<{ id: string; position: number; template_key: string; prompt_text: string; answers: AnswerEntry[]; answered_total: number }>;
  }

  const tomorrowPrompts = tomorrowPuzzle ? await loadPrompts(tomorrowPuzzle.id) : [];
  const todayPrompts = todayPuzzle ? await loadPrompts(todayPuzzle.id) : [];
  const preview: PreviewPrompt[] = tomorrowPrompts.map((p) => ({
    position: p.position,
    templateKey: p.template_key,
    promptText: p.prompt_text,
    answers: p.answers,
  }));
  const tomorrowNames = await loadPlayerInfo(admin, tomorrowPrompts.flatMap((p) => p.answers.map((a) => a.player_id)));

  // Today's room: answered_total and the top five tallies per prompt.
  const room = await Promise.all(
    todayPrompts.map(async (p) => {
      const { data } = await admin
        .from("long_shot_answer_tallies")
        .select("player_id, count")
        .eq("prompt_id", p.id)
        .order("count", { ascending: false })
        .order("player_id", { ascending: true })
        .limit(5);
      return { prompt: p, top: (data ?? []) as Array<{ player_id: string; count: number }> };
    }),
  );
  const roomNames = await loadPlayerInfo(admin, room.flatMap((r) => r.top.map((t) => t.player_id)));
  const correctIds = new Map(todayPrompts.map((p) => [p.id, new Set(p.answers.map((a) => a.player_id))]));

  const hiddenRows = (hiddenRes.data ?? []) as Array<{ user_id: string; hidden_reason: string | null; hidden_at: string | null }>;
  const identities = await resolveUserIdentities(admin, hiddenRows.map((h) => h.user_id), "private");
  const hidden = hiddenRows.map((h) => ({
    userId: h.user_id,
    name: identities.get(h.user_id)?.displayName ?? "Unknown user",
    reason: h.hidden_reason,
    hiddenAt: h.hidden_at ? formatEastern(h.hidden_at) : "",
  }));

  // The try log: every family tried in the last 14 generate runs.
  type RunResult = { runs?: Array<{ gameDate?: string; log?: TryLog[]; skipped?: boolean }> };
  const tries = (genRuns.data ?? []).flatMap((run) =>
    ((run.result as RunResult | null)?.runs ?? []).flatMap((r) =>
      (r.log ?? []).map((t) => ({ gameDate: r.gameDate ?? "", ranAt: run.started_at, ...t })),
    ),
  );
  const lastGen = genRuns.data?.[0];
  const lastSettle = settleRun.data?.[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Long Shot</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        The daily rarity game at <span className="text-ink">/games/long-shot</span>. Five prompts a day, built at 17:00 UTC the day before and settled at 05:30 UTC the day after.
      </p>

      <Section title="Status">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={`Today (${today})`} value={todayPuzzle ? `${todayPuzzle.status}, ${todayPuzzle.prompt_count} prompts` : "No puzzle yet"} />
          <Stat label="Today's seed salt" value={todayPuzzle ? String(todayPuzzle.seed_salt) : "-"} />
          <Stat label="Finished Hurry-Ups today" value={todayPuzzle ? String(todayPuzzle.completed_attempts) : "0"} />
          <Stat label={`Tomorrow (${tomorrow})`} value={tomorrowPuzzle ? `${tomorrowPuzzle.status}, ${tomorrowPuzzle.prompt_count} prompts` : "Not built yet"} />
        </dl>
        <ul className="mt-4 space-y-1 text-sm text-ink-muted">
          <li>
            Last generate run:{" "}
            {lastGen ? `${lastGen.status}, ${formatEastern(lastGen.started_at)}${lastGen.error ? `. ${lastGen.error}` : ""}` : "none yet"}
          </li>
          <li>
            Last settle run:{" "}
            {lastSettle ? `${lastSettle.status}, ${formatEastern(lastSettle.started_at)}${lastSettle.error ? `. ${lastSettle.error}` : ""}` : "none yet"}
          </li>
        </ul>
        <div className="mt-4">
          <RegenerateControls tomorrow={tomorrow} />
        </div>
      </Section>

      <Section title="Tomorrow's prompts">
        {preview.length === 0 ? (
          <p className="text-sm text-ink-muted">Tomorrow is not built yet. The generate cron builds it at 17:00 UTC, or press Regenerate tomorrow.</p>
        ) : (
          <PuzzlePreview prompts={preview} names={new Map([...tomorrowNames].map(([id, info]) => [id, info.name]))} />
        )}
      </Section>

      <Section title="Today's room">
        <p className="text-sm text-ink-muted">
          Opening this shows today&apos;s most given answers. An admin who opens it has seen correct answers, which is why admins are kept off the boards by default.
        </p>
        <details className="mt-3 rounded-card border border-line p-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-cyan">Show today&apos;s room</summary>
          {room.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No puzzle today yet.</p>
          ) : (
            <ol className="mt-3 space-y-4">
              {room.map(({ prompt, top }) => (
                <li key={prompt.id}>
                  <p className="text-sm font-medium text-ink">
                    {prompt.position}. {prompt.prompt_text}
                  </p>
                  <p className="text-xs text-ink-subtle">{prompt.answered_total} answers in so far</p>
                  <ul className="mt-1 text-xs text-ink-muted">
                    {top.map((t) => (
                      <li key={t.player_id}>
                        {roomNames.get(t.player_id)?.name ?? t.player_id}: {t.count}
                        {correctIds.get(prompt.id)?.has(t.player_id) ? "" : " (not an answer)"}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </details>
      </Section>

      <Section title="Settings">
        <LongShotSettingsManager initialSettings={settings} />
      </Section>

      <Section title="Family tries, last 14 generate runs">
        {tries.length === 0 ? (
          <p className="text-sm text-ink-muted">No generate runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <caption className="sr-only">Each prompt family tried, its parameters, answer count and outcome</caption>
              <thead>
                <tr className="text-left uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-2 pr-3">For</th>
                  <th scope="col" className="py-2 pr-3">Family</th>
                  <th scope="col" className="py-2 pr-3">Parameters</th>
                  <th scope="col" className="py-2 pr-3">Answers</th>
                  <th scope="col" className="py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {tries.slice(0, 200).map((t, i) => (
                  <tr key={i} className="border-t border-line text-ink-muted">
                    <td className="py-1.5 pr-3 font-mono">{t.gameDate}</td>
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">
                      {TEMPLATE_LABELS[t.template_key as TemplateKey] ?? t.template_key}
                    </th>
                    <td className="py-1.5 pr-3 font-mono">{t.params ? JSON.stringify(t.params) : "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.answer_count ?? "-"}</td>
                    <td className="py-1.5">
                      {t.outcome.replace("_", " ")}
                      {t.detail ? `: ${t.detail}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Boards moderation">
        <ModerationControls hidden={hidden} />
      </Section>

      <Section title="Settle">
        <SettleControls yesterday={addDays(today, -1)} />
      </Section>
    </div>
  );
}
