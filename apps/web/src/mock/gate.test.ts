import { describe, expect, it } from 'vitest';
import { isMockApiEnabled, isMockMode, resolveMockMode, type MockEnv } from './gate';

const dev: MockEnv = { mode: 'development', viteMock: undefined, dev: true, search: '' };

describe('resolveMockMode', () => {
  it('is on in the unit-test run regardless of everything else', () => {
    expect(resolveMockMode({ mode: 'test', viteMock: undefined, dev: false, search: '' })).toBe(
      true,
    );
  });

  it('is on with VITE_MOCK=1', () => {
    expect(resolveMockMode({ ...dev, viteMock: '1' })).toBe(true);
  });

  it('honors ?mock=1 in a dev build', () => {
    expect(resolveMockMode({ ...dev, search: '?mock=1' })).toBe(true);
    expect(resolveMockMode({ ...dev, search: '?foo=1&mock=1' })).toBe(true);
  });

  it('ignores a missing or non-1 mock param', () => {
    expect(resolveMockMode({ ...dev, search: '' })).toBe(false);
    expect(resolveMockMode({ ...dev, search: '?mock=0' })).toBe(false);
    expect(resolveMockMode({ ...dev, search: '?mock=true' })).toBe(false);
  });

  it('ignores ?mock=1 in a production build', () => {
    const production: MockEnv = { mode: 'production', viteMock: undefined, dev: false, search: '' };
    expect(resolveMockMode({ ...production, search: '?mock=1' })).toBe(false);
    expect(resolveMockMode({ ...production, search: '?mock=0' })).toBe(false);
  });
});

describe('isMockMode in the test run', () => {
  it('keeps the mock store on', () => {
    expect(isMockMode()).toBe(true);
  });

  it('keeps the standalone HTTP layer off so tests keep their own fakes', () => {
    expect(isMockApiEnabled()).toBe(false);
  });
});
