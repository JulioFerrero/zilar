/**
 * The `?mock=` route param is a local-development convenience, so a production
 * build must not honor it: a stray deep link like `galena://ais?mock=1` should
 * never switch a real user to fake data. The param is allowed only in a dev
 * build (`__DEV__`) or when the bundle sets `EXPO_PUBLIC_GALENA_MOCK`.
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
