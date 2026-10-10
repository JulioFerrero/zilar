import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LitellmAdminClient } from '../ai/litellm-client';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

export interface AiUsageLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface AiUsageDeps {
  db: ServerDatabase;
  litellm: LitellmAdminClient;
  logger?: AiUsageLogger;
  now?: () => Date;
}

export interface AiUsage {
  todayUsd: number;
  windowUsd: number;
  perDayUsd: number;
  perMonthUsd: number;
  dailyLimitReached: boolean;
  dailyWarning: boolean;
  monthlyWarning: boolean;
}

// The UTC day (`YYYY-MM-DD`) a spend reading belongs to. Spend baselines are
// per UTC day, so the daily window always ends at 00:00 UTC.
export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// `numeric` columns come back as strings from node-postgres (and PGlite), so
// these stay `string` and the reads below convert them with `Number(...)`.
interface AiLimitRow {
  perDayUsd: string;
  perMonthUsd: string;
  litellmKeyId: string | null;
}

interface BaselineRow {
  baselineUsd: string;
}

// Reads one AI's spend from LiteLLM's cumulative key spend and derives today's
// spend from the stored baseline, as decided in T-0058:
// - the first read of a UTC day records the current spend as the baseline, so
//   today's spend is 0 by definition;
// - a later read answers the delta between the current spend and the baseline;
// - a spend lower than the baseline means the key's 30-day budget window has
//   reset, so the baseline is replaced and today is 0 again.
// LiteLLM writes spend in batches, so these numbers lag a turn or two behind
// reality. That makes the daily limit derived from them a soft limit: a last
// reply may slip through just over the cap.
//
// A LiteLLM failure returns null, and callers fail open (the turn goes ahead).
// The monthly cap is still enforced by LiteLLM itself, so failing closed would
// only break the AI while LiteLLM hiccups. Log lines carry the AI id, never
// the key or its spend source: only ids travel here.
export async function getAiUsage(deps: AiUsageDeps, aiId: string): Promise<AiUsage | null> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiLimitRow>`SELECT l.per_day_usd, l.per_month_usd, k.litellm_key_id
        FROM ais a
        INNER JOIN ai_limits l ON l.ai_id = a.id
        LEFT JOIN llm_virtual_keys k ON k.ai_id = a.id
        WHERE a.id = ${aiId}
        LIMIT 1`;
    }),
  );
  if (!row || row.litellmKeyId === null) {
    return null;
  }

  // The token id addresses the key: the usable `sk-...` secret is never read
  // here and never reaches a log line.
  const keyId = row.litellmKeyId;
  let spend: number;
  try {
    spend = (await deps.litellm.getKeyInfo(keyId)).spend;
  } catch (error) {
    deps.logger?.warn({ err: error, aiId }, 'AI spend lookup failed; usage is unavailable');
    return null;
  }
  if (!Number.isFinite(spend)) {
    deps.logger?.warn({ aiId }, 'AI spend lookup answered a non-numeric spend');
    return null;
  }

  const perDayUsd = Number(row.perDayUsd);
  const perMonthUsd = Number(row.perMonthUsd);
  const windowUsd = Math.max(0, spend);
  const day = utcDayString((deps.now ?? (() => new Date()))());

  const [baseline] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BaselineRow>`SELECT baseline_usd FROM ai_daily_spend
        WHERE ai_id = ${aiId} AND day = ${day}
        LIMIT 1`;
    }),
  );
  if (!baseline) {
    // First read of the day: record the baseline. `ON CONFLICT DO NOTHING`
    // so two concurrent first reads insert exactly one row and both answer
    // today 0.
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ai_daily_spend (ai_id, day, baseline_usd)
          VALUES (${aiId}, ${day}, ${usd(windowUsd)})
          ON CONFLICT DO NOTHING`;
      }),
    );
    return {
      todayUsd: 0,
      windowUsd,
      perDayUsd,
      perMonthUsd,
      dailyLimitReached: 0 >= perDayUsd,
      dailyWarning: false,
      monthlyWarning: monthlyWarns(windowUsd, perMonthUsd),
    };
  }

  const baselineUsd = Number(baseline.baselineUsd);
  if (windowUsd < baselineUsd) {
    // The key's 30-day window has reset: the cumulative spend dropped back.
    // Store the new spend as today's baseline and answer 0.
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ai_daily_spend
          SET baseline_usd = ${usd(windowUsd)}, updated_at = ${new Date().toISOString()}
          WHERE ai_id = ${aiId} AND day = ${day}`;
      }),
    );
    return {
      todayUsd: 0,
      windowUsd,
      perDayUsd,
      perMonthUsd,
      dailyLimitReached: 0 >= perDayUsd,
      dailyWarning: false,
      monthlyWarning: monthlyWarns(windowUsd, perMonthUsd),
    };
  }

  const todayUsd = windowUsd - baselineUsd;
  const dailyLimitReached = todayUsd >= perDayUsd;
  return {
    todayUsd,
    windowUsd,
    perDayUsd,
    perMonthUsd,
    dailyLimitReached,
    dailyWarning: dailyLimitReached ? false : dailyWarns(todayUsd, perDayUsd),
    monthlyWarning: monthlyWarns(windowUsd, perMonthUsd),
  };
}

// `numeric` columns are strings; two decimal places is the currency precision
// the schema stores, as in ais/service.ts.
function usd(value: number): string {
  return value.toFixed(2);
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
