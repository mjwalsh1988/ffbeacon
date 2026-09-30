import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  CRON_JOBS,
  PLAYERS_GAME_DAY_SCHEDULES,
  PROJECTIONS_GAME_DAY_SCHEDULES,
  allSchedules,
} from "./cron-runs";

/**
 * vercel.json is what the platform runs; CRON_JOBS is what the health check and
 * the admin panels believe runs. They drifted apart twice without anyone
 * noticing (sync-dynastyprocess at 09:15 against a registry saying 09:00,
 * sync-nfl-odds at 13:15 against 13:00), so the missed-run check measured
 * against the wrong time. This fails the moment the two disagree in either
 * direction.
 */

const ROOT = join(__dirname, "..");
const CRON_DIR = join(ROOT, "app", "api", "cron");

type VercelCron = { path: string; schedule: string };

function vercelCrons(): VercelCron[] {
  const raw = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons?: VercelCron[] };
  return raw.crons ?? [];
}

/**
 * The job name a cron path records under. Read from the route's own
 * recordCronRun call, because the folder and the name legitimately differ
 * (app/api/cron/beacon-brief records "beacon-brief-curate"). A route that does
 * not exist yet falls back to its folder name.
 */
function jobNameForPath(path: string): string {
  const folder = path.replace(/^\/api\/cron\//, "").split("?")[0];
  const route = join(CRON_DIR, folder, "route.ts");
  if (!existsSync(route)) return folder;
  const match = /recordCronRun\(\s*\w+\s*,\s*"([^"]+)"/.exec(readFileSync(route, "utf8"));
  return match ? match[1] : folder;
}

describe("vercel.json and CRON_JOBS agree", () => {
  const crons = vercelCrons();

  const fromVercel = new Map<string, string[]>();
  for (const c of crons) {
    const name = jobNameForPath(c.path);
    fromVercel.set(name, [...(fromVercel.get(name) ?? []), c.schedule.trim()]);
  }

  it("reads a non-trivial vercel.json", () => {
    expect(crons.length).toBeGreaterThan(10);
  });

  it.each(CRON_JOBS.filter((j) => allSchedules(j).length > 0).map((j) => [j.name, j] as const))(
    "%s runs on exactly the schedules the registry lists",
    (name, job) => {
      const expected = [...allSchedules(job)].sort();
      const actual = [...(fromVercel.get(name) ?? [])].sort();
      expect(actual, `${name}: vercel.json ${JSON.stringify(actual)} vs CRON_JOBS ${JSON.stringify(expected)}`).toEqual(
        expected,
      );
    },
  );

  it("has no vercel.json cron the registry does not know about", () => {
    const registered = new Set<string>(CRON_JOBS.map((j) => j.name));
    const unknown = [...fromVercel.keys()].filter((name) => !registered.has(name));
    expect(unknown).toEqual([]);
  });
});

/** Minutes after midnight UTC, and the UTC day(s) of week, of one cron entry. */
function parse(schedule: string): { minuteOfDay: number; days: number[]; months: number[] } {
  const [minute, hour, , month, dow] = schedule.split(/\s+/);
  return {
    minuteOfDay: Number(hour) * 60 + Number(minute),
    days: dow === "*" ? [0, 1, 2, 3, 4, 5, 6] : dow.split(",").map(Number),
    months: month === "*" ? [] : month.split(",").map(Number),
  };
}

describe("game-day refresh schedule (owner's rule)", () => {
  it("adds runs on Sunday, Monday and Thursday UTC only, never on Tuesday, Wednesday, Friday or Saturday", () => {
    for (const s of [...PLAYERS_GAME_DAY_SCHEDULES, ...PROJECTIONS_GAME_DAY_SCHEDULES]) {
      for (const day of parse(s).days) expect([0, 1, 4]).toContain(day);
    }
  });

  it("lands every extra run on an Eastern Sunday, Monday or Thursday too, in both EDT and EST", () => {
    for (const s of [...PLAYERS_GAME_DAY_SCHEDULES, ...PROJECTIONS_GAME_DAY_SCHEDULES]) {
      const { minuteOfDay, days } = parse(s);
      for (const day of days) {
        for (const offset of [4, 5]) {
          const easternMinute = minuteOfDay - offset * 60;
          const easternDay = easternMinute < 0 ? (day + 6) % 7 : day;
          expect([0, 1, 4], `${s} at UTC-${offset}`).toContain(easternDay);
        }
      }
    }
  });

  it("runs each player sync before its projection sync, ten minutes apart", () => {
    expect(PLAYERS_GAME_DAY_SCHEDULES).toHaveLength(PROJECTIONS_GAME_DAY_SCHEDULES.length);
    PLAYERS_GAME_DAY_SCHEDULES.forEach((s, i) => {
      const players = parse(s);
      const projections = parse(PROJECTIONS_GAME_DAY_SCHEDULES[i]);
      expect(projections.minuteOfDay - players.minuteOfDay).toBe(10);
      expect(projections.days).toEqual(players.days);
    });
  });

  it("puts a pre-kickoff pass after inactives and before kickoff in both offsets", () => {
    // Eastern kickoff (minutes after midnight) and the UTC day it falls on.
    const windows = [
      { name: "Sunday 1:00 PM", kickoff: 13 * 60, day: 0 },
      { name: "Sunday 4:05 PM", kickoff: 16 * 60 + 5, day: 0 },
      { name: "Sunday 8:20 PM", kickoff: 20 * 60 + 20, day: 0 },
      { name: "Thursday 8:15 PM", kickoff: 20 * 60 + 15, day: 4 },
      { name: "Monday 8:15 PM", kickoff: 20 * 60 + 15, day: 1 },
    ];
    for (const w of windows) {
      for (const offset of [4, 5]) {
        const hit = PROJECTIONS_GAME_DAY_SCHEDULES.map(parse).some((p) => {
          const eastern = p.minuteOfDay - offset * 60;
          return (
            p.days.includes(w.day) && eastern < w.kickoff && eastern >= w.kickoff - 90
          );
        });
        expect(hit, `${w.name} at UTC-${offset}`).toBe(true);
      }
    }
  });

  it("is off outside September to February", () => {
    for (const s of [...PLAYERS_GAME_DAY_SCHEDULES, ...PROJECTIONS_GAME_DAY_SCHEDULES]) {
      expect(parse(s).months.sort((a, b) => a - b)).toEqual([1, 2, 9, 10, 11, 12]);
    }
  });

  it("keeps the extra runs modest: at most five per job per game day", () => {
    for (const list of [PLAYERS_GAME_DAY_SCHEDULES, PROJECTIONS_GAME_DAY_SCHEDULES]) {
      for (const day of [0, 1, 4]) {
        expect(list.filter((s) => parse(s).days.includes(day)).length).toBeLessThanOrEqual(5);
      }
    }
  });
});
