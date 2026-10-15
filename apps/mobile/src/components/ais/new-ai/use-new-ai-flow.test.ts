import { describe, expect, it, vi } from 'vitest';

import type { KeyCheckApi } from '@zilar/chat-core';

import {
  discardCreatedKey,
  dropCreatedKey,
  keyCheckBaseState,
  keyStateAfterBaseUrlEdit,
  settleNewAiKeyCheck,
} from '@/components/ais/form';
import type { Connection } from '@/lib/ais-api';

import { providerSelection } from './use-new-ai-flow';

// The hook's API clients read route params; the wizard's own logic never does.
vi.mock('expo-router', () => ({
  useGlobalSearchParams: () => ({}),
}));

const EMPTY = { connectionId: null, created: false, verified: false } as const;

describe('keyCheckBaseState (T-1445)', () => {
  it('keeps a saved connection when no key is typed', () => {
    const saved = { connectionId: 'saved', created: false, verified: true };

    expect(keyCheckBaseState('', saved)).toBe(saved);
  });

  it('starts a fresh connection when a key is typed over a saved one', () => {
    const saved = { connectionId: 'saved', created: false, verified: true };

    expect(keyCheckBaseState('sk-typed', saved)).toEqual(EMPTY);
  });

  it('reuses the connection this flow created on a retry', () => {
    const mine = { connectionId: 'mine', created: true, verified: false };

    expect(keyCheckBaseState('sk-again', mine)).toBe(mine);
  });
});

describe('keyStateAfterBaseUrlEdit (T-1445)', () => {
  it('drops a verified check when its base URL is edited', () => {
    const verified = { connectionId: 'conn', created: true, verified: true };

    expect(keyStateAfterBaseUrlEdit(verified)).toEqual(EMPTY);
  });

  it('drops a verified saved connection too', () => {
    const saved = { connectionId: 'saved', created: false, verified: true };

    expect(keyStateAfterBaseUrlEdit(saved)).toEqual(EMPTY);
  });

  it('drops a failed check as well, so the edit ends in the empty state', () => {
    const failed = { connectionId: 'conn', created: true, verified: false };

    expect(keyStateAfterBaseUrlEdit(failed)).toEqual(EMPTY);
  });

  it('leaves the empty state as is', () => {
    expect(keyStateAfterBaseUrlEdit(EMPTY)).toBe(EMPTY);
  });
});

function fakeConnectionsApi(): { api: KeyCheckApi; deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    api: {
      createConnection: () => Promise.resolve({ id: 'created' }),
      testConnection: () => Promise.resolve({ ok: true }),
      replaceConnectionKey: () => Promise.resolve({ id: 'created' }),
      deleteConnection: (id: string) => {
        deleted.push(id);
        return Promise.resolve();
      },
    },
  };
}

describe('settleNewAiKeyCheck (T-1445)', () => {
  it('applies a check that is still the latest', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const mine = { connectionId: 'conn', created: true, verified: false };

    await expect(settleNewAiKeyCheck(api, 2, 2, mine)).resolves.toBe(true);
    expect(deleted).toEqual([]);
  });

  it('abandons a created-but-unverified connection when the flow moved on', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const mine = { connectionId: 'conn', created: true, verified: false };

    await expect(settleNewAiKeyCheck(api, 2, 3, mine)).resolves.toBe(false);
    expect(deleted).toEqual(['conn']);
  });

  it('deletes a stale verified result too', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const verified = { connectionId: 'conn', created: true, verified: true };

    await expect(settleNewAiKeyCheck(api, 2, 3, verified)).resolves.toBe(false);
    expect(deleted).toEqual(['conn']);
  });

  it('never deletes a saved connection', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const saved = { connectionId: 'saved', created: false, verified: false };

    await expect(settleNewAiKeyCheck(api, 2, 3, saved)).resolves.toBe(false);
    expect(deleted).toEqual([]);
  });
});

describe('discardCreatedKey (T-1445)', () => {
  it('deletes a verified flow-created key on close', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const verified = { connectionId: 'conn', created: true, verified: true };

    await discardCreatedKey(api, verified);

    expect(deleted).toEqual(['conn']);
  });

  it('never deletes a saved key', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const saved = { connectionId: 'saved', created: false, verified: true };

    await discardCreatedKey(api, saved);

    expect(deleted).toEqual([]);
  });
});

describe('dropCreatedKey (T-1445)', () => {
  it('deletes the flow-created connection on a Base URL edit', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const verified = { connectionId: 'conn', created: true, verified: true };

    await dropCreatedKey(api, verified);

    expect(deleted).toEqual(['conn']);
  });

  it('never deletes a connection this flow did not create', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const saved = { connectionId: 'saved', created: false, verified: true };

    await dropCreatedKey(api, saved);

    expect(deleted).toEqual([]);
  });

  it('leaves an unverified check alone', async () => {
    const { api, deleted } = fakeConnectionsApi();
    const failed = { connectionId: 'conn', created: true, verified: false };

    await dropCreatedKey(api, failed);

    expect(deleted).toEqual([]);
  });
});

function connection(id: string, provider: string, createdAt: string): Connection {
  return { id, provider, label: null, baseUrl: null, status: 'active', createdAt };
}

describe('providerSelection (T-1445)', () => {
  it('never preselects a saved OpenAI-compatible connection', () => {
    const connections = [connection('compat', 'openai-compatible', '2026-10-01T00:00:00.000Z')];

    expect(providerSelection(connections, 'openai-compatible')).toEqual({
      keyState: EMPTY,
      baseUrl: '',
      connectionName: '',
    });
  });

  it('keeps the newest saved connection for another provider', () => {
    const connections = [
      connection('old', 'deepseek', '2026-09-01T00:00:00.000Z'),
      connection('new', 'deepseek', '2026-10-01T00:00:00.000Z'),
    ];

    expect(providerSelection(connections, 'deepseek')).toEqual({
      keyState: { connectionId: 'new', created: false, verified: true },
      baseUrl: '',
      connectionName: '',
    });
  });
});
