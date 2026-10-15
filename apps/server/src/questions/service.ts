import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { AiQuestionInsert, AiQuestionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';

// A question with reply chips lives 24 hours by default.
export const DEFAULT_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_QUESTION_LENGTH = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_OPTION_LENGTH = 40;

// Per-AI cap on open questions, like `MAX_PENDING_APPROVALS_PER_AI` on approvals.
export const MAX_OPEN_QUESTIONS_PER_AI = 20;

export interface CreateQuestionInput {
  aiId: string;
  groupId?: string | null;
  topicId?: string | null;
  roomJid: string;
  question: string;
  options: string[];
  ttlMs?: number;
}

export interface AnswerQuestionInput {
  answer: string;
  answeredBy: string;
}

function invalidRequest(message: string): HttpError {
  return new HttpError(400, 'invalid_request', message);
}

// Trims first, then bounds the result, so blank text is refused and the stored
// text is the trimmed text.
function validateQuestion(question: string): string {
  const trimmed = question.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_QUESTION_LENGTH) {
    throw invalidRequest(`question must be 1-${MAX_QUESTION_LENGTH} characters`);
  }
  return trimmed;
}

function validateOptions(options: string[]): string[] {
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw invalidRequest(`options must be between ${MIN_OPTIONS} and ${MAX_OPTIONS}`);
  }
  return options.map((option) => {
    const trimmed = option.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_OPTION_LENGTH) {
      throw invalidRequest(`each option must be 1-${MAX_OPTION_LENGTH} characters`);
    }
    return trimmed;
  });
}

// Validates the question and its options and writes one open row. `message_id`
// is null here: the caller sets it after the card is posted. At most
// `MAX_OPEN_QUESTIONS_PER_AI` open, unexpired questions per AI.
//
// The count and the insert run in one transaction under a per-AI advisory
// lock, so two concurrent creates cannot both read below the cap and both
// insert: the second waits, then sees the first.
export async function createQuestion(
  db: ServerDatabase,
  input: CreateQuestionInput,
): Promise<AiQuestionRow> {
  const question = validateQuestion(input.question);
  const options = validateOptions(input.options);
  const row: AiQuestionInsert = {
    id: randomUUID(),
    aiId: input.aiId,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    roomJid: input.roomJid,
    messageId: null,
    question,
    options,
    status: 'open',
    expiresAt: new Date(Date.now() + (input.ttlMs ?? DEFAULT_QUESTION_TTL_MS)),
  };
  const [created] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-questions:${row.aiId}`}))`;
          const [countRow] = yield* sql<{
            total: number;
          }>`SELECT count(*)::int AS total FROM ai_questions
            WHERE ai_id = ${row.aiId} AND status = 'open' AND expires_at > now()`;
          if ((countRow?.total ?? 0) >= MAX_OPEN_QUESTIONS_PER_AI) {
            return yield* Effect.fail(
              new HttpError(429, 'too_many_questions', 'This AI has too many open questions'),
            );
          }
          return yield* sql<AiQuestionRow>`INSERT INTO ai_questions
              (id, ai_id, group_id, topic_id, room_jid, message_id, question, options, status, expires_at)
            VALUES (
              ${row.id},
              ${row.aiId},
              ${row.groupId},
              ${row.topicId},
              ${row.roomJid},
              ${row.messageId},
              ${row.question},
              ${JSON.stringify(row.options)}::jsonb,
              ${row.status},
              ${row.expiresAt}
            )
            RETURNING *`;
        }),
      );
    }),
  );
  if (!created) {
    throw new Error('Failed to create question');
  }
  return created;
}

// Records the posted card's stanza id, once. Returns whether the row changed.
export async function setQuestionMessageId(
  db: ServerDatabase,
  id: string,
  messageId: string,
): Promise<boolean> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ai_questions
        SET message_id = ${messageId}
        WHERE id = ${id} AND message_id IS NULL
        RETURNING id`;
    }),
  );
  return updated.length > 0;
}

// The open, unexpired question a reply quotes. `now()` is the database clock,
// so a question past its expiry is never returned.
export async function findOpenQuestionByMessage(
  db: ServerDatabase,
  messageId: string,
): Promise<AiQuestionRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiQuestionRow>`SELECT * FROM ai_questions
        WHERE message_id = ${messageId} AND status = 'open' AND expires_at > now()
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Marks an open, unexpired question answered. The conditional update makes
// exactly one caller win; the second returns false.
export async function answerQuestion(
  db: ServerDatabase,
  id: string,
  input: AnswerQuestionInput,
): Promise<boolean> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ai_questions
        SET status = 'answered',
            answer = ${input.answer},
            answered_by = ${input.answeredBy},
            answered_at = now()
        WHERE id = ${id} AND status = 'open' AND expires_at > now()
        RETURNING id`;
    }),
  );
  return updated.length > 0;
}

// The open, unexpired questions of a topic, oldest first. Only rows whose card
// was posted (`message_id` set) are returned: a question the activity read
// cannot open has no place there.
export async function listOpenQuestions(
  db: ServerDatabase,
  params: { topicId: string },
): Promise<AiQuestionRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiQuestionRow>`SELECT * FROM ai_questions
        WHERE topic_id = ${params.topicId} AND status = 'open' AND expires_at > now()
          AND message_id IS NOT NULL
        ORDER BY created_at`;
    }),
  );
  return [...rows];
}
