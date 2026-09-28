import {
  AisApiError,
  type AiLimits,
  type AisApi,
  type Connection,
  type CreateAiInput,
  type PublicAi,
  type UpdateAiInput,
} from '../lib/ais-api';

/**
 * Mock AIs and connections for `EXPO_PUBLIC_GALENA_MOCK=1` or `?mock=<scenario>`.
 * The list screen mutates this state, so creating an AI in mock mode makes it
 * appear when you return to My AIs, without a server.
 */

export type AisMockScenario = 'default' | 'empty' | 'no-connections' | 'error' | 'unavailable';

const CREATED_AT = '2026-09-28T09:00:00.000Z';

export const mockConnections: readonly Connection[] = [
  {
    id: 'conn-openai',
    provider: 'openai',
    label: 'Work',
    status: 'active',
    createdAt: CREATED_AT,
  },
  {
    id: 'conn-anthropic',
    provider: 'anthropic',
    label: 'Personal',
    status: 'active',
    createdAt: CREATED_AT,
  },
  {
    id: 'conn-disabled',
    provider: 'google',
    label: 'Old key',
    status: 'disabled',
    createdAt: CREATED_AT,
  },
];

export const mockAis: readonly PublicAi[] = [
  {
    id: 'ai-dev-1',
    name: 'Dev-1',
    template: 'dev',
    persona: 'You are a concise senior engineer. Prefer small, reviewable changes.',
    model: 'gpt-4o',
    jid: 'ai-ai-dev-1@galena.test',
    status: 'active',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    createdAt: CREATED_AT,
  },
  {
    id: 'ai-marketing-1',
    name: 'Marketing AI',
    template: 'marketing',
    persona: 'You are a clear, friendly copywriter.',
    model: 'claude-sonnet-5',
    jid: 'ai-ai-marketing-1@galena.test',
    status: 'active',
    providerConnectionId: 'conn-anthropic',
    limits: { perDayUsd: 5, perMonthUsd: 50 },
    createdAt: CREATED_AT,
  },
  {
    id: 'ai-fun-1',
    name: 'Fun bot',
    template: 'fun',
    persona: 'You are a playful group-chat host.',
    model: 'gpt-4o-mini',
    jid: 'ai-ai-fun-1@galena.test',
    status: 'disabled',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: 1, perMonthUsd: 10 },
    createdAt: CREATED_AT,
  },
];

/**
 * Which mock scenario a session asked for, or null for the real API.
 * A `?mock=<scenario>` param wins over `EXPO_PUBLIC_GALENA_MOCK`; `1` means the
 * default scenario and can be narrowed by `EXPO_PUBLIC_GALENA_MOCK_SCENARIO`.
 * Any other unrecognized value means the real API: a stray `?mock=` (or
 * `EXPO_PUBLIC_GALENA_MOCK=false`) must never silently serve fake data.
 *
 * `paramAllowed` is the `mockParamAllowed` gate: in a production build with no
 * mock env the route param is ignored, while the `EXPO_PUBLIC_GALENA_MOCK` path
 * (the bundle-time opt-in) always works.
 */
export function aisMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): AisMockScenario | null {
  const rawParam = params?.['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : env['EXPO_PUBLIC_GALENA_MOCK'];
  if (requested === undefined || requested === '' || requested === '0') {
    return null;
  }
  if (requested === '1') {
    // `1` explicitly asks for mock mode, so an unrecognized narrowing still
    // runs the default scenario instead of the real API.
    return normalizeScenario(env['EXPO_PUBLIC_GALENA_MOCK_SCENARIO']) ?? 'default';
  }
  return normalizeScenario(requested);
}

function normalizeScenario(value: string | undefined): AisMockScenario | null {
  switch (value) {
    case 'default':
    case 'empty':
    case 'no-connections':
    case 'error':
    case 'unavailable':
      return value;
    default:
      return null;
  }
}

function cloneLimits(limits: AiLimits): AiLimits {
  return { perDayUsd: limits.perDayUsd, perMonthUsd: limits.perMonthUsd };
}

function cloneAi(ai: PublicAi): PublicAi {
  return { ...ai, limits: cloneLimits(ai.limits) };
}

// Kept at module scope so mutations survive navigation between the list, the
// wizard and the edit screen. One list per scenario, so opening the `empty`
// scenario never wipes the AIs the `default` scenario created.
const states = new Map<AisMockScenario, PublicAi[]>();

function stateFor(scenario: AisMockScenario): PublicAi[] {
  const existing = states.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const created = scenario === 'empty' ? [] : mockAis.map(cloneAi);
  states.set(scenario, created);
  return created;
}

let sequence = 0;

/**
 * Clears the per-scenario state and the id sequence. Tests call this between
 * cases so they do not depend on the order they run in.
 */
export function resetAisMock(): void {
  states.clear();
  sequence = 0;
}

/** An `AisApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockAisApi(scenario: AisMockScenario = 'default'): AisApi {
  const unavailable = (): never => {
    throw new AisApiError(503, 'ais_unavailable', 'AI management is not configured on this server');
  };
  const activeConnections = (): Connection[] =>
    mockConnections.filter((connection) => connection.status === 'active');
  const state = stateFor(scenario);

  return {
    async listAis() {
      if (scenario === 'unavailable') unavailable();
      if (scenario === 'error') {
        throw new AisApiError(500, 'internal_error', 'The server hit an unexpected error');
      }
      return state.map(cloneAi);
    },
    async createAi(input: CreateAiInput) {
      if (scenario === 'unavailable') unavailable();
      sequence += 1;
      const id = `ai-mock-${sequence}`;
      const created: PublicAi = {
        id,
        name: input.name,
        template: input.template,
        persona: input.persona ?? '',
        model: input.model,
        jid: `ai-${id}@galena.test`,
        status: 'active',
        providerConnectionId: input.providerConnectionId,
        limits: cloneLimits(input.limits),
        createdAt: new Date().toISOString(),
      };
      state.unshift(created);
      return cloneAi(created);
    },
    async updateAi(id: string, input: UpdateAiInput) {
      if (scenario === 'unavailable') unavailable();
      const existing = state.find((ai) => ai.id === id);
      if (existing === undefined) {
        throw new AisApiError(404, 'not_found', 'AI not found');
      }
      const updated: PublicAi = {
        ...existing,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.persona === undefined ? {} : { persona: input.persona }),
        ...(input.limits === undefined ? {} : { limits: cloneLimits(input.limits) }),
      };
      state[state.indexOf(existing)] = updated;
      return cloneAi(updated);
    },
    async deleteAi(id: string) {
      if (scenario === 'unavailable') unavailable();
      const index = state.findIndex((ai) => ai.id === id);
      if (index !== -1) {
        state.splice(index, 1);
      }
    },
    async listConnections() {
      if (scenario === 'unavailable') unavailable();
      if (scenario === 'no-connections') return [];
      return activeConnections().map((connection) => ({ ...connection }));
    },
  };
}
