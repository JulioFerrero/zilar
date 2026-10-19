// Every call adds its tokens and cost to one row per AI per UTC day; the single
// `INSERT … ON CONFLICT` keeps concurrent calls from losing a counter.
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

// Every in-flight `recordUsage`, keyed by AI id. The budget gate settles these
// before reading spend, so a fast loop cannot read stale counters. The writes
// stay fire and forget: this map only observes them.
const pendingUsage = new Map<string, Set<Promise<void>>>();

const DEFAULT_SETTLE_TIMEOUT_MS = 3000;

// Observes one write until it settles, then forgets it; the write is the
// caller's.
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
  // Both handlers, so a rejection still forgets the write and never escapes.
  void write.then(forget, forget);
}

/**
 * Waits for in-flight usage writes or `timeoutMs`, whichever comes first; never
 * rejects, so a hanging write cannot hold a turn open.
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
 * Best effort: a failure logs with the AI id only and resolves, so a turn is
 * never failed by its own accounting. The promise is tracked for the budget gate.
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

const ZERO_USAGE: ChatUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * A flat tool cost (for example a billed search) adds money and zero tokens to
 * the same daily row; best effort like `recordUsage`.
 */
export function recordToolCost(
  deps: UsageStoreDeps,
  aiId: string,
  costUsd: number,
  now: Date,
): Promise<void> {
  const write = writeCost(deps, aiId, costUsd, now);
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
  try {
    // A cold process has no catalog prices yet; warm them so the first call is
    // priced.
    await ensureModelPrices(provider, model);
    const cost = costOf(provider, model, usage, deps.logger).toFixed(6);
    await addUsage(deps, aiId, usage, cost, utcDayString(now));
  } catch (error) {
    deps.logger?.warn({ err: error, aiId }, 'AI usage record failed');
  }
}

async function writeCost(
  deps: UsageStoreDeps,
  aiId: string,
  costUsd: number,
  now: Date,
): Promise<void> {
  try {
    await addUsage(deps, aiId, ZERO_USAGE, costUsd.toFixed(6), utcDayString(now));
  } catch (error) {
    deps.logger?.warn({ err: error, aiId }, 'AI usage record failed');
  }
}

async function addUsage(
  deps: UsageStoreDeps,
  aiId: string,
  usage: ChatUsage,
  cost: string,
  day: string,
): Promise<void> {
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
}
