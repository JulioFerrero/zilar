// The AI-memory case of the contract drift detector (T-0893): the client
// derived from `@zilar/api-contract` runs against the real app.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../../contract-smoke-support';
import { bootstrapUser, expectedJid, testSql, TEST_XMPP_DOMAIN } from '../../test-support';

describe('api contract smoke: ai-memory (T-0893)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function seedAiWithFact(ownerId: string): Promise<{ aiId: string; jid: string }> {
    const connectionId = randomUUID();
    const aiId = randomUUID();
    const localpart = `ai-${aiId}`;
    const jid = `${localpart}@${TEST_XMPP_DOMAIN}`;
    await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections ${sql.insert({
          id: connectionId,
          owner: ownerId,
          provider: 'openai',
          encrypted_key: 'not-a-real-key',
          label: null,
        })}`;
        yield* sql`INSERT INTO ais ${sql.insert({
          id: aiId,
          owner: ownerId,
          name: 'Helper',
          template: 'dev',
          persona: 'A persona',
          provider_connection_id: connectionId,
          model: 'gpt-4o-mini',
          localpart,
          jid,
          status: 'active',
        })}`;
        yield* sql`INSERT INTO ai_memory_facts ${sql.insert({
          id: randomUUID(),
          ai_id: aiId,
          chat_key: `dm:${expectedJid(ownerId).toLowerCase()}`,
          text: 'likes tea',
        })}`;
      }),
    );
    return { aiId, jid };
  }

  it('views, forgets and clears memory through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { aiId, jid } = await seedAiWithFact(owner.id);
    const web = harness.cookieClient(owner.cookie);
    const query = { chat: jid, ai: aiId };

    const view = await runApi(web.aiMemory.view({ query }));
    expect(view.canChange).toBe(true);
    expect(view.facts.map((fact) => fact.text)).toEqual(['likes tea']);

    const forgotten = await runApi(
      web.aiMemory.deleteFact({ params: { id: view.facts[0]?.id ?? '' }, query }),
    );
    expect(forgotten).toEqual({ ok: true });
    const cleared = await runApi(web.aiMemory.clear({ payload: query }));
    expect(cleared).toEqual({ ok: true });
    expect((await runApi(web.aiMemory.view({ query }))).facts).toEqual([]);
  });

  it('maps an unknown fact, an unknown AI and a missing session to their envelopes', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { aiId, jid } = await seedAiWithFact(owner.id);
    const web = harness.cookieClient(owner.cookie);

    const noFact = await runApi(
      web.aiMemory.deleteFact({ params: { id: 'nope' }, query: { chat: jid, ai: aiId } }),
    ).catch((error: unknown) => error);
    expect(noFact).toBeInstanceOf(ApiError);
    expect(noFact).toMatchObject({ status: 404, code: 'not_found' });

    const noAi = await runApi(web.aiMemory.view({ query: { chat: jid, ai: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(noAi).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(
      harness.cookieClient('').aiMemory.view({ query: { chat: jid, ai: aiId } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
