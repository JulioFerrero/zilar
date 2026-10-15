import { describe, expect, it, vi } from 'vitest';

import type { Connection } from '@/lib/ais-api';

import { providerSelection } from './use-key-check';

// The hook's API clients read route params; `providerSelection` never does.
vi.mock('expo-router', () => ({
  useGlobalSearchParams: () => ({}),
}));

const EMPTY = { connectionId: null, created: false, verified: false } as const;

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
