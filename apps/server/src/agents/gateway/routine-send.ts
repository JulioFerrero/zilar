// T-1714 (plan §1): a routine posts exactly one message, and every later run
// edits it. This wrapper sits at the gateway's wiring layer, so `turn-send.ts`
// and the turn loops stay unchanged: it remembers the routine's message id
// across the sends of one run, edits that message while it is under `maxAgeMs`
// old, and posts a fresh one otherwise. A correction carries no opts, so a
// scheduled run never quotes a reply and never mentions anyone.
import { Effect } from 'effect';
import type { ChatKind } from '@zilar/xmpp-core';
import type { ServerDatabase } from '../../db/client';
import { loadRoutineMessage, recordRoutineMessage } from '../../routines/message-store';
import { errorName, type AiSession, type GatewayLogger } from './contracts';

// How long a routine's stored message stays editable. Older than this the
// wrapper posts a new message instead of a XEP-0308 correction.
export const ROUTINE_MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type LoadRoutineMessage = (
  db: ServerDatabase,
  routineId: string,
) => Promise<{ messageId: string; at: Date } | null>;

type RecordRoutineMessage = (
  db: ServerDatabase,
  routineId: string,
  messageId: string,
  at: Date,
) => Promise<void>;

export interface RoutineSendDeps {
  db: ServerDatabase;
  session: AiSession;
  routineId: string;
  isLive: (session: AiSession) => boolean;
  now: () => Date;
  logger: GatewayLogger;
  maxAgeMs?: number;
  /** Injectable so tests run without a database; the real store by default. */
  loadMessage?: LoadRoutineMessage;
  recordMessage?: RecordRoutineMessage;
}

export interface RoutineSend {
  send: (to: string, kind: ChatKind, text: string) => Promise<{ id: string }>;
}

export function createRoutineSend(deps: RoutineSendDeps): RoutineSend {
  const maxAgeMs = deps.maxAgeMs ?? ROUTINE_MESSAGE_MAX_AGE_MS;
  const loadMessage = deps.loadMessage ?? loadRoutineMessage;
  const recordMessage = deps.recordMessage ?? recordRoutineMessage;
  let targetId: string | null = null;
  let loaded = false;

  // Best effort: a store write that fails must never fail the send. The log
  // line carries ids only, never message text.
  const record = (messageId: string): Effect.Effect<void> =>
    Effect.promise(() => recordMessage(deps.db, deps.routineId, messageId, deps.now())).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => {
          deps.logger.warn(
            { err: errorName(error), routineId: deps.routineId, messageId },
            'routine message id could not be stored',
          );
        }),
      ),
    );

  // The stored message is read once per run. Best effort the same way, and the
  // log line again carries ids only.
  const loadTarget = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (loaded) {
        return;
      }
      loaded = true;
      const stored = yield* Effect.promise(() => loadMessage(deps.db, deps.routineId)).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            deps.logger.warn(
              { err: errorName(error), routineId: deps.routineId },
              'routine message could not be loaded',
            );
            return null;
          }),
        ),
      );
      if (stored !== null && deps.now().getTime() - stored.at.getTime() < maxAgeMs) {
        targetId = stored.messageId;
      }
    });

  const sendEffect = (to: string, kind: ChatKind, text: string): Effect.Effect<{ id: string }> =>
    Effect.gen(function* () {
      if (!deps.isLive(deps.session)) {
        return { id: '' };
      }
      yield* loadTarget();
      const existing = targetId;
      if (existing !== null) {
        yield* Effect.promise(() => deps.session.core.sendCorrection(to, kind, existing, text));
        yield* record(existing);
        return { id: existing };
      }
      const sent = yield* Effect.promise(() => deps.session.core.sendMessage(to, kind, text));
      targetId = sent.id;
      yield* record(sent.id);
      return sent;
    });

  return {
    send: (to, kind, text) => Effect.runPromise(sendEffect(to, kind, text)),
  };
}
