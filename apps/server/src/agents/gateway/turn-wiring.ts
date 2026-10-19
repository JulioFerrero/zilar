import { Effect } from 'effect';
import type { ChatKind } from '@zilar/xmpp-core';
import type { ActiveAiForGateway } from '../../ais/queries';
import type { ModelTarget } from '../../ai/providers';
import type { ChatUsage } from '../../ai/model-client';
import { recordUsage } from '../../ais/usage-store';
import { TOOL_STAGE_THINKING } from '../tool-guide';
import type { TurnLog } from '../log/append';
import type { AiSession } from './contracts';
import { resolveTurnDesk, TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER } from './desk-exec';
import type { DmTurnContext } from './dm-turn';
import type { GroupTurnContext } from './group-turn';
import { createRoutineSend } from './routine-send';
import { clearTurnAbort, registerTurnAbort } from './stop';
import { turnLimits } from './turn-rounds';

export interface PrepareTurnInput {
  ctx: DmTurnContext | GroupTurnContext;
  session: AiSession;
  ai: ActiveAiForGateway;
  target: ModelTarget;
  chatJid: string;
  /** The chat the stop hook looks up; the DM stops under the AI's own JID. */
  abortJid?: string;
  kind: ChatKind;
  log: TurnLog;
  isLive: (session: AiSession) => boolean;
  routineId?: string;
  useDesk?: boolean;
}

// Builds the wiring every turn shares: the routine send, the progress card, the
// desk, the abort and the runner deps. The caller keeps its own extras.
export function prepareTurn(input: PrepareTurnInput) {
  const { ctx, session, ai, target, chatJid, kind, log, isLive, routineId, useDesk = true } = input;
  const abortJid = input.abortJid ?? chatJid;
  const { deps, logger, turnLogger, liveSendTyping, liveProgressReporter, budgetGate, secretsFor } =
    ctx;

  return Effect.gen(function* () {
    const now = deps.now ?? (() => new Date());
    const routineSend =
      routineId === undefined
        ? null
        : createRoutineSend({ db: deps.db, session, routineId, isLive, now, logger });
    const progress =
      routineSend === null ? liveProgressReporter(session, chatJid, kind, ai.jid, log) : null;
    const turnDesk = useDesk
      ? yield* Effect.promise(() => resolveTurnDesk(deps, ai))
      : { waiting: false };
    if (turnDesk.waiting && progress !== null)
      yield* Effect.promise(() => progress.reportProgress(TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER));
    const abort = registerTurnAbort(session, abortJid);
    const common = {
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...turnLimits(deps.toolMaxRounds, turnDesk.client !== undefined),
      checkRoundGate: () => budgetGate.checkDmRoundGate(session),
      ...(progress === null
        ? {}
        : { reportProgress: progress.reportProgress, finishProgress: progress.finishProgress }),
      turnLogger,
      // Best effort, fire and forget: recording usage can never fail the turn.
      onUsage: (usage: ChatUsage) => {
        void recordUsage(
          { db: deps.db, logger },
          session.aiId,
          target.usageProvider ?? target.provider,
          target.model,
          usage,
          now(),
        );
      },
      sendTyping: (to: string, sendKind: ChatKind, state: 'composing' | 'paused') => {
        liveSendTyping(
          session,
          to,
          sendKind,
          state,
          state === 'composing' ? TOOL_STAGE_THINKING : undefined,
        );
      },
      logger,
      secrets: secretsFor(),
      log,
    };
    return {
      routineSend,
      signal: abort.signal,
      ensureCleared: Effect.sync(() => clearTurnAbort(session, abortJid, abort)),
      deskEnabled: turnDesk.client !== undefined,
      deskOptions:
        turnDesk.client === undefined
          ? undefined
          : { ownerUserId: ai.owner, client: turnDesk.client, signal: abort.signal },
      common,
    };
  });
}
