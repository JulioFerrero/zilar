// Mirrors an AI chat's archive into `ai_memory_messages` (T-0437, plan §3.2).
// Same shape as the media indexer: a cursor-driven, bounded read of the AI's
// own archive. Text edits (corrections, retractions) rewrite the mirror and
// drop every summary node that covers the target, so a retraction always
// leaves the summaries.

import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { decodePayload } from '@zilar/protocol';
import type { ServerDatabase } from '../../db/client';
import { aiMemoryMessages, aiMemoryNodes, aiMemoryState } from '../../db/schema';
import { correctionTarget, retractTarget, stanzaFrom } from '../../search/routes';
import { extractMediaItems, type ExtractedMediaItem } from '../../media/indexer';
import type { ArchivePool, ArchiveRow } from '../../search/service';

// The read bounds, copied from the media indexer (apps/server/src/media/indexer.ts):
// no expression index exists in the ejabberd database, so each pass reads the
// newest 12 months ascending, at most 5 000 rows, and stops at the cursor.
export const MEMORY_INDEX_MAX_ROWS = 5000;
export const MEMORY_TEXT_MAX = 1000;
const MEMORY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// The gateway's chat key: `dm:<owner bare JID>` or `room:<room JID>`.
export type MemoryScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

export interface IndexMemoryInput {
  archive: ArchivePool;
  db: ServerDatabase;
  aiId: string;
  chatKey: string;
  /** The archive `username`: the AI's localpart for a DM, the room JID for a room. */
  archiveOwner: string;
  scope: MemoryScope;
  /** The AI's bare JID; its own archive rows are stored with the sender "AI". */
  aiBareJid: string;
  /** The DM owner's display name; defaults to "Owner". */
  ownerName?: string | undefined;
  now: Date;
}

export interface IndexMemoryResult {
  /** Rows read from the archive on this pass. */
  read: number;
  /** Rows actually inserted (conflicts count nothing). */
  inserted: number;
  /** True when this pass reached the end of the window. */
  done: boolean;
}

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer. The
// media indexer reads the same payload for attachments and voice notes; a
// sticker is the one kind it drops, so it is decoded here to become
// "[sticker]".
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_PATTERN = new RegExp(
  `<agent\\b[^>]*\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["'][^>]*>([\\s\\S]*?)</agent>`,
  'i',
);

function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function isSticker(row: ArchiveRow): boolean {
  const match = AGENT_PATTERN.exec(row.xml);
  if (match === null) {
    return false;
  }
  const result = decodePayload(unescapeXmlText(match[1] ?? ''));
  return result.ok && result.payload.type === 'sticker';
}

// Bare JID, lowercased: the comparison key for the AI's own messages.
function bareJid(jid: string): string {
  return jid.split('/')[0]?.toLowerCase() ?? '';
}

function cutText(text: string): string {
  return text.length <= MEMORY_TEXT_MAX ? text : text.slice(0, MEMORY_TEXT_MAX);
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// The placeholder for the first non-link item, or null when the row has only
// links (a link-only message keeps its body as the text).
function mediaPlaceholder(items: ExtractedMediaItem[]): string | null {
  for (const item of items) {
    if (item.kind === 'image') return `[image: ${item.name ?? ''}]`;
    if (item.kind === 'file') return `[file: ${item.name ?? ''}]`;
    if (item.kind === 'gif') return '[gif]';
    if (item.kind === 'voice') return `[voice ${formatDuration(item.durationMs ?? 0)}]`;
  }
  return null;
}

// The mirror text for one row: a media placeholder in front of the body, the
// body alone for a plain or link-only message, and empty when there is nothing
// to store.
export function memoryText(row: ArchiveRow): string {
  const body = (row.body ?? '').trim();
  const placeholder = mediaPlaceholder(extractMediaItems(row));
  if (placeholder !== null) {
    return cutText(body === '' ? placeholder : `${placeholder} ${body}`);
  }
  if (isSticker(row)) {
    return cutText(body === '' ? '[sticker]' : `[sticker] ${body}`);
  }
  return cutText(body);
}

function senderFor(input: IndexMemoryInput, row: ArchiveRow): string {
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === bareJid(input.aiBareJid)) {
    return 'AI';
  }
  if (input.scope.kind === 'room') {
    return row.nick;
  }
  return input.ownerName ?? 'Owner';
}

// One fully parameterized query, like the media indexer's (`$n` bindings, never
// built SQL). Ascending so the cursor advances to the newest row read.
function buildIndexQuery(input: {
  archiveOwner: string;
  scope: MemoryScope;
  cursorMicros: bigint;
  limit: number;
}): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const columns = `username AS owner, peer, bare_peer AS "barePeer", kind, nick,
    origin_id AS "originId", timestamp, xml, txt AS "body"`;
  const scope =
    input.scope.kind === 'room'
      ? `username = ${next(input.scope.room)}`
      : `username = ${next(input.archiveOwner)} AND bare_peer = ${next(input.scope.peer)}`;
  return {
    text: `SELECT ${columns} FROM archive WHERE ${scope} AND timestamp > ${next(input.cursorMicros)} ORDER BY timestamp ASC LIMIT ${next(input.limit)}`,
    values,
  };
}

type MemoryTransaction = Parameters<Parameters<ServerDatabase['transaction']>[0]>[0];

