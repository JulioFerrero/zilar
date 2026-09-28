import { describe, expect, it } from 'vitest';
import {
  createLitellmAdminClient,
  createLitellmAdminClientFromConfig,
  LitellmApiError,
  redactSecrets,
  type FetchLike,
  type LitellmClientConfig,
} from './litellm-client';

const config: LitellmClientConfig = {
  baseUrl: 'http://litellm.test:4000',
  masterKey: 'sk-master-secret-0000000000',
};

type Call = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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
