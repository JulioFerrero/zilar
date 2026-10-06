import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { decodePayload, type Payload } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import { mediaIndexState, mediaItems } from '../db/schema';
import { correctionTarget, retractTarget, stanzaFrom } from '../search/routes';
import type { ArchivePool, ArchiveRow } from '../search/service';

// The MAM read bounds, copied from search (apps/server/src/search/routes.ts):
// no expression index is possible in the ejabberd database, so each pass reads
// newest-to-oldest within 12 months and at most 5 000 rows. The indexer reads
// the other way (ascending) to advance its cursor, and caps the stored rows
// per chat so a room cannot grow unbounded.
export const MEDIA_INDEX_MAX_ROWS = 5000;
export const MEDIA_ITEMS_CAP_PER_CHAT = 20000;
export const MEDIA_WINDOW_MONTHS = 12;
const MEDIA_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';

export interface ExtractedMediaItem {
  kind: MediaKind;
  url?: string | undefined;
  name?: string | undefined;
  mime?: string | undefined;
  size?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  durationMs?: number | undefined;
  waveform?: number[] | undefined;
  linkUrl?: string | undefined;
  linkHost?: string | undefined;
}

export interface MediaLink {
  url: string;
  host: string;
}

// How the archive is addressed, exactly as search scopes it: a room is
// `username = <room JID>`; a DM is `username = <own localpart> AND
// bare_peer = <peer bare JID>` (see search/routes.ts:200-207).
export type MediaChatScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

export interface IndexChatInput {
  archive: ArchivePool;
  db: ServerDatabase;
  /** The archive `username`: the room JID, or the DM owner's localpart. */
  archiveOwner: string;
  /** The chat JID clients address: the room JID, or the DM peer's bare JID. */
  chatJid: string;
  scope: MediaChatScope;
  now: Date;
  /** Overridable in tests; defaults to `MEDIA_ITEMS_CAP_PER_CHAT`. */
  maxRows?: number;
}

export interface IndexChatResult {
  /** Rows read from the archive on this pass. */
  read: number;
  /** Rows actually inserted (conflicts count nothing). */
  inserted: number;
  /** True when this pass reached the end of the window. */
  done: boolean;
}

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer.
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_PATTERN = new RegExp(
  `<agent\\b[^>]*\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["'][^>]*>([\\s\\S]*?)</agent>`,
  'i',
);

// The parser unescapes the five XML entities (in this order, so an escaped
// ampersand is not double-decoded).
function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// Small defensive regex readers, like `stanzaFrom`/`tagAttribute` in
// search/routes.ts — a missing or malformed element is null, never a throw.
function decodeAgentPayload(xml: string): Payload | null {
  const match = AGENT_PATTERN.exec(xml);
  if (match === null) {
    return null;
  }
  const result = decodePayload(unescapeXmlText(match[1] ?? ''));
  return result.ok ? result.payload : null;
}

// The link rule copied from `packages/chat-core/src/links.ts` (which the server
// does not depend on): only `http(s)` URLs, trailing sentence punctuation
// trimmed, a closing bracket kept only when the URL opened it. The host comes
// from `new URL`, so anything the parser rejects is dropped.
const URL_PATTERN = /https?:\/\/[^\s<]+/gi;
const ALWAYS_STRIP = new Set(['.', ',', ';', ':', '!', '?', '…', '»', '"', "'"]);
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function countCharacter(value: string, character: string): number {
  let total = 0;
  for (const item of value) {
    if (item === character) {
      total += 1;
    }
  }
  return total;
}

