// The connections case of the contract drift detector (T-0893): the client
// derived from `@zilar/api-contract` runs against the real app. The shared
// harness mounts the app without a key cipher, so this file builds its own
// app with a cipher and a fake provider probe (no request reaches a provider).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createApp } from '../app';
import { bootstrapUser, createTestContext, type TestContext } from '../test-support';
import { createKeyCipher } from './crypto';
import type { ProviderProbe } from './probe';
import { cookieClientFor } from './smoke-client';

const MASTER_KEY = 'test-master-key-0000000000000000000000';

const probe: ProviderProbe = {
  testKey: async () => ({ ok: false, message: 'The provider rejected the key' }),
};

describe('api contract smoke: connections (T-0893)', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    context = await createTestContext();
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      connections: { cipher: createKeyCipher(MASTER_KEY), probe },
    });
  });

  afterEach(async () => {
    await context.close();
  });

  const cookieClient = (cookie: string) => cookieClientFor(app, cookie);

  it('creates, lists, tests and deletes a connection through the derived client', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = cookieClient(owner.cookie);

    const created = await runApi(
      web.connections.create({
        payload: { provider: 'openai', key: 'sk-test-provider-key-1234567890', label: 'Work' },
      }),
    );
    expect(created).toMatchObject({ provider: 'openai', label: 'Work', status: 'active' });
    expect(JSON.stringify(created)).not.toContain('sk-test');

    const listed = await runApi(web.connections.list());
    expect(listed.map((row) => row.id)).toEqual([created.id]);

    const tested = await runApi(web.connections.test({ params: { id: created.id } }));
    expect(tested).toEqual({ ok: false, message: 'The provider rejected the key' });

    await runApi(web.connections.remove({ params: { id: created.id } }));
    expect(await runApi(web.connections.list())).toEqual([]);
  });

  it('maps an unknown connection and a missing session to their envelopes', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = cookieClient(owner.cookie);

    const missing = await runApi(web.connections.test({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(cookieClient('').connections.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
