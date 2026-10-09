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