function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === undefined) {
      break;
    }
    if (ALWAYS_STRIP.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = Object.entries(BRACKETS).find(([, closer]) => closer === last)?.[0];
    if (opener !== undefined && countCharacter(url, last) > countCharacter(url, opener)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

// The authority rule from `packages/chat-core/src/links.ts` (`toHref`): only a
// URL whose authority (the part before the path/query/fragment) contains a
// letter or digit becomes a link. `https://-/x` is dropped here, not by the URL
// parser.
function authorityOf(url: string): string {
  const match = /^https?:\/\//i.exec(url);
  if (match === null) {
    return '';
  }
  return url.slice(match[0].length).split(/[/?#]/, 1)[0] ?? '';
}

export function extractLinks(text: string): MediaLink[] {
  const links: MediaLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    if (raw === undefined) {
      continue;
    }
    const url = trimTrailingPunctuation(raw);
    if (!/[a-z0-9]/i.test(authorityOf(url))) {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (host === '' || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ url, host });
  }
  return links;
}

// The items in one archive row: an attachment or voice note plus every link in
// the body. Pure and total: malformed XML, invalid JSON or a bad payload gives
// only the links, or nothing.
export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
  try {
    return extractMediaItemsUnsafe(row);
  } catch {
    return [];
  }
}

function extractMediaItemsUnsafe(row: ArchiveRow): ExtractedMediaItem[] {
  const items: ExtractedMediaItem[] = [];
  const payload = decodeAgentPayload(row.xml);
  if (payload !== null) {
    if (payload.type === 'attachment') {
      const attachment = payload.data;
      // A GIF is an attachment by storage and a distinct render kind by
      // convention (plan §3a): a `gif-` name with a video mime.
      const isGif = attachment.name.startsWith('gif-') && attachment.mime.startsWith('video/');
      items.push({
        kind: isGif ? 'gif' : attachment.kind,
        url: attachment.url,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
      });
    } else if (payload.type === 'voice') {
      items.push({
        kind: 'voice',
        url: payload.data.url,
        mime: payload.data.mime,
        durationMs: payload.data.duration_ms,
        waveform: payload.data.waveform,
      });
    }
  }
  for (const link of extractLinks(row.body ?? '')) {
    items.push({ kind: 'link', linkUrl: link.url, linkHost: link.host });
  }
  return items;
}

type MediaItemInsert = typeof mediaItems.$inferInsert;
type MediaTransaction = Parameters<Parameters<ServerDatabase['transaction']>[0]>[0];

interface RowBase {
  archiveOwner: string;
  chatJid: string;
  messageId: string;
  atMicros: number;
  senderJid: string;
}

// `ref` is the row's identity inside its message: the URL for a media item,
// the link URL for a link. Empty only for a voice note without a URL, which is
// still unique by `kind`.
function toInsert(item: ExtractedMediaItem, base: RowBase): MediaItemInsert {
  return {
    id: randomUUID(),
    archiveOwner: base.archiveOwner,
    chatJid: base.chatJid,
    messageId: base.messageId,
    atMicros: base.atMicros,
    senderJid: base.senderJid,
    kind: item.kind,
    url: item.url ?? null,
    name: item.name ?? null,
    mime: item.mime ?? null,
    size: item.size ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    durationMs: item.durationMs ?? null,
    waveform: item.waveform ?? null,
    linkUrl: item.linkUrl ?? null,
    linkHost: item.linkHost ?? null,
    ref: item.url ?? item.linkUrl ?? '',
    deleted: false,
  };
}

async function insertItems(tx: MediaTransaction, rows: MediaItemInsert[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const inserted = await tx
    .insert(mediaItems)
    .values(rows)
    .onConflictDoNothing({
      target: [
        mediaItems.archiveOwner,
        mediaItems.chatJid,
        mediaItems.messageId,
        mediaItems.kind,
        mediaItems.ref,
      ],
    })
    .returning();
  return inserted.length;
}

// One fully parameterized query, like search's (`$n` bindings, never built SQL).
// Ascending so the cursor advances to the newest row read; strictly greater
// than the cursor so re-running never repeats a row.
export function buildIndexQuery(input: {
  archiveOwner: string;
  scope: MediaChatScope;
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

function senderJidFor(row: ArchiveRow): string {
  return stanzaFrom(row.xml) ?? '';
}

export async function indexChat(input: IndexChatInput): Promise<IndexChatResult> {
  const { archive, db, archiveOwner, chatJid, scope, now } = input;
  const maxRows = input.maxRows ?? MEDIA_ITEMS_CAP_PER_CHAT;
  const cutoffMicros = BigInt(now.getTime() - MEDIA_WINDOW_MS) * 1000n;

  const state = await db
    .select({ indexedThroughMicros: mediaIndexState.indexedThroughMicros })
    .from(mediaIndexState)
    .where(
      and(eq(mediaIndexState.archiveOwner, archiveOwner), eq(mediaIndexState.chatJid, chatJid)),
    )
    .limit(1);
  const stored = state[0]?.indexedThroughMicros;
  const storedMicros = stored === undefined ? cutoffMicros : BigInt(stored);
  // Never read older than the 12-month window, even if the cursor is stale.
  const cursorMicros = storedMicros > cutoffMicros ? storedMicros : cutoffMicros;

  const built = buildIndexQuery({ archiveOwner, scope, cursorMicros, limit: MEDIA_INDEX_MAX_ROWS });
  const rows = await archive.query(built.text, built.values);

  let inserted = 0;
  let lastMicros: bigint | null = null;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const atMicros = Number(BigInt(row.timestamp));
      lastMicros = BigInt(row.timestamp);
      const senderJid = senderJidFor(row);
      const base = { archiveOwner, chatJid, atMicros, senderJid };

      // A correction names its target: the new text replaces the target's
      // links. The correction row itself is never indexed.
      const corrected = correctionTarget(row.xml);
      if (corrected !== null) {
        await tx
          .delete(mediaItems)
          .where(
            and(
              eq(mediaItems.archiveOwner, archiveOwner),
              eq(mediaItems.chatJid, chatJid),
              eq(mediaItems.messageId, corrected),
              eq(mediaItems.kind, 'link'),
            ),
          );
        const links = extractLinks(row.body ?? '').map((link) =>
          toInsert(
            { kind: 'link', linkUrl: link.url, linkHost: link.host },
            { ...base, messageId: corrected },
          ),
        );
        inserted += await insertItems(tx, links);
        continue;
      }

      // A retraction hides every row of the target message, links included.
      const retracted = retractTarget(row.xml);
      if (retracted !== null) {
        await tx
          .update(mediaItems)
          .set({ deleted: true })
          .where(
            and(
              eq(mediaItems.archiveOwner, archiveOwner),
              eq(mediaItems.chatJid, chatJid),
              eq(mediaItems.messageId, retracted),
            ),
          );
        continue;
      }

      const items = extractMediaItems(row);
      if (items.length > 0) {
        inserted += await insertItems(
          tx,
          items.map((item) => toInsert(item, { ...base, messageId: row.originId })),
        );
      }
    }

    if (lastMicros !== null) {
      const through = Number(lastMicros);
      await tx
        .insert(mediaIndexState)
        .values({ archiveOwner, chatJid, indexedThroughMicros: through, updatedAt: now })
        .onConflictDoUpdate({
          target: [mediaIndexState.archiveOwner, mediaIndexState.chatJid],
          set: { indexedThroughMicros: through, updatedAt: now },
        });
    }

    // One atomic statement prunes the chat down to the cap, oldest first. The
    // cap is never a check-then-insert.
    await tx.execute(
      sql`DELETE FROM media_items WHERE id IN (
        SELECT id FROM media_items
        WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
        ORDER BY at_micros DESC, id DESC
        OFFSET ${maxRows}
      )`,
    );
  });

  return { read: rows.length, inserted, done: rows.length < MEDIA_INDEX_MAX_ROWS };
}
