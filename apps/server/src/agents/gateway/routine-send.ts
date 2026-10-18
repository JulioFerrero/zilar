// A routine posts exactly one message and every later run edits it. The wrapper
// remembers the routine's message id across one run, edits while it is under
// `maxAgeMs` old, and posts fresh otherwise. Every send and edit carries the
// `routine` payload so a client can draw the header; a correction quotes no
// reply and mentions no one.
import { Effect } from 'effect';
import type { Payload } from '@zilar/protocol';
import type { ChatKind } from '@zilar/xmpp-core';
import type { ServerDatabase } from '../../db/client';
import type { RoutineRow } from '../../db/rows';
import { findRoutineById } from '../../routines/reads';
import { parseRoutineSchedule } from '../../routines/schedule';
import { describeSchedule } from '../../tools/routine-adapters';
import { errorName, type AiSession, type GatewayLogger } from './contracts';
import { SqlClient } from 'effect/sql';
import { runSql } from '../../effect/sql';

// The routine's single live message: these helpers store, load and clear its id on the `routines` row.
interface RoutineMessageRow {
  lastMessageId: string | null;
  lastMessageAt: Date | null;
}

// The routine's stored message, or null when it has none or is deleted.
export async function loadRoutineMessage(
  db: ServerDatabase,
  routineId: string,
): Promise<{ messageId: string; at: Date } | null> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineMessageRow>`SELECT last_message_id, last_message_at
        FROM routines WHERE id = ${routineId} AND deleted_at IS NULL LIMIT 1`;
      return found ?? null;
    }),
  );
  if (!row || row.lastMessageId === null || row.lastMessageAt === null) {
    return null;
  }
  return { messageId: row.lastMessageId, at: row.lastMessageAt };
}

// Stamps the posted message id and the time it was posted.
export async function recordRoutineMessage(
  db: ServerDatabase,
  routineId: string,
  messageId: string,
  at: Date,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_message_id = ${messageId}, last_message_at = ${at}, updated_at = ${at}
        WHERE id = ${routineId}`;
    }),
  );
}

// Forgets the routine's message.
export async function clearRoutineMessage(db: ServerDatabase, routineId: string): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_message_id = NULL, last_message_at = NULL
        WHERE id = ${routineId}`;
    }),
  );
}

// Forgets the routine holding this message id, so a gone message is never edited later.
export async function clearRoutineMessageByTarget(
  db: ServerDatabase,
  messageId: string,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_message_id = NULL, last_message_at = NULL
        WHERE last_message_id = ${messageId}`;
    }),
  );
}
// How long a routine's stored message stays editable. Older than this the
// wrapper posts a new message instead of a XEP-0308 correction.
export const ROUTINE_MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// `RoutinePostSchema` allows at most 80 characters of title.
const ROUTINE_TITLE_MAX_LENGTH = 80;

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

type LoadRoutine = (db: ServerDatabase, routineId: string) => Promise<RoutineRow | null>;

// The routine header payload, or `undefined` for a routine that cannot be
// loaded or parsed, so the send goes out exactly as before.
function routinePayload(routine: RoutineRow): Payload | undefined {
  const parsed = parseRoutineSchedule(routine.schedule);
  if (!parsed.ok) {
    return undefined;
  }
  const title = routine.title.slice(0, ROUTINE_TITLE_MAX_LENGTH);
  if (title.length === 0) {
    return undefined;
  }
  return {
    v: 0,
    type: 'routine',
    data: { id: routine.id, title, schedule: describeSchedule(parsed.value) },
  };
}

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
  /** Injectable so tests run without a database; the real read by default. */
  loadRoutine?: LoadRoutine;
}

export interface RoutineSend {
  send: (to: string, kind: ChatKind, text: string) => Promise<{ id: string }>;
}

export function createRoutineSend(deps: RoutineSendDeps): RoutineSend {
  const maxAgeMs = deps.maxAgeMs ?? ROUTINE_MESSAGE_MAX_AGE_MS;
  const loadMessage = deps.loadMessage ?? loadRoutineMessage;
  const recordMessage = deps.recordMessage ?? recordRoutineMessage;
  const loadRoutine = deps.loadRoutine ?? findRoutineById;
  let targetId: string | null = null;
  let payload: Payload | undefined;
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

  // The stored message and the routine's header are read once per run. Best
  // effort the same way, and the log line again carries ids only.
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
      const routine = yield* Effect.promise(() => loadRoutine(deps.db, deps.routineId)).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            deps.logger.warn(
              { err: errorName(error), routineId: deps.routineId },
              'routine could not be loaded',
            );
            return null;
          }),
        ),
      );
      if (routine !== null) {
        payload = routinePayload(routine);
      }
    });

  const sendEffect = (to: string, kind: ChatKind, text: string): Effect.Effect<{ id: string }> =>
    Effect.gen(function* () {
      if (!deps.isLive(deps.session)) {
        return { id: '' };
      }
      yield* loadTarget();
      // The routine header rides on both the send and every edit.
      const opts = payload === undefined ? undefined : { payload };
      const existing = targetId;
      if (existing !== null) {
        yield* Effect.promise(() =>
          deps.session.core.sendCorrection(to, kind, existing, text, opts),
        );
        yield* record(existing);
        return { id: existing };
      }
      const sent = yield* Effect.promise(() => deps.session.core.sendMessage(to, kind, text, opts));
      targetId = sent.id;
      yield* record(sent.id);
      return sent;
    });

  return {
    send: (to, kind, text) => Effect.runPromise(sendEffect(to, kind, text)),
  };
}
