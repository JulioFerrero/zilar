import { Redirect } from 'expo-router';

/**
 * The route for the hidden blocks catalog (T-1756). The catalog itself lives in
 * `mock/dev-blocks-screen.tsx` and is loaded behind `__DEV__`, which Metro folds
 * to `false` in a release build, so the catalog stays out of the bundle and the
 * route redirects home. Reachable only through `zilar://dev/blocks`.
 */
export default function BlocksDevRoute() {
  if (__DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BlocksDevScreen = (
      require('@/mock/dev-blocks-screen') as typeof import('@/mock/dev-blocks-screen')
    ).default;
    return <BlocksDevScreen />;
  }
  return <Redirect href="/" />;
}
