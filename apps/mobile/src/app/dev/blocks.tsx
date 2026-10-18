// effect-plain: a presentational route that picks a catalog or a redirect; the env read is a build-time literal Metro folds.
import { Redirect } from 'expo-router';

/**
 * The catalog loads behind a literal condition Metro folds to `false` in a release build, so it stays out of that bundle; reachable only through `zilar://dev/blocks`.
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
