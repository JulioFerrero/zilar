import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { ensureModelPrices, resetCatalogCache } from '../ai/catalog';
import { priceKey, setModelPrices } from '../ai/cost';
import { createKeyCipher } from '../connections/crypto';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { recordUsage } from './usage-store';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';
const PROVIDER = 'openai';
// 2.5 USD/million input, 15 USD/million output; cache prices fall back to input.
const MODEL = 'gpt-usage-test';

function captureLogger(): {
  warn: (fields: Record<string, unknown>, message: string) => void;
  calls: Array<{ fields: Record<string, unknown>; message: string }>;
} {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    warn: (fields, message) => {
      calls.push({ fields, message });
    },
    calls,
  };
}

// 1000 input, 200 output, 500 cache read, 100 cache write.
const USAGE = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 500,
  cacheWriteTokens: 100,
};

describe('recordUsage', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
    setModelPrices(
      new Map([
        [
          priceKey(PROVIDER, MODEL),
          {
            inputPerMTok: 2.5,
            outputPerMTok: 15,
            cacheReadPerMTok: null,
            cacheWritePerMTok: null,
          },
        ],
      ]),
    );
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedAi(): Promise<string> {
    const ownerId = randomUUID();
    const connectionId = randomUUID();
    const aiId = randomUUID();
    const encrypted = createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${ownerId}, ${PROVIDER}, ${encrypted}, ${null})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Spendy AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${MODEL}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
    return aiId;
  }

  async function rowsFor(aiId: string) {
    return testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          day: string;
          inputTokens: string;
          outputTokens: string;
          cachedTokens: string;
          cacheWriteTokens: string;
          costUsd: string;
        }>`SELECT day::text, input_tokens::text, output_tokens::text, cached_tokens::text,
            cache_write_tokens::text, cost_usd::text
          FROM ai_usage WHERE ai_id = ${aiId} ORDER BY day`;
      }),
    );
  }

  it('adds two calls on the same UTC day into one row', async () => {
    const aiId = await seedAi();
    const deps = { db: context.db, logger: captureLogger() };
    const day = new Date('2026-10-14T08:00:00Z');

    await recordUsage(deps, aiId, PROVIDER, MODEL, USAGE, day);
    await recordUsage(deps, aiId, PROVIDER, MODEL, USAGE, day);

    const stored = await rowsFor(aiId);
    expect(stored).toHaveLength(1);
    // Each call: 1000*2.5 + 200*15 + 500*2.5 + 100*2.5 = 7000 micro-USD.
    expect(stored[0]).toMatchObject({
      day: '2026-10-14',
      inputTokens: '2000',
      outputTokens: '400',
      cachedTokens: '1000',
      cacheWriteTokens: '200',
      costUsd: '0.014000',
    });
  });

  it('starts a new row on the next UTC day', async () => {
    const aiId = await seedAi();
    const deps = { db: context.db, logger: captureLogger() };

    await recordUsage(deps, aiId, PROVIDER, MODEL, USAGE, new Date('2026-10-14T23:30:00Z'));
    await recordUsage(
      deps,
      aiId,
      PROVIDER,
      MODEL,
      { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      new Date('2026-10-15T00:30:00Z'),
    );

    const stored = await rowsFor(aiId);
    expect(stored.map((row) => row.day)).toEqual(['2026-10-14', '2026-10-15']);
    expect(stored[0]?.costUsd).toBe('0.007000');
    // 10*2.5 + 20*15 = 325 micro-USD.
    expect(stored[1]?.costUsd).toBe('0.000325');
  });

  it('cascades the rows away when the AI is deleted', async () => {
    const aiId = await seedAi();
    await recordUsage(
      { db: context.db, logger: captureLogger() },
      aiId,
      PROVIDER,
      MODEL,
      USAGE,
      new Date('2026-10-14T08:00:00Z'),
    );

    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM ais WHERE id = ${aiId}`;
      }),
    );

    expect(await rowsFor(aiId)).toHaveLength(0);
  });

  it('logs and resolves when the write fails', async () => {
    const logger = captureLogger();
    const missingAiId = randomUUID();

    await expect(
      recordUsage(
        { db: context.db, logger },
        missingAiId,
        PROVIDER,
        MODEL,
        USAGE,
        new Date('2026-10-14T08:00:00Z'),
      ),
    ).resolves.toBeUndefined();

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.fields['aiId']).toBe(missingAiId);
  });
});

// The price warm-up `recordUsage` runs for an unpriced model: a settled
// request must not be cached forever, or every later call records cost 0.
describe('ensureModelPrices', () => {
  beforeEach(() => {
    resetCatalogCache();
    setModelPrices(new Map());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCatalogCache();
    setModelPrices(new Map());
  });

  it('retries the catalog fetch after a failed warm-up instead of caching the failure', async () => {
    let fetches = 0;
    vi.stubGlobal('fetch', () => {
      fetches += 1;
      return Promise.reject(new Error('offline'));
    });

    await ensureModelPrices(PROVIDER, MODEL);
    await ensureModelPrices(PROVIDER, MODEL);

    expect(fetches).toBe(2);
  });
});
