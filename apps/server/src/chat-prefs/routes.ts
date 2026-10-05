import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { listChatPrefs, putChatPref, requireChatAccess } from './service';

export const CHAT_PREFS_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_PREFS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface ChatPrefsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

// `mutedUntil`: an ISO datetime string (a far-future value means "forever"),
// or null to unmute. `pinned`: true stamps now, false clears the pin.
// Unknown keys are rejected, like the other patch-style routes.
const putChatPrefSchema = z
  .object({
    mutedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

function parseMutedUntil(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'invalid_request', 'mutedUntil must be a valid date and time');
  }
  return date;
}

// A malformed percent escape is an unknown chat (404), not a server error.
function decodePathJid(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
}

export function createChatPrefsRoutes(deps: ChatPrefsRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const writeLimiter = createRateLimiter({
    max: CHAT_PREFS_WRITE_RATE_LIMIT_MAX,
    windowMs: CHAT_PREFS_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  routes.get('/chat-prefs', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({ prefs: await listChatPrefs(deps.db, user.id) });
  });

  routes.put('/chat-prefs/:chatJid', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = putChatPrefSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { bare } = await requireChatAccess(deps.db, {
      chatJid: decodePathJid(c.req.param('chatJid')),
      userId: user.id,
      domain: deps.config.xmpp.domain,
      mucDomain: deps.config.xmpp.mucDomain,
    });
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many preference changes, try again later');
    }
    const pref = await putChatPref(deps.db, {
      userId: user.id,
      bare,
      mutedUntil: parseMutedUntil(parsed.data.mutedUntil),
      archived: parsed.data.archived,
      pinned: parsed.data.pinned,
      now: new Date(now()),
    });
    // A row back at all defaults is deleted, not kept: the client drops it.
    return c.json(pref === null ? { prefs: null } : pref);
  });

  return routes;
}
