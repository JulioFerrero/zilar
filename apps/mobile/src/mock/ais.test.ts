import { beforeEach, describe, expect, it } from 'vitest';

import { aisMockScenario, createMockAisApi, mockAis, resetAisMock } from './ais';

// Every case starts from a clean mock: the module keeps one mutable list per
// scenario, so without this the tests depend on their run order.
beforeEach(() => {
  resetAisMock();
});

describe('aisMockScenario', () => {
  it('returns null without a mock request', () => {
    expect(aisMockScenario({}, {})).toBeNull();
    expect(aisMockScenario({ EXPO_PUBLIC_GALENA_MOCK: '0' }, {})).toBeNull();
  });

  it('uses the default scenario for ?mock=1', () => {
    expect(aisMockScenario({}, { mock: '1' })).toBe('default');
    expect(aisMockScenario({ EXPO_PUBLIC_GALENA_MOCK: '1' }, {})).toBe('default');
  });

  it('reads a named scenario from the param or the env default', () => {
    expect(aisMockScenario({}, { mock: 'empty' })).toBe('empty');
    expect(aisMockScenario({}, { mock: 'unavailable' })).toBe('unavailable');
    expect(
      aisMockScenario(
        { EXPO_PUBLIC_GALENA_MOCK: '1', EXPO_PUBLIC_GALENA_MOCK_SCENARIO: 'error' },
        {},
      ),
    ).toBe('error');
  });

  it('returns null for an unknown value instead of mocking', () => {
    expect(aisMockScenario({}, { mock: 'nonsense' })).toBeNull();
    expect(aisMockScenario({}, { mock: 'foo' })).toBeNull();
    expect(aisMockScenario({ EXPO_PUBLIC_GALENA_MOCK: 'false' }, {})).toBeNull();
  });

  it('still runs the default scenario when MOCK=1 has an unknown narrowing', () => {
    expect(
      aisMockScenario(
        { EXPO_PUBLIC_GALENA_MOCK: '1', EXPO_PUBLIC_GALENA_MOCK_SCENARIO: 'nonsense' },
        {},
      ),
    ).toBe('default');
  });
});

describe('createMockAisApi', () => {
  it('lists the seed AIs and only active connections', async () => {
    const api = createMockAisApi();
    await expect(api.listAis()).resolves.toHaveLength(mockAis.length);
    const connections = await api.listConnections();
    expect(connections.every((connection) => connection.status === 'active')).toBe(true);
    expect(connections).toHaveLength(2);
  });

  it('returns an empty list in the empty scenario', async () => {
    await expect(createMockAisApi('empty').listAis()).resolves.toEqual([]);
  });

  it('returns no connections in the no-connections scenario', async () => {
    await expect(createMockAisApi('no-connections').listConnections()).resolves.toEqual([]);
  });

  it('throws a 503 in the unavailable scenario', async () => {
    await expect(createMockAisApi('unavailable').listAis()).rejects.toMatchObject({
      status: 503,
      code: 'ais_unavailable',
    });
  });

  it('throws a 500 in the error scenario', async () => {
    await expect(createMockAisApi('error').listAis()).rejects.toMatchObject({ status: 500 });
  });

  it('creates, updates and deletes against the mutable state', async () => {
    const api = createMockAisApi('empty');
    const created = await api.createAi({
      name: 'New AI',
      template: 'dev',
      providerConnectionId: 'conn-openai',
      model: 'gpt-4o',
      limits: { perDayUsd: 2, perMonthUsd: 20 },
    });
    await expect(api.listAis()).resolves.toHaveLength(1);

    const updated = await api.updateAi(created.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');

    await api.deleteAi(created.id);
    await expect(api.listAis()).resolves.toEqual([]);
  });

  it('keeps each scenario separate, so empty never wipes default', async () => {
    const defaults = createMockAisApi('default');
    const empty = createMockAisApi('empty');
    await empty.createAi({
      name: 'Only in empty',
      template: 'dev',
      providerConnectionId: 'conn-openai',
      model: 'gpt-4o',
      limits: { perDayUsd: 2, perMonthUsd: 20 },
    });

    await expect(defaults.listAis()).resolves.toHaveLength(mockAis.length);
    await expect(empty.listAis()).resolves.toHaveLength(1);
  });
});
