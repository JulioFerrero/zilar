// effect-plain: a presentational route that picks a catalog or a redirect; the env read is a build-time literal Metro folds.
import { Redirect } from 'expo-router';

/**
 * The catalog loads behind a literal condition Metro folds to `false` in a release build, so it stays out of that bundle.
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
