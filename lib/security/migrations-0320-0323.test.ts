import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

/** SQL only, comments removed, whitespace collapsed, lower-cased. */
function sql(name: string): string {
  return read(name)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

describe("0320 signal_reports insert guard", () => {
  const body = sql("0320_signal_reports_insert_guard.sql");

  it("forces the status and timestamp a reporter could otherwise choose", () => {
    expect(body).toContain("new.status := 'pending'");
    expect(body).toContain("new.created_at := now()");
  });

  it("refuses a target that is not publicly viewable", () => {
    expect(body).toContain("s.status = 'published'");
    expect(body).toContain("s.visibility = 'public'");
    expect(body).toContain("not s.hidden");
  });

  it("enforces the route's three rate limits", () => {
    expect(body).toContain("interval '15 seconds'");
    expect(body).toMatch(/recent_hour >= 10/);
    expect(body).toMatch(/recent_day >= 40/);
  });

  it("fires before insert and pins the search path", () => {
    expect(body).toContain("before insert on public.signal_reports");
    expect(body).toContain("security definer set search_path = ''");
    expect(body).toContain("from public, anon, authenticated");
  });
});

describe("0321 ranking board cap", () => {
  const body = sql("0321_ranking_board_player_cap.sql");

  it("rejects a board over 2000 players on insert and on update", () => {
    expect(body).toContain("having count(*) > 2000");
    expect(body).toContain("after insert on public.user_ranking_board_players referencing new table as new_rows");
    expect(body).toContain("after update on public.user_ranking_board_players referencing new table as new_rows");
  });
});

describe("0323 sleeper_league_settings is server-written", () => {
  const body = sql("0323_user_preferences_sleeper_settings_server_only.sql");

  it("revokes only that column, from all three client roles", () => {
    expect(body).toContain(
      "revoke insert (sleeper_league_settings), update (sleeper_league_settings) on public.user_preferences from public, anon, authenticated",
    );
    // No table-wide revoke that would take the other columns with it.
    expect(body).not.toMatch(/revoke [a-z, ]+ on (table )?public\.user_preferences/);
  });

  it("says in its header that it must wait for the deploy", () => {
    expect(read("0323_user_preferences_sleeper_settings_server_only.sql")).toMatch(
      /DO NOT APPLY UNTIL THE CODE/,
    );
  });
});
