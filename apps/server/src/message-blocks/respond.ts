import type { ServerCore } from '../app/deps';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { type BlocksRespondPayload, type BlocksRespondValue } from '@zilar/api-contract';
import { BlocksDataSchema, type Block, type BlocksData, type Payload } from '@zilar/protocol';
import { type Logger } from 'pino';
import { loadAiOwnerId } from '../agents/gateway/db';
import { type AuditRecorder } from '../audit/recorder';
import { type ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { getGroupMembership, isTopicMember, requireVisibleTopic } from '../topics/access';
import { applyResponses } from './apply';
import { findCard, listResponses, replacePollVotes, saveCardData, upsertResponse } from './cards';
import { errorName } from '../effect/error-utils';
import { routineAccess } from '../routines/access';
import { pauseRoutine, resumeRoutine } from '../routines/support';
import { type BlockCardRow, type BlockResponseRow, type RoutineRow } from '../db/rows-agents';
interface AlertRoutineDeps extends Pick<ServerCore, 'db' | 'logger'> {
  audit?: AuditRecorder;
}

// An unlinked alert has no manager; a linked one is answerable only by the
// routine's manager (the AI owner, or a group owner/admin).
async function requireAlertManager(
  db: ServerDatabase,
  cardId: string,
  blockId: string,
  userId: string,
): Promise<void> {
  const routine = await findAlertRoutine(db, cardId, blockId);
  if (routine === undefined) {
    return;
  }
  const access = await routineAccess(db, routine.id, userId);
  if (access?.manager !== true) {
    throw cardNotFound();
  }
}

// The same strip rule as `respond.ts`, which already rejected anything else.
function parseThreshold(text: string): number {
  return Number(text.replace(/[ ,]/g, '').replace(/^[$€£]/, ''));
}

async function applyAlertToRoutine(
  deps: AlertRoutineDeps,
  card: BlockCardRow,
  blockId: string,
  actorId: string,
  value: Record<string, unknown>,
): Promise<void> {
  try {
    const routine = await findAlertRoutine(deps.db, card.originId, blockId);
    if (routine === undefined) {
      return;
    }
    const now = new Date();
    const threshold = typeof value.threshold === 'string' ? value.threshold : undefined;
    if (threshold !== undefined) {
      await setRoutineThreshold(deps.db, routine.id, parseThreshold(threshold), now);
    }
    const on = value.on;
    if (on === false) {
      await pauseRoutine(deps.db, routine.id, actorId, now, deps.audit);
    } else if (on === true && routine.pausedReason === 'user') {
      await resumeRoutine(deps.db, routine.id, actorId, now, deps.audit);
    }
  } catch (error) {
    deps.logger.warn(
      { cardId: card.originId, blockId, err: errorName(error) },
      'Alert answer did not reach the routine',
    );
  }
}

const FORM_VALUE_MAX = 120;

// A threshold is a number once spaces, commas and one leading currency sign are
// removed.
function isNumberText(text: string): boolean {
  const numeric = text.replace(/[ ,]/g, '').replace(/^[$€£]/, '');
  return numeric.length > 0 && Number.isFinite(Number(numeric));
}

// The switch and/or threshold; at least one must be present, and the threshold
// must be a number.
function alertAnswer(value: BlocksRespondValue): Record<string, unknown> {
  const on = value.done;
  if (on !== undefined && typeof on !== 'boolean') {
    throw invalidResponse();
  }
  const raw = value.fields?.value;
  const threshold = raw === undefined ? undefined : raw.trim();
  if (threshold !== undefined && (threshold.length > FORM_VALUE_MAX || !isNumberText(threshold))) {
    throw invalidResponse();
  }
  if (on === undefined && threshold === undefined) {
    throw invalidResponse();
  }
  const answer: Record<string, unknown> = {};
  if (on !== undefined) {
    answer.on = on;
  }
  if (threshold !== undefined) {
    answer.threshold = threshold;
  }
  return answer;
}

export interface CorrectCardInput {
  aiId: string;
  roomJid: string;
  originalId: string;
  text: string;
  payload: Payload;
}

export interface CardRespondDeps extends Pick<ServerCore, 'db' | 'logger'> {
  correctInRoom?: (input: CorrectCardInput) => Promise<boolean>;
  audit?: AuditRecorder;
}

function cardNotFound(): HttpError {
  return new HttpError(404, 'card_not_found', 'Card not found');
}

function invalidResponse(): HttpError {
  return new HttpError(400, 'invalid_response', 'Invalid response');
}

function blockIdOf(block: Block): string | undefined {
  return 'id' in block ? block.id : undefined;
}

function cardDataOf(card: BlockCardRow): BlocksData {
  const decoded = Schema.decodeUnknownOption(BlocksDataSchema)(card.data);
  if (Option.isNone(decoded)) {
    throw cardNotFound();
  }
  return decoded.value;
}

// A topic card needs a visible topic and, outside General, membership; a
// group-only card needs membership. Anything else is the same 404.
async function requireCardAccess(
  db: ServerDatabase,
  card: BlockCardRow,
  userId: string,
): Promise<void> {
  if (card.topicId !== null) {
    let isGeneral: boolean;
    try {
      isGeneral = (await requireVisibleTopic(db, card.topicId, userId)).isGeneral;
    } catch (error) {
      if (error instanceof HttpError) {
        throw cardNotFound();
      }
      throw error;
    }
    if (!isGeneral && !(await isTopicMember(db, card.topicId, userId))) {
      throw cardNotFound();
    }
    return;
  }
  if (card.groupId !== null && (await getGroupMembership(db, card.groupId, userId)) !== null) {
    return;
  }
  if (card.groupId === null && card.topicId === null) {
    // A DM card lives only in the AI's DM, so only its owner may answer it.
    const ownerId = await loadAiOwnerId(db, card.aiId);
    if (ownerId === null || ownerId !== userId) {
      throw cardNotFound();
    }
    return;
  }
  throw cardNotFound();
}

type RecordedResponse =
  | { kind: 'poll'; optionIds: string[] }
  | { kind: 'item'; itemId: string; value: Record<string, unknown> };

// The answer validated against the block's kind; anything that does not fit
// answers 400.
function recordedResponse(
  block: Block,
  itemId: string | undefined,
  value: BlocksRespondValue,
): RecordedResponse {
  switch (block.kind) {
    case 'checklist': {
      if (itemId === undefined || !block.items.some((item) => item.id === itemId)) {
        throw invalidResponse();
      }
      if (typeof value.done !== 'boolean') {
        throw invalidResponse();
      }
      return { kind: 'item', itemId, value: { done: value.done } };
    }
    case 'poll': {
      if (value.optionIds === undefined) {
        throw invalidResponse();
      }
      const known = new Set(block.options.map((option) => option.id));
      const optionIds = [...new Set(value.optionIds)];
      if (!optionIds.every((id) => known.has(id))) {
        throw invalidResponse();
      }
      if (optionIds.length > 1 && block.multiple !== true) {
        throw invalidResponse();
      }
      return { kind: 'poll', optionIds };
    }
    case 'choice': {
      const selected = value.selected;
      if (
        selected === undefined ||
        !Number.isInteger(selected) ||
        selected < 0 ||
        selected >= block.options.length
      ) {
        throw invalidResponse();
      }
      return { kind: 'item', itemId: '', value: { selected } };
    }
    case 'rating': {
      const rating = value.rating;
      if (rating === undefined || !Number.isInteger(rating) || rating < 1 || rating > block.max) {
        throw invalidResponse();
      }
      return { kind: 'item', itemId: '', value: { rating } };
    }
    case 'buttons': {
      const actionId = value.actionId;
      if (actionId === undefined || !block.actions.some((action) => action.id === actionId)) {
        throw invalidResponse();
      }
      return { kind: 'item', itemId: '', value: { actionId } };
    }
    case 'form': {
      const fields = value.fields;
      if (fields === undefined) {
        throw invalidResponse();
      }
      const known = new Set(block.fields.map((field) => field.id));
      for (const [id, text] of Object.entries(fields)) {
        if (!known.has(id) || text.length > FORM_VALUE_MAX) {
          throw invalidResponse();
        }
      }
      return { kind: 'item', itemId: '', value: { fields } };
    }
    case 'alert':
      return { kind: 'item', itemId: '', value: alertAnswer(value) };
    default:
      throw invalidResponse();
  }
}

// One query for every actor, so `applyResponses` can name the checklist ticker.
async function loadNameLookup(
  db: ServerDatabase,
  rows: readonly BlockResponseRow[],
): Promise<(actorId: string) => string | undefined> {
  const ids = [...new Set(rows.map((row) => row.actorId))];
  if (ids.length === 0) {
    return () => undefined;
  }
  const users = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string }>`SELECT id, name FROM "user"
        WHERE id IN ${sql.in(ids)}`;
    }),
  );
  const names = new Map(users.map((user) => [user.id, user.name]));
  return (actorId) => names.get(actorId);
}

