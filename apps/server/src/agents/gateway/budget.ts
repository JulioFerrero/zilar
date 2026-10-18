import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { getAiUsage, type AiUsage } from '../../ais/usage';
import { settlePendingUsage } from '../../ais/usage-store';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import {
  dailyLimitReply,
  dailyWarningReply,
  monthlyLimitReply,
  monthlyWarningReply,
} from '../reply';
import { loadAiOwnerId } from './db';
import {
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
} from './contracts';

interface BudgetGateContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  sessionIsLive: (session: AiSession) => boolean;
  secretsFor: (secret?: string) => string[];
}

const FAILED = Symbol('failed');

interface AiLimitRow {
  perDayUsd: string | null;
  perMonthUsd: string | null;
}

// The AI's own spend bounds. A `null` bound means none for that window; a
// missing row means the AI has no limits. A failed read rejects, and callers
// treat the unknown bound as limited (money first). `numeric` columns come
// back as strings, so the per-day cap is converted here.
async function limitsFor(
  db: ServerDatabase,
  aiId: string,
): Promise<{ hasLimit: boolean; perDayUsd: number | null }> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiLimitRow>`SELECT per_day_usd, per_month_usd
        FROM ai_limits WHERE ai_id = ${aiId} LIMIT 1`;
    }),
  );
  if (row === undefined) {
    return { hasLimit: false, perDayUsd: null };
  }
  return {
    hasLimit: row.perDayUsd !== null || row.perMonthUsd !== null,
    perDayUsd: row.perDayUsd === null ? null : Number(row.perDayUsd),
  };
}

// Runs a Promise call as an Effect. A rejection (or a synchronous throw) dies
// with the original value; `onError` observes it (or logs it) and the call
// answers `FAILED`, so the failure never leaves the turn.
function attempt<A>(
  run: () => PromiseLike<A>,
  onError: (error: unknown) => void,
): Effect.Effect<A | typeof FAILED> {
  return Effect.promise(run).pipe(
    Effect.catchDefect((error) =>
      Effect.sync((): typeof FAILED => {
        onError(error);
        return FAILED;
      }),
    ),
  );
}

// The fixed notice for a limited AI. The monthly cap wins when both are
// reached: it is the one that keeps the AI stopped for the rest of the period.
function limitReachedReply(usage: AiUsage): string {
  if (usage.monthlyLimitReached) {
    return monthlyLimitReply(usage.perMonthUsd ?? 0);
  }
  return dailyLimitReply(usage.perDayUsd ?? 0);
}

