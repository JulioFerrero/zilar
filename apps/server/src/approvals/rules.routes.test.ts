import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  aiLimits,
  ais,
  approvalRules,
  approvals,
  auditLog,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topicMembers,
  topics,
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
  const jid = `${localpart}@zilar.localhost`;
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
): Promise<{ groupId: string; generalTopicId: string }> {
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
  const generalTopicId = randomUUID();
  await context.db.insert(topics).values({
    id: generalTopicId,
    groupId,
    name: 'General',
    glyph: 'G',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: true,
    createdBy: ownerId,
  });
  return { groupId, generalTopicId };
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
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.other', createdBy: owner.id },
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
      const { groupId } = await seedGroup(
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
      const { groupId, generalTopicId } = await seedGroup(
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
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: owner.id },
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
      const { groupId, generalTopicId } = await seedGroup(
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
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: owner.id },
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
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
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
      const { groupId, generalTopicId } = await seedGroup(
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
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: owner.id },
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
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
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
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
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
          requestedBy: 'ai-bot@zilar.localhost',
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
          requestedBy: 'ai-bot@zilar.localhost',
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
          requestedBy: 'ai-bot@zilar.localhost',
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

  describe('group always-allow admin gate (T-0101)', () => {
    async function seedGroupApproval(args: {
      aiOwnerEmail: string;
      memberEmail: string;
      adminEmail: string;
    }): Promise<{
      aiId: string;
      groupId: string;
      topicId: string;
      ownerCookie: string;
      memberCookie: string;
      adminCookie: string;
    }> {
      const aiOwner = await bootstrapUser(context, authApp, args.aiOwnerEmail);
      const member = await bootstrapUser(context, authApp, args.memberEmail);
      const admin = await bootstrapUser(context, authApp, args.adminEmail);
      const { aiId } = await seedAi(context, aiOwner.id);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        aiOwner.id,
        [
          // The AI owner is a plain group member: they may decide once but
          // may not create a group rule.
          { userId: aiOwner.id, role: 'member' },
          { userId: member.id, role: 'member' },
          { userId: admin.id, role: 'admin' },
        ],
        [aiId],
      );
      return {
        aiId,
        groupId,
        topicId: generalTopicId,
        ownerCookie: aiOwner.cookie,
        memberCookie: member.cookie,
        adminCookie: admin.cookie,
      };
    }

    async function createGroupApproval(
      context2: TestContext,
      args: { aiId: string; groupId: string; topicId: string; seed: number },
    ): Promise<string> {
      const row = await createApproval(
        context2.db,
        {
          aiId: args.aiId,
          groupId: args.groupId,
          topicId: args.topicId,
          action: 'demo.echo',
          summary: 'Echo',
          argsHash: argsHash(args.seed),
          requestedBy: 'ai-bot@zilar.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );
      return row.id;
    }

    function decideRequest(
      app2: Hono,
      args: { cookie: string; approvalId: string; decision: string },
    ): Promise<Response> | Response {
      return app2.request(`${TEST_BASE_URL}/api/approvals/${args.approvalId}/decision`, {
        method: 'POST',
        headers: { cookie: args.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ decision: args.decision }),
      });
    }

    it('a plain member AI owner gets 403 always_requires_admin, then approves once', async () => {
      const localApp = buildRoutesHarness(context, now, () => true);
      const aiOwner = await bootstrapUser(
        context,
        authApp,
        `member-owner-${testCounter}@example.com`,
      );
      const admin = await bootstrapUser(context, authApp, `t101-admin-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, aiOwner.id);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        aiOwner.id,
        [
          { userId: aiOwner.id, role: 'member' },
          { userId: admin.id, role: 'admin' },
        ],
        [aiId],
      );
      const approvalId = await createGroupApproval(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        seed: 60,
      });

      const refused = await decideRequest(localApp, {
        cookie: aiOwner.cookie,
        approvalId,
        decision: 'approve_always',
      });
      expect(refused.status).toBe(403);
      expect((await errorOf(refused)).code).toBe('always_requires_admin');

      const [row] = await context.db.select().from(approvals).where(eq(approvals.id, approvalId));
      expect(row?.status).toBe('pending');
      const rules = await context.db.select().from(approvalRules);
      expect(rules).toHaveLength(0);
      const auditRows = await context.db.select().from(auditLog);
      expect(auditRows.find((entry) => entry.action === 'approval_rule.created')).toBeUndefined();

      // The same person can still approve once afterwards.
      const once = await decideRequest(localApp, {
        cookie: aiOwner.cookie,
        approvalId,
        decision: 'approve_once',
      });
      expect(once.status).toBe(200);
      const body = (await once.json()) as { status: string };
      expect(body.status).toBe('approved_once');
    });

    it('a group admin who is not the AI owner can approve_always', async () => {
      const localApp = buildRoutesHarness(context, now, () => true);
      const seeded = await seedGroupApproval({
        aiOwnerEmail: `t101-owner-${testCounter}@example.com`,
        memberEmail: `t101-member-${testCounter}@example.com`,
        adminEmail: `t101-admin2-${testCounter}@example.com`,
      });
      const approvalId = await createGroupApproval(context, {
        aiId: seeded.aiId,
        groupId: seeded.groupId,
        topicId: seeded.topicId,
        seed: 61,
      });

      const onceId = await createGroupApproval(context, {
        aiId: seeded.aiId,
        groupId: seeded.groupId,
        topicId: seeded.topicId,
        seed: 62,
      });
      const once = await decideRequest(localApp, {
        cookie: seeded.adminCookie,
        approvalId: onceId,
        decision: 'approve_once',
      });
      expect(once.status).toBe(200);

      const always = await decideRequest(localApp, {
        cookie: seeded.adminCookie,
        approvalId,
        decision: 'approve_always',
      });
      expect(always.status).toBe(200);
      const rules = await context.db.select().from(approvalRules);
      expect(rules).toHaveLength(1);
      expect(rules[0]?.groupId).toBe(seeded.groupId);
    });

    it('still answers 404 for a stranger on both decisions', async () => {
      const localApp = buildRoutesHarness(context, now, () => true);
      const seeded = await seedGroupApproval({
        aiOwnerEmail: `t101-owner3-${testCounter}@example.com`,
        memberEmail: `t101-member3-${testCounter}@example.com`,
        adminEmail: `t101-admin3-${testCounter}@example.com`,
      });
      const stranger = await bootstrapUser(
        context,
        authApp,
        `t101-stranger-${testCounter}@example.com`,
      );
      const approvalId = await createGroupApproval(context, {
        aiId: seeded.aiId,
        groupId: seeded.groupId,
        topicId: seeded.topicId,
        seed: 63,
      });
      for (const decision of ['approve_once', 'approve_always']) {
        const response = await decideRequest(localApp, {
          cookie: stranger.cookie,
          approvalId,
          decision,
        });
        expect(response.status).toBe(404);
      }
    });

    it('alwaysEligible is per viewer: false for a plain-member owner, true for an admin', async () => {
      const localApp = buildRoutesHarness(context, now, () => true);
      const seeded = await seedGroupApproval({
        aiOwnerEmail: `t101-owner4-${testCounter}@example.com`,
        memberEmail: `t101-member4-${testCounter}@example.com`,
        adminEmail: `t101-admin4-${testCounter}@example.com`,
      });
      const groupApprovalId = await createGroupApproval(context, {
        aiId: seeded.aiId,
        groupId: seeded.groupId,
        topicId: seeded.topicId,
        seed: 64,
      });
      // A personal-chat approval for the same AI, so the list mixes scopes.
      const personal = await createApproval(
        context.db,
        {
          aiId: seeded.aiId,
          action: 'demo.echo',
          summary: 'Echo',
          argsHash: argsHash(164),
          requestedBy: 'ai-bot@zilar.localhost',
          expiresAt: new Date(now.getTime() + 60_000),
        },
        now,
      );

      // Single GET: the AI owner (a plain group member) sees false.
      const ownerGet = await localApp.request(`${TEST_BASE_URL}/api/approvals/${groupApprovalId}`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(ownerGet.status).toBe(200);
      expect(((await ownerGet.json()) as { alwaysEligible: boolean }).alwaysEligible).toBe(false);

      // The admin sees true on the same row.
      const adminGet = await localApp.request(`${TEST_BASE_URL}/api/approvals/${groupApprovalId}`, {
        headers: { cookie: seeded.adminCookie },
      });
      expect(adminGet.status).toBe(200);
      expect(((await adminGet.json()) as { alwaysEligible: boolean }).alwaysEligible).toBe(true);

      // A plain group member who may not decide at all still sees 404.
      const memberGet = await localApp.request(
        `${TEST_BASE_URL}/api/approvals/${groupApprovalId}`,
        { headers: { cookie: seeded.memberCookie } },
      );
      expect(memberGet.status).toBe(404);

      // The list mixes both rows for the owner; the admin only sees the
      // group row (the personal chat belongs to someone else's AI).
      const adminList = await localApp.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.adminCookie },
      });
      expect(adminList.status).toBe(200);
      const adminRows = (await adminList.json()) as Array<{
        id: string;
        alwaysEligible: boolean;
      }>;
      expect(adminRows.find((row) => row.id === groupApprovalId)?.alwaysEligible).toBe(true);
      expect(adminRows.some((row) => row.id === personal.id)).toBe(false);

      const ownerList = await localApp.request(`${TEST_BASE_URL}/api/approvals`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(ownerList.status).toBe(200);
      const ownerRows = (await ownerList.json()) as Array<{
        id: string;
        alwaysEligible: boolean;
      }>;
      expect(ownerRows.find((row) => row.id === groupApprovalId)?.alwaysEligible).toBe(false);
      expect(ownerRows.find((row) => row.id === personal.id)?.alwaysEligible).toBe(true);
    });

    it('ordering: non-eligible answers 400 and expired answers 409 before the admin check', async () => {
      const ineligibleApp = buildRoutesHarness(context, now, () => false);
      const eligibleApp = buildRoutesHarness(context, now, () => true);
      const aiOwner = await bootstrapUser(
        context,
        authApp,
        `t101-order-${testCounter}@example.com`,
      );
      const admin = await bootstrapUser(
        context,
        authApp,
        `t101-order-admin-${testCounter}@example.com`,
      );
      const { aiId } = await seedAi(context, aiOwner.id);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        aiOwner.id,
        [
          { userId: aiOwner.id, role: 'member' },
          { userId: admin.id, role: 'admin' },
        ],
        [aiId],
      );

      const notEligibleId = await createGroupApproval(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        seed: 65,
      });
      const notEligible = await decideRequest(ineligibleApp, {
        cookie: aiOwner.cookie,
        approvalId: notEligibleId,
        decision: 'approve_always',
      });
      expect(notEligible.status).toBe(400);
      expect((await errorOf(notEligible)).code).toBe('always_not_allowed');

      const expiredId = await createGroupApproval(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        seed: 66,
      });
      await context.db
        .update(approvals)
        .set({ expiresAt: new Date(now.getTime() - 1) })
        .where(eq(approvals.id, expiredId));
      const expired = await decideRequest(eligibleApp, {
        cookie: aiOwner.cookie,
        approvalId: expiredId,
        decision: 'approve_always',
      });
      expect(expired.status).toBe(409);
      expect((await errorOf(expired)).code).toBe('expired');
    });
  });

  describe('private topic visibility (T-0110)', () => {
    async function seedPrivateRule(): Promise<{
      ownerCookie: string;
      adminCookie: string;
      aiId: string;
      groupId: string;
      topicId: string;
      ruleId: string;
    }> {
      const owner = await bootstrapUser(context, authApp, `pr-owner-${testCounter}@example.com`);
      const admin = await bootstrapUser(context, authApp, `pr-admin-${testCounter}@example.com`);
      const { aiId } = await seedAi(context, owner.id);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        owner.id,
        [
          { userId: owner.id, role: 'owner' },
          { userId: admin.id, role: 'admin' },
        ],
        [aiId],
      );
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
      await context.db
        .insert(topicMembers)
        .values({ topicId, userId: owner.id, addedBy: owner.id });
      const { rule } = await createRule(
        context.db,
        { aiId, groupId, topicId, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      void generalTopicId;
      return {
        ownerCookie: owner.cookie,
        adminCookie: admin.cookie,
        aiId,
        groupId,
        topicId,
        ruleId: rule.id,
      };
    }

    it('the group list omits rules of a private topic the admin cannot see', async () => {
      const seeded = await seedPrivateRule();
      const adminList = await app.request(
        `${TEST_BASE_URL}/api/groups/${seeded.groupId}/approval-rules`,
        { headers: { cookie: seeded.adminCookie } },
      );
      expect(adminList.status).toBe(200);
      expect(await adminList.json()).toEqual([]);
      const ownerList = await app.request(
        `${TEST_BASE_URL}/api/groups/${seeded.groupId}/approval-rules`,
        { headers: { cookie: seeded.ownerCookie } },
      );
      expect(ownerList.status).toBe(200);
      const rules = (await ownerList.json()) as Array<{
        topicId: string | null;
        topicName: string | null;
      }>;
      expect(rules).toHaveLength(1);
      expect(rules[0]?.topicId).toBe(seeded.topicId);
      expect(rules[0]?.topicName).toBe('Hiring');
    });

    it('revoke answers 404 for a blind admin and a removed owner', async () => {
      const seeded = await seedPrivateRule();
      const blind = await app.request(`${TEST_BASE_URL}/api/approval-rules/${seeded.ruleId}`, {
        method: 'DELETE',
        headers: { cookie: seeded.adminCookie },
      });
      expect(blind.status).toBe(404);
      // The owner revokes fine while they can see the topic.
      const owner = await app.request(`${TEST_BASE_URL}/api/approval-rules/${seeded.ruleId}`, {
        method: 'DELETE',
        headers: { cookie: seeded.ownerCookie },
      });
      expect(owner.status).toBe(204);
    });

    it('the AI route omits rules of a private topic the owner was removed from', async () => {
      const seeded = await seedPrivateRule();
      const before = await app.request(`${TEST_BASE_URL}/api/ais/${seeded.aiId}/approval-rules`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(before.status).toBe(200);
      expect(await before.json()).toHaveLength(1);
      // The owner leaves the private topic: the rule disappears from the
      // AI route and revoke answers 404, until they are added back.
      await context.db.delete(topicMembers).where(eq(topicMembers.topicId, seeded.topicId));
      const after = await app.request(`${TEST_BASE_URL}/api/ais/${seeded.aiId}/approval-rules`, {
        headers: { cookie: seeded.ownerCookie },
      });
      expect(after.status).toBe(200);
      expect(await after.json()).toEqual([]);
      const revoke = await app.request(`${TEST_BASE_URL}/api/approval-rules/${seeded.ruleId}`, {
        method: 'DELETE',
        headers: { cookie: seeded.ownerCookie },
      });
      expect(revoke.status).toBe(404);
    });
  });
});
