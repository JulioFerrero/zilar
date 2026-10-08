// The push Hono router moved onto the Effect `HttpApi` adapter (T-0543):
// `createPushApi` in `./api` serves every route. This module stays as a
// re-export-only file because the push route tests (outside the T-0543 scope)
// import `createPushRoutes` from it.
export {
  PUSH_SETTINGS_RATE_LIMIT_MAX,
  PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS,
  PUSH_SUBSCRIBE_RATE_LIMIT_MAX,
  PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS,
  PUSH_TEST_RATE_LIMIT_MAX,
  PUSH_TEST_RATE_LIMIT_WINDOW_MS,
  createPushApi,
  createPushRoutes,
  type PushApiDependencies,
  type PushRoutesDependencies,
} from './api';
export { PUSH_API_ROUTES } from './api';
