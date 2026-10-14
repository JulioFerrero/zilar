import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

export interface AiUsageDeps {
  db: ServerDatabase;
  now?: () => Date;
}

export interface AiUsage {
  todayUsd: number;
  windowUsd: number;
  perDayUsd: number | null;
  perMonthUsd: number | null;
  dailyLimitReached: boolean;
  dailyWarning: boolean;
  monthlyWarning: boolean;
}

// The UTC day (`YYYY-MM-DD`) a usage reading belongs to. `ai_usage` rows are
// keyed by UTC day, so the daily window always ends at 00:00 UTC.
export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// `numeric` columns come back as strings from node-postgres (and PGlite), so
// the limit and sum rows stay `string` and the read below converts them. A
// `null` bound (T-1408) means the owner set no limit.
interface AiLimitRow {
  perDayUsd: string | null;
  perMonthUsd: string | null;
}

interface AiUsageSumRow {
  todayUsd: string;
  windowUsd: string;
}

// Reads one AI's spend from `ai_usage` (T-1405): today's `cost_usd` sum and the
// sum over the last 30 UTC days (today included, the 31st day back excluded).
// The limit fields keep working from `ai_limits` as before; an AI with no
// limits row answers null and callers fail open. T-1408: a NULL bound means no
// limit, so the reached/warning flags stay false for it. A database error
// throws and the caller decides.
export async function getAiUsage(deps: AiUsageDeps, aiId: string): Promise<AiUsage | null> {
  const day = utcDayString((deps.now ?? (() => new Date()))());
  const [limits] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiLimitRow>`SELECT per_day_usd, per_month_usd
        FROM ai_limits
        WHERE ai_id = ${aiId}
        LIMIT 1`;
    }),
  );
  if (!limits) {
    return null;
  }

  const [sums] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiUsageSumRow>`SELECT
        COALESCE(SUM(cost_usd) FILTER (WHERE day = ${day}::date), 0)::text AS today_usd,
        COALESCE(SUM(cost_usd) FILTER (WHERE day > ${day}::date - INTERVAL '30 days'), 0)::text AS window_usd
        FROM ai_usage
        WHERE ai_id = ${aiId}`;
    }),
  );

  const perDayUsd = limits.perDayUsd === null ? null : Number(limits.perDayUsd);
  const perMonthUsd = limits.perMonthUsd === null ? null : Number(limits.perMonthUsd);
  const todayUsd = Number(sums?.todayUsd ?? 0);
  const windowUsd = Number(sums?.windowUsd ?? 0);
  const dailyLimitReached = perDayUsd !== null && todayUsd >= perDayUsd;
  return {
    todayUsd,
    windowUsd,
    perDayUsd,
    perMonthUsd,
    dailyLimitReached,
    dailyWarning: perDayUsd === null || dailyLimitReached ? false : dailyWarns(todayUsd, perDayUsd),
    monthlyWarning: perMonthUsd === null ? false : monthlyWarns(windowUsd, perMonthUsd),
  };
}

// Cents-safe 80% checks: integer cents avoid float surprises at exactly 80%
// (1.60 of 2.00 must warn). `today >= 0.8 * perDay` becomes
// `todayCents * 5 >= perDayCents * 4` with no floats involved.
function toCents(value: number): number {
  return Math.round(value * 100);
}

function dailyWarns(todayUsd: number, perDayUsd: number): boolean {
  const todayCents = toCents(todayUsd);
  const perDayCents = toCents(perDayUsd);
  return perDayCents > 0 && todayCents * 5 >= perDayCents * 4;
}

function monthlyWarns(windowUsd: number, perMonthUsd: number): boolean {
  const windowCents = toCents(windowUsd);
  const perMonthCents = toCents(perMonthUsd);
  return perMonthCents > 0 && windowCents * 5 >= perMonthCents * 4 && windowCents < perMonthCents;
}
