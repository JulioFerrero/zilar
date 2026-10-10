import { Redirect } from 'expo-router';

/**
 * The route for the hidden kit catalog. The catalog itself lives in
 * `mock/dev-kit-screen.tsx` and is loaded behind `__DEV__`, which Metro folds to
 * `false` in a release build, so the catalog stays out of the bundle and the
 * route redirects home.
 */
export default function KitDevRoute() {
  if (__DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const KitDevScreen = (
      require('@/mock/dev-kit-screen') as typeof import('@/mock/dev-kit-screen')
    ).default;
    return <KitDevScreen />;
  }
  return <Redirect href="/" />;
}