// If the merged data no longer decodes, keep the stored data and log the break.
function decodeMerged(
  merged: BlocksData,
  stored: BlocksData,
  logger: Logger,
  cardId: string,
): BlocksData {
  const decoded = Schema.decodeUnknownOption(BlocksDataSchema)(merged);
  if (Option.isSome(decoded)) {
    return decoded.value;
  }
  logger.warn({ cardId }, 'Card merge did not decode; keeping the stored data');
  return stored;
}

// Best effort: a stopped AI, a left room or a send error is logged and never
// fails the request.
async function correctCard(
  deps: CardRespondDeps,
  card: BlockCardRow,
  data: BlocksData,
): Promise<void> {
  const correct = deps.correctInRoom;
  if (correct === undefined) {
    deps.logger.info({ cardId: card.originId, ok: false }, 'Card correction skipped');
    return;
  }
  try {
    const ok = await correct({
      aiId: card.aiId,
      roomJid: card.roomJid,
      originalId: card.originId,
      text: data.fallback,
      payload: { v: 0, type: 'blocks', data },
    });
    if (!ok) {
      deps.logger.warn({ cardId: card.originId, ok }, 'Card correction not sent');
    }
  } catch (error) {
    deps.logger.warn(
      { cardId: card.originId, ok: false, err: error instanceof Error ? error.name : 'unknown' },
      'Card correction failed',
    );
  }
}

