import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { LitellmAdminClient } from '../ai/litellm-client';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  createAi,
  deleteAi,
  getOwnedAi,
  listAis,
  MAX_MONTHLY_USD,
  updateAi,
  type AiLimits,
  type AiLogger,
} from './service';
import { AiTemplateSchema } from './templates';

export interface AisRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: AiLogger;
  /** Absent when the gateway or the key master key is not configured: routes
   * that touch an AI answer 503 instead of failing halfway. */
  litellm?: LitellmAdminClient;
  cipher?: KeyCipher;
}

// The owner's limits. Both must be positive, the day must fit inside the
// month, and the month is bounded by the server constant. `.strict()` so an
// unknown key (say a tool pack) is rejected rather than dropped.
const LimitsSchema = z
  .object({
    perDayUsd: z.number().finite().positive(),
    perMonthUsd: z.number().finite().positive(),
  })
  .strict()
  .refine((value) => value.perDayUsd <= value.perMonthUsd, {
    error: 'perDayUsd must not be greater than perMonthUsd',
  })
  .refine((value) => value.perMonthUsd <= MAX_MONTHLY_USD, {
    error: `perMonthUsd must be at most ${MAX_MONTHLY_USD}`,
  });

const CreateAiSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    template: AiTemplateSchema,
    persona: z.string().trim().max(4000).optional(),
    providerConnectionId: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(256),
    limits: LimitsSchema,
  })
  .strict();

// PATCH may carry any subset; the service decides what actually changes. Only
// these three fields are accepted, and an unknown one is a 400.
const UpdateAiSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    persona: z.string().trim().max(4000).optional(),
    limits: LimitsSchema.optional(),
  })
  .strict();

export function createAisRoutes({
  auth,
  db,
  config,
  adminClient,
  logger,
  litellm,
  cipher,
}: AisRoutesDependencies): Hono {
  const routes = new Hono();

  const requireConfigured = (): { cipher: KeyCipher; litellm: LitellmAdminClient } => {
    if (cipher === undefined || litellm === undefined) {
      throw new HttpError(503, 'ais_unavailable', 'AI management is not configured on this server');
    }
    return { cipher, litellm };
  };

  const serviceDeps = (configured: {
    cipher: KeyCipher;
    litellm: LitellmAdminClient;
  }): Parameters<typeof createAi>[0] => ({
    db,
    adminClient,
    cipher: configured.cipher,
    litellm: configured.litellm,
    logger,
    domain: config.xmpp.domain,
  });

  routes.get('/ais', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    return c.json(await listAis(db, user.id));
  });

  routes.get('/ais/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ai = await getOwnedAi(db, c.req.param('id'), user.id);
    if (!ai) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    return c.json(ai);
  });

  routes.post('/ais', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const configured = requireConfigured();
    const parsed = CreateAiSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw invalidRequest(parsed.error);
    }
    const ai = await createAi(serviceDeps(configured), {
      ownerId: user.id,
      name: parsed.data.name,
      template: parsed.data.template,
      ...(parsed.data.persona === undefined ? {} : { persona: parsed.data.persona }),
      providerConnectionId: parsed.data.providerConnectionId,
      model: parsed.data.model,
      limits: parsed.data.limits as AiLimits,
    });
    return c.json(ai, 201);
  });

  routes.patch('/ais/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const configured = requireConfigured();
    const parsed = UpdateAiSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw invalidRequest(parsed.error);
    }
    const ai = await updateAi(serviceDeps(configured), {
      id: c.req.param('id'),
      ownerId: user.id,
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.persona === undefined ? {} : { persona: parsed.data.persona }),
      ...(parsed.data.limits === undefined ? {} : { limits: parsed.data.limits as AiLimits }),
    });
    return c.json(ai);
  });

  routes.delete('/ais/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const configured = requireConfigured();
    await deleteAi(serviceDeps(configured), c.req.param('id'), user.id);
    return c.body(null, 204);
  });

  return routes;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
  }
}

function invalidRequest(error: z.ZodError): HttpError {
  return new HttpError(400, 'invalid_request', error.issues[0]?.message ?? 'Invalid AI request');
}
