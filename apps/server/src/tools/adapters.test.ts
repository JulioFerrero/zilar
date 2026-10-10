// T-0105: tests for the tool/routine action adapters. A fake runner and a
// fake `post` stand in for the sandbox and the chat; PGlite stands in for
// Postgres. No network, no real sandbox.
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import { buildAlwaysEligible, buildRegistry, decodeActionArgs } from '../actions/registry';
import { createAuditRecorder } from '../audit/service';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  type TestApp,
  type TestContext,
} from '../test-support';
import { seedAi, seedGroup } from '../test-support/seed';
import {
  buildToolAdapters,
  describeSchedule,
  MAX_SAVE_MODEL_TEXT_CHARS,
  MAX_TOOL_INPUT_BYTES,
  type ApproveHostsBoundArgs,
  type BuildToolAdaptersDeps,
} from './adapters';
import type { ToolRunResult, ToolRunner } from './types';
const NOW = new Date('2026-09-29T09:00:00Z');
const SOURCE = 'return { text: "hello" };';
const HOSTS = ['api.example.com'];

interface Post {
  aiId: string;
  groupId: string | null;
  topicId?: string;
  text: string;
}

interface RunnerCall {
  source: string;
  input: unknown;
  allowedHosts: readonly string[];
}

function okRunner(output = 'hello'): ToolRunner & { calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner = (async (params: RunnerCall): Promise<ToolRunResult> => {
    calls.push(params);
    return { ok: true, output: { text: output }, logs: '', durationMs: 5, fetchCount: 0 };
  }) as ToolRunner & { calls: RunnerCall[] };
  runner.calls = calls;
  return runner;
}

function failingRunner(kind = 'runtime'): ToolRunner & { calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner = (async (params: RunnerCall): Promise<ToolRunResult> => {
    calls.push(params);
    return {
      ok: false,
      error: { kind, message: 'boom' },
      logs: 'line one\nline two',
      durationMs: 5,
      fetchCount: 0,
    };
  }) as ToolRunner & { calls: RunnerCall[] };
  runner.calls = calls;
  return runner;
}

interface AuditRow {
  action: string;
  subjectId: string | null;
  detail: unknown;
}

