import {
  MachinesApiError,
  type Machine,
  type MachinesApi,
  type PairingCode,
} from '../../lib/machines-api';

/**
 * Mock machines API for `EXPO_PUBLIC_ZILAR_MOCK=1` or `?mock=<scenario>`.
 * It lives beside the hook (not in `src/mock/`) so T-0185 touches only its
 * allowed files; the pattern otherwise mirrors `components/contacts/contacts-mock.ts`.
 */

export type MachinesMockScenario = 'default' | 'empty' | 'error';

const CREATED_AT = '2026-10-03T10:00:00.000Z';

function seedMachine(overrides: Partial<Machine> & { id: string }): Machine {
  return {
    name: 'Machine',
    status: 'pending',
    os: 'macOS',
    osVersion: '15.0',
    arch: 'arm64',
    cpu: 'Apple M3',
    cores: 8,
    ramGb: 16,
    diskFreeGb: 120,
    drivers: [],
    fingerprint: `fp-${overrides.id}`,
    createdAt: CREATED_AT,
    approvedAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

export function machinesMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): MachinesMockScenario | null {
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

function normalizeScenario(value: string | undefined): MachinesMockScenario | null {
  switch (value) {
    case 'default':
    case 'empty':
    case 'error':
      return value;
    default:
      return null;
  }
}

function cloneMachine(machine: Machine): Machine {
  return { ...machine, drivers: [...machine.drivers] };
}

// Kept at module scope so mutations survive navigation between the screens.
const states = new Map<MachinesMockScenario, Machine[]>();

function stateFor(scenario: MachinesMockScenario): Machine[] {
  const existing = states.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const created =
    scenario === 'empty'
      ? []
      : [
          seedMachine({ id: 'm-pending', name: 'Laptop', status: 'pending' }),
          seedMachine({
            id: 'm-approved',
            name: 'Home server',
            status: 'approved',
            approvedAt: CREATED_AT,
            lastSeenAt: CREATED_AT,
          }),
          seedMachine({ id: 'm-revoked', name: 'Old box', status: 'revoked' }),
        ];
  states.set(scenario, created);
  return created;
}

let sequence = 0;

/**
 * Clears the per-scenario state and the id sequence. Tests call this between
 * cases so they do not depend on the order they run in.
 */
export function resetMachinesMock(): void {
  states.clear();
  sequence = 0;
}

/** A `MachinesApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockMachinesApi(scenario: MachinesMockScenario = 'default'): MachinesApi {
  const fail = (): never => {
    throw new MachinesApiError(500, 'internal_error', 'The server hit an unexpected error');
  };
  const state = stateFor(scenario);

  return {
    async listMachines() {
      if (scenario === 'error') fail();
      return state.map(cloneMachine);
    },
    async createPairingCode(): Promise<PairingCode> {
      if (scenario === 'error') fail();
      sequence += 1;
      return {
        code: `MOCK-${String(sequence).padStart(2, '0')}00-CODE`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
    },
    async approveMachine(id: string) {
      if (scenario === 'error') fail();
      const existing = state.find((machine) => machine.id === id);
      if (existing === undefined) {
        throw new MachinesApiError(404, 'not_found', 'Machine not found');
      }
      const updated: Machine = { ...existing, status: 'approved', approvedAt: CREATED_AT };
      state[state.indexOf(existing)] = updated;
      return cloneMachine(updated);
    },
    async denyMachine(id: string) {
      if (scenario === 'error') fail();
      const index = state.findIndex((machine) => machine.id === id);
      if (index === -1) {
        throw new MachinesApiError(404, 'not_found', 'Machine not found');
      }
      state.splice(index, 1);
    },
    async revokeMachine(id: string) {
      if (scenario === 'error') fail();
      const existing = state.find((machine) => machine.id === id);
      if (existing === undefined) {
        throw new MachinesApiError(404, 'not_found', 'Machine not found');
      }
      const updated: Machine = { ...existing, status: 'revoked' };
      state[state.indexOf(existing)] = updated;
      return cloneMachine(updated);
    },
    async renameMachine(id: string, name: string) {
      if (scenario === 'error') fail();
      const existing = state.find((machine) => machine.id === id);
      if (existing === undefined) {
        throw new MachinesApiError(404, 'not_found', 'Machine not found');
      }
      const updated: Machine = { ...existing, name };
      state[state.indexOf(existing)] = updated;
      return cloneMachine(updated);
    },
    async deleteMachine(id: string) {
      if (scenario === 'error') fail();
      const existing = state.find((machine) => machine.id === id);
      if (existing === undefined) {
        throw new MachinesApiError(404, 'not_found', 'Machine not found');
      }
      if (existing.status === 'approved') {
        throw new MachinesApiError(409, 'revoke_first', 'Revoke the machine before deleting it');
      }
      state.splice(state.indexOf(existing), 1);
    },
    async setAiMachine(_aiId: string, machineId: string | null) {
      if (scenario === 'error') fail();
      return machineId;
    },
  };
}
