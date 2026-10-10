import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import pino from 'pino';
import { createAuditRecorder, type AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { seedAi } from '../test-support/seed';
import {
  createApprovalsApi,
  type ApprovalsApiDependencies,
  type ApprovalsRouteLogger,
} from './api';
import { createApproval } from './service';

// Only `sqlRuntimeFor` is wrapped; every other export is the real module. A
// test can break the runtime for the next call; unqueued calls pass through
// (the T-0669 pattern).
vi.mock('../effect/sql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../effect/sql')>();
  return { ...actual, sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor) };
});

interface DecidedByRow {
  decidedBy: string | null;
}

interface AuditReadRow {
  id: string;
  action: string;
  subjectId: string | null;
  actorUserId: string | null;
  aiId: string | null;
  argsHash: string | null;
  result: string;
  detail: unknown;
}

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  buf[1] = (seed >> 8) & 0xff;
  return buf.toString('hex');
}

interface ApprovalsHarness {
  app: HonoRequester;
  advance: (ms: number) => void;
  audit: AuditRecorder;
}

interface HonoRequester {
  request(input: string, init?: RequestInit): Promise<Response> | Response;
}

// Dependencies for the in-process requester: the API wants a full pino
// logger, while the hook-failure test only needs an `error(fields, message)`
// captor, so accept the narrow shape and widen it where the API is built.
type ApprovalsRequesterDependencies = Omit<ApprovalsApiDependencies, 'logger'> & {
  logger?: ApprovalsRouteLogger;
};

// Routes the full `/api/...` request straight at the Effect handler, which
// renders the same error envelope Hono's `onError` used to. No Hono mount.
function approvalsRequester(deps: ApprovalsRequesterDependencies): HonoRequester {
  const api = createApprovalsApi({
    ...deps,
    logger: (deps.logger ?? pino({ level: 'silent' })) as ApprovalsApiDependencies['logger'],
  });
  return {
    request: (input: string, init?: RequestInit) => api.handler(new Request(input, init)),
  };
}

