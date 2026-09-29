import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { LitellmAdminClient } from '../ai/litellm-client';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  assignMachine,
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
  /** Audit recorder (T-0083): when present, a successful stop / resume that
   * actually flipped the AI's status writes one entry; an idempotent repeat
   * writes nothing; a 4xx writes nothing. The recorder swallows its own
   * errors, so the response is never affected. */
  audit?: AuditRecorder;
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

// T-0091: the home machine is a separate route on purpose — it does not
// belong on the general PATCH. `null` clears the assignment; the service
// only accepts an owned and approved machine. `.strict()` so an unknown
// key is a 400 instead of being silently dropped.
const AssignMachineSchema = z
  .object({
    machine_id: z.string().trim().min(1).max(128).nullable(),
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
  audit,
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
  //
  // T-0083: when an `audit` recorder is wired in, a real status flip writes
  // one entry (`ai.stopped` / `ai.resumed`); an idempotent repeat writes
  // nothing. The pre-read here is owner-checked, so a stranger gets the same
  // 404 whether or not the recorder is present, and we use it only to know
  // whether the service call actually changed the state. The service stays
  // free of audit code. The `try/catch` around `audit.record` is a defensive
  // backstop: the standard recorder swallows its own errors, but a custom or
  // buggy one must never turn a 200 into a 500 here.
  routes.post('/ais/:id/stop', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const before = await getOwnedAi(db, id, user.id);
    const ai = await stopAi({ db }, id, user.id);
    if (audit !== undefined && before !== null && before.status !== ai.status) {
      try {
        await audit.record({
          actorUserId: user.id,
          aiId: ai.id,
          groupId: null,
          action: 'ai.stopped',
          subjectId: ai.id,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: null,
        });
      } catch {
        // The recorder contract says it must not throw, but a buggy one
        // must not break the kill switch either.
      }
    }
    return c.json(ai);
  });

  routes.post('/ais/:id/resume', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const before = await getOwnedAi(db, id, user.id);
    const ai = await resumeAi({ db }, id, user.id);
    if (audit !== undefined && before !== null && before.status !== ai.status) {
      try {
        await audit.record({
          actorUserId: user.id,
          aiId: ai.id,
          groupId: null,
          action: 'ai.resumed',
          subjectId: ai.id,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: null,
        });
      } catch {
        // The recorder contract says it must not throw, but a buggy one
        // must not break the kill switch either.
      }
    }
    return c.json(ai);
  });

  // T-0091: assign or clear the AI's home machine. The audit entry is
  // written only when the value actually changed, mirroring how `stop` /
  // `resume` skip the audit on an idempotent call: a recorder that swallows
  // errors must not turn a 200 into a 500 here either. The `try/catch`
  // around `audit.record` is the same defensive backstop as the kill-switch
  // routes. `before.machine_id` and `ai.machine_id` are always either the
  // same string or one of them is `null`, so the inequality check is
  // straightforward.
  routes.put('/ais/:id/machine', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const parsed = AssignMachineSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw invalidRequest(parsed.error);
    }
    const before = await getOwnedAi(db, id, user.id);
    const ai = await assignMachine(
      { db },
      {
        aiId: id,
        ownerId: user.id,
        machineId: parsed.data.machine_id,
      },
    );
    if (audit !== undefined && before !== null && before.machine_id !== ai.machine_id) {
      try {
        await audit.record({
          actorUserId: user.id,
          aiId: ai.id,
          groupId: null,
          action: 'ai.machine_assigned',
          subjectId: ai.id,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: { machineId: ai.machine_id },
        });
      } catch {
        // The recorder contract says it must not throw, but a buggy one
        // must not break the assignment either.
      }
    }
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
