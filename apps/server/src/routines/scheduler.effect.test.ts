import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiLimits, ais, providerConnections, routines, user } from '../db/schema';
import { createAuditRecorder } from '../audit/service';
import { approveToolHosts, saveToolVersion } from '../tools/service';
import type { ToolRunResult, ToolRunner } from '../tools/types';
import { createTestContext, type TestContext } from '../test-support';
import { createRoutine } from './service';
import { createRoutineScheduler } from './scheduler';

const NOW = new Date('2026-06-01T12:00:00Z');
const INTERVAL_60 = { kind: 'interval', everyMinutes: 60 } as const;
const HOST = 'api.example.com';

function silentLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

function okRunner(): ToolRunner {
  return () =>
    Promise.resolve({
      ok: true,
      output: { text: 'gold 3000' },
      logs: '',
      durationMs: 9,
      fetchCount: 1,
    } satisfies ToolRunResult);
}

interface Deferred {
  promise: Promise<void>;
  release(): void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function seedUser(context: TestContext): Promise<string> {
  const id = randomUUID();
  await context.db.insert(user).values({ id, name: 'Owner', email: `${id}@example.com` });
  return id;
}

async function seedActiveAi(context: TestContext, ownerId: string): Promise<string> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart: `ai-${aiId}`,
    jid: `ai-${aiId}@zilar.localhost`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return aiId;
}

// The scheduler's own `tick()` is covered unchanged by `scheduler.test.ts`.
// These tests cover the background loop (`start`/`stop`): a first run after
// one interval, a repeat, and an interrupt that clears the timer.
describe('routine scheduler effect loop', () => {
  let context: TestContext;
  let ownerId: string;
  let aiId: string;
  let toolId: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    context = await createTestContext();
    ownerId = await seedUser(context);
    aiId = await seedActiveAi(context, ownerId);
    const { tool } = await saveToolVersion(
      context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        name: 'prices',
        description: 'Posts the gold price',
        source: 'return { text: "gold 3000" };',
        hosts: [HOST],
        message: 'First version',
        userId: ownerId,
      },
      NOW,
    );
    await approveToolHosts(context.db, { toolId: tool.id, hosts: [HOST], userId: ownerId }, NOW);
    toolId = tool.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await context.close();
  });

  it('runs after one interval, repeats, and stops when stop() interrupts the fiber', async () => {
    const created = await createRoutine(
      context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        toolId,
        title: 'Morning prices',
        schedule: INTERVAL_60,
        approvedHosts: [HOST],
        userId: ownerId,
      },
      NOW,
    );
    const due = new Date(NOW.getTime() - 1_000);
    const rearm = () =>
      context.db.update(routines).set({ nextRunAt: due }).where(eq(routines.id, created.id));
    await rearm();

    const posts: Array<{ text: string }> = [];
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool: okRunner(),
      post: async (post) => {
        posts.push(post);
        return true;
      },
      audit: createAuditRecorder({ db: context.db, now: () => NOW }),
      logger: silentLogger(),
      tickMs: 1_000,
      now: () => NOW,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(posts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(posts).toHaveLength(1);

    await rearm();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posts).toHaveLength(2);

    scheduler.stop();
    await rearm();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(posts).toHaveLength(2);
  });

  it('lets an in-flight tick finish after stop() without logging a failure, then stops firing', async () => {
    const created = await createRoutine(
      context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        toolId,
        title: 'Morning prices',
        schedule: INTERVAL_60,
        approvedHosts: [HOST],
        userId: ownerId,
      },
      NOW,
    );
    const due = new Date(NOW.getTime() - 1_000);
    const rearm = () =>
      context.db.update(routines).set({ nextRunAt: due }).where(eq(routines.id, created.id));
    await rearm();

    const parking = deferred();
    let runs = 0;
    const parkingRunner: ToolRunner = async () => {
      runs += 1;
      await parking.promise;
      return {
        ok: true,
        output: { text: 'gold 3000' },
        logs: '',
        durationMs: 9,
        fetchCount: 1,
      } satisfies ToolRunResult;
    };
    const posts: Array<{ text: string }> = [];
    const logger = silentLogger();
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool: parkingRunner,
      post: async (post) => {
        posts.push(post);
        return true;
      },
      audit: createAuditRecorder({ db: context.db, now: () => NOW }),
      logger,
      tickMs: 1_000,
      now: () => NOW,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(1);
    expect(posts).toHaveLength(0);

    // Stop while the tick is parked in `runTool`: the in-flight tick must
    // still finish (today's behaviour), no spurious tick-failure is logged,
    // and the loop must not schedule another tick.
    scheduler.stop();
    parking.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();

    await rearm();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toBe(1);
    expect(posts).toHaveLength(1);
  });
});