// Builds a clock-controllable requester with only the approvals routes.
// Tests still pass `testApp` to `bootstrapUser` (which writes through the
// Better Auth handler on the full app stack), then issue the approval
// requests against this mount, sending the same cookie. The session is read
// off the headers in both, so the cookie works.
function buildApprovalsHarness(context: TestContext, start: Date): ApprovalsHarness {
  let clockNow = start.getTime();
  const audit = createAuditRecorder({ db: context.db, now: () => new Date(clockNow) });

  return {
    app: approvalsRequester({
      auth: context.auth,
      db: context.db,
      audit,
      now: () => clockNow,
    }),
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<DecidedByRow>`SELECT decided_by FROM approvals WHERE id = ${created.id}`;
      }),
    );
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
        requestedBy: 'ai-bot@zilar.localhost',
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

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditReadRow>`SELECT id, action, subject_id, actor_user_id, ai_id, args_hash, result, detail FROM audit_log`;
      }),
    );
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
    const after = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditReadRow>`SELECT id, action, subject_id, actor_user_id, ai_id, args_hash, result, detail FROM audit_log`;
      }),
    );
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
        requestedBy: 'ai-bot@zilar.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    // The recorder runs on a database with no effect/sql runtime registered,
    // so every audit write throws before it reaches SQL. The recorder must
    // catch that, log it once, and the route must still answer 200. The
    // failure does not depend on how many queries run before the audit write.
    const unregisteredDb = {} as unknown as ServerDatabase;
    const auditErrors: string[] = [];
    const recorder = createAuditRecorder({
      db: unregisteredDb,
      logger: {
        error: (_fields, message) => {
          auditErrors.push(message);
        },
      },
    });

    const clockNow = now.getTime();
    const localApp = approvalsRequester({
      auth: context.auth,
      db: context.db,
      audit: recorder,
      now: () => clockNow,
    });
    const response = await localApp.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ decision: 'approve_once' }),
      },
    );
    expect(response.status).toBe(200);
    expect(auditErrors).toEqual(['audit write failed; carrying on']);
    const auditRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditReadRow>`SELECT id, action, subject_id, actor_user_id, ai_id, args_hash, result, detail FROM audit_log`;
      }),
    );
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
        requestedBy: 'ai-bot@zilar.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const hookCalls: string[] = [];
    const clockNow = now.getTime();
    const hookApp = approvalsRequester({
      auth: context.auth,
      db: context.db,
      audit: createAuditRecorder({ db: context.db, now: () => new Date(clockNow) }),
      now: () => clockNow,
      onDecided: async (approvalId) => {
        hookCalls.push(approvalId);
      },
    });

    const first = await hookApp.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(first.status).toBe(200);

    const second = await hookApp.request(`${TEST_BASE_URL}/api/approvals/${created.id}/decision`, {
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
        requestedBy: 'ai-bot@zilar.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const loggerCalls: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const clockNow = now.getTime();
    const throwingApp = approvalsRequester({
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
    });

    const response = await throwingApp.request(
      `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ decision: 'approve_once' }),
      },
    );
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
      const groupRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO groups (id, room_localpart, title, created_by) VALUES (${groupId}, ${groupRoom}, 'Crew', ${owner.id})`;
        }),
      );
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${groupId}, ${owner.id}, 'owner'), (${groupId}, ${admin.id}, 'admin')`;
        }),
      );
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_ais (group_id, ai_id, added_by) VALUES (${groupId}, ${aiId}, ${owner.id})`;
        }),
      );
      const topicId = randomUUID();
      const topicRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${topicId}, ${groupId}, 'Hiring', 'H', ${topicRoom}, 'private', 'chat', 'open', false, ${owner.id})`;
        }),
      );
      // The AI owner sees the private topic; the group admin does not.
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by) VALUES (${topicId}, ${owner.id}, ${owner.id})`;
        }),
      );
      const created = await createApproval(
        context.db,
        {
          aiId,
          groupId,
          topicId,
          action: 'send',
          summary: 'Send',
          argsHash: argsHash(90),
          requestedBy: 'ai-bot@zilar.localhost',
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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${seeded.groupId}, ${designer.id}, 'member')`;
          yield* sql`UPDATE "user" SET name = 'Zoe Designer' WHERE id = ${designer.id}`;
          yield* sql`UPDATE "user" SET name = 'Amy Owner' WHERE id = ${seeded.ownerId}`;
        }),
      );
      const roleId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_roles (id, group_id, name, created_by) VALUES (${roleId}, ${seeded.groupId}, 'Designers', ${seeded.ownerId})`;
          yield* sql`INSERT INTO group_member_roles (role_id, user_id, assigned_by) VALUES (${roleId}, ${seeded.ownerId}, ${seeded.ownerId}), (${roleId}, ${designer.id}, ${seeded.ownerId})`;
          yield* sql`UPDATE topics SET approver_role_id = ${roleId} WHERE id = ${seeded.topicId}`;
        }),
      );

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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM group_members WHERE group_id = ${seeded.groupId} AND user_id = ${designer.id}`;
        }),
      );
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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE "user" SET name = 'Amy Owner' WHERE id = ${seeded.ownerId}`;
        }),
      );
      const roleId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_roles (id, group_id, name, created_by) VALUES (${roleId}, ${seeded.groupId}, 'Designers', ${seeded.ownerId})`;
          yield* sql`INSERT INTO group_member_roles (role_id, user_id, assigned_by) VALUES (${roleId}, ${seeded.ownerId}, ${seeded.ownerId})`;
          yield* sql`UPDATE topics SET approver_role_id = ${roleId} WHERE id = ${seeded.topicId}`;
        }),
      );
      // A second private topic approved by the SAME role, with its own
      // approval. Nothing forbids sharing the role, so both cards must
      // carry the names.
      const secondTopicId = randomUUID();
      const secondRoom = `t${randomUUID().replaceAll('-', '').slice(0, 15)}`;
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${secondTopicId}, ${seeded.groupId}, 'Logos', 'L', ${secondRoom}, 'private', 'chat', 'open', false, ${seeded.ownerId})`;
          yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by) VALUES (${secondTopicId}, ${seeded.ownerId}, ${seeded.ownerId})`;
          yield* sql`UPDATE topics SET approver_role_id = ${roleId} WHERE id = ${secondTopicId}`;
        }),
      );
      const secondApproval = await createApproval(
        context.db,
        {
          aiId: seeded.aiId,
          groupId: seeded.groupId,
          topicId: secondTopicId,
          action: 'send',
          summary: 'Send',
          argsHash: argsHash(91),
          requestedBy: 'ai-bot@zilar.localhost',
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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM topic_members WHERE topic_id = ${seeded.topicId}`;
        }),
      );
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
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditReadRow>`SELECT id, action, subject_id, actor_user_id, ai_id, args_hash, result, detail FROM audit_log`;
        }),
      );
      const decided = rows.find((row) => row.action === 'approval.decided');
      expect(decided).toBeDefined();
      expect(JSON.stringify(decided)).not.toContain('Hiring');
    });
  });
});
