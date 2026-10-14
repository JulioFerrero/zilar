// T-1426: the append side of the session log behind "View steps". One
// `TurnLog` per turn assigns `seq` in memory and writes one
// `agent_task_events` row per step. Every append is best effort: a write
// failure logs ids only and never fails the turn (the same contract as the
// task-card sends in `gateway/live.ts`).
//
// Privacy: callers pass ids, counts and fixed labels. Tool arguments and
// output are allowed, but this module redacts every secret-shaped string and
// truncates every string to `TASK_EVENT_TEXT_MAX_BYTES` (2 KiB), so a stray
// token in tool output can never reach the table whole. Human message text
// must never be put in `data`.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { redactSecrets } from '../../ai/http';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';

/** The event kinds the table holds. Mirrored by the API contract's literals. */
export const TASK_EVENT_KINDS = [
  'status',
  'model_call',
  'tool_call',
  'tool_result',
  'approval',
  'answer',
  'error',
] as const;

export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/** The most bytes stored for any single string in `data`. */
export const TASK_EVENT_TEXT_MAX_BYTES = 2048;

export interface TaskEventRecord {
  id: string;
  taskId: string;
  aiId: string;
  ownerId: string;
  chatJid: string;
  seq: number;
  kind: TaskEventKind;
  at: string;
  durationMs: number | null;
  data: Record<string, unknown>;
}

export interface TurnLog {
  readonly taskId: string;
  /** Appends one step. Synchronous and best effort: it never throws. */
  append(kind: TaskEventKind, data?: Record<string, unknown>, durationMs?: number): void;
}

/** The byte length of a string in UTF-8. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Truncates to at most `max` UTF-8 bytes, never leaving a broken character. */
export function truncateToBytes(text: string, max = TASK_EVENT_TEXT_MAX_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= max) {
    return text;
  }
  return Buffer.from(text, 'utf8')
    .subarray(0, max)
    .toString('utf8')
    .replace(/\uFFFD+$/u, '');
}

/** Redacts every secret, then truncates to `max` bytes. */
export function redactAndTruncate(
  text: string,
  secrets: readonly string[],
  max = TASK_EVENT_TEXT_MAX_BYTES,
): string {
  return truncateToBytes(redactSecrets(text, secrets), max);
}

function sanitizeValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactAndTruncate(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitizeValue(item, secrets);
    }
    return out;
  }
  return value;
}

/** Writes one row. Rejects on a database failure; callers decide what to do. */
export async function insertEvent(db: ServerDatabase, record: TaskEventRecord): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO agent_task_events
          (id, task_id, ai_id, owner_id, chat_jid, seq, kind, at, duration_ms, data)
        VALUES (${record.id}, ${record.taskId}, ${record.aiId}, ${record.ownerId},
          ${record.chatJid}, ${record.seq}, ${record.kind}, ${record.at},
          ${record.durationMs}, ${JSON.stringify(record.data)}::jsonb)`;
    }),
  );
}

export interface TurnLogInput {
  db: ServerDatabase;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  taskId: string;
  aiId: string;
  ownerId: string;
  chatJid: string;
  secrets: readonly string[];
}

/**
 * Opens one turn's log with a fresh task id. The positional form keeps each
 * gateway's call site to a single line.
 */
export function openTurnLog(
  db: ServerDatabase,
  logger: TurnLogInput['logger'],
  aiId: string,
  ownerId: string,
  chatJid: string,
  secrets: readonly string[],
): TurnLog {
  return createTurnLog({ db, logger, taskId: randomUUID(), aiId, ownerId, chatJid, secrets });
}

/** Builds one turn's log: a `seq` counter plus best-effort writes. */
export function createTurnLog(input: TurnLogInput): TurnLog {
  let seq = 0;
  return {
    taskId: input.taskId,
    append(kind, data = {}, durationMs): void {
      seq += 1;
      const record: TaskEventRecord = {
        id: randomUUID(),
        taskId: input.taskId,
        aiId: input.aiId,
        ownerId: input.ownerId,
        chatJid: input.chatJid,
        seq,
        kind,
        at: new Date().toISOString(),
        durationMs: durationMs ?? null,
        data: sanitizeValue(data, input.secrets) as Record<string, unknown>,
      };
      // Best effort: a failed write logs the ids only and never reaches the
      // turn. The error's message can echo a key, so only its name travels.
      void insertEvent(input.db, record).catch((error: unknown) => {
        input.logger.warn(
          {
            aiId: input.aiId,
            taskId: input.taskId,
            err: error instanceof Error ? error.name : typeof error,
          },
          'AI task event could not be stored',
        );
      });
    },
  };
}
