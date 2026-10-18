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
  monthlyLimitReached: boolean;
  dailyWarning: boolean;
  monthlyWarning: boolean;
}

// `ai_usage` is keyed by UTC day, so the daily window ends at 00:00 UTC.
export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// `numeric` comes back as a string from node-postgres (and PGlite), so the rows
// stay `string`. A null bound means the owner set no limit.
interface AiLimitRow {
  perDayUsd: string | null;
  perMonthUsd: string | null;
}

interface AiUsageSumRow {
  todayUsd: string;
  windowUsd: string;
}

// Today's spend and the last 30 UTC days (today included). A null bound means no
// limit, so its flags stay false; an AI with no limits row answers null.
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
  const monthlyLimitReached = perMonthUsd !== null && windowUsd >= perMonthUsd;
  return {
    todayUsd,
    windowUsd,
    perDayUsd,
    perMonthUsd,
    dailyLimitReached,
    monthlyLimitReached,
    dailyWarning: perDayUsd === null || dailyLimitReached ? false : dailyWarns(todayUsd, perDayUsd),
    monthlyWarning:
      perMonthUsd === null || monthlyLimitReached ? false : monthlyWarns(windowUsd, perMonthUsd),
  };
}

// Integer cents avoid float surprises at exactly 80% (1.60 of 2.00 must warn).
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
