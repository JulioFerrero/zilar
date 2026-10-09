import { Effect } from 'effect';
import type { LitellmAdminClient } from '../../ai/litellm-client';
import { getAiUsage, type AiUsage } from '../../ais/usage';
import { dailyLimitReply, dailyWarningReply, monthlyWarningReply } from '../reply';
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
  secretsFor: (virtualKey?: string) => string[];
}

const FAILED = Symbol('failed');

// Runs a Promise call as an Effect. A rejection (or a synchronous throw) dies
// with the original value; `onError` logs it (the old `catch` body) and the
// call answers `FAILED`, so the failure never leaves the turn.
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

export function createBudgetGate(ctx: BudgetGateContext) {
  const { deps, logger, sessionIsLive, secretsFor } = ctx;

  // One fixed notice per AI per chat per UTC day, in memory only. After a
  // restart the map is empty, so a limited AI may notify once more.
  const dailyLimitNotices = new Map<string, string>();
  // One 80% heads-up per kind per AI per chat per UTC day, in memory only.
  // Daily and monthly warnings are independent; a restart may repeat one.
  const dailyWarningNotices = new Map<string, string>();
  const monthlyWarningNotices = new Map<string, string>();

  function utcDay(): string {
    return (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  }

  const usageFor = (litellm: LitellmAdminClient, aiId: string): Promise<AiUsage | null> =>
    getAiUsage(
      {
        db: deps.db,
        litellm,
        logger,
        ...(deps.now === undefined ? {} : { now: deps.now }),
      },
      aiId,
    );

  // The soft daily-limit check (T-0058), shared by DM and group turns. It
  // runs before any model call: a null usage fails open (the turn goes
  // ahead — the monthly cap is still enforced by LiteLLM itself), while a
  // reached limit sends the fixed notice at most once per AI per chat per UTC
  // day and skips the turn. The fetched usage is returned so the caller can
  // send the 80% warnings after the reply without a second read. Only ids
  // are ever logged: the usage read addresses the key by its token id, never
  // by the secret.
  const checkDailyLimitEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    chatKey: string;
    sendNotice: (text: string) => Promise<unknown>;
  }): Effect.fn.Return<{ limited: boolean; usage: AiUsage | null }> {
    const litellm = deps.litellm;
    if (litellm === undefined) {
      return { limited: false, usage: null };
    }
    const fetched = yield* attempt(
      () => usageFor(litellm, input.aiId),
      (error) => {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
          'AI usage check failed; failing open',
        );
      },
    );
    if (fetched === FAILED) {
      return { limited: false, usage: null };
    }
    const usage = fetched;
    if (usage === null || !usage.dailyLimitReached) {
      return { limited: false, usage };
    }
    const today = utcDay();
    const key = `${input.aiId}:${input.chatKey}`;
    if (dailyLimitNotices.get(key) === today) {
      return { limited: true, usage };
    }
    const sent = yield* attempt(
      () => input.sendNotice(dailyLimitReply(usage.perDayUsd)),
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
    logger.info({ aiId: input.aiId }, 'AI daily spending limit reached; turn skipped');
    return { limited: true, usage };
  });

  // Sends the 80% heads-ups after the AI's reply for the turn that crossed
  // them: daily first, then monthly. At most one per kind per AI per chat per
  // UTC day. A reached limit sends nothing: the notice path above applies.
  // Usage null fails open with no warning. A failed send only logs (ids
  // only, never the key or amounts) and never fails the turn.
  const sendBudgetWarningsEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    chatKey: string;
    usage: AiUsage | null;
    sendWarning: (text: string) => Promise<unknown>;
  }): Effect.fn.Return<void> {
    const usage = input.usage;
    if (usage === null || usage.dailyLimitReached) {
      return;
    }
    const today = utcDay();
    if (usage.dailyWarning) {
      const key = `${input.aiId}:${input.chatKey}:daily-warning`;
      if (dailyWarningNotices.get(key) !== today) {
        const sent = yield* attempt(
          () => input.sendWarning(dailyWarningReply(usage.todayUsd, usage.perDayUsd)),
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
          () => input.sendWarning(monthlyWarningReply(usage.windowUsd, usage.perMonthUsd)),
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

  // T-0106: per-round gate for the multi-round tool loop. Before each model
  // call the AI must still be live (kill switch) and still under its
  // daily/monthly limits. A limited AI gets the same fixed budget reply the
  // single-round turn would send; a stopped AI gets the stopped reply and
  // sends nothing. Usage null fails open, like the pre-turn check.
  const checkDmRoundGateEffect = Effect.fnUntraced(function* (
    session: AiSession,
  ): Effect.fn.Return<{ limited: boolean; reply: string } | null> {
    if (!sessionIsLive(session)) {
      return { limited: true, reply: 'The AI was stopped.' };
    }
    const litellm = deps.litellm;
    if (litellm === undefined) {
      return null;
    }
    const fetched = yield* attempt(
      () => usageFor(litellm, session.aiId),
      () => undefined,
    );
    if (fetched === FAILED) {
      return null;
    }
    const usage = fetched;
    if (usage === null || !usage.dailyLimitReached) {
      return null;
    }
    return { limited: true, reply: dailyLimitReply(usage.perDayUsd) };
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
  };
}
