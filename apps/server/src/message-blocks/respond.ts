// T-1792 (Wave 2 B9): a room member answers the interactive card an AI posted.
// The route records the answer in `block_responses`, merges every answer into
// the card, saves the merged state and corrects the card in the room as the
// AI, so everyone sees the new state. It never wakes the AI: for the decision
// kinds the client also sends the normal `@AI` reply.
//
// A card the caller may not see answers the same 404 as a missing one, so ids
// cannot be probed.

import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { BlocksRespondPayload, BlocksRespondValue } from '@zilar/api-contract';
import { BlocksDataSchema, type Block, type BlocksData, type Payload } from '@zilar/protocol';
import type { Logger } from 'pino';
import type { ServerDatabase } from '../db/client';
import type { BlockCardRow, BlockResponseRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { getGroupMembership, isTopicMember, requireVisibleTopic } from '../topics/access';
import { applyResponses } from './apply';
import { findCard, listResponses, replacePollVotes, saveCardData, upsertResponse } from './cards';

const FORM_VALUE_MAX = 120;

export interface CorrectCardInput {
  aiId: string;
  roomJid: string;
  originalId: string;
  text: string;
  payload: Payload;
}

export interface CardRespondDeps {
  db: ServerDatabase;
  logger: Logger;
  /** The live gateway's room correction; absent = no send (tests, no gateway). */
  correctInRoom?: (input: CorrectCardInput) => Promise<boolean>;
}

export type RespondInput = BlocksRespondPayload;

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

// A topic card needs a visible topic and, outside General, topic membership;
// a group-only card needs group membership. Anything else is the same 404.
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
  throw cardNotFound();
}

type RecordedResponse =
  | { kind: 'poll'; optionIds: string[] }
  | { kind: 'item'; itemId: string; value: Record<string, unknown> };

// The answer validated against the block's kind, in the shape `cards.ts`
// stores. Anything that does not fit answers 400.
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
    default:
      throw invalidResponse();
  }
}

// One query for every actor of the card, so `applyResponses` can put the
// checklist ticker's name on the item.
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

// The merged data must still be a valid card; if it is not, the stored data
// stays and the break is logged rather than written.
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

// The correction is best-effort: a stopped AI, a session that left the room
// or a send error is logged with the card id and the outcome, never fails the
// request.
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

export async function respondToCard(
  deps: CardRespondDeps,
  userId: string,
  input: RespondInput,
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

  const rows = await listResponses(deps.db, card.originId);
  const nameOf = await loadNameLookup(deps.db, rows);
  const next = decodeMerged(applyResponses(data, rows, nameOf), data, deps.logger, card.originId);
  await saveCardData(deps.db, card.originId, next);
  await correctCard(deps, card, next);
  return { data: next };
}
