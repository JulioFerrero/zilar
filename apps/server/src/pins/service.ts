import { randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { pinnedMessages } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import {
  requirePinManager,
  requirePinVisible,
  resolvePinChat,
  toMissingChat,
  type PinChat,
} from './access';

export const PINS_MAX_PER_CHAT = 20;
export const PIN_SENDER_NAME_MAX = 80;
export const PIN_TEXT_MAX = 300;
export const PIN_MESSAGE_ID_MAX = 256;

export const pinKindSchema = Schema.Literals(['text', 'image', 'file', 'voice', 'card']);
export type PinKind = typeof pinKindSchema.Type;

export type PinRow = typeof pinnedMessages.$inferSelect;

export interface PinView {
  id: string;
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
  pinnedBy: string;
  pinnedAt: string;
}

// The snapshot is display-only: the server trusts it for rendering, never
// for authorization. Requests are validated at the Effect HTTP boundary in
// `api.ts`; this is the shape the service accepts.
export interface CreatePinBody {
  chat: string;
  messageId: string;
  senderName: string;
  text?: string | undefined;
  kind?: PinKind | undefined;
}

export interface PinsServiceDeps {
  db: ServerDatabase;
  domain: string;
  mucDomain: string;
  audit?: AuditRecorder;
}

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A>(
  deps: PinsServiceDeps,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(deps.db).runPromise(effect);
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

// Pins newest first. The `chat` echo uses the caller's form of the address;
// the stored key (DM pair key or room JID) never leaks through the API.
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
    deps,
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
  // The duplicate check stays outside (the unique index + 409 mapping below
  // keep it race-safe), but the count check and the insert run in one
  // transaction under a per-chat advisory lock: two concurrent pins past the
  // cap would otherwise both read under 20 and both insert.
  const [existing] = await runSql(
    deps,
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
    await sqlRuntimeFor(deps.db).runPromise(insert.pipe(Effect.mapError(mapPinError)));
  } catch (error) {
    throw error instanceof HttpError ? error : mapPinError(error);
  }
  const [row] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PinRow>`SELECT * FROM pinned_messages WHERE id = ${id} LIMIT 1`;
    }),
  );
  if (!row) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
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
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PinRow>`SELECT * FROM pinned_messages WHERE id = ${pinId} LIMIT 1`;
    }),
  );
  // A missing pin and a pin in a chat the caller may not see are the same
  // 404 ("Chat not found" either way), so pin ids cannot be told apart from
  // invisible chats.
  if (!row) {
    throw toMissingChat();
  }
  const chat = await requirePinVisible(deps.db, row.chatJid, userId, deps.domain);
  await requirePinManager(deps.db, chat, userId);
  await runSql(
    deps,
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

// DELETE carries no chat parameter, so echo the caller's own form: the peer's
// bare JID for a DM (never the stored pair key), the room JID for a topic.
function echoChat(chat: PinChat, userId: string, domain: string): string {
  if (chat.kind === 'room') {
    return chat.chatJid;
  }
  const ownBare = jidFor(localpartFor(userId), domain).toLowerCase();
  return chat.chatJid.split('|').find((side) => side !== ownBare) ?? chat.chatJid;
}

// Audit detail carries ids only — never the snapshot text or sender name —
// and no topic name for private topics (only the opaque stored chat key).
// Private-topic pins stay out of the group activity feed entirely (no
// groupId), so a group admin who cannot see the topic never learns a pin
// happened there; public-topic and General pins keep their groupId.
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
  // A concurrent pin of the same message lands here (the pre-check passed,
  // the unique index refused): answer 409 like the pre-check does.
  if (isUniqueViolation(error)) {
    return new HttpError(409, 'pin_exists', 'That message is already pinned');
  }
  return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    return error.reason._tag === 'UniqueViolation';
  }
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}
