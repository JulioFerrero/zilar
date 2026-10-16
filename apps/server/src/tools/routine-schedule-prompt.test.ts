// T-1649: the `routine.schedule` approval card takes a prompt as well as a
// tool. The prompt variant skips the tool and host checks, decodes through the
// union, and creates a `kind = 'prompt'` routine for the AI's own chat.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { decodeActionArgs, type ActionAdapter, type ActionContext } from '../actions/registry';
import type { RoutineRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { buildToolAdapters } from './adapters';
import type { ToolRunner } from './types';

const NOW = new Date('2026-01-05T08:00:00.000Z');

const PROMPT_ARGS = {
  title: 'Morning prices',
  schedule: { kind: 'daily', time: '08:00', timezone: 'Europe/Madrid' },
  prompt: 'Post the current BTC, gold and S&P 500 prices with their sources.',
};

function scheduleAdapter(context: TestContext): ActionAdapter<unknown> {
  const adapters = buildToolAdapters({
    db: context.db,
    runner: null as unknown as ToolRunner,
    post: async () => false,
    now: () => NOW,
  });
  const adapter = adapters.find((entry) => entry.name === 'routine.schedule');
  if (!adapter) {
    throw new Error('routine.schedule adapter missing');
  }
  return adapter;
}

function routinesOf(context: TestContext, aiId: string): Promise<readonly RoutineRow[]> {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE ai_id = ${aiId}`;
    }),
  );
}

// T-1737: a saved tool with hosts, so the tool-form tests can bind them.
async function seedTool(
  context: TestContext,
  input: { aiId: string; createdBy: string; hosts: string[] },
): Promise<string> {
  const toolId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_tools (
        id, ai_id, group_id, name, description, current_version, approved_hosts,
        created_by, created_at, updated_at, deleted_at
      ) VALUES (
        ${toolId}, ${input.aiId}, NULL, 'market-prices', 'Market prices', 1,
        ${JSON.stringify(input.hosts)}::jsonb, ${input.createdBy},
        ${NOW.toISOString()}, ${NOW.toISOString()}, NULL
      )`;
      yield* sql`INSERT INTO ai_tool_versions (
        id, tool_id, version, source, hosts, message, created_by, created_at
      ) VALUES (
        ${randomUUID()}, ${toolId}, 1, 'return 1', ${JSON.stringify(input.hosts)}::jsonb,
        'v1', ${input.createdBy}, ${NOW.toISOString()}
      )`;
    }),
  );
  return toolId;
}

