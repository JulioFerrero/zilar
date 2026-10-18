import { Effect } from 'effect';
import type { TurnLog } from '../log/append';
import { failureLogFields, mapFailureToReply } from '../reply';
import type { AiSession, GatewayLogger } from './contracts';
import type { createLiveSession } from './live';

type LiveSession = ReturnType<typeof createLiveSession>;

export interface DmTurnDefectInput {
  session: AiSession;
  ownerJid: string;
  logger: GatewayLogger;
  turnLog: TurnLog;
  liveSendMessage: LiveSession['liveSendMessage'];
  liveSendTyping: LiveSession['liveSendTyping'];
  endDrafts: () => void;
  error: unknown;
  /** A scheduled routine's run posts no extra failure reply; the scheduler
   * records the failure instead. */
  scheduled?: boolean;
}

export function reportDmTurnDefect(input: DmTurnDefectInput): Effect.Effect<void> {
  const {
    session,
    ownerJid,
    logger,
    turnLog,
    liveSendMessage,
    liveSendTyping,
    endDrafts,
    error,
    scheduled,
  } = input;
  return Effect.gen(function* () {
    // The connection lookup and anything else outside the turn: an honest
    // short message, never the raw error.
    logger.warn({ ...failureLogFields(error), aiId: session.aiId }, 'AI turn failed');
    turnLog.append('error', failureLogFields(error));
    // A scheduled run posts no extra message at all.
    if (scheduled !== true) {
      const reply = mapFailureToReply(error);
      // There is nobody left to tell when the send itself fails.
      yield* Effect.promise(() => liveSendMessage(session, ownerJid, 'chat', reply)).pipe(
        Effect.catchDefect(() => Effect.void),
      );
    }
    // The failed `end` goes out only after the failure text was sent (or its
    // send was attempted): the contract promises `end` comes last. Typing
    // state is best-effort.
    yield* Effect.try({
      try: () => liveSendTyping(session, ownerJid, 'chat', 'paused'),
      catch: (typingError) => typingError,
    }).pipe(Effect.ignore);
    endDrafts();
  });
}
