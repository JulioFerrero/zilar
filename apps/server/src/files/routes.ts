import { and, eq, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { mediaItems, userBlocks, xmppAccounts } from '../db/schema';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { allowedArchives, resolveChatFilter, type ArchivePool } from '../search/service';
import { indexChat } from '../media/indexer';
import { toInternalUploadUrl } from '../voice-transcription/routes';

export const FILES_RATE_LIMIT_MAX = 600;
export const FILES_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const FILES_FETCH_TIMEOUT_MS = 30 * 1000;

export interface FilesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** Absent when XMPP_ARCHIVE_DATABASE_URL is unset → every request 501s. */
  archive?: ArchivePool;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Injected in tests so the ejabberd fetch never touches the network. */
  fetchImpl?: typeof fetch;
}

const querySchema = z
  .object({
    chat: z.string().min(1).max(256),
    url: z.string().min(1).max(2048),
  })
  .strict();

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'File not found');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

// A DM peer JID maps to one of our users through `xmppAccounts.jid`. An AI
// peer has no row (and therefore no block). The lookup folds case like
// `resolveChatFilter`.
async function isDmBlocked(db: ServerDatabase, userId: string, peerJid: string): Promise<boolean> {
  const [peer] = await db
    .select({ userId: xmppAccounts.userId })
    .from(xmppAccounts)
    .where(sql`lower(${xmppAccounts.jid}) = ${peerJid.toLowerCase()}`)
    .limit(1);
  if (peer === undefined) {
    return false;
  }
  // Either direction hides the DM: a block is silent.
  const [block] = await db
    .select({ userId: userBlocks.userId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.userId, userId), eq(userBlocks.blockedUserId, peer.userId)),
        and(eq(userBlocks.userId, peer.userId), eq(userBlocks.blockedUserId, userId)),
      ),
    )
    .limit(1);
  return block !== undefined;
}

type FilesItemRow = typeof mediaItems.$inferSelect;

async function findFileRow(
  db: ServerDatabase,
  archiveOwner: string,
  chatJid: string,
  url: string,
): Promise<FilesItemRow | undefined> {
  const [row] = await db
    .select()
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.archiveOwner, archiveOwner),
        eq(mediaItems.chatJid, chatJid),
        eq(mediaItems.url, url),
        eq(mediaItems.deleted, false),
        ne(mediaItems.kind, 'link'),
      ),
    )
    .limit(1);
  return row;
}

// Only these upstream headers reach the client; everything else (cookies,
// server banners, ejabberd internals) stays behind. `Content-Type` falls back
// to the indexed mime, then to a generic binary type.
function passthroughHeaders(upstream: Headers, row: FilesItemRow): Headers {
  const headers = new Headers();
  const contentType = upstream.get('content-type') ?? row.mime ?? 'application/octet-stream';
  headers.set('content-type', contentType);
  for (const name of [
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  if (row.kind === 'file') {
    const name = row.name ?? 'file';
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return headers;
}

export function createFilesRoutes(deps: FilesRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const limiter = createRateLimiter({
    max: FILES_RATE_LIMIT_MAX,
    windowMs: FILES_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const fetchImpl = deps.fetchImpl ?? fetch;

  routes.get('/files', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (deps.archive === undefined) {
      throw new HttpError(501, 'files_unavailable', 'Files are not configured');
    }
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many requests, try again later');
    }
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid file query');
    }
    const internalUrl = toInternalUploadUrl(parsed.data.url, deps.config);
    if (internalUrl === null) {
      throw notFound();
    }

    const allowed = await allowedArchives(deps.db, deps.config, user.id);
    const filter = resolveChatFilter(allowed, parsed.data.chat);
    // Unknown and invisible chats answer the same 404 as every other refusal.
    if (filter === null) {
      throw notFound();
    }
    if (filter.kind === 'dm' && (await isDmBlocked(deps.db, user.id, filter.peer))) {
      throw notFound();
    }

    const archiveOwner = filter.kind === 'room' ? filter.room : allowed.ownLocalpart;
    const chatJid = filter.kind === 'room' ? filter.room : filter.peer;

    let row = await findFileRow(deps.db, archiveOwner, chatJid, parsed.data.url);
    if (row === undefined) {
      // A just-sent file has no indexed row yet: index this chat on demand
      // and look again. A failure is logged (ids and the error name only)
      // and the lookup below still answers.
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
        deps.logger.warn({ userId: user.id, err: errorName(error) }, 'files index failed');
      }
      row = await findFileRow(deps.db, archiveOwner, chatJid, parsed.data.url);
    }
    if (row === undefined) {
      throw notFound();
    }

    // Only the Range header crosses into ejabberd: cookies, auth and any
    // other caller header stay behind.
    const range = c.req.header('range');
    let upstream: Response;
    try {
      upstream = await fetchImpl(internalUrl, {
        signal: AbortSignal.timeout(FILES_FETCH_TIMEOUT_MS),
        ...(range === undefined ? {} : { headers: { range } }),
      });
    } catch (error) {
      deps.logger.warn({ userId: user.id, err: errorName(error) }, 'files fetch failed');
      throw new HttpError(502, 'file_unavailable', 'The file could not be loaded');
    }
    if (upstream.status === 200 || upstream.status === 206 || upstream.status === 416) {
      return new Response(upstream.body, {
        status: upstream.status as 200 | 206 | 416,
        headers: passthroughHeaders(upstream.headers, row),
      });
    }
    throw new HttpError(502, 'file_unavailable', 'The file could not be loaded');
  });

  return routes;
}
