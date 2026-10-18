import { Effect } from 'effect';
import type { ActiveAiForGateway } from '../../ais/queries';
import type { ServerDatabase } from '../../db/client';
import type { AiSession, ScheduledTurnOutcome } from './contracts';
import { loadActiveAi } from './db';

export interface TurnStartDeps {
  db: ServerDatabase;
  disconnectAi: (aiId: string) => Promise<void>;
}

// Returns the loaded AI, or `null` after disconnecting and settling offline.
export function startTurn<T extends { scheduled?: { onStart?: () => void } }>(
  deps: TurnStartDeps,
  session: AiSession,
  batch: readonly T[],
  settle: (outcome: ScheduledTurnOutcome) => void,
): Effect.Effect<ActiveAiForGateway | null> {
  return Effect.gen(function* () {
    // The turn starts now, so a scheduled item's runner starts its timeout here
    // instead of at enqueue.
    for (const item of batch) item.scheduled?.onStart?.();
    // The owner JID comes from the database, never from the message. This AI
    // id is the gateway's own, so the lookup can never be aimed at message data.
    const ai = yield* Effect.promise(() => loadActiveAi(deps.db, session.aiId)).pipe(
      Effect.catchDefect(() => Effect.succeed(null)),
    );
    if (ai !== null) return ai;
    yield* Effect.promise(() => deps.disconnectAi(session.aiId)).pipe(
      Effect.catchDefect(() => Effect.void),
    );
    settle('offline');
    return null;
  });
}
