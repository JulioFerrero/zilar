// The routines case of the contract drift detector (T-0893): the client
// derived from `@zilar/api-contract` runs against the real app.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, testSql, TEST_XMPP_DOMAIN } from '../test-support';
import { approveToolHosts, saveToolVersion } from '../tools/service';
import { createRoutine } from './service';

const NOW = new Date('2026-06-01T12:00:00Z');

describe('api contract smoke: routines (T-0893)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function seedRoutine(ownerId: string): Promise<{ aiId: string; routineId: string }> {
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
    const { tool } = await saveToolVersion(
      harness.context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        name: 'morning-prices',
        description: 'Posts the price of gold',
        source: 'return { text: "gold 3000" };',
        hosts: ['api.example.com'],
        message: 'First version',
        userId: ownerId,
      },
      NOW,
    );
    // Newly saved tools start with an empty approved set (T-0132).
    await approveToolHosts(
      harness.context.db,
      { toolId: tool.id, hosts: ['api.example.com'], userId: ownerId },
      NOW,
    );
    const routine = await createRoutine(
      harness.context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        toolId: tool.id,
        title: 'Morning prices',
        schedule: { kind: 'interval', everyMinutes: 60 },
        approvedHosts: ['api.example.com'],
        userId: ownerId,
      },
      NOW,
    );
    return { aiId, routineId: routine.id };
  }

  it('lists, pauses, resumes and deletes a routine through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { aiId, routineId } = await seedRoutine(owner.id);
    const web = harness.cookieClient(owner.cookie);

    const listed = await runApi(web.routines.listForAi({ params: { id: aiId } }));
    expect(listed.map((routine) => routine.id)).toEqual([routineId]);
    expect(listed[0]).toMatchObject({
      title: 'Morning prices',
      status: 'active',
      scope: 'personal',
    });
    expect(typeof listed[0]?.nextRunAt).toBe('string');

    const paused = await runApi(web.routines.pause({ params: { id: routineId } }));
    expect(paused).toMatchObject({ id: routineId, status: 'paused', pausedReason: 'user' });
    const resumed = await runApi(web.routines.resume({ params: { id: routineId } }));
    expect(resumed).toMatchObject({ id: routineId, status: 'active' });

    await runApi(web.routines.remove({ params: { id: routineId } }));
    expect(await runApi(web.routines.listForAi({ params: { id: aiId } }))).toEqual([]);
  });

  it('maps an unknown routine, an unknown AI and a missing session to their envelopes', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(web.routines.pause({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const noAi = await runApi(web.routines.listForAi({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(noAi).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(
      harness.cookieClient('').routines.listForAi({ params: { id: 'nope' } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
