/**
 * The `?mock=` route param is a local-development convenience, so a production
 * build must not honor it: a stray deep link like `zilar://ais?mock=1` should
 * never switch a real user to fake data. The param is allowed only in a dev
 * build (`__DEV__`) or when the bundle sets `EXPO_PUBLIC_ZILAR_MOCK`.
 */
export function mockParamAllowed(env: { dev: boolean; envMock: string | undefined }): boolean {
  if (env.dev) {
    return true;
  }
  if (env.envMock === undefined || env.envMock === '' || env.envMock === '0') {
    return false;
  }
  return env.envMock !== 'false';
}

/**
 * The mock-mode decision the chat store provider and the auth guard share. It
 * mirrors the old store's gate: the unit-test run and a literal
 * `EXPO_PUBLIC_ZILAR_MOCK=1` select mock mode anywhere; the `?mock=1` route
 * param selects it only where `mockParamAllowed` opens the gate (a dev build, or
 * a build with the env var set). The env is passed in by the caller, which reads
 * the build-time literals once, so this stays pure.
 */
export interface MockModeEnv {
  dev: boolean;
  envMock: string | undefined;
  nodeEnv: string | undefined;
}

export function isMockMode(
  params: Record<string, string | string[] | undefined> | undefined,
  env: MockModeEnv,
): boolean {
  if (env.nodeEnv === 'test' || env.envMock === '1') {
    return true;
  }
  if (!mockParamAllowed({ dev: env.dev, envMock: env.envMock })) {
    return false;
  }
  const value = params?.['mock'];
  return value === '1' || (Array.isArray(value) && value.includes('1'));
}

// The token the mock-mode factories hand the API client. The shared backend
// ignores it, but the client fails `unauthorized` before sending when the token
// is `undefined` (plan risk R3).
export const mockToken = (): Promise<string> => Promise.resolve('mock-token');

// The mock env vars the API hooks and the chat store provider read. Each is a literal
// `process.env.EXPO_PUBLIC_*` expression, so babel-preset-expo inlines it at Metro time.
export const ENV_MOCK = process.env.EXPO_PUBLIC_ZILAR_MOCK;
export const ENV_MOCK_SCENARIO = process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO;
export const ENV_NODE_ENV = process.env.NODE_ENV;
// The env object the mock scenario readers take, with the same keys they read.
export const MOCK_ENV = {
  EXPO_PUBLIC_ZILAR_MOCK: ENV_MOCK,
  EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: ENV_MOCK_SCENARIO,
};
