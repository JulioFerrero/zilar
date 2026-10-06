// The AI-memory routes (T-0441, plan §3.6): view the facts and cover lines of
// one chat, delete one fact, and clear the memory. A DM is visible to and
// changeable by the AI's owner only; a room is visible to everyone who can see
// it and changeable by the AI's owner and the topic managers. Text is never
// logged.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../../auth/auth';
import { requireSession } from '../../auth/session';
import type { ServerConfig } from '../../config';
import type { ServerDatabase } from '../../db/client';
import { ais } from '../../db/schema';
import { HttpError } from '../../errors';
import { resolvePinChat } from '../../pins/access';
import { createRateLimiter } from '../../rate-limit';
import { canManageTopic } from '../../topics/access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { clearMemory, deleteFact, listFacts, renderMemoryBlock } from './store';

export const AI_MEMORY_WRITE_RATE_LIMIT_MAX = 60;
export const AI_MEMORY_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface AiMemoryRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

export interface ResolvedMemoryChat {
  aiId: string;
  chatKey: string;
  canChange: boolean;
}

// The same 404 as for an unknown chat or an unknown AI, so neither can be
// probed.
function toMissingMemoryChat(): HttpError {
  return new HttpError(404, 'not_found', 'Chat not found');
}

function toForbiddenChange(): HttpError {
  return new HttpError(
    403,
    'forbidden',
    'Only the AI owner or a room admin can change this memory',
  );
}

function toInvalidRequest(message: string | undefined): HttpError {
  return new HttpError(400, 'invalid_request', message ?? 'Invalid request');
}

// Resolves the `chat` and `ai` parameters to the stored `chat_key`, the AI id
// and whether the caller may change the memory. An unknown AI, a chat the
// caller may not see, a DM the caller does not own, or any other host all
// answer the same 404.
export async function resolveMemoryChat(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
  chat: string,
  aiId: string,
): Promise<ResolvedMemoryChat> {
  const [ai] = await db
    .select({ id: ais.id, owner: ais.owner, jid: ais.jid })
    .from(ais)
    .where(eq(ais.id, aiId))
    .limit(1);
  if (!ai) {
    throw toMissingMemoryChat();
  }

  const domain = config.xmpp.domain.toLowerCase();
  const mucDomain = config.xmpp.mucDomain.toLowerCase();
  const bare = (chat.split('/')[0] ?? '').toLowerCase();
  const at = bare.indexOf('@');
  const host = at <= 0 ? '' : bare.slice(at + 1);

  if (host === domain) {
    if (ai.owner !== userId || bare !== ai.jid.toLowerCase()) {
      throw toMissingMemoryChat();
    }
    return {
      aiId: ai.id,
      chatKey: `dm:${jidFor(localpartFor(userId), config.xmpp.domain).toLowerCase()}`,
      canChange: true,
    };
  }

  if (host === mucDomain) {
    const resolved = await resolvePinChat(db, {
      chatJid: chat,
      userId,
      domain: config.xmpp.domain,
      mucDomain: config.xmpp.mucDomain,
    });
    if (resolved.kind !== 'room') {
      throw toMissingMemoryChat();
    }
    const canChange = ai.owner === userId || (await canManageTopic(db, resolved.topic, userId));
    return { aiId: ai.id, chatKey: `room:${resolved.chatJid}`, canChange };
  }

  throw toMissingMemoryChat();
}

const chatField = z.string().min(1).max(256);
const memoryQuerySchema = z.object({ chat: chatField, ai: chatField }).strict();
const clearBodySchema = z.object({ chat: chatField, ai: chatField }).strict();

export function createAiMemoryRoutes(deps: AiMemoryRoutesDependencies): Hono {
  const routes = new Hono();
  const writeLimiter = createRateLimiter({
    max: AI_MEMORY_WRITE_RATE_LIMIT_MAX,
    windowMs: AI_MEMORY_WRITE_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  function requireWriteBudget(userId: string): void {
    if (!writeLimiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many memory changes, try again later');
    }
  }

  routes.get('/ai-memory', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const parsed = memoryQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw toInvalidRequest(parsed.error.issues[0]?.message);
    }
    const resolved = await resolveMemoryChat(
      deps.db,
      deps.config,
      user.id,
      parsed.data.chat,
      parsed.data.ai,
    );
    const [facts, lines] = await Promise.all([
      listFacts(deps.db, resolved.aiId, resolved.chatKey),
      renderMemoryBlock(deps.db, resolved.aiId, resolved.chatKey),
    ]);
    return c.json({ facts, lines, canChange: resolved.canChange });
  });

  routes.delete('/ai-memory/facts/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    requireWriteBudget(user.id);
    const parsed = memoryQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw toInvalidRequest(parsed.error.issues[0]?.message);
    }
    const resolved = await resolveMemoryChat(
      deps.db,
      deps.config,
      user.id,
      parsed.data.chat,
      parsed.data.ai,
    );
    if (!resolved.canChange) {
      throw toForbiddenChange();
    }
    const removed = await deleteFact(deps.db, resolved.aiId, resolved.chatKey, c.req.param('id'));
    if (!removed) {
      throw new HttpError(404, 'not_found', 'Fact not found');
    }
    return c.json({ ok: true });
  });

  routes.post('/ai-memory/clear', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    requireWriteBudget(user.id);
    const body = await c.req.json().catch(() => null);
    const parsed = clearBodySchema.safeParse(body);
    if (!parsed.success) {
      throw toInvalidRequest(parsed.error.issues[0]?.message);
    }
    const resolved = await resolveMemoryChat(
      deps.db,
      deps.config,
      user.id,
      parsed.data.chat,
      parsed.data.ai,
    );
    if (!resolved.canChange) {
      throw toForbiddenChange();
    }
    await clearMemory(deps.db, resolved.aiId, resolved.chatKey);
    return c.json({ ok: true });
  });

  return routes;
}
