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
  resumeAi,
  stopAi,
  updateAi,
  type AiLimits,
  type AiLogger,
  type PublicAi,
} from './service';
import { getAiUsage } from './usage';
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

// The spend summary the AI list and detail carry (T-0058). Null when LiteLLM
// cannot be reached: the UI shows "unavailable" and turns fail open.
export interface AiUsageSummary {
  todayUsd: number;
  windowUsd: number;
}

export type PublicAiWithUsage = PublicAi & { usage: AiUsageSummary | null };

// One AI's usage read may hang with LiteLLM, so every read races this
// timeout: on timeout the AI answers `usage: null` rather than holding the
// whole list.
export const USAGE_TIMEOUT_MS = 2_000;

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
// these fields are accepted, and an unknown one is a 400. A new provider
// connection needs an explicit model, so the connection alone is a 400.
const UpdateAiSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    persona: z.string().trim().max(4000).optional(),
    limits: LimitsSchema.optional(),
    model: z.string().trim().min(1).max(256).optional(),
    providerConnectionId: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .refine((value) => value.providerConnectionId === undefined || value.model !== undefined, {
    error: 'A new provider connection needs an explicit model',
  });

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

  // Reads one AI's usage with a per-AI timeout. Without a LiteLLM client, or
  // on any failure or timeout, the AI answers `usage: null`: spend is
  // best-effort decoration on the management API, never a reason to fail it.
  const withUsage = async (ai: PublicAi): Promise<PublicAiWithUsage> => {
    if (litellm === undefined) {
      return { ...ai, usage: null };
    }
    const usage = await Promise.race([
      getAiUsage({ db, litellm, logger }, ai.id).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), USAGE_TIMEOUT_MS)),
    ]);
    if (usage === null) {
      return { ...ai, usage: null };
    }
    return { ...ai, usage: { todayUsd: usage.todayUsd, windowUsd: usage.windowUsd } };
  };

  routes.get('/ais', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ais = await listAis(db, user.id);
    // Owner only, as today: every id here came from the owner's own listing.
    // The reads run in parallel so one slow AI never holds the whole list.
    return c.json(await Promise.all(ais.map((ai) => withUsage(ai))));
  });

  routes.get('/ais/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ai = await getOwnedAi(db, c.req.param('id'), user.id);
    if (!ai) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    return c.json(await withUsage(ai));
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
      ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
      ...(parsed.data.providerConnectionId === undefined
        ? {}
        : { providerConnectionId: parsed.data.providerConnectionId }),
    });
    return c.json(ai);
  });

  routes.delete('/ais/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const configured = requireConfigured();
    await deleteAi(serviceDeps(configured), c.req.param('id'), user.id);
    return c.body(null, 204);
  });

  // T-0080: the owner's kill switch. Stop disconnects the AI at once and
  // prevents the gateway from waking it back up; resume reconnects it. Both
  // answer the public AI, so the panel can re-render against the server
  // truth without a second GET. Unlike the other writes they need only the
  // database: a kill switch must work when LiteLLM, the cipher or the
  // gateway are not configured or are down.
  routes.post('/ais/:id/stop', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ai = await stopAi({ db }, c.req.param('id'), user.id);
    return c.json(ai);
  });

  routes.post('/ais/:id/resume', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ai = await resumeAi({ db }, c.req.param('id'), user.id);
    return c.json(ai);
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
