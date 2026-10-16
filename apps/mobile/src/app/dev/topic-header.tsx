import { Redirect } from 'expo-router';

/**
 * The route for the hidden topic-header catalog (T-1780). The catalog itself
 * lives in `mock/dev-topic-header-screen.tsx` and is loaded behind `__DEV__`,
 * which Metro folds to `false` in a release build, so the catalog stays out of
 * the bundle and the route redirects home. Reachable only through
 * `zilar://dev/topic-header`.
 */
export default function TopicHeaderDevRoute() {
  if (__DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TopicHeaderDevScreen = (
      require('@/mock/dev-topic-header-screen') as typeof import('@/mock/dev-topic-header-screen')
    ).default;
    return <TopicHeaderDevScreen />;
  }
  return <Redirect href="/" />;
}
