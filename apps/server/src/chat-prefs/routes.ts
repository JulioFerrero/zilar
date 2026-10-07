import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  CHAT_BACKGROUND_PRESET_IDS,
  getChatBackgroundDefault,
  listChatPrefs,
  putChatBackgroundDefault,
  putChatPref,
  requireChatAccess,
} from './service';

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
// Background fields: a preset id, or an owned image id plus an optional dim;
// null clears a field. Unknown keys are rejected, like the other patch-style
// routes.
const backgroundFieldsShape = {
  backgroundPreset: z.enum(CHAT_BACKGROUND_PRESET_IDS).nullable().optional(),
  backgroundImageId: z.string().min(1).max(64).nullable().optional(),
  backgroundDim: z.number().int().min(0).max(80).nullable().optional(),
};

const putChatPrefSchema = z
  .object({
    mutedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    ...backgroundFieldsShape,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

const putChatBackgroundSchema = z
  .object(backgroundFieldsShape)
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
    const [prefs, defaultBackground] = await Promise.all([
      listChatPrefs(deps.db, user.id),
      getChatBackgroundDefault(deps.db, user.id),
    ]);
    return c.json({ prefs, defaultBackground });
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
      backgroundPreset: parsed.data.backgroundPreset,
      backgroundImageId: parsed.data.backgroundImageId,
      backgroundDim: parsed.data.backgroundDim,
      now: new Date(now()),
    });
    // A row back at all defaults is deleted, not kept: the client drops it.
    return c.json(pref === null ? { prefs: null } : pref);
  });

  routes.get('/chat-background', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({ defaultBackground: await getChatBackgroundDefault(deps.db, user.id) });
  });

  routes.put('/chat-background', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = putChatBackgroundSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many preference changes, try again later');
    }
    const defaultBackground = await putChatBackgroundDefault(deps.db, user.id, {
      backgroundPreset: parsed.data.backgroundPreset,
      backgroundImageId: parsed.data.backgroundImageId,
      backgroundDim: parsed.data.backgroundDim,
      now: new Date(now()),
    });
    return c.json({ defaultBackground });
  });

  return routes;
}
