// effect-plain: a presentational route that picks a catalog or a redirect; the env read is a build-time literal Metro folds, with no I/O or ports.
import { Redirect } from 'expo-router';

/**
 * The route for the hidden kit catalog. The catalog itself lives in
 * `mock/dev-kit-screen.tsx` and is loaded behind `__DEV__` or
 * `EXPO_PUBLIC_ZILAR_MOCK`, a literal condition Metro folds to `false` in a
 * normal release build, so the catalog stays out of that bundle and the route
 * redirects home.
 */
export default function KitDevRoute() {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const KitDevScreen = (
      require('@/mock/dev-kit-screen') as typeof import('@/mock/dev-kit-screen')
    ).default;
    return <KitDevScreen />;
  }
  return <Redirect href="/" />;
}
