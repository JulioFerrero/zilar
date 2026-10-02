import { describe, expect, it } from 'vitest';

import { MOCK_LOAD_DELAY_MS, readMockLoadScenario } from './load';

describe('readMockLoadScenario', () => {
  it('reads each documented scenario from the env', () => {
    for (const value of ['slow', 'error', 'empty', 'no-messages'] as const) {
      expect(readMockLoadScenario({ EXPO_PUBLIC_ZILAR_MOCK_LOAD: value })).toBe(value);
    }
  });

  it('ignores an unset or unrecognized value', () => {
    expect(readMockLoadScenario({})).toBeUndefined();
    expect(readMockLoadScenario({ EXPO_PUBLIC_ZILAR_MOCK_LOAD: '1' })).toBeUndefined();
    expect(readMockLoadScenario({ EXPO_PUBLIC_ZILAR_MOCK_LOAD: '' })).toBeUndefined();
  });

  it('keeps the slow delay short enough to screenshot', () => {
    expect(MOCK_LOAD_DELAY_MS).toBeGreaterThan(0);
    expect(MOCK_LOAD_DELAY_MS).toBeLessThanOrEqual(5000);
  });
});
