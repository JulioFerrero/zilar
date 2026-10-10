import { describe, expect, it } from 'vitest';
import {
  createLitellmAdminClient,
  createLitellmAdminClientFromConfig,
  LitellmApiError,
  redactSecrets,
  type FetchLike,
  type LitellmClientConfig,
} from './litellm-client';
import { jsonResponse } from '../test-support/wait';

const config: LitellmClientConfig = {
  baseUrl: 'http://litellm.test:4000',
  masterKey: 'sk-master-secret-0000000000',
};

type Call = { url: string; init: RequestInit };

function createFetch(handler: (call: Call) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetchImpl, calls };
}

function headerOf(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe('createLitellmAdminClient', () => {
  it('generates a key with a hard budget and the limits the proxy supports', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        key: 'sk-virtual-key-1111',
        token_id: 'tok-1',
        key_alias: 'ai-1',
        max_budget: 5,
        spend: 0,
        models: ['placeholder'],
      }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(
      client.generateKey({
        models: ['placeholder'],
        maxBudget: 5,
        budgetDuration: '30d',
        tpmLimit: 1000,
        rpmLimit: 100,
        keyAlias: 'ai-1',
      }),
    ).resolves.toEqual({
      id: 'tok-1',
      key: 'sk-virtual-key-1111',
      keyAlias: 'ai-1',
      maxBudget: 5,
      spend: 0,
      models: ['placeholder'],
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('http://litellm.test:4000/key/generate');
    expect(call.init.method).toBe('POST');
    expect(headerOf(call, 'authorization')).toBe(`Bearer ${config.masterKey}`);
    expect(headerOf(call, 'content-type')).toBe('application/json');
    expect(bodyOf(call)).toEqual({
      models: ['placeholder'],
      max_budget: 5,
      budget_duration: '30d',
      tpm_limit: 1000,
      rpm_limit: 100,
      key_alias: 'ai-1',
    });
  });

  it('sends the master key only in the authorization header', async () => {
    const { fetchImpl, calls } = createFetch((call) => {
      if (call.url.includes('/key/generate')) {
        return jsonResponse({ key: 'sk-virtual-key-2222', token_id: 'tok-2' });
      }
      if (call.url.includes('/key/info')) {
        return jsonResponse({ info: { spend: 0, max_budget: 2 } });
      }
      if (call.url.includes('/key/update')) {
        return jsonResponse({ spend: 0, max_budget: 2 });
      }
      return jsonResponse({ deleted_keys: ['sk-virtual-key-2222'] });
    });
    const client = createLitellmAdminClient(config, fetchImpl);

    await client.generateKey({ models: ['placeholder'], keyAlias: 'ai-2' });
    await client.getKeyInfo('sk-virtual-key-2222');
    await client.updateKey({ key: 'sk-virtual-key-2222', maxBudget: 2 });
    await client.revokeKey('sk-virtual-key-2222');

    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(headerOf(call, 'authorization')).toBe(`Bearer ${config.masterKey}`);

      const otherHeaders = [...new Headers(call.init.headers)].filter(
        ([name]) => name.toLowerCase() !== 'authorization',
      );
      const exposed = JSON.stringify({
        url: call.url,
        body: call.init.body === undefined ? '' : String(call.init.body),
        headers: otherHeaders,
      });
      expect(exposed).not.toContain(config.masterKey);
    }
  });

  it('reads a key with the key in the query, not the body', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        key: 'sk-virtual-key-3333',
        info: {
          key_alias: 'ai-3',
          spend: 1.5,
          max_budget: 2,
          tpm_limit: 500,
          rpm_limit: 50,
          blocked: false,
          models: ['placeholder'],
        },
      }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.getKeyInfo('sk-virtual-key-3333')).resolves.toEqual({
      keyAlias: 'ai-3',
      maxBudget: 2,
      spend: 1.5,
      tpmLimit: 500,
      rpmLimit: 50,
      blocked: false,
      models: ['placeholder'],
    });

    const call = calls[0]!;
    expect(call.url).toBe('http://litellm.test:4000/key/info?key=sk-virtual-key-3333');
    expect(call.init.method).toBe('GET');
    expect(call.init.body).toBeUndefined();
  });

  it('updates the cap and the limits', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ key_alias: 'ai-4', spend: 0, max_budget: 0.25, tpm_limit: 10 }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(
      client.updateKey({
        key: 'sk-virtual-key-4444',
        maxBudget: 0.25,
        tpmLimit: 10,
        blocked: true,
      }),
    ).resolves.toMatchObject({ maxBudget: 0.25, tpmLimit: 10 });

    expect(bodyOf(calls[0]!)).toEqual({
      key: 'sk-virtual-key-4444',
      max_budget: 0.25,
      tpm_limit: 10,
      blocked: true,
    });
  });

  it('revokes a key', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ deleted_keys: ['sk-virtual-key-5555'] }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.revokeKey('sk-virtual-key-5555')).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('http://litellm.test:4000/key/delete');
    expect(bodyOf(calls[0]!)).toEqual({ keys: ['sk-virtual-key-5555'] });
  });

  it('fails when the proxy reports it deleted nothing', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ deleted_keys: [] }));
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.revokeKey('sk-virtual-key-6666')).rejects.toBeInstanceOf(LitellmApiError);
  });

  it('treats deleting an already-deleted key as success', async () => {
    // The exact shape the live gateway returns for a double delete
    // (verified 2026-09-28, by key and by token id alike).
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse(
        {
          error: {
            message: "{'error': 'No keys found'}",
            type: 'internal_server_error',
            param: null,
            code: '404',
          },
        },
        404,
      ),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.revokeKey('tok-already-gone')).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('http://litellm.test:4000/key/delete');
  });

  it('still fails a key delete that is not the already-gone case', async () => {
    for (const [status, body] of [
      [404, { error: { message: 'something else went wrong' } }],
      [500, { error: { message: 'No keys found' } }],
      [500, { error: { message: 'database is down' } }],
    ] as const) {
      const { fetchImpl } = createFetch(() => jsonResponse(body, status));
      const client = createLitellmAdminClient(config, fetchImpl);
      await expect(client.revokeKey('tok-1')).rejects.toBeInstanceOf(LitellmApiError);
    }
  });

  it('rejects invalid inputs before any request', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.generateKey({ models: [] })).rejects.toThrow();
    await expect(client.generateKey({ models: ['placeholder'], maxBudget: -1 })).rejects.toThrow();
    await expect(client.generateKey({ models: ['placeholder'], tpmLimit: 1.5 })).rejects.toThrow();
    await expect(client.getKeyInfo('')).rejects.toThrow();
    await expect(client.updateKey({ key: '', maxBudget: 1 })).rejects.toThrow();
    await expect(client.revokeKey('')).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });

  it('maps a non-2xx error without leaking the master key or a provider key', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse(
        {
          error: {
            message: `bad request sk-provider-key-abcd1234 ${config.masterKey}`,
          },
        },
        400,
      ),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    const error = await client.generateKey({ models: ['placeholder'] }).catch((c: unknown) => c);
    expect(error).toBeInstanceOf(LitellmApiError);
    const apiError = error as LitellmApiError;
    expect(apiError.operation).toBe('key/generate');
    expect(apiError.status).toBe(400);
    expect(apiError.message).toContain('bad request');
    expect(apiError.message).not.toContain(config.masterKey);
    expect(apiError.message).not.toContain('sk-provider-key-abcd1234');
    expect(apiError.message).toContain('sk-***');
  });

  it('treats a 200 response that carries an error body as a failure', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { message: 'key not found', type: 'not_found' } }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.getKeyInfo('sk-virtual-key-7777')).rejects.toBeInstanceOf(LitellmApiError);
  });

  it('wraps a network failure and redacts its message', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.reject(new Error(`connect ECONNREFUSED with ${config.masterKey}`));
    const client = createLitellmAdminClient(config, fetchImpl);

    const error = await client.getKeyInfo('sk-virtual-key-8888').catch((c: unknown) => c);
    expect(error).toBeInstanceOf(LitellmApiError);
    expect((error as LitellmApiError).status).toBe(0);
    expect((error as LitellmApiError).message).toContain('ECONNREFUSED');
    expect((error as LitellmApiError).message).not.toContain(config.masterKey);
  });

  it('rejects an unexpected response shape without echoing it', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ unexpected: 'sk-should-not-appear' }));
    const client = createLitellmAdminClient(config, fetchImpl);

    const error = await client.generateKey({ models: ['placeholder'] }).catch((c: unknown) => c);
    expect(error).toBeInstanceOf(LitellmApiError);
    expect((error as LitellmApiError).message).toBe(
      'LiteLLM "key/generate" failed with HTTP 200: unexpected response shape',
    );
  });
});

