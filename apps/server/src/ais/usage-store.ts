// T-1405: the write side of `ai_usage`. Every model call adds its tokens and
// its computed cost to one row per AI per UTC day (docs/audit/effect-ai-plan.md
// §5.3). The upsert is a single `INSERT … ON CONFLICT` so two calls that land
// at once can never lose a counter; a failure logs and never fails the turn.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { ensureModelPrices } from '../ai/catalog';
import { costOf } from '../ai/cost';
import type { ChatUsage } from '../ai/model-client';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { utcDayString } from './usage';

export interface UsageStoreLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface UsageStoreDeps {
  db: ServerDatabase;
  logger?: UsageStoreLogger;
}

/**
 * Adds one call's usage to the AI's `ai_usage` row for the UTC day `now` falls
 * in. The cost is computed from the catalog prices (see `ai/cost.ts`); the
 * whole thing is best effort: a failure logs with the AI id only and resolves,
 * so a turn is never failed by its own accounting.
 */
export async function recordUsage(
  deps: UsageStoreDeps,
  aiId: string,
  provider: string,
  model: string,
  usage: ChatUsage,
  now: Date,
): Promise<void> {
  const day = utcDayString(now);
  try {
    // A cold process may not have the catalog prices yet; warm them once so
    // the first call is priced. The fetch is best effort and never rejects.
    await ensureModelPrices(provider, model);
    const cost = costOf(provider, model, usage, deps.logger).toFixed(6);
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ai_usage
            (ai_id, day, input_tokens, output_tokens, cached_tokens, cache_write_tokens, cost_usd)
          VALUES (${aiId}, ${day}, ${usage.inputTokens}, ${usage.outputTokens},
            ${usage.cacheReadTokens}, ${usage.cacheWriteTokens}, ${cost})
          ON CONFLICT (ai_id, day) DO UPDATE SET
            input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
            output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens,
            cached_tokens = ai_usage.cached_tokens + EXCLUDED.cached_tokens,
            cache_write_tokens = ai_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
            cost_usd = ai_usage.cost_usd + EXCLUDED.cost_usd,
            updated_at = now()`;
      }),
    );
  } catch (error) {
    deps.logger?.warn({ err: error, aiId }, 'AI usage record failed');
  }
}
