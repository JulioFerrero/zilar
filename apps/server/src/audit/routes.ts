// Compatibility shim for the unchanged Hono-level `audit/routes.test.ts`,
// which imports `createAuditRoutes` from this path. The factory now lives in
// `./api`, on the Effect `HttpApi` adapter.

export { createAuditRoutes, type AuditRoutesDependencies } from './api';
