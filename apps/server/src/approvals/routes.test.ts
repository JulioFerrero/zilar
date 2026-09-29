import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { aiLimits, ais, approvals, providerConnections } from '../db/schema';
import { HttpError } from '../errors';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { createApprovalsRoutes } from './routes';
import { createApproval } from './service';

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  buf[1] = (seed >> 8) & 0xff;
  return buf.toString('hex');
}

async function seedAi(
  context: TestContext,
  ownerId: string,
  overrides: { name?: string } = {},
): Promise<{ aiId: string; jid: string }> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  const jid = `${localpart}@galena.localhost`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: overrides.name ?? 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return { aiId, jid };
}

interface ApprovalsHarness {
  app: HonoRequester;
  advance: (ms: number) => void;
}

interface HonoRequester {
  request(input: string, init?: RequestInit): Promise<Response> | Response;
}

// Builds a clock-controllable Hono with only the approvals routes mounted.
// Tests still pass `testApp` to `bootstrapUser` (which writes through the
// Better Auth handler on the full app stack), then issue the approval
// requests against this clock-controllable mount, sending the same cookie.
// The session is read off the headers in both apps, so the cookie works.
function buildApprovalsHarness(context: TestContext, start: Date): ApprovalsHarness {
  let clockNow = start.getTime();
  const routes = new Hono();
  routes.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    throw error;
  });
  routes.route(
    '/api',
    createApprovalsRoutes({ auth: context.auth, db: context.db, now: () => clockNow }),
  );

  return {
    app: routes as unknown as HonoRequester,
    advance: (ms: number) => {
      clockNow += ms;
    },
  };
}

describe('approvals routes', () => {
  let context: TestContext;
  let harness: ApprovalsHarness;
  let authApp: TestApp;
  let app: HonoRequester;
  let testCounter = 0;
  let now: Date;

  beforeEach(async () => {
    testCounter += 1;
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
    // `authApp` runs the Better Auth handler and other routes that the
    // approvals test needs to bootstrap a real session through.
    authApp = testApp(context);
    // `app` is a clock-controllable mount that points the approvals routes
    // at a fixed `now`. We pass cookies from the `authApp` request straight
    // through, since both apps share the same `auth` and `db`.
    harness = buildApprovalsHarness(context, now);
    app = harness.app;
  });

  afterEach(async () => {
    await context.close();
  });

  function approvalsRequest(init: RequestInit & { cookie?: string } = {}): RequestInit {
    const { cookie, ...rest } = init;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(rest.headers as Record<string, string> | undefined),
    };
    if (cookie !== undefined) {
      headers.cookie = cookie;
    }
    return { ...rest, headers };
  }

  async function errorOf(response: Response): Promise<{ code: string; message: string }> {
    const body = (await response.json()) as { error: { code: string; message: string } };
    return { code: body.error.code, message: body.error.message };
  }

  it('requires a signed-in user on every route', async () => {
    const owner = await bootstrapUser(context, authApp, `owner${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(1),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const noAuth: Record<string, string> = {};
    expect((await app.request(`${TEST_BASE_URL}/api/approvals`, { headers: noAuth })).status).toBe(
      401,
    );
    expect(
      (await app.request(`${TEST_BASE_URL}/api/approvals/${created.id}`, { headers: noAuth }))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
          method: 'POST',
          headers: noAuth,
          body: JSON.stringify({ decision: 'approve_once' }),
        })
      ).status,
    ).toBe(401);
  });

  it('lists pending requests for the AI owner and never exposes decided_by', async () => {
    const owner = await bootstrapUser(context, authApp, `list${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    await createApproval(
      context.db,
      {
        aiId,
        action: 'one',
        summary: 'first',
        argsHash: argsHash(2),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    await createApproval(
      context.db,
      {
        aiId,
        action: 'two',
        summary: 'second',
        argsHash: argsHash(3),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const response = await app.request(`${TEST_BASE_URL}/api/approvals`, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    for (const entry of body) {
      expect(entry).not.toHaveProperty('decidedBy');
      expect(entry).not.toHaveProperty('decided_by');
      expect(Object.keys(entry).sort()).toEqual(
        [
          'action',
          'aiId',
          'argsHash',
          'createdAt',
          'decidedAt',
          'details',
          'expiresAt',
          'groupId',
          'id',
          'note',
          'requestedBy',
          'status',
          'summary',
          'worstCase',
        ].sort(),
      );
    }
  });

  it('refuses a body with an unknown decision', async () => {
    const owner = await bootstrapUser(context, authApp, `bad${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(4),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const response = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'maybe' }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses a body with an unknown extra field', async () => {
    const owner = await bootstrapUser(context, authApp, `extra${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(5),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const response = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'approve_once', silent: true }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('decides a pending request, omits decided_by, and rejects a second decide with 409', async () => {
    const owner = await bootstrapUser(context, authApp, `decide${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(6),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const first = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'approve_once', note: 'ok' }),
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown> & {
      status: string;
      note: string | null;
    };
    expect(firstBody.status).toBe('approved_once');
    expect(firstBody.note).toBe('ok');
    expect(firstBody).not.toHaveProperty('decidedBy');
    expect(firstBody).not.toHaveProperty('decided_by');

    const second = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'deny' }),
      }),
    );
    expect(second.status).toBe(409);
    expect((await errorOf(second)).code).toBe('not_pending');
  });

  it('answers 404 for a decision on a missing id and never leaks existence', async () => {
    const owner = await bootstrapUser(context, authApp, `missing${testCounter}@example.com`);
    const response = await app.request(
      `${TEST_BASE_URL}/api/approvals/no-such-id/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'approve_once' }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('answers 404 (not 403) when a stranger tries to decide', async () => {
    const owner = await bootstrapUser(context, authApp, `decide-owner${testCounter}@example.com`);
    const stranger = await bootstrapUser(
      context,
      authApp,
      `decide-stranger${testCounter}@example.com`,
    );
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(7),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const response = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: stranger.cookie,
        body: JSON.stringify({ decision: 'approve_once' }),
      }),
    );
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe('not_found');
  });

  it('answers 409 expired when the row is past its expiry', async () => {
    const owner = await bootstrapUser(context, authApp, `expired${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(8),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    harness.advance(120_000);

    const response = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'approve_once' }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('expired');
  });

  it('GET /approvals/:id returns 404 for an id the user cannot see', async () => {
    const owner = await bootstrapUser(context, authApp, `get-owner${testCounter}@example.com`);
    const stranger = await bootstrapUser(
      context,
      authApp,
      `get-stranger${testCounter}@example.com`,
    );
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(9),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const response = await app.request(`${TEST_BASE_URL}/api/approvals/${created.id}`, {
      headers: { cookie: stranger.cookie },
    });
    expect(response.status).toBe(404);
  });

  it('stores decided_by in the DB but never returns it through the API', async () => {
    const owner = await bootstrapUser(context, authApp, `store${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(10),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const decided = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'approve_once' }),
      }),
    );
    expect(decided.status).toBe(200);

    // The DB row has decidedBy (the spec requires it for the audit); the
    // public API never returns it.
    const [row] = await context.db
      .select({ decidedBy: approvals.decidedBy })
      .from(approvals)
      .where(eq(approvals.id, created.id));
    expect(row?.decidedBy).toBe(owner.id);

    const response = await app.request(`${TEST_BASE_URL}/api/approvals/${created.id}`, {
      headers: { cookie: owner.cookie },
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('decidedBy');
    expect(body).not.toHaveProperty('decided_by');
  });
});
