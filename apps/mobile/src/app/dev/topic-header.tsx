// effect-plain: a presentational route that picks a catalog or a redirect; the env read is a build-time literal Metro folds.
import { Redirect } from 'expo-router';

/**
 * The catalog loads behind a literal condition Metro folds to `false` in a release build, so it stays out of that bundle; reachable only through `zilar://dev/topic-header`.
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
