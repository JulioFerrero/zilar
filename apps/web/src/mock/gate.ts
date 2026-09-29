/**
 * The one place that decides whether the web app runs on mock data (T-0069).
 * `?mock=1` is honored only in a dev build, or with `VITE_MOCK=1` at build time;
 * a production build ignores the URL param, so a shared link can never switch a
 * real session to fake chats (the hole T-0063 closed on mobile).
 */
export interface MockEnv {
  mode: string;
  viteMock: string | undefined;
  dev: boolean;
  search: string;
}

/** Pure so every combination can be unit-tested without touching globals. */
export function resolveMockMode(env: MockEnv): boolean {
  if (env.viteMock === '1' || env.mode === 'test') {
    return true;
  }
  if (!env.dev) {
    return false;
  }
  return new URLSearchParams(env.search).get('mock') === '1';
}

function currentMockEnv(): MockEnv {
  return {
    mode: import.meta.env.MODE,
    viteMock: import.meta.env.VITE_MOCK,
    dev: import.meta.env.DEV,
    search: typeof window === 'undefined' ? '' : window.location.search,
  };
}

export function isMockMode(): boolean {
  return resolveMockMode(currentMockEnv());
}

/**
 * The standalone mock HTTP layer (mock/api.ts) runs only when the app itself is
 * in mock mode and this is not the unit-test run. Component tests fake `fetch`
 * themselves and must keep taking that path, so `MODE === 'test'` is excluded.
 */
export function isMockApiEnabled(): boolean {
  return isMockMode() && import.meta.env.MODE !== 'test';
}
