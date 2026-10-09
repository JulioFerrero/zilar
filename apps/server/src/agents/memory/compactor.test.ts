import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, TEST_XMPP_DOMAIN, type TestContext } from '../../test-support';
import { compactMemory } from './compactor';

const BASE = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function day(seq: number): Date {
  return new Date(BASE + seq * DAY);
}

function lineFor(seq: number): string {
  return `#${seq} ${day(seq).toISOString().slice(0, 10)} Bob: m${seq}`;
}

async function seedAi(context: TestContext): Promise<string> {
  const ownerId = randomUUID();
  const connectionId = randomUUID();
  const aiId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" ${sql.insert({
        id: ownerId,
        name: 'Owner',
        email: `${ownerId}@example.com`,
      })}`;
      yield* sql`INSERT INTO provider_connections ${sql.insert({
        id: connectionId,
        owner: ownerId,
        provider: 'openai',
        encrypted_key: 'CHANGE_ME',
        label: null,
      })}`;
      yield* sql`INSERT INTO ais ${sql.insert({
        id: aiId,
        owner: ownerId,
        name: 'Memory AI',
        template: 'dev',
        persona: 'A persona',
        provider_connection_id: connectionId,
        model: 'gpt-4o-mini',
        localpart: `ai-${aiId}`,
        jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
        status: 'active',
      })}`;
    }),
  );
  return aiId;
}

async function seedRows(
  context: TestContext,
  aiId: string,
  chatKey: string,
  count: number,
): Promise<void> {
  const values = Array.from({ length: count }, (_, seq) => ({
    ai_id: aiId,
    chat_key: chatKey,
    seq,
    message_id: `${chatKey}-m${seq}`,
    at: day(seq),
    sender: 'Bob',
    text: `m${seq}`,
    deleted: false,
  }));
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_memory_messages ${sql.insert(values)}`;
    }),
  );
}

async function countNodes(context: TestContext, aiId: string, chatKey: string): Promise<number> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM ai_memory_nodes WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
    }),
  );
  return row?.total ?? 0;
}

async function summaryFor(
  context: TestContext,
  aiId: string,
  chatKey: string,
  lo: number,
  hi: number,
): Promise<string | undefined> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ summary: string }>`SELECT summary FROM ai_memory_nodes
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND lo = ${lo} AND hi = ${hi}
        LIMIT 1`;
    }),
  );
  return row?.summary;
}

describe('memory compactor', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('builds the smallest pending node from its raw rows', async () => {
    const aiId = await seedAi(context);
    const chatKey = 'dm:a';
    await seedRows(context, aiId, chatKey, 66);
    const prompts: string[] = [];
    const complete = (prompt: string): Promise<string> => {
      prompts.push(prompt);
      return Promise.resolve('  First line  \nsecond line');
    };

    const result = await compactMemory({ db: context.db, aiId, chatKey, complete });

    expect(result).toEqual({ built: 1, withheld: 0 });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Compress chat memory #0-15');
    for (let seq = 0; seq < 16; seq += 1) {
      expect(prompts[0]).toContain(lineFor(seq));
    }
    expect(await summaryFor(context, aiId, chatKey, 0, 16)).toBe('First line');
  });

  it('builds the next level from the two child summaries, at most 4 calls per pass', async () => {
    const aiId = await seedAi(context);
    const chatKey = 'dm:a';
    await seedRows(context, aiId, chatKey, 112);
    const prompts: string[] = [];
    const complete = (prompt: string): Promise<string> => {
      prompts.push(prompt);
      return Promise.resolve('summary');
    };

    const first = await compactMemory({ db: context.db, aiId, chatKey, complete, limit: 4 });
    const firstCalls = prompts.length;
    // The 50-message window leaves a 62-row range, so three size-16 blocks are
    // pending: 0-15, 16-31 and 32-47.
    expect(firstCalls).toBeLessThanOrEqual(4);
    expect(first.built).toBe(firstCalls);
    expect(await summaryFor(context, aiId, chatKey, 0, 16)).toBe('summary');
    expect(await summaryFor(context, aiId, chatKey, 16, 32)).toBe('summary');

    const second = await compactMemory({ db: context.db, aiId, chatKey, complete, limit: 4 });
    const secondCalls = prompts.length - firstCalls;
    expect(secondCalls).toBeLessThanOrEqual(4);
    expect(second.built).toBe(secondCalls);
    expect(await summaryFor(context, aiId, chatKey, 0, 32)).toBe('summary');
    const childPrompt = prompts[firstCalls];
    expect(childPrompt).toContain('#0-15 ');
    expect(childPrompt).toContain('#16-31 ');
  });

  it('withholds a secret-like summary and counts it', async () => {
    const aiId = await seedAi(context);
    const chatKey = 'dm:a';
    await seedRows(context, aiId, chatKey, 66);
    const complete = (): Promise<string> => Promise.resolve('the token is sk-abcdefghijklmnop1234');

    const result = await compactMemory({ db: context.db, aiId, chatKey, complete });

    expect(result).toEqual({ built: 1, withheld: 1 });
    expect(await summaryFor(context, aiId, chatKey, 0, 16)).toBe('(summary withheld)');
  });

  it('stores (nothing kept) without calling complete when every row is deleted', async () => {
    const aiId = await seedAi(context);
    const chatKey = 'dm:a';
    await seedRows(context, aiId, chatKey, 66);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ai_memory_messages SET deleted = true
          WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND seq < 16`;
      }),
    );
    let calls = 0;
    const complete = (): Promise<string> => {
      calls += 1;
      return Promise.resolve('never used');
    };

    const result = await compactMemory({ db: context.db, aiId, chatKey, complete });

    expect(calls).toBe(0);
    expect(result).toEqual({ built: 1, withheld: 0 });
    expect(await summaryFor(context, aiId, chatKey, 0, 16)).toBe('(nothing kept)');
  });

  it('rethrows a failing complete and builds nothing for that block', async () => {
    const aiId = await seedAi(context);
    const chatKey = 'dm:a';
    await seedRows(context, aiId, chatKey, 66);
    const complete = (): Promise<string> => Promise.reject(new Error('model exploded'));

    await expect(compactMemory({ db: context.db, aiId, chatKey, complete })).rejects.toThrow(
      'model exploded',
    );
    expect(await countNodes(context, aiId, chatKey)).toBe(0);
  });
});
