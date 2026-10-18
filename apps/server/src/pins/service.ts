import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import type { CreatePinPayload, Pin, PinKind } from '@zilar/api-contract';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import type { PinnedMessageRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import {
  requirePinManager,
  requirePinVisible,
  resolvePinChat,
  toMissingChat,
  type PinChat,
} from './access';

export const PINS_MAX_PER_CHAT = 20;
export { PIN_MESSAGE_ID_MAX, PIN_SENDER_NAME_MAX, PIN_TEXT_MAX } from '@zilar/api-contract';

export type PinRow = PinnedMessageRow;

export type PinView = Pin;

// The snapshot is display-only: never trusted for authorization. Requests are validated
// at the HTTP boundary.
export type CreatePinBody = CreatePinPayload;

export interface PinsServiceDeps {
  db: ServerDatabase;
  domain: string;
  mucDomain: string;
  audit?: AuditRecorder;
}

export function toPinView(row: PinRow, chat: string): PinView {
  return {
    id: row.id,
    chat,
    messageId: row.messageId,
    senderName: row.senderName,
    text: row.text,
    kind: row.kind as PinKind,
    pinnedBy: row.pinnedBy,
    pinnedAt: row.pinnedAt.toISOString(),
  };
}

// The `chat` echo uses the caller's form of the address; the stored key never leaks.
export async function listPins(
  deps: PinsServiceDeps,
  chatParam: string,
  userId: string,
): Promise<PinView[]> {
  const chat = await resolvePinChat(deps.db, {
    chatJid: chatParam,
    userId,
    domain: deps.domain,
    mucDomain: deps.mucDomain,
  });
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PinRow>`SELECT * FROM pinned_messages
        WHERE chat_jid = ${chat.chatJid}
        ORDER BY pinned_at DESC, id DESC`;
    }),
  );
  return rows.map((row) => toPinView(row, chatParam));
}

export interface PinMessageInput extends CreatePinBody {
  actorId: string;
}

export async function pinMessage(deps: PinsServiceDeps, input: PinMessageInput): Promise<PinView> {
  const chat = await resolvePinChat(deps.db, {
    chatJid: input.chat,
    userId: input.actorId,
    domain: deps.domain,
    mucDomain: deps.mucDomain,
  });
  await requirePinManager(deps.db, chat, input.actorId);
  const text = input.text ?? '';
  const kind = input.kind ?? 'text';
  if (kind !== 'text' && text !== '') {
    throw new HttpError(400, 'invalid_request', 'Only text pins carry a text snapshot');
  }
  const id = randomUUID();
  // The count check and the insert share one transaction under a per-chat advisory lock,
  // so two concurrent pins past the cap cannot both read under 20 and insert.
  const [existing] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM pinned_messages
        WHERE chat_jid = ${chat.chatJid} AND message_id = ${input.messageId} LIMIT 1`;
    }),
  );
  if (existing) {
    throw new HttpError(409, 'pin_exists', 'That message is already pinned');
  }
  const insert = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`SELECT pg_advisory_xact_lock(hashtext(${chat.chatJid}))`;
        const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
          FROM pinned_messages WHERE chat_jid = ${chat.chatJid}`;
        if (Number(counter?.total ?? 0) >= PINS_MAX_PER_CHAT) {
          return yield* Effect.fail(
            new HttpError(400, 'pin_limit', `A chat has at most ${PINS_MAX_PER_CHAT} pins`),
          );
        }
        yield* sql`INSERT INTO pinned_messages (id, chat_jid, message_id, sender_name, text, kind, pinned_by)
          VALUES (${id}, ${chat.chatJid}, ${input.messageId}, ${input.senderName}, ${text}, ${kind}, ${input.actorId})`;
      }),
    );
  });
  try {
    await runSql(deps.db, insert.pipe(Effect.mapError(mapPinError)));
  } catch (error) {
    throw error instanceof HttpError ? error : mapPinError(error);
  }
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PinRow>`SELECT * FROM pinned_messages WHERE id = ${id} LIMIT 1`;
    }),
  );
  if (!row) {
    throw xmppUnavailable();
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(chat, 'message.pinned', input.actorId, row));
  }
  return toPinView(row, input.chat);
}

export async function unpinMessage(
  deps: PinsServiceDeps,
  pinId: string,
  userId: string,
): Promise<PinView> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PinRow>`SELECT * FROM pinned_messages WHERE id = ${pinId} LIMIT 1`;
    }),
  );
  // A missing pin and one in an invisible chat are the same 404, so ids cannot be told apart.
  if (!row) {
    throw toMissingChat();
  }
  const chat = await requirePinVisible(deps.db, row.chatJid, userId, deps.domain);
  await requirePinManager(deps.db, chat, userId);
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM pinned_messages WHERE id = ${pinId}`;
    }),
  );
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(chat, 'message.unpinned', userId, row));
  }
  return toPinView(row, echoChat(chat, userId, deps.domain));
}

// Echo the caller's own form: the peer's bare JID for a DM (never the pair key), the room
// JID for a topic.
function echoChat(chat: PinChat, userId: string, domain: string): string {
  if (chat.kind === 'room') {
    return chat.chatJid;
  }
  const ownBare = jidFor(localpartFor(userId), domain).toLowerCase();
  return chat.chatJid.split('|').find((side) => side !== ownBare) ?? chat.chatJid;
}

// Audit detail carries ids only — never snapshot text or sender name — and no topic name
// for private topics. Private-topic pins carry no groupId, so a group admin who cannot see
// the topic never learns a pin happened.
function toAuditEntry(chat: PinChat, action: string, actorUserId: string, row: PinRow) {
  const groupId =
    chat.kind === 'room' && chat.topic.visibility !== 'private' ? chat.topic.groupId : null;
  return {
    actorUserId,
    aiId: null as string | null,
    groupId,
    action,
    subjectId: row.id,
    argsHash: null as string | null,
    costCurrency: null as 'EUR' | 'USD' | null,
    costAmount: null as number | null,
    result: 'ok' as const,
    detail: { pinId: row.id, chatJid: row.chatJid, messageId: row.messageId },
  };
}

function mapPinError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  // A concurrent pin of the same message lands here (the pre-check passed, the unique
  // index refused): answer 409.
  if (isUniqueViolation(error)) {
    return new HttpError(409, 'pin_exists', 'That message is already pinned');
  }
  return xmppUnavailable();
}
