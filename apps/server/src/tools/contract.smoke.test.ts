// The tools case of the contract drift detector (T-0893): the client derived
// from `@zilar/api-contract` runs against the real app. The shared app has no
// tool runner, so a run answers 501 `runner_unavailable`.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, testSql, TEST_XMPP_DOMAIN } from '../test-support';
import { saveToolVersion } from './service';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('api contract smoke: tools (T-0893)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function seedAiWithTool(ownerId: string): Promise<{ aiId: string; toolId: string }> {
    const connectionId = randomUUID();
    const aiId = randomUUID();
    const localpart = `ai-${aiId}`;
    await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key) VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${'sealed-placeholder'})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status) VALUES (${aiId}, ${ownerId}, ${'Helper AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${localpart}, ${`${localpart}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
    const base = {
      aiId,
      groupId: null,
      topicId: null,
      name: 'morning-prices',
      description: 'Posts the price of gold',
      hosts: ['api.example.com'],
      userId: ownerId,
    };
    await saveToolVersion(
      harness.context.db,
      { ...base, source: 'return { text: "gold 3000" };', message: 'First version' },
      NOW,
    );
    const { tool } = await saveToolVersion(
      harness.context.db,
      { ...base, source: 'return { text: "gold 3100" };', message: 'Second version' },
      NOW,
    );
    return { aiId, toolId: tool.id };
  }

  it('lists, reads, reverts and deletes a tool through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { aiId, toolId } = await seedAiWithTool(owner.id);
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);

    const listed = await runApi(web.tools.listForAi({ params: { id: aiId } }));
    expect(listed.map((tool) => tool.id)).toEqual([toolId]);
    expect(listed[0]).toMatchObject({ currentVersion: 2, hosts: ['api.example.com'] });

    const detail = await runApi(mobile.tools.detail({ params: { id: toolId } }));
    expect(detail.source).toBe('return { text: "gold 3100" };');
    const versions = await runApi(web.tools.versions({ params: { id: toolId } }));
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    const first = await runApi(web.tools.version({ params: { id: toolId, n: '1' } }));
    expect(first.source).toBe('return { text: "gold 3000" };');
    expect(await runApi(web.tools.runs({ params: { id: toolId } }))).toEqual([]);

    const reverted = await runApi(
      web.tools.revert({ params: { id: toolId }, payload: { version: 1 } }),
    );
    expect(reverted).toMatchObject({ version: 3, toolName: 'morning-prices' });

    await runApi(web.tools.remove({ params: { id: toolId } }));
    expect(await runApi(web.tools.listForAi({ params: { id: aiId } }))).toEqual([]);
  });

  it('maps an unknown tool, a missing runner and a missing session to their envelopes', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { toolId } = await seedAiWithTool(owner.id);
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(web.tools.detail({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const noRunner = await runApi(
      web.tools.run({ params: { id: toolId }, payload: { input: { a: 1 } } }),
    ).catch((error: unknown) => error);
    expect(noRunner).toMatchObject({ status: 501, code: 'runner_unavailable' });

    const anonymous = await runApi(
      harness.cookieClient('').tools.detail({ params: { id: toolId } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
