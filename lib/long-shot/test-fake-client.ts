/**
 * A small in-memory stand-in for the Supabase client, for the Long Shot
 * engine tests. Test-only. It supports exactly the query shapes the engine
 * uses: select/insert/update/upsert with eq, is, in, gt, lt, gte, lte,
 * order, limit, single and maybeSingle, a head count, and the three Long
 * Shot RPCs. Column lists are ignored (whole rows come back), which is
 * enough for the engine's reads.
 */

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
}

let idSeq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`;

const UNIQUE: Record<string, string[][]> = {
  long_shot_answers: [["attempt_id", "position"]],
  long_shot_puzzles: [["game_date"]],
  long_shot_user_stats: [["user_id"]],
};

function violates(table: string, rows: Row[], row: Row): boolean {
  for (const cols of UNIQUE[table] ?? []) {
    if (rows.some((r) => cols.every((c) => r[c] === row[c]))) return true;
  }
  if (table === "long_shot_attempts" && row.mode === "hurry_up") {
    return rows.some((r) => r.mode === "hurry_up" && r.user_id === row.user_id && r.game_date === row.game_date);
  }
  return false;
}

export function makeFakeClient(db: FakeDb) {
  function builder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let head = false;
    let returning = false;

    const rows = () => (db.tables[table] ??= []);

    function run(): { data: unknown; error: { message: string; code?: string } | null; count?: number } {
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload!];
        const out: Row[] = [];
        for (const raw of list) {
          const row: Row = { ...defaults(table), ...raw };
          if (op === "upsert" && table === "long_shot_user_stats") {
            const existing = rows().find((r) => r.user_id === row.user_id);
            if (existing) {
              Object.assign(existing, raw);
              out.push(existing);
              continue;
            }
          }
          if (violates(table, rows(), row)) return { data: null, error: { message: "duplicate", code: "23505" } };
          if (!row.id && table !== "long_shot_user_stats" && table !== "long_shot_answer_tallies") row.id = newId();
          rows().push(row);
          out.push(row);
        }
        return { data: out, error: null };
      }
      let matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, payload);
        return { data: returning ? matched : null, error: null };
      }
      if (op === "delete") {
        db.tables[table] = rows().filter((r) => !matched.includes(r));
        return { data: null, error: null };
      }
      if (order) {
        const { col, asc } = order;
        matched = matched.slice().sort((a, b) => {
          const x = a[col] as number | string;
          const y = b[col] as number | string;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (limit !== null) matched = matched.slice(0, limit);
      if (head) return { data: null, error: null, count: matched.length };
      return { data: matched, error: null };
    }

    const api: Record<string, unknown> = {
      select(_cols?: string, opts?: { head?: boolean }) {
        if (op !== "select") returning = true;
        if (opts?.head) head = true;
        return api;
      },
      insert(p: Row | Row[]) {
        op = "insert";
        payload = p;
        return api;
      },
      upsert(p: Row | Row[]) {
        op = "upsert";
        payload = p;
        return api;
      },
      update(p: Row) {
        op = "update";
        payload = p;
        return api;
      },
      delete() {
        op = "delete";
        return api;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return api;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return api;
      },
      in(c: string, v: unknown[]) {
        filters.push((r) => v.includes(r[c]));
        return api;
      },
      gt(c: string, v: number) {
        filters.push((r) => (r[c] as number) > v);
        return api;
      },
      lt(c: string, v: string | number) {
        filters.push((r) => (r[c] as string | number) < v);
        return api;
      },
      gte(c: string, v: string | number) {
        filters.push((r) => (r[c] as string | number) >= v);
        return api;
      },
      lte(c: string, v: string | number) {
        filters.push((r) => (r[c] as string | number) <= v);
        return api;
      },
      not() {
        return api;
      },
      or() {
        return api;
      },
      order(col: string, o?: { ascending?: boolean }) {
        order = { col, asc: o?.ascending !== false };
        return api;
      },
      limit(n: number) {
        limit = n;
        return api;
      },
      range() {
        return api;
      },
      single() {
        const res = run();
        const list = (res.data as Row[] | null) ?? [];
        if (res.error) return Promise.resolve(res);
        if (list.length !== 1) return Promise.resolve({ data: null, error: { message: "not single" } });
        return Promise.resolve({ data: list[0], error: null });
      },
      maybeSingle() {
        const res = run();
        if (res.error) return Promise.resolve(res);
        const list = (res.data as Row[] | null) ?? [];
        return Promise.resolve({ data: list[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
      },
    };
    return api;
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    db.rpcCalls.push({ fn, args });
    if (fn === "long_shot_increment_tally") {
      const tallies = (db.tables.long_shot_answer_tallies ??= []);
      if (args.p_player_id) {
        const t = tallies.find((r) => r.prompt_id === args.p_prompt_id && r.player_id === args.p_player_id);
        if (t) t.count = (t.count as number) + 1;
        else tallies.push({ prompt_id: args.p_prompt_id, player_id: args.p_player_id, count: 1 });
      }
      const p = db.tables.long_shot_prompts.find((r) => r.id === args.p_prompt_id);
      if (p) p.answered_total = (p.answered_total as number) + 1;
      return { data: null, error: null };
    }
    if (fn === "long_shot_complete_attempt") {
      const a = db.tables.long_shot_attempts.find((r) => r.id === args.p_attempt_id);
      const puzzle = a && db.tables.long_shot_puzzles.find((p) => p.id === a.puzzle_id);
      if (!a || !puzzle || a.status !== "active" || a.current_position !== (puzzle.prompt_count as number) + 1) {
        return { data: [], error: null };
      }
      a.status = "completed";
      a.completed_at = new Date().toISOString();
      a.total_points = a.base_points;
      if (a.mode === "hurry_up") puzzle.completed_attempts = (puzzle.completed_attempts as number) + 1;
      return { data: [a], error: null };
    }
    if (fn === "long_shot_record_completion") {
      const a = db.tables.long_shot_attempts.find(
        (r) => r.id === args.p_attempt_id && r.user_id === args.p_user_id && r.mode === "hurry_up" && r.status === "completed" && !r.stats_recorded_at,
      );
      if (!a) return { data: false, error: null };
      a.stats_recorded_at = new Date().toISOString();
      const stats = (db.tables.long_shot_user_stats ??= []);
      const values = {
        user_id: args.p_user_id,
        days_played: args.p_days_played,
        total_points: args.p_total_points,
        best_day_points: args.p_best_day_points,
        long_shots: args.p_long_shots,
        last_completed_date: args.p_last_completed_date,
        current_streak: args.p_current_streak,
        best_streak: args.p_best_streak,
        first_completed_at: args.p_first_completed_at,
      };
      const existing = stats.find((s) => s.user_id === args.p_user_id);
      if (existing) Object.assign(existing, values);
      else stats.push({ ...defaults("long_shot_user_stats"), ...values });
      return { data: true, error: null };
    }
    if (fn === "long_shot_settle_attempt") {
      const a = db.tables.long_shot_attempts.find((r) => r.id === args.p_attempt_id && !r.settled_at);
      if (!a) return { data: false, error: null };
      const bonus = args.p_bonus as number;
      const ids = (args.p_lone_ids as string[]) ?? [];
      Object.assign(a, { bonus_points: bonus, total_points: (a.base_points as number) + bonus, settled_at: new Date().toISOString() });
      for (const ans of db.tables.long_shot_answers) if (ans.attempt_id === a.id && ids.includes(ans.id as string)) ans.lone_signal = true;
      if (args.p_pay_stats && (bonus > 0 || ids.length > 0)) {
        const stats = (db.tables.long_shot_user_stats ??= []);
        const row = stats.find((s) => s.user_id === a.user_id);
        if (row) {
          row.total_points = (row.total_points as number) + bonus;
          row.lone_signals = (row.lone_signals as number) + ids.length;
        } else stats.push({ ...defaults("long_shot_user_stats"), user_id: a.user_id, total_points: bonus, lone_signals: ids.length });
      }
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }

  return { from: builder, rpc } as never;
}

function defaults(table: string): Row {
  if (table === "long_shot_attempts") {
    return {
      status: "active",
      current_position: 1,
      base_points: 0,
      bonus_points: 0,
      total_points: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      stats_recorded_at: null,
      settled_at: null,
    };
  }
  if (table === "long_shot_answers") {
    return { answered_at: null, player_id: null, correct: null, tier: null, points: 0, lone_signal: false };
  }
  if (table === "long_shot_user_stats") {
    return {
      days_played: 0,
      total_points: 0,
      best_day_points: 0,
      long_shots: 0,
      lone_signals: 0,
      last_completed_date: null,
      current_streak: 0,
      best_streak: 0,
      first_completed_at: null,
      hidden_from_leaderboards: false,
    };
  }
  return {};
}
