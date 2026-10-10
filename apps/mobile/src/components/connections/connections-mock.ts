import {
  ConnectionsApiError,
  type ConnectionsApi,
  type CreateConnectionInput,
  type ProviderConnection,
} from '../../lib/connections-api';

/**
 * Mock connections API for `EXPO_PUBLIC_ZILAR_MOCK=1` or `?mock=<scenario>`.
 * It lives beside the hook (not in `src/mock/`) so T-0185 touches only its
 * allowed files; the pattern otherwise mirrors `components/contacts/contacts-mock.ts`.
 *
 * The key is write-only, exactly like the server: `createConnection`
 * records the label but drops the key the moment the row is built.
 */

export type ConnectionsMockScenario = 'default' | 'empty' | 'error';

const CREATED_AT = '2026-10-03T10:00:00.000Z';

export function connectionsMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): ConnectionsMockScenario | null {
  const rawParam = params?.['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : env['EXPO_PUBLIC_ZILAR_MOCK'];
  if (requested === undefined || requested === '' || requested === '0') {
    return null;
  }
  if (requested === '1') {
    return normalizeScenario(env['EXPO_PUBLIC_ZILAR_MOCK_SCENARIO']) ?? 'default';
  }
  return normalizeScenario(requested);
}

function normalizeScenario(value: string | undefined): ConnectionsMockScenario | null {
  switch (value) {
    case 'default':
    case 'empty':
    case 'error':
      return value;
    default:
      return null;
  }
}

function seedConnection(
  overrides: Partial<ProviderConnection> & { id: string },
): ProviderConnection {
  return {
    provider: 'openai',
    label: null,
    status: 'active',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function cloneConnection(connection: ProviderConnection): ProviderConnection {
  return { ...connection };
}

// Kept at module scope so mutations survive navigation between the screens.
const states = new Map<ConnectionsMockScenario, ProviderConnection[]>();

function stateFor(scenario: ConnectionsMockScenario): ProviderConnection[] {
  const existing = states.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const created =
    scenario === 'empty'
      ? []
      : [
          seedConnection({ id: 'conn-openai', provider: 'openai', label: 'Work' }),
          seedConnection({ id: 'conn-anthropic', provider: 'anthropic', label: 'Personal' }),
        ];
  states.set(scenario, created);
  return created;
}

let sequence = 0;

/** A `ConnectionsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockConnectionsApi(
  scenario: ConnectionsMockScenario = 'default',
): ConnectionsApi {
  const fail = (): never => {
    throw new ConnectionsApiError(500, 'internal_error', 'The server hit an unexpected error');
  };
  const state = stateFor(scenario);

  return {
    async listConnections() {
      if (scenario === 'error') fail();
      return state.map(cloneConnection);
    },
    async createConnection(input: CreateConnectionInput) {
      if (scenario === 'error') fail();
      sequence += 1;
      const created: ProviderConnection = {
        id: `conn-mock-${sequence}`,
        provider: input.provider,
        label: input.label ?? null,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      state.unshift(created);
      return cloneConnection(created);
    },
    async testConnection(id: string) {
      if (scenario === 'error') fail();
      const existing = state.find((connection) => connection.id === id);
      if (existing === undefined) {
        throw new ConnectionsApiError(404, 'not_found', 'Connection not found');
      }
      return { ok: true };
    },
    async deleteConnection(id: string) {
      if (scenario === 'error') fail();
      const index = state.findIndex((connection) => connection.id === id);
      if (index === -1) {
        throw new ConnectionsApiError(404, 'not_found', 'Connection not found');
      }
      state.splice(index, 1);
    },
  };
}
