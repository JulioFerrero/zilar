// The topics case of the contract drift detector (T-0892): the client derived
// from `@zilar/api-contract` runs against the real app. A route whose status
// or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf, TEST_BASE_URL } from '../test-support';

describe('api contract smoke: topics (T-0892)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function groupOf(cookie: string, memberIds: string[]): Promise<string> {
    const response = await harness.app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Team', memberIds }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it('creates, lists, patches, reads members and archives a topic through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const groupId = await groupOf(owner.cookie, [member.id]);
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(member.bearer);

    const created = await runApi(
      web.topics.create({
        params: { id: groupId },
        payload: {
          name: 'Checkout bug',
          kind: 'bug',
          linkUrl: 'https://example.com/pr/42',
          linkLabel: 'PR #42',
        },
      }),
    );
    expect(created).toMatchObject({
      name: 'Checkout bug',
      kind: 'bug',
      status: 'open',
      visibility: 'public',
      isGeneral: false,
    });

    const listed = await runApi(mobile.topics.list({ params: { id: groupId } }));
    expect(listed.topics.map((topic) => topic.id)).toContain(created.id);

    const patched = await runApi(
      web.topics.patch({ params: { id: created.id }, payload: { status: 'in_progress' } }),
    );
    expect(patched.status).toBe('in_progress');

    const detail = await runApi(mobile.topics.detail({ params: { id: created.id } }));
    expect(detail.id).toBe(created.id);

    const members = await runApi(mobile.topics.members({ params: { id: created.id } }));
    expect(members.members.map((entry) => entry.userId)).toContain(member.id);

    const ais = await runApi(web.topics.listAis({ params: { id: created.id } }));
    expect(ais.ais).toEqual([]);

    const archived = await runApi(web.topics.archive({ params: { id: created.id } }));
    expect(archived.archived).toBe(true);
  });

  it('maps an unknown topic, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const groupId = await groupOf(owner.cookie, []);
    const web = harness.cookieClient(owner.cookie);

    const unknown = await runApi(web.topics.detail({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(unknown).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(
      harness.cookieClient('').topics.list({ params: { id: groupId } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(
      web.topics.create({
        params: { id: groupId },
        payload: {
          name: 'X',
          linkUrl: 'http://insecure.example.com',
          linkLabel: 'Insecure',
        },
      }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
