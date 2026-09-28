import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import { HttpError } from '../errors';
import type { GenerateVirtualKeyInput, LitellmAdminClient } from './litellm-client';

// The cap is SERVER-OWNED, never client-supplied. The plan's hard cap exists
// precisely because the desk (the client) must not be able to lift or widen it:
// see docs/PROJECT_PLAN.md §"Keys" ("capped placeholder keys") and the security
// table ("virtual keys with hard caps in desks"). This route is what M2 copies,
// so it must not accept a budget from the request. Do NOT re-expose maxBudget,
// budgetDuration, tpmLimit or rpmLimit here.
//
// For this spike the policy is a fixed default. M2 replaces it with a lookup of
// the AI's `ai_limits` row; the rate here is deliberately generous so it does
// not get in the way of normal use while the budget still bounds spending.
export interface VirtualKeyPolicy {
  /** Hard spend cap in USD. */
  maxBudget: number;
  /** Reset window for the budget. */
  budgetDuration: string;
  tpmLimit: number;
  rpmLimit: number;
}

export const DEFAULT_VIRTUAL_KEY_POLICY: VirtualKeyPolicy = {
  maxBudget: 5,
  budgetDuration: '30d',
  tpmLimit: 100_000,
  rpmLimit: 1_000,
};

// The only fields a caller may send. `models` is the client's ask for an
// allowlist; it is part of the cap and should move server-side with the policy
// in M2. The `.strict()` is load-bearing: a request that carries any budget or
// rate limit is rejected rather than having the field silently dropped.
const IssueVirtualKeySchema = z
  .object({
    models: z.array(z.string().min(1).max(256)).min(1).max(64),
  })
  .strict();

type IssueVirtualKey = z.infer<typeof IssueVirtualKeySchema>;

export interface AiRoutesDependencies {
  auth: Auth;
  litellm: LitellmAdminClient;
  logger: AiRoutesLogger;
  /** Per-AI cap policy. Defaults to DEFAULT_VIRTUAL_KEY_POLICY. */
  policy?: VirtualKeyPolicy;
}

// Minimal slice of pino's Logger the route needs, so tests can pass a capture.
export interface AiRoutesLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// Hands a client a fresh virtual key for one AI. The response is deliberately
// just the key string and its id: the master key and provider keys never leave
// the server, and the key is a capped placeholder whose cap the caller cannot
// see or set.
export function createAiRoutes({
  auth,
  litellm,
  logger,
  policy = DEFAULT_VIRTUAL_KEY_POLICY,
}: AiRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post('/ai/virtual-keys', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);

    const parsed = IssueVirtualKeySchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'Invalid virtual key request: budgets and rate limits are set by the server',
      );
    }

    let issued;
    try {
      issued = await litellm.generateKey(toGenerateInput(parsed.data, policy));
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

// The budget and rate limits come from the server policy, so a caller can never
// widen them. Only the model allowlist is taken from the request.
function toGenerateInput(data: IssueVirtualKey, policy: VirtualKeyPolicy): GenerateVirtualKeyInput {
  return {
    models: data.models,
    maxBudget: policy.maxBudget,
    budgetDuration: policy.budgetDuration,
    tpmLimit: policy.tpmLimit,
    rpmLimit: policy.rpmLimit,
  };
}
