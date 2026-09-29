import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  aiLimits,
  ais,
  approvalRules,
  auditLog,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
} from '../db/schema';
import { HttpError } from '../errors';
import { createAuditRecorder } from '../audit/service';
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
import { createRule } from './rules';

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  buf[1] = (seed >> 8) & 0xff;
  return buf.toString('hex');
}

async function seedAi(context: TestContext, ownerId: string): Promise<{ aiId: string }> {
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
    name: 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return { aiId };
}

async function seedGroup(
  context: TestContext,
  ownerId: string,
  members: Array<{ userId: string; role: 'owner' | 'admin' | 'member' }>,
  aiIds: string[],
): Promise<string> {
  const groupId = randomUUID();
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    title: 'Trip',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values(
    members.map((entry) => ({
      groupId,
      userId: entry.userId,
      role: entry.role,
    })),
  );
  for (const aiId of aiIds) {
    await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
  }
  return groupId;
}

function buildRoutesHarness(
  context: TestContext,
  now: Date,
  alwaysEligible: (action: string) => boolean = () => false,
) {
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
      audit: createAuditRecorder({ db: context.db, now: () => now }),
      now: () => now.getTime(),
      alwaysEligible,
    }),
  );
  return routes;
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return { code: body.error.code, message: body.error.message };
}

