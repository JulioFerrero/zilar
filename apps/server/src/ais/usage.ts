import { and, eq } from 'drizzle-orm';
import type { LitellmAdminClient } from '../ai/litellm-client';
import type { ServerDatabase } from '../db/client';
import { aiDailySpend, aiLimits, ais, llmVirtualKeys } from '../db/schema';

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
}

// The UTC day (`YYYY-MM-DD`) a spend reading belongs to. Spend baselines are
// per UTC day, so the daily window always ends at 00:00 UTC.
export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10);
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
  const [row] = await deps.db
    .select({
      perDayUsd: aiLimits.perDayUsd,
      perMonthUsd: aiLimits.perMonthUsd,
      litellmKeyId: llmVirtualKeys.litellmKeyId,
    })
    .from(ais)
    .innerJoin(aiLimits, eq(aiLimits.aiId, ais.id))
    .leftJoin(llmVirtualKeys, eq(llmVirtualKeys.aiId, ais.id))
    .where(eq(ais.id, aiId))
    .limit(1);
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

  const [baseline] = await deps.db
    .select({ baselineUsd: aiDailySpend.baselineUsd })
    .from(aiDailySpend)
    .where(and(eq(aiDailySpend.aiId, aiId), eq(aiDailySpend.day, day)))
    .limit(1);
  if (!baseline) {
    // First read of the day: record the baseline. `ON CONFLICT DO NOTHING`
    // so two concurrent first reads insert exactly one row and both answer
    // today 0.
    await deps.db
      .insert(aiDailySpend)
      .values({ aiId, day, baselineUsd: usd(windowUsd) })
      .onConflictDoNothing();
    return { todayUsd: 0, windowUsd, perDayUsd, perMonthUsd, dailyLimitReached: 0 >= perDayUsd };
  }

  const baselineUsd = Number(baseline.baselineUsd);
  if (windowUsd < baselineUsd) {
    // The key's 30-day window has reset: the cumulative spend dropped back.
    // Store the new spend as today's baseline and answer 0.
    await deps.db
      .update(aiDailySpend)
      .set({ baselineUsd: usd(windowUsd), updatedAt: new Date() })
      .where(and(eq(aiDailySpend.aiId, aiId), eq(aiDailySpend.day, day)));
    return { todayUsd: 0, windowUsd, perDayUsd, perMonthUsd, dailyLimitReached: 0 >= perDayUsd };
  }

  const todayUsd = windowUsd - baselineUsd;
  return { todayUsd, windowUsd, perDayUsd, perMonthUsd, dailyLimitReached: todayUsd >= perDayUsd };
}

// `numeric` columns are strings; two decimal places is the currency precision
// the schema stores, as in ais/service.ts.
function usd(value: number): string {
  return value.toFixed(2);
}
