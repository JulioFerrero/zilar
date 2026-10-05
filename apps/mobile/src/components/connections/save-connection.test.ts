import { describe, expect, it } from 'vitest';

import { ConnectionsApiError, type ConnectionsApi } from '@/lib/connections-api';
import { keyAfterSave, saveConnection } from './save-connection';

// The key the test itself "types" into the form: every assertion below can
// fail on this exact string, so a leak is always caught.
const TYPED_KEY = 'zilar-test-typed-key-7f3a9c2e5b184d6f';

const CREATED = {
  id: 'conn-1',
  provider: 'openai',
  label: null as string | null,
  status: 'active',
  createdAt: '2026-10-04T00:00:00.000Z',
};

function fakeApi(createConnection: ConnectionsApi['createConnection']): ConnectionsApi {
  return {
    listConnections: () => Promise.resolve([]),
    createConnection,
    testConnection: () => Promise.resolve({ ok: true }),
    deleteConnection: () => Promise.resolve(),
  };
}

describe('saveConnection', () => {
  it('sends the typed key in the POST body', async () => {
    const seen: string[] = [];
    const api = fakeApi(async (input) => {
      seen.push(input.key);
      return { ...CREATED };
    });

    const outcome = await saveConnection(api, { provider: 'openai', key: TYPED_KEY, label: '' });
    expect(seen).toEqual([TYPED_KEY]);
    expect(outcome.connection).toMatchObject({ id: 'conn-1' });
    expect(outcome.error).toBe('');
  });

  it('answers a fixed sentence, without the key, on failure', async () => {
    const api = fakeApi(async () => {
      throw new ConnectionsApiError(400, 'invalid_request', `rejected key ${TYPED_KEY}`);
    });

    const outcome = await saveConnection(api, { provider: 'openai', key: TYPED_KEY, label: '' });
    expect(outcome.connection).toBeNull();
    expect(outcome.error).toBe('Could not save the connection.');
    expect(outcome.error).not.toContain(TYPED_KEY);
  });
});

describe('saveConnection key clearing', () => {
  it('empties the field after success, so the key appears nowhere after saving', async () => {
    const api = fakeApi(async () => ({ ...CREATED }));
    const outcome = await saveConnection(api, { provider: 'openai', key: TYPED_KEY, label: '' });

    // The exact transition the form's submit handler runs.
    expect(keyAfterSave(outcome, TYPED_KEY)).toBe('');
    // The created connection carries no key field back.
    expect('key' in (outcome.connection ?? {})).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(TYPED_KEY);
  });

  it('keeps the typed key for retry, outside error text, after failure', async () => {
    const api = fakeApi(async () => {
      throw new ConnectionsApiError(400, 'invalid_request', `rejected key ${TYPED_KEY}`);
    });
    const outcome = await saveConnection(api, { provider: 'openai', key: TYPED_KEY, label: '' });

    // The field keeps the key so the user can retry…
    expect(keyAfterSave(outcome, TYPED_KEY)).toBe(TYPED_KEY);
    // …but the shown error never repeats it.
    expect(outcome.error).not.toContain(TYPED_KEY);
  });
});
