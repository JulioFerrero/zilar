import { describe, expect, it } from 'vitest';
import { resolveMockMode, type MockEnv } from './gate';

function env(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    mode: 'development',
    viteMock: undefined,
    dev: true,
    search: '',
    saved: undefined,
    ...overrides,
  };
}

describe('resolveMockMode', () => {
  // The safety property from T-0063/T-0069: a production build never turns on
  // from the URL, whatever a shared link or the storage says.
  it('ignores ?mock=1 in a production build', () => {
    expect(resolveMockMode(env({ dev: false, search: '?mock=1' }))).toBe(false);
  });

  it('ignores a saved value in a production build', () => {
    expect(resolveMockMode(env({ dev: false, saved: '1' }))).toBe(false);
  });

  it('turns on for dev with ?mock=1', () => {
    expect(resolveMockMode(env({ search: '?mock=1' }))).toBe(true);
  });

  it('uses the saved value when the URL has no param', () => {
    expect(resolveMockMode(env({ saved: '1' }))).toBe(true);
  });

  it('turns off for ?mock=0 even with a saved value', () => {
    expect(resolveMockMode(env({ saved: '1', search: '?mock=0' }))).toBe(false);
  });

  it('still honors VITE_MOCK=1 in any build', () => {
    expect(resolveMockMode(env({ dev: false, viteMock: '1' }))).toBe(true);
  });

  it('still turns on in test mode', () => {
    expect(resolveMockMode(env({ mode: 'test', dev: false }))).toBe(true);
  });
});
