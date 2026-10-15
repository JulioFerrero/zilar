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

// T-1461: every in-flight `recordUsage` promise, keyed by AI id. The budget
// gate settles these before it reads `ai_usage`, so a fast tool loop or
// back-to-back turns cannot read spend that is missing the write that just
// finished. The writes stay fire and forget: this map only observes them.
const pendingUsage = new Map<string, Set<Promise<void>>>();

const DEFAULT_SETTLE_TIMEOUT_MS = 3000;

// Observes one in-flight write until it settles, then forgets it. The write
// itself is the caller's; both outcomes (settled or not) drop it from the map.
function trackPendingUsage(aiId: string, write: Promise<void>): void {
  let inFlight = pendingUsage.get(aiId);
  if (inFlight === undefined) {
    inFlight = new Set();
    pendingUsage.set(aiId, inFlight);
  }
  const set = inFlight;
  set.add(write);
  const forget = (): void => {
    set.delete(write);
    if (set.size === 0 && pendingUsage.get(aiId) === set) {
      pendingUsage.delete(aiId);
    }
  };
  // `then` with both handlers, so a rejection still forgets the write and the
  // derived promise never rejects (the write itself never rejects anyway).
  void write.then(forget, forget);
}

/**
 * Waits for the AI's current in-flight usage writes to reach `ai_usage`, or
 * `timeoutMs`, whichever comes first. Never rejects: a hanging write cannot
 * hold a turn open past the timeout. The budget gate calls this before it
 * reads spend so a fast loop cannot run on stale counters.
 */
export async function settlePendingUsage(
  aiId: string,
  timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
): Promise<void> {
  const inFlight = pendingUsage.get(aiId);
  if (inFlight === undefined || inFlight.size === 0) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = Promise.allSettled(inFlight).then(() => undefined);
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([settled, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Adds one call's usage to the AI's `ai_usage` row for the UTC day `now` falls
 * in. The cost is computed from the catalog prices (see `ai/cost.ts`); the
 * whole thing is best effort: a failure logs with the AI id only and resolves,
 * so a turn is never failed by its own accounting. T-1461: the returned promise
 * is tracked so the budget gate can wait for it (bounded) before reading spend.
 */
export function recordUsage(
  deps: UsageStoreDeps,
  aiId: string,
  provider: string,
  model: string,
  usage: ChatUsage,
  now: Date,
): Promise<void> {
  const write = writeUsage(deps, aiId, provider, model, usage, now);
  trackPendingUsage(aiId, write);
  return write;
}

async function writeUsage(
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
