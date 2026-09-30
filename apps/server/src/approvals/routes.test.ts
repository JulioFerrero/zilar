import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createAuditRecorder, type AuditRecorder } from '../audit/service';
import {
  aiLimits,
  ais,
  approvals,
  auditLog,
  groupAis,
  groupMemberRoles,
  groupMembers,
  groupRoles,
  groups,
  providerConnections,
  topicMembers,
  topics,
  user,
} from '../db/schema';
import * as schema from '../db/schema';
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
  audit: AuditRecorder;
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
  const audit = createAuditRecorder({ db: context.db, now: () => new Date(clockNow) });
  const routes = new Hono();
  routes.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    throw error;
  });
  routes.route(
    '/api',
    createApprovalsRoutes({
      auth: context.auth,
      db: context.db,
      audit,
      now: () => clockNow,
    }),
  );

  return {
    app: routes as unknown as HonoRequester,
    advance: (ms: number) => {
      clockNow += ms;
    },
    audit,
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
          'alwaysEligible',
          'approverNames',
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
          'topicId',
          'topicName',
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

  it('writes one audit row on a successful decision and never on a 409', async () => {
    const owner = await bootstrapUser(context, authApp, `audit${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(11),
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
        body: JSON.stringify({ decision: 'approve_once', note: 'private note' }),
      }),
    );
    expect(decided.status).toBe(200);

    const rows = await context.db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('approval.decided');
    expect(row.subjectId).toBe(created.id);
    expect(row.actorUserId).toBe(owner.id);
    expect(row.aiId).toBe(aiId);
    expect(row.argsHash).toBe(created.argsHash);
    expect(row.result).toBe('ok');
    expect(row.detail).toEqual({ decision: 'approve_once' });
    const dumped = JSON.stringify(row);
    expect(dumped).not.toContain('private note');
    expect(dumped).not.toContain('note');

    // A second decide hits 409; nothing is appended.
    const second = await app.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      approvalsRequest({
        method: 'POST',
        cookie: owner.cookie,
        body: JSON.stringify({ decision: 'deny' }),
      }),
    );
    expect(second.status).toBe(409);
    const after = await context.db.select().from(auditLog);
    expect(after).toHaveLength(1);
  });

  it('still answers 200 when the audit recorder fails', async () => {
    const owner = await bootstrapUser(context, authApp, `auditfail${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(12),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    // A recorder whose internal `recordAudit` throws — the recorder must
    // catch and the route must still answer 200. We inject a broken `db` by
    // closing a fresh PGlite, then build a recorder on it: `recordAudit`
    // will reject, the recorder swallows, the route keeps going.
    const brokenClient = new PGlite();
    const brokenDb = drizzle(brokenClient, { schema });
    await brokenClient.close();
    const recorder = createAuditRecorder({
      db: brokenDb,
      logger: { error: () => undefined },
    });

    let clockNow = now.getTime();
    const routes = new Hono();
    routes.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    routes.route(
      '/api',
      createApprovalsRoutes({
        auth: context.auth,
        db: context.db,
        audit: recorder,
        now: () => clockNow,
      }),
    );
    const response = await routes.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(response.status).toBe(200);
    const auditRows = await context.db.select().from(auditLog);
    expect(auditRows).toHaveLength(0);
  });

  it('fires onDecided after a successful decision and not after a 409', async () => {
    const owner = await bootstrapUser(context, authApp, `hook${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(13),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const hookCalls: string[] = [];
    let clockNow = now.getTime();
    const routes = new Hono();
    routes.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    routes.route(
      '/api',
      createApprovalsRoutes({
        auth: context.auth,
        db: context.db,
        audit: createAuditRecorder({ db: context.db, now: () => new Date(clockNow) }),
        now: () => clockNow,
        onDecided: async (approvalId) => {
          hookCalls.push(approvalId);
        },
      }),
    );

    const first = await routes.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(first.status).toBe(200);

    const second = await routes.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ decision: 'deny' }),
    });
    expect(second.status).toBe(409);

    // Drain microtasks so the fire-and-forget hook has a chance to run.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(hookCalls).toEqual([created.id]);
  });

  it('a throwing onDecided hook does not change the response', async () => {
    const owner = await bootstrapUser(context, authApp, `hookthrow${testCounter}@example.com`);
    const { aiId } = await seedAi(context, owner.id);
    const created = await createApproval(
      context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send',
        argsHash: argsHash(14),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const loggerCalls: Array<{ fields: Record<string, unknown>; message: string }> = [];
    let clockNow = now.getTime();
    const routes = new Hono();
    routes.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    routes.route(
      '/api',
      createApprovalsRoutes({
        auth: context.auth,
        db: context.db,
        audit: createAuditRecorder({ db: context.db, now: () => new Date(clockNow) }),
        now: () => clockNow,
        logger: {
          error: (fields, message) => {
            loggerCalls.push({ fields, message });
          },
        },
        onDecided: () => {
          throw new Error('hook blew up');
        },
      }),
    );

    const response = await routes.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(response.status).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(loggerCalls).toHaveLength(1);
    expect(loggerCalls[0]?.message).toBe('onDecided hook threw');
  });

  describe('private topic visibility (T-0110)', () => {
    async function seedPrivateTopic(): Promise<{
      ownerCookie: string;
      ownerId: string;
      adminCookie: string;
      aiId: string;
      groupId: string;
      topicId: string;
      approvalId: string;
    }> {
      const owner = await bootstrapUser(context, authApp, `pt-owner${testCounter}@example.com`);
      const admin = await bootstrapUser(context, authApp, `pt-admin${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      const groupId = randomUUID();
      await context.db.insert(groups).values({
        id: groupId,
        roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
        title: 'Crew',
        createdBy: owner.id,
      });
      await context.db.insert(groupMembers).values([
        { groupId, userId: owner.id, role: 'owner' },
        { groupId, userId: admin.id, role: 'admin' },
      ]);
      await context.db.insert(groupAis).values({ groupId, aiId, addedBy: owner.id });
      const topicId = randomUUID();
      await context.db.insert(topics).values({
        id: topicId,
        groupId,
        name: 'Hiring',
        glyph: 'H',
        roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
        visibility: 'private',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: owner.id,
      });
      // The AI owner sees the private topic; the group admin does not.
      await context.db
        .insert(topicMembers)
        .values({ topicId, userId: owner.id, addedBy: owner.id });
      const created = await createApproval(
        context.db,
        {
          aiId,
          groupId,
          topicId,
          action: 'send',
          summary: 'Send',
          argsHash: argsHash(90),
          requestedBy: 'ai-bot@galena.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );
      return {
        ownerCookie: owner.cookie,
        ownerId: owner.id,
        adminCookie: admin.cookie,
        aiId,
        groupId,
        topicId,
        approvalId: created.id,
      };
    }

    it('a blind group admin gets 404 on the card, the list omits it, and decide answers 404', async () => {
      const seeded = await seedPrivateTopic();
      const missing = await app.request(`${TEST_BASE_URL}/api/approvals/no-such-id`, {
        headers: { cookie: seeded.adminCookie },
      });
      expect(missing.status).toBe(404);
      const missingBody = await missing.json();

      const single = await app.request(`${TEST_BASE_URL}/api/approvals/${seeded.approvalId}`, {
        headers: { cookie: seeded.adminCookie },
      });
      expect(single.status).toBe(404);
      expect(await single.json()).toEqual(missingBody);

      const list = await app.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.adminCookie },
      });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([]);

      const decide = await app.request(
        `${TEST_BASE_URL}/api/approvals/${seeded.approvalId}/decision`,
        approvalsRequest({
          cookie: seeded.adminCookie,
          method: 'POST',
          body: JSON.stringify({ decision: 'approve_once' }),
        }),
      );
      expect(decide.status).toBe(404);
      expect(await decide.json()).toEqual(missingBody);
    });

    it('the AI owner who can see the topic reads topicId/topicName and can decide', async () => {
      const seeded = await seedPrivateTopic();
      const single = await app.request(`${TEST_BASE_URL}/api/approvals/${seeded.approvalId}`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(single.status).toBe(200);
      const body = (await single.json()) as { topicId: string | null; topicName: string | null };
      expect(body.topicId).toBe(seeded.topicId);
      expect(body.topicName).toBe('Hiring');

      const list = await app.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(list.status).toBe(200);
      const rows = (await list.json()) as Array<{ id: string; topicName: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.topicName).toBe('Hiring');

      const decide = await app.request(
        `${TEST_BASE_URL}/api/approvals/${seeded.approvalId}/decision`,
        approvalsRequest({
          cookie: seeded.ownerCookie,
          method: 'POST',
          body: JSON.stringify({ decision: 'approve_once' }),
        }),
      );
      expect(decide.status).toBe(200);
    });

    it('the list carries the topic approver names so the card needs no extra read', async () => {
      const seeded = await seedPrivateTopic();
      const designer = await bootstrapUser(context, authApp, `designer${testCounter}@example.com`);
      await context.db.insert(groupMembers).values({
        groupId: seeded.groupId,
        userId: designer.id,
        role: 'member',
      });
      await context.db.update(user).set({ name: 'Zoe Designer' }).where(eq(user.id, designer.id));
      await context.db.update(user).set({ name: 'Amy Owner' }).where(eq(user.id, seeded.ownerId));
      const roleId = randomUUID();
      await context.db.insert(groupRoles).values({
        id: roleId,
        groupId: seeded.groupId,
        name: 'Designers',
        createdBy: seeded.ownerId,
      });
      await context.db.insert(groupMemberRoles).values([
        { roleId, userId: seeded.ownerId, assignedBy: seeded.ownerId },
        { roleId, userId: designer.id, assignedBy: seeded.ownerId },
      ]);
      await context.db
        .update(topics)
        .set({ approverRoleId: roleId })
        .where(eq(topics.id, seeded.topicId));

      const list = await app.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(list.status).toBe(200);
      const rows = (await list.json()) as Array<{ id: string; approverNames: string[] }>;
      expect(rows).toHaveLength(1);
      // Sorted by name, resolved server-side for a topic the viewer sees.
      expect(rows[0]?.approverNames).toEqual(['Amy Owner', 'Zoe Designer']);

      const single = await app.request(`${TEST_BASE_URL}/api/approvals/${seeded.approvalId}`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(single.status).toBe(200);
      expect(((await single.json()) as { approverNames: string[] }).approverNames).toEqual([
        'Amy Owner',
        'Zoe Designer',
      ]);

      // A departed holder is never named, even if their role row survived.
      await context.db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, seeded.groupId), eq(groupMembers.userId, designer.id)));
      const relisted = await app.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(
        ((await relisted.json()) as Array<{ approverNames: string[] }>)[0]?.approverNames,
      ).toEqual(['Amy Owner']);

      // The decision response carries the names too.
      const decide = await app.request(
        `${TEST_BASE_URL}/api/approvals/${seeded.approvalId}/decision`,
        approvalsRequest({
          cookie: seeded.ownerCookie,
          method: 'POST',
          body: JSON.stringify({ decision: 'approve_once' }),
        }),
      );
      expect(decide.status).toBe(200);
      expect(((await decide.json()) as { approverNames: string[] }).approverNames).toEqual([
        'Amy Owner',
      ]);
    });

    it('fans approver names out to every topic sharing the role', async () => {
      const seeded = await seedPrivateTopic();
      await context.db.update(user).set({ name: 'Amy Owner' }).where(eq(user.id, seeded.ownerId));
      const roleId = randomUUID();
      await context.db.insert(groupRoles).values({
        id: roleId,
        groupId: seeded.groupId,
        name: 'Designers',
        createdBy: seeded.ownerId,
      });
      await context.db
        .insert(groupMemberRoles)
        .values({ roleId, userId: seeded.ownerId, assignedBy: seeded.ownerId });
      await context.db
        .update(topics)
        .set({ approverRoleId: roleId })
        .where(eq(topics.id, seeded.topicId));
      // A second private topic approved by the SAME role, with its own
      // approval. Nothing forbids sharing the role, so both cards must
      // carry the names.
      const secondTopicId = randomUUID();
      await context.db.insert(topics).values({
        id: secondTopicId,
        groupId: seeded.groupId,
        name: 'Logos',
        glyph: 'L',
        roomLocalpart: `t${randomUUID().replaceAll('-', '').slice(0, 15)}`,
        visibility: 'private',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: seeded.ownerId,
      });
      await context.db
        .insert(topicMembers)
        .values({ topicId: secondTopicId, userId: seeded.ownerId, addedBy: seeded.ownerId });
      await context.db
        .update(topics)
        .set({ approverRoleId: roleId })
        .where(eq(topics.id, secondTopicId));
      const secondApproval = await createApproval(
        context.db,
        {
          aiId: seeded.aiId,
          groupId: seeded.groupId,
          topicId: secondTopicId,
          action: 'send',
          summary: 'Send',
          argsHash: argsHash(91),
          requestedBy: 'ai-bot@galena.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );

      const list = await app.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(list.status).toBe(200);
      const rows = (await list.json()) as Array<{ id: string; approverNames: string[] }>;
      expect(rows).toHaveLength(2);
      const byId = new Map(rows.map((row) => [row.id, row.approverNames]));
      expect(byId.get(seeded.approvalId)).toEqual(['Amy Owner']);
      expect(byId.get(secondApproval.id)).toEqual(['Amy Owner']);
    });

    it('the AI owner removed from the topic loses decision rights', async () => {
      const seeded = await seedPrivateTopic();
      await context.db.delete(topicMembers).where(eq(topicMembers.topicId, seeded.topicId));
      const single = await app.request(`${TEST_BASE_URL}/api/approvals/${seeded.approvalId}`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(single.status).toBe(404);
      const decide = await app.request(
        `${TEST_BASE_URL}/api/approvals/${seeded.approvalId}/decision`,
        approvalsRequest({
          cookie: seeded.ownerCookie,
          method: 'POST',
          body: JSON.stringify({ decision: 'approve_once' }),
        }),
      );
      expect(decide.status).toBe(404);
    });

    it('the decision audit row carries ids only, never the private topic name', async () => {
      const seeded = await seedPrivateTopic();
      const decide = await app.request(
        `${TEST_BASE_URL}/api/approvals/${seeded.approvalId}/decision`,
        approvalsRequest({
          cookie: seeded.ownerCookie,
          method: 'POST',
          body: JSON.stringify({ decision: 'approve_once' }),
        }),
      );
      expect(decide.status).toBe(200);
      const rows = await context.db.select().from(auditLog);
      const decided = rows.find((row) => row.action === 'approval.decided');
      expect(decided).toBeDefined();
      expect(JSON.stringify(decided)).not.toContain('Hiring');
    });
  });
});
