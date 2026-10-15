import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { lastFailures, withLastFailures } from './health';

describe('lastFailures', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedAi(name: string): Promise<string> {
    const ownerId = randomUUID();
    const connectionId = randomUUID();
    const aiId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${'encrypted'}, ${null})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${name}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
    return aiId;
  }

  async function addEvent(
    aiId: string,
    kind: string,
    at: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO agent_task_events
            (id, task_id, ai_id, owner_id, chat_jid, seq, kind, at, data)
          VALUES (${randomUUID()}, ${randomUUID()}, ${aiId}, ${'owner'}, ${'chat@example.com'}, ${1}, ${kind}, ${at}, ${JSON.stringify(data)}::jsonb)`;
      }),
    );
  }

  function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  it('answers an empty map without a query when there are no ids', async () => {
    expect(await lastFailures(context.db, [])).toEqual(new Map());
  });

  it('reports the kind of an error no answer has followed', async () => {
    const aiId = await seedAi('Failing AI');
    const at = ago(60_000);
    await addEvent(aiId, 'error', at, { kind: 'key_rejected' });

    const failures = await lastFailures(context.db, [aiId]);

    expect(failures.get(aiId)).toEqual({ kind: 'key_rejected', at });
  });

  it('clears the failure when an answer follows the error', async () => {
    const aiId = await seedAi('Recovered AI');
    await addEvent(aiId, 'error', ago(120_000), { kind: 'timeout' });
    await addEvent(aiId, 'answer', ago(60_000), {});

    expect((await lastFailures(context.db, [aiId])).has(aiId)).toBe(false);
  });

  it('ignores an error older than 7 days', async () => {
    const aiId = await seedAi('Old AI');
    await addEvent(aiId, 'error', ago(8 * 24 * 60 * 60 * 1000), { kind: 'provider_error' });

    expect((await lastFailures(context.db, [aiId])).has(aiId)).toBe(false);
  });

  it('reads several AIs in one call', async () => {
    const first = await seedAi('First AI');
    const second = await seedAi('Second AI');
    await addEvent(first, 'error', ago(60_000), { kind: 'rate_limited' });
    await addEvent(second, 'error', ago(60_000), { kind: 'model_not_found' });

    const failures = await lastFailures(context.db, [first, second]);

    expect(failures.get(first)?.kind).toBe('rate_limited');
    expect(failures.get(second)?.kind).toBe('model_not_found');
  });

  it('decorates a list, giving a healthy AI lastFailure null', async () => {
    const failing = await seedAi('Failing AI');
    const healthy = await seedAi('Healthy AI');
    const at = ago(60_000);
    await addEvent(failing, 'error', at, { kind: 'budget' });

    const decorated = await withLastFailures(context.db, [
      { id: failing, name: 'Failing AI' },
      { id: healthy, name: 'Healthy AI' },
    ]);

    expect(decorated.find((ai) => ai.id === failing)?.lastFailure).toEqual({
      kind: 'budget',
      at,
    });
    expect(decorated.find((ai) => ai.id === healthy)?.lastFailure).toBeNull();
  });
});