async function seedTopic(
  context: TestContext,
  groupId: string,
  creatorId: string,
  name: string,
): Promise<string> {
  const topicId = randomUUID();
  const topicRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${topicId}, ${groupId}, ${name}, ${'T'}, ${topicRoom}, ${'public'}, ${'chat'}, ${'open'}, ${false}, ${creatorId})`;
    }),
  );
  return topicId;
}

function baseToolInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'morning-prices',
    description: 'Posts the morning prices',
    source: SOURCE,
    hosts: HOSTS,
    message: 'First version',
    ...overrides,
  };
}

describe('tool adapters (T-0105)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let ownerId: string;
  let aiId: string;
  let emailCounter = 0;

  beforeEach(async () => {
    emailCounter += 1;
    context = await createTestContext();
    authApp = testApp(context);
    const owner = await bootstrapUser(
      context,
      authApp,
      `adapter-owner-${emailCounter}@example.com`,
    );
    ownerId = owner.id;
    aiId = (await seedAi(context, ownerId)).aiId;
  });

  afterEach(async () => {
    await context.close();
  });

  function adaptersFor(
    input: {
      runner?: ToolRunner;
      routinesEnabled?: boolean;
      posts?: Post[];
      audit?: boolean;
    } = {},
  ): { adapters: ActionAdapter<unknown>[]; runner: ToolRunner; posts: Post[] } {
    const runner = (input.runner ?? okRunner()) as ToolRunner;
    const posts = input.posts ?? [];
    const audit = input.audit === false ? undefined : createAuditRecorder({ db: context.db });
    const deps: BuildToolAdaptersDeps = {
      db: context.db,
      runner,
      now: () => NOW,
      post: async (post) => {
        posts.push(post);
        return true;
      },
      ...(input.routinesEnabled === undefined ? {} : { routinesEnabled: input.routinesEnabled }),
      ...(audit === undefined ? {} : { audit }),
    };
    return { adapters: buildToolAdapters(deps), runner, posts };
  }

  function byName(adapters: ActionAdapter<unknown>[], name: string): ActionAdapter<unknown> {
    const found = adapters.find((adapter) => adapter.name === name);
    if (!found) {
      throw new Error(`adapter ${name} is not registered`);
    }
    return found;
  }

  function ctxFor(overrides: Partial<ActionContext> = {}): ActionContext {
    return {
      aiId,
      groupId: null,
      topicId: null,
      requestId: randomUUID(),
      ...overrides,
    };
  }

  async function run(
    adapters: ActionAdapter<unknown>[],
    name: string,
    ctx: ActionContext,
    args: unknown,
  ): Promise<{ summary: string; modelText?: string }> {
    const adapter = byName(adapters, name);
    const decoded = decodeActionArgs(adapter.argsSchema, args);
    if (!decoded.ok) {
      return { summary: 'invalid_args' };
    }
    return adapter.execute(ctx, decoded.value);
  }

  it('registers eight adapters with the right tiers and short descriptions', () => {
    const { adapters } = adaptersFor();
    expect(adapters.map((adapter) => adapter.name).sort()).toEqual([
      'routine.delete',
      'routine.pause',
      'routine.schedule',
      'tool.approve_hosts',
      'tool.list',
      'tool.read',
      'tool.revert',
      'tool.revoke_hosts',
      'tool.run',
      'tool.save',
    ]);
    const tiers = new Map(adapters.map((adapter) => [adapter.name, adapter.tier]));
    expect(tiers.get('tool.list')).toBe(0);
    expect(tiers.get('tool.read')).toBe(0);
    expect(tiers.get('tool.save')).toBe(1);
    expect(tiers.get('tool.run')).toBe(1);
    expect(tiers.get('tool.revert')).toBe(1);
    expect(tiers.get('tool.approve_hosts')).toBe(2);
    expect(tiers.get('tool.revoke_hosts')).toBe(1);
    expect(tiers.get('routine.schedule')).toBe(2);
    expect(tiers.get('routine.pause')).toBe(1);
    expect(tiers.get('routine.delete')).toBe(1);
    for (const adapter of adapters) {
      expect(adapter.description.length).toBeLessThanOrEqual(200);
    }
    expect(buildRegistry(adapters)).toBeDefined();
  });

  it('omits routine.schedule when routines are disabled', () => {
    const { adapters } = adaptersFor({ routinesEnabled: false });
    expect(adapters.map((adapter) => adapter.name)).not.toContain('routine.schedule');
    expect(adapters).toHaveLength(9);
  });

  it('routine.schedule never opts into always-allow', () => {
    const { adapters } = adaptersFor();
    const alwaysEligible = buildAlwaysEligible(buildRegistry(adapters));
    expect(alwaysEligible('routine.schedule')).toBe(false);
    expect(byName(adapters, 'routine.schedule').allowAlways).not.toBe(true);
  });

  it('tool.approve_hosts never opts into always-allow', () => {
    const { adapters } = adaptersFor();
    const alwaysEligible = buildAlwaysEligible(buildRegistry(adapters));
    expect(alwaysEligible('tool.approve_hosts')).toBe(false);
    expect(byName(adapters, 'tool.approve_hosts').allowAlways).not.toBe(true);
  });

  it('tool.save then tool.run: the runner sees the saved source and the approved hosts only', async () => {
    const runner = okRunner('BTC 100');
    const { adapters, posts } = adaptersFor({ runner });
    const saved = await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    expect(saved.summary).toContain('saved morning-prices v1: test run ok');
    expect(saved.summary).toContain('tool.approve_hosts');
    expect(saved.modelText).toContain('BTC 100');
    // Nothing approved yet: the test run reached the sandbox with no
    // network, so the runner saw an empty intersection.
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual({ source: SOURCE, input: null, allowedHosts: [] });

    const ran = await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
    expect(ran.summary).toBe('ok');
    expect(ran.modelText).toBe('BTC 100');
    expect(posts).toEqual([{ aiId, groupId: null, text: 'morning-prices\nBTC 100' }]);
  });

  it('tool.save with a failing test run returns the failure and still keeps the version', async () => {
    const runner = failingRunner();
    const { adapters } = adaptersFor({ runner });
    const saved = await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    expect(saved.summary).toContain('saved morning-prices v1: test run failed: runtime');
    expect(saved.modelText).toContain('boom\nline one\nline two');
    expect(runner.calls).toHaveLength(1);

    const read = await run(adapters, 'tool.read', ctxFor(), { name: 'morning-prices' });
    expect(read.summary).toBe('morning-prices v1');
    expect(read.modelText).toContain(SOURCE);
  });

  it('tool.save caps modelText at 2 KiB', () => {
    expect(MAX_SAVE_MODEL_TEXT_CHARS).toBe(2 * 1024);
  });

  it('an unchanged tool.save says so and runs no test', async () => {
    const runner = okRunner();
    const { adapters } = adaptersFor({ runner });
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    const again = await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    expect(again.summary).toBe('saved morning-prices v1 (unchanged)');
    expect(runner.calls).toHaveLength(1);
  });

  it('tool.run rate-limits after 6 runs per AI per chat per hour', async () => {
    const runner = okRunner();
    const { adapters } = adaptersFor({ runner });
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    for (let index = 0; index < 6; index += 1) {
      const result = await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
      expect(result.summary).toBe('ok');
    }
    const limited = await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
    expect(limited.summary).toBe('run limit reached, try later');
    // One test run at save time plus six real runs: none reached the network
    // (nothing approved), but every run still executed.
    expect(runner.calls).toHaveLength(7);
    for (const call of runner.calls) {
      expect(call.allowedHosts).toEqual([]);
    }
  });

  it('tool.run caps its input at 16 KiB serialised', () => {
    expect(MAX_TOOL_INPUT_BYTES).toBe(16 * 1024);
    const { adapters } = adaptersFor();
    const adapter = byName(adapters, 'tool.run');
    const big = 'x'.repeat(MAX_TOOL_INPUT_BYTES);
    const decoded = decodeActionArgs(adapter.argsSchema, {
      name: 'morning-prices',
      input: big,
    });
    expect(decoded.ok).toBe(false);
  });

  it('a tool of another chat or AI is invisible', async () => {
    const { adapters } = adaptersFor();
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    const otherTopicId = await seedTopic(context, groupId, ownerId, 'Other');
    const groupCtx = ctxFor({ groupId, topicId: generalTopicId });
    await run(adapters, 'tool.save', groupCtx, baseToolInput());

    expect((await run(adapters, 'tool.read', ctxFor(), { name: 'morning-prices' })).summary).toBe(
      'no such tool',
    );
    expect((await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' })).summary).toBe(
      'no such tool',
    );
    expect(
      (await run(adapters, 'tool.revert', ctxFor(), { name: 'morning-prices', toVersion: 1 }))
        .summary,
    ).toBe('no such tool');
    expect(
      (
        await run(adapters, 'tool.read', ctxFor({ groupId, topicId: otherTopicId }), {
          name: 'morning-prices',
        })
      ).summary,
    ).toBe('no such tool');

    const otherOwner = await bootstrapUser(
      context,
      authApp,
      `other-owner-${emailCounter}@example.com`,
    );
    const { aiId: otherAiId } = await seedAi(context, otherOwner.id);
    expect(
      (
        await run(adapters, 'tool.read', ctxFor({ aiId: otherAiId }), {
          name: 'morning-prices',
        })
      ).summary,
    ).toBe('no such tool');
  });

  it('tool.read lists versions and answers unknown names and versions plainly', async () => {
    const { adapters } = adaptersFor();
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    await run(adapters, 'tool.save', ctxFor(), baseToolInput({ source: 'return "v2";' }));

    const current = await run(adapters, 'tool.read', ctxFor(), { name: 'morning-prices' });
    expect(current.summary).toBe('morning-prices v2');
    expect(current.modelText).toContain('return "v2";');

    const old = await run(adapters, 'tool.read', ctxFor(), {
      name: 'morning-prices',
      version: 1,
    });
    expect(old.summary).toBe('morning-prices v1');
    expect(old.modelText).toContain(SOURCE);

    expect((await run(adapters, 'tool.read', ctxFor(), { name: 'missing' })).summary).toBe(
      'no such tool',
    );
    expect(
      (await run(adapters, 'tool.read', ctxFor(), { name: 'morning-prices', version: 9 })).summary,
    ).toBe('no such version');
  });

  it('tool.list shows this topic only, with counts and hosts', async () => {
    const { adapters } = adaptersFor();
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    await run(
      adapters,
      'tool.save',
      ctxFor({ groupId, topicId: generalTopicId }),
      baseToolInput({ name: 'other-tool' }),
    );

    const personal = await run(adapters, 'tool.list', ctxFor(), {});
    expect(personal.summary).toBe('1 tool, 0 routines');
    expect(personal.modelText).toContain('morning-prices');
    expect(personal.modelText).not.toContain('other-tool');

    const inGroup = await run(
      adapters,
      'tool.list',
      ctxFor({ groupId, topicId: generalTopicId }),
      {},
    );
    expect(inGroup.summary).toBe('1 tool, 0 routines');
    expect(inGroup.modelText).toContain('other-tool');
    expect(inGroup.modelText).toContain(HOSTS[0]);
  });

  it('tool.revert appends a new version', async () => {
    const { adapters } = adaptersFor();
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    await run(adapters, 'tool.save', ctxFor(), baseToolInput({ source: 'return "v2";' }));

    const reverted = await run(adapters, 'tool.revert', ctxFor(), {
      name: 'morning-prices',
      toVersion: 1,
    });
    expect(reverted.summary).toBe('reverted morning-prices to v1 (now v3)');

    const current = await run(adapters, 'tool.read', ctxFor(), { name: 'morning-prices' });
    expect(current.summary).toBe('morning-prices v3');
    expect(current.modelText).toContain(SOURCE);
  });

  it('routine.pause and routine.delete act on this topic only', async () => {
    const runner = okRunner();
    const { adapters } = adaptersFor({ runner });
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    const groupCtx = ctxFor({ groupId, topicId: generalTopicId });
    await run(adapters, 'tool.save', groupCtx, baseToolInput());
    await approveHostsThroughGateway(adapters, groupCtx, 'morning-prices');
    const scheduled = await scheduleDaily(adapters, groupCtx, 'Morning prices');
    expect(scheduled.summary).toContain('Scheduled "Morning prices"');

    const listed = await run(adapters, 'tool.list', groupCtx, {});
    expect(listed.summary).toBe('1 tool, 1 routine');
    expect(listed.modelText).toContain('daily at 09:00');

    expect(
      (await run(adapters, 'routine.pause', ctxFor(), { title: 'Morning prices' })).summary,
    ).toBe('no such routine');
    const paused = await run(adapters, 'routine.pause', groupCtx, { title: 'Morning prices' });
    expect(paused.summary).toBe('paused "Morning prices"');
    const again = await run(adapters, 'routine.pause', groupCtx, { title: 'Morning prices' });
    expect(again.summary).toBe('already paused "Morning prices"');

    const deleted = await run(adapters, 'routine.delete', groupCtx, { title: 'Morning prices' });
    expect(deleted.summary).toBe('deleted "Morning prices"');
    expect(
      (await run(adapters, 'routine.delete', groupCtx, { title: 'Morning prices' })).summary,
    ).toBe('no such routine');
  });

  it('routine.schedule requires the exact hosts at execute time (fail-safe)', async () => {
    const scheduleAdapter = byName(adaptersFor().adapters, 'routine.schedule');
    const { adapters } = adaptersFor();
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    const args = {
      tool: 'morning-prices',
      title: 'Morning prices',
      schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' },
      hosts: ['other.example.com'],
      input: null,
    };
    expect(decodeActionArgs(scheduleAdapter.argsSchema, args).ok).toBe(true);
    // The hosts differ from the tool's current version: describe still
    // builds the card, but execute must throw (the gateway's generic
    // `failed`), never create a routine.
    await expect(scheduleAdapter.execute(ctxFor(), args)).rejects.toThrow();
    expect((await run(adapters, 'tool.list', ctxFor(), {})).summary).toBe('1 tool, 0 routines');
  });

  it('routine.schedule shows the hosts on the approval card', () => {
    const { adapters } = adaptersFor();
    const adapter = byName(adapters, 'routine.schedule');
    const described = adapter.describe({
      tool: 'morning-prices',
      title: 'Morning prices',
      schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' },
      hosts: HOSTS,
    });
    expect(described.summary).toBe('Schedule "Morning prices": daily at 09:00 Europe/Madrid');
    expect(described.details).toContain('api.example.com');
    expect(described.details).toContain('Runs tool morning-prices');
  });

  it('routine.schedule with no hosts says "no sites"', () => {
    const { adapters } = adaptersFor();
    const adapter = byName(adapters, 'routine.schedule');
    const described = adapter.describe({
      tool: 'morning-prices',
      title: 'Morning prices',
      schedule: { kind: 'interval', everyMinutes: 120 },
      hosts: [],
    });
    expect(described.summary).toBe('Schedule "Morning prices": every 2 hours');
    expect(described.details).toContain('no sites');
  });

  it('describeSchedule covers intervals and weekday filters', () => {
    expect(describeSchedule({ kind: 'interval', everyMinutes: 60 })).toBe('every 1 hour');
    expect(describeSchedule({ kind: 'interval', everyMinutes: 90 })).toBe('every 90 minutes');
    expect(
      describeSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [1, 3, 5],
      }),
    ).toBe('daily at 09:00 Europe/Madrid on Mon, Wed, Fri');
  });

  it('audit rows never contain tool source, output or fetched strings', async () => {
    const output = 'SECRET-OUTPUT-DO-NOT-LOG';
    const runner = okRunner(output);
    const { adapters } = adaptersFor({ runner });
    const source = 'return { text: "SECRET-SOURCE-DO-NOT-LOG" };';
    await run(adapters, 'tool.save', ctxFor(), baseToolInput({ source }));
    await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
    await approveHostsThroughGateway(adapters, ctxFor(), 'morning-prices');
    await scheduleDaily(adapters, ctxFor(), 'Routine one');

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditRow>`SELECT action, detail FROM audit_log`;
      }),
    );
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('SECRET-SOURCE-DO-NOT-LOG');
    expect(serialised).not.toContain('SECRET-OUTPUT-DO-NOT-LOG');
    expect(serialised).not.toContain(output);
  });

  it('validation errors return a summary, never a throw', async () => {
    const { adapters } = adaptersFor();
    const badName = await run(adapters, 'tool.save', ctxFor(), baseToolInput({ name: 'Bad' }));
    expect(badName.summary).toBe('invalid_args');
    const badSchedule = await run(adapters, 'routine.schedule', ctxFor(), {
      tool: 'morning-prices',
      title: 'x',
      schedule: { kind: 'interval', everyMinutes: 5 },
      hosts: [],
    });
    expect(badSchedule.summary).toBe('invalid_args');
    const badApprove = await run(adapters, 'tool.approve_hosts', ctxFor(), { name: 'Bad' });
    expect(badApprove.summary).toBe('invalid_args');
  });

  it('tool.approve_hosts approves the DB hosts; the runner then sees the intersection', async () => {
    const runner = okRunner('BTC 100');
    const { adapters } = adaptersFor({ runner });
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    expect(runner.calls[0]?.allowedHosts).toEqual([]);

    const approved = await approveHostsThroughGateway(adapters, ctxFor(), 'morning-prices');
    expect(approved.summary).toBe('approved morning-prices to contact: api.example.com');

    const ran = await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
    expect(ran.summary).toBe('ok');
    expect(runner.calls[1]).toEqual({ source: SOURCE, input: null, allowedHosts: HOSTS });
  });

  it('tool.approve_hosts card lists hosts read from the DB, not from the model', async () => {
    const { adapters } = adaptersFor();
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    const adapter = byName(adapters, 'tool.approve_hosts');
    // A hostile `hosts` field in the raw args is ignored: prepareArgs
    // binds the current version's hosts from the DB.
    const decoded = decodeActionArgs(adapter.argsSchema, {
      name: 'morning-prices',
      hosts: ['evil.example.com'],
    });
    expect(decoded.ok).toBe(false);
    const bound = (await adapter.prepareArgs?.(ctxFor(), { name: 'morning-prices' })) as
      ApproveHostsBoundArgs | undefined;
    expect(bound).toEqual({ name: 'morning-prices', hosts: HOSTS });
    const card = adapter.describe(bound ?? { name: 'morning-prices' });
    expect(card.summary).toBe('Allow the tool "morning-prices" to contact: api.example.com');
    expect(card.details).toContain('api.example.com');
    expect(card.details).not.toContain('evil.example.com');
  });

  it('tool.approve_hosts fails safe when hosts change between card and execution', async () => {
    const { adapters } = adaptersFor();
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    const adapter = byName(adapters, 'tool.approve_hosts');
    const bound = (await adapter.prepareArgs?.(ctxFor(), { name: 'morning-prices' })) as
      ApproveHostsBoundArgs | undefined;
    // A new version declaring a new host lands after the card was shown.
    await run(
      adapters,
      'tool.save',
      ctxFor(),
      baseToolInput({ source: 'return "v2";', hosts: ['api.example.com', 'new.example.com'] }),
    );
    await expect(
      adapter.execute({ ...ctxFor(), requestId: randomUUID() }, bound ?? { name: 'x' }),
    ).rejects.toThrow('tool hosts changed after the approval card was shown');
  });

  it('a new version with an extra host does not reach it until re-approved', async () => {
    const runner = okRunner('BTC 100');
    const { adapters } = adaptersFor({ runner });
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    await approveHostsThroughGateway(adapters, ctxFor(), 'morning-prices');

    const saved = await run(
      adapters,
      'tool.save',
      ctxFor(),
      baseToolInput({
        source: 'return "v2";',
        hosts: ['api.example.com', 'new.example.com'],
      }),
    );
    expect(saved.summary).toContain('saved morning-prices v2');
    expect(saved.summary).toContain('new.example.com');
    expect(saved.modelText).toContain('new.example.com');
    // The test run that just happened reached only the approved subset.
    const lastCall = runner.calls[runner.calls.length - 1];
    expect(lastCall?.allowedHosts).toEqual(['api.example.com']);

    // A re-approval covers the new set; the tool then reaches both hosts.
    const reapproved = await approveHostsThroughGateway(adapters, ctxFor(), 'morning-prices');
    expect(reapproved.summary).toContain('api.example.com, new.example.com');
    await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
    const afterReapproval = runner.calls[runner.calls.length - 1];
    expect(afterReapproval?.allowedHosts).toEqual(['api.example.com', 'new.example.com']);
  });

  it('routine.schedule rejects hosts outside the tool approved set', async () => {
    const { adapters } = adaptersFor();
    await run(adapters, 'tool.save', ctxFor(), baseToolInput());
    // Nothing approved yet: even the exact declared hosts are refused.
    const refused = await run(adapters, 'routine.schedule', ctxFor(), {
      tool: 'morning-prices',
      title: 'Morning prices',
      schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' },
      hosts: HOSTS,
    });
    expect(refused.summary).toBe(
      'the tool hosts are not approved yet; run tool.approve_hosts first',
    );
    expect((await run(adapters, 'tool.list', ctxFor(), {})).summary).toBe('1 tool, 0 routines');

    await approveHostsThroughGateway(adapters, ctxFor(), 'morning-prices');
    const scheduled = await scheduleDaily(adapters, ctxFor(), 'Morning prices');
    expect(scheduled.summary).toContain('Scheduled "Morning prices"');
    expect((await run(adapters, 'tool.list', ctxFor(), {})).summary).toBe('1 tool, 1 routine');
  });

  it('tool.revoke_hosts empties the set and is audited without code or output', async () => {
    const runner = okRunner('BTC 100');
    const { adapters } = adaptersFor({ runner });
    const source = 'return { text: "SECRET-SOURCE-DO-NOT-LOG" };';
    await run(adapters, 'tool.save', ctxFor(), baseToolInput({ source }));
    await approveHostsThroughGateway(adapters, ctxFor(), 'morning-prices');

    const revoked = await run(adapters, 'tool.revoke_hosts', ctxFor(), {
      name: 'morning-prices',
    });
    expect(revoked.summary).toBe('revoked the approved hosts of "morning-prices"');

    await run(adapters, 'tool.run', ctxFor(), { name: 'morning-prices' });
    expect(runner.calls[runner.calls.length - 1]?.allowedHosts).toEqual([]);

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AuditRow>`SELECT action, subject_id, detail FROM audit_log`;
      }),
    );
    const revokedRow = rows.find((row) => row.action === 'tool.hosts_revoked');
    expect(revokedRow?.subjectId).toBeDefined();
    expect(revokedRow?.detail).toEqual({ name: 'morning-prices' });
    const approvedRow = rows.find((row) => row.action === 'tool.hosts_approved');
    expect(approvedRow?.detail).toEqual({
      name: 'morning-prices',
      version: 1,
      hosts: HOSTS,
    });
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('SECRET-SOURCE-DO-NOT-LOG');
    expect(serialised).not.toContain('BTC 100');
    expect((await run(adapters, 'tool.revoke_hosts', ctxFor(), { name: 'missing' })).summary).toBe(
      'no such tool',
    );
  });

  async function scheduleDaily(
    adapters: ActionAdapter<unknown>[],
    ctx: ActionContext,
    title: string,
  ): Promise<{ summary: string; modelText?: string }> {
    return run(adapters, 'routine.schedule', ctx, {
      tool: 'morning-prices',
      title,
      schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' },
      hosts: HOSTS,
    });
  }

  // Drives `tool.approve_hosts` through the full approval flow (prepare →
  // card → execute), like the gateway does in production: binding the
  // hosts from the DB, describing the card, then executing the bound args.
  async function approveHostsThroughGateway(
    adapters: ActionAdapter<unknown>[],
    ctx: ActionContext,
    name: string,
  ): Promise<{ summary: string }> {
    const adapter = byName(adapters, 'tool.approve_hosts');
    const decoded = decodeActionArgs(adapter.argsSchema, { name });
    if (!decoded.ok) {
      throw new Error('approve_hosts args did not parse');
    }
    const bound = (await adapter.prepareArgs?.(ctx, decoded.value)) as
      ApproveHostsBoundArgs | undefined;
    const card = adapter.describe(bound ?? decoded.value);
    expect(card.summary).toContain(name);
    return adapter.execute({ ...ctx, requestId: randomUUID() }, bound ?? decoded.value);
  }
});
