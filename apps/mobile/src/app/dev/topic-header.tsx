// effect-plain: a presentational route that picks a catalog or a redirect; the env read is a build-time literal Metro folds, with no I/O or ports.
import { Redirect } from 'expo-router';

/**
 * The route for the hidden topic-header catalog (T-1780). The catalog itself
 * lives in `mock/dev-topic-header-screen.tsx` and is loaded behind `__DEV__` or
 * `EXPO_PUBLIC_ZILAR_MOCK`, a literal condition Metro folds to `false` in a
 * normal release build, so the catalog stays out of that bundle and the route
 * redirects home. Reachable only through `zilar://dev/topic-header`.
 */
export default function TopicHeaderDevRoute() {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TopicHeaderDevScreen = (
      require('@/mock/dev-topic-header-screen') as typeof import('@/mock/dev-topic-header-screen')
    ).default;
    return <TopicHeaderDevScreen />;
  }
  return <Redirect href="/" />;
}