// Same access as an answer: a card the caller may not see answers the same 404.
export async function myPicks(
  db: ServerDatabase,
  userId: string,
  messageId: string,
): Promise<{ picks: Record<string, string[]> }> {
  const card = await findCard(db, messageId);
  if (card === null) {
    throw cardNotFound();
  }
  await requireCardAccess(db, card, userId);

  const pollBlockIds = new Set(
    cardDataOf(card)
      .blocks.filter((block) => block.kind === 'poll')
      .map((block) => blockIdOf(block)),
  );
  const picks: Record<string, string[]> = {};
  for (const row of await listResponses(db, card.originId)) {
    if (row.actorId !== userId || row.itemId === '' || !pollBlockIds.has(row.blockId)) {
      continue;
    }
    const options = picks[row.blockId] ?? [];
    options.push(row.itemId);
    picks[row.blockId] = options;
  }
  return { picks };
}

export async function respondToCard(
  deps: CardRespondDeps,
  userId: string,
  input: BlocksRespondPayload,
): Promise<{ data: BlocksData }> {
  const card = await findCard(deps.db, input.messageId);
  if (card === null) {
    throw cardNotFound();
  }
  const data = cardDataOf(card);
  await requireCardAccess(deps.db, card, userId);

  const block = data.blocks.find((candidate) => blockIdOf(candidate) === input.blockId);
  if (block === undefined) {
    throw invalidResponse();
  }
  if (block.kind === 'alert')
    await requireAlertManager(deps.db, card.originId, input.blockId, userId);
  const recorded = recordedResponse(block, input.itemId, input.value);

  if (recorded.kind === 'poll') {
    await replacePollVotes(deps.db, {
      cardId: card.originId,
      blockId: input.blockId,
      actorId: userId,
      optionIds: recorded.optionIds,
    });
  } else {
    await upsertResponse(deps.db, {
      cardId: card.originId,
      blockId: input.blockId,
      itemId: recorded.itemId,
      actorId: userId,
      value: recorded.value,
    });
  }
  if (recorded.kind === 'item' && block.kind === 'alert')
    await applyAlertToRoutine(deps, card, input.blockId, userId, recorded.value);

  const rows = await listResponses(deps.db, card.originId);
  const nameOf = await loadNameLookup(deps.db, rows);
  const next = decodeMerged(applyResponses(data, rows, nameOf), data, deps.logger, card.originId);
  await saveCardData(deps.db, card.originId, next);
  await correctCard(deps, card, next);
  return { data: next };
}

// The live routine linked to one card block, or undefined.
export async function findAlertRoutine(
  db: ServerDatabase,
  cardId: string,
  blockId: string,
): Promise<RoutineRow | undefined> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineRow>`SELECT * FROM routines
        WHERE alert_card_id = ${cardId} AND alert_block_id = ${blockId}
          AND deleted_at IS NULL
        LIMIT 1`;
      return found ?? null;
    }),
  );
  return row ?? undefined;
}

// Writes the threshold into the routine's free-form input, keeping every other key.
export async function setRoutineThreshold(
  db: ServerDatabase,
  id: string,
  threshold: number,
  now: Date,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET input = jsonb_set(
              coalesce(input, '{}'::jsonb),
              '{threshold}',
              to_jsonb(${threshold}::double precision)
            ),
            updated_at = ${now.toISOString()}
        WHERE id = ${id} AND deleted_at IS NULL`;
    }),
  );
}
