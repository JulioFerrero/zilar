// effect-plain: a presentational route that picks a catalog or a redirect; the env read is a build-time literal Metro folds, with no I/O or ports.
import { Redirect } from 'expo-router';

/**
 * The route for the hidden blocks catalog (T-1756). The catalog itself lives in
 * `mock/dev-blocks-screen.tsx` and is loaded behind `__DEV__` or
 * `EXPO_PUBLIC_ZILAR_MOCK`, a literal condition Metro folds to `false` in a
 * normal release build, so the catalog stays out of that bundle and the route
 * redirects home. Reachable only through `zilar://dev/blocks`.
 */
export default function BlocksDevRoute() {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BlocksDevScreen = (
      require('@/mock/dev-blocks-screen') as typeof import('@/mock/dev-blocks-screen')
    ).default;
    return <BlocksDevScreen />;
  }
  return <Redirect href="/" />;
}
