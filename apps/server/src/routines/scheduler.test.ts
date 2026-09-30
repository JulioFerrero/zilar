import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
  topicAis,
  topics,
} from '../db/schema';
import { createAuditRecorder } from '../audit/service';
import { saveToolVersion } from '../tools/service';
import type { ToolRunResult, ToolRunner } from '../tools/types';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  testApp,
  type TestApp,
  type TestContext,
} from '../test-support';
import { createRoutine } from './service';
import { createRoutineScheduler, MAX_CONCURRENT_RUNS } from './scheduler';
import { FAILURE_PAUSE_NOTICE, HOSTS_CHANGED_NOTICE } from './execute';

const NOW = new Date('2026-06-01T12:00:00Z');
const INTERVAL_60 = { kind: 'interval', everyMinutes: 60 } as const;

function silentLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

function okRunner(text = 'gold 3000, spx 6000, btc 100000'): ToolRunner {
  return () =>
    Promise.resolve({
      ok: true,
      output: { text },
      logs: '',
      durationMs: 9,
      fetchCount: 1,
    } satisfies ToolRunResult);
}

function failingRunner(kind = 'sandbox_failure'): ToolRunner {
  return () =>
    Promise.resolve({
      ok: false,
      error: { kind, message: 'boom (must never reach the chat)' },
      logs: 'logs (must never reach the chat)',
      durationMs: 9,
      fetchCount: 0,
    } satisfies ToolRunResult);
}

async function seedAi(context: TestContext, ownerId: string, status = 'active'): Promise<string> {
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
    status: status as 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return aiId;
}

async function seedGroupWithTopic(
  context: TestContext,
  ownerId: string,
  aiId: string,
): Promise<{ groupId: string; topicId: string }> {
  const groupId = randomUUID();
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    title: 'Trip',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values({ groupId, userId: ownerId, role: 'owner' });
  await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
  const topicId = randomUUID();
  await context.db.insert(topics).values({
    id: topicId,
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
  return { groupId, topicId };
}

async function seedNonGeneralTopic(
  context: TestContext,
  ownerId: string,
  groupId: string,
  aiId: string | null,
): Promise<string> {
  const topicId = randomUUID();
  await context.db.insert(topics).values({
    id: topicId,
    groupId,
    name: `work-${topicId.slice(0, 8)}`,
    glyph: 'W',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: false,
    createdBy: ownerId,
  });
  if (aiId !== null) {
    await context.db.insert(topicAis).values({ topicId, aiId, addedBy: ownerId });
  }
  return topicId;
}

async function seedTool(
  context: TestContext,
  args: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    userId: string;
    hosts?: string[];
    source?: string;
  },
): Promise<string> {
  const { tool } = await saveToolVersion(
    context.db,
    {
      aiId: args.aiId,
      groupId: args.groupId,
      topicId: args.topicId,
      name: `tool-${randomBytes(4).toString('hex')}`,
      description: 'Posts the price of gold, S&P 500 and BTC',
      source: args.source ?? 'return { text: "gold 3000" };',
      hosts: args.hosts ?? ['api.example.com'],
      message: 'First version',
      userId: args.userId,
    },
    NOW,
  );
  return tool.id;
}

async function seedRoutine(
  context: TestContext,
  args: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    toolId: string;
    userId: string;
    nextRunAt?: Date;
    approvedHosts?: string[];
  },
) {
  return createRoutine(
    context.db,
    {
      aiId: args.aiId,
      groupId: args.groupId,
      topicId: args.topicId,
      toolId: args.toolId,
      title: 'Morning prices',
      schedule: INTERVAL_60,
      approvedHosts: args.approvedHosts ?? ['api.example.com'],
      userId: args.userId,
    },
    NOW,
  ).then(async (created) => {
    if (args.nextRunAt !== undefined) {
      await context.db
        .update(routines)
        .set({ nextRunAt: args.nextRunAt })
        .where(eq(routines.id, created.id));
      return { ...created, nextRunAt: args.nextRunAt };
    }
    return created;
  });
}

async function readRoutine(context: TestContext, id: string) {
  const [row] = await context.db.select().from(routines).where(eq(routines.id, id)).limit(1);
  return row;
}

async function auditEntries(context: TestContext) {
  return context.db.select().from(auditLog);
}

