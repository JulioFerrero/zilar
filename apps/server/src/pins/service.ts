import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { pinnedMessages } from '../db/schema';
import { HttpError } from '../errors';
import { requirePinManager, requirePinVisible, resolvePinChat, type PinChat } from './access';

export const PINS_MAX_PER_CHAT = 20;
export const PIN_SENDER_NAME_MAX = 80;
export const PIN_TEXT_MAX = 300;
export const PIN_MESSAGE_ID_MAX = 256;

export const pinKindSchema = z.enum(['text', 'image', 'file', 'voice', 'card']);
export type PinKind = z.infer<typeof pinKindSchema>;

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

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;
// Message bodies may carry tab and newline (Shift+Enter); the snapshot keeps
// the same rule and rejects every other control character.
const SNAPSHOT_WHITESPACE = new Set(['\t', '\n']);

function hasControlCharacters(value: string, allowWhitespace = false): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      if (allowWhitespace && SNAPSHOT_WHITESPACE.has(char)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

// The snapshot is display-only: the server trusts it for rendering, never
// for authorization. Still validated hard at the boundary so a hostile
// client cannot store control characters or oversized blobs.
export const createPinBodySchema = z
  .object({
    chat: z.string().min(1).max(255),
    messageId: z.string().min(1).max(PIN_MESSAGE_ID_MAX),
    senderName: z
      .string()
      .trim()
      .min(1, { message: 'senderName must not be empty' })
      .max(PIN_SENDER_NAME_MAX, {
        message: `senderName must be at most ${PIN_SENDER_NAME_MAX} characters`,
      })
      .refine((value) => !hasControlCharacters(value), {
        message: 'senderName must not contain control characters',
      }),
    text: z
      .string()
      .max(PIN_TEXT_MAX, { message: `text must be at most ${PIN_TEXT_MAX} characters` })
      .refine((value) => !hasControlCharacters(value, true), {
        message: 'text must not contain control characters',
      })
      .optional(),
    kind: pinKindSchema.optional(),
  })
  .strict();

export type CreatePinBody = z.infer<typeof createPinBodySchema>;

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
  const rows = await deps.db
    .select()
    .from(pinnedMessages)
    .where(eq(pinnedMessages.chatJid, chat.chatJid))
    .orderBy(desc(pinnedMessages.pinnedAt), desc(pinnedMessages.id));
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
  const [existing] = await deps.db
    .select({ id: pinnedMessages.id })
    .from(pinnedMessages)
    .where(
      and(eq(pinnedMessages.chatJid, chat.chatJid), eq(pinnedMessages.messageId, input.messageId)),
    )
    .limit(1);
  if (existing) {
    throw new HttpError(409, 'pin_exists', 'That message is already pinned');
  }
  try {
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chat.chatJid}))`);
      const [counter] = await tx
        .select({ total: count() })
        .from(pinnedMessages)
        .where(eq(pinnedMessages.chatJid, chat.chatJid));
      if (Number(counter?.total ?? 0) >= PINS_MAX_PER_CHAT) {
        throw new HttpError(400, 'pin_limit', `A chat has at most ${PINS_MAX_PER_CHAT} pins`);
      }
      await tx.insert(pinnedMessages).values({
        id,
        chatJid: chat.chatJid,
        messageId: input.messageId,
        senderName: input.senderName,
        text,
        kind,
        pinnedBy: input.actorId,
      });
    });
  } catch (error) {
    throw mapPinError(error);
  }
  const [row] = await deps.db
    .select()
    .from(pinnedMessages)
    .where(eq(pinnedMessages.id, id))
    .limit(1);
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
  const [row] = await deps.db
    .select()
    .from(pinnedMessages)
    .where(eq(pinnedMessages.id, pinId))
    .limit(1);
  // A missing pin and a pin in a chat the caller may not see are the same
  // 404, so pin ids cannot be probed.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Pin not found');
  }
  const chat = await requirePinVisible(deps.db, row.chatJid, userId, deps.domain);
  await requirePinManager(deps.db, chat, userId);
  await deps.db.delete(pinnedMessages).where(eq(pinnedMessages.id, pinId));
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(chat, 'message.unpinned', userId, row));
  }
  return toPinView(row, chat.chatJid);
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
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}
