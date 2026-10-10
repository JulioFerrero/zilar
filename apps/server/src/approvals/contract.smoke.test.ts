// The approvals case of the contract drift detector (T-0893): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.

import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, testSql, TEST_XMPP_DOMAIN } from '../test-support';
import { createApproval } from './service';

describe('api contract smoke: approvals (T-0893)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function seedAiWithApproval(ownerId: string): Promise<{ aiId: string; id: string }> {
    const connectionId = randomUUID();
    const aiId = randomUUID();
    const localpart = `ai-${aiId}`;
    await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label) VALUES (${connectionId}, ${ownerId}, 'openai', 'sealed-placeholder', NULL)`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status) VALUES (${aiId}, ${ownerId}, 'Helper AI', 'dev', 'A persona', ${connectionId}, 'gpt-4o-mini', ${localpart}, ${`${localpart}@${TEST_XMPP_DOMAIN}`}, 'active')`;
      }),
    );
    const now = new Date();
    const created = await createApproval(
      harness.context.db,
      {
        aiId,
        action: 'send',
        summary: 'Send the report',
        argsHash: randomBytes(32).toString('hex'),
        requestedBy: `${localpart}@${TEST_XMPP_DOMAIN}`,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    return { aiId, id: created.id };
  }

  it('lists, reads, decides and lists rules through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const { aiId, id } = await seedAiWithApproval(owner.id);
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);

    const listed = await runApi(web.approvals.list());
    expect(listed.map((row) => row.id)).toEqual([id]);
    const detail = await runApi(mobile.approvals.detail({ params: { id } }));
    expect(detail).toMatchObject({ id, status: 'pending', summary: 'Send the report' });
    expect(typeof detail.expiresAt).toBe('string');

    const decided = await runApi(
      web.approvals.decide({ params: { id }, payload: { decision: 'deny', note: 'no' } }),
    );
    expect(decided).toMatchObject({ id, status: 'denied', note: 'no' });
    expect(typeof decided.decidedAt).toBe('string');

    expect(await runApi(web.approvals.aiRules({ params: { id: aiId } }))).toEqual([]);
  });

  it('maps an unknown approval, a bad decision and a missing session to their envelopes', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(web.approvals.detail({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const noRule = await runApi(web.approvals.revokeRule({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(noRule).toMatchObject({ status: 404, code: 'not_found' });

    const before = harness.requestCount();
    const invalid = await runApi(
      web.approvals.decide({
        params: { id: 'nope' },
        payload: { decision: 'maybe' as 'deny' },
      }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);

    const anonymous = await runApi(harness.cookieClient('').approvals.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
