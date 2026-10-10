/**
 * The one place that decides whether the web app runs on mock data (T-0069).
 * `?mock=1` is honored only in a dev build, or with `VITE_MOCK=1` at build time;
 * a production build ignores the URL param, so a shared link can never switch a
 * real session to fake chats (the hole T-0063 closed on mobile).
 *
 * In a dev build the choice is sticky for the tab (T-0968): `?mock=1`/`?mock=0`
 * are remembered in `sessionStorage`, because in-app navigation drops the query
 * string while the store created on the first page load keeps its fake XMPP.
 * The decision is made once per page load and reused for the rest of its life.
 */
export interface MockEnv {
  mode: string;
  viteMock: string | undefined;
  dev: boolean;
  search: string;
  saved: string | undefined;
}

const MOCK_STORAGE_KEY = 'zilar.mock';

/** Pure so every combination can be unit-tested without touching globals. */
export function resolveMockMode(env: MockEnv): boolean {
  if (env.viteMock === '1' || env.mode === 'test') {
    return true;
  }
  if (!env.dev) {
    return false;
  }
  const param = new URLSearchParams(env.search).get('mock');
  if (param === '1') {
    return true;
  }
  if (param === '0') {
    return false;
  }
  return env.saved === '1';
}

/** A read that fails (private mode, disabled storage) counts as "not saved". */
function readSavedMock(): string | undefined {
  try {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return window.sessionStorage.getItem(MOCK_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSavedMock(on: boolean): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }
    if (on) {
      window.sessionStorage.setItem(MOCK_STORAGE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(MOCK_STORAGE_KEY);
    }
  } catch {
    // A write that fails is treated as "not saved".
  }
}

function currentMockEnv(): MockEnv {
  return {
    mode: import.meta.env.MODE,
    viteMock: import.meta.env.VITE_MOCK,
    dev: import.meta.env.DEV,
    search: typeof window === 'undefined' ? '' : window.location.search,
    saved: readSavedMock(),
  };
}

function decideMockMode(): boolean {
  const env = currentMockEnv();
  if (env.dev && env.mode !== 'test' && env.viteMock !== '1') {
    const param = new URLSearchParams(env.search).get('mock');
    if (param === '1') {
      writeSavedMock(true);
    } else if (param === '0') {
      writeSavedMock(false);
    }
  }
  return resolveMockMode(env);
}

let decidedMockMode: boolean | undefined;

export function isMockMode(): boolean {
  if (decidedMockMode === undefined) {
    decidedMockMode = decideMockMode();
  }
  return decidedMockMode;
}

/**
 * The standalone mock HTTP layer (mock/api.ts) runs only when the app itself is
 * in mock mode and this is not the unit-test run. Component tests fake `fetch`
 * themselves and must keep taking that path, so `MODE === 'test'` is excluded.
 */
export function isMockApiEnabled(): boolean {
  return isMockMode() && import.meta.env.MODE !== 'test';
}
