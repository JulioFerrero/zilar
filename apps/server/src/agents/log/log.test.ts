// T-1426: the session log's append/read/retention behaviour. The log is best
// effort and must never leak a secret or a huge tool output.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createKeyCipher } from '../../connections/crypto';
import type { ServerDatabase } from '../../db/client';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../../test-support';
import { createTurnLog, insertEvent, TASK_EVENT_TEXT_MAX_BYTES } from './append';
import { listTaskEvents, loadTaskOwnerId } from './read';
import { deleteEventsOlderThan, retentionCutoff, TASK_EVENT_RETENTION_DAYS } from './retention';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

function captureLogger(): {
  warn: (fields: Record<string, unknown>, message: string) => void;
  calls: Array<{ fields: Record<string, unknown>; message: string }>;
} {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    warn: (fields, message) => calls.push({ fields, message }),
    calls,
  };
}

const wait = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('agent task events', () => {
  let context: TestContext;
  let ownerId: string;
  let aiId: string;

  beforeEach(async () => {
    context = await createTestContext();
    ownerId = randomUUID();
    aiId = randomUUID();
    const connectionId = randomUUID();
    const encrypted = createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${encrypted}, ${null})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Logger AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
  });

  afterEach(async () => {
    await context.close();
  });

  function logFor(taskId: string, secrets: readonly string[] = [PROVIDER_KEY]) {
    return createTurnLog({
      db: context.db,
      logger: { warn: () => undefined },
      taskId,
      aiId,
      ownerId,
      chatJid: `${ownerId}@${TEST_XMPP_DOMAIN}`,
      secrets,
    });
  }

  async function waitForEvents(taskId: string, count: number) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const page = await listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 100 });
      if (page.events.length >= count) {
        return page;
      }
      await wait();
    }
    return listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 100 });
  }

  it('appends and reads events in seq order with the owner id', async () => {
    const taskId = randomUUID();
    const log = logFor(taskId);
    log.append('status', { stage: 'Running tests' });
    log.append('tool_call', { tool: 'run_tests' });
    log.append('answer', { bytes: 12 });

    expect(await loadTaskOwnerId(context.db, taskId)).toBe(ownerId);

    const page = await waitForEvents(taskId, 3);
    expect(page.events.map((event) => event.kind)).toEqual(['status', 'tool_call', 'answer']);
    expect(page.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(page.next).toBeNull();
  });

  it('redacts a secret and truncates a string to 2 KiB', async () => {
    const taskId = randomUUID();
    // No named secrets: the sk- backstop in `redactSecrets` is what must
    // catch the provider key.
    const log = logFor(taskId, []);
    log.append('tool_result', {
      tool: 'fetch',
      output: `${PROVIDER_KEY} ${'a'.repeat(TASK_EVENT_TEXT_MAX_BYTES * 2)}`,
    });

    const page = await waitForEvents(taskId, 1);
    const output = page.events[0]?.data.output;
    expect(typeof output).toBe('string');
    const text = output as string;
    expect(text).not.toContain(PROVIDER_KEY);
    expect(text).toContain('sk-***');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(TASK_EVENT_TEXT_MAX_BYTES);
  });

  it('pages by seq and clamps the page size', async () => {
    const taskId = randomUUID();
    const log = logFor(taskId);
    for (let index = 0; index < 5; index += 1) {
      log.append('status', { stage: `step ${index}` });
    }
    await waitForEvents(taskId, 5);

    const first = await listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 2 });
    expect(first.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(first.next).toBe(2);

    const second = await listTaskEvents(context.db, {
      taskId,
      ownerId,
      after: first.next ?? 0,
      limit: 2,
    });
    expect(second.events.map((event) => event.seq)).toEqual([3, 4]);

    // A limit above the cap is clamped to 100; an unknown task has no owner.
    const all = await listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 1000 });
    expect(all.events).toHaveLength(5);
    expect(await loadTaskOwnerId(context.db, randomUUID())).toBeNull();
  });

  it('deletes only rows older than the retention window', async () => {
    const taskId = randomUUID();
    const now = new Date();
    const old = new Date(now.getTime() - (TASK_EVENT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    await insertEvent(context.db, {
      id: randomUUID(),
      taskId,
      aiId,
      ownerId,
      chatJid: 'room@rooms.test',
      seq: 1,
      kind: 'status',
      at: old.toISOString(),
      durationMs: null,
      data: { stage: 'old' },
    });
    await insertEvent(context.db, {
      id: randomUUID(),
      taskId,
      aiId,
      ownerId,
      chatJid: 'room@rooms.test',
      seq: 2,
      kind: 'status',
      at: now.toISOString(),
      durationMs: null,
      data: { stage: 'new' },
    });

    const removed = await deleteEventsOlderThan(context.db, retentionCutoff(now));
    expect(removed).toBe(1);

    const page = await listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 100 });
    expect(page.events.map((event) => event.seq)).toEqual([2]);
  });

  it('never fails the caller when the write fails, logging ids only', async () => {
    const logger = captureLogger();
    const log = createTurnLog({
      // An unregistered database: every insert rejects.
      db: { kind: 'postgres', url: 'postgres://unreachable' } as ServerDatabase,
      logger,
      taskId: randomUUID(),
      aiId,
      ownerId,
      chatJid: 'owner@test',
      secrets: [],
    });

    expect(() => log.append('status', { stage: 'Running tests' })).not.toThrow();
    await wait();
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.message).toBe('AI task event could not be stored');
    expect(logger.calls[0]?.fields).toMatchObject({ aiId });
  });
});
