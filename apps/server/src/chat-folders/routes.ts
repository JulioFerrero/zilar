import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  createChatFolder,
  deleteChatFolder,
  FOLDER_CHAT_TYPES,
  FOLDER_CHATS_MAX,
  FOLDER_ICONS,
  FOLDER_NAME_MAX,
  listChatFolders,
  reorderChatFolders,
  updateChatFolder,
} from './service';

export const CHAT_FOLDERS_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_FOLDERS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface ChatFoldersRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

const folderChatTypeSchema = z.enum(FOLDER_CHAT_TYPES);

const jidListSchema = z
  .array(z.string().min(1).max(255))
  .max(FOLDER_CHATS_MAX)
  .refine((jids) => new Set(jids).size === jids.length, {
    message: 'Chat lists must not contain duplicates',
  });

const createFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(FOLDER_NAME_MAX),
    icon: z.enum(FOLDER_ICONS),
    includeTypes: z
      .array(folderChatTypeSchema)
      .refine((types) => new Set(types).size === types.length, {
        message: 'includeTypes must not contain duplicates',
      })
      .default([]),
    includeChats: jidListSchema.default([]),
    excludeChats: jidListSchema.default([]),
    excludeMuted: z.boolean().default(false),
    excludeRead: z.boolean().default(false),
  })
  .strict();

const patchFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(FOLDER_NAME_MAX).optional(),
    icon: z.enum(FOLDER_ICONS).optional(),
    includeTypes: z
      .array(folderChatTypeSchema)
      .refine((types) => new Set(types).size === types.length, {
        message: 'includeTypes must not contain duplicates',
      })
      .optional(),
    includeChats: jidListSchema.optional(),
    excludeChats: jidListSchema.optional(),
    excludeMuted: z.boolean().optional(),
    excludeRead: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

const orderFoldersSchema = z
  .object({
    ids: z.array(z.string().min(1)),
  })
  .strict();

function invalidRequest(error: z.ZodError): HttpError {
  return new HttpError(400, 'invalid_request', error.issues[0]?.message ?? 'Invalid request');
}

export function createChatFoldersRoutes(deps: ChatFoldersRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const writeLimiter = createRateLimiter({
    max: CHAT_FOLDERS_WRITE_RATE_LIMIT_MAX,
    windowMs: CHAT_FOLDERS_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  function checkWriteLimit(userId: string): void {
    if (!writeLimiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many folder changes, try again later');
    }
  }

  routes.get('/chat-folders', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({ folders: await listChatFolders(deps.db, user.id, new Date(now())) });
  });

  routes.post('/chat-folders', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(parsed.error);
    }
    checkWriteLimit(user.id);
    const folder = await createChatFolder(deps.db, {
      userId: user.id,
      name: parsed.data.name,
      icon: parsed.data.icon,
      includeTypes: [...parsed.data.includeTypes],
      includeChats: [...parsed.data.includeChats],
      excludeChats: [...parsed.data.excludeChats],
      excludeMuted: parsed.data.excludeMuted,
      excludeRead: parsed.data.excludeRead,
      now: new Date(now()),
    });
    return c.json({ folder }, 201);
  });

  routes.put('/chat-folders/order', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = orderFoldersSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(parsed.error);
    }
    checkWriteLimit(user.id);
    const folders = await reorderChatFolders(deps.db, {
      userId: user.id,
      ids: [...parsed.data.ids],
      now: new Date(now()),
    });
    return c.json({ folders });
  });

  routes.patch('/chat-folders/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = patchFolderSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(parsed.error);
    }
    checkWriteLimit(user.id);
    const folder = await updateChatFolder(deps.db, {
      userId: user.id,
      id: c.req.param('id'),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
      ...(parsed.data.includeTypes !== undefined
        ? { includeTypes: [...parsed.data.includeTypes] }
        : {}),
      ...(parsed.data.includeChats !== undefined
        ? { includeChats: [...parsed.data.includeChats] }
        : {}),
      ...(parsed.data.excludeChats !== undefined
        ? { excludeChats: [...parsed.data.excludeChats] }
        : {}),
      ...(parsed.data.excludeMuted !== undefined ? { excludeMuted: parsed.data.excludeMuted } : {}),
      ...(parsed.data.excludeRead !== undefined ? { excludeRead: parsed.data.excludeRead } : {}),
      now: new Date(now()),
    });
    return c.json({ folder });
  });

  routes.delete('/chat-folders/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    checkWriteLimit(user.id);
    await deleteChatFolder(deps.db, { userId: user.id, id: c.req.param('id') });
    return c.json({ deleted: true });
  });

  return routes;
}
