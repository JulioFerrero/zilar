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

  // The soft daily-limit check (T-0058), shared by DM and group turns. It
  // runs before any model call: a null usage fails open (the turn goes
  // ahead — the monthly cap is still enforced by LiteLLM itself), while a
  // reached limit sends the fixed notice at most once per AI per chat per UTC
  // day and skips the turn. The fetched usage is returned so the caller can
  // send the 80% warnings after the reply without a second read. Only ids
  // are ever logged: the usage read addresses the key by its token id, never
  // by the secret.
  async function checkDailyLimit(input: {
    aiId: string;
    chatKey: string;
    sendNotice: (text: string) => Promise<unknown>;
  }): Promise<{ limited: boolean; usage: AiUsage | null }> {
    if (deps.litellm === undefined) {
      return { limited: false, usage: null };
    }
    let usage;
    try {
      usage = await getAiUsage(
        {
          db: deps.db,
          litellm: deps.litellm,
          logger,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
        input.aiId,
      );
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
        'AI usage check failed; failing open',
      );
      return { limited: false, usage: null };
    }
    if (usage === null || !usage.dailyLimitReached) {
      return { limited: false, usage };
    }
    const today = utcDay();
    const key = `${input.aiId}:${input.chatKey}`;
    if (dailyLimitNotices.get(key) === today) {
      return { limited: true, usage };
    }
    try {
      await input.sendNotice(dailyLimitReply(usage.perDayUsd));
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
        'AI daily-limit notice could not be sent',
      );
      return { limited: true, usage };
    }
    dailyLimitNotices.set(key, today);
    logger.info({ aiId: input.aiId }, 'AI daily spending limit reached; turn skipped');
    return { limited: true, usage };
  }

  // Sends the 80% heads-ups after the AI's reply for the turn that crossed
  // them: daily first, then monthly. At most one per kind per AI per chat per
  // UTC day. A reached limit sends nothing: the notice path above applies.
  // Usage null fails open with no warning. A failed send only logs (ids
  // only, never the key or amounts) and never fails the turn.
  async function sendBudgetWarnings(input: {
    aiId: string;
    chatKey: string;
    usage: AiUsage | null;
    sendWarning: (text: string) => Promise<unknown>;
  }): Promise<void> {
    const usage = input.usage;
    if (usage === null || usage.dailyLimitReached) {
      return;
    }
    const today = utcDay();
    if (usage.dailyWarning) {
      const key = `${input.aiId}:${input.chatKey}:daily-warning`;
      if (dailyWarningNotices.get(key) !== today) {
        try {
          await input.sendWarning(dailyWarningReply(usage.todayUsd, usage.perDayUsd));
          dailyWarningNotices.set(key, today);
          logger.info({ aiId: input.aiId }, 'AI daily budget warning sent');
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
            'AI budget warning could not be sent',
          );
        }
      }
    }
    if (usage.monthlyWarning) {
      const key = `${input.aiId}:${input.chatKey}:monthly-warning`;
      if (monthlyWarningNotices.get(key) !== today) {
        try {
          await input.sendWarning(monthlyWarningReply(usage.windowUsd, usage.perMonthUsd));
          monthlyWarningNotices.set(key, today);
          logger.info({ aiId: input.aiId }, 'AI monthly budget warning sent');
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: input.aiId },
            'AI budget warning could not be sent',
          );
        }
      }
    }
  }

  // T-0106: per-round gate for the multi-round tool loop. Before each model
  // call the AI must still be live (kill switch) and still under its
  // daily/monthly limits. A limited AI gets the same fixed budget reply the
  // single-round turn would send; a stopped AI gets the stopped reply and
  // sends nothing. Usage null fails open, like the pre-turn check.
  async function checkDmRoundGate(
    session: AiSession,
  ): Promise<{ limited: boolean; reply: string } | null> {
    if (!sessionIsLive(session)) {
      return { limited: true, reply: 'The AI was stopped.' };
    }
    if (deps.litellm === undefined) {
      return null;
    }
    let usage: AiUsage | null;
    try {
      usage = await getAiUsage(
        {
          db: deps.db,
          litellm: deps.litellm,
          logger,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        },
        session.aiId,
      );
    } catch {
      return null;
    }
    if (usage === null || !usage.dailyLimitReached) {
      return null;
    }
    return { limited: true, reply: dailyLimitReply(usage.perDayUsd) };
  }

  return { utcDay, checkDailyLimit, sendBudgetWarnings, checkDmRoundGate };
}
