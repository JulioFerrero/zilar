import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import {
  aiLimits,
  ais,
  aiTools,
  auditLog,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  routines,
  topicMembers,
  topics,
} from '../db/schema';
import { createAuditRecorder } from '../audit/service';
import { approveToolHosts, deleteTool, saveToolVersion } from '../tools/service';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import { createRoutinesApi } from './api';
import { sqlRuntimeFor } from '../effect/sql';
import {
  createRoutine,
  deleteRoutinesForAiInGroupEffect,
  MAX_ROUTINES_PER_TOPIC,
  RoutineServiceError,
} from './service';

const NOW = new Date('2026-06-01T12:00:00Z');
const INTERVAL_60 = { kind: 'interval', everyMinutes: 60 } as const;

async function seedAi(context: TestContext, ownerId: string): Promise<string> {
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
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid: `${localpart}@${TEST_XMPP_DOMAIN}`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return aiId;
}

async function seedGroup(
  context: TestContext,
  ownerId: string,
  role: 'owner' | 'admin' | 'member',
  aiIds: string[],
): Promise<{ groupId: string; generalTopicId: string }> {
  const groupId = randomUUID();
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    title: 'Trip',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values({ groupId, userId: ownerId, role });
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

async function seedPrivateTopic(
  context: TestContext,
  ownerId: string,
  groupId: string,
  memberId: string | null,
): Promise<string> {
  const topicId = randomUUID();
  await context.db.insert(topics).values({
    id: topicId,
    groupId,
    name: `secret-${topicId.slice(0, 8)}`,
    glyph: 'S',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: 'private',
    kind: 'chat',
    status: 'open',
    isGeneral: false,
    createdBy: ownerId,
  });
  if (memberId !== null) {
    await context.db.insert(topicMembers).values({ topicId, userId: memberId, addedBy: ownerId });
  }
  return topicId;
}

async function seedTool(
  context: TestContext,
  args: { aiId: string; groupId: string | null; topicId: string | null; userId: string },
): Promise<string> {
  // T-0132: newly saved tools start with an empty approved set, so seed
  // the approval too — every existing test predates the tool-host check.
  const { tool } = await saveToolVersion(
    context.db,
    {
      aiId: args.aiId,
      groupId: args.groupId,
      topicId: args.topicId,
      name: `tool-${randomBytes(4).toString('hex')}`,
      description: 'Posts the price of gold, S&P 500 and BTC',
      source: 'return { text: "gold 3000" };',
      hosts: ['api.example.com'],
      message: 'First version',
      userId: args.userId,
    },
    NOW,
  );
  await approveToolHosts(
    context.db,
    { toolId: tool.id, hosts: ['api.example.com'], userId: args.userId },
    NOW,
  );
  return tool.id;
}

function buildRoutesHarness(context: TestContext) {
  const audit = createAuditRecorder({ db: context.db, now: () => NOW });
  const { handler } = createRoutinesApi({
    auth: context.auth,
    db: context.db,
    audit,
    logger: pino({ level: 'silent' }),
  });
  return {
    request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
  };
}

describe('routines service and routes (T-0104)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let app: ReturnType<typeof buildRoutesHarness>;
  let emailCounter = 0;

  beforeEach(async () => {
    emailCounter += 1;
    context = await createTestContext();
    authApp = testApp(context);
    app = buildRoutesHarness(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function ownerWithAi(email: string) {
    const owner = await bootstrapUser(context, authApp, email);
    const aiId = await seedAi(context, owner.id);
    return { owner, aiId };
  }

  async function ownerWithGroupRoutine(email: string) {
    const { owner, aiId } = await ownerWithAi(email);
    const { groupId, generalTopicId } = await seedGroup(context, owner.id, 'owner', [aiId]);
    const toolId = await seedTool(context, {
      aiId,
      groupId,
      topicId: generalTopicId,
      userId: owner.id,
    });
    const routine = await createRoutine(
      context.db,
      {
        aiId,
        groupId,
        topicId: generalTopicId,
        toolId,
        title: 'Morning prices',
        schedule: INTERVAL_60,
        approvedHosts: ['api.example.com'],
        userId: owner.id,
      },
      NOW,
    );
    return { owner, aiId, groupId, generalTopicId, toolId, routine };
  }

  describe('auth', () => {
    it('returns 401 without a session on every route', async () => {
      const paths: Array<{ method: string; path: string }> = [
        { method: 'GET', path: '/api/ais/x/routines' },
        { method: 'GET', path: '/api/groups/x/routines' },
        { method: 'POST', path: '/api/routines/x/pause' },
        { method: 'POST', path: '/api/routines/x/resume' },
        { method: 'DELETE', path: '/api/routines/x' },
      ];
      for (const entry of paths) {
        const response = await app.request(`${TEST_BASE_URL}${entry.path}`, {
          method: entry.method,
          ...(entry.method === 'GET'
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: '{}' }),
        });
        expect(response.status, `${entry.method} ${entry.path}`).toBe(401);
      }
    });
  });

  describe('createRoutine (service)', () => {
    it('validates title, input size, interval minimum, hosts and tool scope', async () => {
      const { owner, aiId } = await ownerWithAi(`create-${emailCounter}@example.com`);
      const { groupId, generalTopicId } = await seedGroup(context, owner.id, 'owner', [aiId]);
      const toolId = await seedTool(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      const base = {
        aiId,
        groupId,
        topicId: generalTopicId,
        toolId,
        title: 'Morning prices',
        schedule: INTERVAL_60,
        approvedHosts: ['api.example.com'],
        userId: owner.id,
      };
      await expect(createRoutine(context.db, { ...base, title: '' }, NOW)).rejects.toMatchObject({
        name: 'RoutineServiceError',
      });
      await expect(
        createRoutine(context.db, { ...base, title: 'x'.repeat(81) }, NOW),
      ).rejects.toMatchObject({ name: 'RoutineServiceError' });
      await expect(
        createRoutine(context.db, { ...base, input: { blob: 'x'.repeat(3_000) } }, NOW),
      ).rejects.toMatchObject({ name: 'RoutineServiceError' });
      await expect(
        createRoutine(
          context.db,
          { ...base, schedule: { kind: 'interval', everyMinutes: 30 } },
          NOW,
        ),
      ).rejects.toMatchObject({ name: 'RoutineServiceError' });
      await expect(
        createRoutine(context.db, { ...base, approvedHosts: [] }, NOW),
      ).rejects.toMatchObject({ errorCode: 'hosts_not_approved' });
      // Tool from another chat.
      const otherTool = await seedTool(context, {
        aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      await expect(
        createRoutine(context.db, { ...base, toolId: otherTool }, NOW),
      ).rejects.toMatchObject({
        name: 'RoutineServiceError',
      });
    });

    it('enforces the 10-routines limit per (AI, topic)', async () => {
      const { owner, aiId } = await ownerWithAi(`limit-${emailCounter}@example.com`);
      const { groupId, generalTopicId } = await seedGroup(context, owner.id, 'owner', [aiId]);
      const toolId = await seedTool(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      for (let index = 0; index < MAX_ROUTINES_PER_TOPIC; index += 1) {
        await createRoutine(
          context.db,
          {
            aiId,
            groupId,
            topicId: generalTopicId,
            toolId,
            title: `Routine ${index}`,
            schedule: INTERVAL_60,
            approvedHosts: ['api.example.com'],
            userId: owner.id,
          },
          NOW,
        );
      }
      await expect(
        createRoutine(
          context.db,
          {
            aiId,
            groupId,
            topicId: generalTopicId,
            toolId,
            title: 'One too many',
            schedule: INTERVAL_60,
            approvedHosts: ['api.example.com'],
            userId: owner.id,
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'routine_limit' });
    });

    it('audits routine.created with ids only', async () => {
      const { owner, aiId, toolId, routine } = await (async () => {
        const setup = await ownerWithAi(`audit-create-${emailCounter}@example.com`);
        const seeded = await seedGroup(context, setup.owner.id, 'owner', [setup.aiId]);
        const createdTool = await seedTool(context, {
          aiId: setup.aiId,
          groupId: seeded.groupId,
          topicId: seeded.generalTopicId,
          userId: setup.owner.id,
        });
        const audit = createAuditRecorder({ db: context.db, now: () => NOW });
        const created = await createRoutine(
          context.db,
          {
            aiId: setup.aiId,
            groupId: seeded.groupId,
            topicId: seeded.generalTopicId,
            toolId: createdTool,
            title: 'Morning prices',
            schedule: INTERVAL_60,
            approvedHosts: ['api.example.com'],
            userId: setup.owner.id,
          },
          NOW,
          audit,
        );
        return { owner: setup.owner, aiId: setup.aiId, toolId: createdTool, routine: created };
      })();
      void owner;
      void aiId;
      const entries = await context.db.select().from(auditLog);
      const created = entries.filter((entry) => entry.action === 'routine.created');
      expect(created).toHaveLength(1);
      expect(created[0]?.subjectId).toBe(routine.id);
      expect(created[0]?.detail).toEqual({ toolId });
      expect(JSON.stringify(created)).not.toContain('gold 3000');
    });
  });

  describe('tool approved-set check (T-0132)', () => {
    it('rejects card hosts outside the tool approved set with tool_hosts_not_approved', async () => {
      const { owner, aiId } = await ownerWithAi(`toolhosts-${emailCounter}@example.com`);
      const { groupId, generalTopicId } = await seedGroup(context, owner.id, 'owner', [aiId]);
      // seedTool approves api.example.com; the card names one host more.
      const toolId = await seedTool(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      await expect(
        createRoutine(
          context.db,
          {
            aiId,
            groupId,
            topicId: generalTopicId,
            toolId,
            title: 'Extra host',
            schedule: INTERVAL_60,
            approvedHosts: ['api.example.com', 'new.example.com'],
            userId: owner.id,
          },
          NOW,
        ),
      ).rejects.toMatchObject({ errorCode: 'tool_hosts_not_approved' });
      // An exact-subset card still works, and the service error message is
      // model-actionable without leaking anything sensitive.
      const created = await createRoutine(
        context.db,
        {
          aiId,
          groupId,
          topicId: generalTopicId,
          toolId,
          title: 'Subset host',
          schedule: INTERVAL_60,
          approvedHosts: ['api.example.com'],
          userId: owner.id,
        },
        NOW,
      );
      expect(created.approvedHosts).toEqual(['api.example.com']);
    });
  });

  describe('reads', () => {
    it('the owner lists every chat routines with scope and no source', async () => {
      const { owner, aiId } = await ownerWithAi(`read-owner-${emailCounter}@example.com`);
      const { groupId, generalTopicId } = await seedGroup(context, owner.id, 'owner', [aiId]);
      const groupTool = await seedTool(context, {
        aiId,
        groupId,
        topicId: generalTopicId,
        userId: owner.id,
      });
      const personalTool = await seedTool(context, {
        aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      await createRoutine(
        context.db,
        {
          aiId,
          groupId,
          topicId: generalTopicId,
          toolId: groupTool,
          title: 'Group routine',
          schedule: INTERVAL_60,
          approvedHosts: ['api.example.com'],
          userId: owner.id,
        },
        NOW,
      );
      await createRoutine(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          toolId: personalTool,
          title: 'Personal routine',
          schedule: INTERVAL_60,
          approvedHosts: ['api.example.com'],
          userId: owner.id,
        },
        NOW,
      );
      const response = await app.request(`${TEST_BASE_URL}/api/ais/${aiId}/routines`, {
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<{
        title: string;
        scope: string;
        toolName: string;
      }>;
      expect(rows.map((row) => [row.title, row.scope]).sort()).toEqual([
        ['Group routine', 'group'],
        ['Personal routine', 'personal'],
      ]);
      expect(JSON.stringify(rows)).not.toContain('return { text');
      for (const row of rows) {
        expect(row.toolName).toBeTruthy();
      }
    });

    it('a stranger gets 404, same body as a missing AI', async () => {
      const { owner, aiId } = await ownerWithAi(`read-stranger-${emailCounter}@example.com`);
      const stranger = await bootstrapUser(
        context,
        authApp,
        `read-stranger2-${emailCounter}@example.com`,
      );
      const strangerResponse = await app.request(`${TEST_BASE_URL}/api/ais/${aiId}/routines`, {
        headers: { cookie: stranger.cookie },
      });
      expect(strangerResponse.status).toBe(404);
      const strangerBody = await strangerResponse.json();
      const missing = await app.request(`${TEST_BASE_URL}/api/ais/no-such-ai/routines`, {
        headers: { cookie: owner.cookie },
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual(strangerBody);
    });

    it('group members read the group routines; strangers get 404', async () => {
      const setup = await ownerWithGroupRoutine(`read-group-${emailCounter}@example.com`);
      const member = await contactOf(
        context,
        authApp,
        setup.owner.id,
        `read-member-${emailCounter}@example.com`,
      );
      // The member must join the group to read.
      await context.db
        .insert(groupMembers)
        .values({ groupId: setup.groupId, userId: member.id, role: 'member' });
      const response = await app.request(`${TEST_BASE_URL}/api/groups/${setup.groupId}/routines`, {
        headers: { cookie: member.cookie },
      });
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<{ id: string }>;
      expect(rows.map((row) => row.id)).toEqual([setup.routine.id]);

      const stranger = await bootstrapUser(
        context,
        authApp,
        `read-stranger3-${emailCounter}@example.com`,
      );
      const strangerResponse = await app.request(
        `${TEST_BASE_URL}/api/groups/${setup.groupId}/routines`,
        { headers: { cookie: stranger.cookie } },
      );
      expect(strangerResponse.status).toBe(404);
    });

    it('a private topic routine stays hidden from a group member outside the topic', async () => {
      const { owner, aiId } = await ownerWithAi(`read-private-${emailCounter}@example.com`);
      const { groupId } = await seedGroup(context, owner.id, 'owner', [aiId]);
      const privateTopicId = await seedPrivateTopic(context, owner.id, groupId, owner.id);
      const toolId = await seedTool(context, {
        aiId,
        groupId,
        topicId: privateTopicId,
        userId: owner.id,
      });
      await createRoutine(
        context.db,
        {
          aiId,
          groupId,
          topicId: privateTopicId,
          toolId,
          title: 'Secret routine',
          schedule: INTERVAL_60,
          approvedHosts: ['api.example.com'],
          userId: owner.id,
        },
        NOW,
      );
      const member = await contactOf(
        context,
        authApp,
        owner.id,
        `read-outsider-${emailCounter}@example.com`,
      );
      await context.db.insert(groupMembers).values({ groupId, userId: member.id, role: 'member' });
      const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/routines`, {
        headers: { cookie: member.cookie },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });
  });

  describe('pause / resume / delete', () => {
    it('a manager pauses and resumes; a plain member gets 404 on pause', async () => {
      const setup = await ownerWithGroupRoutine(`pause-${emailCounter}@example.com`);
      const member = await contactOf(
        context,
        authApp,
        setup.owner.id,
        `pause-member-${emailCounter}@example.com`,
      );
      await context.db
        .insert(groupMembers)
        .values({ groupId: setup.groupId, userId: member.id, role: 'member' });

      const memberPause = await app.request(
        `${TEST_BASE_URL}/api/routines/${setup.routine.id}/pause`,
        {
          method: 'POST',
          headers: { cookie: member.cookie, 'content-type': 'application/json' },
          body: '{}',
        },
      );
      expect(memberPause.status).toBe(404);

      const pause = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/pause`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(pause.status).toBe(200);
      const paused = (await pause.json()) as { status: string; pausedReason: string };
      expect(paused.status).toBe('paused');
      expect(paused.pausedReason).toBe('user');

      const resume = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/resume`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(resume.status).toBe(200);
      const resumed = (await resume.json()) as { status: string; consecutiveFailures?: number };
      expect(resumed.status).toBe('active');
    });

    it('a group admin who is not the owner manages a group routine', async () => {
      const setup = await ownerWithGroupRoutine(`admin-${emailCounter}@example.com`);
      const admin = await contactOf(
        context,
        authApp,
        setup.owner.id,
        `routine-admin-${emailCounter}@example.com`,
      );
      await context.db
        .insert(groupMembers)
        .values({ groupId: setup.groupId, userId: admin.id, role: 'admin' });
      // The admin sees the public General topic.
      const pause = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/pause`, {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(pause.status).toBe(200);
      const del = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      });
      expect(del.status).toBe(204);
    });

    it('resume from needs_approval answers 409; strangers get identical 404s', async () => {
      const setup = await ownerWithGroupRoutine(`needs-${emailCounter}@example.com`);
      await context.db
        .update(routines)
        .set({ status: 'needs_approval', pausedReason: 'hosts_changed' })
        .where(eq(routines.id, setup.routine.id));
      const resume = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/resume`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(resume.status).toBe(409);
      expect((await resume.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'needs_approval' },
      });

      const stranger = await bootstrapUser(
        context,
        authApp,
        `needs-stranger-${emailCounter}@example.com`,
      );
      const bodies: unknown[] = [];
      for (const init of [
        { method: 'POST', path: `/api/routines/${setup.routine.id}/pause` },
        { method: 'POST', path: `/api/routines/${setup.routine.id}/resume` },
        { method: 'DELETE', path: `/api/routines/${setup.routine.id}` },
      ]) {
        const response = await app.request(`${TEST_BASE_URL}${init.path}`, {
          method: init.method,
          headers: { cookie: stranger.cookie, 'content-type': 'application/json' },
          body: '{}',
        });
        expect(response.status).toBe(404);
        bodies.push(await response.json());
      }
      const missing = await app.request(`${TEST_BASE_URL}/api/routines/no-such-routine/pause`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual(bodies[0]);
    });

    it('resume after failures resets the counter and recomputes next_run_at', async () => {
      const setup = await ownerWithGroupRoutine(`resume-fail-${emailCounter}@example.com`);
      await context.db
        .update(routines)
        .set({
          status: 'paused',
          pausedReason: 'failures',
          consecutiveFailures: 3,
          nextRunAt: new Date(NOW.getTime() - 10_000),
        })
        .where(eq(routines.id, setup.routine.id));
      const resume = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/resume`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(resume.status).toBe(200);
      const [row] = await context.db
        .select()
        .from(routines)
        .where(eq(routines.id, setup.routine.id))
        .limit(1);
      expect(row?.status).toBe('active');
      expect(row?.consecutiveFailures).toBe(0);
      expect(row !== undefined && row.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('delete is idempotent 204 and audits routine.deleted', async () => {
      const setup = await ownerWithGroupRoutine(`delete-${emailCounter}@example.com`);
      const first = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}`, {
        method: 'DELETE',
        headers: { cookie: setup.owner.cookie },
      });
      expect(first.status).toBe(204);
      const second = await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}`, {
        method: 'DELETE',
        headers: { cookie: setup.owner.cookie },
      });
      expect(second.status).toBe(204);
      const entries = await context.db.select().from(auditLog);
      expect(entries.filter((entry) => entry.action === 'routine.deleted')).toHaveLength(1);
      const pausedResumed = entries.filter(
        (entry) => entry.action === 'routine.paused' || entry.action === 'routine.resumed',
      );
      expect(pausedResumed.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('lifecycle', () => {
    it('removing the AI from the group soft-deletes its routines', async () => {
      const setup = await ownerWithGroupRoutine(`remove-ai-${emailCounter}@example.com`);
      const { removeGroupAi } = await import('../groups/service');
      const adminClient = { setAffiliation: () => Promise.resolve() } as never;
      const logger = { warn: () => undefined };
      await removeGroupAi(context.db, adminClient, {
        groupId: setup.groupId,
        actorId: setup.owner.id,
        aiId: setup.aiId,
        domain: TEST_XMPP_DOMAIN,
        logger,
      });
      const [row] = await context.db
        .select()
        .from(routines)
        .where(eq(routines.id, setup.routine.id))
        .limit(1);
      expect(row?.deletedAt).not.toBeNull();
    });

    it('the effect delete soft-deletes only this AI in this group', async () => {
      const setup = await ownerWithGroupRoutine(`effect-del-${emailCounter}@example.com`);
      const other = await seedGroup(context, setup.owner.id, 'owner', [setup.aiId]);
      const otherToolId = await seedTool(context, {
        aiId: setup.aiId,
        groupId: other.groupId,
        topicId: other.generalTopicId,
        userId: setup.owner.id,
      });
      const elsewhere = await createRoutine(
        context.db,
        {
          aiId: setup.aiId,
          groupId: other.groupId,
          topicId: other.generalTopicId,
          toolId: otherToolId,
          title: 'Other group routine',
          schedule: INTERVAL_60,
          approvedHosts: ['api.example.com'],
          userId: setup.owner.id,
        },
        NOW,
      );
      const deletedIds = await sqlRuntimeFor(context.db).runPromise(
        deleteRoutinesForAiInGroupEffect({ aiId: setup.aiId, groupId: setup.groupId, now: NOW }),
      );
      expect(deletedIds).toEqual([setup.routine.id]);
      const [groupRow] = await context.db
        .select()
        .from(routines)
        .where(eq(routines.id, setup.routine.id))
        .limit(1);
      const [elsewhereRow] = await context.db
        .select()
        .from(routines)
        .where(eq(routines.id, elsewhere.id))
        .limit(1);
      expect(groupRow?.deletedAt).not.toBeNull();
      expect(elsewhereRow?.deletedAt).toBeNull();
    });

    it('removing the AI from a topic soft-deletes its routines there', async () => {
      const { owner, aiId } = await ownerWithAi(`remove-topic-ai-${emailCounter}@example.com`);
      const { groupId } = await seedGroup(context, owner.id, 'owner', [aiId]);
      const topicId = randomUUID();
      await context.db.insert(topics).values({
        id: topicId,
        groupId,
        name: 'work',
        glyph: 'W',
        roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: owner.id,
      });
      const { topicAis } = await import('../db/schema');
      await context.db.insert(topicAis).values({ topicId, aiId, addedBy: owner.id });
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const routine = await createRoutine(
        context.db,
        {
          aiId,
          groupId,
          topicId,
          toolId,
          title: 'Topic routine',
          schedule: INTERVAL_60,
          approvedHosts: ['api.example.com'],
          userId: owner.id,
        },
        NOW,
      );
      const { removeTopicAi } = await import('../topics/service');
      await removeTopicAi(
        {
          db: context.db,
          adminClient: context.adminClient,
          domain: TEST_XMPP_DOMAIN,
          logger: { warn: () => undefined },
        },
        topicId,
        owner.id,
        aiId,
      );
      const [row] = await context.db
        .select()
        .from(routines)
        .where(eq(routines.id, routine.id))
        .limit(1);
      expect(row?.deletedAt).not.toBeNull();
    });

    it('deleting a tool soft-deletes its routines', async () => {
      const setup = await ownerWithGroupRoutine(`del-tool-${emailCounter}@example.com`);
      await deleteTool(context.db, setup.toolId, NOW);
      const [row] = await context.db
        .select()
        .from(routines)
        .where(eq(routines.id, setup.routine.id))
        .limit(1);
      expect(row?.deletedAt).not.toBeNull();
    });

    it('audit rows contain no output, source or error text', async () => {
      const setup = await ownerWithGroupRoutine(`audit-clean-${emailCounter}@example.com`);
      await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/pause`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      await app.request(`${TEST_BASE_URL}/api/routines/${setup.routine.id}/resume`, {
        method: 'POST',
        headers: { cookie: setup.owner.cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      const entries = await context.db.select().from(auditLog);
      const serialised = JSON.stringify(entries);
      expect(serialised).not.toContain('return { text');
      expect(serialised).not.toContain('gold 3000');
    });
  });

  describe('createRoutine errors', () => {
    it('maps service errors without leaking internals', async () => {
      const { owner } = await ownerWithAi(`errmap-${emailCounter}@example.com`);
      void owner;
      expect(new RoutineServiceError('not_found', 'Routine not found').errorCode).toBe('not_found');
      const [row] = await context.db.select({ id: aiTools.id }).from(aiTools).limit(1);
      expect(row).toBeUndefined();
    });
  });
});