async function targetSeq(
  tx: MemoryTransaction,
  aiId: string,
  chatKey: string,
  messageId: string,
): Promise<number | null> {
  const rows = await tx
    .select({ seq: aiMemoryMessages.seq })
    .from(aiMemoryMessages)
    .where(
      and(
        eq(aiMemoryMessages.aiId, aiId),
        eq(aiMemoryMessages.chatKey, chatKey),
        eq(aiMemoryMessages.messageId, messageId),
      ),
    )
    .limit(1);
  return rows[0]?.seq ?? null;
}

// A node covers a message when `lo <= seq < hi`. Dropping them makes the tree a
// cache that is rebuilt without the edited or retracted message.
async function dropCoveringNodes(
  tx: MemoryTransaction,
  aiId: string,
  chatKey: string,
  seq: number,
): Promise<void> {
  await tx
    .delete(aiMemoryNodes)
    .where(
      and(
        eq(aiMemoryNodes.aiId, aiId),
        eq(aiMemoryNodes.chatKey, chatKey),
        lte(aiMemoryNodes.lo, seq),
        gt(aiMemoryNodes.hi, seq),
      ),
    );
}

export async function indexMemory(input: IndexMemoryInput): Promise<IndexMemoryResult> {
  const { archive, db, aiId, chatKey, archiveOwner, scope, now } = input;
  const cutoffMicros = BigInt(now.getTime() - MEMORY_WINDOW_MS) * 1000n;
  const lockKey = `${aiId}|${chatKey}`;

  let read = 0;
  let inserted = 0;
  let done = true;

  // The advisory lock serializes the two passes of one chat, and the cursor is
  // read inside the same transaction so two passes never interleave.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const state = await tx
      .select({ indexedThroughMicros: aiMemoryState.indexedThroughMicros })
      .from(aiMemoryState)
      .where(and(eq(aiMemoryState.aiId, aiId), eq(aiMemoryState.chatKey, chatKey)))
      .limit(1);
    const stored = state[0]?.indexedThroughMicros;
    const storedMicros = stored === undefined ? cutoffMicros : BigInt(stored);
    // Never read older than the 12-month window, even if the cursor is stale.
    const cursorMicros = storedMicros > cutoffMicros ? storedMicros : cutoffMicros;

    const built = buildIndexQuery({
      archiveOwner,
      scope,
      cursorMicros,
      limit: MEMORY_INDEX_MAX_ROWS,
    });
    const rows = await archive.query(built.text, built.values);
    read = rows.length;
    done = rows.length < MEMORY_INDEX_MAX_ROWS;

    const maxSeqRows = await tx
      .select({ seq: sql<number | null>`max(${aiMemoryMessages.seq})` })
      .from(aiMemoryMessages)
      .where(and(eq(aiMemoryMessages.aiId, aiId), eq(aiMemoryMessages.chatKey, chatKey)));
    let nextSeq = Number(maxSeqRows[0]?.seq ?? -1) + 1;

    let lastMicros: bigint | null = null;

    for (const row of rows) {
      lastMicros = BigInt(row.timestamp);

      // A correction replaces the target's text. The correction row itself is
      // never stored, and no seq is consumed.
      const corrected = correctionTarget(row.xml);
      if (corrected !== null) {
        const seq = await targetSeq(tx, aiId, chatKey, corrected);
        if (seq !== null) {
          await tx
            .update(aiMemoryMessages)
            .set({ text: cutText((row.body ?? '').trim()) })
            .where(
              and(
                eq(aiMemoryMessages.aiId, aiId),
                eq(aiMemoryMessages.chatKey, chatKey),
                eq(aiMemoryMessages.messageId, corrected),
              ),
            );
          await dropCoveringNodes(tx, aiId, chatKey, seq);
        }
        continue;
      }

      // A retraction deletes the target's text and drops its covering nodes.
      const retracted = retractTarget(row.xml);
      if (retracted !== null) {
        const seq = await targetSeq(tx, aiId, chatKey, retracted);
        if (seq !== null) {
          await tx
            .update(aiMemoryMessages)
            .set({ deleted: true, text: '' })
            .where(
              and(
                eq(aiMemoryMessages.aiId, aiId),
                eq(aiMemoryMessages.chatKey, chatKey),
                eq(aiMemoryMessages.messageId, retracted),
              ),
            );
          await dropCoveringNodes(tx, aiId, chatKey, seq);
        }
        continue;
      }

      const text = memoryText(row);
      if (text === '') {
        continue;
      }

      const atMicros = BigInt(row.timestamp);
      const result = await tx
        .insert(aiMemoryMessages)
        .values({
          aiId,
          chatKey,
          seq: nextSeq,
          messageId: row.originId,
          at: new Date(Number(atMicros / 1000n)),
          sender: senderFor(input, row),
          text,
          deleted: false,
        })
        // The unique key is the dedup: a re-read (a forced-back cursor) inserts
        // nothing and consumes no seq, so seqs stay dense.
        .onConflictDoNothing({
          target: [aiMemoryMessages.aiId, aiMemoryMessages.chatKey, aiMemoryMessages.messageId],
        })
        .returning();
      if (result.length > 0) {
        nextSeq += 1;
        inserted += 1;
      }
    }

    if (lastMicros !== null) {
      const through = Number(lastMicros);
      await tx
        .insert(aiMemoryState)
        .values({ aiId, chatKey, indexedThroughMicros: through, updatedAt: now })
        .onConflictDoUpdate({
          target: [aiMemoryState.aiId, aiMemoryState.chatKey],
          set: { indexedThroughMicros: through, updatedAt: now },
        });
    }
  });

  return { read, inserted, done };
}
