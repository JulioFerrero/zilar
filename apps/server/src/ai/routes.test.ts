import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  bootstrapUser,
  testApp,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { createAiRoutes, DEFAULT_VIRTUAL_KEY_POLICY } from './routes';
import type {
  GenerateVirtualKeyInput,
  LitellmAdminClient,
  VirtualKey,
  VirtualKeyInfo,
} from './litellm-client';

class FakeLitellmClient implements LitellmAdminClient {
  readonly generated: GenerateVirtualKeyInput[] = [];
  fail = false;

  async generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey> {
    this.generated.push(input);
    if (this.fail) {
      throw new Error('gateway down, master was sk-master-must-not-leak');
    }
    return {
      id: 'tok-1',
      key: 'sk-virtual-key-abc',
      keyAlias: 'ai-1',
      maxBudget: 1,
      spend: 0,
      models: ['placeholder'],
    };
  }

  getKeyInfo(): Promise<VirtualKeyInfo> {
    throw new Error('not used in this test');
  }

  updateKey(): Promise<VirtualKeyInfo> {
    throw new Error('not used in this test');
  }

  revokeKey(): Promise<void> {
    throw new Error('not used in this test');
  }
}

describe('POST /api/ai/virtual-keys', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('returns only the virtual key string and its id', async () => {
    const litellm = new FakeLitellmClient();
    const app = testApp(context);
    app.route('/api', createAiRoutes({ auth: context.auth, litellm, logger: silentLogger() }));

    const user = await bootstrapUser(context, app, `keys${testCounter}@example.com`);
    const response = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['placeholder'] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['id', 'key']);
    expect(body).toEqual({ id: 'tok-1', key: 'sk-virtual-key-abc' });

    expect(litellm.generated).toEqual([
      {
        models: ['placeholder'],
        maxBudget: DEFAULT_VIRTUAL_KEY_POLICY.maxBudget,
        budgetDuration: DEFAULT_VIRTUAL_KEY_POLICY.budgetDuration,
        tpmLimit: DEFAULT_VIRTUAL_KEY_POLICY.tpmLimit,
        rpmLimit: DEFAULT_VIRTUAL_KEY_POLICY.rpmLimit,
      },
    ]);
  });

  it('applies the server policy cap when the caller sets nothing', async () => {
    const litellm = new FakeLitellmClient();
    const app = testApp(context);
    app.route('/api', createAiRoutes({ auth: context.auth, litellm, logger: silentLogger() }));
    const user = await bootstrapUser(context, app, `policy${testCounter}@example.com`);

    const response = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['placeholder'] }),
    });

    expect(response.status).toBe(200);
    expect(litellm.generated).toHaveLength(1);
    expect(litellm.generated[0]!.maxBudget).toBe(DEFAULT_VIRTUAL_KEY_POLICY.maxBudget);
  });

  it('rejects a caller that tries to set its own budget or rate limits', async () => {
    const litellm = new FakeLitellmClient();
    const policy = { maxBudget: 0.5, budgetDuration: '1d', tpmLimit: 200, rpmLimit: 20 };
    const app = testApp(context);
    app.route(
      '/api',
      createAiRoutes({ auth: context.auth, litellm, logger: silentLogger(), policy }),
    );
    const user = await bootstrapUser(context, app, `widen${testCounter}@example.com`);

    for (const body of [
      { models: ['placeholder'], maxBudget: 1000 },
      { models: ['placeholder'], tpmLimit: 1_000_000 },
      { models: ['placeholder'], rpmLimit: 1_000_000 },
      { models: ['placeholder'], budgetDuration: '365d' },
    ]) {
      const response = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
        method: 'POST',
        headers: { cookie: user.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }

    expect(litellm.generated).toHaveLength(0);

    const allowed = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['placeholder'] }),
    });
    expect(allowed.status).toBe(200);
    expect(litellm.generated).toEqual([
      {
        models: ['placeholder'],
        maxBudget: 0.5,
        budgetDuration: '1d',
        tpmLimit: 200,
        rpmLimit: 20,
      },
    ]);
  });

  it('requires a signed-in user', async () => {
    const app = testApp(context);
    app.route(
      '/api',
      createAiRoutes({
        auth: context.auth,
        litellm: new FakeLitellmClient(),
        logger: silentLogger(),
      }),
    );

    const response = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['placeholder'] }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects an invalid request body', async () => {
    const litellm = new FakeLitellmClient();
    const app = testApp(context);
    app.route('/api', createAiRoutes({ auth: context.auth, litellm, logger: silentLogger() }));
    const user = await bootstrapUser(context, app, `bad${testCounter}@example.com`);

    const response = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ models: [] }),
    });

    expect(response.status).toBe(400);
    expect(litellm.generated).toHaveLength(0);
  });

  it('does not leak gateway details when issuing a key fails', async () => {
    const litellm = new FakeLitellmClient();
    litellm.fail = true;
    const logs: Array<Record<string, unknown>> = [];
    const logger = { warn: (fields: Record<string, unknown>) => logs.push(fields) };
    const app = testApp(context);
    app.route('/api', createAiRoutes({ auth: context.auth, litellm, logger }));
    const user = await bootstrapUser(context, app, `boom${testCounter}@example.com`);

    const response = await app.request(`${TEST_BASE_URL}/api/ai/virtual-keys`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['placeholder'] }),
    });

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('sk-master-must-not-leak');
    expect(text).not.toContain('gateway down');
    expect(logs).toHaveLength(1);
  });
});

function silentLogger(): { warn: () => void } {
  return { warn: () => undefined };
}