export function createBudgetGate(ctx: BudgetGateContext) {
  const { deps, logger, sessionIsLive, secretsFor } = ctx;

  // One fixed notice per AI per chat per UTC day, in memory only. Both the
  // daily and the monthly limit share it. After a restart the map is empty, so
  // a limited AI may notify once more.
  const dailyLimitNotices = new Map<string, string>();
  // One 80% heads-up per kind per AI per chat per UTC day, in memory only.
  // Daily and monthly warnings are independent; a restart may repeat one.
  const dailyWarningNotices = new Map<string, string>();
  const monthlyWarningNotices = new Map<string, string>();
  // One owner DM per AI per room per UTC day when a room turn fails — the same
  // in-memory day key as `dailyLimitNotices`; a restart may repeat one.
  const ownerFailureNotices = new Map<string, string>();

  function utcDay(): string {
    return (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  }

  const usageFor = async (aiId: string): Promise<AiUsage | null> => {
    // A write from the call that just finished may still be in flight (fire
    // and forget). Wait for it, bounded, so the gate never reads spend missing
    // the last call.
    await settlePendingUsage(aiId);
    return getAiUsage(
      {
        db: deps.db,
        ...(deps.now === undefined ? {} : { now: deps.now }),
      },
      aiId,
    );
  };

  // The spend-limit check, shared by DM and group turns. It runs before any
  // model call; a NULL daily bound never skips the turn. A usage-read failure
  // fails closed when the AI has a limit (skip and send the notice), while an
  // AI with no limit keeps the fail-open path. An unreadable bound counts as
  // set, so an outage never lets a limited AI run past its cap. The fetched
  // usage is returned for the 80% warnings; only ids are ever logged.
  const checkDailyLimitEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    chatKey: string;
    sendNotice: (text: string) => Promise<unknown>;
  }): Effect.fn.Return<{ limited: boolean; usage: AiUsage | null }> {
    let usageError: unknown;
    const fetched = yield* attempt(
      () => usageFor(input.aiId),
      (error) => {
        usageError = error;
      },
    );
    if (fetched === FAILED) {
      const limits = yield* attempt(
        () => limitsFor(deps.db, input.aiId),
        () => undefined,
      );
      if (limits !== FAILED && !limits.hasLimit) {
        logger.warn(
          { err: toRedactedError(usageError, secretsFor()), aiId: input.aiId },
          'AI usage check failed; failing open (no spend limit set)',
        );
        return { limited: false, usage: null };
      }
      logger.warn(
        { err: toRedactedError(usageError, secretsFor()), aiId: input.aiId },
        'AI usage check failed; failing closed (a spend limit is set)',
      );
      const today = utcDay();
      const key = `${input.aiId}:${input.chatKey}`;
      if (dailyLimitNotices.get(key) === today) {
        return { limited: true, usage: null };
      }
      const perDayUsd = limits === FAILED ? 0 : (limits.perDayUsd ?? 0);
      const sent = yield* attempt(
        () => input.sendNotice(dailyLimitReply(perDayUsd)),
        (error) => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
            'AI daily-limit notice could not be sent',
          );
        },
      );
      if (sent !== FAILED) {
        dailyLimitNotices.set(key, today);
      }
      return { limited: true, usage: null };
    }
    const usage = fetched;
    if (usage === null || (!usage.dailyLimitReached && !usage.monthlyLimitReached)) {
      return { limited: false, usage };
    }
    const today = utcDay();
    const key = `${input.aiId}:${input.chatKey}`;
    if (dailyLimitNotices.get(key) === today) {
      return { limited: true, usage };
    }
    // The reply reports whichever cap was reached, so the limit flags
    // guarantee a non-null bound for the winning one.
    const sent = yield* attempt(
      () => input.sendNotice(limitReachedReply(usage)),
      (error) => {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
          'AI daily-limit notice could not be sent',
        );
      },
    );
    if (sent === FAILED) {
      return { limited: true, usage };
    }
    dailyLimitNotices.set(key, today);
    logger.info({ aiId: input.aiId }, 'AI spending limit reached; turn skipped');
    return { limited: true, usage };
  });

  // Sends the 80% heads-ups after the reply: daily first, then monthly, at
  // most one per kind per AI per chat per UTC day. A reached limit sends the
  // notice instead. A failed send only logs (ids only, never the key or
  // amounts) and never fails the turn.
  const sendBudgetWarningsEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    chatKey: string;
    usage: AiUsage | null;
    sendWarning: (text: string) => Promise<unknown>;
  }): Effect.fn.Return<void> {
    const usage = input.usage;
    if (usage === null || usage.dailyLimitReached || usage.monthlyLimitReached) {
      return;
    }
    const today = utcDay();
    if (usage.dailyWarning) {
      const key = `${input.aiId}:${input.chatKey}:daily-warning`;
      if (dailyWarningNotices.get(key) !== today) {
        const sent = yield* attempt(
          () => input.sendWarning(dailyWarningReply(usage.todayUsd, usage.perDayUsd ?? 0)),
          (error) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
              'AI budget warning could not be sent',
            );
          },
        );
        if (sent !== FAILED) {
          dailyWarningNotices.set(key, today);
          logger.info({ aiId: input.aiId }, 'AI daily budget warning sent');
        }
      }
    }
    if (usage.monthlyWarning) {
      const key = `${input.aiId}:${input.chatKey}:monthly-warning`;
      if (monthlyWarningNotices.get(key) !== today) {
        const sent = yield* attempt(
          () => input.sendWarning(monthlyWarningReply(usage.windowUsd, usage.perMonthUsd ?? 0)),
          (error) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
              'AI budget warning could not be sent',
            );
          },
        );
        if (sent !== FAILED) {
          monthlyWarningNotices.set(key, today);
          logger.info({ aiId: input.aiId }, 'AI monthly budget warning sent');
        }
      }
    }
  });

  // Per-round gate for the multi-round tool loop. Before each model call the
  // AI must still be live (kill switch) and under its limits. A limited AI gets
  // the fixed budget reply, a stopped AI the stopped reply; an unreadable
  // bound fails closed for a limited AI and fails open for an unlimited one.
  const checkDmRoundGateEffect = Effect.fnUntraced(function* (
    session: AiSession,
  ): Effect.fn.Return<{ limited: boolean; reply: string } | null> {
    if (!sessionIsLive(session)) {
      return { limited: true, reply: 'The AI was stopped.' };
    }
    let usageError: unknown;
    const fetched = yield* attempt(
      () => usageFor(session.aiId),
      (error) => {
        usageError = error;
      },
    );
    if (fetched === FAILED) {
      const limits = yield* attempt(
        () => limitsFor(deps.db, session.aiId),
        () => undefined,
      );
      if (limits !== FAILED && !limits.hasLimit) {
        return null;
      }
      logger.warn(
        { err: toRedactedError(usageError, secretsFor()), aiId: session.aiId },
        'AI usage check failed before a multi-round turn; failing closed (a spend limit is set)',
      );
      const perDayUsd = limits === FAILED ? 0 : (limits.perDayUsd ?? 0);
      return { limited: true, reply: dailyLimitReply(perDayUsd) };
    }
    const usage = fetched;
    if (usage === null || (!usage.dailyLimitReached && !usage.monthlyLimitReached)) {
      return null;
    }
    return { limited: true, reply: limitReachedReply(usage) };
  });

  // DMs the owner the real reason a room turn failed, at most once per AI per
  // room per UTC day. The room always hears the fixed `GROUP_FAILURE_REPLY`;
  // this is the only place the owner learns the reason. `send` is the live DM
  // path, so a stopped AI drops it; a failed lookup or send only logs and never
  // marks the day spent.
  const notifyOwnerOfFailureEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    roomJid: string;
    reason: string;
    send: (to: string, text: string) => Promise<unknown>;
  }): Effect.fn.Return<void> {
    const key = `${input.aiId}:${input.roomJid}`;
    const today = utcDay();
    if (ownerFailureNotices.get(key) === today) {
      return;
    }
    const ownerId = yield* attempt(
      () => loadAiOwnerId(deps.db, input.aiId),
      (error) => {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
          'AI owner lookup failed for a failure notice',
        );
      },
    );
    if (ownerId === FAILED || ownerId === null) {
      return;
    }
    const ownerJid = jidFor(localpartFor(ownerId), deps.xmpp.domain);
    const sent = yield* attempt(
      () => input.send(ownerJid, input.reason),
      (error) => {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
          'AI failure notice could not be sent',
        );
      },
    );
    if (sent === FAILED) {
      return;
    }
    ownerFailureNotices.set(key, today);
  });

  return {
    utcDay,
    checkDailyLimit: (input: {
      aiId: string;
      chatKey: string;
      sendNotice: (text: string) => Promise<unknown>;
    }): Promise<{ limited: boolean; usage: AiUsage | null }> =>
      Effect.runPromise(checkDailyLimitEffect(input)),
    sendBudgetWarnings: (input: {
      aiId: string;
      chatKey: string;
      usage: AiUsage | null;
      sendWarning: (text: string) => Promise<unknown>;
    }): Promise<void> => Effect.runPromise(sendBudgetWarningsEffect(input)),
    checkDmRoundGate: (session: AiSession): Promise<{ limited: boolean; reply: string } | null> =>
      Effect.runPromise(checkDmRoundGateEffect(session)),
    notifyOwnerOfFailure: (input: {
      aiId: string;
      roomJid: string;
      reason: string;
      send: (to: string, text: string) => Promise<unknown>;
    }): Promise<void> => Effect.runPromise(notifyOwnerOfFailureEffect(input)),
  };
}
