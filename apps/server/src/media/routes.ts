import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import { isDmBlocked } from '../blocks/service';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { mediaItems } from '../db/schema';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  allowedArchives,
  resolveChatFilter,
  type ArchivePool,
  type SearchOwner,
} from '../search/service';
import { indexChat, type MediaChatScope, type MediaKind } from './indexer';

export const MEDIA_RATE_LIMIT_MAX = 30;
export const MEDIA_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const MEDIA_DEFAULT_LIMIT = 50;
export const MEDIA_MAX_LIMIT = 100;

export const MEDIA_TYPES = ['media', 'files', 'links', 'voice'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

// The tab a client asks for maps to the indexed kinds it shows. `media` is the
// grid (images and gifs); the other tabs are one kind each.
const TYPE_KINDS: Record<MediaType, readonly MediaKind[]> = {
  media: ['image', 'gif'],
  files: ['file'],
  links: ['link'],
  voice: ['voice'],
};

export interface MediaRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** Absent when XMPP_ARCHIVE_DATABASE_URL is unset → every request 501s. */
  archive?: ArchivePool;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

const querySchema = z
  .object({
    chat: z.string().min(1).max(256),
    type: z.enum(MEDIA_TYPES).optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(MEDIA_MAX_LIMIT).optional(),
  })
  .strict();

export interface MediaItem {
  messageId: string;
  chat: string;
  at: string;
  senderName: string;
  kind: MediaKind;
  url?: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  linkUrl?: string;
  linkHost?: string;
}

type MediaItemRow = typeof mediaItems.$inferSelect;

// The part of a JID before `/`, lowercased: the comparison key for sender
// direction, mirroring search's `bareJid`.
function bareJid(jid: string): string {
  return jid.split('/')[0]?.toLowerCase() ?? '';
}

// The nick is the part after `/` in a room stanza's `from`; an empty nick (or
// no resource at all) answers "Unknown", like search's `senderNameFor`.
function roomNick(senderJid: string): string {
  const nick = senderJid.split('/')[1]?.trim() ?? '';
  return nick === '' ? 'Unknown' : nick;
}

function senderNameFor(
  row: MediaItemRow,
  filter: MediaChatScope,
  allowed: SearchOwner,
  domain: string,
): string {
  if (filter.kind === 'room') {
    return roomNick(row.senderJid);
  }
  // In a DM the caller's own outgoing messages carry their own bare JID as
  // the stanza `from`; anything else is the peer.
  const ownBareJid = `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
  if (bareJid(row.senderJid) === ownBareJid) {
    return 'You';
  }
  return allowed.peerNames.get(filter.peer) ?? 'Unknown';
}

// Absent fields are omitted from the payload, never sent as `null`.
function toMediaItem(row: MediaItemRow, senderName: string): MediaItem {
  return {
    messageId: row.messageId,
    chat: row.chatJid,
    at: new Date(Math.floor(row.atMicros / 1000)).toISOString(),
    senderName,
    kind: row.kind,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.name === null ? {} : { name: row.name }),
    ...(row.size === null ? {} : { size: row.size }),
    ...(row.mime === null ? {} : { mime: row.mime }),
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(row.waveform === null ? {} : { waveform: row.waveform }),
    ...(row.linkUrl === null ? {} : { linkUrl: row.linkUrl }),
    ...(row.linkHost === null ? {} : { linkHost: row.linkHost }),
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

export function createMediaRoutes(deps: MediaRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const limiter = createRateLimiter({
    max: MEDIA_RATE_LIMIT_MAX,
    windowMs: MEDIA_RATE_LIMIT_WINDOW_MS,
    now,
  });

  routes.get('/media', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (deps.archive === undefined) {
      throw new HttpError(501, 'media_unavailable', 'Media gallery is not configured');
    }
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many requests, try again later');
    }
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid media query');
    }

    const allowed = await allowedArchives(deps.db, deps.config, user.id);
    const filter = resolveChatFilter(allowed, parsed.data.chat);
    // Unknown and invisible chats answer the same 404.
    if (filter === null) {
      throw new HttpError(404, 'not_found', 'Chat not found');
    }
    if (filter.kind === 'dm' && (await isDmBlocked(deps.db, user.id, filter.peer))) {
      throw new HttpError(404, 'not_found', 'Chat not found');
    }

    const archiveOwner = filter.kind === 'room' ? filter.room : allowed.ownLocalpart;
    const chatJid = filter.kind === 'room' ? filter.room : filter.peer;
    const kinds = [...TYPE_KINDS[parsed.data.type ?? 'media']];
    const limit = parsed.data.limit ?? MEDIA_DEFAULT_LIMIT;
    const before = parsed.data.before;

    // Index the chat on demand. A failure is logged (ids and the error name
    // only, never message contents) and the rows already stored still answer.
    try {
      await indexChat({
        archive: deps.archive,
        db: deps.db,
        archiveOwner,
        chatJid,
        scope: filter,
        now: new Date(now()),
      });
    } catch (error) {
      deps.logger.warn({ userId: user.id, err: errorName(error) }, 'media index failed');
    }

    const rows = await deps.db
      .select()
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.archiveOwner, archiveOwner),
          eq(mediaItems.chatJid, chatJid),
          eq(mediaItems.deleted, false),
          inArray(mediaItems.kind, kinds),
          before === undefined ? undefined : lt(mediaItems.atMicros, before),
        ),
      )
      .orderBy(desc(mediaItems.atMicros), asc(mediaItems.id))
      // One extra row answers "is there another page?" without a count.
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row) =>
      toMediaItem(row, senderNameFor(row, filter, allowed, deps.config.xmpp.domain)),
    );
    const last = page[page.length - 1];
    const next = hasMore && last !== undefined ? String(last.atMicros) : null;

    return c.json({ items, next });
  });

  return routes;
}