describe('createLitellmAdminClient model management', () => {
  const providerKey = 'sk-provider-key-do-not-leak-1234';

  it('registers a private model and returns its id', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        model_id: 'model-1',
        model_name: 'ai-abc',
        litellm_params: { model: 'openai/gpt-4o-mini' },
        model_info: { ai_id: 'abc' },
      }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(
      client.addModel({
        modelName: 'ai-abc',
        litellmModel: 'openai/gpt-4o-mini',
        apiKey: providerKey,
        metadata: { ai_id: 'abc' },
      }),
    ).resolves.toBe('model-1');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('http://litellm.test:4000/model/new');
    expect(call.init.method).toBe('POST');
    expect(headerOf(call, 'authorization')).toBe(`Bearer ${config.masterKey}`);
    expect(bodyOf(call)).toEqual({
      model_name: 'ai-abc',
      litellm_params: { model: 'openai/gpt-4o-mini', api_key: providerKey },
      model_info: { ai_id: 'abc' },
    });
    expect(JSON.stringify([...new Headers(call.init.headers)])).not.toContain(providerKey);
  });

  it('accepts a model id nested under model_info', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ model_info: { id: 'model-2' } }));
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(
      client.addModel({
        modelName: 'ai-x',
        litellmModel: 'openai/gpt-4o-mini',
        apiKey: providerKey,
      }),
    ).resolves.toBe('model-2');
  });

  it('never leaks the provider key when /model/new errors echo it back', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse(
        {
          error: {
            message: `bad model: api_key=${providerKey} master=${config.masterKey}`,
          },
        },
        400,
      ),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    const error = await client
      .addModel({ modelName: 'ai-x', litellmModel: 'openai/gpt-4o-mini', apiKey: providerKey })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(LitellmApiError);
    const apiError = error as LitellmApiError;
    expect(apiError.operation).toBe('model/new');
    expect(apiError.status).toBe(400);
    expect(apiError.message).not.toContain(providerKey);
    expect(apiError.message).not.toContain(config.masterKey);
    expect(apiError.message).toContain('[redacted]');
  });

  it('rejects a /model/new response with no model id without echoing it', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ unexpected: providerKey }));
    const client = createLitellmAdminClient(config, fetchImpl);

    const error = await client
      .addModel({ modelName: 'ai-x', litellmModel: 'openai/gpt-4o-mini', apiKey: providerKey })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(LitellmApiError);
    expect((error as LitellmApiError).message).toBe(
      'LiteLLM "model/new" failed with HTTP 200: unexpected response shape',
    );
  });

  it('deletes a registered model by id', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ message: 'Model: model-1 deleted successfully' }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.deleteModel('model-1')).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('http://litellm.test:4000/model/delete');
    expect(bodyOf(calls[0]!)).toEqual({ id: 'model-1' });
  });

  it('treats an already-gone model as a successful delete', async () => {
    for (const status of [400, 404]) {
      const { fetchImpl } = createFetch(() =>
        jsonResponse({ error: { message: 'Model with id=model-1 not found in db' } }, status),
      );
      const client = createLitellmAdminClient(config, fetchImpl);
      await expect(client.deleteModel('model-1')).resolves.toBeUndefined();
    }
  });

  it('propagates a real model delete failure', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ error: { message: 'database is down' } }, 500),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.deleteModel('model-1')).rejects.toBeInstanceOf(LitellmApiError);
  });

  it('updates a key allowlist through updateKey', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ spend: 0, models: ['ai-abc'] }));
    const client = createLitellmAdminClient(config, fetchImpl);

    await client.updateKey({ key: 'sk-virtual-key-0001', models: ['ai-abc'] });

    expect(bodyOf(calls[0]!)).toEqual({
      key: 'sk-virtual-key-0001',
      models: ['ai-abc'],
    });
  });

  it('rejects invalid model-management inputs before any request', async () => {
    const { fetchImpl, calls } = createFetch(() => jsonResponse({ model_id: 'x' }));
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(
      client.addModel({ modelName: 'Bad/Name', litellmModel: 'openai/gpt-4o-mini', apiKey: 'k' }),
    ).rejects.toThrow();
    await expect(
      client.addModel({ modelName: 'ai-x', litellmModel: 'not-a-provider-model', apiKey: 'k' }),
    ).rejects.toThrow();
    await expect(
      client.addModel({ modelName: 'ai-x', litellmModel: 'openai/gpt-4o-mini', apiKey: '' }),
    ).rejects.toThrow();
    await expect(client.deleteModel('')).rejects.toThrow();
    await expect(client.updateKey({ key: 'sk-x', models: [] })).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });

  it('lists the registered models with their ids and names', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({
        data: [
          { model_name: 'ai-abc', model_id: 'model-1', litellm_params: { model: 'openai/x' } },
          { model_name: 'gpt-4o-mini', model_id: 'model-2' },
        ],
      }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.listModels()).resolves.toEqual([
      { id: 'model-1', name: 'ai-abc' },
      { id: 'model-2', name: 'gpt-4o-mini' },
    ]);
    expect(calls[0]!.url).toBe('http://litellm.test:4000/model/info');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('skips model entries without an id or a name, and tolerates no data', async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({
        data: [
          { model_name: 'ai-abc' },
          { model_id: 'model-2' },
          {},
          { model_name: 'ai-nested', model_info: { id: 'model-3' } },
        ],
      }),
    );
    const client = createLitellmAdminClient(config, fetchImpl);
    await expect(client.listModels()).resolves.toEqual([{ id: 'model-3', name: 'ai-nested' }]);

    const empty = createFetch(() => jsonResponse({}));
    await expect(createLitellmAdminClient(config, empty.fetchImpl).listModels()).resolves.toEqual(
      [],
    );
  });

  it('rejects a model listing with an unexpected shape', async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ data: 'nope' }));
    const client = createLitellmAdminClient(config, fetchImpl);

    await expect(client.listModels()).rejects.toBeInstanceOf(LitellmApiError);
  });
});

describe('createLitellmAdminClientFromConfig', () => {
  it('uses the configured base URL, or the dev default when absent', () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ key: 'sk-virtual-key-9999', token_id: 'tok-9' }),
    );
    const fromConfig = createLitellmAdminClientFromConfig(
      { LITELLM_MASTER_KEY: config.masterKey },
      fetchImpl,
    );

    return fromConfig.generateKey({ models: ['placeholder'] }).then(() => {
      expect(calls[0]!.url).toBe('http://127.0.0.1:4000/key/generate');
    });
  });

  it('refuses to build a client when the master key is missing', () => {
    expect(() => createLitellmAdminClientFromConfig({})).toThrow('LITELLM_MASTER_KEY');
  });
});

describe('redactSecrets', () => {
  it('redacts named secrets and credential-shaped tokens', () => {
    expect(redactSecrets('value sk-secret-abcd1234 end', ['value'])).toBe('[redacted] sk-*** end');
  });
});
