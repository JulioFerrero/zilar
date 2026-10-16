// T-1645: a prompt routine runs through the optional `runPrompt` port. The
// daily per-AI cap, the outcome mapping (replied/failed/skipped) and the
// absent-port and inactive-AI paths are covered here.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { RoutineRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { executeRoutine, FAILURE_PAUSE_NOTICE } from './execute';
import type { PromptRunner } from './execute-prompt';

const NOW = new Date('2026-01-05T12:00:00.000Z');
const DAY = '2026-01-05';
const silentAudit: AuditRecorder = { record: async () => undefined };
const silentLogger = { warn: () => undefined };

async function seedPromptRoutine(
  context: TestContext,
  input: { aiId: string; createdBy: string; prompt?: string; title?: string },
): Promise<RoutineRow> {
  const id = randomUUID();
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`INSERT INTO routines (
        id, ai_id, group_id, topic_id, kind, tool_id, prompt, title, schedule,
        input, approved_hosts, status, paused_reason, next_run_at, last_run_at,
        last_status, consecutive_failures, created_by, created_at, updated_at,
        deleted_at
      ) VALUES (
        ${id}, ${input.aiId}, NULL, NULL, 'prompt', NULL, ${input.prompt ?? 'hi'},
        ${input.title ?? 'Morning summary'},
        ${JSON.stringify({ kind: 'interval', everyMinutes: 60 })}::jsonb, NULL,
        '[]'::jsonb, 'active', NULL, ${NOW.toISOString()}, NULL, NULL, 0,
        ${input.createdBy}, ${NOW.toISOString()}, ${NOW.toISOString()}, NULL
      )
      RETURNING *`;
    }),
  );
  const row = rows[0];
  if (!row) {
    throw new Error('routine row missing');
  }
  return row;
}

async function readRoutine(context: TestContext, id: string): Promise<RoutineRow> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
    }),
  );
  const row = rows[0];
  if (!row) {
    throw new Error('routine row missing');
  }
  return row;
}

function runPromptOnce(
  context: TestContext,
  row: RoutineRow,
  runPrompt: PromptRunner,
  posts: string[],
): Promise<void> {
  return executeRoutine(
    {
      runTool: async () => {
        throw new Error('runTool must not be called for a prompt routine');
      },
      post: async ({ text }) => {
        posts.push(text);
        return true;
      },
      runPrompt,
    },
    row,
    { db: context.db, now: () => NOW, audit: silentAudit, logger: silentLogger },
  );
}

describe('executePromptRoutine', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('records replied as ok with no failures', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const row = await seedPromptRoutine(context, { aiId, createdBy: ownerId });

    const seen: string[] = [];
    await runPromptOnce(
      context,
      row,
      async (input) => {
        seen.push(input.prompt);
        return 'replied';
      },
      [],
    );

    expect(seen).toEqual(['hi']);
    const updated = await readRoutine(context, row.id);
    expect(updated.lastStatus).toBe('ok');
    expect(updated.consecutiveFailures).toBe(0);
  });

  it('records stopped as skipped and leaves the failure count unchanged', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const row = await seedPromptRoutine(context, { aiId, createdBy: ownerId });

    await runPromptOnce(context, row, async () => 'stopped', []);

    const updated = await readRoutine(context, row.id);
    expect(updated.lastStatus).toBe('skipped');
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.status).toBe('active');
  });

  it('pauses on the third failed run and posts the fixed notice once', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const seeded = await seedPromptRoutine(context, { aiId, createdBy: ownerId });

    const posts: string[] = [];
    let row = seeded;
    for (let index = 0; index < 3; index += 1) {
      await runPromptOnce(context, row, async () => 'failed', posts);
      row = await readRoutine(context, seeded.id);
    }

    expect(row.status).toBe('paused');
    expect(row.pausedReason).toBe('failures');
    expect(row.consecutiveFailures).toBe(3);
    expect(row.lastStatus).toBe('error');
    expect(posts).toEqual([FAILURE_PAUSE_NOTICE(seeded.title)]);
  });

  it('skips without calling the runner once the day is at the cap', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const row = await seedPromptRoutine(context, { aiId, createdBy: ownerId });
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO routine_prompt_runs (ai_id, day, count)
          VALUES (${aiId}, ${DAY}, 24)`;
      }),
    );

    let called = 0;
    await runPromptOnce(
      context,
      row,
      async () => {
        called += 1;
        return 'replied';
      },
      [],
    );

    expect(called).toBe(0);
    const updated = await readRoutine(context, row.id);
    expect(updated.lastStatus).toBe('skipped');
  });

  it('skips when no runPrompt port is wired', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const row = await seedPromptRoutine(context, { aiId, createdBy: ownerId });

    await executeRoutine(
      {
        runTool: async () => {
          throw new Error('runTool must not be called for a prompt routine');
        },
        post: async () => true,
      },
      row,
      { db: context.db, now: () => NOW, audit: silentAudit, logger: silentLogger },
    );

    const updated = await readRoutine(context, row.id);
    expect(updated.lastStatus).toBe('skipped');
  });

  it('skips an inactive AI without calling the runner', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { status: 'disabled' });
    const row = await seedPromptRoutine(context, { aiId, createdBy: ownerId });

    let called = 0;
    await runPromptOnce(
      context,
      row,
      async () => {
        called += 1;
        return 'replied';
      },
      [],
    );

    expect(called).toBe(0);
    const updated = await readRoutine(context, row.id);
    expect(updated.lastStatus).toBe('skipped');
  });
});