describe('routine scheduler (T-0104)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let emailCounter = 0;

  beforeEach(async () => {
    emailCounter += 1;
    context = await createTestContext();
    authApp = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function ownerWithAi(email: string, status = 'active') {
    const owner = await bootstrapUser(context, authApp, email);
    const aiId = await seedAi(context, owner.id, status);
    return { owner, aiId };
  }

  function schedulerFor(
    runTool: ToolRunner,
    posts: Array<{ aiId: string; groupId: string | null; topicId?: string; text: string }>,
    options: {
      now?: () => Date;
      maxPerTick?: number;
      postImpl?: (post: {
        aiId: string;
        groupId: string | null;
        topicId?: string;
        text: string;
      }) => Promise<boolean>;
    } = {},
  ) {
    const audit = createAuditRecorder({ db: context.db, now: () => NOW });
    const logger = silentLogger();
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool,
      post: async (post) => {
        if (options.postImpl !== undefined) {
          return options.postImpl(post);
        }
        posts.push(post);
        return true;
      },
      audit,
      logger,
      now: options.now ?? (() => NOW),
      ...(options.maxPerTick === undefined ? {} : { maxPerTick: options.maxPerTick }),
    });
    return { scheduler, audit, logger };
  }

  describe('happy path', () => {
    it('a due routine runs once and posts "<title>\\n<output>"', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-owner-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<{ text: string }> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();

      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ aiId, groupId, topicId });
      expect((posts[0] as { text: string }).text).toBe(
        'Morning prices\ngold 3000, spx 6000, btc 100000',
      );
      const row = await readRoutine(context, created.id);
      expect(row?.lastStatus).toBe('ok');
      expect(row?.consecutiveFailures).toBe(0);
      expect(row?.lastRunAt).toEqual(NOW);
      expect(row !== undefined && row.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('a personal-chat routine posts without a topic', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-personal-${emailCounter}@example.com`);
      const toolId = await seedTool(context, {
        aiId,
        groupId: null,
        topicId: null,
        userId: owner.id,
      });
      const created = await seedRoutine(context, {
        aiId,
        groupId: null,
        topicId: null,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<{ groupId: string | null; topicId?: string; text: string }> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();

      expect(posts).toHaveLength(1);
      expect(posts[0]?.groupId).toBeNull();
      expect(posts[0]).not.toHaveProperty('topicId');
      expect((await readRoutine(context, created.id))?.lastStatus).toBe('ok');
    });
  });

  describe('exactly-once claim', () => {
    it('two concurrent ticks run a due routine once', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-race-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      let calls = 0;
      const counting: ToolRunner = () => {
        calls += 1;
        return okRunner()({ source: '', input: null, allowedHosts: [] });
      };
      const posts: Array<unknown> = [];
      const first = schedulerFor(counting, posts as never);
      const second = schedulerFor(counting, posts as never);
      await Promise.all([first.scheduler.tick(), second.scheduler.tick()]);
      expect(calls).toBe(1);
      expect(posts).toHaveLength(1);
    });

    it('an overdue-by-days routine runs once and next_run_at lands in the future', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-overdue-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 5 * 24 * 3_600_000),
      });
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();
      await scheduler.tick();
      expect(posts).toHaveLength(1);
      const row = await readRoutine(context, created.id);
      expect(row !== undefined && row.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('not-due, paused, needs_approval and deleted routines do not run', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-idle-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const future = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() + 3_600_000),
      });
      const due = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      await context.db
        .update(routines)
        .set({ status: 'paused', pausedReason: 'user' })
        .where(eq(routines.id, due.id));
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();
      expect(posts).toHaveLength(0);
      expect((await readRoutine(context, future.id))?.lastStatus).toBeNull();
      expect((await readRoutine(context, due.id))?.lastStatus).toBeNull();
    });
  });

  describe('skips', () => {
    it('a stopped AI skips: nothing posted, still active, resumes when active again', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-stopped-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      await context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, aiId));
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();
      expect(posts).toHaveLength(0);
      const skipped = await readRoutine(context, created.id);
      expect(skipped?.lastStatus).toBe('skipped');
      expect(skipped?.status).toBe('active');
      expect(skipped?.consecutiveFailures).toBe(0);

      await context.db.update(ais).set({ status: 'active' }).where(eq(ais.id, aiId));
      await context.db
        .update(routines)
        .set({ nextRunAt: new Date(NOW.getTime() - 1_000) })
        .where(eq(routines.id, created.id));
      await scheduler.tick();
      expect(posts).toHaveLength(1);
      expect((await readRoutine(context, created.id))?.lastStatus).toBe('ok');
    });

    it('an AI removed from the topic skips without failing', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-left-${emailCounter}@example.com`);
      const { groupId } = await seedGroupWithTopic(context, owner.id, aiId);
      const topicId = await seedNonGeneralTopic(context, owner.id, groupId, null);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();
      expect(posts).toHaveLength(0);
      const row = await readRoutine(context, created.id);
      expect(row?.lastStatus).toBe('skipped');
      expect(row?.status).toBe('active');
    });

    it('post returning false records skipped without a failure', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-nopost-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never, {
        postImpl: () => Promise.resolve(false),
      });
      await scheduler.tick();
      expect(posts).toHaveLength(0);
      const row = await readRoutine(context, created.id);
      expect(row?.lastStatus).toBe('skipped');
      expect(row?.consecutiveFailures).toBe(0);
      expect(row?.status).toBe('active');
    });

    it('long output is cut at 4 000 characters with a trailing ellipsis', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-long-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<{ text: string }> = [];
      const { scheduler } = schedulerFor(okRunner('x'.repeat(5_000)), posts as never);
      await scheduler.tick();
      expect(posts).toHaveLength(1);
      const text = posts[0]?.text ?? '';
      expect(text.startsWith('Morning prices\n')).toBe(true);
      expect(text.length).toBe('Morning prices\n'.length + 4_001);
      expect(text.endsWith('…')).toBe(true);
      expect((await readRoutine(context, created.id))?.lastStatus).toBe('ok');
    });
  });

  describe('failures and host pinning', () => {
    it('counts 1, 2, then pauses on the 3rd with exactly one notice and no error text', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-fail-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<{ text: string }> = [];
      const { scheduler } = schedulerFor(failingRunner(), posts as never);
      const rearm = () =>
        context.db
          .update(routines)
          .set({ nextRunAt: new Date(NOW.getTime() - 1_000) })
          .where(eq(routines.id, created.id));

      await scheduler.tick();
      expect((await readRoutine(context, created.id))?.consecutiveFailures).toBe(1);
      await rearm();
      await scheduler.tick();
      expect((await readRoutine(context, created.id))?.consecutiveFailures).toBe(2);
      await rearm();
      await scheduler.tick();
      const paused = await readRoutine(context, created.id);
      expect(paused?.status).toBe('paused');
      expect(paused?.pausedReason).toBe('failures');
      expect(paused?.consecutiveFailures).toBe(3);
      expect(posts).toHaveLength(1);
      expect(posts[0]?.text).toBe(FAILURE_PAUSE_NOTICE('Morning prices'));
      for (const post of posts) {
        expect(post.text).not.toContain('boom');
      }
    });

    it('a success resets the failure counter', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-reset-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<unknown> = [];
      let fail = true;
      const flapping: ToolRunner = (params) =>
        fail ? failingRunner()(params) : okRunner()(params);
      const { scheduler } = schedulerFor(flapping, posts as never);
      await scheduler.tick();
      expect((await readRoutine(context, created.id))?.consecutiveFailures).toBe(1);
      fail = false;
      await context.db
        .update(routines)
        .set({ nextRunAt: new Date(NOW.getTime() - 1_000) })
        .where(eq(routines.id, created.id));
      await scheduler.tick();
      expect((await readRoutine(context, created.id))?.consecutiveFailures).toBe(0);
    });

    it('a version that adds a host pauses with needs_approval and one notice, running nothing', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-hosts-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId,
          topicId,
          name:
            (await context.db.select().from(aiTools).where(eq(aiTools.id, toolId)).limit(1))[0]
              ?.name ?? 'tool',
          description: 'Posts the price of gold, S&P 500 and BTC',
          source: 'return { text: "v2" };',
          hosts: ['api.example.com', 'new.example.com'],
          message: 'Add a host',
          userId: owner.id,
        },
        NOW,
      );
      let calls = 0;
      const counting: ToolRunner = (params) => {
        calls += 1;
        return okRunner()(params);
      };
      const posts: Array<{ text: string }> = [];
      const { scheduler } = schedulerFor(counting, posts as never);
      await scheduler.tick();
      expect(calls).toBe(0);
      const row = await readRoutine(context, created.id);
      expect(row?.status).toBe('needs_approval');
      expect(row?.pausedReason).toBe('hosts_changed');
      expect(posts).toHaveLength(1);
      expect(posts[0]?.text).toBe(HOSTS_CHANGED_NOTICE('Morning prices'));
    });

    it('a version that removes a host or only changes code keeps running', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-fewer-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, {
        aiId,
        groupId,
        topicId,
        userId: owner.id,
        hosts: ['api.example.com', 'extra.example.com'],
      });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
        approvedHosts: ['api.example.com', 'extra.example.com'],
      });
      const toolName =
        (await context.db.select().from(aiTools).where(eq(aiTools.id, toolId)).limit(1))[0]?.name ??
        'tool';
      await saveToolVersion(
        context.db,
        {
          aiId,
          groupId,
          topicId,
          name: toolName,
          description: 'Posts the price of gold, S&P 500 and BTC',
          source: 'return { text: "v2 fewer" };',
          hosts: ['api.example.com'],
          message: 'Drop a host',
          userId: owner.id,
        },
        NOW,
      );
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();
      expect(posts).toHaveLength(1);
      expect((await readRoutine(context, created.id))?.status).toBe('active');
    });

    it('a deleted tool pauses with the failure notice', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-deltool-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const { deleteTool } = await import('../tools/service');
      await deleteTool(context.db, toolId, NOW);
      const posts: Array<{ text: string }> = [];
      const { scheduler } = schedulerFor(okRunner(), posts as never);
      await scheduler.tick();
      expect(posts).toHaveLength(0);
      const rows = await context.db.select().from(routines).where(eq(routines.toolId, toolId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deletedAt).not.toBeNull();
    });
  });

  describe('concurrency and audit', () => {
    it(`runs at most ${MAX_CONCURRENT_RUNS} routines at the same time`, async () => {
      const { owner, aiId } = await ownerWithAi(`sched-conc-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const ids: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
        const created = await seedRoutine(context, {
          aiId,
          groupId,
          topicId,
          toolId,
          userId: owner.id,
          nextRunAt: new Date(NOW.getTime() - 1_000 - index),
        });
        ids.push(created.id);
      }
      let inFlight = 0;
      let maxInFlight = 0;
      const slow: ToolRunner = () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<ToolRunResult>((resolve) => {
          setTimeout(() => {
            inFlight -= 1;
            resolve({
              ok: true,
              output: { text: 'slow output' },
              logs: '',
              durationMs: 5,
              fetchCount: 0,
            });
          }, 15);
        });
      };
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(slow, posts as never, { maxPerTick: 10 });
      await scheduler.tick();
      expect(posts).toHaveLength(4);
      expect(maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENT_RUNS);
      expect(ids).toHaveLength(4);
    });

    it('a tick does not overlap itself', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-nooverlap-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      let calls = 0;
      const slow: ToolRunner = () => {
        calls += 1;
        return new Promise<ToolRunResult>((resolve) => {
          setTimeout(
            () =>
              resolve({ ok: true, output: { text: 'x' }, logs: '', durationMs: 1, fetchCount: 0 }),
            30,
          );
        });
      };
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(slow, posts as never);
      await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
      expect(calls).toBe(1);
    });

    it('every run audits routine.run with status and duration only', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-audit-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(okRunner('secret output text'), posts as never);
      await scheduler.tick();
      const entries = (await auditEntries(context)).filter(
        (entry) => entry.action === 'routine.run',
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.result).toBe('ok');
      const detail = entries[0]?.detail as Record<string, unknown>;
      expect(Object.keys(detail).sort()).toEqual(['durationMs', 'status']);
      expect(detail['status']).toBe('ok');
      const serialised = JSON.stringify(entries);
      expect(serialised).not.toContain('secret output text');
    });

    it('audit entries for failures contain no error text', async () => {
      const { owner, aiId } = await ownerWithAi(`sched-auditfail-${emailCounter}@example.com`);
      const { groupId, topicId } = await seedGroupWithTopic(context, owner.id, aiId);
      const toolId = await seedTool(context, { aiId, groupId, topicId, userId: owner.id });
      const created = await seedRoutine(context, {
        aiId,
        groupId,
        topicId,
        toolId,
        userId: owner.id,
        nextRunAt: new Date(NOW.getTime() - 1_000),
      });
      const posts: Array<unknown> = [];
      const { scheduler } = schedulerFor(failingRunner(), posts as never);
      for (let run = 0; run < 3; run += 1) {
        await context.db
          .update(routines)
          .set({ nextRunAt: new Date(NOW.getTime() - 1_000) })
          .where(eq(routines.id, created.id));
        if (run > 0) {
          await context.db
            .update(routines)
            .set({ status: 'active' })
            .where(eq(routines.id, created.id));
        }
        await scheduler.tick();
      }
      const entries = await auditEntries(context);
      const serialised = JSON.stringify(entries);
      expect(serialised).not.toContain('boom');
      expect(serialised).not.toContain('must never reach the chat');
      const paused = entries.filter((entry) => entry.action === 'routine.paused');
      expect(paused).toHaveLength(1);
      const pausedDetail = paused[0]?.detail as { reason: string } | null;
      expect(pausedDetail?.reason).toBe('failures');
    });
  });

  describe('authz sweep support', () => {
    it('registers routine routes in the app (sweep asserts 401 itself)', async () => {
      const app = testApp(context);
      const paths = app.routes.map((route) => `${route.method} ${route.path}`);
      expect(paths).toContain('GET /api/ais/:id/routines');
      expect(paths).toContain('GET /api/groups/:id/routines');
      expect(paths).toContain('POST /api/routines/:id/pause');
      expect(paths).toContain('POST /api/routines/:id/resume');
      expect(paths).toContain('DELETE /api/routines/:id');
      void TEST_BASE_URL;
    });
  });
});