// T-1737: one live prompt routine, so the delete-by-id test can prove only
// the named routine is removed.
async function seedPromptRoutine(
  context: TestContext,
  input: { aiId: string; createdBy: string; title: string },
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO routines (
        id, ai_id, group_id, topic_id, kind, tool_id, prompt, title, schedule,
        input, approved_hosts, status, paused_reason, next_run_at, last_run_at,
        last_status, consecutive_failures, created_by, created_at, updated_at,
        deleted_at
      ) VALUES (
        ${id}, ${input.aiId}, NULL, NULL, 'prompt', NULL, 'Post prices',
        ${input.title}, ${JSON.stringify({ kind: 'interval', everyMinutes: 60 })}::jsonb,
        NULL, '[]'::jsonb, 'active', NULL, ${NOW.toISOString()}, NULL, NULL, 0,
        ${input.createdBy}, ${NOW.toISOString()}, ${NOW.toISOString()}, NULL
      )`;
    }),
  );
  return id;
}

describe('routine.schedule prompt variant', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('creates a prompt routine for the AI chat when the args carry a prompt', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const adapter = scheduleAdapter(context);
    const ctx: ActionContext = { aiId, groupId: null, topicId: null, requestId: 'req-1' };

    const result = await adapter.execute(ctx, PROMPT_ARGS);

    expect(result.summary).toContain('Scheduled "Morning prices"');
    const rows = await routinesOf(context, aiId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('prompt');
    expect(row.toolId).toBeNull();
    expect(row.prompt).toBe(PROMPT_ARGS.prompt);
    expect(row.groupId).toBeNull();
    expect(row.topicId).toBeNull();
  });

  it('decodes the prompt args and still decodes the tool args', () => {
    const adapter = scheduleAdapter(context);

    expect(decodeActionArgs(adapter.argsSchema, PROMPT_ARGS).ok).toBe(true);
    expect(
      decodeActionArgs(adapter.argsSchema, {
        tool: 'daily-report',
        title: 'Daily report',
        schedule: { kind: 'interval', everyMinutes: 1440 },
        hosts: ['api.example.com'],
      }).ok,
    ).toBe(true);
  });

  it('refuses args that mix the tool and prompt fields', () => {
    const adapter = scheduleAdapter(context);

    const decoded = decodeActionArgs(adapter.argsSchema, {
      tool: 'daily-report',
      title: 'Mixed',
      schedule: { kind: 'interval', everyMinutes: 60 },
      hosts: ['api.example.com'],
      prompt: 'Post prices',
    });

    expect(decoded.ok).toBe(false);
  });

  it('shows the prompt on the card and no hosts line', () => {
    const adapter = scheduleAdapter(context);

    const card = adapter.describe(PROMPT_ARGS);

    expect(card.summary).toBe('Morning prices · daily at 08:00 Europe/Madrid');
    expect(card.details).toContain(PROMPT_ARGS.prompt);
    expect(card.details).not.toContain('contact:');
  });

  it('cuts a long prompt at 500 characters with an ellipsis', () => {
    const adapter = scheduleAdapter(context);

    const card = adapter.describe({ ...PROMPT_ARGS, prompt: 'x'.repeat(700) });

    expect(card.details).toContain(`${'x'.repeat(500)}…`);
    expect(card.details).not.toContain('x'.repeat(501));
  });

  it('binds the saved tool hosts when the tool form leaves hosts out', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const toolId = await seedTool(context, {
      aiId,
      createdBy: ownerId,
      hosts: ['api.example.com'],
    });
    const adapter = scheduleAdapter(context);
    const ctx: ActionContext = { aiId, groupId: null, topicId: null, requestId: 'req-tool' };
    const args = {
      tool: 'market-prices',
      title: 'Prices',
      schedule: { kind: 'interval', everyMinutes: 5 },
    };

    const prepared = await adapter.prepareArgs?.(ctx, args);

    expect(prepared).toMatchObject({ hosts: ['api.example.com'] });
    const result = await adapter.execute(ctx, prepared);
    expect(result.summary).toContain('Scheduled "Prices"');
    const rows = await routinesOf(context, aiId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toolId).toBe(toolId);
    expect(rows[0]!.approvedHosts).toEqual(['api.example.com']);
  });

  it('deletes the routine named by an id prefix and leaves the other one alone', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const first = await seedPromptRoutine(context, {
      aiId,
      createdBy: ownerId,
      title: 'Daily prices',
    });
    const second = await seedPromptRoutine(context, {
      aiId,
      createdBy: ownerId,
      title: 'Weekly prices',
    });
    const adapters = buildToolAdapters({
      db: context.db,
      runner: null as unknown as ToolRunner,
      post: async () => false,
      now: () => NOW,
    });
    const adapter = adapters.find((entry) => entry.name === 'routine.delete');
    if (!adapter) {
      throw new Error('routine.delete adapter missing');
    }
    const ctx: ActionContext = { aiId, groupId: null, topicId: null, requestId: 'req-delete' };

    const result = await adapter.execute(ctx, { id: first.slice(0, 8) });

    expect(result.summary).toBe('deleted "Daily prices"');
    const rows = await routinesOf(context, aiId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(first)!.deletedAt).not.toBeNull();
    expect(byId.get(second)!.deletedAt).toBeNull();
  });
});
