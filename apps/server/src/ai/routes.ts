import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import { HttpError } from '../errors';
import type { GenerateVirtualKeyInput, LitellmAdminClient } from './litellm-client';

const IssueVirtualKeySchema = z.object({
  models: z.array(z.string().min(1).max(256)).min(1),
  maxBudget: z.number().finite().nonnegative().optional(),
  budgetDuration: z.string().min(1).max(64).optional(),
  tpmLimit: z.number().int().positive().optional(),
  rpmLimit: z.number().int().positive().optional(),
});

type IssueVirtualKey = z.infer<typeof IssueVirtualKeySchema>;

export interface AiRoutesDependencies {
  auth: Auth;
  litellm: LitellmAdminClient;
  logger: AiRoutesLogger;
}

// Minimal slice of pino's Logger the route needs, so tests can pass a capture.
export interface AiRoutesLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// Hands a client a fresh virtual key for one AI. The response is deliberately
// just the key string and its id: the master key and provider keys never leave
// the server, and the key is a capped placeholder.
export function createAiRoutes({ auth, litellm, logger }: AiRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post('/ai/virtual-keys', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);

    const parsed = IssueVirtualKeySchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid virtual key request');
    }

    let issued;
    try {
      issued = await litellm.generateKey(toGenerateInput(parsed.data));
    } catch (error) {
      logger.warn({ err: error, userId: user.id }, 'could not issue a LiteLLM virtual key');
      throw new HttpError(502, 'llm_gateway_unavailable', 'The LLM gateway did not issue a key');
    }

    return c.json({ id: issued.id, key: issued.key });
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

function toGenerateInput(data: IssueVirtualKey): GenerateVirtualKeyInput {
  return {
    models: data.models,
    ...(data.maxBudget === undefined ? {} : { maxBudget: data.maxBudget }),
    ...(data.budgetDuration === undefined ? {} : { budgetDuration: data.budgetDuration }),
    ...(data.tpmLimit === undefined ? {} : { tpmLimit: data.tpmLimit }),
    ...(data.rpmLimit === undefined ? {} : { rpmLimit: data.rpmLimit }),
  };
}