describe('approval rules routes (T-0099)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let app: Hono;
  let testCounter = 0;
  let now: Date;

  beforeEach(async () => {
    testCounter += 1;
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
    authApp = testApp(context);
    app = buildRoutesHarness(context, now);
  });

  afterEach(async () => {
    await context.close();
  });

  describe('GET /api/ais/:id/approval-rules', () => {
    it('requires a session', async () => {
      const response = await app.request(`${TEST_BASE_URL}/api/ais/some-id/approval-rules`);
      expect(response.status).toBe(401);
    });

    it('returns 404 for a stranger and a missing AI', async () => {
      const owner = await bootstrapUser(context, authApp, `ai-owner-${testCounter}@example.com`);
      const stranger = await bootstrapUser(
        context,
        authApp,
        `ai-stranger-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const strangerResponse = await app.request(
        `${TEST_BASE_URL}/api/ais/${aiId}/approval-rules`,
        { headers: { cookie: stranger.cookie } },
      );
      expect(strangerResponse.status).toBe(404);
      const missingResponse = await app.request(
        `${TEST_BASE_URL}/api/ais/no-such-ai/approval-rules`,
        { headers: { cookie: owner.cookie } },
      );
      expect(missingResponse.status).toBe(404);
    });

    it('lists the AI owner active rules', async () => {
      const owner = await bootstrapUser(context, authApp, `ai-list-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      await createRule(
        context.db,
        { aiId, groupId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      await createRule(
        context.db,
        { aiId, groupId: null, action: 'demo.other', createdBy: owner.id },
        now,
      );
      const response = await app.request(`${TEST_BASE_URL}/api/ais/${aiId}/approval-rules`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(200);
      const rules = (await response.json()) as Array<{ action: string }>;
      expect(rules.map((r) => r.action).sort()).toEqual(['demo.echo', 'demo.other']);
    });
  });

  describe('GET /api/groups/:id/approval-rules', () => {
    it('requires a session', async () => {
      const response = await app.request(`${TEST_BASE_URL}/api/groups/some-id/approval-rules`);
      expect(response.status).toBe(401);
    });

    it('returns 404 for a non-member, plain member, and missing group', async () => {
      const owner = await bootstrapUser(context, authApp, `group-owner-${testCounter}@example.com`);
      const member = await bootstrapUser(
        context,
        authApp,
        `group-member-${testCounter}@example.com`,
      );
      const stranger = await bootstrapUser(
        context,
        authApp,
        `group-stranger-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const groupId = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
        [aiId],
      );
      for (const cookie of [member.cookie, stranger.cookie]) {
        const response = await app.request(
          `${TEST_BASE_URL}/api/groups/${groupId}/approval-rules`,
          { headers: { cookie } },
        );
        expect(response.status).toBe(404);
      }
      const missing = await app.request(
        `${TEST_BASE_URL}/api/groups/no-such-group/approval-rules`,
        { headers: { cookie: owner.cookie } },
      );
      expect(missing.status).toBe(404);
    });

    it('returns 200 for the group owner and admin', async () => {
      const owner = await bootstrapUser(
        context,
        authApp,
        `group-owner2-${testCounter}@example.com`,
      );
      const admin = await bootstrapUser(context, authApp, `group-admin-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      const groupId = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: admin.id, role: 'admin' },
        ],
        [aiId],
      );
      await createRule(
        context.db,
        { aiId, groupId, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      for (const cookie of [owner.cookie, admin.cookie]) {
        const response = await app.request(
          `${TEST_BASE_URL}/api/groups/${groupId}/approval-rules`,
          { headers: { cookie } },
        );
        expect(response.status).toBe(200);
        const rules = (await response.json()) as Array<{ action: string }>;
        expect(rules).toHaveLength(1);
        expect(rules[0]?.action).toBe('demo.echo');
      }
    });
  });

  describe('DELETE /api/approval-rules/:id', () => {
    it('requires a session', async () => {
      const response = await app.request(`${TEST_BASE_URL}/api/approval-rules/some-id`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(401);
    });

    it('returns 404 for a stranger, plain member, missing id', async () => {
      const owner = await bootstrapUser(
        context,
        authApp,
        `revoke-owner-${testCounter}@example.com`,
      );
      const member = await bootstrapUser(
        context,
        authApp,
        `revoke-member-${testCounter}@example.com`,
      );
      const stranger = await bootstrapUser(
        context,
        authApp,
        `revoke-stranger-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const groupId = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
        [aiId],
      );
      const { rule } = await createRule(
        context.db,
        { aiId, groupId, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      // Stranger and a plain member see the same 404 as a missing rule.
      for (const cookie of [stranger.cookie, member.cookie]) {
        const response = await app.request(`${TEST_BASE_URL}/api/approval-rules/${rule.id}`, {
          method: 'DELETE',
          headers: { cookie },
        });
        expect(response.status).toBe(404);
        expect((await errorOf(response)).code).toBe('not_found');
      }
      const missing = await app.request(`${TEST_BASE_URL}/api/approval-rules/no-such-id`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(missing.status).toBe(404);
      expect((await errorOf(missing)).code).toBe('not_found');
    });

    it('lets the AI owner revoke a personal rule', async () => {
      const owner = await bootstrapUser(
        context,
        authApp,
        `revoke-personal-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const { rule } = await createRule(
        context.db,
        { aiId, groupId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      const response = await app.request(`${TEST_BASE_URL}/api/approval-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(204);
      const rows = await context.db
        .select({ revokedAt: approvalRules.revokedAt })
        .from(approvalRules)
        .where(eq(approvalRules.id, rule.id));
      expect(rows[0]?.revokedAt).not.toBeNull();
    });

    it('lets a group owner and admin revoke a group rule', async () => {
      const owner = await bootstrapUser(
        context,
        authApp,
        `revoke-group-owner-${testCounter}@example.com`,
      );
      const admin = await bootstrapUser(
        context,
        authApp,
        `revoke-group-admin-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const groupId = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: admin.id, role: 'admin' },
        ],
        [aiId],
      );
      const { rule } = await createRule(
        context.db,
        { aiId, groupId, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      for (const cookie of [owner.cookie, admin.cookie]) {
        const response = await app.request(`${TEST_BASE_URL}/api/approval-rules/${rule.id}`, {
          method: 'DELETE',
          headers: { cookie },
        });
        expect(response.status).toBe(204);
      }
    });

    it('is idempotent: a second revoke is also 204', async () => {
      const owner = await bootstrapUser(context, authApp, `revoke-idem-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      const { rule } = await createRule(
        context.db,
        { aiId, groupId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      const first = await app.request(`${TEST_BASE_URL}/api/approval-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(first.status).toBe(204);
      const second = await app.request(`${TEST_BASE_URL}/api/approval-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(second.status).toBe(204);
    });

    it('writes one approval_rule.revoked audit entry with action and scope', async () => {
      const owner = await bootstrapUser(
        context,
        authApp,
        `revoke-audit-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const { rule } = await createRule(
        context.db,
        { aiId, groupId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      const response = await app.request(`${TEST_BASE_URL}/api/approval-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(204);

      const rows = await context.db.select().from(auditLog);
      const revoke = rows.find((row) => row.action === 'approval_rule.revoked');
      expect(revoke).toBeDefined();
      expect(revoke?.subjectId).toBe(rule.id);
      expect(revoke?.actorUserId).toBe(owner.id);
      expect(revoke?.aiId).toBe(aiId);
      expect(revoke?.detail).toEqual({ action: 'demo.echo', scope: 'personal' });
    });
  });

  describe('POST /api/approvals/:id/decision + alwaysEligible', () => {
    it('returns 400 always_not_allowed when the action is not in the registry', async () => {
      const localApp = buildRoutesHarness(context, now);
      const owner = await bootstrapUser(context, authApp, `no-elig-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      const created = await createApproval(
        context.db,
        {
          aiId,
          action: 'demo.echo',
          summary: 'Echo',
          argsHash: argsHash(20),
          requestedBy: 'ai-bot@galena.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );
      const response = await localApp.request(
        `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
        {
          method: 'POST',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'approve_always' }),
        },
      );
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('always_not_allowed');
    });

    it('succeeds and creates a rule when the action is always-eligible', async () => {
      const localApp = buildRoutesHarness(context, now, () => true);
      const owner = await bootstrapUser(
        context,
        authApp,
        `always-success-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, owner.id);
      const created = await createApproval(
        context.db,
        {
          aiId,
          action: 'demo.echo',
          summary: 'Echo',
          argsHash: argsHash(21),
          requestedBy: 'ai-bot@galena.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );
      const response = await localApp.request(
        `${TEST_BASE_URL}/api/approvals/${created.id}/decision`,
        {
          method: 'POST',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'approve_always' }),
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; alwaysEligible: boolean };
      expect(body.status).toBe('approved_always');
      expect(body.alwaysEligible).toBe(true);

      const auditRows = await context.db.select().from(auditLog);
      const created1 = auditRows.find((row) => row.action === 'approval_rule.created');
      expect(created1).toBeDefined();
    });

    it('GET /approvals reports alwaysEligible=true for an eligible action', async () => {
      const localApp = buildRoutesHarness(context, now, () => true);
      const owner = await bootstrapUser(context, authApp, `always-flag-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      await createApproval(
        context.db,
        {
          aiId,
          action: 'demo.echo',
          summary: 'Echo',
          argsHash: argsHash(22),
          requestedBy: 'ai-bot@galena.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );
      const list = await localApp.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: owner.cookie },
      });
      expect(list.status).toBe(200);
      const body = (await list.json()) as Array<{ alwaysEligible: boolean }>;
      expect(body[0]?.alwaysEligible).toBe(true);
    });
  });
});
